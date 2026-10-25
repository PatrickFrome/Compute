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
const migration='20261025080000_native_coding_worktree_lease_admission_v1.sql';

// Real PG17 allocator, constraints, triggers and transactions in a NEW cluster.
// Signed jobs/receipts here are GENERATED SQL FIXTURES, never native execution,
// useful work, installed acceptance, restart proof or release evidence.
test('native W30 allocator waits for a mutable physical root before claiming a lease',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-worktree-admission-'));
 const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
   const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
   const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,sql,cluster,passed=0;
 try {
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connect_timeout:5,idle_timeout:10,
    connection:{application_name:'METAENGINE_NATIVE_WORKTREE_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
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
  for(const name of ['20261010100000_project_continuity_history_v1.sql','20261012130000_project_verifier_reference_transport_v1.sql',
    '20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql','20261025070000_native_coding_project_continuation_v1.sql',migration])await sql.unsafe(await source(name));

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
    async function finish(permit,leased,{subject=null,verdict='ACCEPT',reserved=null,outcome='DONE'}={}) {
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
        result:{schema:'metaengine.codex-cli.result.v1',role:permit.role,outcome,summary:'Generated SQL fixture',checks:[],followup_tasks:[],
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
  async function subtest(name,callback){await t.test(name,async()=>{await callback();passed++;});}
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

  async function rawLease(f,permit,connection=sql) {
    await f.register(permit);
    await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where workspace_id=$1',[permit.workspace_id]);
    const [r]=await connection.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900)as value',
      [permit.workspace_id,permit.agent_id,permit.role,'native-coding:'+permit.provider_id,'codex-cli:'+permit.provider_id]);return r.value;
  }
  async function assertStillReady(task) {
    const [row]=await sql.unsafe('select state,lease_generation,lease_agent_id from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[task]);
    assert.deepEqual(row,{state:'READY',lease_generation:'0',lease_agent_id:null});
    assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[task]))[0].count,0);
  }
  await subtest('the actual API LOGIN allocates a root fence with the claim before Host reserve',async()=>{
    const f=await fixture();await sql.unsafe('create role qa_worktree_api login in role service_role');
    const api=postgres({host:'127.0.0.1',port,user:'qa_worktree_api',database:'postgres',max:1,onnotice:()=>{},connect_timeout:5});
    try {
      const [identity]=await api.unsafe('select current_user::text as current_user,session_user::text as session_user');assert.equal(identity.session_user,'qa_worktree_api');
      const leased=await rawLease(f,f.writer,api);assert.equal(leased.leased,true);
      const [fence]=await sql.unsafe('select writer_task_id,writer_lease_generation,state from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=$1',[f.writer.worktree.root_identity_sha256]);
      assert.deepEqual(fence,{writer_task_id:f.task,writer_lease_generation:'1',state:'HELD'});
      assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[f.task]))[0].count,0);
      await f.reserve(f.writer,leased);
      assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[f.task]))[0].state,'RESERVED');
      await assert.rejects(api.unsafe('select destruktion_meta.native_coding_reserve_worktree_v1($1,1)',[f.task]),error=>error.code==='42501');
    } finally {await api.end({timeout:5});}
  });
  await subtest('a queued writer waits while the first claim has not even reserved an execution',async()=>{
    const f=await fixture();assert.equal((await rawLease(f,f.writer)).leased,true);
    const other=await f.addPermit(),task=await f.seed(other);await f.link(task);
    assert.equal((await rawLease(f,other)).leased,false);await assertStillReady(task);
  });
  await subtest('the existing browser claim proof still rejects an unproven browser allocation',async()=>{
    const f=await fixture();
    const [enqueued]=await sql.unsafe("select public.devos_fleet_enqueue_v1($1,'browser-proof-regression','IMPLEMENTER',$2,$3,$4,null,50)as value",
      [f.p.workspace_id,f.writer.worktree.base_sha,sql.json({objective:'Generated browser proof regression',claim_class:'MUTATING'}),'browser-proof:'+randomUUID()]);
    const task=enqueued.value.task_id;
    await assert.rejects(sql.unsafe("select public.devos_fleet_lease_v1($1,'agent_browser-fixture','IMPLEMENTER','tab_unproven','webcontents:777',1,900)",[f.p.workspace_id]),
      error=>/native|transport|snapshot/i.test(error.message));
    await assertStillReady(task);
  });
  await subtest('concurrent calls to the same allocator return one lease and leave the other task READY',async()=>{
    const f=await fixture(),other=await f.addPermit(),task=await f.seed(other);await f.link(task);
    const values=await Promise.all([rawLease(f,f.writer),rawLease(f,other)]);
    assert.equal(values.filter(value=>value.leased).length,1);assert.equal(values.filter(value=>!value.leased).length,1);
    const loser=values[0].leased?task:f.task;await assertStillReady(loser);
    const [row]=await sql.unsafe("select count(*)::int as count from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=$1 and state='ACTIVE'",[f.p.workspace_id]);assert.equal(row.count,1);
  });
  await subtest('root capacity is shared across different workspaces and independent roots still run',async()=>{
    const f=await fixture();await rawLease(f,f.writer);
    const foreign=await fixture();foreign.writer.worktree.root_identity_sha256=f.writer.worktree.root_identity_sha256;
    await sql.unsafe('update destruktion_meta.native_coding_operator_permit_h205f22 set permit=$1 where permit_id=$2',[sql.json(foreign.writer),foreign.writer.permit_id]);
    assert.equal((await rawLease(foreign,foreign.writer)).leased,false);await assertStillReady(foreign.task);
    const independent=await f.addPermit('IMPLEMENTER',{worktree:{...f.writer.worktree,path:f.writer.worktree.path+'-independent',root_identity_sha256:sha(randomUUID())}});
    const task=await f.seed(independent);await f.link(task);assert.equal((await rawLease(f,independent)).leased,true);
  });
  await subtest('a held completed-result root allows its exact CRITIC but no queued writer',async()=>{
    const f=await fixture(),writer=await f.finish(f.writer,await f.lease(f.writer));
    const other=await f.addPermit(),task=await f.seed(other);await f.link(task);
    assert.equal((await rawLease(f,other)).leased,false);await assertStillReady(task);
    assert.equal((await f.reconcile()).admitted_verifiers,1);
    const criticLease=await rawLease(f,f.critic);assert.equal(criticLease.leased,true);
    await f.finish(f.critic,criticLease,{subject:writer.subject});
    assert.equal((await f.reconcile()).native_checkpoint_pending,true);assert.equal((await rawLease(f,other)).leased,false);await assertStillReady(task);
  });
  await subtest('a CRITIC with a different exact subject remains unleased',async()=>{
    const f=await fixture();await f.finish(f.writer,await f.lease(f.writer));
    const task=await f.seed(f.critic,{subject:{run_id:randomUUID(),result_sha256:sha('unrelated'),git_artifact_sha256:sha('other-artifact'),source_head:f.critic.worktree.base_sha}});await f.link(task);
    assert.equal((await rawLease(f,f.critic)).leased,false);await assertStillReady(task);
  });
  await subtest('CHECKPOINTED_PENDING_COMMIT retains capacity wait before any successor lease or attempt',async()=>{
    const f=await fixture(),writer=await f.finish(f.writer,await f.lease(f.writer));await f.reconcile();
    const critic=await f.finish(f.critic,await f.lease(f.critic),{subject:writer.subject});
    await (await checkpointFixture(f,writer,critic)).commit();
    const next=await f.seed(f.writer);await f.link(next);
    assert.equal((await rawLease(f,f.writer)).leased,false);await assertStillReady(next);
    const [fence]=await sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[f.task]);assert.equal(fence.state,'CHECKPOINTED_PENDING_COMMIT');
  });
  assert.equal(passed,8);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.worktree-admission.disposable-qa.v1',state:'PASS',
    postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:createHash('sha256').update(await source(migration)).digest('hex'),
    source_classification:'REAL_DISPOSABLE_PG_WITH_GENERATED_NATIVE_JOB_AND_RECEIPT_FIXTURES',installed_keeper_used:false,model_calls:0,
    installed_autonomy_proven:false,authority_effect:false},null,2));
  t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));
 } finally {
  if(sql)await sql.end({timeout:5});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(started){assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,postmaster_pid_file_absent:true,installed_keeper_used:false}));}
 }
});
