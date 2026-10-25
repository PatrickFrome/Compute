import {randomUUID} from 'node:crypto';
import {admissionFixture} from '../../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';
import {buildNativeCodingHistoricalTaskContext,buildNativeCodingExecutionScope,nativeCodingCanonicalJson as json,
  nativeCodingCanonicalSha256 as sha} from '../native-coding-task-context.mjs';

// Ephemeral generated signatures/native data for deny-only tests. Never
// registered with installed METAENGINE or represented as physical proof.
export function checkpointFixture() {
  const f=admissionFixture(),candidateHead='c'.repeat(40),candidate={head:candidateHead,status_sha256:'1'.repeat(64),
    diff_sha256:'2'.repeat(64),changed_files:[{path:'fixture.txt',status:' M',sha256:'3'.repeat(64),bytes:7}],artifact_sha256:'4'.repeat(64),clean:false};
  const birth=(pid,offset)=>({pid,created_at:f.iso(offset),process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(f.now+offset)*10000n+116444736000000000n}`});
  const project={project_id:f.permit.project_id,workspace_id:f.workspaceId,device_id:f.permit.device_id,client_id:f.clientId,admin_grant_epoch:1,state:'ACTIVE'};
  const receipts=new Map();
  function bundle(role,writer=null) {
    const p=structuredClone(f.permit);p.role=role;
    if(role==='CRITIC'){p.permit_id=randomUUID();p.provider_id=randomUUID();p.agent_id='agent_native-critic01';p.worktree.base_sha=candidateHead;}
    const taskId=randomUUID(),runId=randomUUID(),subject=writer?{run_id:writer.registration.run_id,result_sha256:writer.registration.result_receipt.result_sha256,
      git_artifact_sha256:candidate.artifact_sha256,source_head:candidateHead}:null;
    const task={task_id:taskId,workspace_id:p.workspace_id,role,state:'RESULT_READY',base_sha:p.worktree.base_sha,lease_generation:1,
      lease_agent_id:p.agent_id,lease_target_id:`codex-cli:${p.provider_id}`,lease_tab_id:`native-coding:${p.provider_id}`,lease_agent_generation_epoch:1,
      lease_expires_at:f.jobPayload.lease_expires_at,task_spec:{objective:role==='CRITIC'?'Review this fixture candidate':'Implement this fixture candidate',
        native_coding:{permit_id:p.permit_id,goal_id:p.goal_id,goal_sha256:p.goal_sha256,project_id:p.project_id,...(subject?{verification_subject:subject}:{})}}};
    const lease=buildNativeCodingHistoricalTaskContext(task,{projectId:p.project_id,providerId:p.provider_id,verificationSubject:subject}).value;
    const payload={...f.jobPayload,...Object.fromEntries(['permit_id','provider_id','agent_id','role','worktree'].map(key=>[key,p[key]])),
      target_id:`codex-cli:${p.provider_id}`,task_id:taskId,run_id:runId,job_id:runId,prompt_sha256:lease.prompt_sha256,
      worker_process:birth(role==='CRITIC'?9002:9001,-5000),sandbox:{...f.jobPayload.sandbox,mode:role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:role==='CRITIC'},
      subject:subject?{...subject,agent_id:writer.permit.agent_id,worker_process:writer.registration.job_envelope.payload.worker_process}:null};
    const job=f.envelope(payload),scope=buildNativeCodingExecutionScope(p,lease,payload.host_process),process={...payload.worker_process,
      started_at:payload.worker_process.created_at,job_id:runId,started_suspended:true,tree_control_bound:true,job_bound_before_resume:true,process_tree_control:'WINDOWS_JOB_OBJECT'};
    delete process.created_at;
    const receipt={schema:'metaengine.codex-cli.run-receipt.v1',provider:'CODEX_CLI',trust_namespace:'LOCAL_OPERATOR_QA',task_id:taskId,agent_id:p.agent_id,
      base_sha:p.worktree.base_sha,lease_generation:1,agent_generation_epoch:1,role,run_id:runId,prompt_sha256:lease.prompt_sha256,
      permit_id:p.permit_id,owner_epoch:p.owner_epoch,user_sid:p.user_sid,workspace_id:p.workspace_id,project_id:p.project_id,
      worktree_path:p.worktree.path,executable_sha256:p.artifact.cli_executable_sha256,sandbox_mode:payload.sandbox.mode,
      state:'RESULT_READY',pid:payload.worker_process.pid,process_incarnation_id:payload.worker_process.process_incarnation_id,process,
      process_result:{exit_code:0,signal:null,reason:null,tree_cleanup_confirmed:true,process_tree_control:'WINDOWS_JOB_OBJECT'},
      result_sha256:(role==='CRITIC'?'8':'7').repeat(64),git_before:writer?structuredClone(candidate):{...structuredClone(candidate),head:p.worktree.base_sha,artifact_sha256:'5'.repeat(64)},
      git_after:structuredClone(candidate),useful_work_verified:false,model_claim_authority:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false,
      result:{schema:'metaengine.codex-cli.result.v1',role,outcome:'DONE',summary:'Generated fixture',checks:[{description:'Fixture check',passed:true,evidence:'Generated test only'}],followup_tasks:[],
        ...(subject?{verdict:'ACCEPT',subject_result_sha256:subject.result_sha256}:{})},
      ...(subject?{subject_run_id:subject.run_id,subject_result_sha256:subject.result_sha256,subject_git_artifact_sha256:subject.git_artifact_sha256,subject_source_head:subject.source_head}:{})};
    const execution={...scope,reservation_id:randomUUID(),state:'RESULT_READY',job_proof_sha256:sha(job),result_sha256:receipt.result_sha256,
      automatic_retry_allowed:false,authority_effect:false};
    const result={permit:p,permit_binding:{workspace_id:p.workspace_id,device_id:p.device_id,client_id:f.clientId,admin_grant_epoch:1,revoked_at:null},
      device:structuredClone(f.context().device),task,execution,registration:{task_id:taskId,lease_generation:1,permit_id:p.permit_id,run_id:runId,
        job_envelope:job,canonical_job_envelope:json(job),job_envelope_sha256:sha(job),result_receipt:receipt,
        canonical_result_receipt:json(receipt),result_receipt_sha256:sha(receipt)}};
    receipts.set(taskId,structuredClone(receipt));return result;
  }
  const writer=bundle('IMPLEMENTER'),critic=bundle('CRITIC',writer);
  const native={artifact:structuredClone(f.permit.artifact),postgres:{...structuredClone(f.permit.postgres),postmaster:birth(19000,1800000)},
    host_process:birth(20000,3600000),user_sid:f.permit.user_sid,
    worktree:{...structuredClone(f.permit.worktree),base_sha:candidateHead},git:structuredClone(candidate)};
  function refresh(value,{resign=false}={}) {
    const j=value.registration;
    if(resign)j.job_envelope=f.envelope(j.job_envelope.payload);
    j.canonical_job_envelope=json(j.job_envelope);j.job_envelope_sha256=sha(j.job_envelope);value.execution.job_proof_sha256=j.job_envelope_sha256;
    j.canonical_result_receipt=json(j.result_receipt);j.result_receipt_sha256=sha(j.result_receipt);value.execution.result_sha256=j.result_receipt.result_sha256;
    receipts.set(value.task.task_id,structuredClone(j.result_receipt));
  }
  return {f,project,writer,critic,native,receipts,refresh,clock:()=>f.now+7200000,
    readProtectedReceipt:async({scope})=>structuredClone(receipts.get(scope.task_id)),readCheckpointScope:async()=>structuredClone(native)};
}
