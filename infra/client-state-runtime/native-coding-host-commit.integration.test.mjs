import {createNativeCodingHostCommitService} from './native-coding-host-commit-service.mjs';
import {createNativeCodingCommitGitFixture} from './test/native-coding-host-commit-git-fixture.mjs';
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
test('real Git and PostgreSQL join protected checkpoint to the next W30 lease through Host service',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-host-commit-pg-git-'));
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

  async function fixture({physical=null}={}) {
    const generated=admissionFixture(),p=generated.permit;
    p.postgres.system_identifier=cluster;p.worktree.root_identity_sha256=sha(randomUUID());
    if(physical)p.worktree={path:physical.root,root_identity_sha256:physical.managed_worktree.root_identity_sha256,base_sha:physical.proof.head};
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
      const artifact=subject?.git_artifact_sha256||physical?.proof.artifact_sha256||sha([run,'artifact']);
      const receipt={...generated.receipt,workspace_id:permit.workspace_id,project_id:permit.project_id,task_id:scope.task_id,lease_generation:scope.lease_generation,agent_id:permit.agent_id,run_id:run,
        role:permit.role,permit_id:permit.permit_id,worktree_path:permit.worktree.path,process_incarnation_id:worker.process_incarnation_id,result_sha256:sha([run,'result']),
        git_before:physical?structuredClone(permit.role==='CRITIC'?physical.proof:physical.before):{head:permit.worktree.base_sha,artifact_sha256:artifact},git_after:physical?structuredClone(physical.proof):{head:permit.worktree.base_sha,artifact_sha256:artifact},
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



  async function subtest(name,callback){await t.test(name,async sub=>{await callback(sub);passed++;});}
  async function ready(t) {
    const physical=await createNativeCodingCommitGitFixture(t),f=await fixture({physical});
    const writer=await f.finish(f.writer,await f.lease(f.writer),{followups:[{role:'IMPLEMENTER',objective:'Implement the second reviewed step of this same project'}]});
    await f.reconcile();const critic=await f.finish(f.critic,await f.lease(f.critic),{subject:writer.subject});
    const staged=await checkpointFixture(f,writer,critic);assert.equal((await staged.commit()).state,'CHECKPOINTED_PENDING_COMMIT');
    const k=staged.checkpoint,stateDirectory=path.join(physical.directory,'generated-private-state');
    await physical.registerOperator({stateDirectory,project_id:k.project_id,workspace_id:k.workspace_id});
    const query={project_id:k.project_id,checkpoint_sha256:staged.checkpointSha};
    const callbacks={stateDirectory,...physical.storageAdapters,
      readNativeScope:async(permit,includeSandbox)=>{assert.equal(includeSandbox,false);return {artifact:structuredClone(f.p.artifact),postgres:structuredClone(f.p.postgres),
        user_sid:f.p.user_sid,host_process:structuredClone(f.generated.jobPayload.host_process),
        worktree:{...structuredClone(f.p.worktree),base_sha:(await physical.git(['rev-parse','HEAD'])).trim()}};},
      readProtectedReceipt:async({scope})=>{assert.equal(scope.task_id,writer.scope.task_id);return structuredClone(writer.receipt);}};
    return {f,physical,writer,critic,staged,k,query,callbacks};
  }
  await subtest('real Host Git CAS and own-PG finalization survive SQL ACK loss and feed one fresh W30 lease',async t=>{
    const x=await ready(t),{f,physical,k,query}=x;
    const previousHead=(await physical.git(['rev-parse','HEAD'])).trim();assert.equal(previousHead,k.source_head);
    let commits=0,lostAck=true;
    // The SQL effect is real. Only its already-committed ACK is deliberately lost.
    const transport={unsafe:sql.unsafe.bind(sql),begin:async(isolation,operation)=>{
      commits++;const value=await sql.begin(isolation,operation);if(lostAck){lostAck=false;throw Error('GENERATED_ACK_LOST_AFTER_REAL_PG_COMMIT');}return value;}};
    const make=()=>createNativeCodingHostCommitService({sql:transport,...x.callbacks}),service=await make();
    t.after(()=>service.close());const result=await service.FINISH_CHECKPOINT(query);
    assert.equal(result.state,'SUCCESSOR_ADMITTED');assert.equal(result.successor_admitted,true);assert.equal(commits,1);
    const value=result.commit,newHead=(await physical.git(['rev-parse','HEAD'])).trim();
    assert.notEqual(newHead,previousHead);assert.equal(value.head,newHead);assert.equal(value.previous_head,previousHead);
    assert.equal(value.receipt.ref_update_cas_verified,true);assert.equal(value.receipt.commit_object_readback_verified,true);
    assert.equal(value.receipt.reviewed_git_artifact_sha256,physical.proof.artifact_sha256);
    assert.equal((await physical.git(['rev-parse',newHead+'^'])).trim(),previousHead);
    assert.equal((await physical.git(['rev-parse',newHead+'^{tree}'])).trim(),value.tree);
    assert.equal((await physical.git(['status','--porcelain'])).trim(),'');
    assert.equal((await physical.git(['rev-list','--count','HEAD'])).trim(),'2');
    assert.equal(await fs.readFile(path.join(physical.root,'reviewed.txt'),'utf8'),'exact reviewed current bytes\n');
    assert.deepEqual(await fs.readFile(path.join(physical.root,'binary.bin')),Buffer.from([0,255,14,10]));
    assert.equal(await fs.stat(path.join(physical.root,'removed.txt')).catch(()=>null),null);
    assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[f.task]))[0].n,0);
    const [row]=await sql.unsafe('select permit,revoked_at from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=$1',[value.next_writer_permit_id]);
    const next=row.permit;assert.equal(next.worktree.base_sha,newHead);assert.equal(row.revoked_at,null);
    assert.equal(next.goal_id,f.writer.goal_id);assert.equal(next.goal_sha256,f.writer.goal_sha256);
    const [task]=await sql.unsafe('select * from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[value.successor_task_id]);
    assert.equal(task.state,'READY');assert.equal(task.lease_generation,'0');assert.equal(task.base_sha,newHead);
    const [unregistered]=await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900)as value',
      [next.workspace_id,next.agent_id,next.role,'native-coding:'+next.provider_id,'codex-cli:'+next.provider_id]);assert.equal(unregistered.value.leased,false);
    const restarted=await make();t.after(()=>restarted.close());
    assert.deepEqual(await restarted.READ_FINISH_CHECKPOINT(query),result);assert.deepEqual(await restarted.FINISH_CHECKPOINT(query),result);
    assert.equal(commits,1);assert.equal((await physical.git(['rev-list','--count','HEAD'])).trim(),'2');
    const lease=await f.lease(next);assert.equal(lease.task_id,value.successor_task_id);assert.equal(lease.base_sha,newHead);
    const scope=await f.reserve(next,lease);
    const [execution]=await sql.unsafe('select state from destruktion_meta.native_coding_execution_h205f22 where task_id=$1 and lease_generation=$2',
      [scope.task_id,scope.lease_generation]);assert.equal(execution.state,'RESERVED');
    const [fence]=await sql.unsafe('select writer_task_id,state from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=$1',[next.worktree.root_identity_sha256]);
    assert.equal(fence.writer_task_id,lease.task_id);assert.equal(fence.state,'HELD');
    await fs.writeFile(path.join(directory,'git-sql-chain.json'),JSON.stringify({schema:'metaengine.native-coding.git-sql-chain.qa.v1',
      postgres_system_identifier:cluster,project_id:k.project_id,checkpoint_id:k.checkpoint_id,checkpoint_sha256:x.staged.checkpointSha,
      previous_head:previousHead,head:newHead,tree:value.tree,commit_receipt_sha256:value.commit_receipt_sha256,
      successor_task_id:lease.task_id,successor_lease_generation:Number(lease.lease_generation),sql_finalization_dispatches:commits,
      real_git_commit:true,real_pg_transaction:true,real_w30_lease:true,model_calls:0,installed_autonomy_proven:false,
      os_callbacks_are_generated_fixtures:true,windows_acl_qualified:false,authority_effect:false},null,2));
  });
  await subtest('post-review file changes cannot become a Git commit or a SQL successor',async t=>{
    const x=await ready(t),before=(await x.physical.git(['rev-parse','HEAD'])).trim();
    await fs.appendFile(path.join(x.physical.root,'reviewed.txt'),'unreviewed late bytes\n');
    const service=await createNativeCodingHostCommitService({sql,...x.callbacks});t.after(()=>service.close());
    await assert.rejects(service.FINISH_CHECKPOINT(x.query),/native_coding_git_commit_checkpoint_git_changed/);
    assert.equal((await x.physical.git(['rev-parse','HEAD'])).trim(),before);
    assert.equal((await sql.unsafe('select destruktion_meta.native_coding_read_commit_v1($1)as value',[x.k.checkpoint_id]))[0].value,null);
    assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[x.f.task]))[0].state,'CHECKPOINTED_PENDING_COMMIT');
  });
  await subtest('explicit generation-bound NULL policy permits continuation beyond 256 lifetime logical tasks',async t=>{
    const x=await ready(t),{f,k}=x;
    // Existing historical projects may explicitly retain the original 8/256/8
    // policy. Preload generated logical backlog, never leases or fake effects.
    await sql.unsafe('update destruktion_meta.project_run_h205f22 set max_depth=8,max_tasks=256,max_children=8 where project_id=$1',[k.project_id]);
    const [original]=await sql.unsafe('select task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.task]);
    const rows=await sql.unsafe(`select public.devos_fleet_enqueue_v1($1,'policy.history.'||$2||'.'||n,'IMPLEMENTER',$3,$4,
      'policy-history:'||$2||':'||n,null,1)as value from generate_series(1,255)n`,
      [k.workspace_id,k.checkpoint_id,k.source_head,sql.json(original.task_spec)]);
    assert.equal(rows.length,255);assert(rows.every(row=>row.value.accepted===true));
    for(let i=0;i<rows.length;i++)await sql.unsafe('insert into destruktion_meta.project_task_h205f22 values($1,$2,$3,$4,null,0)',
      [rows[i].value.task_id,k.project_id,i+3,f.task]);
    await sql.unsafe('update destruktion_meta.project_run_h205f22 set total_tasks=257 where project_id=$1',[k.project_id]);
    const service=await createNativeCodingHostCommitService({sql,...x.callbacks});t.after(()=>service.close());
    const waiting=await service.FINISH_CHECKPOINT(x.query);assert.equal(waiting.state,'COMMITTED_PENDING_SUCCESSOR');
    assert.equal(waiting.successor_admitted,false);assert.equal((await f.reconcile()).admitted_native_successors,0);
    const [policy]=await sql.unsafe('select public.h205f22_project_policy_v1($1,$2,1,null,null,null,$3,$4,1)as value',
      [k.workspace_id,k.project_id,f.p.device_id,f.generated.clientId]);
    assert.deepEqual(policy.value.policy,{generation:2,max_depth:null,max_tasks:null,max_children:null});
    const [event]=await sql.unsafe("select content from destruktion_meta.project_event_h205f22 where project_id=$1 and event_type='PROJECT_POLICY_UPDATED' order by seq desc limit 1",[k.project_id]);
    assert.deepEqual(event.content,policy.value.policy);
    await assert.rejects(sql.unsafe('select public.h205f22_project_policy_v1($1,$2,1,null,null,null,$3,$4,1)',
      [k.workspace_id,k.project_id,f.p.device_id,f.generated.clientId]),/PROJECT_POLICY_FENCED/);
    const [sweep]=await sql.unsafe('select public.h205f22_project_reconcile_v1($1,null,$2,$3,1)as value',
      [k.workspace_id,f.p.device_id,f.generated.clientId]);assert.equal(sweep.value.projects[0].admitted_native_successors,1);
    const [count]=await sql.unsafe('select count(*)::int as n from destruktion_meta.project_task_h205f22 where project_id=$1',[k.project_id]);
    assert.equal(count.n,258);assert.equal((await service.READ_FINISH_CHECKPOINT(x.query)).state,'SUCCESSOR_ADMITTED');
    assert.equal((await f.reconcile()).admitted_native_successors,0);
    assert.equal((await x.physical.git(['rev-list','--count','HEAD'])).trim(),'2');
  });
  assert.equal(passed,3);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.host-commit.pg-git.disposable-qa.v1',state:'PASS',
    postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:appliedMigrationSha,
    source_classification:'REAL_DISPOSABLE_PG_AND_GIT_WITH_GENERATED_PROTECTED_JOB_CRITIC_AND_OS_CALLBACK_FIXTURES',
    real_git_commit:true,real_pg_transaction:true,real_w30_lease:true,installed_keeper_used:false,model_calls:0,
    installed_autonomy_proven:false,physical_agent_creation_proven:false,windows_acl_qualified:false,authority_effect:false},null,2));
  t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));

 } finally {
  if(sql)await sql.end({timeout:5});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(started){assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,postmaster_pid_file_absent:true,installed_keeper_used:false}));}
 }
});
