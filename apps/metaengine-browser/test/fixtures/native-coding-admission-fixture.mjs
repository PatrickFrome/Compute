import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {canonicalNativeCodingAdmissionJSON} from '../../supabase/a2-browser-native-supervisor-v1/native-coding-admission.mjs';
// Generated verifier/disposable-DB fixtures. Never installed/enrolled or
// represented as native execution, OS sandbox or useful-work evidence.
export const digest=value=>createHash('sha256').update(canonicalNativeCodingAdmissionJSON(value)).digest('hex');
export function admissionFixture(){
  const now=Date.now(),iso=delta=>new Date(now+delta).toISOString();
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),raw=pair.publicKey.export({format:'jwk'});
  const jwk={crv:raw.crv,ext:true,key_ops:['verify'],kty:raw.kty,x:raw.x,y:raw.y};
  const fingerprint=createHash('sha256').update(JSON.stringify(jwk)).digest('hex');
  const workspaceId=randomUUID(),clientId=randomUUID(),deviceId=randomUUID(),providerId=randomUUID(),permitId=randomUUID();
  const birth=(pid,delta)=>({pid,created_at:iso(delta),process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(now+delta)*10000n+116444736000000000n}`});
  const permit={schema:'metaengine.native-coding.operator-permit.v1',trust_namespace:'LOCAL_OPERATOR_QA',permit_id:permitId,
    goal_id:randomUUID(),goal_sha256:'a'.repeat(64),owner_epoch:1,user_sid:'S-1-5-21-1-2-3-1001',device_id:deviceId,
    device_key_fingerprint_sha256:fingerprint,workspace_id:workspaceId,project_id:randomUUID(),provider_id:providerId,
    agent_id:'agent_native-fixture1',role:'IMPLEMENTER',agent_generation_epoch:1,physical_slot_budget:2,
    artifact:{installed_exe_sha256:'b'.repeat(64),installed_asar_sha256:'c'.repeat(64),runtime_bundle_sha256:'d'.repeat(64),source_sha:'e'.repeat(40),cli_executable_sha256:'f'.repeat(64)},
    postgres:{system_identifier:'7521123456789012345',postmaster:birth(8056,-120000),data_directory_identity_sha256:'1'.repeat(64)},
    worktree:{path:'C:\\METAENGINE\\fixture',root_identity_sha256:'2'.repeat(64),base_sha:'3'.repeat(40)},
    issued_at:iso(-120000),expires_at:iso(600000),revoked:false,storage_evidence_sha256:'4'.repeat(64),record_sha256:'5'.repeat(64)};
  const payload=()=>{
    const {issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,schema,...scope}=permit;
    return {...scope,schema:'metaengine.codex-cli.transport-proof.v1',issuer:'NATIVE_HOST',audience:'METAENGINE_NATIVE_SUPERVISOR',provider:'CODEX_CLI',
      target_id:'codex-cli:'+providerId,state:'READY',host_process:birth(9000,-60000),sandbox:{backend:'CODEX_WINDOWS_ELEVATED',mode:'workspace-write',evidence_sha256:'6'.repeat(64),outside_write_denied:true,worktree_write_denied:false},
      proven_at:iso(-1000),expires_at:iso(55000),automatic_retry_allowed:false,production_qualified:false,authority_effect:false};
  };
  const envelope=p=>({algorithm:'ES256',issuer_key_fingerprint_sha256:fingerprint,payload:p,
    signature:sign('sha256',Buffer.from('METAENGINE_NATIVE_CODING_PROOF_V1\n'+canonicalNativeCodingAdmissionJSON(p)),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')});
  let provider=envelope(payload());
  const identity={id:clientId,device_id:deviceId,profile:'A2_DEVICE_HTTP_SIGNATURE_V1',key_fingerprint_sha256:fingerprint,admin_grant_epoch:1,admin_ready:true};
  const context=()=>({schema:'metaengine.native-coding.admission-context.v1',source:'PROTECTED_OWN_PG_OPERATOR_REGISTRY',permit,
    registration:{envelope_sha256:digest(provider),registered_at:iso(-500)},
    device:{device_id:deviceId,client_id:clientId,profile:identity.profile,public_jwk:jwk,key_fingerprint_sha256:fingerprint,admin_grant_epoch:1},
    postgres_system_identifier:permit.postgres.system_identifier});
  const taskId=randomUUID(),runId=randomUUID();
  const jobPayload=payload();delete jobPayload.state;delete jobPayload.physical_slot_budget;
  Object.assign(jobPayload,{schema:'metaengine.codex-cli.job-proof.v1',task_id:taskId,lease_generation:1,run_id:runId,
    lease_expires_at:iso(590000),expires_at:iso(580000),worker_process:birth(9001,-5000),job_id:randomUUID(),prompt_sha256:'7'.repeat(64),subject:null});
  const job=envelope(jobPayload);
  const binding={task_id:taskId,agent_id:permit.agent_id,lease_generation:1,agent_generation_epoch:1,tab_id:'native-coding:'+providerId,target_id:'codex-cli:'+providerId};
  const receipt={schema:'metaengine.codex-cli.run-receipt.v1',trust_namespace:'LOCAL_OPERATOR_QA',...binding,run_id:runId,
    role:permit.role,permit_id:permitId,owner_epoch:1,state:'RESULT_READY',executable_sha256:permit.artifact.cli_executable_sha256,
    process_incarnation_id:jobPayload.worker_process.process_incarnation_id,result_sha256:'8'.repeat(64),
    git_after:{artifact_sha256:'9'.repeat(64),head:permit.worktree.base_sha},production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const executionContext=()=>({...context(),job_registration:{job_envelope:job,job_envelope_sha256:digest(job),result_receipt_sha256:digest(receipt)},
    lease:{...binding,workspace_id:workspaceId,expires_at:jobPayload.lease_expires_at,state:'LEASED'},
    execution:{host_incarnation:jobPayload.host_process.process_incarnation_id,agent_id:permit.agent_id,target_id:binding.target_id,
      agent_generation_epoch:1,state:'RESULT_READY',result_sha256:receipt.result_sha256}});
  return {now,iso,pair,jwk,permit,workspaceId,clientId,identity,payload,envelope,get provider(){return provider;},set provider(value){provider=value;},context,
    job,jobPayload,binding,receipt,executionContext};
}
