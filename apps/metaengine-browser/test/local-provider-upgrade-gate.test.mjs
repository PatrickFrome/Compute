import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {QA_UPGRADE_ADMISSION_SCHEMA,qaUpgradeAdmissionFile,assertQaUpgradeAdmission} from '../src/local-provider-upgrade-admission.mjs';

const argv=process.argv;
process.argv=[...argv,'--metaengine-profile-probe'];
const {bootstrapPersistentLocalProvider}=await import('../src/local-state-provider-bootstrap.mjs');
process.argv=argv;

test('pending installer gate prevents Owner reads and network even with a forged READY environment',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-upgrade-gate-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ownerFile=path.join(root,'owner.json'),gate=ownerFile+'.qa-upgrade-gate.json';
  await fs.writeFile(ownerFile,'not JSON; must not be read');
  for(const directory of [false,true]) {
    if(directory)await fs.mkdir(gate);else await fs.writeFile(gate,'untrusted gate');
    const env={METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY',METAENGINE_SUPERVISOR_BASE_URL:'http://127.0.0.1:1/',
      METAENGINE_LOCAL_STATE_INSTANCE_ID:'forged',METAENGINE_FALLBACK_SUPERVISOR_BASE_URL:'https://example.invalid/'};
    let requests=0;
    await assert.rejects(bootstrapPersistentLocalProvider({ownerFile,env,fetchImpl:()=>{requests++;throw Error('network forbidden');}}),/upgrade_install_pending/);
    assert.equal(requests,0);assert.equal(env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'BLOCKED');
    assert.equal(env.METAENGINE_SUPERVISOR_BASE_URL,undefined);assert.equal(env.METAENGINE_LOCAL_STATE_INSTANCE_ID,undefined);
    assert.equal(env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL,undefined);
    if(directory)await fs.rmdir(gate);else await fs.unlink(gate);
  }
  const observed=await bootstrapPersistentLocalProvider({ownerFile:path.join(root,'missing-owner'),env:{}});
  assert.equal(observed.state,'NO_OWNER_CONFIG');
});

test('a retired gate cannot admit a QA Owner without its exact final commit marker',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-upgrade-admission-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'client-state-qa-upgrade-11111111-2222-4333-8444-555555555555');await fs.mkdir(state);
  const owner={schema:'metaengine.browser.local-state-provider-config.v1',version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
    base_url:'http://127.0.0.1:55434/a2-browser-native-supervisor-v1',authority_effect:false,runtime_identity_file:path.join(state,'runtime-instance.json'),
    runtime_host:{bundle_directory:path.join(root,'resources','client-state-runtime'),expected_bundle_sha256:'b'.repeat(64),config_file:path.join(state,'installed-runtime-config.json')}};
  const ownerFile=path.join(root,'owner.json'),ownerBytes=Buffer.from(JSON.stringify(owner)+'\n');await fs.writeFile(ownerFile,ownerBytes);
  const hash=x=>createHash('sha256').update(x).digest('hex'),markerFile=qaUpgradeAdmissionFile(owner);
  const marker={schema:QA_UPGRADE_ADMISSION_SCHEMA,state:'INSTALLED_VERIFIED',owner_sha256:hash(ownerBytes),bundle_sha256:'b'.repeat(64),
    proof_sha256:'c'.repeat(64),completed_receipt_sha256:'d'.repeat(64),installed_asar_sha256:'e'.repeat(64),installed_tree_sha256:'f'.repeat(64),
    publication_gate_sha256:'a'.repeat(64),source_head:'a'.repeat(40),package_version:'0.7.0-dev.1107139874588.1',
    launch_allowed:true,gate_retired:true,production_authorized:false,provenance_verified:false,automatic_retry_allowed:false,authority_effect:false};
  assert.equal(assertQaUpgradeAdmission(marker,{owner,ownerBytes}),true);
  for(const patch of [null,{owner_sha256:'a'.repeat(64)},{bundle_sha256:'a'.repeat(64)},{launch_allowed:false},
    {gate_retired:false},{authority_effect:true},{state:'PREPARED'},{completed_receipt_sha256:'invalid'}]){
    if(patch)await fs.writeFile(markerFile,JSON.stringify({...marker,...patch}));
    let requests=0;
    const env={METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY',METAENGINE_SUPERVISOR_BASE_URL:owner.base_url,
      METAENGINE_LOCAL_STATE_INSTANCE_ID:'forged',METAENGINE_FALLBACK_SUPERVISOR_BASE_URL:'https://example.invalid/'};
    await assert.rejects(bootstrapPersistentLocalProvider({ownerFile,env,fetchImpl:()=>{requests++;throw Error('network forbidden');}}),/upgrade_admission_unverified/);
    assert.equal(requests,0);assert.equal(env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'BLOCKED');
    assert.equal(env.METAENGINE_SUPERVISOR_BASE_URL,undefined);assert.equal(env.METAENGINE_LOCAL_STATE_INSTANCE_ID,undefined);
    assert.equal(env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL,undefined);
  }
  await fs.writeFile(markerFile,JSON.stringify(marker));await fs.appendFile(ownerFile,' ');
  await assert.rejects(bootstrapPersistentLocalProvider({ownerFile,env:{},fetchImpl:()=>{throw Error('network forbidden');}}),/upgrade_admission_unverified/);
  assert.equal(qaUpgradeAdmissionFile({...owner,runtime_identity_file:path.join(root,'ordinary-attached-state','runtime-instance.json'),
    runtime_host:{...owner.runtime_host,config_file:path.join(root,'ordinary-attached-state','runtime-config.json')}}),null);
  assert.throws(()=>qaUpgradeAdmissionFile({...owner,runtime_host:{...owner.runtime_host,config_file:path.join(root,'elsewhere','runtime-config.json')}}),/upgrade_admission_unverified/);
});
