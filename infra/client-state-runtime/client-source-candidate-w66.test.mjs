import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('coordination/operator-control/client-source-candidate-w66.manifest.json'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const w59 = '83e1d60deb8189b09403e157cc7d639629549550';
const exactPublished = new Map([
  [1284, '6d8e8edda321ffe185f4b613f9a787bc2294f8e8'],
  [1285, '00140a57964aacbddea6a5cf4811774bb1196b14'],
  [1288, '30e9641ba13b56cb3a18be9b6f93dc92db4df116'],
  [1289, '2cf2de5337daa236791da7b6073ad4e89ffb01e3'],
  [1292, 'bfd7f6635e82c940e00834ecca5da7688d501bdf'],
  [1294, '73501c8e37534721164f7ed349f004787c18302a'],
  [1295, '3b31239aac9abed880bb4d894f0ed5c1226ac525'],
  [1297, '3387c8bcbbf60b1522424d04d4c7cfecd66e0197'],
  [1296, '457e6d88e5b6838683145117159e732a3b42c745'],
  [1293, 'e0a2180e3b1d177d9d7d8c608a2060a5100060dc'],
]);

test('W66 has actual Git ancestry for final W62/W61/W64/W65 and all W59 predecessors', () => {
  assert.equal(manifest.schema, 'metaengine.client.source-candidate-w66.v1');
  assert.equal(manifest.repository, 'PatrickFrome/Compute');
  assert.equal(manifest.source_base_w59, w59);
  assert.equal(manifest.branch, 'work/metaengine-client-wave11-w66-20261015');
  assert.equal(manifest.classification, 'SOURCE_ONLY_INTEGRATED_REVIEW_REQUIRED');
  const pins = manifest.parent_heads;
  assert.ok(pins.length >= 21, 'W59 original 19 parents plus W59 and W65');
  assert.equal(new Set(pins.map(p => p.pr)).size, pins.length, 'duplicate PR pin');
  for (const p of pins) {
    assert.match(p.sha, /^[a-f0-9]{40}$/);
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', p.sha, 'HEAD']).status, 0,
      'unmerged published parent #' + p.pr);
  }
  assert.equal(pins.find(p => p.pr === 1287)?.sha, w59);
  for (const [pr, sha] of exactPublished) assert.equal(pins.find(p => p.pr === pr)?.sha, sha);
  for (const sha of [manifest.historical_w43_sha, manifest.historical_w51_sha, w59])
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', sha, 'HEAD']).status, 0);
});

test('W66 current-tree ledger is NEW, exact and locally clean, not a stale W59 SHA ledger', () => {
  const blobs = manifest.current_tree_blobs;
  assert.ok(Object.keys(blobs).length >= 55);
  for (const [p, blob] of Object.entries(blobs)) {
    assert.ok(!p.startsWith('/') && !p.includes('..') && !p.includes('\\'), 'invalid source path: ' + p);
    assert.match(blob, /^[a-f0-9]{40}$/, p);
    assert.equal(git('rev-parse', 'HEAD:' + p), blob, 'stale integrated tree blob: ' + p);
    assert.equal(git('hash-object', p), blob, 'dirty source path: ' + p);
  }
  const previous = JSON.parse(read('coordination/operator-control/client-source-candidate-w59.manifest.json'));
  assert.notEqual(blobs['infra/client-state-runtime/own-postgres-birth-w61.mjs'],
    previous.current_tree_blobs['infra/client-state-runtime/own-postgres-birth-w61.mjs']);
  assert.notEqual(blobs['apps/me2-ui/src/components/me2/shell/topbar.tsx'],
    previous.current_tree_blobs['apps/me2-ui/src/components/me2/shell/topbar.tsx']);
  assert.notEqual(blobs['infra/client-state-runtime/client-serial-loop-pg17-lifecycle-w64.mjs'],
    previous.current_tree_blobs['infra/client-state-runtime/client-serial-loop-pg17-lifecycle-w64.mjs']);
});

test('W66 preserves both W58 ACL and W60 Owner authenticated Host protocol operations', () => {
  const protocol = read('apps/metaengine-browser/src/host-agent-protocol.mjs');
  const runtime = read('apps/metaengine-browser/src/host-agent-runtime.mjs');
  const main = read('apps/metaengine-browser/src/main.mjs');
  for (const op of ['BACKUP_ACL_READBACK', 'OWNER_NATIVE_READBACK']) {
    assert.match(protocol, new RegExp(op));
    assert.match(runtime, new RegExp(op + ': async'));
  }
  assert.match(runtime, /guardian\.owner_binding_proven === true/);
  assert.match(runtime, /guardian\.guardian_client_kernel_birth_verified === true/);
  assert.match(runtime, /const first = await this\.#trustedOwnerReadback/);
  assert.match(runtime, /const last = await this\.#trustedOwnerReadback/);
  assert.match(runtime, /owner = null/);
  assert.match(main, /createHostNativeOwnerReadersW60/);
  for (const p of [
    'apps/metaengine-browser/test/client-source-sync-preflight-w50.test.mjs',
    'apps/metaengine-browser/test/client-source-sync-native-w55.test.mjs'
  ]) assert.match(read(p), /canonicalGeneratedGitFixtureW63/);
});

test('W66 retains source registration and cannot qualify staging, package or live Owner', () => {
  const s = JSON.parse(read('infra/client-state-runtime/package.json')).scripts;
  for (const t of [
    'client-backup-acl-native-w58.test.mjs',
    'client-backup-acl-native-w58.ipc.test.mjs',
    'client-candidate-acceptance-w49.test.mjs',
    'client-backup-restore-staging-w47.test.mjs'
  ]) assert.ok(s.test.includes(t), 'missing registered existing contract: ' + t);
  for (const v of ['SOURCE', 'CI', 'STAGING', 'INSTALLED', 'LIVE']) assert.equal(typeof manifest.proof_levels[v], 'string');
  for (const v of ['STAGING', 'INSTALLED', 'LIVE']) assert.match(manifest.proof_levels[v], /UNKNOWN|NOT_QUALIFIED/);
  assert.equal(manifest.no_supabase, true);
  assert.equal(manifest.authority_effect, false);
  assert.equal(manifest.promotion_authorized, false);
  assert.equal(manifest.automatic_retry_allowed, false);
  assert.deepEqual(manifest.unbound_historical_effects, ['W53_AMBIGUOUS_UNKNOWN', 'HISTORICAL_59_AMBIGUOUS_UNKNOWN']);
  assert.equal(manifest.package_freeze_owner, 'W69');
  assert.equal(manifest.package_version_change_authorized, false);
  assert.equal(JSON.parse(read('apps/metaengine-browser/package.json')).version,
    JSON.parse(git('show', w59 + ':apps/metaengine-browser/package.json')).version);
  const roadmap = read('coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md');
  assert.match(roadmap, /W43 one-source Client convergence checkpoint/);
  assert.doesNotMatch(roadmap, /^<<<<<<< |^=======|^>>>>>>> /m);
});
