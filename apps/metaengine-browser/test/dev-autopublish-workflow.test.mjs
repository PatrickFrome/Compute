import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const workflowPath = path.join(repoRoot, '.github/workflows/metaengine-browser-dev-autopublish.yml');

test('dev autopublish consumes exact physical evidence and never rebuilds release bytes', () => {
  const raw = fs.readFileSync(workflowPath, 'utf8');
  assert.match(raw, /integration\/browser-dev-auto-update/);
  assert.match(raw, /permissions:\n\s+actions: read\n\s+contents: write/);
  assert.match(raw, /TRUSTED_E2E_WORKFLOW_BLOB: b1b5dfbd63cf659560b5bb232f1555de7351ed77/);
  assert.match(raw, /TRUSTED_SHELL_WORKFLOW_BLOB: 766834e8a92f62d5da778392686fd5f535a5948e/);
  assert.match(raw, /head_sha=\$sha&status=success/);
  assert.match(raw, /metaengine-browser-self-update-e2e-\{sha\}-\{e2e\['run_attempt'\]\}/);
  assert.match(raw, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
  assert.match(raw, /metaengine\.browser\.self-update-e2e-manifest\.v2/);
  assert.match(raw, /physical_n_to_n_plus_1/);
  assert.match(raw, /durable_successor_binding/);
  assert.match(raw, /physical_singleton/);
  assert.match(raw, /verified_dev_version_not_monotonic/);
  assert.match(raw, /release_effect_ambiguous_no_readback/);
  assert.match(raw, /existing_release_asset_digest_mismatch/);
  assert.doesNotMatch(raw, /electron-builder/);
  assert.doesNotMatch(raw, /npm install/);
  assert.doesNotMatch(raw, /npm run/);
  assert.doesNotMatch(raw, /actions\/checkout@/);
});
