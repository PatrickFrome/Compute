import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
const m=JSON.parse(read('coordination/operator-control/client-source-candidate-w73.manifest.json'));
const w66='61534c1228b81b063b48082c3cdbcbfd2921fe63';
const w67='0752bf4f3e317db9f4caeb40d7b10e2f7edc3e66';
test('W73 truly merges W66 and final W67 as Git ancestors, retaining frozen history',()=>{
  assert.equal(m.schema,'metaengine.client.source-candidate-w73.v1');
  assert.equal(m.base_w66,w66);
  assert.equal(m.branch,'work/metaengine-client-wave12-w73-20261015');
  assert.ok(m.parent_heads.length>=27);
  assert.equal(new Set(m.parent_heads.map(x=>x.pr)).size,m.parent_heads.length);
  assert.equal(m.parent_heads.find(x=>x.pr===1292)?.sha,w67);
  for(const x of m.parent_heads){
    assert.match(x.sha,/^[a-f0-9]{40}$/);
    assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',x.sha,'HEAD']).status,0,'missing parent #'+x.pr);
  }
  for(const sha of [w66,w67,m.historical_w43_sha,m.historical_w51_sha])
    assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',sha,'HEAD']).status,0);
  assert.equal(git('rev-parse',w66+':coordination/operator-control/client-source-candidate-w66.manifest.json'),'8337b889acb89d6f652c65f1b1ef44d25b17a796');
});
test('W73 100+ protected blobs equal committed HEAD and exact local bytes',()=>{
  const entries=Object.entries(m.current_tree_blobs);
  assert.ok(entries.length>=100);
  for(const [p,sha] of entries){
    assert.ok(!p.startsWith('/')&&!p.includes('..')&&!p.includes('\\'));
    assert.match(sha,/^[a-f0-9]{40}$/);
    assert.equal(git('rev-parse','HEAD:'+p),sha,'stale HEAD blob '+p);
    assert.equal(git('hash-object',p),sha,'dirty current blob '+p);
  }
  for(const p of ['apps/metaengine-browser/src/host-agent-runtime.mjs','apps/metaengine-browser/src/host-native-owner-producers-w60.mjs'])
    assert.notEqual(m.current_tree_blobs[p],git('rev-parse',w66+':'+p),'final W67 100ns missing');
});
test('W73 authenticated operations, Windows sync and no unsafe promotion',()=>{
  const protocol=read('apps/metaengine-browser/src/host-agent-protocol.mjs');
  const runtime=read('apps/metaengine-browser/src/host-agent-runtime.mjs');
  for(const op of ['BACKUP_ACL_READBACK','OWNER_NATIVE_READBACK']){
    assert.match(protocol,new RegExp(op));
    assert.match(runtime,new RegExp(op+': async'));
  }
  assert.match(runtime,/guardian\.guardian_client_kernel_birth_verified === true/);
  assert.match(read('apps/metaengine-browser/src/guardian-client-kernel-birth-w67.mjs'),/client_creation_time_100ns/);
  assert.match(read('apps/metaengine-browser/src/host-native-owner-producers-w60.mjs'),/client_process_incarnation_id/);
  assert.match(read('apps/metaengine-browser/test/client-source-sync-native-w55.test.mjs'),/canonicalGeneratedGitFixtureW63/);
  assert.equal(m.authority_effect,false);
  assert.equal(m.promotion_authorized,false);
  assert.equal(m.automatic_retry_allowed,false);
  assert.equal(m.no_supabase,true);
  assert.equal(m.package_freeze_owner,'W78');
  assert.equal(m.package_version_change_authorized,false);
  assert.deepEqual(m.unbound_historical_effects,['W53_AMBIGUOUS_UNKNOWN','HISTORICAL_59_AMBIGUOUS_UNKNOWN']);
  for(const gate of ['CI','STAGING','INSTALLED','LIVE'])
    assert.match(m.proof_levels[gate],/UNKNOWN|PENDING|NOT_QUALIFIED/);
  assert.deepEqual(m.wave12_integrated_pins,[]);
});
test('W73 tests explicitly registered with exact-head CI, parent CI nontransitive',()=>{
  const workflow=read('.github/workflows/client-source-candidate-w73.yml');
  assert.match(workflow,/work\/metaengine-client-wave12-w73-20261015/);
  assert.match(workflow,/client-source-candidate-w73\.test\.mjs/);
  assert.match(workflow,/github\.event\.pull_request\.head\.sha \|\| github\.sha/);
  assert.match(workflow,/client-backup-acl-native-w58\.test\.mjs/);
  assert.match(workflow,/host-owner-custody-w67\.test\.mjs/);
  assert.match(workflow,/frozen-me2-seven-views/);
  const scripts=JSON.parse(read('infra/client-state-runtime/package.json')).scripts;
  assert.match(scripts['test:w73:source'],/client-source-candidate-w73\.test\.mjs/);
  assert.equal(m.parent_checks_not_transitive,true);
});
