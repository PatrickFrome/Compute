const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const SOURCE='PROTECTED_OWN_PG_OPERATOR_REGISTRY';
const fail=reason=>{throw Error('native_coding_admission_'+reason);};
const same=(a,b)=>canonicalNativeCodingAdmissionJSON(a)===canonicalNativeCodingAdmissionJSON(b);
export function canonicalNativeCodingAdmissionJSON(value,depth=0){
  if(depth>16||(typeof value==='string'&&value.length>8192))fail('json_budget');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  if(Array.isArray(value)){if(value.length>64)fail('json_budget');return '['+value.map(v=>canonicalNativeCodingAdmissionJSON(v,depth+1)).join(',')+']';}
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('json_invalid');
  const keys=Object.keys(value).sort();if(keys.length>64||keys.some(k=>k.length>160))fail('json_budget');
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalNativeCodingAdmissionJSON(value[k],depth+1)).join(',')+'}';
}
export async function nativeCodingAdmissionDigest(value){
  const bytes=new TextEncoder().encode(canonicalNativeCodingAdmissionJSON(value));
  if(bytes.length>131072)fail('json_budget');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function identityContext(context,identity,workspaceId,clientId,now){
  const permit=context?.permit,device=context?.device;
  if(context?.schema!=='metaengine.native-coding.admission-context.v1'||context.source!==SOURCE
    ||identity?.admin_ready!==true||identity.id!==clientId||identity.device_id!==device?.device_id
    ||identity.profile!=='A2_DEVICE_HTTP_SIGNATURE_V1'||identity.key_fingerprint_sha256!==device?.key_fingerprint_sha256
    ||identity.admin_grant_epoch!==Number(device?.admin_grant_epoch)||device?.client_id!==clientId
    ||permit?.schema!=='metaengine.native-coding.operator-permit.v1'||permit.trust_namespace!=='LOCAL_OPERATOR_QA'
    ||permit.workspace_id!==workspaceId||permit.device_id!==device.device_id
    ||permit.device_key_fingerprint_sha256!==device.key_fingerprint_sha256||permit.revoked!==false
    ||Date.parse(permit.expires_at)<=now||!Number.isFinite(Date.parse(permit.expires_at))
    ||permit.postgres?.system_identifier!==context.postgres_system_identifier)fail('protected_scope_unavailable');
  return permit;
}
async function signature(envelope,device){
  if(!envelope||!same(Object.keys(envelope).sort(),['algorithm','issuer_key_fingerprint_sha256','payload','signature'])
    ||envelope.algorithm!=='ES256'||envelope.issuer_key_fingerprint_sha256!==device.key_fingerprint_sha256
    ||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature||''))fail('signature_invalid');
  const raw=device.public_jwk;
  if(raw?.kty!=='EC'||raw.crv!=='P-256'||!/^[A-Za-z0-9_-]{43}$/.test(raw.x||'')||!/^[A-Za-z0-9_-]{43}$/.test(raw.y||''))fail('pinned_key_invalid');
  const jwk={crv:raw.crv,ext:true,key_ops:['verify'],kty:raw.kty,x:raw.x,y:raw.y};
  const keyDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(jwk))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(keyDigest!==device.key_fingerprint_sha256)fail('pinned_key_invalid');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const encoded=envelope.signature.replaceAll('-','+').replaceAll('_','/');
  const sig=Uint8Array.from(atob(encoded+'=='),char=>char.charCodeAt(0));
  if(sig.length!==64||!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,
    new TextEncoder().encode('METAENGINE_NATIVE_CODING_PROOF_V1\n'+canonicalNativeCodingAdmissionJSON(envelope.payload))))fail('signature_invalid');
}
function payloadScope(payload,permit,device,now,maxAge){
  if(payload?.trust_namespace!=='LOCAL_OPERATOR_QA'||payload.issuer!=='NATIVE_HOST'
    ||payload.audience!=='METAENGINE_NATIVE_SUPERVISOR'||payload.provider!=='CODEX_CLI'
    ||payload.authority_effect!==false||payload.production_qualified!==false||payload.automatic_retry_allowed!==false
    ||payload.device_id!==device.device_id||payload.device_key_fingerprint_sha256!==device.key_fingerprint_sha256
    ||payload.target_id!==`codex-cli:${permit.provider_id}`)fail('proof_scope_mismatch');
  for(const field of ['permit_id','goal_id','goal_sha256','owner_epoch','user_sid','workspace_id','project_id',
    'provider_id','agent_id','role','agent_generation_epoch','artifact','postgres','worktree']){
    if(!same(payload[field],permit[field]))fail('proof_scope_mismatch');
  }
  const proven=Date.parse(payload.proven_at),expires=Date.parse(payload.expires_at);
  if(!Number.isFinite(proven)||!Number.isFinite(expires)||proven>now+5000||proven<now-maxAge
    ||expires<=now||expires<=proven||expires-proven>maxAge||expires>Date.parse(permit.expires_at))fail('proof_stale');
  if(!['IMPLEMENTER','CRITIC'].includes(payload.role)||!HASH.test(payload.sandbox?.evidence_sha256||'')
    ||!['WINDOWS_RESTRICTED_TOKEN','WINDOWS_APPCONTAINER','CODEX_WINDOWS_ELEVATED'].includes(payload.sandbox?.backend)
    ||payload.sandbox.mode!==(payload.role==='CRITIC'?'read-only':'workspace-write')
    ||payload.sandbox.outside_write_denied!==true||payload.sandbox.worktree_write_denied!==(payload.role==='CRITIC'))fail('sandbox_unproven');
}
export async function admitNativeCodingProvider(envelope,{context,identity,workspaceId,clientId,now=Date.now()}={}){
  const permit=identityContext(context,identity,workspaceId,clientId,now);
  if(await nativeCodingAdmissionDigest(envelope)!==context.registration?.envelope_sha256)fail('registration_mismatch');
  await signature(envelope,context.device);
  const payload=envelope.payload;payloadScope(payload,permit,context.device,now,60000);
  if(payload.schema!=='metaengine.codex-cli.transport-proof.v1'||payload.state!=='READY'
    ||payload.physical_slot_budget!==permit.physical_slot_budget||!Number.isSafeInteger(payload.physical_slot_budget)
    ||payload.physical_slot_budget<1||payload.physical_slot_budget>64)fail('provider_invalid');
  return Object.freeze({agent_id:payload.agent_id,role:payload.role,lifecycle_state:'ACTIVE',
    tab_id:`native-coding:${payload.provider_id}`,target_id:payload.target_id,generation_epoch:payload.agent_generation_epoch,
    native_coding_permit_id:payload.permit_id,physical_slot_budget:payload.physical_slot_budget});
}
export async function nativeCodingCycleCandidates(value,{rpc,identity,workspaceId,clientId,now=Date.now()}={}){
  if(value===undefined)return [];
  if(value?.schema!=='metaengine.native-coding.providers.v1'||!Array.isArray(value.providers)||value.providers.length>64)fail('providers_invalid');
  const out=[],seen=new Set();
  for(const envelope of value.providers){
    const permitId=envelope?.payload?.permit_id;if(!UUID.test(permitId||''))fail('permit_id_invalid');
    const context=await rpc('native_coding_admission_context_v1',{p_workspace:workspaceId,p_client:clientId,p_permit:permitId});
    const agent=await admitNativeCodingProvider(envelope,{context,identity,workspaceId,clientId,now});
    if(seen.has(agent.agent_id)||seen.has(agent.target_id))fail('duplicate_provider');
    seen.add(agent.agent_id);seen.add(agent.target_id);out.push(agent);
  }
  return out;
}
export function nativeCodingBinding(body){
  const out={task_id:body?.task_id,agent_id:body?.agent_id,lease_generation:body?.lease_generation,
    tab_id:body?.tab_id,target_id:body?.target_id,agent_generation_epoch:body?.agent_generation_epoch};
  const id=String(out.target_id||'').slice('codex-cli:'.length);
  if(!UUID.test(out.task_id||'')||!UUID.test(id)||out.target_id!==`codex-cli:${id}`||out.tab_id!==`native-coding:${id}`
    ||!/^agent_[a-z0-9-]{8,64}$/.test(out.agent_id||'')||!Number.isSafeInteger(out.lease_generation)||out.lease_generation<1
    ||!Number.isSafeInteger(out.agent_generation_epoch)||out.agent_generation_epoch<1)fail('binding_invalid');
  return out;
}
export async function admitNativeCodingExecution(body,{rpc,identity,workspaceId,clientId,complete=false,now=Date.now()}={}){
  const binding=nativeCodingBinding(body);
  const context=await rpc('native_coding_execution_context_v1',{p_workspace:workspaceId,p_client:clientId,p_task:binding.task_id,p_generation:binding.lease_generation});
  const permit=identityContext(context,identity,workspaceId,clientId,now);
  const lease=context.lease,job=context.job_registration?.job_envelope;
  if(!lease||lease.workspace_id!==workspaceId||lease.task_id!==binding.task_id||lease.agent_id!==binding.agent_id
    ||lease.lease_generation!==binding.lease_generation||lease.target_id!==binding.target_id||lease.tab_id!==binding.tab_id
    ||lease.agent_generation_epoch!==binding.agent_generation_epoch||Date.parse(lease.expires_at)<=now
    ||!['LEASED','RUNNING'].includes(lease.state))fail('lease_fenced');
  await signature(job,context.device);payloadScope(job.payload,permit,context.device,now,20*60000);
  if(job.payload.schema!=='metaengine.codex-cli.job-proof.v1'||job.payload.task_id!==binding.task_id
    ||job.payload.lease_generation!==binding.lease_generation||job.payload.agent_id!==binding.agent_id
    ||job.payload.agent_generation_epoch!==binding.agent_generation_epoch||job.payload.target_id!==binding.target_id
    ||Date.parse(job.payload.lease_expires_at)<Date.parse(job.payload.expires_at)
    ||Date.parse(job.payload.lease_expires_at)!==Date.parse(lease.expires_at)
    ||await nativeCodingAdmissionDigest(job)!==context.job_registration.job_envelope_sha256
    ||context.execution?.host_incarnation!==job.payload.host_process?.process_incarnation_id
    ||context.execution?.agent_id!==binding.agent_id||context.execution?.target_id!==binding.target_id
    ||Number(context.execution?.agent_generation_epoch)!==binding.agent_generation_epoch)fail('job_binding_mismatch');
  if(!complete){
    if(body.native_coding?.schema!=='metaengine.native-coding.mark-running.v1'
      ||await nativeCodingAdmissionDigest(body.native_coding.job_proof)!==context.job_registration.job_envelope_sha256
      ||!['ATTEMPTED','RESULT_READY'].includes(context.execution?.state))fail('job_not_registered');
    return {binding,proof:{schema:'metaengine.native-coding.mark-running.v1',job_proof_sha256:context.job_registration.job_envelope_sha256,authority_effect:false}};
  }
  const receipt=body.native_coding?.receipt;
  if(body.state!=='RESULT_READY'||body.native_coding?.schema!=='metaengine.native-coding.complete.v1'
    ||receipt?.schema!=='metaengine.codex-cli.run-receipt.v1'||receipt.trust_namespace!=='LOCAL_OPERATOR_QA'
    ||receipt.state!=='RESULT_READY'||receipt.production_qualified!==false||receipt.automatic_retry_allowed!==false
    ||receipt.authority_effect!==false||receipt.task_id!==binding.task_id||receipt.agent_id!==binding.agent_id
    ||receipt.lease_generation!==binding.lease_generation||receipt.agent_generation_epoch!==binding.agent_generation_epoch
    ||receipt.run_id!==job.payload.run_id||receipt.process_incarnation_id!==job.payload.worker_process?.process_incarnation_id
    ||receipt.role!==job.payload.role||receipt.permit_id!==permit.permit_id||receipt.owner_epoch!==permit.owner_epoch
    ||receipt.executable_sha256!==permit.artifact.cli_executable_sha256||!HASH.test(receipt.result_sha256||'')
    ||!HASH.test(receipt.git_after?.artifact_sha256||'')||!/^[a-f0-9]{40}$/.test(receipt.git_after?.head||'')
    ||await nativeCodingAdmissionDigest(receipt)!==context.job_registration.result_receipt_sha256
    ||context.execution?.state!=='RESULT_READY'||context.execution.result_sha256!==receipt.result_sha256)fail('result_not_registered');
  return {binding,summary:{schema:'metaengine.native-coding.result-summary.v1',run_id:receipt.run_id,
    result_sha256:receipt.result_sha256,receipt_sha256:context.job_registration.result_receipt_sha256,
    git_artifact_sha256:receipt.git_after.artifact_sha256,source_head:receipt.git_after.head,
    useful_work_verified:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false}};
}
