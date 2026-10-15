import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'coordination/operator-control/client-source-candidate-w59.manifest.json'), 'utf8'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('W59 retains W51 W57 W58, all prior PRs as real ancestors, and original frozen W43', () => {
  assert.equal(manifest.schema, 'metaengine.client.source-candidate-w59.v1');
  assert.equal(manifest.classification, 'SOURCE_ONLY_INTEGRATED_REVIEW_REQUIRED');
  assert.equal(manifest.authority_effect, false);
  assert.equal(manifest.promotion_authorized, false);
  assert.equal(manifest.automatic_retry_allowed, false);
  assert.equal(manifest.no_supabase, true);
  assert.equal(manifest.freeze_owner, 'W62');
  assert.deepEqual(manifest.parent_heads.map(x => x.pr), [1273, 1275, 1272, 1276, 1269, 1271, 1274, 1278, 1282, 1281, 1280, 1279, 1277, 1283, 1284, 1285, 1288, 1290, 1286]);
  assert.equal(new Set(manifest.parent_heads.map(x => x.pr)).size, manifest.parent_heads.length);
  for (const p of manifest.parent_heads) {
    assert.match(p.sha, /^[0-9a-f]{40}$/);
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', p.sha, 'HEAD']).status, 0, 'missing original ancestor PR #' + p.pr);
  }
  assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', manifest.pre_version_assembly_anchor, 'HEAD']).status, 0);
});
test('W59 historical SHA retains sealed W58 ACL blobs; W66 seals CURRENT changed blobs separately', () => {
  assert.ok(Object.keys(manifest.current_tree_blobs).length >= 30);
  for (const [p, sha] of Object.entries(manifest.current_tree_blobs)) {
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(git('rev-parse', '83e1d60deb8189b09403e157cc7d639629549550:' + p), sha,
      'historical W59 ancestor blob drifted: ' + p);
  }
  const old = JSON.parse(read('coordination/operator-control/client-source-candidate-w51.manifest.json'));
  assert.notEqual(manifest.current_tree_blobs['infra/client-state-runtime/upgrade-backup-gate.mjs'], old.protected_git_blobs['infra/client-state-runtime/upgrade-backup-gate.mjs']);
  assert.notEqual(manifest.current_tree_blobs['infra/client-state-runtime/package.json'], old.protected_git_blobs['infra/client-state-runtime/package.json']);
});
test('W59 union registers W58 ACL and keeps original native Owner, critic, PG and completion tests', () => {
  const scripts = JSON.parse(read('infra/client-state-runtime/package.json')).scripts;
  for (const name of ['operator-canonical-native-w44.test.mjs',
    'client-candidate-acceptance-w49.test.mjs', 'client-backup-restore-staging-w47.test.mjs',
    'client-backup-acl-native-w58.test.mjs', 'client-backup-acl-native-w58.ipc.test.mjs']) {
    assert.ok(scripts.test.split(/\s+/).includes(name), 'lost client contract registration: ' + name);
  }
  assert.match(scripts['test:w58:acl'], /upgrade-backup-restore-gate.test.mjs/);
  assert.match(scripts['test:integration'], /disposable-pg17-logical-restore.integration.test.mjs/);
  assert.match(read('apps/metaengine-browser/src/client-backup-acl-native-w58.mjs'), /ACL_REVIEW_REQUIRED|acl|ACL/);
  const hostProtocol = read('apps/metaengine-browser/src/host-agent-protocol.mjs');
  const hostRuntime = git('show', '83e1d60deb8189b09403e157cc7d639629549550:apps/metaengine-browser/src/host-agent-runtime.mjs');
  assert.match(hostProtocol,/BACKUP_ACL_READBACK/);
  assert.match(hostProtocol,/OWNER_NATIVE_READBACK/);
  assert.match(hostRuntime,/BACKUP_ACL_READBACK: async/);
  assert.match(hostRuntime,/OWNER_NATIVE_READBACK: async/);
  assert.match(hostRuntime,/owner_binding_proven: false/);
  assert.match(read('apps/metaengine-browser/src/main.mjs'),/createHostNativeOwnerReadersW60/);
  assert.match(read('apps/metaengine-browser/test/client-source-sync-preflight-w50.test.mjs'),/canonicalGeneratedGitFixtureW63/);
  assert.match(read('apps/metaengine-browser/test/client-source-sync-native-w55.test.mjs'),/canonicalGeneratedGitFixtureW63/);
  assert.equal(manifest.w63_source_sync_frozen_ci.scope,'SOURCE_ONLY_PARENT_NOT_INTEGRATED_SHA');
  assert.match(read('infra/client-state-runtime/client-candidate-acceptance-w57.mjs'), /REVIEW_REQUIRED/);
});
test('W59 candidate remains SOURCE-only and cannot grant installed/LIVE or reuse W46 package reservation', () => {
  assert.deepEqual(manifest.wave10_unpublished_repair_omissions, []);
  assert.deepEqual(manifest.unbound_historical_effects, ['W53_AMBIGUOUS_UNKNOWN', 'HISTORICAL_59_AMBIGUOUS_UNKNOWN']);
  for (const p of ['STAGING', 'INSTALLED', 'LIVE']) assert.match(manifest.proof_levels[p], /UNKNOWN/);
  assert.equal(manifest.proof_levels.CI, 'EXACT_HEAD_PENDING');
  assert.equal(JSON.parse(read('apps/metaengine-browser/package.json')).version,
    JSON.parse(git('show', manifest.source_base_w51 + ':apps/metaengine-browser/package.json')).version);
  const roadmap = read('coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md');
  assert.match(roadmap, /W43 one-source Client convergence checkpoint/);
  assert.match(roadmap, /W57/);
  assert.doesNotMatch(roadmap, /^<<<<<<< |^=======|^>>>>>>> /m);
});
