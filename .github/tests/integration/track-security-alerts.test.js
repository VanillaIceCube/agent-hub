"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const {
  validateConfiguration,
  collectAlerts,
  writeSource,
  reconcile,
} = require("../../actions/track-security-alerts/track-security-alerts");

const root = path.resolve(__dirname, '../../..');

const load = name => YAML.parse(fs.readFileSync(path.resolve(root, name), 'utf8'));

const manifest = load('.github/actions/track-security-alerts/action.yml');

const { run: requestReview } = require("../../actions/request-ai-response/request-ai-response");

const feeds = ["codeql", "vulnerability", "malware"];
const reader = { FEED: "codeql", ROBOCOP_TOKEN: "fixture-reader" };
const draftStep = manifest.runs.steps.find(step => step.id === "openai");

const fields = [
  { name: 'Domain', fullDatabaseId: 1, dataType: 'SINGLE_SELECT', options: ['Frontend', 'Backend', 'Cloud'].map(name => ({ name })) },
  { name: 'Priority', fullDatabaseId: 2, dataType: 'SINGLE_SELECT', options: ['P0', 'P1', 'P2'].map(name => ({ name })) },
  { name: 'Size', fullDatabaseId: 3, dataType: 'SINGLE_SELECT', options: [{ name: 'M' }] },
];
const issueTypes = { nodes: [{ name: 'Bug' }] };

test('native schema validation fails before reading any alert feed', async () => {
  for (const name of ['Bug', 'Domain', 'Priority', 'Size']) {
    const repository = {
      issueTypes: name === 'Bug' ? { nodes: [] } : issueTypes,
      issueFields: { nodes: fields.filter(field => field.name !== name) },
    };
    const github = {
      graphql: async () => ({ repository }),
      paginate: () => assert.fail('must validate fields before reading alerts'),
    };
    await assert.rejects(writeSource({ github, context: { repo: {} } }, reader), new RegExp(name));
  }
});

async function runFeed(t, feed, { empty = false, settings = {}, severity = "medium" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-alert-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...reader, ...settings, FEED: feed, RUNNER_TEMP: dir, PUBLISH: "true" };
  const messages = [];
  const outputs = {};
  const issues = [];
  const fieldWrites = [];
  let fetches = 0;
  let providerCalls = 0;
  const core = {
    info: message => messages.push(message),
    warning: message => messages.push(message),
    setOutput(key, value) { outputs[key] = value; },
  };
  const sourceAlert = feed === "codeql"
    ? { number: 1, html_url: "https://example.test/alert/1",
        rule: { id: "fixture", severity: "warning" },
        most_recent_instance: { location: { path: "backend/synthetic.py" } } }
    : { ...alert(1, severity, "GHSA-fixture"),
        dependency: { package: { name: "fixture", ecosystem: "npm" }, manifest_path: "frontend/package.json" } };
  const github = {
    graphql: async () => ({ repository: { issueFields: { nodes: fields }, issueTypes } }),
    rest: {
      codeScanning: { listAlertsForRepo: "codeql" },
      dependabot: { listAlertsForRepo: "dependabot" },
      issues: {
        listForRepo: "issues",
        async create(request) {
          assert.equal(Object.hasOwn(request, "labels"), false);
          const issue = { ...request, number: 1, node_id: "ISSUE_1",
            assignees: request.assignees.map(login => ({ login })) };
          issues.push(issue);
          return { data: issue };
        },
        addAssignees: () => assert.fail("the issue is assigned at creation"),
        update: () => assert.fail("a fresh issue needs no update"),
      },
    },
    async paginate(endpoint) {
      if (endpoint === "issues") return issues;
      assert.equal(endpoint, feed === "codeql" ? "codeql" : "dependabot");
      fetches++;
      return empty ? [] : [sourceAlert];
    },
    async request(route, args) {
      if (route === "GET /advisories/{ghsa_id}") {
        return { data: { ghsa_id: args.ghsa_id, type: "malware" } };
      }
      if (route.startsWith("GET ") && route.endsWith("issue-field-values")) return { data: [] };
      assert.match(route, /^POST .*issue-field-values$/);
      fieldWrites.push(...args.issue_field_values);
      return { data: [] };
    },
  };
  const action = { github, context: { repo: { owner: "fixture", repo: "fixture" } }, core };
  await writeSource(action, env);
  if (outputs.has_alerts === "true") {
    const ref = feed === "codeql" ? "code-scanning:1" : "dependabot:1";
    const draft = { groups: [{
      title: "Repair synthetic fixture", summary: "Fixture summary",
      recommendation: "Apply the fixture correction.", alert_refs: [ref],
    }] };
    const output = path.join(dir, "provider-output");
    await requestReview({
      MODEL: outputs.model,
      REASONING_EFFORT: outputs.reasoning_effort,
      MAX_OUTPUT_TOKENS: outputs.max_output_tokens,
      ENABLE_WEB_SEARCH: "false",
      OPENAI_API_KEY: "synthetic-api-key",
      OPENAI_PROJECT_ID: "synthetic-ai-project",
      PROMPT_PREFIX: draftStep.with.prompt_prefix,
      SYSTEM_PROMPT: draftStep.with.system_prompt,
      RUNNER_TEMP: dir,
      DIFF_PATH: path.join(dir, "security-alerts.json"),
      GITHUB_OUTPUT: output,
    }, async request => {
      providerCalls++;
      assert.equal(request.model, settings.MODEL || "gpt-6-luna");
      assert.equal(request.reasoning.effort, settings.REASONING_EFFORT || "medium");
      assert.equal(request.max_output_tokens, Number(settings.MAX_OUTPUT_TOKENS || 16000));
      assert.match(request.input, /Authoritative advisory|synthetic\.py/);
      return JSON.stringify({ output: [{ type: "message", content: [
        { type: "output_text", text: JSON.stringify(draft) },
      ] }] });
    });
    const content = fs.readFileSync(output, "utf8").match(/content<<([^\n]+)\n([\s\S]*?)\n\1/);
    assert.ok(content, "expected the provider's content output");
    env.LLM_OUTPUT = content[2];
  }
  await reconcile(action, env);
  assert.equal(fetches, 1);
  assert.equal(providerCalls, empty ? 0 : 1);
  assert.equal(issues.length, empty ? 0 : 1);
  assert.equal(fieldWrites.length, empty ? 0 : 3);
  if (!empty) {
    assert.equal(fieldWrites.find(field => field.field_id === 1).value, feed === "codeql" ? "Backend" : "Frontend");
    assert.equal(issues[0].type, "Bug");
  }
  assert.match(messages.join("\n"), empty ? /No open .* alerts or managed issues to reconcile/ : /Created issue #1/);
}

test("repository variables resolve in the ticket workflow and validated settings reach the model", () => {
  for (const dir of fs.readdirSync(path.join(root, ".github/actions"))) {
    const file = path.join(root, ".github/actions", dir, "action.yml");
    if (fs.existsSync(file) && load(file).runs.using === "composite") {
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\$\{\{[^}]*\bvars(?:\.|\[)/);
    }
  }
  const fetchStep = manifest.runs.steps.find(step => step.id === "alerts");
  const workflow = load(".github/workflows/triage-security.yml");
  const call = workflow.jobs.aggregate.steps.find(step => step.uses === "./.github/actions/track-security-alerts");
  assert.equal(call.with.feed, "${{ inputs.feed }}");
  assert.equal(call.with["robocop-token"], "${{ steps.codeql-token.outputs.token || steps.dependabot-token.outputs.token }}");
  for (const [input, variable, output] of [
    ["model", "MODEL", "model"],
    ["reasoning-effort", "REASONING_EFFORT", "reasoning_effort"],
    ["max-output-tokens", "MAX_OUTPUT_TOKENS", "max_output_tokens"],
  ]) {
    assert.equal(call.with[input], "${{ vars.AI_REVIEW_" + variable + " }}");
    assert.equal(fetchStep.env[variable], "${{ inputs." + input + " }}");
    assert.equal(draftStep.with[output], "${{ steps.alerts.outputs." + output + " }}");
  }
  assert.equal(draftStep.if, "steps.alerts.outputs.has_alerts == 'true'");
});

test("blank and omitted settings use the accepted reviewer defaults", () => {
  const expected = { model: "gpt-6-luna", reasoning_effort: "medium", max_output_tokens: 16000 };
  assert.deepEqual(validateConfiguration(reader), expected);
  assert.deepEqual(validateConfiguration({ ...reader, MODEL: "", REASONING_EFFORT: "", MAX_OUTPUT_TOKENS: "" }), expected);
});

test("invalid credentials, feed, or model settings fail before any GitHub request", async () => {
  for (const overrides of [
    { ROBOCOP_TOKEN: "" }, { FEED: "other" }, { MODEL: "unknown" }, { REASONING_EFFORT: "ultra" },
    { MAX_OUTPUT_TOKENS: "0" }, { MAX_OUTPUT_TOKENS: "NaN" }, { MAX_OUTPUT_TOKENS: "128001" },
  ]) {
    const github = { graphql: () => assert.fail("unexpected API request") };
    await assert.rejects(writeSource({ github, context: { repo: {} } }, { ...reader, ...overrides }),
      /Missing RoboCop|Unsupported (alert|reviewer)|Invalid reviewer/);
  }
});

for (const feed of feeds) {
  test(`${feed}: an empty feed requires no provider or issue writes`, t => runFeed(t, feed, { empty: true }));
  test(`${feed}: an alert becomes a typed issue with native fields`, t => runFeed(t, feed));
  test(`${feed}: the model receives the repository's configured budget`, t =>
    runFeed(t, feed, { settings: { REASONING_EFFORT: "low", MAX_OUTPUT_TOKENS: "1000" } }));
}
for (const severity of ["high", "critical"]) {
  test(`vulnerability: ${severity} alerts reach issue reconciliation`, t =>
    runFeed(t, "vulnerability", { severity }));
}

async function collect(feed, alerts, advisoryLookup = async (_route, params) => ({ data: { ghsa_id: params.ghsa_id, type: "reviewed" } })) {
  const github = {
    rest: { codeScanning: { listAlertsForRepo: "codeql" }, dependabot: { listAlertsForRepo: "dependabot" } },
    paginate: async () => alerts,
    request: advisoryLookup,
  };
  return collectAlerts(github, { owner: "owner", repo: "repo" }, feed);
}

function alert(number, severity, ghsa = `GHSA-${number}`) {
  return { number, html_url: `https://github.com/owner/repo/security/dependabot/${number}`,
    security_advisory: { ghsa_id: ghsa, severity, summary: "Authoritative advisory" },
    dependency: { package: { name: "example", ecosystem: "actions" }, manifest_path: ".github/workflows/ci.yml" },
  };
}

test("vulnerability feed retains every severity and authoritative source link", async () => {
  const source = ["critical", "high", "medium", "low", "unknown"].map((severity, index) => alert(index + 1, severity));
  const result = await collect("vulnerability", source);
  assert.deepEqual(result.alerts.map(value => value.severity), source.map(value => value.security_advisory.severity));
  assert.equal(result.alerts[0].url, source[0].html_url);
});

test("malware classification queries only unique advisories already affecting this repository", async () => {
  const lookedUp = [];
  const result = await collect("malware", [alert(1, "critical", "bad"), alert(2, "high", "bad"), alert(3, "medium", "ordinary")],
    async (route, params) => {
      assert.equal(route, "GET /advisories/{ghsa_id}");
      lookedUp.push(params.ghsa_id);
      return { data: { ghsa_id: params.ghsa_id, type: params.ghsa_id === "bad" ? "malware" : "reviewed" } };
    });
  assert.deepEqual(lookedUp, ["bad", "ordinary"]);
  assert.deepEqual(result.alerts.map(value => value.ref), ["dependabot:1", "dependabot:2"]);
});

test("empty malware feed does not query the global advisory corpus", async () => {
  const result = await collect("malware", [], async () => { throw new Error("Unexpected advisory lookup"); });
  assert.deepEqual(result.alerts, []);
});

test("scanner errors propagate before any group can be synchronized", async () => {
  await assert.rejects(collect("malware", [alert(1, "high")], async () => { throw new Error("API unavailable"); }), /API unavailable/);
  for (const advisory of [{ ghsa_id: "unexpected", type: "malware" }, { ghsa_id: "GHSA-1", type: "unknown" }, { ghsa_id: "GHSA-1" }]) {
    await assert.rejects(collect("malware", [alert(1, "high")], async () => ({ data: advisory })), /Cannot classify/);
  }
});

test("Dependabot alert compaction preserves the source URL used in issue links", async () => {
  const github = { rest: { dependabot: { listAlertsForRepo() {} } }, paginate: async () => [
    { number: 7, html_url: "https://example.test/advisory/7", security_advisory: { severity: "critical" } },
  ] };
  const { alerts } = await collectAlerts(github, { owner: "owner", repo: "repo" }, "vulnerability");
  assert.equal(alerts[0].url, "https://example.test/advisory/7");
  assert.equal(alerts[0].ref, "dependabot:7");
});

test("ticket previews and publication use separate repository-scoped tokens", () => {
  const worker = load(".github/workflows/triage-security.yml");
  assert.deepEqual(Object.keys(worker.on), ["workflow_call"]);
  assert.equal(worker.on.workflow_call.inputs.feed.required, true);
  assert.equal(worker.on.workflow_call.inputs.publish.default, false);
  assert.deepEqual(worker.permissions, {});
  const job = worker.jobs.aggregate;
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(job.if, "github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && " +
    "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')");

  const tokens = job.steps.filter(step => step.uses?.startsWith("actions/create-github-app-token@"));
  assert.equal(tokens.length, 3);
  for (const token of tokens) {
    assert.equal(token.with.owner, "${{ github.repository_owner }}");
    assert.equal(token.with.repositories, "${{ github.event.repository.name }}");
    assert.equal(token.with["app-id"], "${{ vars.ROBOCOP_APP_ID }}");
    assert.equal(token.with["private-key"], "${{ secrets.ROBOCOP_PRIVATE_KEY }}");
  }
  function scopes(token) {
    return Object.fromEntries(Object.entries(token.with).filter(([name]) => name.startsWith("permission-")));
  }
  const codeql = tokens.find(step => step.id === "codeql-token");
  assert.equal(codeql.if, "inputs.feed == 'codeql'");
  assert.deepEqual(scopes(codeql), { "permission-issues": "read", "permission-security-events": "read" });
  const dependabot = tokens.find(step => step.id === "dependabot-token");
  assert.equal(dependabot.if, "inputs.feed == 'vulnerability' || inputs.feed == 'malware'");
  assert.deepEqual(scopes(dependabot), { "permission-issues": "read", "permission-vulnerability-alerts": "read" });
  const writer = tokens.find(step => step.id === "publisher-token");
  assert.equal(writer.if, "inputs.publish");
  assert.deepEqual(scopes(writer), { "permission-issues": "write" });

  const track = job.steps.find(step => step.uses === "./.github/actions/track-security-alerts");
  assert.equal(track.with.publish, "${{ inputs.publish }}");
  assert.equal(track.with["publisher-token"], "${{ steps.publisher-token.outputs.token }}");
  const action = fs.readFileSync(path.join(root, ".github/actions/track-security-alerts/action.yml"), "utf8");
  assert.match(action, /github-token: \$\{\{ inputs\.robocop-token \}\}/);
  assert.doesNotMatch(action, /PROJECT_TOKEN|PROJECT_ID:|getOctokit/);
});

test("AgentHub schedules all three feeds and keeps push and PR scans independent of ticketing", () => {
  const midnight = [{ cron: "0 0 * * *", timezone: "America/Los_Angeles" }];
  for (const feed of feeds) {
    const alert = load(".github/workflows/alert-" + feed + ".yml");
    assert.deepEqual(alert.on.schedule, midnight);
    assert.ok(Object.hasOwn(alert.on, "workflow_dispatch"));
    assert.equal(alert.jobs.aggregate.uses, "./.github/workflows/triage-security.yml");
    assert.deepEqual(alert.jobs.aggregate.with, { feed, publish: true });
    assert.deepEqual(alert.jobs.aggregate.permissions, { contents: "read" });
    assert.equal(alert.jobs.aggregate.needs, undefined);
  }
  const main = load(".github/workflows/alert-codeql.yml");
  const pr = load(".github/workflows/ci-orchestrator.yml").jobs.codeql;
  assert.deepEqual(main.on.push, { branches: ["main"] });
  assert.equal(main.on.workflow_dispatch.inputs.scan_only.default, false);
  assert.equal(main.jobs.scan.if, "github.event_name == 'push' || github.event_name == 'schedule' || inputs.scan_only");
  assert.equal(main.jobs.aggregate.if, "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && !inputs.scan_only");
  assert.match(main.jobs.scan.uses, /^VanillaIceCube\/infrastructure\/\.github\/workflows\/alert-codeql\.yml@/);
  assert.equal(main.jobs.scan.uses, pr.uses);
  assert.deepEqual(main.jobs.scan.with, { scan_only: true, languages_in_tree: true });
  assert.deepEqual(pr.with, main.jobs.scan.with);
});
