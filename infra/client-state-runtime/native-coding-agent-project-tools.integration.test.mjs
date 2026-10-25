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
const migration='20261025090000_native_coding_agent_project_tools_v1.sql';

// Real PG17 allocator, constraints, triggers and transactions in a NEW cluster.
// Signed jobs/receipts here are GENERATED SQL FIXTURES, never native execution,
// useful work, installed acceptance, restart proof or release evidence.
test('native agent project tools preserve scope, full messages and existing child admission',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-agent-tools-'));
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
  for(const name of ['20261010100000_project_continuity_history_v1.sql','20261012130000_project_verifier_reference_transport_v1.sql',
    '20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql','20261025070000_native_coding_project_continuation_v1.sql','20261025080000_native_coding_worktree_lease_admission_v1.sql',migration]) {
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
  async function startRun(f) {
    const leased=await f.lease(f.writer),scope=await f.reserve(f.writer,leased),run=randomUUID();
    const job=f.generated.envelope({...f.generated.jobPayload,...f.writer,schema:'metaengine.codex-cli.job-proof.v1',task_id:f.task,
      target_id:'codex-cli:'+f.writer.provider_id,lease_generation:1,run_id:run,host_process:f.generated.jobPayload.host_process});
    await sql.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22(task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256)
      values($1,1,$2,$3,$4,$5,$6)`,[f.task,f.writer.permit_id,run,sql.json(job),canonical(job),sha(job)]);
    await f.advance(scope,'RESERVED','ATTEMPTED',sha(job));
    await sql.unsafe(`select public.devos_fleet_mark_running_v1($1,$2,1,$3,$4,1,$5)`,[f.task,f.writer.agent_id,'native-coding:'+f.writer.provider_id,'codex-cli:'+f.writer.provider_id,
      sql.json({schema:'metaengine.native-coding.mark-running.v1',job_proof_sha256:sha(job),authority_effect:false})]);
    return {f,run,scope};
  }
  const overview=async(run,after=0,limit=32)=>(await sql.unsafe('select destruktion_meta.native_coding_agent_overview_v1($1,$2,$3)as value',[run,after,limit]))[0].value;
  const history=async(run,after=0,through=null,limit=16)=>(await sql.unsafe('select destruktion_meta.native_coding_agent_history_v1($1,$2,$3,$4)as value',[run,after,through,limit]))[0].value;
  const message=async(run,request,target,text)=>(await sql.unsafe('select destruktion_meta.native_coding_agent_message_v1($1,$2,$3,$4)as value',[run,request,target,text]))[0].value;
  const children=async(run,request,rows)=>(await sql.unsafe('select destruktion_meta.native_coding_agent_spawn_v1($1,$2,$3)as value',[run,request,sql.json(rows)]))[0].value;
  async function childPermit(f) {return f.addPermit('IMPLEMENTER',{worktree:{...f.writer.worktree,path:f.writer.worktree.path+'-'+randomUUID(),root_identity_sha256:sha(randomUUID())}});}
  async function peer(f) {const permit=await childPermit(f),task=await f.seed(permit);await f.link(task);return {permit,task};}

  await subtest('private tools require an active native run and deny the API role',async()=>{
    const f=await fixture(),x=await startRun(f);assert.equal((await overview(x.run)).caller_task_id,f.task);
    await assert.rejects(overview(randomUUID()),/run_not_current/);
    await assert.rejects(sql.begin(tx=>tx.unsafe('set local role service_role').then(()=>tx.unsafe('select destruktion_meta.native_coding_agent_context_v1($1)',[x.run]))),error=>error.code==='42501');
    const [permissions]=await sql.unsafe(`select has_table_privilege('service_role','destruktion_meta.native_coding_agent_intent_h205f22','insert')as write,
      has_function_privilege('service_role','destruktion_meta.native_coding_agent_message_v1(uuid,uuid,text,text)','execute')as message`);
    assert.deepEqual(permissions,{write:false,message:false});
  });
  await subtest('overview paginates all project tasks without private task specs or prompts',async()=>{
    const f=await fixture(),x=await startRun(f);for(let i=0;i<34;i++){const task=await f.seed(f.critic);await f.link(task);}
    const first=await overview(x.run),second=await overview(x.run,first.cursor.next_seq);
    assert.equal(first.tasks.length,32);assert.equal(first.cursor.has_more,true);assert.equal(second.tasks.length,3);assert.equal(second.cursor.has_more,false);
    const ids=new Set([...first.tasks,...second.tasks].map(row=>row.task_id));assert.equal(ids.size,35);
    assert.equal(JSON.stringify(first).includes('task_spec'),false);assert.equal(JSON.stringify(first).includes('prompt_sha256'),false);
  });
  await subtest('addressed messages store full text once with an ordered own-PG receipt and exact replay',async()=>{
    const f=await fixture(),x=await startRun(f),target=await peer(f),request=randomUUID(),text='Агент, проверь реализацию.\nПолный текст сообщения и ответные замечания.';
    const result=await message(x.run,request,target.permit.agent_id,text),replay=await message(x.run,request,target.permit.agent_id,text);
    assert.equal(result.stored,true);assert.equal(result.read_by_recipient_proven,false);assert.equal(replay.seq,result.seq);assert.equal(replay.intent_replayed,true);
    const page=await history(x.run,result.seq-1,result.seq,16);assert.equal(page.entries.length,1);
    assert.equal(page.entries[0].content.message,text);assert.equal(page.entries[0].actor,f.writer.agent_id);assert.equal(page.entries[0].content.recipient_task_id,target.task);
    assert.equal(page.cursor.commit_ordered,true);assert.equal(page.content_is_authority,false);assert.equal(page.full_text_returned,true);
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=184320);
    const [readback]=await sql.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1,$2)as value',[x.run,request]);
    assert.equal(readback.value.found,true);assert.equal(readback.value.readback_only,true);assert.equal(readback.value.operation,'MESSAGE');
    assert.deepEqual(JSON.parse(readback.value.canonical_body_text),{target_agent_id:target.permit.agent_id,message:text});
    assert.equal(createHash('sha256').update(readback.value.canonical_body_text).digest('hex'),readback.value.body_sha256);
    assert.deepEqual(readback.value.receipt,result);
    const alias=randomUUID(),sameBodyNewUuid=await message(x.run,alias,target.permit.agent_id,text);
    assert.equal(sameBodyNewUuid.seq,result.seq);assert.equal(sameBodyNewUuid.semantic_replayed,true);assert.equal(sameBodyNewUuid.original_request_id,request);
    const [aliasReadback]=await sql.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1,$2)as value',[x.run,alias]);
    assert.equal(aliasReadback.value.found,true);assert.equal(aliasReadback.value.original_request_id,request);assert.deepEqual(aliasReadback.value.receipt,result);
    await assert.rejects(message(x.run,request,target.permit.agent_id,'Другой текст'),/intent_collision/);
    const [count]=await sql.unsafe("select count(*)::int as count from destruktion_meta.project_event_h205f22 where project_id=$1 and event_type='NATIVE_AGENT_MESSAGE'",[f.p.project_id]);assert.equal(count.count,1);
  });
  await subtest('foreign and ambiguous recipients are rejected and JSON escaping respects the full event byte budget',async()=>{
    const f=await fixture(),x=await startRun(f),target=await peer(f),foreign=await fixture();
    await assert.rejects(message(x.run,randomUUID(),foreign.writer.agent_id,'foreign'),/recipient_not_unique/);
    const request=randomUUID();await assert.rejects(message(x.run,request,target.permit.agent_id,'x\n'.repeat(3000)),/event_byte_budget/);
    assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=$1 and request_id=$2',[x.run,request]))[0].count,0);
    const duplicate=await f.seed(target.permit);await f.link(duplicate);await assert.rejects(message(x.run,randomUUID(),target.permit.agent_id,'ambiguous'),/recipient_not_unique/);
  });
  await subtest('native child proposals wait for a separate protected root and never fall back to browser tasks',async()=>{
    const f=await fixture(),x=await startRun(f),request=randomUUID(),proposal=[{role:'IMPLEMENTER',objective:'Independent bounded subtask'}];
    const [originalRoot]=await sql.unsafe('select task_spec_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.task]);
    const waiting=await children(x.run,request,proposal);assert.equal(waiting.batches[0].children[0].status,'CAPACITY_WAIT');assert.equal(waiting.leases_allocated,false);
    const permit=await childPermit(f),admitted=await children(x.run,request,proposal),child=admitted.batches[0].children[0];
    assert.equal(child.status,'ADMITTED');const replay=await children(x.run,request,proposal);assert.equal(replay.batches[0].children[0].task_id,child.task_id);
    const [row]=await sql.unsafe('select task_spec,base_sha,state,lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[child.task_id]);
    assert.equal(row.task_spec.native_coding.permit_id,permit.permit_id);assert.equal(row.task_spec.native_coding.goal_sha256,f.writer.goal_sha256);
    assert.equal(row.state,'READY');assert.equal(row.lease_generation,'0');assert.equal(row.base_sha,f.writer.worktree.base_sha);
    assert.equal((await f.lease(permit)).task_id,child.task_id);
    assert.deepEqual((await sql.unsafe('select task_spec_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.task]))[0],originalRoot);
    await assert.rejects(children(x.run,request,[{role:'IMPLEMENTER',objective:'collision'}]),/intent_collision/);
    const review=await children(x.run,randomUUID(),[{role:'CRITIC',objective:'Unbound review proposal'}]);assert.equal(review.batches[0].children[0].status,'CAPACITY_WAIT');
  });
  await subtest('sixteen proposals use two stable existing spawn batches in one transaction',async()=>{
    const f=await fixture(),x=await startRun(f),request=randomUUID();await sql.unsafe('update destruktion_meta.project_run_h205f22 set max_children=null,max_tasks=null,max_depth=null where project_id=$1',[f.p.project_id]);
    const proposal=Array.from({length:16},(_,i)=>({role:'IMPLEMENTER',objective:'Native logical child '+i}));
    const result=await children(x.run,request,proposal);assert.equal(result.batches.length,2);assert.equal(result.batches.reduce((n,b)=>n+b.children.length,0),16);
    const replay=await children(x.run,request,proposal);assert.deepEqual(replay.batches.map(b=>b.request_id),result.batches.map(b=>b.request_id));
    const newUuidReplay=await children(x.run,randomUUID(),proposal);assert.equal(newUuidReplay.semantic_replayed,true);
    assert.deepEqual(newUuidReplay.batches.map(b=>b.request_id),result.batches.map(b=>b.request_id));
    assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.project_child_proposal_h205f22 where project_id=$1',[f.p.project_id]))[0].count,16);
  });
  await subtest('second-batch failure rolls back first-batch proposals and the stable intent',async()=>{
    const f=await fixture(),x=await startRun(f),request=randomUUID();
    await sql.unsafe(`create function public.qa_reject_second_native_batch()returns trigger language plpgsql as $$begin if new.objective='FAIL_SECOND_BATCH' then raise exception 'fixture_second_batch_rejected';end if;return new;end$$;
      create trigger qa_reject_second_native_batch before insert on destruktion_meta.project_child_proposal_h205f22 for each row execute function public.qa_reject_second_native_batch()`);
    try {
      const rows=Array.from({length:9},(_,i)=>({role:'IMPLEMENTER',objective:i===8?'FAIL_SECOND_BATCH':'First batch child '+i}));
      await assert.rejects(children(x.run,request,rows),/fixture_second_batch_rejected/);
      assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.project_child_proposal_h205f22 where project_id=$1',[f.p.project_id]))[0].count,0);
      assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=$1',[x.run]))[0].count,0);
    } finally {await sql.unsafe('drop trigger qa_reject_second_native_batch on destruktion_meta.project_child_proposal_h205f22;drop function public.qa_reject_second_native_batch()');}
  });
  await subtest('expired claims and owner stop revoke every collaboration operation',async()=>{
    const f=await fixture(),x=await startRun(f),target=await peer(f),request=randomUUID();await message(x.run,request,target.permit.agent_id,'Durable receipt before expiry');
    await sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[f.p.workspace_id]);await assert.rejects(overview(x.run),/owner_stopped/);
    await sql.unsafe('update public.qa_native_environment set enabled=true where workspace_id=$1',[f.p.workspace_id]);
    await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second' where task_id=$1",[f.task]);await assert.rejects(history(x.run),/run_not_current/);
    const [readback]=await sql.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1,$2)as value',[x.run,request]);assert.equal(readback.value.found,true);assert.equal(readback.value.physical_effect_replayed,false);
    await assert.rejects(sql.unsafe(`update destruktion_meta.native_coding_agent_intent_h205f22 set body=$1::jsonb,
      body_sha256=encode(extensions.digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex')where run_id=$2 and request_id=$3`,
      [sql.json({message:'tampered',target_agent_id:target.permit.agent_id}),x.run,request]),/intent_immutable/);
  });
  assert.equal(passed,8);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.agent-project-tools.disposable-qa.v1',state:'PASS',
    postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:appliedMigrationSha,
    source_classification:'REAL_DISPOSABLE_PG_WITH_GENERATED_NATIVE_JOB_AND_RECEIPT_FIXTURES',installed_keeper_used:false,model_calls:0,
    installed_autonomy_proven:false,physical_agent_creation_proven:false,authority_effect:false},null,2));
  t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));
 } finally {
  if(sql)await sql.end({timeout:5});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(started){assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,postmaster_pid_file_absent:true,installed_keeper_used:false}));}
 }
});
