import {createPublicKey,randomUUID} from 'node:crypto';
import {verifyNativeCodingJobProof,nativeCodingDeviceKeyFingerprint}
  from '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs';
import {validateCodexCliResult} from '../../apps/metaengine-browser/src/codex-cli-result-schema.mjs';
import {buildNativeCodingHistoricalTaskContext,buildNativeCodingExecutionScope,
  nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

const fail=reason=>{throw new Error('native_coding_checkpoint_'+reason);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const same=(left,right)=>json(left)===json(right);
const scopeKeys=['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256','reservation_id'];
export function nativeCodingHistoricalExecutionScope(execution) {
  if(!execution||!UUID.test(execution.reservation_id||''))fail('historical_execution_invalid');
  const scope=Object.fromEntries(scopeKeys.map(key=>[key,['lease_generation','agent_generation_epoch'].includes(key)?Number(execution[key]):execution[key]]));
  if(!Number.isSafeInteger(scope.lease_generation)||scope.lease_generation<1
    ||!Number.isSafeInteger(scope.agent_generation_epoch)||scope.agent_generation_epoch<1)fail('historical_execution_invalid');
  return scope;
}
const processProof=value=>({pid:value.pid,created_at:value.created_at??new Date(value.started_at).toISOString(),
  process_incarnation_id:value.process_incarnation_id});
function nativeProcess(value,now) {
  if(!value||Object.keys(value).sort().join(',')!=='created_at,pid,process_incarnation_id'
    ||!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.created_at!=='string'
    ||!Number.isFinite(Date.parse(value.created_at))||new Date(value.created_at).toISOString()!==value.created_at
    ||Date.parse(value.created_at)>now+5000)fail('current_native_process_invalid');
  const birth=/^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]{16,18})$/.exec(value.process_incarnation_id||'');
  if(!birth||Number(birth[1])!==value.pid||(BigInt(birth[2])-116444736000000000n)/10000n!==BigInt(Date.parse(value.created_at)))fail('current_native_process_invalid');
}

// A historical verification capability. It never reissues a lease or calls a
// model, and old Host/process/sandbox proofs cannot authorize a fresh launch.
export function createNativeCodingCheckpointVerifier({readProtectedReceipt,readCheckpointScope,clock=()=>Date.now()}={}) {
  if(typeof readProtectedReceipt!=='function'||typeof readCheckpointScope!=='function'||typeof clock!=='function')fail('private_readers_required');
  let closed=false;const open=()=>{if(closed)fail('closed');};
  async function registered(bundle,project,role,subject=null,verdict='ACCEPT') {
    const {permit:p,permit_binding:b,device:d,registration:j,execution:e,task:t}=bundle??{};
    if(!p||!b||!d||!j||!e||!t||p.role!==role||p.schema!=='metaengine.native-coding.operator-permit.v1'
      ||p.trust_namespace!=='LOCAL_OPERATOR_QA'||p.revoked!==false||b.revoked_at!==null
      ||b.workspace_id!==p.workspace_id||b.device_id!==p.device_id||b.client_id!==project.client_id
      ||Number(b.admin_grant_epoch)!==Number(project.admin_grant_epoch)
      ||d.device_id!==p.device_id||d.client_id!==b.client_id||d.profile!=='A2_DEVICE_HTTP_SIGNATURE_V1'
      ||d.key_fingerprint_sha256!==p.device_key_fingerprint_sha256||Number(d.admin_grant_epoch)!==Number(b.admin_grant_epoch)
      ||Object.keys(d.public_jwk??{}).sort().join(',')!=='crv,ext,key_ops,kty,x,y'
      ||p.project_id!==project.project_id||p.workspace_id!==project.workspace_id||p.device_id!==project.device_id
      ||t.workspace_id!==p.workspace_id||t.role!==role||t.state!=='RESULT_READY'
      ||t.lease_agent_id!==p.agent_id||t.lease_target_id!==`codex-cli:${p.provider_id}`
      ||t.lease_tab_id!==`native-coding:${p.provider_id}`||t.base_sha!==p.worktree?.base_sha
      ||Number(t.lease_agent_generation_epoch)!==p.agent_generation_epoch
      ||t.task_spec?.native_coding?.permit_id!==p.permit_id||t.task_spec.native_coding.goal_id!==p.goal_id
      ||t.task_spec.native_coding.goal_sha256!==p.goal_sha256||t.task_spec.native_coding.project_id!==p.project_id
      ||j.permit_id!==p.permit_id||j.task_id!==t.task_id||Number(j.lease_generation)!==Number(t.lease_generation)
      ||e.state!=='RESULT_READY'||e.automatic_retry_allowed!==false||e.authority_effect!==false)fail('registered_scope_mismatch');
    const key=createPublicKey({key:d.public_jwk,format:'jwk'});
    if(nativeCodingDeviceKeyFingerprint(key)!==d.key_fingerprint_sha256)fail('device_key_changed');
    const envelope=j.job_envelope,payload=envelope?.payload;
    if(!payload||j.canonical_job_envelope!==json(envelope)||j.job_envelope_sha256!==sha(envelope)
      ||j.run_id!==payload.run_id||e.job_proof_sha256!==j.job_envelope_sha256)fail('registered_job_changed');
    const saved=nativeCodingHistoricalExecutionScope(e);
    const historical=buildNativeCodingHistoricalTaskContext(t,{projectId:p.project_id,providerId:p.provider_id,
      verificationSubject:role==='CRITIC'?t.task_spec.native_coding.verification_subject:null});
    // Rebuild only against the signed ORIGINAL Host birth, never today's Host.
    const expectedScope=buildNativeCodingExecutionScope(p,historical.value,payload.host_process);
    if(Object.keys(expectedScope).some(key=>saved[key]!==expectedScope[key]))fail('historical_scope_changed');
    const receipt=await readProtectedReceipt({scope:saved,permit:p,job:envelope});open();
    if(!same(receipt,j.result_receipt)||j.canonical_result_receipt!==json(receipt)||j.result_receipt_sha256!==sha(receipt)
      ||receipt.schema!=='metaengine.codex-cli.run-receipt.v1'||receipt.trust_namespace!=='LOCAL_OPERATOR_QA'||receipt.provider!=='CODEX_CLI'
      ||receipt.state!=='RESULT_READY'||receipt.role!==role||receipt.run_id!==payload.run_id||receipt.task_id!==saved.task_id
      ||receipt.lease_generation!==saved.lease_generation||receipt.agent_id!==saved.agent_id
      ||receipt.agent_generation_epoch!==saved.agent_generation_epoch||receipt.base_sha!==p.worktree.base_sha
      ||receipt.permit_id!==p.permit_id||receipt.owner_epoch!==p.owner_epoch||receipt.user_sid!==p.user_sid
      ||receipt.workspace_id!==p.workspace_id||receipt.project_id!==p.project_id||receipt.worktree_path!==p.worktree.path
      ||receipt.executable_sha256!==p.artifact.cli_executable_sha256||receipt.prompt_sha256!==historical.value.prompt_sha256
      ||receipt.result_sha256!==e.result_sha256||!HASH.test(receipt.result_sha256||'')
      ||receipt.pid!==payload.worker_process?.pid||receipt.process_incarnation_id!==payload.worker_process?.process_incarnation_id
      ||!same(processProof(receipt.process),payload.worker_process)||receipt.process.job_id!==payload.job_id
      ||receipt.process.started_suspended!==true||receipt.process.tree_control_bound!==true||receipt.process.job_bound_before_resume!==true
      ||receipt.process.process_tree_control!=='WINDOWS_JOB_OBJECT'||receipt.process_result?.exit_code!==0
      ||receipt.process_result.signal!=null||receipt.process_result.reason||receipt.process_result.tree_cleanup_confirmed!==true
      ||receipt.process_result.process_tree_control!=='WINDOWS_JOB_OBJECT'
      ||receipt.useful_work_verified!==false||receipt.model_claim_authority!==false||receipt.production_qualified!==false
      ||receipt.automatic_retry_allowed!==false||receipt.authority_effect!==false
      ||receipt.sandbox_mode!==(role==='CRITIC'?'read-only':'workspace-write')
      ||receipt.git_before?.head!==p.worktree.base_sha||!HASH.test(receipt.git_after?.artifact_sha256||''))fail('protected_result_changed');
    const result=validateCodexCliResult(receipt.result,role,subject?.result_sha256??null);
    if(result.outcome!=='DONE'||verdict==='ACCEPT'&&result.checks.some(check=>!check.passed)||role==='CRITIC'&&result.verdict!==verdict)fail('result_not_accepted');
    const expected={...payload};
    for(const name of ['permit_id','goal_id','goal_sha256','owner_epoch','user_sid','workspace_id','project_id','provider_id',
      'agent_id','role','agent_generation_epoch','device_id','artifact','postgres','worktree'])expected[name]=p[name];
    Object.assign(expected,{device_key_fingerprint_sha256:d.key_fingerprint_sha256,worker_process:processProof(receipt.process),
      task_id:t.task_id,lease_generation:Number(t.lease_generation),run_id:receipt.run_id,job_id:receipt.process.job_id,
      prompt_sha256:historical.value.prompt_sha256,subject,expires_at:p.expires_at});
    if(Date.parse(payload.lease_expires_at)>Date.parse(t.lease_expires_at))fail('historical_lease_changed');
    // The purpose-limited signed proof was admitted while live. Check its
    // signature/time window AT that recorded instant, with protected PG and
    // journal identities; this does not turn it into current OS attestation.
    verifyNativeCodingJobProof(envelope,{publicKey:key,expected,now:Date.parse(payload.proven_at)});
    return {permit:p,receipt,execution_scope:saved,job:payload,receipt_sha256:j.result_receipt_sha256};
  }
  function current(value,p,writer) {
    if(!value||!same(value.artifact,p.artifact)||value.user_sid!==p.user_sid
      ||value.postgres?.system_identifier!==p.postgres.system_identifier
      ||value.postgres?.data_directory_identity_sha256!==p.postgres.data_directory_identity_sha256
      ||value.worktree?.path!==p.worktree.path||value.worktree.root_identity_sha256!==p.worktree.root_identity_sha256
      ||value.worktree.base_sha!==writer.receipt.git_after.head||value.git?.head!==value.worktree.base_sha
      ||!same(value.git,writer.receipt.git_after)||!value.host_process||!value.postgres.postmaster)fail('current_physical_candidate_changed');
    nativeProcess(value.host_process,clock());nativeProcess(value.postgres.postmaster,clock());
    return value;
  }
  async function verifyPair({project,writer,critic}={},reader,verdict='ACCEPT') {
      open();const observed=clock();
      if(!Number.isSafeInteger(observed)||!project||project.state!=='ACTIVE'||!UUID.test(project.project_id||''))fail('project_unavailable');
      const w=await registered(writer,project,'IMPLEMENTER',null,verdict);
      const subject={run_id:w.receipt.run_id,result_sha256:w.receipt.result_sha256,git_artifact_sha256:w.receipt.git_after.artifact_sha256,
        source_head:w.receipt.git_after.head,agent_id:w.receipt.agent_id,worker_process:w.job.worker_process};
      const c=await registered(critic,project,'CRITIC',subject,verdict);
      if(w.permit.goal_id!==c.permit.goal_id||w.permit.goal_sha256!==c.permit.goal_sha256||w.permit.owner_epoch!==c.permit.owner_epoch
        ||w.permit.user_sid!==c.permit.user_sid||!same(w.permit.artifact,c.permit.artifact)
        ||w.permit.postgres.system_identifier!==c.permit.postgres.system_identifier
        ||w.permit.postgres.data_directory_identity_sha256!==c.permit.postgres.data_directory_identity_sha256
        ||w.permit.worktree.path!==c.permit.worktree.path||w.permit.worktree.root_identity_sha256!==c.permit.worktree.root_identity_sha256
        ||w.receipt.task_id===c.receipt.task_id||w.receipt.run_id===c.receipt.run_id||w.receipt.agent_id===c.receipt.agent_id
        ||w.job.worker_process.process_incarnation_id===c.job.worker_process.process_incarnation_id
        ||c.permit.worktree.base_sha!==subject.source_head||c.receipt.subject_run_id!==subject.run_id
        ||c.receipt.subject_result_sha256!==subject.result_sha256||c.receipt.subject_git_artifact_sha256!==subject.git_artifact_sha256
        ||c.receipt.subject_source_head!==subject.source_head||!same(c.receipt.git_before,w.receipt.git_after)
        ||!same(c.receipt.git_after,w.receipt.git_after))fail('independent_critic_mismatch');
      // Private callers can retain their transaction-owned PG connection;
      // standalone verification keeps the physical reader's default pool.
      const first=current(await readCheckpointScope(w.permit,reader),w.permit,w);open();
      const last=current(await readCheckpointScope(c.permit,reader),c.permit,w);open();
      if(!same(first,last)||clock()<observed||clock()-observed>30000)fail('physical_readback_changed');
      if(verdict==='REJECT') {
        // This is evidence of the rejected pair and retained candidate, never
        // an accepted checkpoint, a custody release or permission to retry.
        const rejection={schema:'metaengine.native-coding.verified-rejection.v1',project_id:project.project_id,
          writer_task_id:w.receipt.task_id,writer_lease_generation:w.execution_scope.lease_generation,
          critic_task_id:c.receipt.task_id,critic_lease_generation:c.execution_scope.lease_generation,
          writer_run_id:w.receipt.run_id,critic_run_id:c.receipt.run_id,writer_receipt_sha256:w.receipt_sha256,critic_receipt_sha256:c.receipt_sha256,
          result_sha256:w.receipt.result_sha256,git_artifact_sha256:subject.git_artifact_sha256,source_head:subject.source_head,
          root_identity_sha256:w.permit.worktree.root_identity_sha256,verified_at:new Date(clock()).toISOString(),
          verdict:'REJECT',repair_authorized:false,checkpoint_created:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
        return Object.freeze({rejection,rejection_sha256:sha(rejection),writer:w,critic:c});
      }
      const checkpoint={schema:'metaengine.native-coding.checkpoint.v1',trust_namespace:'LOCAL_OPERATOR_QA',checkpoint_id:randomUUID(),
        workspace_id:project.workspace_id,project_id:project.project_id,goal_id:w.permit.goal_id,goal_sha256:w.permit.goal_sha256,owner_epoch:w.permit.owner_epoch,
        writer_task_id:w.receipt.task_id,writer_lease_generation:w.execution_scope.lease_generation,
        critic_task_id:c.receipt.task_id,critic_lease_generation:c.execution_scope.lease_generation,
        writer_run_id:w.receipt.run_id,critic_run_id:c.receipt.run_id,writer_receipt_sha256:w.receipt_sha256,critic_receipt_sha256:c.receipt_sha256,
        result_sha256:w.receipt.result_sha256,git_artifact_sha256:subject.git_artifact_sha256,source_head:subject.source_head,
        root_identity_sha256:w.permit.worktree.root_identity_sha256,host_process:last.host_process,artifact:last.artifact,postgres:last.postgres,worktree:last.worktree,
        writer_execution_scope:w.execution_scope,critic_execution_scope:c.execution_scope,verified_at:new Date(clock()).toISOString(),
        production_qualified:false,automatic_retry_allowed:false,successor_admitted:false,authority_effect:false};
      return Object.freeze({checkpoint,canonical_checkpoint:json(checkpoint),checkpoint_sha256:sha(checkpoint),writer:w,critic:c});
  }
  return Object.freeze({
    verify:(input,reader)=>verifyPair(input,reader,'ACCEPT'),
    verifyRejected:(input,reader)=>verifyPair(input,reader,'REJECT'),
    close(){closed=true;},
  });
}
