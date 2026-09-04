import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

async function workflow(name) {
  return fs.readFile(path.join(repoRoot, '.github', 'workflows', name), 'utf8');
}

test('physical dev E2E follows the forward integration line without cross-SHA cancellation', async () => {
  const source = await workflow('metaengine-browser-self-update-fast-e2e.yml');
  assert.match(source, /integration\/metaengine-development-os-v1/);
  assert.match(source, /group: metaengine-browser-fast-self-update-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(source, /group: metaengine-browser-fast-self-update-\$\{\{ github\.ref \}\}/);
  assert.match(source, /0\.6\.6-dev\.\$env:GITHUB_RUN_ID\.1/);
  assert.match(source, /physical_target_run_identity_lost/);
});

test('verified dev publisher is exact-SHA isolated and cannot regress the live hint', async () => {
  const source = await workflow('metaengine-browser-fast-autorelease.yml');
  assert.match(source, /integration\/metaengine-development-os-v1/);
  assert.match(source, /group: metaengine-browser-fast-verified-release-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(source, /group: metaengine-browser-fast-verified-release\n/);
  assert.match(source, /manifest_git_sha_mismatch/);
  assert.match(source, /SKIP_NEWER/);
  assert.match(source, /hint_version_collision/);
  assert.match(source, /pointer_write_blob_mismatch/);
  assert.match(source, /dev_hint_write_accepted/);
  assert.match(source, /WAIT_REGRESSED/);
  assert.match(source, /dev_hint_readback_pending/);
  assert.match(source, /dev_hint_readback_exhausted_after_accepted_write/);
  assert.match(source, /dev_hint_cas_exhausted/);
});

test('verified dev publisher never repeats an accepted hint write while branch readback converges', async () => {
  const source = await workflow('metaengine-browser-fast-autorelease.yml');
  const acceptedWrite = source.indexOf('dev_hint_write_accepted');
  const readbackLoop = source.indexOf('for readback_attempt in $(seq 1 8)');
  const readbackExhausted = source.indexOf('dev_hint_readback_exhausted_after_accepted_write');
  const outerCasSleep = source.indexOf('sleep $((attempt * 2))');
  assert.ok(acceptedWrite > 0);
  assert.ok(readbackLoop > acceptedWrite);
  assert.ok(readbackExhausted > readbackLoop);
  assert.ok(outerCasSleep > readbackExhausted);
  const acceptedPath = source.slice(acceptedWrite, outerCasSleep);
  assert.doesNotMatch(acceptedPath, /gh api -X PUT/);
  assert.match(acceptedPath, /exit 1/);
});
