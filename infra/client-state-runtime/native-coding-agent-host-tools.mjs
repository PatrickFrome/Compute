import {createHash} from 'node:crypto';
import {validateNativeCodingAgentHostRequest} from '../../apps/metaengine-browser/src/native-coding-agent-host-contract.mjs';
export {validateNativeCodingAgentHostRequest};
import {buildNativeCodingExecutionScope,buildNativeCodingTaskContext,nativeCodingCanonicalJson as canonical}
  from './native-coding-task-context.mjs';

const fail=reason=>{throw Error('native_coding_agent_host_'+reason);};
const same=(a,b)=>canonical(a)===canonical(b);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');

// Private Host capability. The model cannot select a project, run, process or
// SQL function. Browser's pipe binding is independently checked against the
// protected own-PG registration AND the currently running kernel process.
export function createNativeCodingAgentHostTools({sql,readNativeScope,readNativeWorker}={}){
  if(!['unsafe','begin'].every(key=>typeof sql?.[key]==='function')
      ||typeof readNativeScope!=='function'||typeof readNativeWorker!=='function')fail('private_dependencies_required');
  let closed=false;
  const open=()=>{if(closed)fail('closed');};
  const processOnly=p=>({pid:p?.pid,created_at:new Date(p?.created_at??p?.started_at).toISOString(),process_incarnation_id:p?.process_incarnation_id});
  async function owner(tx){
    const roles=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
    if(roles.length!==1||roles[0].current_user!=='state_owner'||roles[0].session_user!=='state_owner')fail('state_owner_required');
  }
  async function protectedJob(tx,value,permit=null){
    const b=value.binding;
    const rows=await tx.unsafe(`select j.job_envelope,j.canonical_job_envelope,j.job_envelope_sha256,p.permit,to_jsonb(e) as execution
      from destruktion_meta.native_coding_job_registration_h205f22 j
      join destruktion_meta.native_coding_operator_permit_h205f22 p using(permit_id)
      join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation)
      where j.run_id=$1::uuid`,[b.run_id]);
    const record=rows[0],job=record?.job_envelope,j=job?.payload,p=record?.permit;
    if(rows.length!==1||!p||permit&&!same(permit,p)||canonical(job)!==record.canonical_job_envelope||digest(job)!==record.job_envelope_sha256
      ||j?.run_id!==b.run_id||j.task_id!==b.task_id||j.lease_generation!==b.lease_generation
      ||j.workspace_id!==b.workspace_id||j.project_id!==b.project_id||j.provider_id!==b.provider_id
      ||j.agent_id!==b.agent_id||j.agent_generation_epoch!==b.agent_generation_epoch||j.role!==b.role
      ||j.permit_id!==p.permit_id||j.job_id!==value.job_binding.job_id
      ||j.worker_process?.pid!==value.job_binding.pid||j.worker_process?.process_incarnation_id!==value.job_binding.process_incarnation_id
      ||p.provider_id!==b.provider_id||p.agent_id!==b.agent_id||p.role!==b.role||p.workspace_id!==b.workspace_id
      ||p.project_id!==b.project_id||p.agent_generation_epoch!==b.agent_generation_epoch
      ||p.artifact?.cli_executable_sha256!==value.job_binding.executable_sha256)fail('protected_job_changed');
    return {job,p,execution:record.execution};
  }
  async function bound(tx,value){
    open();
    await owner(tx);
    const b=value.binding;
    const rows=await tx.unsafe('select destruktion_meta.native_coding_agent_context_v1($1::uuid) as value',[b.run_id]);
    const c=rows[0]?.value,p=c?.permit,t=c?.task;
    if(rows.length!==1||!c||c.run_id!==b.run_id||c.project_id!==b.project_id||p?.workspace_id!==b.workspace_id
      ||p.project_id!==b.project_id||p.provider_id!==b.provider_id||p.agent_id!==b.agent_id||p.role!==b.role
      ||p.agent_generation_epoch!==b.agent_generation_epoch||t?.task_id!==b.task_id
      ||Number(t.lease_generation)!==b.lease_generation||t.lease_agent_id!==b.agent_id
      ||Number(t.lease_agent_generation_epoch)!==b.agent_generation_epoch)fail('binding_changed');
    const {job,execution}=await protectedJob(tx,value,p),j=job.payload;
    const native=await readNativeScope(p,false,tx);
    if(!same(native.postgres,p.postgres)||!same(native.artifact,p.artifact)||!same(native.worktree,p.worktree)
      ||native.user_sid!==p.user_sid||!same(processOnly(native.host_process),processOnly(j.host_process)))fail('host_scope_changed');
    const lease=buildNativeCodingTaskContext(t,{projectId:b.project_id,providerId:b.provider_id,
      verificationSubject:b.role==='CRITIC'?t.task_spec?.native_coding?.verification_subject:null}).value;
    const scope=buildNativeCodingExecutionScope(p,lease,native.host_process);
    if(execution?.state!=='ATTEMPTED'||Object.keys(scope).some(key=>String(execution[key])!==String(scope[key]))
      ||j.prompt_sha256!==lease.prompt_sha256||j.goal_id!==p.goal_id||j.goal_sha256!==p.goal_sha256||j.owner_epoch!==p.owner_epoch
      ||!same(j.worktree,p.worktree)||!same(j.artifact,p.artifact)||!same(j.postgres,p.postgres))fail('execution_changed');
    const worker=await readNativeWorker(value.job_binding.pid,{scope,permit:p,job});
    if(worker.pid!==value.job_binding.pid||worker.job_id!==value.job_binding.job_id||worker.run_id!==b.run_id
      ||worker.process_incarnation_id!==value.job_binding.process_incarnation_id||worker.user_sid!==p.user_sid
      ||!same(processOnly(worker),processOnly(j.worker_process))||worker.prompt_sha256!==j.prompt_sha256)fail('worker_changed');
    open();return c;
  }
  return Object.freeze({
    async invoke(request){
      const value=validateNativeCodingAgentHostRequest(request),a=value.args,run=value.binding.run_id;
      open();
      return sql.begin('isolation level serializable',async tx=>{
        await tx.unsafe('set local synchronous_commit=on');
        if(value.operation==='READ_INTENT'){
          // Historical status readback is not a grant to call a tool or launch
          // another worker. SQL independently checks the original run/device.
          await owner(tx);await protectedJob(tx,value);
          const rows=await tx.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1::uuid,$2::uuid) as value',[run,a.request_id]);
          const result=rows[0]?.value;
          if(rows.length!==1||result?.schema!=='metaengine.native-coding.agent-intent.v1'||result.run_id!==run
            ||result.request_id!==a.request_id||result.readback_only!==true||result.physical_effect_replayed!==false
            ||result.authority_effect!==false)fail('intent_readback_unconfirmed');
          open();return result;
        }
        await bound(tx,value);
        let result;
        if(value.operation==='CHECK')result={schema:'metaengine.native-coding.agent-authorized.v1',run_id:run,authorized:true,authority_effect:false};
        else if(value.operation==='project_overview')result=(await tx.unsafe('select destruktion_meta.native_coding_agent_overview_v1($1::uuid,$2::bigint,$3::integer) as value',[run,a.after_seq??0,a.limit??32]))[0]?.value;
        else if(value.operation==='project_history_page')result=(await tx.unsafe('select destruktion_meta.native_coding_agent_history_v1($1::uuid,$2::bigint,$3::bigint,$4::integer) as value',[run,a.after_seq,a.through_seq??null,a.limit]))[0]?.value;
        else if(value.operation==='agent_ack_message')result=(await tx.unsafe('select destruktion_meta.native_coding_agent_message_ack_v1($1::uuid,$2::uuid,$3::bigint) as value',[run,a.request_id,a.message_seq]))[0]?.value;
        else if(value.operation==='agent_send_message')result=(await tx.unsafe('select destruktion_meta.native_coding_agent_message_v1($1::uuid,$2::uuid,$3::text,$4::text) as value',[run,a.request_id,a.target_agent_id,a.message]))[0]?.value;
        else if(value.operation==='project_propose_children')result=(await tx.unsafe('select destruktion_meta.native_coding_agent_spawn_v1($1::uuid,$2::uuid,$3::jsonb) as value',[run,a.request_id,JSON.stringify(a.children)]))[0]?.value;
        if(!result||typeof result!=='object'||Array.isArray(result))fail('operation_unconfirmed');
        // The SQL operation itself rechecks the current lease and grant. This
        // final check also rolls a write back when Host closure races the call.
        open();return result;
      });
    },close(){closed=true;},
  });
}
