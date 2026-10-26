import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {assertManualForwardHostedEnvironment,assertManualForwardContinuity,
  assertManualForwardOwnerReadback,AUTOMATIC_FORWARD_REMAINS} from '../scripts/qa-forward-install-physical.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hosted={GITHUB_ACTIONS:'true',CI:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Windows',
  GITHUB_REPOSITORY:'PatrickFrome/Compute',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'1234',GITHUB_RUN_ATTEMPT:'1',
  APPDATA:'C:\\Users\\runneradmin\\AppData\\Roaming',LOCALAPPDATA:'C:\\Users\\runneradmin\\AppData\\Local',
  RUNNER_TEMP:'D:\\a\\_temp',SystemRoot:'C:\\Windows'};
test('physical composition requires a disposable hosted Windows runner before effects',()=>{
  assert.equal(assertManualForwardHostedEnvironment({platform:'win32',env:hosted}),true);
  for(const [platform,patch] of [['linux',{}],['win32',{RUNNER_ENVIRONMENT:'self-hosted'}],
    ['win32',{GITHUB_ACTIONS:'false'}],['win32',{CI:'false'}],['win32',{GITHUB_REPOSITORY:'someone/else'}],
    ['win32',{GITHUB_SHA:'main'}],['win32',{GITHUB_RUN_ATTEMPT:''}],['win32',{APPDATA:'\\\\server\\profile'}]])
    assert.throws(()=>assertManualForwardHostedEnvironment({platform,env:{...hosted,...patch}}),/manual_forward_/);
});
const continuity=()=>({cluster_system_identifier:'123456789',pg_data_directory:path.join(os.tmpdir(),'manual-forward-pgdata'),
  postmaster_pid:1200,postmaster_created_at:'2026-10-27T01:00:00.000Z',postmaster_started_at:'2026-10-27T01:00:01.000Z',
  postmaster_pidfile_sha256:'a'.repeat(64),sentinel_count:3,sentinel_sha256:'b'.repeat(64),vault_sha256:'c'.repeat(64),runtime_tree_sha256:'d'.repeat(64)});
test('same cluster and data do not excuse an unplanned keeper replacement',()=>{
  const before=continuity();assert.equal(assertManualForwardContinuity(before,{...before}),true);
  for(const patch of [{postmaster_pid:1201},{postmaster_created_at:'2026-10-27T01:00:01.000Z'},
    {postmaster_started_at:'2026-10-27T01:00:02.000Z'},{postmaster_pidfile_sha256:'e'.repeat(64)}])
    assert.throws(()=>assertManualForwardContinuity(before,{...before,...patch}),/keeper_incarnation_changed/);
});
test('restart requires both a new native incarnation and a new SQL postmaster start',()=>{
  const before=continuity();
  const after={...before,postmaster_pid:1300,postmaster_created_at:'2026-10-27T01:01:00.000Z',
    postmaster_started_at:'2026-10-27T01:01:01.000Z',postmaster_pidfile_sha256:'e'.repeat(64)};
  assert.equal(assertManualForwardContinuity(before,after,{restart:true}),true);
  assert.throws(()=>assertManualForwardContinuity(before,before,{restart:true}),/restart_unproven/);
  assert.throws(()=>assertManualForwardContinuity(before,{...after,postmaster_started_at:before.postmaster_started_at},{restart:true}),/restart_unproven/);
  assert.throws(()=>assertManualForwardContinuity(before,{...after,postmaster_pid:before.postmaster_pid,postmaster_created_at:before.postmaster_created_at},{restart:true}),/restart_unproven/);
});
for(const [key,value] of [['cluster_system_identifier','999'],['pg_data_directory',path.join(os.tmpdir(),'other-pgdata')],
  ['sentinel_sha256','e'.repeat(64)],['vault_sha256','f'.repeat(64)],['runtime_tree_sha256','0'.repeat(64)]]) {
  test('continuity rejects changed '+key+' even when the postmaster is alive',()=>{
    const before=continuity();assert.throws(()=>assertManualForwardContinuity(before,{...before,[key]:value}),/manual_forward_/);
  });
}
test('unknown identity or missing sentinel rows cannot be normalized to a pass',()=>{
  const before=continuity();
  for(const patch of [{postmaster_pid:null},{postmaster_created_at:'unknown'},{postmaster_started_at:null},
    {sentinel_count:0},{sentinel_count:2},{sentinel_sha256:null},{vault_sha256:null},{runtime_tree_sha256:null}])
    assert.throws(()=>assertManualForwardContinuity(before,{...before,...patch}),/continuity_observation_incomplete/);
});

function ownerReadback() {
  const root=path.join(os.tmpdir(),'forward-owner-assertions'),installedRoot=path.join(root,'Programs','METAENGINE Browser Test');
  const stateDirectory=path.join(root,'METAENGINE','client-state-qa-upgrade-11111111-2222-4333-8444-555555555555');
  const oldState=path.join(root,'fixture','runtime-state');
  const previousOwner={schema:'metaengine.browser.local-state-provider-config.v1',version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
    base_url:'http://127.0.0.1:55434/a2-browser-native-supervisor-v1',runtime_identity_file:path.join(oldState,'runtime-instance.json'),authority_effect:false,
    runtime_host:{bundle_directory:path.join(installedRoot,'resources','client-state-runtime'),expected_bundle_sha256:'1'.repeat(64),config_file:path.join(oldState,'config.json')}};
  const previousConfig={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:previousOwner.runtime_host.bundle_directory,
    expected_bundle_sha256:'1'.repeat(64),state_directory:oldState,pg_data_directory:path.join(root,'fixture','pgdata'),
    database_url:'postgres://fixture_api:private@127.0.0.1:55432/postgres',inspect_database_url:'postgres://fixture_owner:private@127.0.0.1:55432/postgres',
    api_port:55433,edge_port:55434,startup_timeout_ms:120000,postgres_mode:'attached',api_role_mode:'direct',expected_cluster_system_identifier:'123456789'};
  const candidate={source_head:'a'.repeat(40),package_version:'0.7.0-dev.1900000000000.1',bundle_sha256:'2'.repeat(64),asar_sha256:'3'.repeat(64)};
  const owner={...previousOwner,runtime_identity_file:path.join(stateDirectory,'runtime-instance.json'),
    runtime_host:{bundle_directory:previousOwner.runtime_host.bundle_directory,expected_bundle_sha256:candidate.bundle_sha256,config_file:path.join(stateDirectory,'installed-runtime-config.json')}};
  const config={...previousConfig,state_directory:stateDirectory,expected_bundle_sha256:candidate.bundle_sha256};
  const ownerBytes=Buffer.from(JSON.stringify(owner)),completionBytes=Buffer.from('{"state":"COMPLETE"}');
  const proofSha256='4'.repeat(64),installedTreeSha256='5'.repeat(64);
  const admission={schema:'metaengine.operator.qa-owner-admission.v1',state:'INSTALLED_VERIFIED',owner_sha256:sha(ownerBytes),
    bundle_sha256:candidate.bundle_sha256,proof_sha256:proofSha256,completed_receipt_sha256:sha(completionBytes),
    source_head:candidate.source_head,package_version:candidate.package_version,installed_asar_sha256:candidate.asar_sha256,
    installed_tree_sha256:installedTreeSha256,publication_gate_sha256:'6'.repeat(64),launch_allowed:true,gate_retired:true,
    production_authorized:false,provenance_verified:false,automatic_retry_allowed:false,authority_effect:false};
  return {previousOwner,previousConfig,owner,config,status:{state:'STOPPED',children_stopped:true,runtime_ready:false,bundle_sha256:candidate.bundle_sha256},
    admission,ownerBytes,completionBytes,proofSha256,candidate,stateDirectory,installedRoot,installedTreeSha256};
}
test('Owner transition permits only runtime-generation changes while preserving database custody',()=>{
  const args=ownerReadback();assert.equal(assertManualForwardOwnerReadback(args),true);
  for(const patch of [{database_url:'postgres://other:private@127.0.0.1:55432/postgres'},
    {inspect_database_url:'postgres://other:private@127.0.0.1:55432/postgres'},
    {pg_data_directory:path.join(os.tmpdir(),'another-cluster')},{api_port:55435},{expected_cluster_system_identifier:'123456788'}])
    assert.throws(()=>assertManualForwardOwnerReadback({...args,config:{...args.config,...patch}}),/owner_or_config_transition_unbound/);
  assert.throws(()=>assertManualForwardOwnerReadback({...args,owner:{...args.owner,base_url:'http://127.0.0.1:55436/a2-browser-native-supervisor-v1'}}),/owner_or_config_transition_unbound/);
});
test('successful NSIS alone cannot qualify mismatched admission, completion or installed bytes',()=>{
  const args=ownerReadback();
  for(const patch of [{source_head:'b'.repeat(40)},{package_version:'0.7.0-dev.1900000000001.1'},
    {proof_sha256:'7'.repeat(64)},{completed_receipt_sha256:'8'.repeat(64)},{installed_tree_sha256:'9'.repeat(64)},
    {installed_asar_sha256:'0'.repeat(64)},{owner_sha256:'0'.repeat(64)},{launch_allowed:false}])
    assert.throws(()=>assertManualForwardOwnerReadback({...args,admission:{...args.admission,...patch}}),/unbound|unverified/);
  assert.throws(()=>assertManualForwardOwnerReadback({...args,status:{...args.status,state:'READY'}}),/unbound/);
  assert.throws(()=>assertManualForwardOwnerReadback({...args,completionBytes:Buffer.from('{}')}),/unbound/);
});
test('manual qualification retains an explicit unresolved automatic successor contract',()=>{
  assert(AUTOMATIC_FORWARD_REMAINS.includes('durable_successor_receipt_bound_to_the_same_update_transaction'));
  assert(AUTOMATIC_FORWARD_REMAINS.includes('restart_reconciliation_without_replaying_an_unknown_effect'));
  assert(Object.isFrozen(AUTOMATIC_FORWARD_REMAINS));
});
