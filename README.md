# 🤖 AgentHub

AgentHub maintains the shared AI reviewers, coding and maintenance agents, prompts and tool configuration for VanillaIceCube repositories. Its security triage agent turns alerts into GitHub issues. FullStackTemplate, MacroMapper, Notoli, Infrastructure and AgentHub each own their alert schedules, credentials and tickets. [Migration tracker](https://github.com/VanillaIceCube/agent-hub/issues/8)

Track work on the [Detailed Kanban View](https://github.com/VanillaIceCube/agent-hub/issues/views/MDQ6VmlldzM0NDg3). The board groups open issues by status and issue type.

Pull requests run workflow linting, CodeQL, dependency review and Gitleaks. AgentHub also scans `main` on push and at midnight Pacific. The shared Infrastructure scanner checks Actions workflows and the JavaScript, TypeScript and Python in the checkout. [CodeQL workflow](.github/workflows/alert-codeql.yml)

## 🔎 Reviewers and alert triage

| Workflow | Identity | Evidence and result |
| --- | --- | --- |
| [Code review](.github/workflows/review-code.yml) | Obi-Wan Code-nobi | Reads the PR diff and prior reviews. Major Dependabot updates also need primary-source upgrade evidence. |
| [Build review](.github/workflows/review-build.yml) | Lint Eastwood | Reads lint and test statuses and their bounded logs. |
| [Security review](.github/workflows/review-security.yml) | RoboCop | Reads CodeQL scope and results, dependency and malware reports, and the secret scan result. |
| [Security alert triage](.github/workflows/triage-security.yml) | RoboCop | Reads one feed from the caller, matches alerts to existing issues, and creates, updates or closes tickets in that repository. |

These four entry points accept `workflow_call`. A PR reviewer uses the caller’s repository, PR number and exact head SHA. Its code and prompts come from the AgentHub revision named by the caller. The PR is checked out in `subject/` as review data. Keep each persona’s GitHub App and OpenAI credentials in the caller, together with its model, reasoning and token settings.

### 🚦 Preview and cutover

Call a reviewed AgentHub commit with the existing reviewer inputs and named secrets. The optional boolean `publish` defaults to `false`. A review preview uses the read-only App token, writes its proposed verdict and inline comments to the run summary, and fails on a blocking or unusable result. Alert previews report the number of issues they would create, update or close. An online preview still uses the caller’s inference budget.

Compare the preview and the existing reviewer on the same PR head. For cutover, change that repository’s existing caller to the same AgentHub pin and set `publish: true`. Keep its job name, dependencies and fork exclusions. The publisher then mints a separate token for that repository and persona. A retry can finish reconciliation after a successful review write. Restore the previous caller revision to roll back. [Migration and rollback criteria](https://github.com/VanillaIceCube/agent-hub/issues/8)

Each repository schedules CodeQL, malware and vulnerability triage at midnight Pacific and can start any feed manually. All three pass the feed name to the same ticket workflow. CodeQL starts a full scan alongside its scheduled ticket run. A manual CodeQL run updates tickets by default and offers a scan-only checkbox. AgentHub uses its own RoboCop credentials and native issue fields when handling its own alerts. [CodeQL](.github/workflows/alert-codeql.yml) · [Malware](.github/workflows/alert-malware.yml) · [Vulnerability](.github/workflows/alert-vulnerability.yml) · [Retired Jules workflows](https://github.com/VanillaIceCube/infrastructure/issues/117)

[Reviewer and alert action contracts](.github/actions/README.md)

## 🧪 Local checks

Run both suites with Node 24. Unit tests cover alert evaluation and issue reconciliation. Integration tests exercise the workflows and actions together using fixture pull requests, model responses and GitHub clients. [Unit tests](.github/tests/unit) · [Integration tests](.github/tests/integration)

```sh
npm ci --prefix .github --ignore-scripts --no-audit --no-fund
npm test --prefix .github
```
