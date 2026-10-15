import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const read=p=>fs.readFileSync(new URL(p,new URL('../../',import.meta.url)),'utf8');
const manifest=JSON.parse(read('coordination/operator-control/client-critical-closure.manifest.json'));

test('critical closure retains all reviewed source parents and the immutable W73 base',()=>{
 assert.equal(manifest.schema,'metaengine.client.critical-closure.v1');
 assert.equal(manifest.repository,'PatrickFrome/Compute');
 assert.equal(manifest.base_w73,'9e8ebcd09b46d0e8f5a09e9a0471d15a190baeea');
 assert.ok(manifest.parent_heads.length>=37);
 assert.equal(new Set(manifest.parent_heads.map(p=>p.pr)).size,manifest.parent_heads.length);
 for(const parent of manifest.parent_heads){
  assert.match(parent.sha,/^[a-f0-9]{40}$/);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',parent.sha,'HEAD']).status,0,
    'unmerged source parent #'+parent.pr);
 }
});

test('critical closure seals the actual committed source and local worktree bytes',()=>{
 const entries=Object.entries(manifest.current_tree_blobs);
 assert.ok(entries.length>=150);
 for(const [file,blob] of entries){
  assert.ok(!file.startsWith('/')&&!file.includes('..')&&!file.includes('\\'));
  assert.match(blob,/^[a-f0-9]{40}$/);
  assert.equal(git('rev-parse','HEAD:'+file),blob,'stale current commit: '+file);
  assert.equal(git('hash-object',file),blob,'changed local bytes: '+file);
 }
 if(process.env.EXPECTED_SHA)assert.equal(git('rev-parse','HEAD'),process.env.EXPECTED_SHA);
});

test('source closure has no authority to promote installed state or replay historical effects',()=>{
 for(const key of ['authority_effect','promotion_authorized','automatic_retry_allowed','package_version_change_authorized'])
  assert.equal(manifest[key],false,key);
 assert.equal(manifest.no_supabase,true);
 assert.equal(manifest.parent_checks_not_transitive,true);
 for(const level of ['CI','INSTALLED','LIVE'])assert.match(manifest.proof_levels[level],/PENDING|UNKNOWN|NOT_QUALIFIED/);
 assert.deepEqual(manifest.unbound_historical_effects,['W53_AMBIGUOUS_UNKNOWN','HISTORICAL_59_AMBIGUOUS_UNKNOWN']);
 const observed=JSON.parse(read('apps/metaengine-browser/package.json')).version;
 const historical=JSON.parse(git('show',manifest.base_w73+':apps/metaengine-browser/package.json')).version;
 if(manifest.test_candidate){
  const c=manifest.test_candidate;
  assert.equal(c.classification,'ISOLATED_TEST_PACKAGE_ONLY');
  assert.equal(c.source_parent,'49d050ff127e22ca27fbe3514324ba99832afb24');
  assert.equal(c.branch,'work/metaengine-test-candidate-20261015');
  assert.equal(c.version,'0.7.0-dev.894615027143.1');
  assert.equal(c.production_release_authorized,false);
  assert.equal(c.installed_mutation_authorized,false);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',c.source_parent,'HEAD']).status,0);
  assert.equal(observed,c.version);
  assert.notEqual(observed,historical);
 }else assert.equal(observed,historical);
});

test('current CI runs the complete Browser and Client suites and preserves physical qualification',()=>{
 const ci=read('.github/workflows/client-source-candidate-w73.yml');
 assert.match(ci,/ubuntu-24\.04, windows-2025/);
 assert.match(ci,/client-critical-closure\.test\.mjs/);
 assert.match(ci,/npm --prefix infra\/client-state-runtime test/);
 assert.match(ci,/--test-concurrency=4 'test\/\*\.test\.mjs'/);
 for(const gate of ['client-host-owner-w74','client-host-owner-w75','client-c2-worker-edit-w80','client-current-native-acl-w72'])
  assert.ok(fs.existsSync(root+'.github/workflows/'+gate+'.yml'));
 assert.match(read('.github/workflows/client-source-candidate-w59.yml'),/client-critical-closure\.manifest\.json/);
 const acl=read('.github/workflows/client-current-native-acl-w72.yml');
 assert.match(acl,/^  push:/m);assert.match(acl,/^  pull_request:/m);
 assert.match(acl,/work\/metaengine-critical-closure-20261015/);
 assert.match(read('.github/workflows/client-wave10-w62-source-r97.yml'),/client-critical-closure\.manifest\.json/);
 const selfUpdate=read('.github/workflows/metaengine-browser-self-update-e2e.yml');
 assert.match(selfUpdate,/if:.*github\.head_ref != 'work\/metaengine-critical-closure-20261015'/);
});
