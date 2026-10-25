import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPublicKey} from 'node:crypto';
import {SupervisorDeviceIdentity} from '../src/supervisor-device-identity.mjs';
import {createNativeCodingHostIssuer} from '../src/native-coding-host-issuer.mjs';
import {verifyNativeCodingProviderDescriptor,verifyNativeCodingJobProof} from '../src/native-coding-transport-proof.mjs';

// Test-only OS/PG/ACL observations. None of these fixtures claims installed or
// model execution evidence; actual integration must supply native readers.
const now=Date.parse('2026-10-22T04:00:00.000Z');
const iso=delta=>new Date(now+delta).toISOString();
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const hash=n=>String(n).repeat(64);
function processIdentity(pid,delta) {
  return {pid,created_at:iso(delta),process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(now+delta)*10000n+116444736000000000n}`};
}
async function fixture(t,{role='IMPLEMENTER',enrolled=true,mutate,signer}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-native-issuer-test-'));
  t.after(async()=>{
    const resolved=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());
    assert.ok(resolved.startsWith(parent+path.sep));
    assert.ok(path.basename(resolved).startsWith('metaengine-native-issuer-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const statePath=path.join(dir,'test-device.json');
  const identity=new SupervisorDeviceIdentity({statePath,secureStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(`TEST_ONLY:${value}`),decryptString:buffer=>buffer.toString().slice('TEST_ONLY:'.length)}});
  if (enrolled) {await identity.ensure();await identity.bindDevice(uuid(4));}
  const state=identity.snapshot();
  const artifact={installed_exe_sha256:hash('a'),installed_asar_sha256:hash('b'),runtime_bundle_sha256:hash('c'),source_sha:'d'.repeat(40),cli_executable_sha256:hash('e')};
  const postgres={system_identifier:'7521123456789012345',postmaster:processIdentity(8056,-240_000),data_directory_identity_sha256:hash('f')};
  const worktree={path:'C:\\METAENGINE\\managed-worktree',root_identity_sha256:hash('1'),base_sha:'2'.repeat(40)};
  const permit={schema:'metaengine.native-coding.operator-permit.v1',trust_namespace:'LOCAL_OPERATOR_QA',permit_id:uuid(2),goal_id:uuid(3),goal_sha256:hash('3'),
    owner_epoch:7,user_sid:'S-1-5-21-123-456-789-1001',device_id:uuid(4),device_key_fingerprint_sha256:state?.key_fingerprint_sha256 || hash('4'),
    workspace_id:uuid(5),project_id:uuid(6),provider_id:uuid(1),agent_id:role==='CRITIC'?'agent_native-critic00':'agent_native-implementer',role,
    agent_generation_epoch:4,physical_slot_budget:2,artifact,postgres,worktree,issued_at:iso(-3600_000),expires_at:iso(900_000),revoked:false,
    storage_evidence_sha256:hash('5'),record_sha256:hash('6')};
  const values={permit,artifact,host:{host_process:processIdentity(9101,-120_000),user_sid:permit.user_sid},
    pg:{postgres,workspace_id:permit.workspace_id,project_id:permit.project_id},worktree,
    sandbox:{backend:'CODEX_WINDOWS_ELEVATED',mode:role==='CRITIC'?'read-only':'workspace-write',evidence_sha256:hash('7'),outside_write_denied:true,worktree_write_denied:role==='CRITIC'},
    lease:{task_id:uuid(8),agent_id:permit.agent_id,lease_generation:9,agent_generation_epoch:4,role,workspace_id:permit.workspace_id,project_id:permit.project_id,
      provider_id:permit.provider_id,target_id:`codex-cli:${permit.provider_id}`,base_sha:worktree.base_sha,prompt_sha256:hash('9'),expires_at:iso(600_000),state:'LEASED',
      verification_subject:role==='CRITIC'?{run_id:uuid(10),result_sha256:hash('8'),git_artifact_sha256:hash('a'),source_head:worktree.base_sha}:null},
    worker:{run_id:uuid(7),worker_process:processIdentity(9102,-5000),job_id:uuid(9),prompt_sha256:hash('9')},
    subject:{run_id:uuid(10),result_sha256:hash('8'),git_artifact_sha256:hash('a'),source_head:worktree.base_sha,agent_id:'agent_native-author',worker_process:processIdentity(9200,-10_000)}};
  const sources={permit:'PROTECTED_OPERATOR_PERMIT_READBACK',artifact:'INSTALLED_IMAGE_NATIVE_VERIFIER',host:'OS_PROCESS_INVENTORY',pg:'ATTACHED_OWN_POSTGRES_READBACK',
    worktree:'NATIVE_FILESYSTEM_AND_GIT_READBACK',sandbox:'OS_SANDBOX_CANARY_READBACK',lease:'W30_OWN_PG_LIVE_LEASE',worker:'OS_PROCESS_INVENTORY',subject:'PROTECTED_NATIVE_CODING_RECEIPT'};
  const counts={};const calls=[];let currentTime=now,signs=0;
  const reader=kind=>async request=>{
    counts[kind]=(counts[kind]||0)+1;calls.push(kind);
    assert.equal(Object.isFrozen(request),true);
    const observation={schema:'metaengine.native-coding.host-observation.v1',source:sources[kind],observed_at:new Date(currentTime).toISOString(),value:structuredClone(values[kind])};
    if (mutate) await mutate({kind,count:counts[kind],observation,values,setClock:value=>{currentTime=value;}});
    return observation;
  };
  const nativeIdentity={snapshot:()=>identity.snapshot(),signNativeCodingProof:async(payload,options)=>{
    signs++;const result=await identity.signNativeCodingProof(payload,options);
    return signer ? signer(result) : result;
  }};
  const dependencies={identity:nativeIdentity,readPermit:reader('permit'),readInstalledImage:reader('artifact'),readNativeHost:reader('host'),readPostgres:reader('pg'),
    readWorktree:reader('worktree'),readSandbox:reader('sandbox'),readLiveLease:reader('lease'),readNativeWorker:reader('worker'),readCriticSubject:reader('subject'),clock:()=>currentTime};
  const providerRequest={provider_id:permit.provider_id,agent_id:permit.agent_id};
  const jobRequest={...providerRequest,task_id:values.lease.task_id,lease_generation:9,run_id:values.worker.run_id,prompt_sha256:values.worker.prompt_sha256};
  return {identity,statePath,values,dependencies,issuer:createNativeCodingHostIssuer(dependencies),providerRequest,jobRequest,calls,counts,signs:()=>signs};
}

test('issuer uses the existing enrolled device and binds fresh double-read native scope',async t=>{
  const f=await fixture(t);const before=await fs.readFile(f.statePath);
  const proof=await f.issuer.issueProvider(f.providerRequest);
  const state=f.identity.snapshot();
  assert.equal(proof.algorithm,'ES256');assert.equal(proof.issuer_key_fingerprint_sha256,state.key_fingerprint_sha256);
  assert.equal(proof.payload.production_qualified,false);assert.equal(proof.payload.authority_effect,false);
  const checked=verifyNativeCodingProviderDescriptor(proof,{publicKey:createPublicKey({key:state.public_jwk,format:'jwk'}),expected:proof.payload,now});
  assert.equal(checked.target_id,`codex-cli:${f.providerRequest.provider_id}`);
  assert.equal(f.counts.permit,2);assert.equal(f.counts.artifact,2);assert.equal(f.signs(),1);
  assert.deepEqual(await fs.readFile(f.statePath),before);
});

test('independent scope reads overlap without skipping either physical collection',async t=>{
  const f=await fixture(t);
  const names=['readInstalledImage','readNativeHost','readPostgres','readWorktree','readSandbox'];
  const started=new Set();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const dependencies={...f.dependencies};
  for(const name of names){
    dependencies[name]=async query=>{
      started.add(name);
      if(started.size===names.length)release();
      await gate;
      return f.dependencies[name](query);
    };
  }
  const issuer=createNativeCodingHostIssuer(dependencies);
  const proof=await issuer.issueProvider(f.providerRequest);
  assert.equal(proof.payload.provider_id,f.providerRequest.provider_id);
  assert.equal(started.size,5);
  for(const kind of ['artifact','host','pg','worktree','sandbox'])assert.equal(f.counts[kind],2);
});
test('live W30 job proof binds its worker incarnation, prompt and generation',async t=>{
  const f=await fixture(t);const proof=await f.issuer.issueJob(f.jobRequest);
  const state=f.identity.snapshot();
  const checked=verifyNativeCodingJobProof(proof,{publicKey:createPublicKey({key:state.public_jwk,format:'jwk'}),expected:proof.payload,now});
  assert.equal(checked.lease_generation,9);assert.deepEqual(checked.worker_process,f.values.worker.worker_process);
  assert.equal(f.counts.lease,2);assert.equal(f.counts.worker,2);
});
test('independent Critic subject is read from the live lease and protected result',async t=>{
  const f=await fixture(t,{role:'CRITIC'});const proof=await f.issuer.issueJob(f.jobRequest);
  assert.equal(proof.payload.sandbox.mode,'read-only');
  assert.notEqual(proof.payload.agent_id,proof.payload.subject.agent_id);
  assert.equal(f.counts.subject,2);
});
test('uninitialized identity is rejected without creating another key or file',async t=>{
  const f=await fixture(t,{enrolled:false});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/existing_enrolled_identity_required/);
  await assert.rejects(fs.stat(f.statePath),{code:'ENOENT'});
  await assert.rejects(f.identity.signNativeCodingProof({},{}),/supervisor_device_not_enrolled/);
  await assert.rejects(fs.stat(f.statePath),{code:'ENOENT'});
});
test('all private native readers are required before an issuer exists',async t=>{
  const f=await fixture(t);
  assert.throws(()=>createNativeCodingHostIssuer({...f.dependencies,readNativeWorker:null}),/readNativeWorker_required/);
});
test('renderer authority flags cannot be passed as request fields',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.issuer.issueProvider({...f.providerRequest,authorized:true}),/request_fields_invalid/);
  assert.equal(f.signs(),0);
});
for (const [name,mutate,reason] of [
  ['expired native observation',({kind,observation})=>{if(kind==='artifact')observation.observed_at=iso(-31_000);},/image_observation_untrusted/],
  ['model labelled image',({kind,observation})=>{if(kind==='artifact')observation.source='MODEL_CLAIM';},/image_observation_untrusted/],
  ['revoked operator permit',({kind,observation})=>{if(kind==='permit')observation.value.revoked=true;},/operator_permit_unavailable/],
  ['different artifact',({kind,observation})=>{if(kind==='artifact')observation.value.installed_asar_sha256=hash('0');},/installed_artifact_changed/],
  ['different Windows user',({kind,observation})=>{if(kind==='host')observation.value.user_sid='S-1-5-21-1-2-3-1001';},/native_scope_mismatch/],
  ['different own-PG project',({kind,observation})=>{if(kind==='pg')observation.value.project_id=uuid(40);},/native_scope_mismatch/],
  ['different own-PG cluster',({kind,observation})=>{if(kind==='pg')observation.value.postgres.system_identifier='123';},/own_postgres_changed/],
  ['swapped managed root',({kind,observation})=>{if(kind==='worktree')observation.value.root_identity_sha256=hash('0');},/managed_worktree_changed/],
  ['Job Object substituted for sandbox',({kind,observation})=>{if(kind==='sandbox')observation.value.backend='WINDOWS_JOB_OBJECT';},/sandbox_backend_invalid/],
]) test(`issuer rejects ${name} before signing`,async t=>{
  const f=await fixture(t,{mutate});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),reason);
  assert.equal(f.signs(),0);
});
test('permit revocation between signing and publication returns no proof',async t=>{
  const f=await fixture(t,{mutate:({kind,count,observation})=>{if(kind==='permit'&&count===2)observation.value.revoked=true;}});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/operator_permit_unavailable/);
  assert.equal(f.signs(),1);
});
test('host PID reuse between signing and publication returns no proof',async t=>{
  const f=await fixture(t,{mutate:({kind,count,observation})=>{if(kind==='host'&&count===2)observation.value.host_process=processIdentity(9101,-60_000);}});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/scope_changed_during_sign/);
});
test('observations that become stale before the final join are rejected',async t=>{
  const f=await fixture(t,{mutate:async({kind,setClock,observation})=>{if(kind==='sandbox'){
    await new Promise(resolve=>setImmediate(resolve));
    setClock(now+31_000);observation.observed_at=iso(31_000);
  }}});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/readback_window_exceeded/);
  assert.equal(f.signs(),0);
});
test('signer cannot substitute payload bytes after the native binding checks',async t=>{
  const f=await fixture(t,{signer:result=>({...result,payload:{...result.payload,owner_epoch:999}})});
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/signature_invalid/);
});
for (const [name,mutate,reason] of [
  ['browser target masquerade',({kind,observation})=>{if(kind==='lease')observation.value.target_id='webcontents:22';},/live_w30_lease_mismatch/],
  ['changed lease generation',({kind,observation})=>{if(kind==='lease')observation.value.lease_generation=10;},/live_w30_lease_mismatch/],
  ['expired W30 lease',({kind,observation})=>{if(kind==='lease')observation.value.expires_at=iso(-1);},/live_w30_lease_mismatch/],
  ['changed native run',({kind,observation})=>{if(kind==='worker')observation.value.run_id=uuid(41);},/worker_binding_mismatch/],
  ['changed launched prompt',({kind,observation})=>{if(kind==='worker')observation.value.prompt_sha256=hash('0');},/worker_binding_mismatch/],
  ['unrelated Critic subject',({kind,observation})=>{if(kind==='subject')observation.value.result_sha256=hash('0');},/critic_subject_mismatch/],
  ['substituted reviewed Git artifact',({kind,observation})=>{if(kind==='subject')observation.value.git_artifact_sha256=hash('0');},/critic_subject_mismatch/],
  ['substituted reviewed source HEAD',({kind,observation})=>{if(kind==='subject')observation.value.source_head='f'.repeat(40);},/critic_subject_mismatch/],
  ['same author and Critic',({kind,observation,values})=>{if(kind==='subject')observation.value.agent_id=values.permit.agent_id;},/critic_not_independent/],
]) test(`issuer job rejects ${name}`,async t=>{
  const f=await fixture(t,{role:'CRITIC',mutate});
  await assert.rejects(f.issuer.issueJob(f.jobRequest),reason);
});
test('closed issuer cannot issue or publish new capabilities',async t=>{
  const f=await fixture(t);f.issuer.close();
  await assert.rejects(f.issuer.issueProvider(f.providerRequest),/issuer_closed/);
  assert.equal(f.signs(),0);
});
test('native device signer accepts no generic material, foreign device or self-selected expected scope',async t=>{
  const f=await fixture(t);
  const issued=await f.issuer.issueProvider(f.providerRequest);
  const before=await fs.readFile(f.statePath);
  await assert.rejects(f.identity.signNativeCodingProof({message:'arbitrary bytes'},{expected:{}}),/proof_schema_invalid/);
  await assert.rejects(f.identity.signNativeCodingProof(issued.payload),/expected_native_readback_invalid/);
  const foreign={...issued.payload,device_id:uuid(45)};
  await assert.rejects(f.identity.signNativeCodingProof(foreign,{expected:foreign,now}),/device_binding_mismatch/);
  const production={...issued.payload,trust_namespace:'PRODUCTION'};
  await assert.rejects(f.identity.signNativeCodingProof(production,{expected:production,now}),/scope_invalid/);
  assert.deepEqual(await fs.readFile(f.statePath),before);
});
