import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/browser-windows-package-smoke.yml'), 'utf8');

test('Package Smoke materializes Electron with PE metadata instead of GUI stdout probing', () => {
  assert.match(workflow, /Materialize exact Electron runtime for physical UI evidence/);
  assert.match(workflow, /System\.Diagnostics\.FileVersionInfo/);
  assert.match(workflow, /ProductVersion/);
  assert.match(workflow, /electron_runtime_product_version_missing/);
  assert.match(workflow, /\^44\\\.0\\\.0\(\?:\\\.0\)\?\$/);
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
  assert.match(workflow, /electron_runtime_sha256_invalid/);
  assert.match(workflow, /metaengine\.browser\.electron-runtime-materialization\.v1/);
  assert.doesNotMatch(workflow, /& \$electron --version/);
  assert.doesNotMatch(workflow, /binaryVersion\.Trim/);
});
