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
import {createNativeCodingHostServiceHeartbeat} from './native-coding-host-service-heartbeat.mjs';
import {createNativeCodingServiceHeartbeatPublisher} from '../../apps/metaengine-browser/src/native-coding-service-heartbeat-publisher.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const source=name=>fs.readFile(new URL(name,migrations),'utf8');
const migration='20261025120000_native_coding_service_heartbeat_admission_v1.sql';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');

// Actual isolated PG17 transactions, existing enqueue/project/claim bodies.
// Device enrollment, installed image, OS scope, canaries and Windows ACL readers
// are GENERATED FIXTURES. This test cannot prove installed/model execution.
test('signed native service admission preserves browser ambiguity and finite physical capacity',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-service-admission-'));
 const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,sql,cluster,passed=0,migrationSha=null;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connect_timeout:5,idle_timeout:10,
   connection:{application_name:'METAENGINE_NATIVE_INITIAL_SEED_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
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
  async function fixture({pairs=2}={}){
   const generated=admissionFixture(),p=generated.permit,pairing=randomUUID(),agents=[];
   p.postgres.system_identifier=cluster;
   for(let i=0;i<pairs;i++){
    const worktree={...p.worktree,path:p.worktree.path+'-service'+i,root_identity_sha256:sha([randomUUID(),i])};
    for(const role of ['IMPLEMENTER','CRITIC'])agents.push({provider_id:randomUUID(),agent_id:'agent_service-'+randomUUID().slice(0,8),role,agent_generation_epoch:1,
     worktree:structuredClone(worktree),sandbox:{...generated.payload().sandbox,mode:role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:role==='CRITIC'}});
   }
   const profile={schema:'metaengine.native-coding.seed-profile.v1',trust_namespace:'LOCAL_OPERATOR_QA',profile_id:randomUUID(),workspace_id:p.workspace_id,
    device_id:p.device_id,client_id:generated.clientId,admin_grant_epoch:1,device_key_fingerprint_sha256:p.device_key_fingerprint_sha256,owner_epoch:1,
    user_sid:p.user_sid,artifact:p.artifact,postgres:p.postgres,agents,primary_provider_id:agents[0].provider_id,physical_slot_budget:2,expires_at:p.expires_at,
    storage_evidence_sha256:sha(randomUUID()),branch_name:'work/native-service',policy:{max_depth:null,max_tasks:null,max_children:null},
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
   await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pairing]);
   await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
    values($1,$2,$3,$4,$5,$6)`,[profile.device_id,profile.client_id,generated.identity.profile,sql.json(generated.jwk),profile.device_key_fingerprint_sha256,pairing]);
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
   const hostInstance=randomUUID(),hostPid=12345,verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:hostInstance,hostPid});
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
    runtime:{schema:'metaengine.native-coding.runtime.v1',physical_slot_budget:2,occupied_slots:0,closed:false,shutdown_state:'OPEN',host_unavailable_reason:null,jobs:[]},
    providers:structuredClone(providers),production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
   let clock=Date.now();
   const signed=(input=serviceInput(),{timestamp,nonce=randomUUID().replaceAll('-','')}={},operation='SERVICE_HEARTBEAT')=>{
    const body={host_instance_id:hostInstance,host_pid:hostPid,operation,input};
    const bodysha=hash(canonical(body)),stamp=timestamp||new Date(Math.max(Date.now(),++clock)).toISOString();
    const purpose=operation==='SERVICE_HEARTBEAT'?'/private/native-coding/service-heartbeat':'/private/native-coding/read-service-heartbeat';
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
   return{generated,profile,agents,providers,nativeDescriptors,publisherIdentity,publisherCapability,seed,browserState,serviceInput,signed,write,publish,read,permitFor,lease,seedPeer,state,verifier,publicationControl};
  }
  await t.test('only state_owner can publish or read private native witness',async()=>{
   const [r]=await sql.unsafe(`select has_function_privilege('service_role','destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb)','execute') as effect,
    has_table_privilege('service_role','destruktion_meta.native_coding_service_heartbeat_h205f22','insert') as insertable`);assert.deepEqual(r,{effect:false,insertable:false});passed++;
  });
  await t.test('native task waits before allocation without signed witness, even with a registered provider',async()=>{
   const f=await fixture();assert.equal((await f.lease()).leased,false);
   const [r]=await sql.unsafe('select state,lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.seed.root_task_id]);assert.deepEqual(r,{state:'READY',lease_generation:'0'});passed++;
  });
  await t.test('actual ES256 current-key witness admits native W30 lease without rewriting old browser ambiguity',async()=>{
   const f=await fixture(),ack=await f.publish();assert.equal(ack.accepted,true);assert.equal(ack.schema,'metaengine.native-coding.service-heartbeat-ack.v1');
   const actual=await f.lease();assert.equal(actual.leased,true);assert.equal(actual.task_id,f.seed.root_task_id);assert.deepEqual(await f.state(),f.browserState);
   assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[actual.task_id]))[0].n,1);passed++;
  });
  await t.test('browser claim path still rejects unproven webcontents transport under the same historical ambiguity',async()=>{
   const f=await fixture();await f.publish();
   await sql.unsafe('select public.devos_fleet_enqueue_v1($1,$2,\'IMPLEMENTER\',$3,$4,$5,null,50)',
    [f.profile.workspace_id,'browser.fixture.'+randomUUID(),f.agents[0].worktree.base_sha,sql.json({schema:'generated.browser.task',objective:'Browser fixture remains guarded'}),'browser:'+randomUUID()]);
   await assert.rejects(sql.unsafe('select public.devos_fleet_lease_v1($1,$2,\'IMPLEMENTER\',\'agent-tab\',\'webcontents:17\',1,900)',[f.profile.workspace_id,'agent_browser-fixture']),/devos_|dispatch|transport|supervisor/);
   assert.deepEqual(await f.state(),f.browserState);passed++;
  });
  await t.test('signature, Host generation, nonce and timestamp failures never publish a witness',async()=>{
   const f=await fixture();const bad=f.signed();bad.headers['x-a2-device-signature']='a'.repeat(86);
   await assert.rejects(f.publish(bad),/signature_invalid/);const host=f.signed();host.body.host_pid++;
   await assert.rejects(f.publish(host),/host_changed/);await assert.rejects(f.publish(f.signed(f.serviceInput(),{timestamp:new Date(Date.now()-60000).toISOString()})),/timestamp_invalid/);
   const packet=f.signed();await f.publish(packet);await assert.rejects(f.publish(packet),/nonce_reused/);passed++;
  });
  await t.test('CONTROL/armed, current ADMIN/epoch, SQL stop/generation and installed artifact are independently enforced',async()=>{
   for(const change of ['disarm','mode','recovery','artifact','generation','stop','epoch']){
    const f=await fixture(),v=f.serviceInput();if(change==='disarm')v.control.armed=false;if(change==='mode')v.control.supervisor_mode='OBSERVE';
    if(change==='recovery')v.control.interrupted_setup_recovery_fenced=true;if(change==='artifact')v.artifact.installed_exe_sha256='0'.repeat(64);
    if(change==='generation')v.control.runtime_control_generation=1;if(change==='stop')await sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[f.profile.workspace_id]);
    if(change==='epoch')await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.profile.device_id]);
    let denied=false;
    try{const result=await f.publish(f.signed(v));assert.equal(result.accepted,false);assert.equal(result.write_effect,'ABSENT');denied=true;}
    catch(error){assert.match(error.message,/snapshot_invalid|physical_scope_changed|registered_provider_changed|environment_fenced|PROJECT_DEVICE_GRANT_REVOKED/);denied=true;}
    assert.equal(denied,true);
    assert.equal((await f.lease()).leased,false);
   }passed++;
  });
  await t.test('expiry and provider digest rotation fence before a new lease without changing its generation',async()=>{
   const f=await fixture();await f.publish();await sql.unsafe(`update destruktion_meta.native_coding_service_heartbeat_h205f22
    set proven_at=statement_timestamp()-interval '31 seconds',expires_at=statement_timestamp()-interval '1 second' where workspace_id=$1`,[f.profile.workspace_id]);
   assert.equal((await f.lease()).leased,false);
   const g=await fixture();await g.publish();const id=g.permitFor(g.agents[0]).permit_id;
   const [prior]=await sql.unsafe('select envelope from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=$1',[id]);
   const replacement=g.generated.envelope({...prior.envelope.payload,proven_at:new Date().toISOString(),expires_at:new Date(Date.now()+50000).toISOString()});
   await sql.unsafe('update destruktion_meta.native_coding_provider_registration_h205f22 set envelope=$1,canonical_envelope=$2,envelope_sha256=$3 where permit_id=$4',
    [sql.json(replacement),canonical(replacement),sha(replacement),id]);
   assert.equal((await g.lease()).leased,false);assert.equal((await sql.unsafe('select lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[g.seed.root_task_id]))[0].lease_generation,'0');passed++;
  });
  await t.test('one remaining physical slot counts retained UNKNOWN jobs and in-flight claims across independent roots',async()=>{
   const f=await fixture({pairs:3});await f.publish();const first=await f.lease();assert.equal(first.leased,true);
   await sql.unsafe(`update destruktion_meta.devos_fleet_task_h205f22 set lease_expires_at=clock_timestamp()-interval '1 second' where task_id=$1`,[first.task_id]);
   await sql.unsafe(`update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second' where task_id=$1`,[first.task_id]);
   await sql.unsafe('select public.devos_fleet_reconcile_v1($1)',[f.profile.workspace_id]);
   const v=f.serviceInput();v.runtime.occupied_slots=1;v.runtime.jobs=[{task_id:first.task_id,lease_generation:Number(first.lease_generation),state:'READBACK_REQUIRED'}];
   await f.publish(f.signed(v));const secondId=await f.seedPeer(f.agents[2]),thirdId=await f.seedPeer(f.agents[4]);
   const second=await f.lease(f.agents[2]);assert.equal(second.leased,true);assert.equal(second.task_id,secondId);
   assert.equal((await f.lease(f.agents[4])).leased,false);assert.equal((await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[thirdId]))[0].state,'READY');
   assert.deepEqual(await f.state(),f.browserState);passed++;
  });
  await t.test('exact SQL readback replay does not extend witness expiry or clear browser history',async()=>{
   const f=await fixture(),packet=f.signed(),ack=await f.publish(packet),same=await f.write(packet);
   assert.equal(same.readback_only,true);assert.equal(same.witness_sha256,ack.witness_sha256);assert.equal(same.expires_at,ack.expires_at);
   const [read]=await sql.unsafe('select destruktion_meta.native_coding_service_heartbeat_read_v1($1,$2,1,$3,$4)as value',
    [f.profile.device_id,f.profile.client_id,f.profile.workspace_id,ack.body_sha256]);
   assert.equal(read.value.witness_sha256,ack.witness_sha256);assert.equal(read.value.readback_only,true);
   const hostRead=await f.read(ack.body_sha256);assert.equal(hostRead.witness_sha256,ack.witness_sha256);assert.equal(hostRead.readback_only,true);
   assert.equal((await sql.unsafe('select destruktion_meta.native_coding_service_heartbeat_read_v1($1,$2,1,$3,$4)as value',
    [f.profile.device_id,f.profile.client_id,f.profile.workspace_id,'0'.repeat(64)]))[0].value,null);
   const tampered=f.signed();tampered.headers['x-a2-device-nonce']=packet.headers['x-a2-device-nonce'];
   await assert.rejects(f.write(tampered),/native_coding_service_heartbeat_replay/);assert.deepEqual(await f.state(),f.browserState);passed++;
  });
  await t.test('pre-dispatch physical denial proves no heartbeat write, while a lost actual COMMIT ACK requires exact readback',async()=>{
   const f=await fixture();f.publicationControl.denyPhysical=true;
   const denied=await f.publish();assert.equal(denied.accepted,false);assert.equal(denied.write_effect,'ABSENT');
   assert.equal(f.publicationControl.writeTransactions,0);assert.equal((await f.lease()).leased,false);
   assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=$1',[f.profile.workspace_id]))[0].n,0);
   const g=await fixture(),packet=g.signed();g.publicationControl.loseCommitAck=true;
   await assert.rejects(g.publish(packet),/fixture_heartbeat_commit_ack_lost/);assert.equal(g.publicationControl.writeTransactions,1);
   const read=await g.read(packet.headers['x-a2-device-body-sha256']);assert.equal(read.accepted,true);assert.equal(read.readback_only,true);
   assert.equal(read.body_sha256,packet.headers['x-a2-device-body-sha256']);assert.equal(g.publicationControl.writeTransactions,1);passed++;
  });
  await t.test('production publisher signs through actual Host/ALS/PG and resolves lost COMMIT ACK by readonly before native W30 admission',async()=>{
   const f=await fixture(),observed=f.serviceInput();f.publicationControl.loseCommitAck=true;
   const publisher=createNativeCodingServiceHeartbeatPublisher({identity:f.publisherIdentity,ownPostgres:f.publisherCapability,
    readControl:()=>observed.control,readRuntime:()=>observed.runtime,readProviders:()=>f.nativeDescriptors});
   assert.equal(publisher.admittedProviders().length,0);publisher.observe();await publisher.drain();
   assert.equal(publisher.snapshot().unknown_write_retained,true);assert.equal(publisher.admittedProviders().length,0);
   publisher.observe();await publisher.drain();assert.equal(publisher.snapshot().unknown_write_retained,false);
   assert.equal(publisher.admittedProviders().length,f.nativeDescriptors.length);assert.equal(f.publicationControl.writeTransactions,1);
   const lease=await f.lease();assert.equal(lease.leased,true);assert.equal(lease.task_id,f.seed.root_task_id);assert.deepEqual(await f.state(),f.browserState);
   publisher.close();assert.equal(publisher.admittedProviders().length,0);passed++;
  });
  assert.equal(passed,11);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.service-admission.disposable-qa.v1',state:'PASS',
   postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:migrationSha,
   source_classification:'REAL_DISPOSABLE_PG_AND_ES256_SIGNATURE_WITH_GENERATED_DEVICE_IMAGE_OS_PROVIDER_AND_POOL_FIXTURES',
   native_w30_lease_without_browser_wake:true,browser_ambiguity_preserved:true,browser_transport_gate_preserved:true,physical_budget_preserved:true,
   model_calls:0,installed_keeper_used:false,installed_autonomy_proven:false,windows_acl_qualified:false,authority_effect:false},null,2)+'\n');
 }finally{
  if(sql)await sql.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,
   postmaster_pid_file_absent:await fs.lstat(path.join(data,'postmaster.pid')).then(()=>false,e=>e.code==='ENOENT'),installed_keeper_used:false})+'\n');
  t.diagnostic('disposable_receipt_directory='+directory);
 }
});
