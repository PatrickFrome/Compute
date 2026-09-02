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

async function browserFile(relativePath) {
  return fs.readFile(path.join(repoRoot, 'apps', 'metaengine-browser', relativePath), 'utf8');
}

test('physical dev E2E follows the forward integration line without cross-SHA cancellation', async () => {
  const source = await workflow('metaengine-browser-self-update-fast-e2e.yml');
  assert.match(source, /integration\/metaengine-development-os-v1/);
  assert.match(source, /group: metaengine-browser-fast-self-update-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(source, /group: metaengine-browser-fast-self-update-\$\{\{ github\.ref \}\}/);
  assert.match(source, /0\.6\.6-dev\.\$env:GITHUB_RUN_ID\.1/);
  assert.match(source, /physical_target_run_identity_lost/);
});

test('full PR physical E2E reuses the shared published baseline harness and builds one target', async () => {
  const source = await workflow('metaengine-browser-self-update-e2e.yml');
  assert.match(source, /needs: contract/);
  assert.match(source, /\.\/test\/self-update-fast-physical\.ps1/);
  assert.match(source, /published_baseline_reused/);
  assert.match(source, /target_build_count/);
  assert.match(source, /physical_evidence_head_mismatch/);
  assert.match(source, /candidate_head_mismatch:\$\{actual\}:\$\{expected\}/);
  assert.doesNotMatch(source, /candidate_head_mismatch:\$actual:\$expected/);
  assert.doesNotMatch(source, /Build baseline N installer/);
  assert.doesNotMatch(source, /baseline-setup\.exe/);
  assert.doesNotMatch(source, /electron-builder@26\.15\.7/);
});

test('shared physical self-update waits for parseable singleton proof, not redirected-file length', async () => {
  const source = await browserFile('test/self-update-fast-physical.ps1');
  assert.match(source, /function Read-LastJsonLine/);
  assert.match(source, /ConvertFrom-Json -ErrorAction Stop/);
  assert.match(source, /\$firstRow = Read-LastJsonLine \$firstOut 10/);
  assert.match(source, /singleton_primary_probe_invalid/);
  assert.doesNotMatch(source, /Get-Item \$firstOut[^\n]*Length -eq 0/);
});

test('verified dev publisher is exact-SHA isolated and cannot regress the live hint', async () => {
  const source = await workflow('metaengine-browser-fast-autorelease.yml');
  assert.match(source, /integration\/metaengine-development-os-v1/);
  assert.match(source, /group: metaengine-browser-fast-verified-release-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(source, /group: metaengine-browser-fast-verified-release\n/);
  assert.match(source, /manifest_git_sha_mismatch/);
  assert.match(source, /SKIP_NEWER/);
  assert.match(source, /hint_version_collision/);
  assert.match(source, /pointer_readback_regressed/);
  assert.match(source, /dev_hint_cas_exhausted/);
});
