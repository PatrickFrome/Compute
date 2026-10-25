import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {buildNativeCodingTaskContext,buildNativeCodingExecutionScope,nativeCodingCanonicalSha256 as sha}
  from './native-coding-task-context.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

// The transaction double stages registrations and CAS together. These are
// generated signatures / private-reader fixtures, never physical OS evidence.
async function fixture({executionState='RESERVED',postExecutionHead=null,role='IMPLEMENTER'}={}) {
  const f=admissionFixture(),calls=[],committed={job:null,result:null,execution:null};
  f.permit.role=role;
  const writer={workspace_id:f.workspaceId,project_id:f.permit.project_id,
    job_envelope:structuredClone(f.job),result_receipt:{...structuredClone(f.receipt),role:'IMPLEMENTER',
      agent_id:'agent_native-writer01',result:{outcome:'DONE'}}};
  writer.job_envelope.payload.worker_process={...f.jobPayload.worker_process,pid:9002,
    process_incarnation_id:f.jobPayload.worker_process.process_incarnation_id.replace('pid:9001:','pid:9002:')};
  writer.result_receipt.run_id=randomUUID();writer.result_receipt.git_after.artifact_sha256='2'.repeat(64);
  const subject=role==='CRITIC'?{run_id:writer.result_receipt.run_id,result_sha256:writer.result_receipt.result_sha256,
    git_artifact_sha256:writer.result_receipt.git_after.artifact_sha256,source_head:writer.result_receipt.git_after.head}:null;
  const native={artifact:structuredClone(f.permit.artifact),postgres:structuredClone(f.permit.postgres),
    worktree:structuredClone(f.permit.worktree),host_process:f.provider.payload.host_process,
    user_sid:f.permit.user_sid,sandbox:{...f.provider.payload.sandbox,mode:role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:role==='CRITIC'}};
  const task={task_id:f.jobPayload.task_id,workspace_id:f.workspaceId,role:f.permit.role,state:'LEASED',
    lease_generation:1,lease_agent_id:f.permit.agent_id,lease_target_id:`codex-cli:${f.permit.provider_id}`,
    lease_tab_id:`native-coding:${f.permit.provider_id}`,lease_agent_generation_epoch:1,
    lease_expires_at:f.jobPayload.lease_expires_at,base_sha:f.permit.worktree.base_sha,
    task_spec:{objective:'Implement the disposable fixture task',native_coding:{permit_id:f.permit.permit_id,
      goal_id:f.permit.goal_id,goal_sha256:f.permit.goal_sha256,project_id:f.permit.project_id}}};
  if(subject)task.task_spec.native_coding.verification_subject=subject;
  const built=buildNativeCodingTaskContext(task,{projectId:f.permit.project_id,providerId:f.permit.provider_id,verificationSubject:subject});
  const scope={...buildNativeCodingExecutionScope(f.permit,built.value,native.host_process),reservation_id:randomUUID()};
  const jobPayload={...f.jobPayload,role,sandbox:native.sandbox,prompt_sha256:built.value.prompt_sha256,job_id:f.jobPayload.run_id,
    subject:subject?{...subject,agent_id:writer.result_receipt.agent_id,worker_process:writer.job_envelope.payload.worker_process}:null};
  const job=f.envelope(jobPayload);
  const process={...jobPayload.worker_process,started_at:jobPayload.worker_process.created_at,
    job_id:jobPayload.job_id,started_suspended:true,tree_control_bound:true,job_bound_before_resume:true,
    process_tree_control:'WINDOWS_JOB_OBJECT'};
  delete process.created_at; // Real native helper uses started_at, not created_at.
  const receipt={...f.receipt,role,provider:'CODEX_CLI',workspace_id:f.workspaceId,project_id:f.permit.project_id,
    base_sha:f.permit.worktree.base_sha,
    user_sid:f.permit.user_sid,worktree_path:f.permit.worktree.path,prompt_sha256:built.value.prompt_sha256,
    sandbox_mode:role==='CRITIC'?'read-only':'workspace-write',pid:jobPayload.worker_process.pid,process,
    process_result:{exit_code:0,signal:null,reason:null,tree_cleanup_confirmed:true,process_tree_control:'WINDOWS_JOB_OBJECT'},
    git_before:{head:f.permit.worktree.base_sha,artifact_sha256:'1'.repeat(64)},
    git_after:{head:postExecutionHead??f.permit.worktree.base_sha,artifact_sha256:'2'.repeat(64)},
    useful_work_verified:false,model_claim_authority:false,
    result:{schema:'metaengine.codex-cli.result.v1',role,outcome:'DONE',summary:'Fixture result',checks:[],followup_tasks:[]}};
  if(subject)Object.assign(receipt,{subject_run_id:subject.run_id,subject_result_sha256:subject.result_sha256,
    subject_git_artifact_sha256:subject.git_artifact_sha256,subject_source_head:subject.source_head,
    git_before:{head:subject.source_head,artifact_sha256:subject.git_artifact_sha256},
    result:{...receipt.result,verdict:'ACCEPT',subject_result_sha256:subject.result_sha256}});
  // Match the real runner's leaseBinding receipt: transport target/tab are
  // carried by the registered job proof, not duplicated into this receipt.
  delete receipt.target_id;delete receipt.tab_id;
  if(postExecutionHead)native.worktree.base_sha=postExecutionHead;
  committed.execution={...scope,state:executionState,automatic_retry_allowed:false,authority_effect:false};
  if(executionState==='ATTEMPTED')committed.job=structuredClone(job);
  const controls={failCas:false,role:'state_owner',session:'state_owner',context:f.context(),
    worker:{...jobPayload.worker_process,user_sid:f.permit.user_sid,job_id:jobPayload.job_id,run_id:jobPayload.run_id,
      prompt_sha256:built.value.prompt_sha256},receipt,writer,projectActive:true,projectBound:true};
  async function execute(store,text,values=[]) {
    calls.push({text,values});
    if(text.startsWith('select current_user'))return[{current_user:controls.role,session_user:controls.session}];
    if(text.startsWith('set local '))return[];
    if(text.includes('native_coding_admission_context_v1')) {
      if(!controls.projectBound||values[1]===true&&!controls.projectActive)return[];
      if(text.includes('order by p.permit_id'))return (controls.scopeContexts??[controls.context])
        .filter(context=>context.permit.permit_id>values[2])
        .sort((left,right)=>left.permit.permit_id.localeCompare(right.permit.permit_id))
        .slice(0,33).map(context=>({context:structuredClone(context)}));
      return[{context:structuredClone(controls.context)}];
    }
    if(text.startsWith('select to_jsonb(t)'))return[{task:structuredClone(task)}];
    if(text.includes('from destruktion_meta.devos_fleet_claim'))return[{one:1}];
    if(text.startsWith('select 1 from destruktion_meta.project_task'))return[{one:1}];
    if(text.startsWith('insert into destruktion_meta.native_coding_provider_registration'))return[{envelope_sha256:values[2]}];
    if(text.startsWith('insert into destruktion_meta.native_coding_job_registration')) {
      if(store.job)throw Error('fixture_unique_job');store.job=JSON.parse(values[4]);return[];
    }
    if(text.startsWith('select j.job_envelope,j.result_receipt'))return controls.writer.workspace_id===values[2]
      &&controls.writer.project_id===values[3]?[controls.writer]:[];
    if(text.startsWith('select job_envelope from destruktion_meta.native_coding_job_registration'))return store.job?[{job_envelope:store.job}]:[];
    if(text.startsWith('update destruktion_meta.native_coding_job_registration')) {
      if(store.result)return[];store.result=JSON.parse(values[2]);return[{result_receipt_sha256:values[3]}];
    }
    if(text.includes('native_coding_read_v1'))return[{value:structuredClone(store.execution)}];
    if(text.includes('native_coding_reserve_v1'))return[{value:{inserted:false,execution:structuredClone(store.execution)}}];
    if(text.includes('native_coding_advance_v1')) {
      if(controls.failCas||store.execution.state!==values[5])throw Error('fixture_cas_rejected');
      store.execution={...store.execution,state:values[6]};return[{value:structuredClone(store.execution)}];
    }
    throw Error('unexpected_fixture_query:'+text);
  }
  const sql={unsafe:(text,values)=>execute(committed,text,values),begin:async(mode,callback)=>{
    calls.push({mode});const staged=structuredClone(committed);
    const result=await callback({unsafe:(text,values)=>execute(staged,text,values)});
    Object.assign(committed,staged);return result;
  }};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope:async()=>structuredClone(native),
    readNativeWorker:async()=>structuredClone(controls.worker),readProtectedReceipt:async()=>structuredClone(controls.receipt)});
  const attempted={from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha(job),critic_proof_sha256:null,checkpoint_sha256:null,job_proof:job};
  const ready={from:'ATTEMPTED',to:'RESULT_READY',evidence_sha256:receipt.result_sha256,critic_proof_sha256:null,checkpoint_sha256:null,result_receipt:receipt};
  return {f,task,native,scope,job,receipt,controls,calls,committed,authority,attempted,ready};
}
const unknown=error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false;

test('a current signed job registration and execution CAS commit in the same serializable barrier',async()=>{
  const x=await fixture();const result=await x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted});
  assert.equal(result.state,'ATTEMPTED');assert.deepEqual(x.committed.job,x.job);
  assert.equal(x.committed.execution.state,'ATTEMPTED');
  assert.ok(x.calls.some(call=>call.mode==='isolation level serializable'));
  assert.ok(x.calls.findIndex(call=>call.text?.startsWith('insert into destruktion_meta.native_coding_job_registration'))
    <x.calls.findIndex(call=>call.text?.includes('native_coding_advance_v1')));
});

test('failed execution CAS rolls back the job proof and never authorizes an automatic retry',async()=>{
  const x=await fixture();x.controls.failCas=true;
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted}),unknown);
  assert.equal(x.committed.job,null);assert.equal(x.committed.execution.state,'RESERVED');
  assert.equal(x.calls.filter(call=>call.mode).length,1);
});

test('state_owner is checked again inside each write transaction',async()=>{
  const x=await fixture();x.controls.role='service_role';
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted}),unknown);
  assert.equal(x.committed.job,null);assert.equal(x.calls.some(call=>call.text?.startsWith('insert ')),false);
});

test('task goal, project, workspace and native tab cannot drift behind an existing lease',async()=>{
  const mutations=[x=>x.task.task_spec.native_coding.goal_id=randomUUID(),x=>x.task.task_spec.native_coding.goal_sha256='f'.repeat(64),
    x=>x.task.task_spec.native_coding.project_id=randomUUID(),x=>x.task.workspace_id=randomUUID(),x=>x.task.lease_tab_id='native-coding:foreign'];
  for(const change of mutations){const x=await fixture();change(x);
    await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted}),unknown);
    assert.equal(x.committed.job,null);}
});

test('private context excludes inactive or foreign project ownership before provider registration',async()=>{
  for(const key of ['projectActive','projectBound']){const x=await fixture();x.controls[key]=false;
    await assert.rejects(x.authority.REGISTER_PROVIDER({descriptor:x.f.provider}),unknown);
    const query=x.calls.find(call=>call.text?.includes('native_coding_admission_context_v1'));
    assert.match(query.text,/r\.device_id=p\.device_id and r\.client_id=p\.client_id/);
    assert.match(query.text,/r\.admin_grant_epoch=p\.admin_grant_epoch/);
    assert.match(query.text,/for share of p,r,d/);assert.equal(query.values[1],true);
    assert.equal(x.calls.some(call=>call.text?.startsWith('insert ')),false);}
});

test('a private JWK or changed enrolled fingerprint is rejected before any proof is registered',async()=>{
  for(const change of [x=>{x.controls.context.device.public_jwk.d='must-never-be-returned';},
    x=>{x.controls.context.device.key_fingerprint_sha256='f'.repeat(64);}]) {
    const x=await fixture();change(x);
    await assert.rejects(x.authority.REGISTER_PROVIDER({descriptor:x.f.provider}),unknown);
    assert.equal(x.calls.some(call=>call.text?.startsWith('insert ')),false);
  }
});

test('scope discovery is bound to the current own PG, OS user and active enrolled project/device',async()=>{
  const x=await fixture();const discovered=await x.authority.READ_SCOPE();
  assert.equal(discovered.bindings[0].permit_id,x.f.permit.permit_id);
  assert.deepEqual(Object.keys(discovered.bindings[0].device).sort(),
    ['admin_grant_epoch','client_id','device_id','key_fingerprint_sha256','profile','public_jwk']);
  const query=x.calls.find(call=>call.text?.includes('order by p.permit_id'));
  assert.deepEqual(query.values,[x.native.postgres.system_identifier,x.native.user_sid,'00000000-0000-0000-0000-000000000000']);
  assert.match(query.text,/p\.permit_id>\$3::uuid order by p\.permit_id limit 33/);
  assert.equal(discovered.has_more,false);assert.equal(discovered.next_after_permit_id,null);
  assert.match(query.text,/r\.state='ACTIVE'/);assert.match(query.text,/d\.active and d\.revoked_at is null/);
  assert.match(query.text,/d\.admin_grant_epoch=p\.admin_grant_epoch/);
  x.controls.context.device.public_jwk.d='private-material';
  await assert.rejects(x.authority.READ_SCOPE(),/protected_context_invalid/);
});

test('scope pages return every permit beyond 64 without consuming the lookahead row or rebinding native scope',async()=>{
  const x=await fixture();
  const permitIds=Array.from({length:65},(_,i)=>`${String(i+1).padStart(8,'0')}-0000-4000-8000-000000000000`);
  x.controls.scopeContexts=permitIds.map(permit_id=>{
    const context=structuredClone(x.controls.context);context.permit.permit_id=permit_id;return context;
  }).reverse();
  const first=await x.authority.READ_SCOPE();
  assert.deepEqual(first.bindings.map(row=>row.permit_id),permitIds.slice(0,32));
  assert.equal(first.has_more,true);assert.equal(first.next_after_permit_id,permitIds[31]);
  const second=await x.authority.READ_SCOPE({after_permit_id:first.next_after_permit_id});
  assert.deepEqual(second.bindings.map(row=>row.permit_id),permitIds.slice(32,64));
  assert.equal(second.has_more,true);assert.equal(second.next_after_permit_id,permitIds[63]);
  const final=await x.authority.READ_SCOPE({after_permit_id:second.next_after_permit_id});
  assert.deepEqual(final.bindings.map(row=>row.permit_id),permitIds.slice(64));
  assert.equal(final.has_more,false);assert.equal(final.next_after_permit_id,null);
  const empty=await x.authority.READ_SCOPE({after_permit_id:permitIds[64]});
  assert.deepEqual(empty.bindings,[]);assert.equal(empty.has_more,false);assert.equal(empty.next_after_permit_id,null);
  const queries=x.calls.filter(call=>call.text?.includes('order by p.permit_id'));
  assert.deepEqual(queries.map(call=>call.values),['00000000-0000-0000-0000-000000000000',permitIds[31],permitIds[63],permitIds[64]]
    .map(cursor=>[x.native.postgres.system_identifier,x.native.user_sid,cursor]));
  for(const query of queries)assert.match(query.text,/p\.permit_id>\$3::uuid order by p\.permit_id limit 33/);
  const reads=queries.length;
  for(const query of [{after_permit_id:'invalid'},{after_permit_id:permitIds[0],workspace_id:randomUUID()}])
    await assert.rejects(x.authority.READ_SCOPE(query),/scope_cursor_invalid/);
  assert.equal(x.calls.filter(call=>call.text?.includes('order by p.permit_id')).length,reads);
});

test('reserve requires the complete installed image and original managed worktree',async()=>{
  for(const change of [x=>x.native.artifact.installed_asar_sha256='f'.repeat(64),
    x=>x.native.worktree.path='C:\\METAENGINE\\foreign',x=>x.native.worktree.base_sha='f'.repeat(40)]) {
    const x=await fixture();change(x);await assert.rejects(x.authority.RESERVE_EXECUTION({scope:x.scope}),unknown);
    assert.equal(x.calls.some(call=>call.text?.includes('native_coding_reserve_v1')),false);
  }
});

test('a signed job cannot choose a different independently observed worker or prompt',async()=>{
  for(const change of [x=>x.controls.worker.process_incarnation_id=x.controls.worker.process_incarnation_id+'1',
    x=>x.controls.worker.prompt_sha256='f'.repeat(64),x=>x.controls.worker.user_sid='S-1-5-21-1-2-3-9999']) {
    const x=await fixture();change(x);await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted}),unknown);
    assert.equal(x.committed.job,null);
  }
});

test('an altered job signature cannot reach protected registration or the execution CAS',async()=>{
  const x=await fixture();const forged=structuredClone(x.job);forged.signature='A'.repeat(86);
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:{...x.attempted,job_proof:forged,evidence_sha256:sha(forged)}}),unknown);
  assert.equal(x.committed.job,null);assert.equal(x.calls.some(call=>call.text?.includes('native_coding_advance_v1')),false);
});

test('readback accepts the exact historical host but rejects row or requested scope substitution',async()=>{
  const x=await fixture();x.task.state='AMBIGUOUS';
  x.native.host_process={...x.native.host_process,pid:12345};
  const row=await x.authority.READ_EXECUTION({scope:x.scope});assert.equal(row.state,'RESERVED');
  await assert.rejects(x.authority.READ_EXECUTION({scope:{...x.scope,scope_sha256:'f'.repeat(64)}}),/readback_scope_mismatch/);
  x.committed.execution.agent_generation_epoch=2;
  await assert.rejects(x.authority.READ_EXECUTION({scope:x.scope}),/readback_scope_mismatch/);
});

test('RESULT_READY registers exact protected bytes and CAS atomically after a legitimate worker commit',async()=>{
  const x=await fixture({executionState:'ATTEMPTED',postExecutionHead:'a'.repeat(40)});
  const result=await x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.ready});
  assert.equal(result.state,'RESULT_READY');assert.deepEqual(x.committed.result,x.receipt);
  assert.notEqual(x.receipt.git_after.head,x.f.permit.worktree.base_sha);
  assert.equal(x.committed.execution.state,'RESULT_READY');
});

test('a failed result CAS rolls back the protected receipt registration',async()=>{
  const x=await fixture({executionState:'ATTEMPTED'});x.controls.failCas=true;
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.ready}),unknown);
  assert.equal(x.committed.result,null);assert.equal(x.committed.execution.state,'ATTEMPTED');
});

test('an expired W30 lease can record late protected result evidence without authorizing resume',async()=>{
  const x=await fixture({executionState:'ATTEMPTED',postExecutionHead:'a'.repeat(40)});
  x.task.state='AMBIGUOUS';x.task.lease_expires_at=new Date(Date.now()-60000).toISOString();x.controls.projectActive=false;
  const result=await x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.ready});
  assert.equal(result.state,'RESULT_READY');assert.equal(result.automatic_retry_allowed,false);
  assert.equal(x.calls.some(call=>call.text?.includes('from destruktion_meta.devos_fleet_claim')),false);
  await assert.rejects(x.authority.RESERVE_EXECUTION({scope:x.scope}),unknown);
});

test('result receipt bindings and model schema are checked independently of its claimed RESULT_READY state',async()=>{
  const changes=[r=>r.permit_id=randomUUID(),r=>r.prompt_sha256='f'.repeat(64),r=>r.user_sid='S-1-5-21-1-2-3-9999',
    r=>r.process.started_suspended=false,r=>r.process_result.tree_cleanup_confirmed=false,
    r=>r.model_claim_authority=true,r=>r.result.extra='unrecognized',r=>r.git_after.head='f'.repeat(40)];
  for(const change of changes){const x=await fixture({executionState:'ATTEMPTED'});change(x.receipt);
    await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.ready}),unknown);
    assert.equal(x.committed.result,null);assert.equal(x.committed.execution.state,'ATTEMPTED');}
});

test('caller receipt mutation cannot replace the fixed protected-journal readback',async()=>{
  const x=await fixture({executionState:'ATTEMPTED'}),changed=structuredClone(x.receipt);changed.result.summary='caller text';
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:{...x.ready,result_receipt:changed}}),unknown);
  assert.equal(x.committed.result,null);
});

test('CRITIC job proof binds an independent registered DONE writer in the same project and workspace',async()=>{
  const valid=await fixture({role:'CRITIC'});
  assert.equal((await valid.authority.ADVANCE_EXECUTION({scope:valid.scope,transition:valid.attempted})).state,'ATTEMPTED');
  for(const change of [x=>x.controls.writer.workspace_id=randomUUID(),x=>x.controls.writer.project_id=randomUUID(),
    x=>x.controls.writer.result_receipt.result.outcome='BLOCKED',
    x=>x.controls.writer.result_receipt.git_after.artifact_sha256='f'.repeat(64)]) {
    const x=await fixture({role:'CRITIC'});change(x);
    await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.attempted}),unknown);
    assert.equal(x.committed.job,null);
  }
});

test('a read-only CRITIC result cannot change the reviewed candidate or substitute its subject',async()=>{
  const valid=await fixture({role:'CRITIC',executionState:'ATTEMPTED'});
  assert.equal((await valid.authority.ADVANCE_EXECUTION({scope:valid.scope,transition:valid.ready})).state,'RESULT_READY');
  for(const change of [x=>x.receipt.git_after.artifact_sha256='f'.repeat(64),
    x=>x.receipt.subject_result_sha256='f'.repeat(64),x=>x.receipt.result.subject_result_sha256='f'.repeat(64)]) {
    const x=await fixture({role:'CRITIC',executionState:'ATTEMPTED'});change(x);
    await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:x.ready}),unknown);
    assert.equal(x.committed.result,null);
  }
});

test('a pre-existing reservation remains readback only and CHECKPOINTED stays explicitly fenced',async()=>{
  const x=await fixture();const reserved=await x.authority.RESERVE_EXECUTION({scope:x.scope});
  assert.equal(reserved.state,'READBACK_ONLY');assert.equal(reserved.automatic_retry_allowed,false);
  const before=x.calls.length;
  await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:x.scope,transition:{to:'CHECKPOINTED'}}),/checkpoint_verifier_unbound/);
  assert.equal(x.calls.length,before);
});
