import {createPublicKey} from 'node:crypto';
import {NativeCodingPgLedger} from '../../apps/metaengine-browser/src/native-coding-pg-ledger.mjs';
import {verifyNativeCodingProviderDescriptor,verifyNativeCodingJobProof,nativeCodingDeviceKeyFingerprint} from '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs';
import {validateCodexCliResult} from '../../apps/metaengine-browser/src/codex-cli-result-schema.mjs';
import {buildNativeCodingTaskContext,buildNativeCodingExecutionScope,nativeCodingCanonicalJson as json,
  nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {createNativeCodingCheckpointVerifier} from './native-coding-checkpoint-verifier.mjs';

const fail=reason=>{throw new Error('native_coding_host_'+reason);};
const same=(a,b)=>json(a)===json(b);
// The native Job helper records started_at with Windows' seven fractional
// digits; signed kernel identities use the same birth rounded down to ms.
const processProof=p=>({pid:p.pid,created_at:p.created_at??new Date(p.started_at).toISOString(),process_incarnation_id:p.process_incarnation_id});
const scopeKeys=['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256'];
const matchScope=(a,b)=>scopeKeys.every(key=>['lease_generation','agent_generation_epoch'].includes(key)
  ?Number(a?.[key])===Number(b?.[key]):a?.[key]===b?.[key]);
const publicDeviceKeys=['device_id','client_id','profile','public_jwk','key_fingerprint_sha256','admin_grant_epoch'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');

// Only runtime-host constructs this capability. The IPC protocol exposes
// these fixed operations, never this connection or arbitrary SQL/functions.
export async function createNativeCodingHostAuthority({sql,readNativeScope,readNativeWorker,readProtectedReceipt,readCheckpointScope}={}) {
  if(typeof sql?.unsafe!=='function'||typeof sql?.begin!=='function'
    ||![readNativeScope,readNativeWorker,readProtectedReceipt].every(x=>typeof x==='function')) fail('private_dependencies_required');
  async function owner(tx) {
    const role=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
    if(role.length!==1||role[0].current_user!=='state_owner'||role[0].session_user!=='state_owner') fail('state_owner_required');
  }
  await owner(sql);
  let closed=false;
  const open=()=>{if(closed)fail('closed');};
  const checkpointVerifier=typeof readCheckpointScope==='function'
    ?createNativeCodingCheckpointVerifier({readProtectedReceipt,readCheckpointScope}):null;
  const checkpointSelectors=['writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation'];
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  function projectId(value){if(!uuid.test(value||''))fail('project_id_invalid');return value;}
  function projectResult(id,state,candidate=null,digest=null) {
    return {schema:'metaengine.native-coding.project-checkpoint.v1',project_id:id,state,checkpoint_sha256:digest,
      ...Object.fromEntries(checkpointSelectors.map(key=>[key,candidate?.[key]??null])),successor_admitted:false,authority_effect:false};
  }
  async function checkpointCandidate(tx,id) {
    const rows=await tx.unsafe('select destruktion_meta.native_coding_checkpoint_candidate_v1($1::uuid) as value',[id]);
    if(rows.length!==1)fail('checkpoint_candidate_unavailable');
    const value=rows[0].value;if(value===null)return null;
    if(!exact(value,checkpointSelectors)||!uuid.test(value.writer_task_id||'')||!uuid.test(value.critic_task_id||'')
      ||value.writer_task_id===value.critic_task_id||['writer_lease_generation','critic_lease_generation'].some(key=>!Number.isSafeInteger(value[key])||value[key]<1))fail('checkpoint_candidate_invalid');
    return value;
  }
  async function checkpointReadback(tx,id) {
    const rows=await tx.unsafe(`select to_jsonb(k) as checkpoint,
      (we.state='CHECKPOINTED' and ce.state='CHECKPOINTED' and we.checkpoint_sha256=k.checkpoint_sha256
        and ce.checkpoint_sha256=k.checkpoint_sha256 and w.state='COMPLETED' and c.state='COMPLETED'
        and f.state='CHECKPOINTED_PENDING_COMMIT' and f.checkpoint_sha256=k.checkpoint_sha256) as finalized
      from destruktion_meta.native_coding_checkpoint_h205f22 k
      join destruktion_meta.native_coding_execution_h205f22 we on we.task_id=k.writer_task_id and we.lease_generation=k.writer_lease_generation
      join destruktion_meta.native_coding_execution_h205f22 ce on ce.task_id=k.critic_task_id and ce.lease_generation=k.critic_lease_generation
      join destruktion_meta.devos_fleet_task_h205f22 w on w.task_id=k.writer_task_id
      join destruktion_meta.devos_fleet_task_h205f22 c on c.task_id=k.critic_task_id
      join destruktion_meta.native_coding_worktree_fence_h205f22 f on f.workspace_id=k.workspace_id and f.root_identity_sha256=k.root_identity_sha256
        and f.writer_task_id=k.writer_task_id and f.writer_lease_generation=k.writer_lease_generation and f.project_id=k.project_id
      where k.project_id=$1::uuid order by k.created_at desc,k.checkpoint_id limit 1`,[id]);
    if(!rows.length)return null;
    const {checkpoint:k,finalized}=rows[0],record=k.checkpoint;
    if(finalized!==true||record?.schema!=='metaengine.native-coding.checkpoint.v1'||record.project_id!==id
      ||k.canonical_checkpoint!==json(record)||k.checkpoint_sha256!==sha(record)
      ||checkpointSelectors.some(key=>String(k[key])!==String(record[key])))return projectResult(id,'READBACK_REQUIRED',k);
    return projectResult(id,'CHECKPOINTED_PENDING_COMMIT',record,k.checkpoint_sha256);
  }
  async function checkpointBundle(tx,id,taskId,generation) {
    const rows=await tx.unsafe(`select p.permit,
      jsonb_build_object('workspace_id',p.workspace_id,'device_id',p.device_id,'client_id',p.client_id,
        'admin_grant_epoch',p.admin_grant_epoch,'revoked_at',p.revoked_at) as permit_binding,
      jsonb_build_object('device_id',d.device_id,'client_id',d.client_id,'profile',d.profile,'public_jwk',d.public_jwk,
        'key_fingerprint_sha256',d.key_fingerprint_sha256,'admin_grant_epoch',d.admin_grant_epoch) as device,
      to_jsonb(j) as registration,to_jsonb(e) as execution,to_jsonb(t) as task
      from destruktion_meta.native_coding_job_registration_h205f22 j
      join destruktion_meta.native_coding_operator_permit_h205f22 p using(permit_id)
      join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation)
      join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=j.task_id and t.lease_generation=j.lease_generation
      join destruktion_meta.project_task_h205f22 pt on pt.task_id=t.task_id
      join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=p.device_id and d.client_id=p.client_id
      where j.task_id=$1::uuid and j.lease_generation=$2::bigint and pt.project_id=$3::uuid
        and p.revoked_at is null and d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
        and d.admin_grant_epoch=p.admin_grant_epoch and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb
      for update of j,e for share of p,d,pt`,[taskId,generation,id]);
    if(rows.length!==1)fail('checkpoint_registered_pair_unavailable');return rows[0];
  }
  function validateContext(c) {
    const p=c?.permit,d=c?.device;
    if(c?.schema!=='metaengine.native-coding.admission-context.v1'||c.source!=='PROTECTED_OWN_PG_OPERATOR_REGISTRY'
      ||p?.schema!=='metaengine.native-coding.operator-permit.v1'||p.trust_namespace!=='LOCAL_OPERATOR_QA'
      ||p.revoked!==false||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(p.expires_at)<=Date.now()
      ||c.postgres_system_identifier!==p.postgres?.system_identifier||!exact(d,publicDeviceKeys)
      ||d.device_id!==p.device_id||d.profile!=='A2_DEVICE_HTTP_SIGNATURE_V1'
      ||d.key_fingerprint_sha256!==p.device_key_fingerprint_sha256||!Number.isSafeInteger(d.admin_grant_epoch)
      ||d.admin_grant_epoch<1||!exact(d.public_jwk,['crv','ext','key_ops','kty','x','y'])
      ||nativeCodingDeviceKeyFingerprint(createPublicKey({key:d.public_jwk,format:'jwk'}))!==d.key_fingerprint_sha256) fail('protected_context_invalid');
    return c;
  }
  async function context(tx,permitId,{requireActive=true,lock=false}={}) {
    const rows=await tx.unsafe(`select public.native_coding_admission_context_v1(p.workspace_id,p.client_id,p.permit_id) as context
      from destruktion_meta.native_coding_operator_permit_h205f22 p
      join destruktion_meta.project_run_h205f22 r on r.project_id=(p.permit->>'project_id')::uuid
        and r.workspace_id=p.workspace_id and r.device_id=p.device_id and r.client_id=p.client_id
        and r.admin_grant_epoch=p.admin_grant_epoch
      join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=p.device_id and d.client_id=p.client_id
      where p.permit_id=$1::uuid and p.revoked_at is null and (not $2::boolean or r.state='ACTIVE')
      ${lock?'for share of p,r,d':''}`,[permitId,requireActive]);
    if(rows.length!==1||!rows[0].context?.permit||!rows[0].context?.device) fail('permit_unavailable');
    return validateContext(rows[0].context);
  }
  async function task(tx,query,{requireLive=true,lock=false}={}) {
    const rows=await tx.unsafe(`select to_jsonb(t) as task from destruktion_meta.devos_fleet_task_h205f22 t
      where t.task_id=$1::uuid and t.workspace_id=$2::uuid and t.lease_generation=$3::bigint ${lock?'for share of t':''}`,
      [query.task_id,query.workspace_id,query.lease_generation]);
    const t=rows[0]?.task;
    if(rows.length!==1||!t?.task_spec?.native_coding?.permit_id) fail('task_unavailable');
    const c=await context(tx,t.task_spec.native_coding.permit_id,{requireActive:requireLive,lock}),p=c.permit;
    if(t.lease_target_id!==`codex-cli:${p.provider_id}`||t.lease_agent_id!==p.agent_id
      ||Number(t.lease_agent_generation_epoch)!==p.agent_generation_epoch||t.role!==p.role||t.base_sha!==p.worktree.base_sha
      ||t.workspace_id!==p.workspace_id||t.lease_tab_id!==`native-coding:${p.provider_id}`
      ||t.task_spec.native_coding.goal_id!==p.goal_id||t.task_spec.native_coding.goal_sha256!==p.goal_sha256
      ||t.task_spec.native_coding.project_id!==p.project_id
      ||query.agent_id!==p.agent_id||query.provider_id&&query.provider_id!==p.provider_id
      ||query.project_id&&query.project_id!==p.project_id) fail('task_binding_mismatch');
    if(requireLive) {
      const claims=await tx.unsafe(`select 1 from destruktion_meta.devos_fleet_claim_h205f22 where task_id=$1::uuid
        and workspace_id=$2::uuid and lease_generation=$3::bigint and agent_id=$4::text and target_id=$5::text
        and agent_generation_epoch=$6::bigint and tab_id=$7::text and state='ACTIVE' and expires_at>clock_timestamp()
        ${lock?'for share':''}`,
        [t.task_id,t.workspace_id,t.lease_generation,p.agent_id,t.lease_target_id,p.agent_generation_epoch,t.lease_tab_id]);
      if(claims.length!==1||!['LEASED','RUNNING'].includes(t.state)||Date.parse(t.lease_expires_at)<=Date.now()) fail('lease_not_live');
    }
    const linked=await tx.unsafe(`select 1 from destruktion_meta.project_task_h205f22 pt
      join destruktion_meta.project_run_h205f22 r using(project_id)
      where pt.task_id=$1::uuid and r.project_id=$2::uuid and r.workspace_id=$3::uuid`,[t.task_id,p.project_id,p.workspace_id]);
    if(linked.length!==1) fail('project_task_unbound');
    const subject=p.role==='CRITIC'?t.task_spec.native_coding.verification_subject:null;
    const built=['LEASED','RUNNING'].includes(t.state)
      ?buildNativeCodingTaskContext(t,{projectId:p.project_id,providerId:p.provider_id,verificationSubject:subject})
      :{value:null,task_prompt:null};
    return {...c,task:t,...built};
  }
  function expected(envelope,c,native) {
    const p=c.permit;
    if(!same(native.postgres,p.postgres)||!same(native.artifact,p.artifact)||!same(native.worktree,p.worktree)
      ||native.user_sid!==p.user_sid||!native.sandbox) fail('native_scope_changed');
    const value={...envelope.payload};
    for(const key of ['permit_id','goal_id','goal_sha256','owner_epoch','user_sid','workspace_id','project_id','provider_id',
      'agent_id','role','agent_generation_epoch','device_id','artifact','postgres','worktree']) value[key]=p[key];
    Object.assign(value,{device_key_fingerprint_sha256:c.device.key_fingerprint_sha256,
      host_process:native.host_process,sandbox:native.sandbox,
      expires_at:new Date(Math.min(Date.parse(envelope.payload.expires_at),Date.parse(p.expires_at))).toISOString()});
    if(envelope.payload.schema==='metaengine.codex-cli.transport-proof.v1') value.physical_slot_budget=p.physical_slot_budget;
    return value;
  }
  const key=c=>createPublicKey({key:c.device.public_jwk,format:'jwk'});
  const ledger=tx=>new NativeCodingPgLedger({transaction:fn=>fn(tx)});
  async function scoped(tx,scope,requireLive=true) {
    const c=await task(tx,{...scope,provider_id:String(scope.target_id).slice('codex-cli:'.length)},{requireLive,lock:true});
    const historical=c.value??{task_id:c.task.task_id,workspace_id:c.task.workspace_id,project_id:c.permit.project_id,
      provider_id:c.permit.provider_id,agent_id:c.task.lease_agent_id,target_id:c.task.lease_target_id,
      agent_generation_epoch:Number(c.task.lease_agent_generation_epoch),lease_generation:Number(c.task.lease_generation),
      role:c.task.role,base_sha:c.task.base_sha};
    const native=await readNativeScope(c.permit),actual=buildNativeCodingExecutionScope(c.permit,historical,native.host_process);
    if(Date.parse(c.permit.expires_at)<=Date.now()||!matchScope(scope,actual)
      ||!same(native.postgres,c.permit.postgres)||!same(native.artifact,c.permit.artifact)
      ||native.user_sid!==c.permit.user_sid||native.worktree?.path!==c.permit.worktree.path
      ||native.worktree?.root_identity_sha256!==c.permit.worktree.root_identity_sha256
      ||requireLive&&native.worktree.base_sha!==c.permit.worktree.base_sha) fail('execution_scope_changed');
    return {c,native};
  }
  async function write(operation) {
    open();
    try {return await sql.begin('isolation level serializable',async tx=>{
      await owner(tx);await tx.unsafe('set local synchronous_commit=on');
      const result=await operation(tx);open();return result;
    });}
    catch {throw Object.assign(new Error('native_coding_host_write_unknown_readback_required'),{effect_outcome:'UNKNOWN',automatic_retry_allowed:false});}
  }
  return Object.freeze({
    async READ_SCOPE() {
      open();const native=await readNativeScope(null);
      const rows=await sql.unsafe(`select public.native_coding_admission_context_v1(p.workspace_id,p.client_id,p.permit_id) as context
        from destruktion_meta.native_coding_operator_permit_h205f22 p
        join destruktion_meta.project_run_h205f22 r on r.project_id=(p.permit->>'project_id')::uuid and r.workspace_id=p.workspace_id
          and r.device_id=p.device_id and r.client_id=p.client_id and r.admin_grant_epoch=p.admin_grant_epoch and r.state='ACTIVE'
        join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=p.device_id and d.client_id=p.client_id
          and d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
          and d.admin_grant_epoch=p.admin_grant_epoch and d.profile='A2_DEVICE_HTTP_SIGNATURE_V1'
          and d.key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256'
          and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb
        where p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
        and p.permit->'postgres'->>'system_identifier'=$1::text and p.permit->>'user_sid'=$2::text
        order by p.permit_id limit 65`,[native.postgres.system_identifier,native.user_sid]);
      if(rows.length>64) fail('provider_budget_exceeded');
      const bindings=rows.map(({context:value})=>{const c=validateContext(value);return {permit_id:c.permit.permit_id,provider_id:c.permit.provider_id,
        agent_id:c.permit.agent_id,workspace_id:c.permit.workspace_id,project_id:c.permit.project_id,
        device_id:c.device.device_id,client_id:c.device.client_id,permit:c.permit,device:c.device};});
      return {schema:'metaengine.native-coding.own-pg-scope.v1',source:'PRIVATE_RUNTIME_HOST_OWN_PG',
        observed_at:new Date().toISOString(),postgres:native.postgres,bindings};
    },
    async READ_LEASE(query) {
      open();const c=await task(sql,query);
      return {schema:'metaengine.native-coding.own-pg-lease.v1',source:'PRIVATE_RUNTIME_HOST_OWN_PG',
        observed_at:new Date().toISOString(),value:c.value,task_prompt:c.task_prompt};
    },
    async REGISTER_PROVIDER({descriptor}) {
      return write(async tx=>{
        const c=await context(tx,descriptor?.payload?.permit_id,{lock:true}),native=await readNativeScope(c.permit);
        verifyNativeCodingProviderDescriptor(descriptor,{publicKey:key(c),expected:expected(descriptor,c,native),now:Date.now()});
        const text=json(descriptor),digest=sha(descriptor);
        const rows=await tx.unsafe(`insert into destruktion_meta.native_coding_provider_registration_h205f22
          (permit_id,envelope,canonical_envelope,envelope_sha256) values($1::uuid,$2::text::jsonb,$2::text,$3::text)
          on conflict(permit_id) do update set envelope=excluded.envelope,canonical_envelope=excluded.canonical_envelope,
            envelope_sha256=excluded.envelope_sha256,registered_at=clock_timestamp() returning envelope_sha256`,[c.permit.permit_id,text,digest]);
        if(rows.length!==1||rows[0].envelope_sha256!==digest) fail('registration_readback_mismatch');
        return {registered:true,provider_id:c.permit.provider_id,envelope_sha256:digest};
      });
    },
    async RESERVE_EXECUTION({scope}) {return write(async tx=>{await scoped(tx,scope);return ledger(tx).reserve(scope);});},
    async READ_EXECUTION({scope}) {
      open();const c=await task(sql,{...scope,provider_id:String(scope.target_id).slice('codex-cli:'.length)},{requireLive:false});
      const row=await ledger(sql).read(scope);
      // Historical readback may name the previous Host incarnation. It is
      // evidence only, but still must be the exact requested durable scope.
      if(row&&!matchScope(scope,row))fail('execution_readback_scope_mismatch');
      return row?{...row,task_state:c.task.state,task_result_summary:c.task.result_summary}:null;
    },
    async ADVANCE_EXECUTION({scope,transition}) {
      if(transition?.to==='CHECKPOINTED') fail('independent_checkpoint_verifier_unbound');
      return write(async tx=>{
        const {c,native}=await scoped(tx,scope,transition.to==='ATTEMPTED');
        if(transition.to==='ATTEMPTED') {
          const envelope=transition.job_proof,payload=envelope?.payload;
          const worker=await readNativeWorker(payload?.worker_process?.pid,{scope,permit:c.permit,job:envelope});
          const wanted={...expected(envelope,c,native),task_id:c.value.task_id,lease_generation:c.value.lease_generation,
            lease_expires_at:c.value.expires_at,prompt_sha256:c.value.prompt_sha256,
            worker_process:processProof(worker),job_id:worker.job_id,run_id:worker.run_id};
          if(worker.prompt_sha256!==c.value.prompt_sha256||worker.user_sid!==native.user_sid) fail('worker_scope_changed');
          if(c.permit.role==='CRITIC') {
            const subject=c.value.verification_subject;
            const writers=await tx.unsafe(`select j.job_envelope,j.result_receipt from destruktion_meta.native_coding_job_registration_h205f22 j
              join destruktion_meta.native_coding_operator_permit_h205f22 p using(permit_id)
              join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation)
              join destruktion_meta.project_task_h205f22 pt on pt.task_id=j.task_id
              where j.run_id=$1::uuid and j.result_receipt->>'result_sha256'=$2::text
                and p.workspace_id=$3::uuid and (p.permit->>'project_id')::uuid=$4::uuid
                and pt.project_id=$4::uuid and p.permit->>'role'='IMPLEMENTER'
                and e.state in ('RESULT_READY','CHECKPOINTED')`,[subject.run_id,subject.result_sha256,c.permit.workspace_id,c.permit.project_id]);
            const writer=writers[0];if(writers.length!==1||!writer.result_receipt)fail('critic_subject_unregistered');
            if(subject.source_head!==c.permit.worktree.base_sha||writer.result_receipt.role!=='IMPLEMENTER'||writer.result_receipt.result?.outcome!=='DONE'
              ||writer.result_receipt.git_after?.artifact_sha256!==subject.git_artifact_sha256
              ||writer.result_receipt.git_after?.head!==subject.source_head)fail('critic_subject_changed');
            wanted.subject={...subject,agent_id:writer.result_receipt.agent_id,worker_process:writer.job_envelope.payload.worker_process};
          } else wanted.subject=null;
          verifyNativeCodingJobProof(envelope,{publicKey:key(c),expected:wanted,now:Date.now()});
          if(sha(envelope)!==transition.evidence_sha256) fail('job_digest_mismatch');
          await tx.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22
            (task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256)
            values($1::uuid,$2::bigint,$3::uuid,$4::uuid,$5::text::jsonb,$5::text,$6::text)`,
            [scope.task_id,scope.lease_generation,c.permit.permit_id,payload.run_id,json(envelope),sha(envelope)]);
        } else if(transition.to==='RESULT_READY') {
          const rows=await tx.unsafe(`select job_envelope from destruktion_meta.native_coding_job_registration_h205f22
            where task_id=$1::uuid and lease_generation=$2::bigint for update`,[scope.task_id,scope.lease_generation]);
          if(rows.length!==1)fail('job_unregistered');
          const job=rows[0].job_envelope,receipt=await readProtectedReceipt({scope,permit:c.permit,job});
          if(!same(receipt,transition.result_receipt)||receipt.schema!=='metaengine.codex-cli.run-receipt.v1'
            ||receipt.provider!=='CODEX_CLI'||receipt.trust_namespace!=='LOCAL_OPERATOR_QA'
            ||receipt.state!=='RESULT_READY'||receipt.task_id!==scope.task_id
            ||receipt.lease_generation!==scope.lease_generation||receipt.agent_id!==scope.agent_id||receipt.run_id!==job.payload.run_id
            ||receipt.agent_generation_epoch!==scope.agent_generation_epoch||receipt.permit_id!==c.permit.permit_id
            ||receipt.base_sha!==c.permit.worktree.base_sha
            ||receipt.workspace_id!==c.permit.workspace_id||receipt.project_id!==c.permit.project_id
            ||receipt.owner_epoch!==c.permit.owner_epoch||receipt.user_sid!==c.permit.user_sid
            ||receipt.executable_sha256!==c.permit.artifact.cli_executable_sha256||receipt.worktree_path!==c.permit.worktree.path
            ||receipt.sandbox_mode!==(c.permit.role==='CRITIC'?'read-only':'workspace-write')
            ||receipt.prompt_sha256!==job.payload.prompt_sha256||receipt.pid!==job.payload.worker_process.pid
            ||receipt.role!==c.permit.role||receipt.result_sha256!==transition.evidence_sha256
            ||receipt.process_incarnation_id!==job.payload.worker_process.process_incarnation_id
            ||receipt.process?.job_id!==job.payload.job_id||!same(processProof(receipt.process),job.payload.worker_process)
            ||receipt.process?.started_suspended!==true||receipt.process?.tree_control_bound!==true
            ||receipt.process?.job_bound_before_resume!==true||receipt.process?.process_tree_control!=='WINDOWS_JOB_OBJECT'
            ||receipt.process_result?.exit_code!==0||receipt.process_result?.signal!=null
            ||receipt.process_result?.tree_cleanup_confirmed!==true||receipt.process_result?.reason
            ||receipt.process_result?.process_tree_control!=='WINDOWS_JOB_OBJECT'
            ||receipt.useful_work_verified!==false||receipt.model_claim_authority!==false||receipt.automatic_retry_allowed!==false
            ||receipt.authority_effect!==false||receipt.production_qualified!==false
            ||receipt.git_before?.head!==c.permit.worktree.base_sha||receipt.git_after?.head!==native.worktree.base_sha
            ||!/^[a-f0-9]{64}$/.test(receipt.git_after?.artifact_sha256||'')) fail('result_receipt_unverified');
          validateCodexCliResult(receipt.result,c.permit.role,job.payload.subject?.result_sha256??null);
          if(c.permit.role==='CRITIC'&&(receipt.subject_run_id!==job.payload.subject.run_id
            ||receipt.subject_result_sha256!==job.payload.subject.result_sha256
            ||receipt.subject_git_artifact_sha256!==job.payload.subject.git_artifact_sha256
            ||receipt.subject_source_head!==job.payload.subject.source_head
            ||receipt.git_before?.head!==job.payload.subject.source_head
            ||receipt.git_before?.artifact_sha256!==job.payload.subject.git_artifact_sha256
            ||receipt.git_before?.artifact_sha256!==receipt.git_after?.artifact_sha256))fail('critic_receipt_mismatch');
          const changed=await tx.unsafe(`update destruktion_meta.native_coding_job_registration_h205f22
            set result_receipt=$3::text::jsonb,canonical_result_receipt=$3::text,result_receipt_sha256=$4::text,result_registered_at=clock_timestamp()
            where task_id=$1::uuid and lease_generation=$2::bigint and result_receipt is null returning result_receipt_sha256`,
            [scope.task_id,scope.lease_generation,json(receipt),sha(receipt)]);
          if(changed.length!==1||changed[0].result_receipt_sha256!==sha(receipt))fail('result_registration_unknown');
        }
        return ledger(tx).advance(scope,transition);
      });
    },
    async READ_PROJECT_CHECKPOINT({project_id}) {
      open();const id=projectId(project_id),candidate=await checkpointCandidate(sql,id);open();
      if(candidate)return projectResult(id,'PENDING',candidate);
      const result=await checkpointReadback(sql,id);open();return result??projectResult(id,'PENDING');
    },
    async RECONCILE_PROJECT({project_id}) {
      const id=projectId(project_id);
      return write(async tx=>{
        const candidate=await checkpointCandidate(tx,id);
        if(candidate===null)return await checkpointReadback(tx,id)??projectResult(id,'PENDING');
        if(!checkpointVerifier)fail('checkpoint_private_reader_unbound');
        // Same lock order as the existing W30/project reconciler: tasks first,
        // then project. No caller-provided receipt or Host incarnation enters.
        const locks=await tx.unsafe(`select task_id from destruktion_meta.devos_fleet_task_h205f22
          where task_id in ($1::uuid,$2::uuid) order by task_id for update`,[candidate.writer_task_id,candidate.critic_task_id]);
        if(locks.length!==2)fail('checkpoint_tasks_unavailable');
        const projects=await tx.unsafe('select to_jsonb(r) as project from destruktion_meta.project_run_h205f22 r where project_id=$1::uuid for share',[id]);
        if(projects.length!==1)fail('checkpoint_project_unavailable');
        const writer=await checkpointBundle(tx,id,candidate.writer_task_id,candidate.writer_lease_generation);
        const critic=await checkpointBundle(tx,id,candidate.critic_task_id,candidate.critic_lease_generation);
        const verified=await checkpointVerifier.verify({project:projects[0].project,writer,critic});open();
        const k=verified.checkpoint;
        const inserted=await tx.unsafe(`insert into destruktion_meta.native_coding_checkpoint_h205f22
          (checkpoint_id,workspace_id,project_id,writer_task_id,writer_lease_generation,critic_task_id,critic_lease_generation,
            writer_run_id,critic_run_id,writer_receipt_sha256,critic_receipt_sha256,result_sha256,git_artifact_sha256,
            source_head,root_identity_sha256,checkpoint,canonical_checkpoint,checkpoint_sha256)
          values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::uuid,$7::bigint,$8::uuid,$9::uuid,$10::text,$11::text,
            $12::text,$13::text,$14::text,$15::text,$16::text::jsonb,$16::text,$17::text) returning checkpoint_sha256`,
          [k.checkpoint_id,k.workspace_id,k.project_id,k.writer_task_id,k.writer_lease_generation,k.critic_task_id,k.critic_lease_generation,
            k.writer_run_id,k.critic_run_id,k.writer_receipt_sha256,k.critic_receipt_sha256,k.result_sha256,k.git_artifact_sha256,
            k.source_head,k.root_identity_sha256,verified.canonical_checkpoint,verified.checkpoint_sha256]);
        if(inserted.length!==1||inserted[0].checkpoint_sha256!==verified.checkpoint_sha256)fail('checkpoint_insert_unconfirmed');
        for(const value of [verified.critic,verified.writer])await ledger(tx).advance(value.execution_scope,
          {from:'RESULT_READY',to:'CHECKPOINTED',evidence_sha256:value.receipt.result_sha256,
            critic_proof_sha256:verified.critic.receipt_sha256,checkpoint_sha256:verified.checkpoint_sha256});
        open();
        const finalized=await tx.unsafe('select destruktion_meta.native_coding_finalize_checkpoint_v1($1::uuid) as value',[k.checkpoint_id]);
        if(finalized.length!==1||finalized[0].value?.state!=='CHECKPOINTED_PENDING_COMMIT'
          ||finalized[0].value.checkpoint_sha256!==verified.checkpoint_sha256||finalized[0].value.successor_admitted!==false
          ||checkpointSelectors.some(key=>String(finalized[0].value[key])!==String(k[key])))fail('checkpoint_finalize_unconfirmed');
        return projectResult(id,'CHECKPOINTED_PENDING_COMMIT',k,verified.checkpoint_sha256);
      });
    },
    close(){closed=true;checkpointVerifier?.close();},
  });
}
