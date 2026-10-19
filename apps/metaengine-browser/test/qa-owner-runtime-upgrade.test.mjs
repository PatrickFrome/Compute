import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateUpgradeArguments, makeUpgradeConfigs, assertKeeperIncarnation,
  assertUpgradeReceipt, assertPredecessorImageMatches, stableUpgradeRead, publishOwnerFile } from '../scripts/qa-owner-runtime-upgrade.mjs';
import { INSTALLED_TREE_SCHEMA } from '../scripts/qa-installed-tree-fingerprint.mjs';
import { QA_IMAGE_SNAPSHOT_SCHEMA } from '../scripts/qa-installed-image-snapshot.mjs';
import { NSIS_EFFECTS_SCHEMA } from '../scripts/qa-nsis-external-effects.mjs';

const digest='a'.repeat(64),source='b'.repeat(40),version='0.7.0-dev.202610190001.1';
const options={mode:'prepare','candidate-resources':path.resolve(os.tmpdir(),'qa-candidate','resources'),
  'installed-resources':path.resolve(os.tmpdir(),'qa-installed','resources'),
  'expected-version':version,'expected-source':source,'expected-asar-sha256':digest,
  'expected-owner-sha256':'c'.repeat(64),receipt:path.resolve(os.tmpdir(),'qa-proof.json')};
const argv=x=>Object.entries(x).flatMap(([k,v])=>['--'+k,v]);

test('QA upgrade requires explicit mode, immutable package and predecessor identities',()=>{
  assert.deepEqual(validateUpgradeArguments(argv(options)),options);
  for(const [key,value] of [['mode','auto'],['expected-source','main'],['expected-asar-sha256','hash'],
    ['expected-owner-sha256',''],['receipt','relative.json'],['candidate-resources','relative'],['expected-version','latest']]) {
    assert.throws(()=>validateUpgradeArguments(argv({...options,[key]:value})),/arguments_invalid/);
  }
  assert.throws(()=>validateUpgradeArguments([...argv(options),'--mode','publish']),/arguments_invalid/);
  assert.throws(()=>validateUpgradeArguments([...argv(options),'--execute','anything']),/arguments_invalid/);
  for (const root of [options['candidate-resources'],options['installed-resources']]) {
    assert.throws(()=>validateUpgradeArguments(argv({...options,receipt:path.join(root,'private-owner-receipt.json')})),
      /arguments_invalid/,'receipt must not be placed under mutable executable resources');
  }
  assert.throws(()=>validateUpgradeArguments(argv({...options,mode:'publish'})),/arguments_invalid/);
  assert.throws(()=>validateUpgradeArguments(argv({...options,mode:'rollback'})),/arguments_invalid/);
  assert.equal(validateUpgradeArguments(argv({...options,mode:'publish','expected-receipt-sha256':digest})).mode,'publish');
});

test('qualification and final configs preserve database credentials, cluster, ports and lifecycle',()=>{
  const root=path.resolve(os.tmpdir(),'qa-upgrade-config-fixture');
  const old={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(root,'old-bundle'),
    expected_bundle_sha256:'d'.repeat(64),state_directory:path.join(root,'old-state'),pg_data_directory:path.join(root,'keeper-data'),
    database_url:'postgresql://qa_api:dummy_api@127.0.0.1:55432/qa_fixture',
    inspect_database_url:'postgresql://qa_inspect:dummy_inspect@127.0.0.1:55432/qa_fixture',
    api_port:55433,edge_port:55434,startup_timeout_ms:120000,postgres_mode:'attached',api_role_mode:'direct',
    expected_cluster_system_identifier:'1234567890123456789'};
  const params={stateDirectory:path.join(root,'new-state'),candidateBundle:path.join(root,'staged-bundle'),
    installedBundle:path.join(root,'installed-bundle'),bundleDigest:digest};
  const configs=makeUpgradeConfigs(old,params);
  for(const c of Object.values(configs)) {
    assert.equal(c.database_url,old.database_url);assert.equal(c.inspect_database_url,old.inspect_database_url);
    assert.equal(c.pg_data_directory,old.pg_data_directory);assert.equal(c.expected_cluster_system_identifier,old.expected_cluster_system_identifier);
    assert.equal(c.postgres_mode,'attached');assert.equal(c.api_role_mode,'direct');
    assert.equal(c.expected_bundle_sha256,digest);assert.equal(c.state_directory,params.stateDirectory);
  }
  assert.equal(configs.final.bundle_directory,params.installedBundle);
  assert.equal(configs.qualification.bundle_directory,params.candidateBundle);
  assert.throws(()=>makeUpgradeConfigs({...old,postgres_mode:'owned'},params),/attached_configuration_required/);
  assert.throws(()=>makeUpgradeConfigs(old,{...params,stateDirectory:old.pg_data_directory}),/private_state_boundary_invalid/);
});

test('kernel identity rejects recycled PG PID, path changes and unavailable observations',()=>{
  const expected={pid:8056,created_at:'2026-10-18T19:58:18.063Z',exe_path:path.resolve(os.tmpdir(),'postgres.exe')};
  const actual={...expected,state:'PRESENT',source:'OS_PROCESS_INVENTORY',authority_effect:false};
  assert.equal(assertKeeperIncarnation(actual,expected),true);
  for(const change of [{created_at:'2026-10-19T00:00:00.000Z'},{exe_path:path.resolve(os.tmpdir(),'foreign.exe')},
    {state:'NOT_RUNNING'},{source:'FIXTURE'},{authority_effect:true},{pid:8057}]) {
    assert.throws(()=>assertKeeperIncarnation({...actual,...change},expected),/keeper_incarnation_changed/);
  }
  assert.throws(()=>assertKeeperIncarnation(null,expected),/keeper_incarnation_changed/);
});

test('unsigned QA proof cannot gain production authority or replay a publication',()=>{
  const stateDir=path.resolve(os.tmpdir(),'qa-recovery-test-state');
  const snapshotRoot=path.join(stateDir,'predecessor-image-snapshot');
  const receipt={schema:'metaengine.operator.qa-owner-runtime-upgrade.v1',state:'QUALIFIED_AND_STOPPED',provider_published:false,
    production_authorized:false,provenance_verified:false,authority_effect:false,historical_effects_reconciled:false,automatic_retry_allowed:false,
    source_head:source,package_version:version,asar_sha256:digest,old_owner_sha256:options['expected-owner-sha256'],
    candidate_resources:options['candidate-resources'],installed_resources:options['installed-resources'],
    bundle_sha256:digest,config_sha256:digest,old_config_sha256:digest,runtime:{exit_code:0,children_stopped:true},
    state_directory:stateDir,
    predecessor_nsis_effects:{schema:NSIS_EFFECTS_SCHEMA,state:'OBSERVED',version:'0.7.0-dev.1107139874568.1',
      registry_entry_count:1,shortcut_count:2,shortcut_target_bound:true,desktop_shortcut_target_bound:true,uninstaller_present:true,
      registry_sha256:'4'.repeat(64),shortcut_sha256:'5'.repeat(64),desktop_shortcut_sha256:'6'.repeat(64),mutation:false,authority_effect:false},
    predecessor_snapshot:{schema:QA_IMAGE_SNAPSHOT_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456,
      source_unchanged:true,copied_tree_verified:true,installed_mutated:false,restore_authorized:false,
      production_authorized:false,authority_effect:false,image_directory:path.join(snapshotRoot,'image'),
      receipt_file:path.join(snapshotRoot,'snapshot-proof.json')},
    predecessor_image:{schema:INSTALLED_TREE_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456,
      asar_sha256:'d'.repeat(64),executable_sha256:'f'.repeat(64),bundle_sha256:'e'.repeat(64),source_head:source,package_version:'0.7.0-dev.1107139874568.1'}};
  assert.equal(assertUpgradeReceipt(receipt,options),true);
  for(const [key,value] of [['production_authorized',true],['provenance_verified',true],['provider_published',true],
    ['state','PUBLISHED_INSTALL_PENDING'],['old_owner_sha256','d'.repeat(64)],['source_head','e'.repeat(40)],
    ['historical_effects_reconciled',true],['automatic_retry_allowed',true],['authority_effect',true]]) {
    assert.throws(()=>assertUpgradeReceipt({...receipt,[key]:value},options),/receipt_unverified/);
  }
  assert.throws(()=>assertUpgradeReceipt({...receipt,runtime:{exit_code:1,children_stopped:true}},options),/receipt_unverified/);
  assert.throws(()=>assertUpgradeReceipt({...receipt,predecessor_image:null},options),/receipt_unverified/);
  for(const change of [{tree_sha256:'e'.repeat(64)},{file_count:38},{restore_authorized:true},
    {copied_tree_verified:false},{image_directory:options['installed-resources']}]) {
    assert.throws(()=>assertUpgradeReceipt({...receipt,predecessor_snapshot:{...receipt.predecessor_snapshot,...change}},options),/receipt_unverified/);
  }
  assert.throws(()=>assertUpgradeReceipt({...receipt,predecessor_snapshot:null},options),/receipt_unverified/);
  for(const change of [{version:'0.7.0-dev.1107139874574.1'},{registry_entry_count:2},
    {shortcut_count:1},{shortcut_target_bound:false},{desktop_shortcut_target_bound:false},
    {desktop_shortcut_sha256:undefined},{desktop_shortcut_sha256:'bad'},{registry_sha256:'bad'},{authority_effect:true}]){
    assert.throws(()=>assertUpgradeReceipt({...receipt,
      predecessor_nsis_effects:{...receipt.predecessor_nsis_effects,...change}},options),/receipt_unverified/);
  }
  assert.throws(()=>assertUpgradeReceipt({...receipt,predecessor_nsis_effects:null},options),/receipt_unverified/);
  assert.throws(()=>assertUpgradeReceipt({...receipt,predecessor_image:{...receipt.predecessor_image,asar_sha256:'bad'}},options),/receipt_unverified/);
});

test('Owner-only rollback requires exact restored predecessor ASAR, source and runtime digest',()=>{
  const old={asar_sha256:'a'.repeat(64),executable_sha256:'d'.repeat(64),bundle_sha256:'b'.repeat(64),
    source_head:'c'.repeat(40),package_version:'0.7.0-dev.1107139874568.1',
    schema:INSTALLED_TREE_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456};
  assert.equal(assertPredecessorImageMatches(old,{...old}),true);
  for(const change of [
    {asar_sha256:'e'.repeat(64)}, // NSIS replaced ASAR
    {executable_sha256:'e'.repeat(64)}, // NSIS replaced the Electron executable
    {bundle_sha256:'e'.repeat(64)}, // runtime no longer matches Owner
    {source_head:'f'.repeat(40)}, // unexpected historical builder
    {package_version:'0.7.0-dev.1107139874571.1'},
    {asar_sha256:'invalid'}, // UNKNOWN must never become PASS
    {tree_sha256:'2'.repeat(64)}, // package files changed beyond EXE/ASAR/runtime
    {file_count:38}, // added/removed files cannot pass
    {total_bytes:123457}, // even before digest, inventory mismatch must fail
    {schema:'untrusted-snapshot'}, // unreviewed inventory cannot authorize rollback
  ]) assert.throws(()=>assertPredecessorImageMatches(old,{...old,...change}),
    /predecessor_image_not_restored/);
  assert.throws(()=>assertPredecessorImageMatches(old,null),/predecessor_image_not_restored/);
  assert.throws(()=>assertPredecessorImageMatches({},old),/predecessor_image_not_restored/);
});

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-owner-cas-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files={ownerFile:path.join(root,'owner.json'),stagedFile:path.join(root,'staged.json'),rollbackFile:path.join(root,'rollback.json'),
    oldBytes:Buffer.from('{"generation":1}\n'),nextBytes:Buffer.from('{"generation":2}\n')};
  await fs.writeFile(files.ownerFile,files.oldBytes);await fs.writeFile(files.stagedFile,files.nextBytes);
  return files;
}
test('atomic publication publishes exact bytes and refuses duplicate or stale predecessor',async t=>{
  const files=await fixture(t);let count=0;
  const receipt=await publishOwnerFile(files,{verifyPublished:async()=>{count++;}});
  assert.equal(receipt.state,'PUBLISHED_INSTALL_PENDING');assert.equal(count,1);
  assert.deepEqual(await fs.readFile(files.ownerFile),files.nextBytes);
  await assert.rejects(publishOwnerFile(files),/owner_cas_mismatch/);
  assert.deepEqual(await fs.readFile(files.ownerFile),files.nextBytes);
});
test('failure after publication restores original bytes when the exact new descriptor remains',async t=>{
  const files=await fixture(t);
  await assert.rejects(publishOwnerFile(files,{verifyPublished:async()=>{throw Error('keeper_changed');}}),error=>{
    assert.equal(error.message,'keeper_changed');assert.equal(error.rollbackConfirmed,true);return true;
  });
  assert.deepEqual(await fs.readFile(files.ownerFile),files.oldBytes);
});
test('rollback never clobbers a concurrent descriptor after a failed final check',async t=>{
  const files=await fixture(t), other=Buffer.from('{"generation":"other-operator"}\n');
  await assert.rejects(publishOwnerFile(files,{verifyPublished:async()=>{
    await fs.writeFile(files.ownerFile,other);throw Error('check_failed');
  }}),/publication_effect_unknown/);
  assert.deepEqual(await fs.readFile(files.ownerFile),other);
  await assert.rejects(fs.stat(files.rollbackFile),{code:'ENOENT'});
});
test('private reads and publication reject hard-link aliases and staged byte changes',async t=>{
  const files=await fixture(t),alias=path.join(path.dirname(files.ownerFile),'alias.json');
  await fs.link(files.ownerFile,alias);
  await assert.rejects(stableUpgradeRead(files.ownerFile),/path_not_regular/);
  await fs.unlink(alias);await fs.writeFile(files.stagedFile,'changed');
  await assert.rejects(publishOwnerFile(files),/owner_stage_mismatch/);
  assert.deepEqual(await fs.readFile(files.ownerFile),files.oldBytes);
});
