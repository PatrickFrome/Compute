// Test-only in-process phase wire. Real Host SQL/signature/identity services are
// supplied by the caller; native observations remain explicit STAGING fixtures.
import {randomUUID,createHash} from 'node:crypto';
import {createPendingOwnerHostPhases,createPendingOwnerClientPhases} from '../../../apps/metaengine-browser/src/native-coding-pending-owner-phase.mjs';
import {signNativeCodingDeviceRequest} from '../../../apps/metaengine-browser/src/native-coding-device-request.mjs';
export async function pendingOwnerScopeFixture(f,mode,callback,{signal,contextPatch={},onPhase=()=>{}}={}){
 const action=mode==='WRITE_CUSTODY'?'ESTABLISH_PENDING_OWNER_V1':'READ_PENDING_OWNER_V1';
 const signed=await signNativeCodingDeviceRequest({identity:f.identity,binding:f.host,operation:action,input:f.goal});
 const binding={instance_id:f.host.instance_id,host_pid:f.host.host_pid,request_id:randomUUID(),action,
  request_sha256:createHash('sha256').update(JSON.stringify(signed)).digest('hex'),body_sha256:signed.headers['x-a2-device-body-sha256']};
 const abort=signal||new AbortController().signal;let client;
 const host=createPendingOwnerHostPhases({binding,signal:abort,send:message=>queueMicrotask(()=>client.receive(message))});
 client=createPendingOwnerClientPhases({binding,assertLifetime:()=>{if(abort.aborted)throw Error('test_scope_aborted');},callback,
  send:message=>{onPhase(message);queueMicrotask(()=>host.receive(message));}});
 try{
  const value=await f.context.run(action,signed,input=>f.service[action](input,{signal:abort,deadlineAt:Date.now()+30000,
   instanceId:f.host.instance_id,hostPid:f.host.host_pid,requestId:binding.request_id,action,
   requestDigest:binding.request_sha256,bodyDigest:binding.body_sha256,pendingOwnerPhases:host,...contextPatch}));
  return await client.finish(value);
 }finally{host.close();client.close();await client.drain();}
}
export function bindStagingPendingOwner(f,{readSourceHook=async()=>{},guardianPatch=()=>({}),withScope=pendingOwnerScopeFixture}={}){
 // Same disposable native incarnation across rebinding; never a production claim.
 const snap=f.identity.snapshot(),birth=f.stagingNativeBirth||(f.stagingNativeBirth=new Date().toISOString()),pid=process.pid;
 const ticks=(BigInt(Date.parse(birth))*10000n+116444736000000000n).toString();
 const releaseGuardian=f.identity.bindGuardianOwnerEvidenceW67({status:async()=>({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',state:'READY',
  guardian_client_pid:pid,guardian_client_created_at:birth,guardian_client_process_incarnation_id:`pid:${pid}:created_100ns:${ticks}`,
  guardian_client_kernel_birth_verified:true,guardian_client_kernel_birth_rechecked:true,owner_binding_proven:true,device_binding_proven:true,
  guardian_device_key_fingerprint_sha256:snap.key_fingerprint_sha256,guardian_enrollment_evidence_sha256:'f'.repeat(64),...guardianPatch()})});
 const releaseOwner=f.identity.bindHostOwnerGenesisW74({staging:true,withOwnerScope:(mode,body)=>withScope(f,mode,body),
  readNativeKernel:async()=>({pid,created_at:birth,observed_at:new Date().toISOString(),source:'OS_PROCESS_INVENTORY'}),
  readSourceProof:async()=>{const patch=await readSourceHook();return{source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:'a'.repeat(40),
   proof_identity:'b'.repeat(64),installed_exe_sha256:'c'.repeat(64),package_code_sha256:'d'.repeat(64),exact_bytes_verified:true,
   native_signature_verified:true,release_root_signature_verified:true,slsa_evidence_digest_bound:true,package_code_verified:true,
   loaded_runtime_code_attested:false,observed_at:new Date().toISOString(),authority_effect:false,fixture_classification:'STAGING',...patch};},
 });
 return async()=>{await releaseOwner();releaseGuardian();};
}

// Reconstructed activation wire. Runs the real signed Host request and SQL
// service while the only synthetic evidence is the explicitly STAGING native
// producer above. Never installed Windows proof.
export async function pendingActivationScopeFixture(f,input,callback,{signal,contextPatch={},onPhase=()=>{}}={}){
 const {createPendingActivationHostPhases,createPendingActivationClientPhases}=await import('../../../apps/metaengine-browser/src/native-coding-pending-activation-phase.mjs');
 const action='ACTIVATE_PREPARED_GOAL_V1',signed=await signNativeCodingDeviceRequest({identity:f.identity,binding:f.host,operation:action,input});
 const binding={instance_id:f.host.instance_id,host_pid:f.host.host_pid,request_id:randomUUID(),action,
  request_sha256:createHash('sha256').update(JSON.stringify(signed)).digest('hex'),body_sha256:signed.headers['x-a2-device-body-sha256']};
 const abort=signal||new AbortController().signal;let client;
 const host=createPendingActivationHostPhases({binding,signal:abort,send:message=>queueMicrotask(()=>client.receive(message))});
 client=createPendingActivationClientPhases({binding,input,assertLifetime:()=>{if(abort.aborted)throw Error('test_scope_aborted');},callback,
  send:message=>{onPhase(message);queueMicrotask(()=>host.receive(message));}});
 try{
  const value=await f.context.run(action,signed,checked=>f.service[action](checked,{signal:abort,deadlineAt:Date.now()+30000,
   instanceId:f.host.instance_id,hostPid:f.host.host_pid,requestId:binding.request_id,action,
   requestDigest:binding.request_sha256,bodyDigest:binding.body_sha256,pendingActivationPhases:host,...contextPatch}));
  return await client.finish(value);
 }finally{host.close();client.close();await client.drain();}
}
