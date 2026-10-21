import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import { validateUpgradeArguments, makeUpgradeConfigs, assertKeeperIncarnation,
  assertUpgradeReceipt, assertPredecessorImageMatches, stableUpgradeRead, publishOwnerFile, classifyPredecessorBinding, predecessorReadPolicy,
  completeUpgradeFiles,commitUpgradeAdmission,assertPendingPublication } from '../scripts/qa-owner-runtime-upgrade.mjs';
import {QA_UPGRADE_ADMISSION_SCHEMA,qaUpgradeAdmissionFile,assertQaUpgradeAdmission} from '../src/local-provider-upgrade-admission.mjs';
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
  assert.throws(()=>validateUpgradeArguments(argv({...options,mode:'finalize','expected-receipt-sha256':digest})),/arguments_invalid/);
  assert.equal(validateUpgradeArguments(argv({...options,mode:'finalize','expected-receipt-sha256':digest,
    'expected-uninstaller-sha256':digest})).mode,'finalize');
  assert.throws(()=>validateUpgradeArguments(argv({...options,mode:'recover','expected-receipt-sha256':digest})),/arguments_invalid/);
  for(const presence of ['ABSENT','EMPTY']){
    const recover={...options,mode:'recover','expected-receipt-sha256':digest,'expected-current-nsis-sha256':digest,
      'expected-current-image-presence':presence,'expected-current-image-preimage-sha256':digest};
    assert.equal(validateUpgradeArguments(argv(recover))['expected-current-image-presence'],presence);
    assert.throws(()=>validateUpgradeArguments(argv({...recover,'expected-current-image-tree-sha256':digest})),/arguments_invalid/);
    assert.throws(()=>validateUpgradeArguments(argv({...recover,'expected-current-image-preimage-sha256':'invalid'})),/arguments_invalid/);
  }
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
  const receipt={schema:'metaengine.operator.qa-owner-runtime-upgrade.v3',state:'QUALIFIED_AND_STOPPED',provider_published:false,
    production_authorized:false,provenance_verified:false,authority_effect:false,historical_effects_reconciled:false,automatic_retry_allowed:false,
    source_head:source,package_version:version,asar_sha256:digest,old_owner_sha256:options['expected-owner-sha256'],
    candidate_resources:options['candidate-resources'],installed_resources:options['installed-resources'],
    bundle_sha256:digest,config_sha256:digest,old_config_sha256:digest,runtime:{exit_code:0,children_stopped:true},
    state_directory:stateDir,
    candidate_image:{schema:INSTALLED_TREE_SCHEMA,tree_sha256:'2'.repeat(64),file_count:36,total_bytes:123400},
    predecessor_nsis_snapshot:{schema:'metaengine.operator.qa-nsis-effects.v1',state:'SNAPSHOT_VERIFIED',classification:'OPERATOR_LOCAL_QA',
      snapshot_directory:path.join(stateDir,'predecessor-nsis'),snapshot_sha256:'3'.repeat(64),external_effects_sha256:'4'.repeat(64),
      production_authorized:false,owner_mutated:false,guardian_mutated:false,postgres_mutated:false,automatic_retry_allowed:false,authority_effect:false},
    predecessor_nsis_effects:{schema:NSIS_EFFECTS_SCHEMA,state:'OBSERVED',version:'0.7.0-dev.1107139874568.1',
      registry_entry_count:1,shortcut_count:2,shortcut_target_bound:true,desktop_shortcut_target_bound:true,uninstaller_present:true,
      registry_sha256:'4'.repeat(64),shortcut_sha256:'5'.repeat(64),desktop_shortcut_sha256:'6'.repeat(64),mutation:false,authority_effect:false},
    predecessor_snapshot:{schema:QA_IMAGE_SNAPSHOT_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456,
      source_unchanged:true,copied_tree_verified:true,installed_mutated:false,restore_authorized:false,
      production_authorized:false,authority_effect:false,image_directory:path.join(snapshotRoot,'image'),
      receipt_file:path.join(snapshotRoot,'snapshot-proof.json')},
    predecessor_image:{schema:INSTALLED_TREE_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456,
      asar_sha256:'d'.repeat(64),executable_sha256:'f'.repeat(64),bundle_sha256:'e'.repeat(64),source_head:source,package_version:'0.7.0-dev.1107139874568.1',
      owner_binding:{state:'OWNER_BOUND',owner_bundle_sha256:'e'.repeat(64),restore_admits_runtime:false,authority_effect:false}}};
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
  assert.throws(()=>assertUpgradeReceipt({...receipt,schema:'metaengine.operator.qa-owner-runtime-upgrade.v1'},options),/receipt_unverified/);
  for(const change of [{candidate_image:null},{candidate_image:{...receipt.candidate_image,tree_sha256:'bad'}},
    {predecessor_nsis_snapshot:{...receipt.predecessor_nsis_snapshot,production_authorized:true}},
    {predecessor_nsis_snapshot:{...receipt.predecessor_nsis_snapshot,snapshot_directory:stateDir}}]){
    assert.throws(()=>assertUpgradeReceipt({...receipt,...change},options),/receipt_unverified/);
  }
  const recoveryOptions={...options,'predecessor-binding':'preserve-fenced',
    'expected-predecessor-asar-sha256':receipt.predecessor_image.asar_sha256,
    'expected-predecessor-bundle-sha256':receipt.predecessor_image.bundle_sha256};
  const fencedReceipt={...receipt,predecessor_image:{...receipt.predecessor_image,
    owner_binding:{state:'OWNER_DIGEST_MISMATCH_FENCED',owner_bundle_sha256:'f'.repeat(64),
      restore_admits_runtime:false,authority_effect:false}}};
  assert.equal(assertUpgradeReceipt(fencedReceipt,recoveryOptions),true);
  assert.throws(()=>assertUpgradeReceipt(fencedReceipt,options),/receipt_unverified/);
  assert.throws(()=>assertUpgradeReceipt(receipt,recoveryOptions),/receipt_unverified/);
  for(const change of [{restore_admits_runtime:true},{authority_effect:true},{state:'OWNER_BOUND'},
    {owner_bundle_sha256:'invalid'},{unexpected:'field'}]) {
    assert.throws(()=>assertUpgradeReceipt({...fencedReceipt,predecessor_image:{...fencedReceipt.predecessor_image,
      owner_binding:{...fencedReceipt.predecessor_image.owner_binding,...change}}},recoveryOptions),/receipt_unverified/);
  }
  assert.throws(()=>assertUpgradeReceipt(fencedReceipt,{...recoveryOptions,
    'expected-predecessor-asar-sha256':'9'.repeat(64)}),/receipt_unverified/);
});

test('Owner-only rollback requires exact restored predecessor ASAR, source and runtime digest',()=>{
  const old={asar_sha256:'a'.repeat(64),executable_sha256:'d'.repeat(64),bundle_sha256:'b'.repeat(64),
    source_head:'c'.repeat(40),package_version:'0.7.0-dev.1107139874568.1',
    schema:INSTALLED_TREE_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456,
    owner_binding:{state:'OWNER_BOUND',owner_bundle_sha256:'b'.repeat(64),restore_admits_runtime:false,authority_effect:false}};
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
test('fenced predecessor capture requires explicit ASAR and runtime preimage pins',()=>{
  const recovery={...options,'predecessor-binding':'preserve-fenced',
    'expected-predecessor-asar-sha256':'d'.repeat(64),'expected-predecessor-bundle-sha256':'e'.repeat(64)};
  const policy=predecessorReadPolicy(recovery);
  assert.deepEqual(validateUpgradeArguments(argv(recovery)),recovery);
  assert.deepEqual(policy,{mode:'preserve-fenced',asar_sha256:'d'.repeat(64),bundle_sha256:'e'.repeat(64)});
  for(const key of ['predecessor-binding','expected-predecessor-asar-sha256','expected-predecessor-bundle-sha256']) {
    const incomplete={...recovery};delete incomplete[key];
    assert.throws(()=>validateUpgradeArguments(argv(incomplete)),/predecessor_recovery_pins_required/);
  }
  for(const change of [{'predecessor-binding':'auto'},{'expected-predecessor-asar-sha256':'invalid'},
    {'expected-predecessor-bundle-sha256':'invalid'}]) {
    assert.throws(()=>validateUpgradeArguments(argv({...recovery,...change})),/predecessor_recovery_pins_required/);
  }
  assert.deepEqual(predecessorReadPolicy(options),{mode:'owner-bound'});
});

test('preserve-fenced capture classifies exact broken bytes without admitting a runtime',()=>{
  const image={asar_sha256:'a'.repeat(64),bundle_sha256:'b'.repeat(64)},ownerDigest='c'.repeat(64);
  assert.throws(()=>classifyPredecessorBinding(image,ownerDigest),/predecessor_owner_package_mismatch/);
  const policy={mode:'preserve-fenced',asar_sha256:image.asar_sha256,bundle_sha256:image.bundle_sha256};
  const binding=classifyPredecessorBinding(image,ownerDigest,policy);
  assert.deepEqual(binding,{state:'OWNER_DIGEST_MISMATCH_FENCED',owner_bundle_sha256:ownerDigest,
    restore_admits_runtime:false,authority_effect:false});
  assert.equal(Object.isFrozen(binding),true);
  for(const change of [{asar_sha256:'d'.repeat(64)},{bundle_sha256:'e'.repeat(64)}])
    assert.throws(()=>classifyPredecessorBinding({...image,...change},ownerDigest,policy),/predecessor_recovery_preimage_changed/);
  assert.throws(()=>classifyPredecessorBinding(image,image.bundle_sha256,policy),/predecessor_recovery_not_fenced/);
  for(const malformed of [{mode:'auto'}, {...policy,authority_effect:true},{mode:'preserve-fenced'},
    {mode:'owner-bound',allow_mismatch:true}])
    assert.throws(()=>classifyPredecessorBinding(image,ownerDigest,malformed),/predecessor_recovery_policy_invalid/);
  assert.throws(()=>classifyPredecessorBinding(image,'invalid',policy),/predecessor_owner_pin_invalid/);
});

test('rollback compares the original Owner mismatch and cannot promote a fenced snapshot',()=>{
  const image={asar_sha256:'a'.repeat(64),executable_sha256:'d'.repeat(64),bundle_sha256:'b'.repeat(64),
    source_head:'c'.repeat(40),package_version:'0.7.0-dev.1107139874568.1',
    schema:INSTALLED_TREE_SCHEMA,tree_sha256:'1'.repeat(64),file_count:37,total_bytes:123456};
  const policy={mode:'preserve-fenced',asar_sha256:image.asar_sha256,bundle_sha256:image.bundle_sha256};
  const captured={...image,owner_binding:classifyPredecessorBinding(image,'e'.repeat(64),policy)};
  assert.equal(assertPredecessorImageMatches(captured,{...captured}),true);
  for(const owner_binding of [undefined, {...captured.owner_binding,state:'OWNER_BOUND'},
    {...captured.owner_binding,owner_bundle_sha256:'f'.repeat(64)}, {...captured.owner_binding,restore_admits_runtime:true},
    {...captured.owner_binding,authority_effect:true}]) {
    assert.throws(()=>assertPredecessorImageMatches(captured,{...captured,owner_binding}),/predecessor_image_not_restored/);
  }
});

const hash=b=>createHash('sha256').update(b).digest('hex');
async function completionFixture(t){
  const f=await fixture(t),root=path.dirname(f.ownerFile);await fs.writeFile(f.ownerFile,f.nextBytes);
  const gateFile=path.join(root,'upgrade-gate.json'),gateBytes=Buffer.from('{"nonce":"specific-attempt"}\n');
  await fs.writeFile(gateFile,gateBytes);
  return {ownerFile:f.ownerFile,gateFile,terminalFile:path.join(root,'installed.json'),retiredGateFile:path.join(root,'retired-gate.json'),
    expectedOwnerSha256:hash(f.nextBytes),expectedGateSha256:hash(gateBytes),receipt:{state:'INSTALLED_VERIFIED',production_authorized:false}};
}
test('completion durably records exact image before gate retirement and cannot replay',async t=>{
  const f=await completionFixture(t);let retired=false;
  const result=await completeUpgradeFiles(f,{verify:async()=>{
    try{await fs.stat(f.gateFile);}catch{retired=true;
      assert.equal(JSON.parse(await fs.readFile(f.terminalFile,'utf8')).launch_allowed,false);}
  }});
  assert.equal(retired,true);assert.equal(result.launch_allowed,false);assert.equal(result.admission_commit_required,true);assert.equal(result.production_authorized,false);
  await assert.rejects(fs.stat(f.gateFile),{code:'ENOENT'});
  assert.equal(hash(await fs.readFile(f.retiredGateFile)),f.expectedGateSha256);
  await assert.rejects(completeUpgradeFiles(f),/existing_attempt_requires_readback/);
});
test('Owner or gate drift prevents completion without clobbering concurrent bytes',async t=>{
  for(const key of ['ownerFile','gateFile']){
    await t.test(key,async t=>{
      const f=await completionFixture(t),other=Buffer.from('concurrent operator');let calls=0;
      await assert.rejects(completeUpgradeFiles(f,{verify:async()=>{if(++calls===1)await fs.writeFile(f[key],other);}}),/publication_cas_changed/);
      assert.deepEqual(await fs.readFile(f[key]),other);
      assert.equal((await fs.stat(f.gateFile)).isFile(),true);
      await assert.rejects(fs.stat(f.retiredGateFile),{code:'ENOENT'});
      assert.equal(JSON.parse(await fs.readFile(f.terminalFile,'utf8')).launch_allowed,false);
    });
  }
});

async function admissionFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-admission-commit-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'client-state-qa-upgrade-11111111-2222-4333-8444-555555555555');await fs.mkdir(state);
  const owner={schema:'metaengine.browser.local-state-provider-config.v1',version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',
    provider:'LOCAL_POSTGRES',base_url:'http://127.0.0.1:55434/a2-browser-native-supervisor-v1',authority_effect:false,
    runtime_identity_file:path.join(state,'runtime-instance.json'),runtime_host:{bundle_directory:path.join(root,'resources','client-state-runtime'),
      expected_bundle_sha256:digest,config_file:path.join(state,'installed-runtime-config.json')}};
  const ownerBytes=Buffer.from(JSON.stringify(owner)+'\n'),ownerFile=path.join(root,'owner.json'),completionFile=path.join(root,'completed.json');
  await fs.writeFile(ownerFile,ownerBytes);
  const completed={state:'INSTALLED_VERIFIED',installed_payload_verified:true,launch_allowed:false,gate_retired:true,admission_commit_required:true,
    owner_sha256:hash(ownerBytes),bundle_sha256:digest,source_head:source,package_version:version,installed_asar_sha256:'c'.repeat(64),
    installed_image:{installed_tree_sha256:'d'.repeat(64)},production_authorized:false,authority_effect:false};
  const completedBytes=Buffer.from(JSON.stringify(completed)+'\n');await fs.writeFile(completionFile,completedBytes);
  const admission={schema:QA_UPGRADE_ADMISSION_SCHEMA,state:'INSTALLED_VERIFIED',owner_sha256:hash(ownerBytes),bundle_sha256:digest,
    proof_sha256:'e'.repeat(64),completed_receipt_sha256:hash(completedBytes),source_head:source,package_version:version,
    installed_asar_sha256:'c'.repeat(64),installed_tree_sha256:'d'.repeat(64),publication_gate_sha256:'f'.repeat(64),
    launch_allowed:true,gate_retired:true,production_authorized:false,provenance_verified:false,automatic_retry_allowed:false,authority_effect:false};
  return {owner,ownerBytes,ownerFile,completionFile,gateFile:ownerFile+'.qa-upgrade-gate.json',admission,markerFile:qaUpgradeAdmissionFile(owner)};
}

test('admission is committed only after private staging and the last physical verification',async t=>{
  const f=await admissionFixture(t);let verifications=0,protectedStage=false;
  const result=await commitUpgradeAdmission(f,{verify:async()=>{
    verifications++;await assert.rejects(fs.stat(f.markerFile),{code:'ENOENT'});
    assert.equal(JSON.parse(await fs.readFile(f.completionFile,'utf8')).launch_allowed,false);
    if(verifications===2)assert.equal(protectedStage,true);
  },protect:async file=>{assert.equal(path.dirname(file),path.dirname(f.markerFile));assert.match(file,/installed-owner-admission\.json\..+\.tmp$/);protectedStage=true;}});
  assert.equal(verifications,2);assert.equal(result.launch_allowed,true);
  const bytes=await fs.readFile(result.admission_file);assert.equal(hash(bytes),result.admission_sha256);
  assert.equal(assertQaUpgradeAdmission(JSON.parse(bytes),{owner:f.owner,ownerBytes:f.ownerBytes}),true);
  await assert.rejects(commitUpgradeAdmission(f),/existing_attempt_requires_readback/);
});

test('a failure before the last admission rename leaves the QA runtime blocked',async t=>{
  for(const failure of ['LAST_VERIFY','ACL','OWNER_CAS','COMPLETION_CAS','GATE_RETURNED'])await t.test(failure,async t=>{
    const f=await admissionFixture(t);let calls=0;
    await assert.rejects(commitUpgradeAdmission(f,{verify:async()=>{
      if(++calls===2&&failure==='LAST_VERIFY')throw Error('injected_last_verify');
    },protect:async()=>{
      if(failure==='ACL')throw Error('injected_acl');
      if(failure==='OWNER_CAS')await fs.appendFile(f.ownerFile,' ');
      if(failure==='COMPLETION_CAS')await fs.appendFile(f.completionFile,' ');
      if(failure==='GATE_RETURNED')await fs.writeFile(f.gateFile,'concurrent pending gate');
    }}));
    await assert.rejects(fs.stat(f.markerFile),{code:'ENOENT'});
    assert.equal(JSON.parse(await fs.readFile(f.completionFile,'utf8')).launch_allowed,false);
  });
});
test('publication admission binds the exact private proof, Owner, gate and false authority',()=>{
  const ownerFile=path.resolve(os.tmpdir(),'test-owner.json'),proof={old_owner_sha256:digest,backup_owner_file:path.resolve(os.tmpdir(),'backup.json')};
  const j={schema:'metaengine.operator.qa-owner-runtime-upgrade.v3',state:'PUBLISHED_INSTALL_PENDING',provider_published:true,
    proof_sha256:digest,old_owner_sha256:digest,new_owner_sha256:'d'.repeat(64),publication_gate_sha256:'e'.repeat(64),
    owner_file:ownerFile,publication_gate:ownerFile+'.qa-upgrade-gate.json',backup_owner_file:proof.backup_owner_file,
    production_authorized:false,historical_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false};
  assert.equal(assertPendingPublication(j,proof,digest,ownerFile),true);
  for(const change of [{state:'INSTALLED_VERIFIED'},{proof_sha256:'f'.repeat(64)},{publication_gate_sha256:'bad'},
    {publication_gate:ownerFile+'.other'},{owner_file:ownerFile+'.other'},{provider_published:false},{authority_effect:true}]){
    assert.throws(()=>assertPendingPublication({...j,...change},proof,digest,ownerFile),/publication_receipt_invalid/);
  }
});
