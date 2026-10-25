import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';
import {nativeCodingCanonicalJson as canonical,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const source=name=>fs.readFile(new URL(name,migrations),'utf8');
const migration='20261025100000_native_coding_checkpoint_commit_rotation_v1.sql';

// Real PG17 allocator, constraints, triggers and transactions in a NEW cluster.
// Signed jobs/receipts here are GENERATED SQL FIXTURES, never native execution,
// useful work, installed acceptance, restart proof or release evidence.
test('native checkpoint commit rotation preserves exact evidence and feeds the existing W30 allocator',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-commit-rotation-'));
 const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
   const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
   const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,sql,cluster,passed=0,appliedMigrationSha=null;
 try {
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connect_timeout:5,idle_timeout:10,
    connection:{application_name:'METAENGINE_NATIVE_AGENT_TOOLS_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
  const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,current_setting('server_version_num')::int as version,
    current_setting('data_directory') as data_directory,(select system_identifier::text from pg_control_system()) as system_identifier`);
  assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');assert.ok(identity.version>=170000&&identity.version<180000);
  assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());cluster=identity.system_identifier;
  await sql.unsafe(`create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;
    create schema destruktion_meta;
    create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
      active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
      admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text);
    create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);
    create table public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id uuid,client_id text,state jsonb,last_seen_at timestamptz default clock_timestamp(),authority_effect boolean default false);
    create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true);
    create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
      $$select jsonb_build_object('refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),
        'supervisor_admission_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false))$$;
    create function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(value jsonb)returns jsonb language sql immutable as $$select value$$;`);
  const bootstrap=await source('20260929010000_client_v1_fresh_project_bootstrap_v1.sql');
  const start=bootstrap.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22');
  const end=bootstrap.indexOf('create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22');
  assert.ok(start>=0&&end>start);await sql.unsafe(bootstrap.slice(start,end));
  const goal=await source('20260929211500_client_v1_goal_progress_reconciliation_v1.sql');
  await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'),goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
  const result=await source('20260929224500_client_v1_agent_origin_result_proof_v1.sql');
  await sql.unsafe(result.slice(0,result.indexOf('-- Keep the existing Client progress contract')));
  await sql.unsafe(await source('20260903052200_devos_dispatch_admission_signed_native_v3.sql'));
  await sql.unsafe(`create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
    for each row execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()`);
  for(const name of ['20261010100000_project_continuity_history_v1.sql','20261012130000_project_verifier_reference_transport_v1.sql','20261015123000_project_unbounded_defaults_v1.sql',
    '20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql','20261025070000_native_coding_project_continuation_v1.sql','20261025080000_native_coding_worktree_lease_admission_v1.sql','20261025090000_native_coding_agent_project_tools_v1.sql',migration]) {
    const bytes=await source(name);if(name===migration)appliedMigrationSha=createHash('sha256').update(bytes).digest('hex');await sql.unsafe(bytes);
  }

  async function fixture() {
    const generated=admissionFixture(),p=generated.permit;
    p.postgres.system_identifier=cluster;p.worktree.root_identity_sha256=sha(randomUUID());
    const pairing=randomUUID();
    await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pairing]);
    await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
      values($1,$2,$3,$4,$5,$6)`,[p.device_id,generated.clientId,generated.identity.profile,sql.json(generated.jwk),p.device_key_fingerprint_sha256,pairing]);
    const supervisor={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
      transport_identity:{profile:generated.identity.profile,device_id:p.device_id,key_fingerprint_sha256:p.device_key_fingerprint_sha256},
      supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}}};
    await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[p.workspace_id,generated.clientId,sql.json(supervisor)]);
    await sql.unsafe('insert into public.qa_native_environment values($1,true)',[p.workspace_id]);
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
    async function addPermit(role='IMPLEMENTER',overrides={}) {
      const permit={...structuredClone(p),permit_id:randomUUID(),provider_id:randomUUID(),agent_id:'agent_native-'+randomUUID().slice(0,8),role,
        ...overrides};
      await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22(permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
        values($1,$2,$3,$4,1,$5,$6,1,$7,$8)`,[permit.permit_id,permit.workspace_id,generated.clientId,permit.device_id,permit.provider_id,permit.agent_id,sql.json(permit),permit.record_sha256]);
      await register(permit);return permit;
    }
    const writer=await addPermit(),critic=await addPermit('CRITIC');
    async function seed(permit,{subject=null,priority=50}={}) {
      const spec={schema:'metaengine.devos.project-task-spec.v1',objective:'Generated SQL continuation fixture',claim_class:permit.role==='CRITIC'?'READ_ONLY':'MUTATING',
        native_coding:{permit_id:permit.permit_id,goal_id:permit.goal_id,goal_sha256:permit.goal_sha256,project_id:permit.project_id,...(subject?{verification_subject:subject}:{})}};
      const [enqueued]=await sql.unsafe(`select public.devos_fleet_enqueue_v1($1,$2,$3,$4,$5,$6,null,$7)as value`,
        [permit.workspace_id,'native.fixture.'+randomUUID().replaceAll('-',''),permit.role,permit.worktree.base_sha,sql.json(spec),'native.fixture:'+randomUUID(),priority]);
      assert.equal(enqueued.value.accepted,true);return enqueued.value.task_id;
    }
    const task=await seed(writer);
    await sql.unsafe(`insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal)
      values($1,$2,$3,$4,$5,$6,1,'Generated SQL continuation fixture')`,[p.project_id,p.workspace_id,randomUUID(),task,p.device_id,generated.clientId]);
    await sql.unsafe('insert into destruktion_meta.project_task_h205f22 values($1,$2,1,$1,null,0)',[task,p.project_id]);
    async function link(taskId,parent=task) {
      const [r]=await sql.unsafe('update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=$1 returning total_tasks',[p.project_id]);
      await sql.unsafe('insert into destruktion_meta.project_task_h205f22 values($1,$2,$3,$4,$5,1)',[taskId,p.project_id,r.total_tasks,task,parent]);
    }
    async function lease(permit) {
      await register(permit);await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where workspace_id=$1',[p.workspace_id]);
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
      const artifact=subject?.git_artifact_sha256||sha([run,'artifact']);
      const receipt={...generated.receipt,task_id:scope.task_id,lease_generation:scope.lease_generation,agent_id:permit.agent_id,run_id:run,
        role:permit.role,permit_id:permit.permit_id,process_incarnation_id:worker.process_incarnation_id,result_sha256:sha([run,'result']),
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
    return {p,generated,writer,critic,task,seed,link,lease,reserve,finish,reconcile,advance,addPermit,register};
  }
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


  async function subtest(name,callback){await t.test(name,async()=>{await callback();passed++;});}
  async function ready({followups=[{role:'IMPLEMENTER',objective:'Implement the next concrete part of the same protected goal'}]}={}) {
    const f=await fixture(),writer=await f.finish(f.writer,await f.lease(f.writer),{followups});await f.reconcile();
    const critic=await f.finish(f.critic,await f.lease(f.critic),{subject:writer.subject});
    const staged=await checkpointFixture(f,writer,critic);assert.equal((await staged.commit()).state,'CHECKPOINTED_PENDING_COMMIT');
    const k=staged.checkpoint,receipt={schema:'metaengine.native-coding.git-commit-receipt.v1',project_id:k.project_id,checkpoint_id:k.checkpoint_id,
      checkpoint_sha256:staged.checkpointSha,state:'COMMITTED',previous_head:k.source_head,head:sha([k.checkpoint_id,'commit']).slice(0,40),
      tree:sha([k.checkpoint_id,'tree']).slice(0,40),branch_ref:'refs/heads/metaengine-task-fixture',root_identity_sha256:k.root_identity_sha256,
      reviewed_git_artifact_sha256:k.git_artifact_sha256,intent_sha256:sha([k.checkpoint_id,'git-intent']),
      working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true,
      production_qualified:false,successor_admitted:false,automatic_retry_allowed:false,authority_effect:false};
    return {...f,writerResult:writer,criticResult:critic,k,receipt,staged};
  }
  const read=async id=>(await sql.unsafe('select destruktion_meta.native_coding_read_commit_v1($1)as value',[id]))[0].value;
  const gate=async id=>(await sql.unsafe('select destruktion_meta.native_coding_commit_gate_v1($1)as value',[id]))[0].value;
  const finish=async(x,receipt=x.receipt,canonicalText=canonical(receipt),digest=sha(receipt))=>sql.begin('isolation level serializable',async tx=>{
    await tx.unsafe('set local synchronous_commit=on');
    return (await tx.unsafe('select destruktion_meta.native_coding_finish_checkpoint_v1($1,$2,$3,$4)as value',
      [x.k.checkpoint_id,sql.json(receipt),canonicalText,digest]))[0].value;
  });
  const permit=async id=>(await sql.unsafe('select permit,revoked_at from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=$1',[id]))[0];

  await subtest('private commit operations and ledger are unreachable from the service API',async()=>{
    const [r]=await sql.unsafe(`select has_table_privilege('service_role','destruktion_meta.native_coding_commit_h205f22','insert')as table_write,
      has_function_privilege('service_role','destruktion_meta.native_coding_finish_checkpoint_v1(uuid,jsonb,text,text)','execute')as finish,
      has_function_privilege('service_role','destruktion_meta.native_coding_commit_gate_v1(uuid)','execute')as gate,
      pg_get_functiondef('destruktion_meta.project_result_bound_h205f22(uuid,text)'::regprocedure)as browser`);
    assert.equal(r.table_write,false);assert.equal(r.finish,false);assert.equal(r.gate,false);assert.match(r.browser,/ZAI_AGENT_SURFACE_CAUSAL_V1/);
    assert.equal(await read(randomUUID()),null);
  });
  await subtest('completed checkpoint is visible to the existing bounded project sweep before any commit',async()=>{
    const x=await ready();assert.equal((await gate(x.k.checkpoint_id)).admitted,true);
    const [r]=await sql.unsafe('select public.h205f22_project_reconcile_v1($1,null,$2,$3,1)as value',[x.p.workspace_id,x.p.device_id,x.generated.clientId]);
    assert.equal(r.value.projects.length,1);assert.equal(r.value.projects[0].native_commit_pending,true);
    assert.equal(r.value.projects[0].native_commit_candidate.checkpoint_id,x.k.checkpoint_id);
    assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_commit_h205f22 where project_id=$1',[x.p.project_id]))[0].n,0);
  });
  await subtest('wrong artifact, head, scope, canonical bytes or authority fields cannot release the root',async()=>{
    const x=await ready();
    for(const patch of [{reviewed_git_artifact_sha256:'0'.repeat(64)},{previous_head:'0'.repeat(40)},{root_identity_sha256:'0'.repeat(64)},
      {checkpoint_sha256:'0'.repeat(64)},{head:x.k.source_head},{project_id:randomUUID()},{authority_effect:true},{index_clean:false},{path:'C:/untrusted'}]){
      await assert.rejects(finish(x,{...x.receipt,...patch}),/receipt_binding_mismatch/);
    }
    await assert.rejects(finish(x,x.receipt,canonical(x.receipt),'0'.repeat(64)),/receipt_invalid/);
    await assert.rejects(sql.unsafe('select destruktion_meta.native_coding_finish_checkpoint_v1($1,$2,$3,$4)',
      [x.k.checkpoint_id,sql.json(x.receipt),canonical(x.receipt),sha(x.receipt)]),/durable_transaction_required/);
    assert.equal(await read(x.k.checkpoint_id),null);
    assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[x.task]))[0].state,'CHECKPOINTED_PENDING_COMMIT');
    assert.equal((await permit(x.writer.permit_id)).revoked_at,null);
  });
  await subtest('verified receipt rotates append-only permits and admits exactly one protected followup at the new base',async()=>{
    const x=await ready({followups:[{role:'CRITIC',objective:'No arbitrary critic without subject'},{role:'IMPLEMENTER',objective:'Finish the second useful step'},{role:'IMPLEMENTER',objective:'A later proposal'}]});
    const originalWriter=structuredClone((await permit(x.writer.permit_id)).permit),originalCritic=structuredClone((await permit(x.critic.permit_id)).permit);
    const [rootBefore]=await sql.unsafe('select task_spec,task_spec_sha256,base_sha from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[x.task]);
    const [projectBefore]=await sql.unsafe('select request_id,goal,root_task_id from destruktion_meta.project_run_h205f22 where project_id=$1',[x.p.project_id]);
    const value=await finish(x);assert.equal(value.state,'SUCCESSOR_ADMITTED');assert.equal(value.head,x.receipt.head);
    assert.equal(value.successor_admitted,true);assert.equal(value.root_fence_released,true);assert.deepEqual(value.receipt,x.receipt);
    assert.equal(value.commit_receipt_sha256,sha(x.receipt));assert.equal(value.canonical_receipt,canonical(x.receipt));
    assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[x.task])).length,0);
    const oldWriter=await permit(x.writer.permit_id),oldCritic=await permit(x.critic.permit_id);
    assert.deepEqual(oldWriter.permit,originalWriter);assert.deepEqual(oldCritic.permit,originalCritic);assert.ok(oldWriter.revoked_at);assert.ok(oldCritic.revoked_at);
    for(const [nextId,old] of [[value.next_writer_permit_id,originalWriter],[value.next_critic_permit_id,originalCritic]]){
      const next=(await permit(nextId)).permit;assert.notEqual(next.permit_id,old.permit_id);assert.equal(next.worktree.base_sha,x.receipt.head);
      for(const key of ['goal_id','goal_sha256','owner_epoch','provider_id','agent_id','agent_generation_epoch','project_id','workspace_id','artifact','postgres','expires_at','storage_evidence_sha256'])
        assert.deepEqual(next[key],old[key]);assert.equal(next.worktree.path,old.worktree.path);assert.equal(next.worktree.root_identity_sha256,old.worktree.root_identity_sha256);
      assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=$1',[nextId]))[0].n,0);
    }
    const [task]=await sql.unsafe('select * from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[value.successor_task_id]);
    assert.equal(task.state,'READY');assert.equal(task.lease_generation,'0');assert.equal(task.base_sha,x.receipt.head);
    assert.equal(task.task_spec.objective,'Finish the second useful step');assert.equal(task.task_spec.native_coding.permit_id,value.next_writer_permit_id);
    assert.equal(task.task_spec.native_coding.goal_sha256,originalWriter.goal_sha256);
    assert.deepEqual((await sql.unsafe('select task_spec,task_spec_sha256,base_sha from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[x.task]))[0],rootBefore);
    assert.deepEqual((await sql.unsafe('select request_id,goal,root_task_id from destruktion_meta.project_run_h205f22 where project_id=$1',[x.p.project_id]))[0],projectBefore);
    const replay=await finish(x);assert.deepEqual(replay,value);assert.deepEqual(await read(x.k.checkpoint_id),value);
    assert.equal((await x.reconcile()).admitted_native_successors,0);
    await assert.rejects(finish(x,{...x.receipt,tree:'0'.repeat(40)}),/receipt_collision/);
    const next=(await permit(value.next_writer_permit_id)).permit;
    const [empty]=await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900)as value',
      [next.workspace_id,next.agent_id,next.role,'native-coding:'+next.provider_id,'codex-cli:'+next.provider_id]);
    assert.equal(empty.value.leased,false);
    const nextLease=await x.lease(next);assert.equal(nextLease.task_id,value.successor_task_id);assert.equal(nextLease.base_sha,x.receipt.head);
    const scope=await x.reserve(next,nextLease);
    assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_execution_h205f22 where task_id=$1 and lease_generation=$2',
      [scope.task_id,scope.lease_generation]))[0].state,'RESERVED');
    const [fence]=await sql.unsafe('select writer_task_id,state from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=$1',[x.p.worktree.root_identity_sha256]);
    assert.equal(fence.writer_task_id,value.successor_task_id);assert.equal(fence.state,'HELD');
  });
  await subtest('no followup records the real commit without inventing another goal or task',async()=>{
    const x=await ready({followups:[]}),value=await finish(x);assert.equal(value.state,'COMMITTED_NO_SUCCESSOR');
    assert.equal(value.successor_task_id,null);assert.equal(value.successor_admitted,false);
    assert.equal((await sql.unsafe('select total_tasks from destruktion_meta.project_run_h205f22 where project_id=$1',[x.p.project_id]))[0].total_tasks,'2');
    assert.equal((await x.reconcile()).admitted_native_successors,0);
  });
  await subtest('policy capacity wait preserves a committed receipt and the existing reconciler admits after policy change once',async()=>{
    const x=await ready();await sql.unsafe('update destruktion_meta.project_run_h205f22 set max_tasks=2 where project_id=$1',[x.p.project_id]);
    const value=await finish(x);assert.equal(value.state,'COMMITTED_PENDING_SUCCESSOR');assert.equal(value.successor_task_id,null);
    assert.equal((await x.reconcile()).admitted_native_successors,0);
    await sql.unsafe('update destruktion_meta.project_run_h205f22 set max_tasks=null where project_id=$1',[x.p.project_id]);
    const [sweep]=await sql.unsafe('select public.h205f22_project_reconcile_v1($1,null,$2,$3,1)as value',[x.p.workspace_id,x.p.device_id,x.generated.clientId]);
    assert.equal(sweep.value.projects[0].admitted_native_successors,1);assert.equal((await read(x.k.checkpoint_id)).state,'SUCCESSOR_ADMITTED');
    assert.equal((await x.reconcile()).admitted_native_successors,0);
  });
  await subtest('revoked device or owner stop blocks pre-Git readiness and SQL rotation without changing historical state',async()=>{
    const x=await ready();await sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[x.p.workspace_id]);
    await assert.rejects(gate(x.k.checkpoint_id),/owner_stopped/);await assert.rejects(finish(x),/owner_stopped/);
    assert.equal(await read(x.k.checkpoint_id),null);
    await sql.unsafe('update public.qa_native_environment set enabled=true where workspace_id=$1',[x.p.workspace_id]);
    await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set active=false where device_id=$1',[x.p.device_id]);
    await assert.rejects(gate(x.k.checkpoint_id),/GRANT_REVOKED/);await assert.rejects(finish(x),/GRANT_REVOKED/);
    assert.equal((await permit(x.writer.permit_id)).revoked_at,null);
  });
  await subtest('concurrent finalizers have one durable result and commit evidence is immutable',async()=>{
    const x=await ready(),results=await Promise.allSettled([finish(x),finish(x)]);
    assert.ok(results.some(r=>r.status==='fulfilled'));for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/serialize|serialization/i);
    const value=await read(x.k.checkpoint_id);assert.equal(value.state,'SUCCESSOR_ADMITTED');
    assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_commit_h205f22 where checkpoint_id=$1',[x.k.checkpoint_id]))[0].n,1);
    assert.equal((await sql.unsafe('select total_tasks from destruktion_meta.project_run_h205f22 where project_id=$1',[x.p.project_id]))[0].total_tasks,'3');
    await assert.rejects(sql.unsafe('delete from destruktion_meta.native_coding_commit_h205f22 where checkpoint_id=$1',[x.k.checkpoint_id]),/commit_immutable/);
    await assert.rejects(sql.unsafe("update destruktion_meta.native_coding_commit_h205f22 set head=$1 where checkpoint_id=$2",['0'.repeat(40),x.k.checkpoint_id]),/commit_immutable/);
  });
  assert.equal(passed,8);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.commit-rotation.disposable-qa.v1',state:'PASS',
    postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:appliedMigrationSha,
    source_classification:'REAL_DISPOSABLE_PG_WITH_GENERATED_NATIVE_JOB_CHECKPOINT_AND_GIT_RECEIPT_FIXTURES',installed_keeper_used:false,model_calls:0,
    installed_autonomy_proven:false,physical_git_commit_proven:false,physical_agent_creation_proven:false,authority_effect:false},null,2));
  t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));

 } finally {
  if(sql)await sql.end({timeout:5});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(started){assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,postmaster_pid_file_absent:true,installed_keeper_used:false}));}
 }
});
