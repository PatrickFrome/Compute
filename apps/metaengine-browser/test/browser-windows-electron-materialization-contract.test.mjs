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
  assert.match(workflow, /\[version\]\$productVersion/);
  assert.match(workflow, /parsedProductVersion\.Major -ne 44/);
  assert.match(workflow, /parsedProductVersion\.Minor -ne 9/);
  assert.match(workflow, /parsedProductVersion\.Build -ne 3/);
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
  assert.match(workflow, /electron_runtime_sha256_invalid/);
  assert.match(workflow, /metaengine\.browser\.electron-runtime-materialization\.v1/);
  assert.doesNotMatch(workflow, /& \$electron --version/);
  assert.doesNotMatch(workflow, /binaryVersion\.Trim/);
});

test('Package Smoke rejects old releases and noncanonical PE revisions without running the GUI', () => {
  const pattern = workflow.match(/if \(\$productVersion -notmatch '([^']+)'\)/)?.[1];
  assert.equal(pattern, '^44\\.9\\.3(?:\\.0)?$');
  assert.match(workflow, /\$parsedProductVersion\.Revision -notin @\(-1, 0\)/);
  const allowed = new RegExp(pattern);
  for (const version of ['44.9.3', '44.9.3.0']) assert.equal(allowed.test(version), true, version);
  for (const version of ['44.0.0', '44.9.2', '44.9.3.1', '44.9.3.999', '44.9.3.00',
    '44.9.3-beta.1', '44.9.3+metadata', '044.9.3']) assert.equal(allowed.test(version), false, version);
});
