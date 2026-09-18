import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, '../../../.github/workflows/metaengine-browser-fast-autorelease.yml');

test('fast publisher classifies workflow authorization before expensive waits or release creation', async () => {
  const text = await fs.readFile(workflowPath, 'utf8');
  const checkout = text.indexOf('Checkout exact target for publisher authorization preflight');
  const preflight = text.indexOf('Fail fast when target workflow drift requires external publisher authority');
  const evidenceWait = text.indexOf('Wait for exact release evidence gate success');
  const physicalWait = text.indexOf('Wait for exact fast physical E2E success');
  const releaseCreate = text.indexOf('Create draft from exact tested bytes');

  for (const [name, index] of Object.entries({ checkout, preflight, evidenceWait, physicalWait, releaseCreate })) {
    assert.ok(index >= 0, name + ' step missing');
  }
  assert.ok(checkout < preflight);
  assert.ok(preflight < evidenceWait);
  assert.ok(preflight < physicalWait);
  assert.ok(preflight < releaseCreate);

  assert.match(text, /actions\/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /release-target-workflow-auth-preflight\.cjs/);
  assert.match(text, /contents\/\.github\/workflows\?ref=\$\{DEFAULT_SHA\}/);
  assert.match(text, /contents\/\.github\/workflows\?ref=\$\{EXPECTED_SHA\}/);
  assert.match(text, /release-auth-preflight\.json/);
  assert.match(text, /PRECHECK_STATUS.*-eq 42/);
  assert.match(text, /target_workflow_drift_requires_external_workflows_write_actor/);
});

test('publisher preflight is read-only and requests no unavailable GITHUB_TOKEN workflow authority', async () => {
  const text = await fs.readFile(workflowPath, 'utf8');
  const start = text.indexOf('- name: Fail fast when target workflow drift requires external publisher authority');
  const end = text.indexOf('- name: Wait for exact release evidence gate success');
  assert.ok(start >= 0 && end > start);
  const block = text.slice(start, end);

  assert.doesNotMatch(block, /gh release create/);
  assert.doesNotMatch(block, /gh api -X (POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(block, /secrets\./);
  assert.doesNotMatch(text, /workflows:\s*write/);
  assert.match(block, /release-target-workflow-auth-preflight\.cjs/);
});
