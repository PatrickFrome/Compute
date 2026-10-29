// TEST ONLY: real PG17 lifecycle with generated OS/job/Git receipt witnesses.
// This does not execute Codex, Git commit, a browser or installed Windows.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson as canonical,nativeCodingCanonicalSha256 as sha} from '../native-coding-task-context.mjs';
export async function completeChatNativePair({sql,fixture,writerPermitId,verdict='ACCEPT',onRunning=null}) {
 const generated=fixture.generated;
 const [row]=await sql.unsafe('select permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=$1',[writerPermitId]);
 const p=row.permit;
 const [cr]=await sql.unsafe("select permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit->>'project_id'=$1 and permit->>'role'='CRITIC' and permit->'worktree'=$2::jsonb and revoked_at is null",[p.project_id,sql.json(p.worktree)]);
 const criticPermit=cr.permit;
    async function register(permit) {
      const original=generated.payload(),{schema,issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,...scope}=permit;
      const payload={...original,...scope,target_id:'codex-cli:'+permit.provider_id,
        sandbox:{...original.sandbox,mode:permit.role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:permit.role==='CRITIC'},
        proven_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Math.min(Date.now()+50000,Date.parse(permit.expires_at))).toISOString()};
      const envelope=generated.envelope(payload);
      await sql.unsafe(`insert into destruktion_meta.native_coding_provider_registration_h205f22(permit_id,envelope,canonical_envelope,envelope_sha256)
        values($1,$2,$3,$4)on conflict(permit_id)do update set envelope=excluded.envelope,canonical_envelope=excluded.canonical_envelope,envelope_sha256=excluded.envelope_sha256`,
        [permit.permit_id,sql.json(envelope),canonical(envelope),sha(envelope)]);
    }
    async function heartbeat(jobs=[],budget=1) {
      // SQL-only generated witness fixture. Production ES256 verification stays
      // in the Host; this does not claim an installed/signed native execution.
      const rows=await sql.unsafe(`select p.permit_id,p.provider_id,p.agent_id,p.permit->>'role' as role,p.agent_generation_epoch,r.envelope_sha256
        from destruktion_meta.native_coding_operator_permit_h205f22 p join destruktion_meta.native_coding_provider_registration_h205f22 r using(permit_id)
        where p.workspace_id=$1 and p.revoked_at is null order by p.permit_id`,[p.workspace_id]);
      const body={host_instance_id:generated.permit.project_id,host_pid:generated.jobPayload.host_process.pid,operation:'SERVICE_HEARTBEAT',input:{
        schema:'metaengine.native-coding.service-heartbeat.v1',workspace_id:p.workspace_id,host_process:generated.jobPayload.host_process,
        artifact:p.artifact,postgres:p.postgres,control:{supervisor_mode:'CONTROL',armed:true,interrupted_setup_recovery_fenced:false,runtime_control_generation:0},
        runtime:{schema:'metaengine.native-coding.runtime.v1',physical_slot_budget:budget,occupied_slots:jobs.length,closed:false,shutdown_state:'OPEN',host_unavailable_reason:null,jobs},
        providers:rows.map(row=>({...row,agent_generation_epoch:Number(row.agent_generation_epoch)})),production_qualified:false,automatic_retry_allowed:false,authority_effect:false}};
      await sql.unsafe('select pg_sleep(0.002)');
      const headers={'content-type':'application/json','x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1','x-a2-device-id':p.device_id,
        'x-a2-chat-bridge-client':generated.clientId,'x-a2-device-body-sha256':sha(body),'x-a2-device-signature':'A'.repeat(86),
        'x-a2-device-nonce':randomUUID().replaceAll('-',''),'x-a2-device-timestamp':new Date().toISOString()};
      return sql.begin('isolation level serializable',async tx=>{
        await tx.unsafe('set local synchronous_commit=on');
        return tx.unsafe('select destruktion_meta.native_coding_service_heartbeat_v1($1,$2,1,$3,$4,$5::text::jsonb,$5::text,$6::text::jsonb)',
          [p.device_id,generated.clientId,body.host_instance_id,body.host_pid,canonical(body),canonical(headers)]);
      });
    }
    async function lease(permit) {
      await register(permit);await heartbeat();await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where workspace_id=$1',[p.workspace_id]);
      const [r]=await sql.unsafe(`select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900)as value`,
        [permit.workspace_id,permit.agent_id,permit.role,'native-coding:'+permit.provider_id,'codex-cli:'+permit.provider_id]);assert.equal(r.value.leased,true);return r.value;
    }
    async function reserve(permit,lease) {
      const scope={workspace_id:p.workspace_id,task_id:lease.task_id,lease_generation:Number(lease.lease_generation),agent_id:permit.agent_id,
        target_id:'codex-cli:'+permit.provider_id,agent_generation_epoch:1,reservation_id:randomUUID(),host_incarnation:generated.jobPayload.host_process.process_incarnation_id,scope_sha256:sha([lease.task_id,lease.lease_generation])};
      const [r]=await sql.unsafe(`select destruktion_meta.native_coding_reserve_v1($1,$2,$3,$4,$5,1,$6,$7,$8)as value`,
        [p.workspace_id,scope.task_id,scope.lease_generation,scope.agent_id,scope.target_id,scope.reservation_id,scope.host_incarnation,scope.scope_sha256]);return {...scope,...r.value};
    }
    const advance=(scope,from,to,evidence,criticSha=null,checkpointSha=null)=>sql.unsafe(`select destruktion_meta.native_coding_advance_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)as value`,
      [scope.task_id,scope.lease_generation,scope.reservation_id,scope.scope_sha256,scope.host_incarnation,from,to,evidence,criticSha,checkpointSha]);
    async function finish(permit,leased,{subject=null,verdict='ACCEPT',reserved=null,outcome='DONE',followups=[]}={}) {
      const scope=reserved||await reserve(permit,leased),run=randomUUID();
      const worker={...generated.jobPayload.worker_process,pid:permit.role==='CRITIC'?9002:9001,process_incarnation_id:'pid:'+(permit.role==='CRITIC'?9002:9001)+':created_100ns:134000000000000000'};
      const job=generated.envelope({...generated.jobPayload,...permit,schema:'metaengine.codex-cli.job-proof.v1',task_id:leased.task_id,
        target_id:'codex-cli:'+permit.provider_id,lease_generation:Number(leased.lease_generation),run_id:run,worker_process:worker,
        host_process:generated.jobPayload.host_process,subject});
      await sql.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22(task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256)
        values($1,$2,$3,$4,$5,$6,$7)`,[scope.task_id,scope.lease_generation,permit.permit_id,run,sql.json(job),canonical(job),sha(job)]);
      await advance(scope,'RESERVED','ATTEMPTED',sha(job));
      await sql.unsafe(`select public.devos_fleet_mark_running_v1($1,$2,$3,$4,$5,1,$6)`,[scope.task_id,permit.agent_id,scope.lease_generation,'native-coding:'+permit.provider_id,scope.target_id,
        sql.json({schema:'metaengine.native-coding.mark-running.v1',job_proof_sha256:sha(job),authority_effect:false})]);
      if(onRunning)await onRunning({run,scope,permit,lease:leased});
      const artifact=subject?.git_artifact_sha256||sha([run,'artifact']);
      const receipt={...generated.receipt,workspace_id:permit.workspace_id,project_id:permit.project_id,task_id:scope.task_id,lease_generation:scope.lease_generation,agent_id:permit.agent_id,run_id:run,
        role:permit.role,permit_id:permit.permit_id,worktree_path:permit.worktree.path,process_incarnation_id:worker.process_incarnation_id,result_sha256:sha([run,'result']),
        git_before:{head:permit.worktree.base_sha,artifact_sha256:artifact},git_after:{head:permit.worktree.base_sha,artifact_sha256:artifact},
        result:{schema:'metaengine.codex-cli.result.v1',role:permit.role,outcome,summary:'Generated SQL fixture',checks:[],followup_tasks:followups,
          ...(permit.role==='CRITIC'?{verdict,subject_result_sha256:subject.result_sha256}:{})},
        ...(subject?{subject_run_id:subject.run_id,subject_result_sha256:subject.result_sha256,subject_git_artifact_sha256:subject.git_artifact_sha256,subject_source_head:subject.source_head}:{})};
      await sql.unsafe(`update destruktion_meta.native_coding_job_registration_h205f22 set result_receipt=$1,canonical_result_receipt=$2,result_receipt_sha256=$3,result_registered_at=clock_timestamp()
        where task_id=$4 and lease_generation=$5`,[sql.json(receipt),canonical(receipt),sha(receipt),scope.task_id,scope.lease_generation]);
      await advance(scope,'ATTEMPTED','RESULT_READY',receipt.result_sha256);
      const summary={schema:'metaengine.native-coding.result-summary.v1',run_id:run,result_sha256:receipt.result_sha256,receipt_sha256:sha(receipt),
        git_artifact_sha256:artifact,source_head:permit.worktree.base_sha,useful_work_verified:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
      await sql.unsafe(`select public.devos_fleet_complete_v1($1,$2,$3,$4,$5,1,'RESULT_READY',$6,null)`,
        [scope.task_id,permit.agent_id,scope.lease_generation,'native-coding:'+permit.provider_id,scope.target_id,sql.json(summary)]);
      return {scope,job,receipt,subject:{run_id:run,result_sha256:receipt.result_sha256,git_artifact_sha256:artifact,source_head:permit.worktree.base_sha}};
    }
    const reconcile=async()=>{const [r]=await sql.unsafe('select public.h205f22_project_reconcile_v1($1,$2,$3,$4,1)as value',[p.workspace_id,p.project_id,p.device_id,generated.clientId]);return r.value;};
  async function checkpointFixture(f,writer,critic,{badCriticDigest=false}={}) {
    // Generated database fixture only: this exercises SQL acceptance/rollback,
    // not the separate Host's physical Git/OS checkpoint verification.
    const checkpoint={schema:'metaengine.native-coding.checkpoint.v1',trust_namespace:'LOCAL_OPERATOR_QA',checkpoint_id:randomUUID(),
      workspace_id:f.p.workspace_id,project_id:f.p.project_id,goal_id:f.p.goal_id,goal_sha256:f.p.goal_sha256,owner_epoch:f.p.owner_epoch,
      writer_task_id:writer.scope.task_id,writer_lease_generation:writer.scope.lease_generation,critic_task_id:critic.scope.task_id,critic_lease_generation:critic.scope.lease_generation,
      writer_run_id:writer.receipt.run_id,critic_run_id:critic.receipt.run_id,writer_receipt_sha256:sha(writer.receipt),
      critic_receipt_sha256:badCriticDigest?sha('not the registered CRITIC receipt'):sha(critic.receipt),result_sha256:writer.receipt.result_sha256,
      git_artifact_sha256:writer.receipt.git_after.artifact_sha256,source_head:writer.receipt.git_after.head,root_identity_sha256:f.p.worktree.root_identity_sha256,
      host_process:structuredClone(f.generated.jobPayload.host_process),artifact:structuredClone(f.p.artifact),postgres:structuredClone(f.p.postgres),
      worktree:structuredClone(f.p.worktree),writer_execution_scope:writer.scope,critic_execution_scope:critic.scope,verified_at:new Date().toISOString(),
      production_qualified:false,automatic_retry_allowed:false,successor_admitted:false,authority_effect:false};
    const checkpointSha=sha(checkpoint);
    async function commit() {
      return sql.begin('isolation level serializable',async tx=>{
        await tx.unsafe('set local synchronous_commit=on');
        await tx.unsafe(`insert into destruktion_meta.native_coding_checkpoint_h205f22(checkpoint_id,workspace_id,project_id,
          writer_task_id,writer_lease_generation,critic_task_id,critic_lease_generation,writer_run_id,critic_run_id,writer_receipt_sha256,critic_receipt_sha256,
          result_sha256,git_artifact_sha256,source_head,root_identity_sha256,checkpoint,canonical_checkpoint,checkpoint_sha256)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [checkpoint.checkpoint_id,checkpoint.workspace_id,checkpoint.project_id,checkpoint.writer_task_id,checkpoint.writer_lease_generation,
            checkpoint.critic_task_id,checkpoint.critic_lease_generation,checkpoint.writer_run_id,checkpoint.critic_run_id,checkpoint.writer_receipt_sha256,
            checkpoint.critic_receipt_sha256,checkpoint.result_sha256,checkpoint.git_artifact_sha256,checkpoint.source_head,checkpoint.root_identity_sha256,
            sql.json(checkpoint),canonical(checkpoint),checkpointSha]);
        for(const value of [writer,critic])await tx.unsafe(`select destruktion_meta.native_coding_advance_v1($1,$2,$3,$4,$5,'RESULT_READY','CHECKPOINTED',$6,$7,$8)`,
          [value.scope.task_id,value.scope.lease_generation,value.scope.reservation_id,value.scope.scope_sha256,value.scope.host_incarnation,
            value.receipt.result_sha256,checkpoint.critic_receipt_sha256,checkpointSha]);
        const [result]=await tx.unsafe('select destruktion_meta.native_coding_finalize_checkpoint_v1($1)as value',[checkpoint.checkpoint_id]);return result.value;
      });
    }
    return {checkpoint,checkpointSha,commit};
  }




 await register(p);await register(criticPermit);
 const writer=await finish(p,await lease(p));await reconcile();
 const critic=await finish(criticPermit,await lease(criticPermit),{subject:writer.subject,verdict});
 if(verdict==='REJECT'){await reconcile();return {writer,critic};}
 const staged=await checkpointFixture({p,generated},writer,critic);
 assert.equal((await staged.commit()).state,'CHECKPOINTED_PENDING_COMMIT');
 const k=staged.checkpoint;
 const receipt={schema:'metaengine.native-coding.git-commit-receipt.v1',project_id:k.project_id,checkpoint_id:k.checkpoint_id,
  checkpoint_sha256:staged.checkpointSha,state:'COMMITTED',previous_head:k.source_head,head:sha([k.checkpoint_id,'head']).slice(0,40),
  tree:sha([k.checkpoint_id,'tree']).slice(0,40),branch_ref:'refs/heads/generated-chat-led-test',root_identity_sha256:k.root_identity_sha256,
  reviewed_git_artifact_sha256:k.git_artifact_sha256,intent_sha256:sha([k.checkpoint_id,'intent']),
  working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true,
  production_qualified:false,successor_admitted:false,automatic_retry_allowed:false,authority_effect:false};
 const finalized=await sql.begin('isolation level serializable',async tx=>{
  await tx.unsafe('set local synchronous_commit=on');
  return (await tx.unsafe('select destruktion_meta.native_coding_finish_checkpoint_v1($1,$2::jsonb,$3,$4) as value',
   [k.checkpoint_id,sql.json(receipt),canonical(receipt),sha(receipt)]))[0].value;
 });
 return {writer,critic,checkpoint:k,receipt,finalized};
}
