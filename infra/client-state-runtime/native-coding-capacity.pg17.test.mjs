import {createDevosSupervisorRoutes} from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';
import {createNativeCodingCapacityOwner} from '../../apps/metaengine-browser/src/native-coding-capacity-owner.mjs';
import {createNativeCodingExecutionPool} from '../../apps/metaengine-browser/src/native-coding-execution-pool.mjs';
import {nativeCapacityPrincipal} from '../../apps/metaengine-browser/src/native-coding-capacity-contract.mjs';
import {createNativeCodingHostSetupService} from './native-coding-host-setup-service.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import {nativeCapacityProjection} from '../../apps/metaengine-browser/src/native-coding-capacity-contract.mjs';
import {createNativeCodingHostCapacity} from './native-coding-host-capacity.mjs';
import {sign} from 'node:crypto';
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
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
import {createNativeCodingHostServiceHeartbeat,createNativeCodingHostServiceHeartbeatV2} from './native-coding-host-service-heartbeat.mjs';
import {createNativeCodingServiceHeartbeatPublisher,createNativeCodingServiceHeartbeatPublisherV2} from '../../apps/metaengine-browser/src/native-coding-service-heartbeat-publisher.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const source=name=>fs.readFile(new URL(name,migrations),'utf8');
const migration='20261025120000_native_coding_service_heartbeat_admission_v1.sql';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');

// Actual isolated PG17 transactions and existing enqueue/project/claim bodies.
// SQL-only adversarial witnesses remain explicitly generated. Additional cases
// exercise the actual fixed Host producer/consumer and Main custody path.
// Device enrollment, installed image, OS scope, canaries and Windows ACL readers
// are GENERATED FIXTURES. This test cannot prove installed/model execution.
test('native capacity v2 uses existing own-PG admission and preserves v1 source semantics',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-capacity-v2-'));
 const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,sql,api,cluster,passed=0,migrationSha=null;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  // Disposable TCP-only fixture: never depend on a system-owned Unix socket directory.
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
  started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:8,onnotice:()=>{},connect_timeout:5,idle_timeout:10,
   connection:{application_name:'METAENGINE_NATIVE_CAPACITY_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:0}});
  const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,current_setting('server_version_num')::int as version,
   current_setting('data_directory') as data_directory,(select system_identifier::text from pg_control_system()) as system_identifier`);
  assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');assert.ok(identity.version>=170000&&identity.version<180000);
  assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());cluster=identity.system_identifier;
  await sql.unsafe(`create role anon;create role authenticated;create role service_role;create role seed_api login;create schema extensions;create extension pgcrypto with schema extensions;
   create schema destruktion_meta;grant usage on schema destruktion_meta to seed_api;
   create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
    active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
    admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text);
   create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);
   create table public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id uuid,client_id text,state jsonb,last_seen_at timestamptz default clock_timestamp(),authority_effect boolean default false);
   create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true,generation bigint default 0);
   create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
    $$select jsonb_build_object('generation_floor',coalesce((select generation from public.qa_native_environment where workspace_id=p_workspace),0),'refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),
     'supervisor_admission_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false))$$;
   create function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(value jsonb)returns jsonb language sql immutable as $$select value$$;`);
  const bootstrap=await source('20260929010000_client_v1_fresh_project_bootstrap_v1.sql');
  await sql.unsafe(bootstrap.slice(bootstrap.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22'),bootstrap.indexOf('create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22')));
  await sql.unsafe(bootstrap.slice(bootstrap.indexOf('create or replace function public.devos_fleet_snapshot_v1('),bootstrap.indexOf('create or replace function public.devos_fleet_lease_v1(')));
  const goal=await source('20260929211500_client_v1_goal_progress_reconciliation_v1.sql');
  await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'),goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
  const result=await source('20260929224500_client_v1_agent_origin_result_proof_v1.sql');
  await sql.unsafe(result.slice(0,result.indexOf('-- Keep the existing Client progress contract')));
  await sql.unsafe(await source('20260903052200_devos_dispatch_admission_signed_native_v3.sql'));
  await sql.unsafe(`create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
   for each row execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()`);
  for(const name of ['20261010100000_project_continuity_history_v1.sql','20261012130000_project_verifier_reference_transport_v1.sql','20261015123000_project_unbounded_defaults_v1.sql',
   '20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql','20261025070000_native_coding_project_continuation_v1.sql',
   '20261025080000_native_coding_worktree_lease_admission_v1.sql','20261025090000_native_coding_agent_project_tools_v1.sql','20261025100000_native_coding_checkpoint_commit_rotation_v1.sql','20261025110000_native_coding_initial_goal_seed_v1.sql',migration]){
   const bytes=await source(name);if(name===migration)migrationSha=hash(bytes);await sql.unsafe(bytes);
  }
  await sql.unsafe(await fs.readFile(new URL('./native-agent-count-unbounded-v2.sql',import.meta.url),'utf8'));
  // Preserve the current existing W30 agent/task lock ordering, not just the
  // historical lease body used by the standalone v1 lane.
  const browser=await source('20261026020000_browser_parent_suspension_v1.sql');
  await sql.unsafe(browser.slice(0,browser.indexOf('-- Release readback is deny-only')));
  const managed=await source('20261009194157_managed_project_admission_v1.sql');
  await sql.unsafe(managed.slice(0,managed.indexOf('create or replace function destruktion_meta.a2_managed_project_admission_read_h205f22')));
  await sql.unsafe(await fs.readFile(new URL('./native-coding-setup-operation-v1.sql',import.meta.url),'utf8'));
  const capacitySql=await fs.readFile(new URL('./native-coding-capacity-v2.sql',import.meta.url),'utf8');
  const legacy=await sql.unsafe("select oid::regprocedure::text as signature,prosrc from pg_proc where oid in ('destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb)'::regprocedure,'destruktion_meta.native_coding_service_admissible_v1(uuid)'::regprocedure,'destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb)'::regprocedure,'public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)'::regprocedure) order by 1");
  await sql.begin(tx=>tx.unsafe(capacitySql));await sql.begin(tx=>tx.unsafe(capacitySql));
  assert.deepEqual(await sql.unsafe("select oid::regprocedure::text as signature,prosrc from pg_proc where oid in ('destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb)'::regprocedure,'destruktion_meta.native_coding_service_admissible_v1(uuid)'::regprocedure,'destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb)'::regprocedure,'public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)'::regprocedure) order by 1"),legacy);
  await sql.unsafe('grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) to seed_api');
  api=postgres({host:'127.0.0.1',port,user:'seed_api',database:'postgres',max:3,onnotice:()=>{},connection:{statement_timeout:18000,lock_timeout:0}});
  const census=(f,e,db=sql)=>db.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1,$2,1,$3::text::jsonb) as value',[f.profile.device_id,f.profile.client_id,canonical(e)]).then(r=>r[0].value);
  const rows=f=>sql.unsafe('select destruktion_meta.native_coding_capacity_rows_v1($1,$2) as value',[f.profile.device_id,f.profile.client_id]).then(r=>r.map(x=>x.value));
  async function evidence(f,change={}){
   const [pg]=await sql.unsafe(`select (select system_identifier::text from pg_control_system()) as system_identifier,
    to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
   const now=Date.now();return {schema:'metaengine.native-coding.capacity-evidence.v1',host_instance_id:f.hostInstance,host_pid:f.hostPid,
    device_key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256,admin_grant_epoch:1,main_incarnation:f.serviceInput().host_process.process_incarnation_id,
    postgres_scope_sha256:sha(pg),postgres_system_identifier:pg.system_identifier,postgres_started_at_us:pg.started_at,
    generation:++f.capacityGeneration,observed_at:new Date(now).toISOString(),expires_at:new Date(now+10000).toISOString(),
    owned_tasks:[],owned_setup:[],resolved:[],...change};
  }
  async function packetV2(f,e=undefined){
   e??=await evidence(f);const found=await census(f,e),input=f.serviceInput();input.schema='metaengine.native-coding.service-heartbeat.v2';
   input.runtime.jobs=e.owned_tasks.map(row=>({...row,state:'PHYSICAL_POOL_BUSY'}));input.runtime.occupied_slots=input.runtime.jobs.length;
   const state=found.counts.unresolved_slots?'HOLD':'CURRENT',c={schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:e.host_instance_id,host_pid:e.host_pid,
    principal_sha256:hash(['metaengine.native-coding.capacity-principal.v1',f.profile.device_id,f.profile.client_id,'1',f.profile.device_key_fingerprint_sha256].join('\n')),
    postgres_scope_sha256:e.postgres_scope_sha256,generation:e.generation,owned_tasks_sha256:sha(e.owned_tasks),observed_at:e.observed_at,expires_at:e.expires_at,
    ...found,complete:true,state,automatic_retry_allowed:false,authority_effect:false};
   const tasks=e.owned_tasks.length+found.counts.task_slots-found.counts.represented_tasks;
   input.capacity={census:c,projection:{schema:'metaengine.native-coding.capacity-projection.v1',configured_ceiling:input.runtime.physical_slot_budget,
    resource_ceiling:input.runtime.physical_slot_budget,occupied_task_slots:tasks,occupied_setup_slots:found.counts.setup_slots,unresolved_slots:found.counts.unresolved_slots,
    state,generation:e.generation,census_sha256:c.census_sha256,local_revision:0,
    free_slots:state==='CURRENT'?Math.max(0,input.runtime.physical_slot_budget-tasks-found.counts.setup_slots):0,authority_effect:false}};
   return {packet:f.signed(input,{},'SERVICE_HEARTBEAT_V2'),evidence:e};
  }
  const writeV2=(f,record,db=sql)=>db.begin('isolation level serializable',async tx=>{
   await tx.unsafe('set local synchronous_commit=on');return(await tx.unsafe('select destruktion_meta.native_coding_service_heartbeat_v2($1,$2,1,$3,$4,$5::text::jsonb,$5::text,$6::text::jsonb,$7::text::jsonb) as value',
    [f.profile.device_id,f.profile.client_id,f.hostInstance,f.hostPid,canonical(record.packet.body),canonical(record.packet.headers),canonical(record.evidence)]))[0].value;
  });
  const apiLease=(f,agent=f.agents[0],db=api)=>db.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',
   [f.profile.workspace_id,agent.agent_id,agent.role,'native-coding:'+agent.provider_id,'codex-cli:'+agent.provider_id]).then(r=>r[0].value);
  async function setupInput(f,workspaceId=f.profile.workspace_id){
   const actor={device_id:f.profile.device_id,client_id:f.profile.client_id,admin_grant_epoch:1,key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256};
   const repository={coordination_workspace_id:workspaceId,device_id:actor.device_id,client_id:actor.client_id,admin_grant_epoch:1,
    repo_id:'fixture:'+randomUUID(),repo_root:'/fixture/'+randomUUID()+'/repo',managed_root:'/fixture/'+randomUUID()+'/managed'};
   await sql.unsafe('insert into public.compute_fabric_a2_managed_project_repository_h205f22(coordination_workspace_id,device_id,client_id,admin_grant_epoch,repo_id,repo_root,managed_root) values($1,$2,$3,1,$4,$5,$6)',
    [repository.coordination_workspace_id,actor.device_id,actor.client_id,repository.repo_id,repository.repo_root,repository.managed_root]);
   return {actor,input:{operation_id:randomUUID(),workspace_id:repository.coordination_workspace_id,repository_scope_sha256:sha(repository),repo_root_identity_sha256:sha(repository.repo_root),
    managed_root_identity_sha256:sha(repository.managed_root),actor,repository,host_instance_id:f.hostInstance,host_pid:f.hostPid}};
  }
  const setupRaw=(f,record,e,action='BEGIN',value={},tx=sql)=>tx.unsafe('select destruktion_meta.native_coding_setup_operation_v2($1,$2::text::jsonb,$3::text::jsonb,$4::text::jsonb,$5::text::jsonb,$6) as value',
   [action,canonical(record.actor),canonical(action==='BEGIN'?record.input:{operation_id:record.input.operation_id,workspace_id:record.input.workspace_id}),canonical(value),canonical(e),f.profile.physical_slot_budget]).then(r=>r[0].value);
  const setup=(f,record,e,action='BEGIN',value={},db=sql)=>db.begin('isolation level serializable',async tx=>{
   await tx.unsafe('set local synchronous_commit=on');return setupRaw(f,record,e,action,value,tx);
  });
  function held(operation,{db=sql,isolation='isolation level serializable'}={}){
   let release,announce,deny,pid;const gate=new Promise(r=>{release=r;}),ready=new Promise((r,j)=>{announce=r;deny=j;});
   const done=db.begin(isolation,async tx=>{await tx.unsafe('set local synchronous_commit=on');pid=(await tx.unsafe('select pg_backend_pid() as pid'))[0].pid;const value=await operation(tx);announce(value);await gate;return value;});
   done.catch(deny);return {ready,done,release,pid:()=>pid};
  }
  async function waitForAdvisory(blocker,expected='advisory'){
   for(let i=0;i<200;i++){
    const waiting=await sql.unsafe("select wait_event from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and $1::integer=any(pg_blocking_pids(pid))",[blocker]);
    if(waiting.length){if(expected!==null)assert.equal(waiting[0].wait_event,expected);return waiting[0].wait_event;}await new Promise(r=>setTimeout(r,5));
   }
   assert.fail('actual PostgreSQL advisory wait not observed');
  }
  const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
  const refused=result=>{assert.equal(result.ok,false);assert.ok(['55000','40001'].includes(result.error.code),result.error.message);};
  async function fixture({pairs=2,budget=2,shared=null,clientOverride=null}={}){
   const generated=shared?.generated||admissionFixture(),p=shared?{...structuredClone(generated.permit),workspace_id:randomUUID()}:generated.permit,pairing=randomUUID(),agents=[];
   p.postgres.system_identifier=cluster;
   const [fixturePg]=await sql.unsafe('select pg_postmaster_start_time() as started_at');
   p.postgres.postmaster={pid:999,created_at:new Date(fixturePg.started_at).toISOString(),process_incarnation_id:'pid:999:created_100ns:'+String(BigInt(new Date(fixturePg.started_at).getTime())*10000n+116444736000000000n)};
   for(let i=0;i<pairs;i++){
    const worktree={...p.worktree,path:p.worktree.path+'-service'+i,root_identity_sha256:sha([randomUUID(),i])};
    for(const role of ['IMPLEMENTER','CRITIC'])agents.push({provider_id:randomUUID(),agent_id:'agent_service-'+randomUUID().slice(0,8),role,agent_generation_epoch:1,
     worktree:structuredClone(worktree),sandbox:{...generated.payload().sandbox,mode:role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:role==='CRITIC'}});
   }
   const profile={schema:'metaengine.native-coding.seed-profile.v1',trust_namespace:'LOCAL_OPERATOR_QA',profile_id:randomUUID(),workspace_id:p.workspace_id,
    device_id:p.device_id,client_id:clientOverride||generated.clientId,admin_grant_epoch:1,device_key_fingerprint_sha256:p.device_key_fingerprint_sha256,owner_epoch:1,
    user_sid:p.user_sid,artifact:p.artifact,postgres:p.postgres,agents,primary_provider_id:agents[0].provider_id,physical_slot_budget:budget,expires_at:p.expires_at,
    storage_evidence_sha256:sha(randomUUID()),branch_name:'work/native-service',policy:{max_depth:null,max_tasks:null,max_children:null},
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
   if(!shared){await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pairing]);
   await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
    values($1,$2,$3,$4,$5,$6)`,[profile.device_id,profile.client_id,generated.identity.profile,sql.json(generated.jwk),profile.device_key_fingerprint_sha256,pairing]);}
   const browserState={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
    transport_identity:{profile:generated.identity.profile,device_id:profile.device_id,key_fingerprint_sha256:profile.device_key_fingerprint_sha256},
    supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:false,keepalive:{state:'WAKE_AMBIGUOUS',pending_wake:{wake_id:randomUUID(),old_effect:'UNKNOWN'}}}};
   await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[profile.workspace_id,profile.client_id,sql.json(browserState)]);
   await sql.unsafe('insert into public.qa_native_environment(workspace_id,enabled,generation)values($1,true,0)',[profile.workspace_id]);
   const text=canonical(profile),profileSha=hash(text);await sql.unsafe(`insert into destruktion_meta.native_coding_seed_profile_h205f22(profile_id,profile,canonical_profile,profile_sha256)values($1,$2::text::jsonb,$2::text,$3)`,[profile.profile_id,text,profileSha]);
   const input={request_id:randomUUID(),objective:'Native service goal independent of historical browser send ambiguity'};
   const observation={schema:'metaengine.native-coding.seed-observation.v1',profile_id:profile.profile_id,profile_sha256:profileSha,observed_at:new Date().toISOString(),
    host_process:generated.payload().host_process,user_sid:profile.user_sid,artifact:profile.artifact,postgres:profile.postgres,
    agents:agents.map(a=>({provider_id:a.provider_id,worktree:a.worktree,sandbox:a.sandbox})),installed_execution_proven:false,
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
   const seed=await sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');const txt=canonical(observation);
    return(await tx.unsafe('select destruktion_meta.native_coding_seed_goal_v1($1,$2,$3,$4::text::jsonb,$4::text,$5)as value',[profile.profile_id,input.request_id,input.objective,txt,hash(txt)]))[0].value.receipt;});
   const records=await sql.unsafe('select permit_id,permit from destruktion_meta.native_coding_operator_permit_h205f22 where workspace_id=$1 order by permit_id',[profile.workspace_id]);
   const providers=[],nativeDescriptors=[];
   for(const {permit_id,permit}of records){
    const {schema,issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,...scope}=permit;
    const agent=agents.find(a=>a.provider_id===permit.provider_id),payload={...generated.payload(),...scope,target_id:'codex-cli:'+permit.provider_id,sandbox:agent.sandbox,
     proven_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+50000).toISOString()};
    const envelope=generated.envelope(payload),envelopeSha=sha(envelope);
    nativeDescriptors.push(envelope);
    await sql.unsafe('insert into destruktion_meta.native_coding_provider_registration_h205f22(permit_id,envelope,canonical_envelope,envelope_sha256)values($1,$2,$3,$4)',[permit_id,sql.json(envelope),canonical(envelope),envelopeSha]);
    providers.push({permit_id,provider_id:permit.provider_id,agent_id:permit.agent_id,role:permit.role,agent_generation_epoch:1,envelope_sha256:envelopeSha});
   }
   const hostInstance=shared?.hostInstance||randomUUID(),hostPid=12345,verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:hostInstance,hostPid});
   const auth=createNativeCodingAuthenticatedRequestContext({verifier});
   const publicationControl={denyPhysical:false,loseCommitAck:false,writeTransactions:0};
   const heartbeatSql={unsafe:(...args)=>sql.unsafe(...args),begin:async(...args)=>{
    publicationControl.writeTransactions++;const value=await sql.begin(...args);
    if(publicationControl.loseCommitAck)throw Error('fixture_heartbeat_commit_ack_lost');return value;}};
   const host=createNativeCodingHostServiceHeartbeat({sql:heartbeatSql,hostInstanceId:hostInstance,hostPid,readCurrentDevice:auth.readCurrentDevice,
    readNativeScope:async permit=>({host_process:generated.payload().host_process,user_sid:permit.user_sid,
     artifact:publicationControl.denyPhysical?{...permit.artifact,installed_exe_sha256:'0'.repeat(64)}:permit.artifact,
     postgres:permit.postgres,worktree:permit.worktree,sandbox:agents.find(a=>a.provider_id===permit.provider_id).sandbox})});
   const serviceInput=()=>({schema:'metaengine.native-coding.service-heartbeat.v1',workspace_id:profile.workspace_id,host_process:generated.payload().host_process,
    artifact:structuredClone(profile.artifact),postgres:structuredClone(profile.postgres),control:{supervisor_mode:'CONTROL',armed:true,interrupted_setup_recovery_fenced:false,runtime_control_generation:0},
    runtime:{schema:'metaengine.native-coding.runtime.v1',physical_slot_budget:budget,occupied_slots:0,closed:false,shutdown_state:'OPEN',host_unavailable_reason:null,jobs:[]},
    providers:structuredClone(providers),production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
   let clock=Date.now();
   const signed=(input=serviceInput(),{timestamp,nonce=randomUUID().replaceAll('-',''),signedHost=hostInstance,signedPid=hostPid}={},operation='SERVICE_HEARTBEAT')=>{
    const body={host_instance_id:signedHost,host_pid:signedPid,operation,input};
    const bodysha=hash(canonical(body)),stamp=timestamp||new Date(Math.max(Date.now(),++clock)).toISOString();
    const purpose='/private/native-coding/'+operation.toLowerCase().replaceAll('_','-');
    const material=['A2_DEVICE_HTTP_SIGNATURE_V1',`device_id:${profile.device_id}`,'method:POST',`path:${purpose}`,`timestamp:${stamp}`,`nonce:${nonce}`,`body_sha256:${bodysha}`].join('\n');
    const headers={'content-type':'application/json','x-a2-chat-bridge-client':profile.client_id,'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
     'x-a2-device-id':profile.device_id,'x-a2-device-timestamp':stamp,'x-a2-device-nonce':nonce,'x-a2-device-body-sha256':bodysha,
     'x-a2-device-signature':sign('sha256',Buffer.from(material),{key:generated.pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
    return{body,headers};
   };
   const write=async packet=>sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');
    return(await tx.unsafe('select destruktion_meta.native_coding_service_heartbeat_v1($1,$2,1,$3,$4,$5::text::jsonb,$5::text,$6)as value',
     [profile.device_id,profile.client_id,hostInstance,hostPid,canonical(packet.body),sql.json(packet.headers)]))[0].value;});
   const publish=async packet=>{const value=packet||signed();return auth.run('SERVICE_HEARTBEAT',value,()=>host.SERVICE_HEARTBEAT(value));};
   const read=async bodySha=>{const packet=signed({workspace_id:profile.workspace_id,body_sha256:bodySha},{},'READ_SERVICE_HEARTBEAT');
    return auth.run('READ_SERVICE_HEARTBEAT',packet,()=>host.READ_SERVICE_HEARTBEAT(packet));};
   const publisherIdentity={snapshot:()=>({enrolled:true,device_id:profile.device_id,client_id:profile.client_id,key_fingerprint_sha256:profile.device_key_fingerprint_sha256}),
    deviceHeaders:async(_method,_purpose,text)=>{const body=JSON.parse(text);return signed(body.input,{},body.operation).headers;}};
   const publisherCapability={snapshot:()=>({instance_id:hostInstance,host_pid:hostPid}),serviceHeartbeat:publish,
    readServiceHeartbeat:packet=>auth.run('READ_SERVICE_HEARTBEAT',packet,()=>host.READ_SERVICE_HEARTBEAT(packet))};
   const permitFor=agent=>records.find(r=>r.permit.provider_id===agent.provider_id).permit;
   const lease=async(agent=agents[0])=>(await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900)as value',
    [profile.workspace_id,agent.agent_id,agent.role,'native-coding:'+agent.provider_id,'codex-cli:'+agent.provider_id]))[0].value;
   const seedPeer=async(agent)=>{const permit=permitFor(agent),spec={schema:'metaengine.devos.project-task-spec.v1',objective:'Generated independent root capacity task',claim_class:'MUTATING',
    native_coding:{permit_id:permit.permit_id,goal_id:permit.goal_id,goal_sha256:permit.goal_sha256,project_id:permit.project_id}};
    const [r]=await sql.unsafe('select public.devos_fleet_enqueue_v1($1,$2,$3,$4,$5,$6,null,50)as value',
     [profile.workspace_id,'native.peer.'+randomUUID(),agent.role,permit.worktree.base_sha,sql.json(spec),'native.peer:'+randomUUID()]);
    const [pr]=await sql.unsafe('update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=$1 returning total_tasks',[seed.project_id]);
    await sql.unsafe('insert into destruktion_meta.project_task_h205f22 values($1,$2,$3,$4,$4,1)',[r.value.task_id,seed.project_id,pr.total_tasks,seed.root_task_id]);return r.value.task_id;};
   const state=async()=>(await sql.unsafe('select state from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=$1',[profile.workspace_id]))[0].state;
   return{hostInstance,hostPid,capacityGeneration:0,generated,profile,agents,providers,nativeDescriptors,publisherIdentity,publisherCapability,seed,browserState,serviceInput,signed,write,publish,read,permitFor,lease,seedPeer,state,verifier,publicationControl};
  }
  async function hostCapacity(f,{readHook=async()=>{},custody=()=>({closed:false,revision:0,jobs:[]}),clock={},birthChange=x=>x,queryHook=async()=>{},nativeChange=x=>x,startupPid=999}={}){
   let reads=0;
   const native=async()=>{await readHook(++reads);const [pg]=await sql.unsafe(`select pg_postmaster_start_time() as started_at`);
    return nativeChange({host_process:f.serviceInput().host_process,postgres:{system_identifier:cluster,
     postmaster:{pid:startupPid,created_at:new Date(pg.started_at).toISOString(),process_incarnation_id:f.profile.postgres.postmaster.process_incarnation_id},
     data_directory_identity_sha256:f.profile.postgres.data_directory_identity_sha256},user_sid:f.profile.user_sid});};
   const [birth]=await sql.unsafe(`select to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
   const observed={unsafe:(...args)=>sql.unsafe(...args),begin:(mode,fn)=>sql.begin(mode,tx=>fn({unsafe:async(q,args)=>{const rows=await tx.unsafe(q,args);await queryHook(q,rows);return rows;}}))};
   const service=createNativeCodingHostCapacity({sql:observed,hostInstanceId:f.hostInstance,hostPid:f.hostPid,postgresIdentity:{pid:startupPid,system_identifier:cluster,started_at:birthChange(birth.started_at)},readNativeScope:native,readSetupCustody:custody,...clock});
   const read=(input={owned_tasks:[]})=>service.operations.READ_NATIVE_CAPACITY_V1(f.signed(input,{},'READ_NATIVE_CAPACITY_V1'));
   return {service,read,reads:()=>reads};
  }
  await t.test('actual signed Host census composes own-PG current auth and physical fixture scope without writing or descriptors',async()=>{
   const f=await fixture(),h=await hostCapacity(f);try{
    const first=await h.read();assert.equal(first.state,'CURRENT');assert.equal(first.complete,true);assert.deepEqual(first.counts,{task_slots:0,setup_slots:0,unrepresented_claims:0,represented_tasks:0,unresolved_slots:0});
    const second=await h.read();assert.ok(second.generation>first.generation);assert.equal(h.reads(),6);
    assert.ok(!JSON.stringify(first).includes(f.profile.device_id));assert.ok(!JSON.stringify(first).includes('C:'));
    assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id])).length,0);
    for(const extra of [{resolved:[]},{free_slots:99},{evidence:{}},{path:'/caller'}])await assert.rejects(h.read({owned_tasks:[],...extra}),/contract_invalid/);
   }finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  await t.test('Host census does not resolve terminal SQL or protected result label without joined durable cleanup producer',async()=>{
   const f=await fixture(),h=await hostCapacity(f);try{
    const input=await setupInput(f),e=await evidence(f);await setup(f,input,e);
    const custody_id=randomUUID();await setup(f,input,e,'CLAIM',{custody_id,host_instance_id:f.hostInstance,host_pid:f.hostPid});
    await setup(f,input,e,'TERMINAL',{custody_id,state:'HOLD',reason:'MATERIALIZATION_UNAVAILABLE',cleanup_state:'DRAINED'});
    const result=await h.read();assert.equal(result.state,'HOLD');assert.equal(result.counts.unresolved_slots,1);
    assert.equal(h.service.snapshot().reason,'HISTORICAL_SETTLEMENT_UNVERIFIED');
   }finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  await t.test('Host census recognizes only exact live unchanged setup custody, not another client or a terminal callback',async()=>{
   const f=await fixture();let custody={closed:false,revision:1,jobs:[]};const h=await hostCapacity(f,{custody:()=>custody});try{
    const input=await setupInput(f),e=await evidence(f),custody_id=randomUUID();await setup(f,input,e);await setup(f,input,e,'CLAIM',{custody_id,host_instance_id:f.hostInstance,host_pid:f.hostPid});
    custody.jobs=[{operation_id:input.input.operation_id,custody_id,device_id:f.profile.device_id,client_id:f.profile.client_id,admin_grant_epoch:1,active:true}];
    const current=await h.read();assert.equal(current.state,'CURRENT');assert.equal(current.counts.setup_slots,1);
    custody.jobs[0].client_id=randomUUID();assert.equal((await h.read()).state,'HOLD');
    custody.jobs[0].client_id=f.profile.client_id;custody.jobs[0].active=false;assert.equal((await h.read()).state,'HOLD');
   }finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  for(const change of ['grant','key','custody','durable'])await t.test('actual Host census fences '+change+' change between physical reads',async()=>{
   const f=await fixture();let revision=0;const h=await hostCapacity(f,{custody:()=>({closed:false,revision,jobs:[]}),readHook:async n=>{if(n!==2)return;
    if(change==='grant')await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.profile.device_id]);
    if(change==='key')await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set key_fingerprint_sha256=$2 where device_id=$1',[f.profile.device_id,'f'.repeat(64)]);
    if(change==='custody')revision++;
    if(change==='durable'){const input=await setupInput(f);await setup(f,input,await evidence(f));}
   }});try{await assert.rejects(h.read(),/GRANT_REVOKED|identity_changed|collection_changed/);}
   finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  await t.test('Host quit fences late capacity read but joins exact in-flight read; competing collection never overlaps',async()=>{
   const f=await fixture();let release,entered;const wait=new Promise(r=>{release=r;}),start=new Promise(r=>{entered=r;});
   const h=await hostCapacity(f,{readHook:async()=>{entered();await wait;}});
   const read=h.read();const rejected=assert.rejects(read,/closed/);await start;
   await assert.rejects(h.read(),/collection_inflight/);h.service.close();let drained=false;const drain=h.service.drain().then(()=>{drained=true;});
   await new Promise(r=>setTimeout(r,10));assert.equal(drained,false);release();await rejected;await drain;assert.equal(h.service.snapshot().retained_observations,0);f.verifier.close();
  });
  await t.test('Host monotonic collection deadline cannot be extended by stalled wall clock',async()=>{
   const f=await fixture();const wall=Date.now();let mono=0;const h=await hostCapacity(f,{clock:{now:()=>wall,monotonic:()=>mono},readHook:async()=>{mono+=10000;}});
   try{await assert.rejects(h.read(),/collection_expired/);}finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  await t.test('same-millisecond different PostgreSQL birth fails exact startup binding before OS observation',async()=>{
   const f=await fixture();const h=await hostCapacity(f,{birthChange:stamp=>{const changed=stamp.replace(/(\d)Z$/,(_,n)=>((Number(n)+1)%10)+'Z');assert.equal(Date.parse(changed),Date.parse(stamp));assert.notEqual(changed,stamp);return changed;}});
   try{await assert.rejects(h.read(),/postgres_incarnation_changed/);assert.equal(h.reads(),0);}finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  for(const kind of ['parent','postmaster','root'])await t.test('OS '+kind+' change specifically during final count cannot publish earlier matched scope',async()=>{
   const f=await fixture();let changed=false;const h=await hostCapacity(f,{queryHook:async q=>{if(q.includes('native_coding_capacity_census_v1'))changed=true;},nativeChange:scope=>{
    if(changed){if(kind==='parent')scope.host_process={...scope.host_process,process_incarnation_id:'pid:9000:created_100ns:134055792000000001'};
     if(kind==='postmaster')scope.postgres.postmaster.process_incarnation_id='pid:999:created_100ns:134055792000000001';
     if(kind==='root')scope.postgres.data_directory_identity_sha256='c'.repeat(64);}return scope;
   }});
   try{await assert.rejects(h.read(),/physical_scope_changed_during_count/);assert.equal(h.service.snapshot().retained_observations,0);}finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  await t.test('whole-device aggregate covers 2048 historical rows and detects a mutation beyond former 1025 prefix',async()=>{
   const f=await fixture();
   // Direct owner inserts are generated test history, not authorized setup effects.
   await sql.unsafe(`insert into destruktion_meta.native_coding_setup_operation_h205f22(operation_id,intent,state,cleanup_state)
    select gen_random_uuid(),jsonb_build_object('actor',jsonb_build_object('device_id',$1::text,'client_id',$2::text,'admin_grant_epoch',1),'host_instance_id',$3::text,'host_pid',$4::integer),'STOPPED','DRAINED' from generate_series(1,2048)`,
    [f.profile.device_id,f.profile.client_id,f.hostInstance,f.hostPid]);
   const h=await hostCapacity(f);try{const value=await h.read();assert.equal(value.complete,true);assert.equal(value.counts.setup_slots,2048);assert.equal(value.counts.unresolved_slots,2048);assert.equal(value.state,'HOLD');}
   finally{h.service.close();await h.service.drain();}
   const changed=await hostCapacity(f,{readHook:async n=>{if(n===2)await sql.unsafe(`update destruktion_meta.native_coding_setup_operation_h205f22 set reason='FIXTURE_CHANGED_BEYOND_PREFIX' where operation_id=(select operation_id from destruktion_meta.native_coding_setup_operation_h205f22 where intent#>>'{actor,device_id}'=$1 order by operation_id desc limit 1)`,[f.profile.device_id]);}});
   try{await assert.rejects(changed.read(),/collection_changed/);}finally{changed.service.close();await changed.service.drain();f.verifier.close();}
  });
  await t.test('private observation cache is bounded and expiry cannot evict any physical custody',async()=>{
   const f=await fixture();let mono=0;const h=await hostCapacity(f,{clock:{monotonic:()=>mono}});
   try{for(let i=0;i<128;i++)await h.read();assert.equal(h.service.snapshot().retained_observations,128);await assert.rejects(h.read(),/observation_budget/);
    mono=10001;assert.equal((await h.read()).state,'CURRENT');assert.equal(h.service.snapshot().retained_observations,1);
   }finally{h.service.close();await h.service.drain();f.verifier.close();}
  });
  async function wiredV2(f,{capacityOptions={},loseAck=false,runtimeReader=null,capacityReader=null}={}){
   const capacity=await hostCapacity(f,capacityOptions),verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:f.hostInstance,hostPid:f.hostPid}),auth=createNativeCodingAuthenticatedRequestContext({verifier});
   const native=async p=>({host_process:f.serviceInput().host_process,postgres:f.profile.postgres,artifact:p.artifact,user_sid:p.user_sid,worktree:p.worktree,sandbox:f.agents.find(a=>a.provider_id===p.provider_id).sandbox});
   const service=createNativeCodingHostServiceHeartbeatV2({sql,hostInstanceId:f.hostInstance,hostPid:f.hostPid,readCurrentDevice:auth.readCurrentDevice,readNativeScope:native,
    readCapacityEvidence:value=>capacity.service.readPublicationEvidence(value)});
   let observation=null,writes=0,reads=0;
   const cap={snapshot:()=>({instance_id:f.hostInstance,host_pid:f.hostPid,closed:false}),serviceHeartbeatV2:packet=>auth.run('SERVICE_HEARTBEAT_V2',packet,async()=>{writes++;const ack=await service.SERVICE_HEARTBEAT_V2(packet);if(loseAck&&writes===1)throw Error('generated_lost_ack');return ack;}),
    readServiceHeartbeatV2:packet=>auth.run('READ_SERVICE_HEARTBEAT_V2',packet,()=>{reads++;return service.READ_SERVICE_HEARTBEAT_V2(packet);})};
   const publisher=createNativeCodingServiceHeartbeatPublisherV2({identity:f.publisherIdentity,ownPostgres:cap,readControl:()=>f.serviceInput().control,readRuntime:runtimeReader||(()=>f.serviceInput().runtime),
    readProviders:()=>f.nativeDescriptors,readCapacity:capacityReader||(()=>observation)});
   return {capacity,service,publisher,cap,observe:async(owned=[])=>{const census=await capacity.read({owned_tasks:owned});observation={census,projection:nativeCapacityProjection({census,configuredCeiling:f.profile.physical_slot_budget,resourceCeiling:f.profile.physical_slot_budget,localTaskCount:owned.length,localRevision:0})};return observation;},
    publish:async()=>{publisher.observe();await publisher.drain();},packet:()=>{const input={...f.serviceInput(),schema:'metaengine.native-coding.service-heartbeat.v2',capacity:observation};return f.signed(input,{},'SERVICE_HEARTBEAT_V2');},
    get writes(){return writes;},get reads(){return reads;},get observation(){return observation;},
    async close(){publisher.close();await publisher.drain();capacity.service.close();await capacity.service.drain();service.close();auth.close();verifier.close();f.verifier.close();}};
  }
  async function cycleThroughPg(f,providers,onLease=()=>{}){
   const rpc=async(name,input)=>{
     if(name==='native_coding_admission_context_v1')return (await sql.unsafe('select public.native_coding_admission_context_v1($1,$2,$3) as value',[input.p_workspace,input.p_client,input.p_permit]))[0].value;
     if(name==='devos_fleet_snapshot_v1')return (await sql.unsafe('select public.devos_fleet_snapshot_v1($1) as value',[input.p_workspace]))[0].value;
     if(name==='devos_fleet_reconcile_v1')return (await sql.unsafe('select public.devos_fleet_reconcile_v1($1) as value',[input.p_workspace]))[0].value;
     if(name==='devos_fleet_lease_v1'){onLease();return apiLease(f,f.agents.find(a=>a.agent_id===input.p_agent));}
     return {}; // Unrelated Meta planner projection is a generated no-work fixture.
    };
   return createDevosSupervisorRoutes({rpc,workspaceId:f.profile.workspace_id})({req:{method:'POST'},path:'/v1/devos/cycle',clientId:f.profile.client_id,identity:f.generated.identity,
     body:{fleet:{agents:[]},native_coding:{schema:'metaengine.native-coding.providers.v1',providers}}});
  }
  await t.test('actual authenticated Host census feeds fixed signed v2 producer and private evidence lookup into real W30 guard',async()=>{
   const f=await fixture({budget:1}),v=await wiredV2(f);try{
    await v.observe();await v.publish();assert.equal(v.writes,1);assert.equal(v.publisher.snapshot().state,'ACKNOWLEDGED');assert.ok(v.publisher.admittedProviders().length);
    assert.equal((await apiLease(f)).leased,true);
    const [stored]=await sql.unsafe('select capacity_evidence,body from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id]);
    assert.deepEqual(stored.capacity_evidence.resolved,[]);assert.equal(stored.body.input.schema,'metaengine.native-coding.service-heartbeat.v2');
    assert.match(stored.capacity_evidence.postgres_started_at_us,/\.\d{6}Z$/);
   }finally{await v.close();}
  });
  await t.test('lost v2 ACK reconciles exact existing SQL witness with READ only, not another publication',async()=>{
   const f=await fixture(),v=await wiredV2(f,{loseAck:true});try{
    await v.observe();await v.publish();assert.equal(v.publisher.snapshot().unknown_write_retained,true);assert.equal(v.writes,1);
    await v.publish();assert.equal(v.writes,1);assert.equal(v.reads,1);assert.equal(v.publisher.snapshot().unknown_write_retained,false);assert.ok(v.publisher.admittedProviders().length);
   }finally{await v.close();}
  });
  for(const mutation of ['generation','digest','counts','actor','native','evicted'])await t.test('v2 private lookup refuses '+mutation+' without a heartbeat write',async()=>{
   const f=await fixture();let nativeChanged=false;const v=await wiredV2(f,{capacityOptions:{nativeChange:scope=>{if(nativeChanged)scope.postgres.data_directory_identity_sha256='e'.repeat(64);return scope;}}});try{
    await v.observe();const input={actor:{device_id:f.profile.device_id,client_id:f.profile.client_id,key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256,admin_grant_epoch:1},
     census:structuredClone(v.observation.census),host_process:f.serviceInput().host_process,postgres:f.profile.postgres};
    if(mutation==='generation')input.census.generation++;if(mutation==='digest')input.census.census_sha256='e'.repeat(64);
    if(mutation==='counts')input.census.counts.task_slots=99;if(mutation==='actor')input.actor.admin_grant_epoch++;
    if(mutation==='native')nativeChanged=true;if(mutation==='evicted')v.capacity.service.close();
    await assert.rejects(v.capacity.service.readPublicationEvidence(input),/publication_|closed/);
    assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id])).length,0);
   }finally{await v.close();}
  });
  await t.test('genuinely signed foreign Host v2 envelope is rejected by current authority before publication',async()=>{
   const f=await fixture(),v=await wiredV2(f);try{
    await v.observe();const input={...f.serviceInput(),schema:'metaengine.native-coding.service-heartbeat.v2',capacity:v.observation};
    for(const change of [{signedHost:randomUUID()},{signedPid:f.hostPid+1}])await assert.rejects(v.cap.serviceHeartbeatV2(f.signed(input,change,'SERVICE_HEARTBEAT_V2')),/host_changed/);
    assert.equal(v.writes,0);assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id])).length,0);
   }finally{await v.close();}
  });
  for(const change of ['revoked','rotated-key','monotonic-expired','cache-evicted','custody-changed'])await t.test('fixed v2 producer rejects current '+change+' before admission',async()=>{
   const f=await fixture();let mono=0,revision=0;const v=await wiredV2(f,{capacityOptions:{clock:{monotonic:()=>mono},custody:()=>({closed:false,revision,jobs:[]})}});
   try{
    await v.observe();
    if(change==='revoked')await sql.unsafe("update public.compute_fabric_a2_browser_device_h205f22 set admin_revoked_at=clock_timestamp() where device_id=$1",[f.profile.device_id]);
    if(change==='rotated-key')await sql.unsafe("update public.compute_fabric_a2_browser_device_h205f22 set key_fingerprint_sha256=$2 where device_id=$1",[f.profile.device_id,'f'.repeat(64)]);
    if(change==='monotonic-expired'||change==='cache-evicted')mono=10001;
    if(change==='cache-evicted'){await v.capacity.read();assert.equal(v.capacity.service.snapshot().retained_observations,1);}
    if(change==='custody-changed')revision++;
    await v.publish();assert.equal(v.publisher.admittedProviders().length,0);
    assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id])).length,0);
   }finally{await v.close();}
  });
  await t.test('real issued W30 lease is retained by Main, represented once in signed v2 and first-dispatched only by explicit tick',async()=>{
   const f=await fixture({budget:1}),owner=createNativeCodingCapacityOwner(),limits={configuredCeiling:1,resourceCeiling:1};let starts=0,preparation;
   const binding={instance_id:f.hostInstance,host_pid:f.hostPid,closed:false};
   const pool=createNativeCodingExecutionPool({capacityOwner:owner,physicalSlotBudget:1,readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:1}),
    readExecutionBinding:()=>binding,prepareRequest:lease=>(preparation=(async()=>{const [row]=await sql.unsafe('select state,lease_generation,lease_agent_id,lease_expires_at from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[lease.task_id]);
     assert.equal(row.state,'LEASED');assert.equal(Number(row.lease_generation),lease.lease_generation);assert.equal(row.lease_agent_id,lease.agent_id);assert.ok(Date.parse(row.lease_expires_at)>Date.now());return {lease};})()),
    executor:{execute:async()=>{starts++;return {state:'READBACK_REQUIRED'};}},readPriorExecution:async()=>({state:'HOLD'})});
   const v=await wiredV2(f,{runtimeReader:()=>({...f.serviceInput().runtime,occupied_slots:pool.snapshot().occupied_slots,jobs:pool.snapshot().jobs}),capacityReader:()=>owner.readObservation(limits)});
   owner.bind({capability:v.cap,...binding,principal_sha256:nativeCapacityPrincipal({device_id:f.profile.device_id,client_id:f.profile.client_id,admin_grant_epoch:1,key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256}),readBinding:()=>binding,
    readPrincipal:()=>nativeCapacityPrincipal({device_id:f.profile.device_id,client_id:f.profile.client_id,admin_grant_epoch:1,key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256}),poolToken:pool.capacityPoolToken});
   const collect=()=>owner.collect(owned=>v.capacity.read({owned_tasks:owned}));
   try{
    await collect();await v.publish();assert.equal(v.publisher.snapshot().state,'ACKNOWLEDGED');const lease=await apiLease(f);assert.equal(lease.leased,true);
    assert.equal(pool.dispatch(lease).reason,'WAITING_CAPACITY');assert.equal(pool.snapshot().occupied_slots,1);await pool.observe(lease);assert.equal(starts,0);
    const counted=await collect();assert.equal(counted.counts.task_slots,1);assert.equal(counted.counts.represented_tasks,1);assert.equal(counted.counts.unrepresented_claims,0);
    assert.equal(owner.projection(limits).occupied_task_slots,1);assert.equal(owner.projection(limits).free_slots,0);await v.publish();assert.equal(v.publisher.snapshot().state,'ACKNOWLEDGED');
    const record=await setupInput(f),e=await v.capacity.service.readSetupAdmission({actor:record.actor});
    await assert.rejects(setup(f,record,e),/native_capacity_setup_hold/);assert.equal(starts,0);
    const providers=v.publisher.admittedProviders();assert.ok(providers.some(p=>p.payload.agent_id===lease.agent_id),'free0 must retain current provider observation');
    const peer=f.agents.find(a=>a.role==='IMPLEMENTER'&&a.agent_id!==lease.agent_id);await f.seedPeer(peer);let leaseAttempts=0;
    const response=await cycleThroughPg(f,providers,()=>{leaseAttempts++;});
    assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.leases.length,0);assert.ok(leaseAttempts>0,'real SQL refused another READY task at full capacity');
    const projected=plan.running.find(r=>r.task_id===lease.task_id);assert.ok(projected,'actual cycle retains LEASED native work at free0');
    for(const field of ['task_id','lease_generation','agent_id','agent_generation_epoch','tab_id','target_id','role','base_sha'])assert.equal(projected[field],lease[field],field);
    assert.equal(pool.advanceUnattemptedLease(projected).state,'PREPARING');await new Promise(r=>setImmediate(r));await preparation;await new Promise(r=>setImmediate(r));assert.equal(starts,1);
    await collect();pool.advanceUnattemptedLease(lease);await pool.observe(lease);assert.equal(starts,1);assert.equal(pool.snapshot().occupied_slots,1);
   }finally{await pool.stop();owner.close();await owner.drain();await v.close();}
  });
  await t.test('concurrent setup occupancy refuses new SQL claim but preserves actual cycle retained-work projection',async()=>{
   const f=await fixture({budget:2});let lease=null;const v=await wiredV2(f,{runtimeReader:()=>({...f.serviceInput().runtime,occupied_slots:lease?1:0,jobs:lease?[{task_id:lease.task_id,lease_generation:lease.lease_generation,state:'PHYSICAL_POOL_BUSY'}]:[]})});
   try{
    await v.observe();await v.publish();lease=await apiLease(f);assert.equal(lease.leased,true);
    await v.observe([{task_id:lease.task_id,lease_generation:lease.lease_generation}]);await v.publish();assert.equal(v.publisher.snapshot().state,'ACKNOWLEDGED');
    const record=await setupInput(f),e=await v.capacity.service.readSetupAdmission({actor:record.actor});await setup(f,record,e);
    const peer=f.agents.find(a=>a.role==='IMPLEMENTER'&&a.agent_id!==lease.agent_id);await f.seedPeer(peer);let attempts=0;
    const response=await cycleThroughPg(f,v.publisher.admittedProviders(),()=>{attempts++;});assert.equal(response.status,200);const plan=await response.json();
    assert.ok(attempts>0);assert.equal(plan.lease_fenced,true);assert.equal(plan.leases.length,0);assert.ok(plan.running.some(r=>r.task_id===lease.task_id));
    assert.equal((await sql.unsafe("select count(*)::int as n from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=$1 and state='ACTIVE'",[f.profile.workspace_id]))[0].n,1);
   }finally{await v.close();}
  });
  await t.test('actual setup service uses fresh private v2 census, same admission guard and honest UNBOUND terminal',async()=>{
   const f=await fixture({budget:1}),record=await setupInput(f),repo=path.join(directory,'repo-'+randomUUID()),managedRoot=path.join(directory,'managed-'+randomUUID());
   await fs.mkdir(repo);await fs.mkdir(managedRoot);await sql.unsafe('update public.compute_fabric_a2_managed_project_repository_h205f22 set repo_root=$2,managed_root=$3 where coordination_workspace_id=$1',[f.profile.workspace_id,repo,managedRoot]);
   const [pg]=await sql.unsafe("select current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,inet_server_port() as port,pg_postmaster_start_time() as started_at,(select system_identifier::text from pg_control_system()) as system_identifier");
   pg.pid=Number((await fs.readFile(path.join(data,'postmaster.pid'),'utf8')).split(/\r?\n/)[0]);const continuity=await runtimeRecoveryPostgresProof({identity:pg,pgDataDirectory:data});
   let service,capacity,privateReads=0;
   service=createNativeCodingHostSetupService({sql,hostInstanceId:f.hostInstance,hostPid:f.hostPid,pgDataDirectory:data,postgresIdentity:pg,postgresContinuity:continuity,
    readAdmission:()=>({schema:'metaengine.agent-resource-admission.v1',physical_start_allowed:true,physical_parallelism:1}),readCapacityEvidence:query=>{privateReads++;return capacity.service.readSetupAdmission(query);}});
   capacity=await hostCapacity(f,{startupPid:pg.pid,custody:()=>service.readCapacityCustody()});
   const call=(action,input)=>service.operations[action](f.signed(input,{},action));
   try{
    const d=await call('DISCOVER_NATIVE_SETUP_V1',{workspace_id:f.profile.workspace_id}),input={operation_id:record.input.operation_id,workspace_id:f.profile.workspace_id,
     ...Object.fromEntries(['repository_scope_sha256','repo_root_identity_sha256','managed_root_identity_sha256'].map(k=>[k,d[k]]))};
    const result=await call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(result.state,'HOLD');assert.equal(result.reason,'MATERIALIZATION_UNAVAILABLE');assert.equal(result.prepared,false);assert.equal(privateReads,1);
    assert.deepEqual(await call('BEGIN_NATIVE_SETUP_V1',input),result);assert.equal(privateReads,1,'duplicate is read only, no materializer reentry');
    await assert.rejects(call('BEGIN_NATIVE_SETUP_V1',{...input,operation_id:randomUUID()}),/native_capacity_setup_hold/);
    const old=await capacity.read();assert.equal(old.state,'HOLD');assert.equal(old.counts.unresolved_slots,1,'SQL terminal alone cannot supply historical physical release');
   }finally{service.close();await service.drain();capacity.service.close();await capacity.service.drain();f.verifier.close();}
  });
  await t.test('new durable setup after census makes v2 publication ABSENT instead of optimistic free capacity',async()=>{
   const f=await fixture(),v=await wiredV2(f);try{
    await v.observe();const setupRecord=await setupInput(f);await setup(f,setupRecord,await evidence(f));await v.publish();
    assert.equal(v.publisher.snapshot().state,'ADMISSION_FENCED');assert.equal(v.publisher.admittedProviders().length,0);
    assert.equal((await sql.unsafe('select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id])).length,0);
   }finally{await v.close();}
  });
  await t.test('v1 publication remains valid but cannot admit native claims after the v2 rollout',async()=>{
   const f=await fixture({budget:1});try{
    assert.equal((await f.publish()).accepted,true);await assert.rejects(apiLease(f),/native_capacity_v2_witness_required/);
    const [task]=await sql.unsafe('select state,lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.seed.root_task_id]);
    assert.equal(task.state,'READY');assert.equal(Number(task.lease_generation),0);
   }finally{f.verifier.close();}
  });
  await t.test('fresh v2 admits a real W30 lease through an API login without direct private execution rights',async()=>{
   const f=await fixture({budget:1});try{
    const record=await packetV2(f);assert.equal((await writeV2(f,record)).accepted,true);
    assert.equal((await api.unsafe('select current_user,session_user'))[0].session_user,'seed_api');
    for(const q of ['select destruktion_meta.native_coding_capacity_lock_v1($1,$2)','select destruktion_meta.native_coding_capacity_rows_v1($1,$2)'])
     await assert.rejects(api.unsafe(q,[f.profile.device_id,f.profile.client_id]),/permission denied/);
    await assert.rejects(census(f,record.evidence,api),/permission denied/);
    const lease=await apiLease(f);assert.equal(lease.leased,true);assert.equal(lease.task_id,f.seed.root_task_id);
    const observation=await census(f,await evidence(f));assert.deepEqual(observation.counts,{task_slots:1,setup_slots:0,unrepresented_claims:1,represented_tasks:0,unresolved_slots:0});
    const input=await setupInput(f);await assert.rejects(setup(f,input,await evidence(f)),/native_capacity_setup_hold/);
    assert.equal((await rows(f)).filter(r=>r.kind==='SETUP').length,0);
   }finally{f.verifier.close();}
  });
  await t.test('null, stale, partial, forged or changed census cannot publish optimistic free capacity',async()=>{
   const f=await fixture();try{
    const original=await packetV2(f);
    const variants=[
     value=>{value.capacity=null;},value=>{value.capacity.census.complete=false;},
     value=>{value.capacity.census.counts.task_slots++;},value=>{value.capacity.census.generation++;},
     value=>{value.capacity.census.principal_sha256='0'.repeat(64);},value=>{value.capacity.census.host_instance_id=randomUUID();},
     value=>{value.capacity.census.postgres_scope_sha256='0'.repeat(64);},value=>{value.capacity.projection.free_slots++;},
     value=>{value.capacity.projection.resource_ceiling=-1;},value=>{value.capacity.projection.extra=true;},
    ];
    for(const change of variants){const input=structuredClone(original.packet.body.input);change(input);
     await assert.rejects(writeV2(f,{packet:f.signed(input,{},'SERVICE_HEARTBEAT_V2'),evidence:original.evidence}));}
    const now=Date.now();
    for(const change of [{...original.evidence,extra:true},{...original.evidence,owned_tasks:null},{...original.evidence,host_pid:String(original.evidence.host_pid)},{...original.evidence,generation:'1'},
     {...original.evidence,device_key_fingerprint_sha256:'0'.repeat(64)},
     {...original.evidence,postgres_started_at_us:new Date(now-100000).toISOString()},
     {...original.evidence,observed_at:new Date(now-20000).toISOString(),expires_at:new Date(now-10000).toISOString()}])
     await assert.rejects(census(f,change));
    assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id]))[0].n,0);
   }finally{f.verifier.close();}
  });
  await t.test('exact duplicate and lost ACK readback are nonmutating, generation cannot go backwards',async()=>{
   const f=await fixture();try{
    const first=await packetV2(f),ack=await writeV2(f,first);assert.equal(ack.accepted,true);
    assert.equal((await writeV2(f,first)).readback_only,true);
    const before=await sql.unsafe('select registered_at,capacity_evidence from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id]);
    const read=()=>sql.unsafe('select destruktion_meta.native_coding_service_heartbeat_read_v2($1,$2,1,$3,$4) as value',
     [f.profile.device_id,f.profile.client_id,f.profile.workspace_id,first.packet.headers['x-a2-device-body-sha256']]);
    assert.equal((await read())[0].value.readback_only,true);assert.equal((await read())[0].value.body_sha256,ack.body_sha256);
    assert.deepEqual(await sql.unsafe('select registered_at,capacity_evidence from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id]),before);
    const second=await packetV2(f);assert.equal((await writeV2(f,second)).accepted,true);
    await assert.rejects(writeV2(f,{...first,packet:f.signed(first.packet.body.input,{},'SERVICE_HEARTBEAT_V2')}),/native_capacity_generation_replay/);
   }finally{f.verifier.close();}
  });
  await t.test('setup custody requires exact current private ownership; terminal SQL alone never frees its slot',async()=>{
   const f=await fixture({budget:2});try{
    const record=await setupInput(f),custody=randomUUID();await setup(f,record,await evidence(f));
    await setup(f,record,null,'CLAIM',{custody_id:custody,host_instance_id:f.hostInstance,host_pid:f.hostPid});
    const [row]=await rows(f);assert.equal(row.kind,'SETUP');
    const owned={operation_id:row.key,custody_id:custody,durable_sha256:row.durable_sha256};
    assert.equal((await census(f,await evidence(f))).counts.unresolved_slots,1);
    assert.equal((await census(f,await evidence(f,{owned_setup:[owned]}))).counts.unresolved_slots,0);
    for(const change of [{...owned,custody_id:randomUUID()},{...owned,durable_sha256:'0'.repeat(64)}])
     assert.equal((await census(f,await evidence(f,{owned_setup:[change]}))).counts.unresolved_slots,1);
    assert.equal((await census(f,await evidence(f,{owned_setup:[owned],host_instance_id:randomUUID()}))).counts.unresolved_slots,1);
    await setup(f,record,null,'TERMINAL',{custody_id:custody,state:'HOLD',reason:'MATERIALIZATION_UNAVAILABLE',cleanup_state:'DRAINED'});
    const terminal=await census(f,await evidence(f));assert.equal(terminal.counts.setup_slots,1);assert.equal(terminal.counts.unresolved_slots,1);
    await assert.rejects(census(f,await evidence(f,{resolved:[{kind:'SETUP',key:row.key,durable_sha256:row.durable_sha256}]})),/physical_witness_changed/);
   }finally{f.verifier.close();}
  });
  await t.test('same-device old grant and Host rows remain unresolved; an unrelated device sees no foreign occupancy',async()=>{
   const f=await fixture(),other=await fixture();try{
    const record=await setupInput(f);await setup(f,record,await evidence(f));
    assert.equal((await census(other,await evidence(other))).counts.setup_slots,0);
    await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.profile.device_id]);
    await assert.rejects(census(f,await evidence(f)),/PROJECT_DEVICE_GRANT_REVOKED/);
    const fresh=await evidence(f,{admin_grant_epoch:2,host_instance_id:randomUUID()});
    const [seen]=await sql.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1,$2,2,$3::text::jsonb) as value',[f.profile.device_id,f.profile.client_id,canonical(fresh)]);
    assert.equal(seen.value.counts.setup_slots,1);assert.equal(seen.value.counts.unresolved_slots,1);
   }finally{f.verifier.close();other.verifier.close();}
  });
  await t.test('a private physical witness is bound to the exact durable row, never a foreign selector',async()=>{
   const f=await fixture();try{
    await assert.rejects(census(f,await evidence(f,{resolved:[{kind:'TASK',key:randomUUID()+':1',durable_sha256:'0'.repeat(64)}]})),/physical_witness_changed/);
    await assert.rejects(api.begin(async tx=>{await tx.unsafe("select set_config('native_capacity.physical_confirmed','true',true)");return census(f,await evidence(f),tx);}),/permission denied/);
   }finally{f.verifier.close();}
  });
  await t.test('replay rejects changed body, search_path, ACL, column privilege, constraint or trigger and leaves the prior schema intact',async()=>{
   for(const change of [
    "alter function destruktion_meta.native_coding_capacity_lock_v1(uuid,text) set search_path=pg_temp,public",
    "grant execute on function destruktion_meta.native_coding_capacity_rows_v1(uuid,text) to seed_api",
    "grant select(capacity_evidence) on destruktion_meta.native_coding_service_heartbeat_h205f22 to seed_api",
    "alter table destruktion_meta.native_coding_service_heartbeat_h205f22 drop constraint native_capacity_evidence_budget_v1",
    "alter table destruktion_meta.devos_fleet_claim_h205f22 disable trigger aa_native_capacity_claim_guard_v2",
    "drop function destruktion_meta.native_coding_capacity_census_v1(uuid,text,bigint,jsonb)",
    "create or replace function destruktion_meta.native_coding_capacity_lock_v1(p_device uuid,p_client text) returns void language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$begin return;end $$",
   ])await assert.rejects(sql.begin(async tx=>{await tx.unsafe(change);await tx.unsafe(capacitySql);}),/native_capacity_.*(requires_review|partial_install)/);
   await sql.begin(tx=>tx.unsafe(capacitySql));
  });
  await t.test('a setup transaction opened before a held W30 claim cannot consume its already-issued slot',async()=>{
   const f=await fixture({budget:1});let unblock;
   try{
    await writeV2(f,await packetV2(f));const input=await setupInput(f),e=await evidence(f);
    const gate=new Promise(r=>{unblock=r;});let claimed;
    const ready=new Promise(r=>{claimed=r;});
    const claim=api.begin(async tx=>{const lease=await apiLease(f,f.agents[0],tx);assert.equal(lease.leased,true);claimed();await gate;return lease;});
    await ready;
    const pending=setup(f,input,e).then(value=>({ok:true,value}),error=>({ok:false,error}));
    let sawWait=false;
    for(let i=0;i<100;i++){
     const waiting=await sql.unsafe("select count(*)::int as n from pg_stat_activity where application_name='METAENGINE_NATIVE_CAPACITY_DISPOSABLE_QA' and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0");
     if(waiting[0].n>0){sawWait=true;break;}await new Promise(r=>setTimeout(r,5));
    }
    assert.equal(sawWait,true,'observe the actual device lock wait, not a timeout');
    unblock();await claim;const outcome=await pending;
    assert.equal(outcome.ok,false,'an issued W30 claim must not share budget1 with a setup intent');
    assert.ok(['55000','40001'].includes(outcome.error.code),outcome.error.message);
   }finally{unblock?.();f.verifier.close();}
  });
  await t.test('setup -> claim at budget1 is serialized without timeout-as-success',async()=>{
   const f=await fixture({budget:1});let first;
   try{
    await writeV2(f,await packetV2(f));const record=await setupInput(f),e=await evidence(f);
    first=held(tx=>setupRaw(f,record,e,'BEGIN',{},tx));await first.ready;
    const second=outcome(apiLease(f));await waitForAdvisory(first.pid());first.release();await first.done;refused(await second);
    assert.equal((await rows(f)).filter(r=>r.kind==='SETUP').length,1);
    assert.equal((await rows(f)).filter(r=>r.kind==='TASK').length,0);
   }finally{first?.release();f.verifier.close();}
  });
  for(const budget of [1,2])await t.test(`two real API claims at budget${budget} share the exact guard and retain allocated work`,async()=>{
   const f=await fixture({budget});let first;
   try{
    const peer=f.agents.find((a,i)=>i>1&&a.role==='IMPLEMENTER');await f.seedPeer(peer);await writeV2(f,await packetV2(f));
    first=held(tx=>apiLease(f,f.agents[0],tx),{db:api,isolation:'isolation level read committed'});assert.equal((await first.ready).leased,true);
    const second=outcome(apiLease(f,peer));const wait=await waitForAdvisory(first.pid(),null);assert.ok(['advisory','transactionid','tuple'].includes(wait));t.diagnostic('two-claim existing lock wait: '+wait);first.release();await first.done;const result=await second;
    if(budget===1)refused(result);else{assert.equal(result.ok,true);assert.equal(result.value.leased,true);}
    const counts=(await census(f,await evidence(f))).counts;assert.equal(counts.task_slots,budget);assert.equal(counts.unrepresented_claims,budget);
   }finally{first?.release();f.verifier.close();}
  });
  await t.test('two setup admissions without a prior heartbeat cannot both consume budget1',async()=>{
   const f=await fixture({budget:1});let first;
   try{
    const a=await setupInput(f),b=await setupInput(f,randomUUID()),e=await evidence(f);
    first=held(tx=>setupRaw(f,a,e,'BEGIN',{},tx));await first.ready;
    const second=outcome(setup(f,b,e));await waitForAdvisory(first.pid());first.release();await first.done;refused(await second);
    assert.equal((await rows(f)).filter(r=>r.kind==='SETUP').length,1);
   }finally{first?.release();f.verifier.close();}
  });
  await t.test('known current setup custody consumes one slot while budget2 admits independent CLI work',async()=>{
   const f=await fixture({budget:2});try{
    const record=await setupInput(f),custody=randomUUID();await setup(f,record,await evidence(f));
    await setup(f,record,null,'CLAIM',{custody_id:custody,host_instance_id:f.hostInstance,host_pid:f.hostPid});
    const [row]=await rows(f),owned={operation_id:row.key,custody_id:custody,durable_sha256:row.durable_sha256};
    const packet=await packetV2(f,await evidence(f,{owned_setup:[owned]}));assert.equal(packet.packet.body.input.capacity.projection.free_slots,1);
    await writeV2(f,packet);assert.equal((await apiLease(f)).leased,true);
    const counts=(await census(f,await evidence(f,{owned_setup:[owned]}))).counts;assert.equal(counts.task_slots,1);assert.equal(counts.setup_slots,1);
   }finally{f.verifier.close();}
  });
  for(const firstKind of ['setup','publication'])await t.test(`first heartbeat absent: ${firstKind} commits first, stale concurrent peer cannot advertise free capacity`,async()=>{
   const f=await fixture({budget:1});let first;
   try{
    const record=await setupInput(f),e=await evidence(f),packet=await packetV2(f);
    const publishRaw=tx=>tx.unsafe('select destruktion_meta.native_coding_service_heartbeat_v2($1,$2,1,$3,$4,$5::text::jsonb,$5::text,$6::text::jsonb,$7::text::jsonb) as value',
     [f.profile.device_id,f.profile.client_id,f.hostInstance,f.hostPid,canonical(packet.packet.body),canonical(packet.packet.headers),canonical(packet.evidence)]);
    first=held(tx=>firstKind==='setup'?setupRaw(f,record,e,'BEGIN',{},tx):publishRaw(tx));await first.ready;
    const second=outcome(firstKind==='setup'?writeV2(f,packet):setup(f,record,e));await waitForAdvisory(first.pid());first.release();await first.done;
    refused(await second);
    const [count]=await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=$1',[f.profile.device_id]);
    assert.equal(count.n,firstKind==='publication'?1:0);
   }finally{first?.release();f.verifier.close();}
  });
  await t.test('an older SERIALIZABLE snapshot is refused even when the claim already released its advisory lock',async()=>{
   const f=await fixture({budget:1});let release;
   try{
    await writeV2(f,await packetV2(f));const record=await setupInput(f),e=await evidence(f);let announce;
    const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{announce=r;});
    const older=outcome(sql.begin('isolation level serializable',async tx=>{
     await tx.unsafe('set local synchronous_commit=on');await tx.unsafe('select count(*) from destruktion_meta.devos_fleet_claim_h205f22');announce();await gate;
     return setupRaw(f,record,e,'BEGIN',{},tx);
    }));
    await ready;assert.equal((await apiLease(f)).leased,true);release();const result=await older;refused(result);assert.equal(result.error.code,'40001');
   }finally{release?.();f.verifier.close();}
  });
  await t.test('effect fence never renews observation and census is strictly nonmutating',async()=>{
   const f=await fixture();try{
    await writeV2(f,await packetV2(f));
    const read=()=>sql.unsafe('select to_jsonb(h) as value,xmin::text as version from destruktion_meta.native_coding_service_heartbeat_h205f22 h where device_id=$1',[f.profile.device_id]);
    const before=await read();await census(f,await evidence(f));await census(f,await evidence(f));assert.deepEqual(await read(),before);
    assert.equal((await apiLease(f)).leased,true);const after=await read();assert.deepEqual(after[0].value,before[0].value);assert.notEqual(after[0].version,before[0].version);
   }finally{f.verifier.close();}
  });
  await t.test('cancellation racing a claim preserves physical HOLD; SQL drained terminal does not release it',async()=>{
   const f=await fixture({budget:2});let first;
   try{
    const record=await setupInput(f),custody=randomUUID();await setup(f,record,await evidence(f));await setup(f,record,null,'CLAIM',{custody_id:custody,host_instance_id:f.hostInstance,host_pid:f.hostPid});
    const [row]=await rows(f),owned={operation_id:row.key,custody_id:custody,durable_sha256:row.durable_sha256};await writeV2(f,await packetV2(f,await evidence(f,{owned_setup:[owned]})));
    first=held(tx=>setupRaw(f,record,null,'CANCEL',{},tx));await first.ready;
    const second=outcome(apiLease(f));await waitForAdvisory(first.pid());first.release();await first.done;refused(await second);
    await setup(f,record,null,'TERMINAL',{custody_id:custody,state:'STOPPED',reason:'CANCELLED',cleanup_state:'DRAINED'});
    const c=await census(f,await evidence(f));assert.equal(c.counts.setup_slots,1);assert.equal(c.counts.unresolved_slots,1);
   }finally{first?.release();f.verifier.close();}
  });
  for(const budget of [1,2])await t.test(`cross-project same-device claims at budget${budget} contend on shared admission rather than only project locks`,async()=>{
   const f=await fixture({budget}),peer=await fixture({budget,shared:f});let first;
   try{
    await writeV2(f,await packetV2(f));peer.capacityGeneration=f.capacityGeneration;
    await writeV2(peer,await packetV2(peer));
    first=held(tx=>apiLease(f,f.agents[0],tx),{db:api,isolation:'isolation level read committed'});assert.equal((await first.ready).leased,true);
    const second=outcome(apiLease(peer));await waitForAdvisory(first.pid());first.release();await first.done;const result=await second;
    if(budget===1)refused(result);else{assert.equal(result.ok,true);assert.equal(result.value.leased,true);}
    const counts=(await census(f,await evidence(f))).counts;assert.equal(counts.task_slots,budget);
   }finally{first?.release();f.verifier.close();peer.verifier.close();}
  });
  await t.test('old Main incarnation, expired claim and revoked grant cannot reset an occupied slot to free',async()=>{
   const f=await fixture();try{
    await writeV2(f,await packetV2(f));const lease=await apiLease(f);assert.equal(lease.leased,true);
    const before=await census(f,await evidence(f));assert.equal(before.counts.task_slots,1);assert.equal(before.counts.unresolved_slots,0);
    const changed=await census(f,await evidence(f,{main_incarnation:'pid:999:created_100ns:133999999999999999'}));assert.equal(changed.counts.unresolved_slots,1);
    await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set state='EXPIRED',expires_at=clock_timestamp()-interval '1 second' where task_id=$1",[lease.task_id]);
    const expired=await census(f,await evidence(f));assert.equal(expired.counts.task_slots,1);assert.equal(expired.counts.unresolved_slots,1);
    await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.profile.device_id]);
    const e=await evidence(f,{admin_grant_epoch:2});const [seen]=await sql.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1,$2,2,$3::text::jsonb) as value',[f.profile.device_id,f.profile.client_id,canonical(e)]);
    assert.equal(seen.value.counts.task_slots,1);assert.equal(seen.value.counts.unresolved_slots,1);
   }finally{f.verifier.close();}
  });
  await t.test('same-device client rotation cannot hide older physical records or inherit their authority',async()=>{
   const f=await fixture();try{
    await writeV2(f,await packetV2(f));assert.equal((await apiLease(f)).leased,true);
    const client=randomUUID();await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set client_id=$2 where device_id=$1',[f.profile.device_id,client]);
    const e=await evidence(f);await assert.rejects(census(f,e),/PROJECT_DEVICE_GRANT_REVOKED/);
    const [fresh]=await sql.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1,$2,1,$3::text::jsonb) as value',[f.profile.device_id,client,canonical(e)]);
    assert.equal(fresh.value.counts.task_slots,1);assert.equal(fresh.value.counts.unresolved_slots,1);
   }finally{f.verifier.close();}
  });
  await t.test('same-device rotated-client writers share the canonical device guard while stale client has no authority',async()=>{
   const old=await fixture({budget:2});let current,first;
   try{
    await writeV2(old,await packetV2(old));const staleSetup=await setupInput(old),staleEvidence=await evidence(old);
    const client=randomUUID();await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set client_id=$2 where device_id=$1',[old.profile.device_id,client]);
    current=await fixture({budget:2,shared:old,clientOverride:client});current.capacityGeneration=old.capacityGeneration;
    await writeV2(current,await packetV2(current));
    const before=(await sql.unsafe('select to_jsonb(h) as value,xmin::text as version from destruktion_meta.native_coding_service_heartbeat_h205f22 h where device_id=$1 and client_id=$2',[old.profile.device_id,old.profile.client_id]))[0];
    first=held(tx=>apiLease(current,current.agents[0],tx),{db:api,isolation:'isolation level read committed'});assert.equal((await first.ready).leased,true);
    // The existing W30 selector may deny the stale client before claim INSERT.
    const staleLease=await outcome(apiLease(old));assert.ok(staleLease.ok?staleLease.value.leased===false:staleLease.error.code==='42501');
    // Simulate an authenticated Host request already in flight when the grant
    // rotated. Its SQL effect boundary must share the device guard and refuse.
    const stale=outcome(setup(old,staleSetup,staleEvidence));await waitForAdvisory(first.pid());first.release();await first.done;const result=await stale;
    assert.equal(result.ok,false);assert.ok(['40001','42501'].includes(result.error.code),result.error.message);
    await assert.rejects(census(old,await evidence(old)),/PROJECT_DEVICE_GRANT_REVOKED/);
    const after=(await sql.unsafe('select to_jsonb(h) as value,xmin::text as version from destruktion_meta.native_coding_service_heartbeat_h205f22 h where device_id=$1 and client_id=$2',[old.profile.device_id,old.profile.client_id]))[0];
    assert.deepEqual(after.value,before.value);assert.notEqual(after.version,before.version,'MVCC fence covers old-client cache rows too');
    const counts=(await census(current,await evidence(current))).counts;assert.equal(counts.task_slots,1);assert.equal(counts.unresolved_slots,0);
    const [task]=await sql.unsafe('select state,lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[old.seed.root_task_id]);
    assert.equal(task.state,'READY');assert.equal(Number(task.lease_generation),0);
   }finally{first?.release();old.verifier.close();current?.verifier.close();}
  });
  await t.test('same Host generation is monotonic across workspaces, not merely per heartbeat row',async()=>{
   const f=await fixture(),peer=await fixture({shared:f});try{
    await writeV2(f,await packetV2(f));await assert.rejects(writeV2(peer,await packetV2(peer)),/native_capacity_generation_replay/);
    peer.capacityGeneration=f.capacityGeneration;assert.equal((await writeV2(peer,await packetV2(peer))).accepted,true);
   }finally{f.verifier.close();peer.verifier.close();}
  });
  await t.test('API temp-schema shadow and caller flags cannot replace fixed private census/settlement',async()=>{
   const f=await fixture();try{
    await writeV2(f,await packetV2(f));
    await api.begin(async tx=>{
     await tx.unsafe('create temporary table native_coding_service_heartbeat_h205f22(capacity_evidence jsonb)');
     await tx.unsafe("insert into native_coding_service_heartbeat_h205f22 values ('{\"free_slots\":999,\"physical_confirmed\":true}')");
     await tx.unsafe('set local search_path=pg_temp,public');assert.equal((await apiLease(f,f.agents[0],tx)).leased,true);
    });
    await assert.rejects(api.unsafe("update destruktion_meta.native_coding_service_heartbeat_h205f22 set capacity_evidence='{}'"),/permission denied/);
    assert.equal((await census(f,await evidence(f))).counts.task_slots,1);
   }finally{f.verifier.close();}
  });
  await t.test('cache side-effect triggers are rejected instead of being invoked by the MVCC fence',async()=>{
   await assert.rejects(sql.begin(async tx=>{
    await tx.unsafe('create function public.fixture_cache_trigger() returns trigger language plpgsql as $$begin raise exception \'UNEXPECTED_EFFECT\';end $$');
    await tx.unsafe('create trigger fixture_cache_trigger before update on destruktion_meta.native_coding_service_heartbeat_h205f22 for each row execute function public.fixture_cache_trigger()');
    await tx.unsafe(capacitySql);
   }),/native_capacity_heartbeat_authority_requires_review/);
  });
  await t.test('browser transport admission still refuses unproven webcontents, with its original reason',async()=>{
   const f=await fixture();try{
    await writeV2(f,await packetV2(f));
    await sql.unsafe("select public.devos_fleet_enqueue_v1($1,$2,'IMPLEMENTER',$3,$4,$5,null,50)",
     [f.profile.workspace_id,'browser.fixture.'+randomUUID(),f.agents[0].worktree.base_sha,sql.json({schema:'generated.browser.task',objective:'Unrelated browser remains guarded'}),'browser:'+randomUUID()]);
    await assert.rejects(api.unsafe("select public.devos_fleet_lease_v1($1,$2,'IMPLEMENTER','agent-tab','webcontents:17',1,900)",[f.profile.workspace_id,'agent_browser-fixture']),error=>
     /devos_|dispatch|transport|supervisor/.test(error.message)&&!error.message.includes('native_capacity'));
    assert.deepEqual(await f.state(),f.browserState);
   }finally{f.verifier.close();}
  });
  await t.test('evidence byte budget is enforced, not interpreted as free capacity',async()=>{
   const f=await fixture();try{
    const e=await evidence(f,{resolved:Array.from({length:2500},()=>({kind:'TASK',key:randomUUID()+':1',durable_sha256:'a'.repeat(64)}))});
    assert.ok(Buffer.byteLength(canonical(e))>262144);await assert.rejects(census(f,e),/native_capacity_evidence_invalid/);
   }finally{f.verifier.close();}
  });
  await t.test('nullable/private column and fixed trigger are attested without rewriting any v1 bodies',async()=>{
   const [row]=await sql.unsafe("select prosecdef,proconfig from pg_proc where oid='destruktion_meta.native_coding_capacity_claim_gate_v2()'::regprocedure");
   assert.equal(row.prosecdef,true);assert.deepEqual(row.proconfig,['search_path=pg_catalog, public, destruktion_meta']);
   await assert.rejects(api.unsafe('select capacity_evidence from destruktion_meta.native_coding_service_heartbeat_h205f22'),/permission denied/);
   await sql.begin(tx=>tx.unsafe(capacitySql));
  });
  await t.test('actual same-cluster PostgreSQL restart invalidates cached evidence without changing system identifier',async()=>{
   const f=await fixture();try{
    const old=await evidence(f);const oldBirth={pid:999,system_identifier:cluster,started_at:old.postgres_started_at_us};await writeV2(f,await packetV2(f,old));
    await api.end({timeout:5});await sql.end({timeout:5});api=null;sql=null;
    await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:8,onnotice:()=>{},connection:{statement_timeout:18000,lock_timeout:0}});
    api=postgres({host:'127.0.0.1',port,user:'seed_api',database:'postgres',max:3,onnotice:()=>{},connection:{statement_timeout:18000,lock_timeout:0}});
    const fresh=await evidence(f);assert.equal(fresh.postgres_system_identifier,old.postgres_system_identifier);assert.notEqual(fresh.postgres_started_at_us,old.postgres_started_at_us);
    await assert.rejects(census(f,old),/native_capacity_evidence_invalid/);
    await assert.rejects(apiLease(f),/native_capacity_evidence_invalid/);
    assert.equal((await rows(f)).length,0);
    const staleHost=createNativeCodingHostCapacity({sql,hostInstanceId:f.hostInstance,hostPid:f.hostPid,postgresIdentity:oldBirth,readNativeScope:async()=>{assert.fail('stale PG cannot reach OS reader');},readSetupCustody:()=>({closed:false,revision:0,jobs:[]})});
    await assert.rejects(staleHost.operations.READ_NATIVE_CAPACITY_V1(f.signed({owned_tasks:[]},{},'READ_NATIVE_CAPACITY_V1')),/postgres_incarnation_changed/);staleHost.close();await staleHost.drain();
   }finally{f.verifier.close();}
  });
 }finally{
  if(api)await api.end({timeout:5});if(sql)await sql.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,
   postmaster_pid_file_absent:await fs.lstat(path.join(data,'postmaster.pid')).then(()=>false,e=>e.code==='ENOENT'),installed_keeper_used:false})+'\n');
  t.diagnostic('disposable_receipt_directory='+directory);
 }
});
