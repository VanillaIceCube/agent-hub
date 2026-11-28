"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { evaluateCodeqlResults } = require("../../scripts/evaluate-codeql-results");

test('scope workflow outputs are forwarded to RoboCop and evidence handling stays bounded', () => {
  const base = path.join(__dirname, '../../workflows');
  const review = fs.readFileSync(path.join(base, 'review-security.yml'), 'utf8');
  for (const language of ['status', 'python', 'javascript', 'actions']) {
    assert.equal(require('yaml').parse(review).on.workflow_call.inputs['codeql_scope_' + language].type, 'string');
    assert.ok(review.includes('inputs.codeql_scope_' + language));
  }
  assert.match(review, /get-security-evidence\.js/);
  const collector = fs.readFileSync(path.join(__dirname, '../../scripts/get-security-evidence.js'), 'utf8');
  assert.match(collector, /codeql_interpretation: codeqlInterpretation/);
  assert.match(review, /approval_eligible is false/);
  const evidence = evaluateCodeqlResults({ checkRuns: Array.from({ length: 100 }, (_, id) => ({ id, name: 'CodeQL', conclusion: 'neutral', output: { summary: 'x'.repeat(100000) } })) });
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 16000);
});
