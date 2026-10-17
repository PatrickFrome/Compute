import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const read=p=>fs.readFileSync(new URL(p,new URL('../../',import.meta.url)),'utf8');
const manifest=JSON.parse(read('coordination/operator-control/client-critical-closure.manifest.json'));

function assertCurrentSourceCandidate(candidate, observedVersion, parentVersion) {
 const fixed={
  classification:'SOURCE_ONLY_NO_CURRENT_PACKAGE',
  branch:'work/autonomous-development-fabric-v1-20261017',
  source_parent:'ea405d926568508eac53ebb408e941c94faeadcf',
  package_version:'0.7.0-dev.876000886467.1',
  historical_package_version:'0.7.0-dev.202610152359.1',
  package_build_authorized:false,
  package_version_reuse_authorized:false,
  prior_artifacts_qualify_current_source:false,
  ci_qualification:false,
  installed_qualification:'NOT_QUALIFIED',
  production_ready:false,
  installed_mutation_authorized:false,
  promotion_authorized:false,
  automatic_effect_retry_allowed:false,
  authority_effect:false,
 };
 assert.deepEqual(candidate,fixed,'current source identity and qualification boundary');
 assert.equal(observedVersion,candidate.package_version,'current package identity drift');
 assert.equal(parentVersion,candidate.package_version,'source parent package identity drift');
 assert.equal(candidate.historical_package_version,manifest.test_candidate.version);
 assert.notEqual(candidate.package_version,candidate.historical_package_version);
}

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
  assert.equal(c.branch,'work/client-operational-repair-20261015');
  assert.equal(c.version,'0.7.0-dev.202610152359.1');
  assert.equal(c.production_release_authorized,false);
  assert.equal(c.installed_mutation_authorized,false);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',c.source_parent,'HEAD']).status,0);
  if(!manifest.current_source_candidate)assert.equal(observed,c.version);
  assert.notEqual(c.version,historical);
 }else assert.equal(observed,historical);
 if(manifest.current_source_candidate){
  const c=manifest.current_source_candidate;
  const parentVersion=JSON.parse(git('show',c.source_parent+':apps/metaengine-browser/package.json')).version;
  assertCurrentSourceCandidate(c,observed,parentVersion);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',c.source_parent,'HEAD']).status,0,
    'current source parent must be a real Git ancestor');
 }
 if(manifest.source_followup){
  const f=manifest.source_followup;
  assert.equal(f.classification,'SOURCE_ONLY_NO_PACKAGE');
  assert.equal(f.package_build_authorized,false);
  assert.equal(f.installed_mutation_authorized,false);
  assert.equal(f.automatic_recovery_authorized,false);
  assert.match(f.source_parent,/^[a-f0-9]{40}$/);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',f.source_parent,'HEAD']).status,0);
  const predecessorVersion=JSON.parse(git('show',f.source_parent+':apps/metaengine-browser/package.json')).version;
  if(manifest.test_candidate){
   // A later distinct disposable physical candidate is allowed ONLY when the
   // original source-only version is burned, not silently rewritten/reused.
   assert.notEqual(observed,predecessorVersion);
   assert.ok(manifest.burned_versions.includes(predecessorVersion),'source-only parent package identity must be burned');
  }else assert.equal(observed,predecessorVersion);
 }
});

test('current source candidate rejects identity drift and qualification promotion',()=>{
 const candidate=manifest.current_source_candidate;
 assert.ok(candidate,'current source candidate is required on this source line');
 const observed=JSON.parse(read('apps/metaengine-browser/package.json')).version;
 const parentVersion=JSON.parse(git('show',candidate.source_parent+':apps/metaengine-browser/package.json')).version;
 assertCurrentSourceCandidate(candidate,observed,parentVersion);
 for(const change of [
  {classification:'ISOLATED_TEST_PACKAGE_ONLY'},
  {branch:'work/client-operational-repair-20261015'},
  {source_parent:manifest.test_candidate.source_parent},
  {package_version:manifest.test_candidate.version},
  {historical_package_version:observed},
  {package_build_authorized:true},{package_version_reuse_authorized:true},
  {prior_artifacts_qualify_current_source:true},{ci_qualification:true},
  {installed_qualification:'PASS'},{production_ready:true},
  {installed_mutation_authorized:true},{promotion_authorized:true},
  {automatic_effect_retry_allowed:true},{authority_effect:true},
  {unsigned_package_is_trusted:true},
 ])assert.throws(()=>assertCurrentSourceCandidate({...candidate,...change},observed,parentVersion),
   {code:'ERR_ASSERTION'},'must reject '+JSON.stringify(change));
 assert.throws(()=>assertCurrentSourceCandidate(candidate,manifest.test_candidate.version,parentVersion),
   {code:'ERR_ASSERTION'},'historical package bytes cannot qualify current source');
 assert.throws(()=>assertCurrentSourceCandidate(candidate,observed,manifest.test_candidate.version),
   {code:'ERR_ASSERTION'},'source parent package identity must match current source');
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
