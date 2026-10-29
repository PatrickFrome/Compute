import test from 'node:test';
import {prepareNativeCodingSeedProfile,readPreparedNativeCodingSeedProfile} from './native-coding-seed-profile-preparation.mjs';
import {publishNativeCodingSeedOperator} from './native-coding-seed-operator-publication.mjs';
import {completeChatNativePair} from './test/native-coding-chat-pair-pg-fixture.mjs';
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
import {createNativeCodingHostSeedService} from './native-coding-host-seed-service.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const source=name=>fs.readFile(new URL(name,migrations),'utf8');
const migration='20261025110000_native_coding_initial_goal_seed_v1.sql';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');

// Actual isolated PG17 transactions, existing enqueue/project/claim bodies.
// Device enrollment, installed image, OS scope, canaries and Windows ACL readers
// are GENERATED FIXTURES. This test cannot prove installed/model execution.
test('private initial native goal admission is atomic and preserves the W30 authority boundaries',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-coding-initial-seed-'));
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
  // This fixture connects only over loopback TCP. Do not depend on a distro's
  // shared /var/run/postgresql socket directory or modify the host OS.
  await fs.appendFile(path.join(data,'postgresql.conf'), "\nunix_socket_directories = ''\n");
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
   create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true);
   create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
    $$select jsonb_build_object('generation_floor',0,'refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),
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
   '20261025080000_native_coding_worktree_lease_admission_v1.sql','20261025090000_native_coding_agent_project_tools_v1.sql','20261025100000_native_coding_checkpoint_commit_rotation_v1.sql',migration]){
   const bytes=await source(name);if(name===migration)migrationSha=hash(bytes);await sql.unsafe(bytes);
  }
  const invoke=async(f,input=f.input,observed=f.observation())=>sql.begin('isolation level serializable',async tx=>{
   await tx.unsafe('set local synchronous_commit=on');const text=canonical(observed);
   return(await tx.unsafe('select destruktion_meta.native_coding_seed_goal_v1($1,$2,$3,$4::text::jsonb,$4::text,$5) as value',
    [f.profile.profile_id,input.request_id,input.objective,text,hash(text)]))[0].value;
  });
  const count=async f=>(await sql.unsafe(`select
   (select count(*)::int from destruktion_meta.native_coding_seed_h205f22 where profile_id=$1) as seeds,
   (select count(*)::int from destruktion_meta.project_run_h205f22 where workspace_id=$2) as projects,
   (select count(*)::int from destruktion_meta.devos_fleet_task_h205f22 where workspace_id=$2) as tasks,
   (select count(*)::int from destruktion_meta.native_coding_operator_permit_h205f22 where workspace_id=$2) as permits,
   (select count(*)::int from destruktion_meta.client_v1_goal_request_h205f22 where workspace_id=$2) as browser_goals`,[f.profile.profile_id,f.profile.workspace_id]))[0];
  async function fixture({pairs=2,budget=2,sqlBinding=sql,chatLed=false}={}){
   const generated=admissionFixture(),p=generated.permit,pairing=randomUUID(),agents=[];
   p.postgres.system_identifier=cluster;
   for(let i=0;i<pairs;i++)for(const role of ['IMPLEMENTER','CRITIC'])agents.push({provider_id:randomUUID(),agent_id:'agent_seed-'+randomUUID().slice(0,8),role,agent_generation_epoch:1,
    worktree:{...p.worktree,path:p.worktree.path+(i?'-child'+i:''),root_identity_sha256:sha([randomUUID(),i])},
    sandbox:{...generated.payload().sandbox,mode:role==='CRITIC'?'read-only':'workspace-write',worktree_write_denied:role==='CRITIC'}});
   for(let i=0;i<agents.length;i+=2)agents[i+1].worktree=structuredClone(agents[i].worktree);
   const profile={schema:'metaengine.native-coding.seed-profile.v1',trust_namespace:'LOCAL_OPERATOR_QA',profile_id:randomUUID(),
    workspace_id:p.workspace_id,device_id:p.device_id,client_id:generated.clientId,admin_grant_epoch:1,device_key_fingerprint_sha256:p.device_key_fingerprint_sha256,
    owner_epoch:p.owner_epoch,user_sid:p.user_sid,artifact:p.artifact,postgres:p.postgres,agents,primary_provider_id:agents[0].provider_id,
    physical_slot_budget:budget,expires_at:p.expires_at,storage_evidence_sha256:sha(randomUUID()),branch_name:'work/native-seed',
    policy:{max_depth:null,max_tasks:null,max_children:null},production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
   if(chatLed){profile.schema='metaengine.native-coding.seed-profile.v2';profile.coordination_mode='CHAT_LED';}
   await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pairing]);
   await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
    values($1,$2,$3,$4,$5,$6)`,[profile.device_id,profile.client_id,generated.identity.profile,sql.json(generated.jwk),profile.device_key_fingerprint_sha256,pairing]);
   const supervisor={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
    transport_identity:{profile:generated.identity.profile,device_id:profile.device_id,key_fingerprint_sha256:profile.device_key_fingerprint_sha256},
    supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'RECOVERING'}}};
   await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[profile.workspace_id,profile.client_id,sql.json(supervisor)]);
   await sql.unsafe('insert into public.qa_native_environment values($1,true)',[profile.workspace_id]);
   const profileText=canonical(profile),profileSha=hash(profileText);
   const prepared=await prepareNativeCodingSeedProfile({sql,profile});assert.equal(prepared.profile_sha256,profileSha);assert.equal(prepared.operator_pin_published,false);
   assert.deepEqual(await prepareNativeCodingSeedProfile({sql,profile}),prepared);
   const stateDirectory=path.join(directory,'host-state-'+profile.profile_id);await fs.mkdir(stateDirectory);
   const operator={schema:'metaengine.native-coding.seed-operator.v1',profile_id:profile.profile_id,profile_sha256:profileSha};
   const operatorPath=path.join(stateDirectory,'native-coding-seed-operator-v1.json');
   const device={device_id:profile.device_id,client_id:profile.client_id,key_fingerprint_sha256:profile.device_key_fingerprint_sha256,admin_grant_epoch:1};
   const input={request_id:randomUUID(),objective:'Implement useful step one, request independent review, then continue step two'};
   const observation=()=>({schema:'metaengine.native-coding.seed-observation.v1',profile_id:profile.profile_id,profile_sha256:profileSha,observed_at:new Date().toISOString(),
    host_process:structuredClone(generated.payload().host_process),user_sid:profile.user_sid,artifact:structuredClone(profile.artifact),postgres:structuredClone(profile.postgres),
    agents:profile.agents.map(a=>({provider_id:a.provider_id,worktree:structuredClone(a.worktree),sandbox:structuredClone(a.sandbox)})),
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false,installed_execution_proven:false});
   const readProtectedJson=async file=>{const bytes=await fs.readFile(file,'utf8');return{value:JSON.parse(bytes),sha256:hash(bytes)};};
   const options={sql:sqlBinding,stateDirectory,readOperator:()=>readProtectedJson(operatorPath),readProtectedJson,
    readCurrentDevice:async()=>structuredClone(device),readNativeScope:async permit=>({host_process:structuredClone(generated.payload().host_process),
     user_sid:profile.user_sid,artifact:structuredClone(profile.artifact),postgres:structuredClone(profile.postgres),worktree:structuredClone(permit.worktree),sandbox:structuredClone(permit.sandbox)}),
    protectStorage:async()=>{},verifyStorage:async()=>({fixture:true,windows_acl_qualified:false})};
   const published=await publishNativeCodingSeedOperator({sql,stateDirectory,profile_id:profile.profile_id,profile_sha256:profileSha,
    readNativeScope:options.readNativeScope,verifyStorage:async()=>({owner_dacl_verified:true,generated_fixture:true})});
   assert.equal(published.operator_pin_published,true);assert.equal(published.physical_execution_proven,false);
   return {generated,profile,input,observation,options,stateDirectory,device,profileSha};
  }
  await t.test('API login has no profile/seed creator or private table grant',async()=>{
   const api=postgres({host:'127.0.0.1',port,user:'seed_api',database:'postgres',max:1,onnotice:()=>{}});
   try{
    await assert.rejects(api.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1,true)',[randomUUID()]),e=>e.code==='42501');
    await assert.rejects(api.unsafe('select * from destruktion_meta.native_coding_seed_h205f22'),e=>e.code==='42501');
    const [r]=await sql.unsafe(`select has_function_privilege('service_role','destruktion_meta.native_coding_seed_goal_v1(uuid,uuid,text,jsonb,text,text)','execute') as effect,
     has_table_privilege('service_role','destruktion_meta.native_coding_seed_profile_h205f22','insert') as creator`);assert.deepEqual(r,{effect:false,creator:false});
   }finally{await api.end({timeout:5});}passed++;
  });
  await t.test('profile preparation is atomic, immutable and never publishes execution authority',async()=>{
   const f=await fixture(),before=await count(f);
   await assert.rejects(prepareNativeCodingSeedProfile({sql,profile:{...f.profile,branch_name:'work/changed'}}),/profile_readback_mismatch/);
   const invalid={...structuredClone(f.profile),profile_id:randomUUID()};invalid.agents[1].role='IMPLEMENTER';
   await assert.rejects(prepareNativeCodingSeedProfile({sql,profile:invalid}),/seed_agent_invalid|independent_pair_required/);
   assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=$1',[invalid.profile_id]))[0].n,0);
   const controller=new AbortController();controller.abort();await assert.rejects(prepareNativeCodingSeedProfile({sql,profile:f.profile,requestContext:{signal:controller.signal}}),/request_cancelled/);
   const api=postgres({host:'127.0.0.1',port,user:'seed_api',database:'postgres',max:1,onnotice:()=>{}});
   try{await assert.rejects(prepareNativeCodingSeedProfile({sql:api,profile:f.profile}),/state_owner_required/);}finally{await api.end({timeout:5});}
   await sql.unsafe('update destruktion_meta.native_coding_seed_profile_h205f22 set revoked_at=clock_timestamp() where profile_id=$1',[f.profile.profile_id]);
   await assert.rejects(prepareNativeCodingSeedProfile({sql,profile:f.profile}),/profile_unavailable/);assert.deepEqual(await count(f),before);passed++;
  });
  await t.test('profile preparation cancellation rolls back before commit and preserves committed identity after lost response',async()=>{
   const f=await fixture(),profile={...structuredClone(f.profile),profile_id:randomUUID()},controller=new AbortController();
   const during={begin:(options,fn)=>sql.begin(options,tx=>fn({unsafe:async(...args)=>{const rows=await tx.unsafe(...args);if(args[0].includes('insert into destruktion_meta.native_coding_seed_profile'))controller.abort();return rows;}}))};
   await assert.rejects(prepareNativeCodingSeedProfile({sql:during,profile,requestContext:{signal:controller.signal}}),/request_cancelled/);
   const rows=()=>sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=$1',[profile.profile_id]);assert.equal((await rows())[0].n,0);
   const late=new AbortController();let transactions=0;const after={begin:async(...args)=>{transactions++;const value=await sql.begin(...args);late.abort();return value;}};
   await assert.rejects(prepareNativeCodingSeedProfile({sql:after,profile,requestContext:{signal:late.signal}}),/request_cancelled/);assert.equal(transactions,1);assert.equal((await rows())[0].n,1);
   const observedSql={unsafe:async(...args)=>{assert.match(args[0],/^select /);return sql.unsafe(...args);}};
   const recovered=await readPreparedNativeCodingSeedProfile({sql:observedSql,profile_id:profile.profile_id,profile_sha256:sha(profile)});assert.equal(recovered.readback_only,true);
   await assert.rejects(readPreparedNativeCodingSeedProfile({sql:observedSql,profile_id:profile.profile_id,profile_sha256:'0'.repeat(64)}),/profile_readback_mismatch/);
   assert.equal(recovered.profile_id,profile.profile_id);assert.equal(recovered.operator_pin_published,false);assert.equal((await rows())[0].n,1);
   assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});passed++;
  });
  await t.test('protected operator publication refuses changed pins, missing ACL and changed physical evidence',async()=>{
   const f=await fixture(),file=path.join(f.stateDirectory,'native-coding-seed-operator-v1.json'),bytes=await fs.readFile(file);
   const options={sql,stateDirectory:f.stateDirectory,profile_id:f.profile.profile_id,profile_sha256:f.profileSha,readNativeScope:f.options.readNativeScope,verifyStorage:async()=>({owner_dacl_verified:true,generated_fixture:true})};
   assert.equal((await publishNativeCodingSeedOperator(options)).existing_pin,true);
   const other={...structuredClone(f.profile),profile_id:randomUUID()};await prepareNativeCodingSeedProfile({sql,profile:other});
   await assert.rejects(publishNativeCodingSeedOperator({...options,profile_id:other.profile_id,profile_sha256:sha(other)}),/operator_conflict/);assert.deepEqual(await fs.readFile(file),bytes);
   const fresh=await fs.mkdtemp(path.join(directory,'unpublished-')),freshFile=path.join(fresh,'native-coding-seed-operator-v1.json');
   await assert.rejects(publishNativeCodingSeedOperator({...options,stateDirectory:fresh,verifyStorage:async()=>({owner_dacl_verified:false})}),/directory_unverified/);await assert.rejects(fs.stat(freshFile),{code:'ENOENT'});
   await assert.rejects(publishNativeCodingSeedOperator({...options,stateDirectory:fresh,readNativeScope:async permit=>({...await f.options.readNativeScope(permit),user_sid:'S-1-5-21-999'})}),/physical_scope_changed/);await assert.rejects(fs.stat(freshFile),{code:'ENOENT'});
   const controller=new AbortController();controller.abort();await assert.rejects(publishNativeCodingSeedOperator({...options,stateDirectory:fresh,requestContext:{signal:controller.signal}}),/request_cancelled/);await assert.rejects(fs.stat(freshFile),{code:'ENOENT'});
   await fs.writeFile(freshFile,'partial-crash');await assert.rejects(publishNativeCodingSeedOperator({...options,stateDirectory:fresh}),/private_json_invalid/);assert.equal(await fs.readFile(freshFile,'utf8'),'partial-crash');
   assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});passed++;
  });
  await t.test('interrupted selector staging never publishes partial bytes and can retry the same registered profile',async()=>{
   const f=await fixture(),root=await fs.mkdtemp(path.join(directory,'atomic-selector-'));
   const options={sql,stateDirectory:root,profile_id:f.profile.profile_id,profile_sha256:f.profileSha,readNativeScope:f.options.readNativeScope,verifyStorage:async()=>({owner_dacl_verified:true,generated_fixture:true})};
   const file=path.join(root,'native-coding-seed-operator-v1.json'),originalOpen=fs.open;let intercepted=false;
   fs.open=async(target,...args)=>{const handle=await originalOpen(target,...args);if(path.dirname(String(target))!==root||!path.basename(String(target)).startsWith('.native-seed-selector-'))return handle;intercepted=true;
    return {writeFile:async()=>{await handle.writeFile('{partial');throw Error('GENERATED_STAGING_FAILURE');},sync:()=>handle.sync(),close:()=>handle.close()};};
   try{await assert.rejects(publishNativeCodingSeedOperator(options),/GENERATED_STAGING_FAILURE/);}finally{fs.open=originalOpen;}
   assert.equal(intercepted,true);await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.deepEqual(await fs.readdir(root),[]);
   const published=await publishNativeCodingSeedOperator(options);assert.equal(published.operator_pin_published,true);assert.equal(published.existing_pin,false);assert.equal((await fs.stat(file)).nlink,1);
   assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{schema:'metaengine.native-coding.seed-operator.v1',profile_id:f.profile.profile_id,profile_sha256:f.profileSha});
   assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});passed++;
  });
  await t.test('Host seeds four protected providers and one native root atomically, no fake meta-plan',async()=>{
   const f=await fixture(),service=await createNativeCodingHostSeedService(f.options),reply=await service.SEED_GOAL(f.input),v=reply.admission.receipt;
   assert.equal(reply.state,'ADMITTED');assert.equal(v.state,'ADMITTED');assert.equal(v.permit_ids.length,4);assert.equal(v.physical_execution_proven,false);assert.equal(v.global_actuation_granted,false);
   assert.deepEqual(v.logical_policy,{max_depth:null,max_tasks:null,max_children:null});assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});
   const [task]=await sql.unsafe('select task_spec,task_spec_sha256,base_sha from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[v.root_task_id]);
   assert.equal(task.task_spec.native_coding.goal_sha256,v.goal_sha256);assert.equal(task.task_spec.native_coding.project_id,v.project_id);assert.equal(task.task_spec.objective,f.input.objective);
   assert.equal(task.task_spec_sha256,v.task_spec_sha256);assert.equal(task.task_spec.meta_orchestrator,undefined);
   const [snapshot]=await sql.unsafe('select public.h205f22_project_snapshot_v1($1,$2,null,0,16,$3,$4,1) as value',[f.profile.workspace_id,v.project_id,f.profile.device_id,f.profile.client_id]);
   assert.equal(snapshot.value.root_task_id,v.root_task_id);assert.equal(snapshot.value.goal,f.input.objective);
   const replay=await service.SEED_GOAL(f.input);assert.equal(replay.state,'READBACK_ONLY');assert.equal(replay.admission.receipt_sha256,reply.admission.receipt_sha256);
   const direct=await invoke(f);assert.equal(direct.receipt_sha256,reply.admission.receipt_sha256);assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});
   const page=await service.LIST_SEEDS({after_seq:0,limit:1});assert.equal(page.entries[0].request_id,f.input.request_id);assert.equal(page.has_more,false);
   await assert.rejects(service.SEED_GOAL({...f.input,worktree:'C:\\arbitrary'}),/request_invalid/);service.close();passed++;
  });
  await t.test('cancelled physical observation cannot admit any real PostgreSQL task or permit',async()=>{
   const f=await fixture(),controller=new AbortController(),original=f.options.readNativeScope;
   const service=await createNativeCodingHostSeedService({...f.options,readNativeScope:async(...args)=>{
    const value=await original(...args);controller.abort();return value;
   }});
   try{
    await assert.rejects(service.SEED_GOAL(f.input,{signal:controller.signal}),/request_cancelled/);
    assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});
    const readback=await service.READ_SEED(f.input);
    assert.equal(readback.state,'REJECTED_BEFORE_DISPATCH');assert.equal(readback.rejection.admission_absent,true);
   }finally{service.close();}passed++;
  });
  await t.test('same UUID with different objective and public-goal UUID collision cannot create a task',async()=>{
   const f=await fixture();await invoke(f);
   await assert.rejects(invoke(f,{...f.input,objective:'A different goal'}),/native_coding_seed_request_collision/);
   const g=await fixture(),requestId=g.input.request_id,h='a'.repeat(64),baseSha='b'.repeat(40);
   await assert.rejects(sql.unsafe(`insert into destruktion_meta.client_v1_goal_request_h205f22(request_id,workspace_id,roadmap_id,request_sha256,plan_generation,alignment_epoch,baseline_sha,plan_sha256,point_id,task_id,task_spec_sha256,submission_receipt)
    values($1,$2,'metaengine-client-v1',$3,1,1,$4,$3,'generated.reverse.collision',$5,$3,'{"schema":"metaengine.client-v1.goal-submit.v2","authority_effect":false,"automatic_retry_allowed":false}')`,[f.input.request_id,f.profile.workspace_id,h,baseSha,randomUUID()]),/client_v1_goal_request_collision/);
   await sql.unsafe(`insert into destruktion_meta.client_v1_goal_request_h205f22(request_id,workspace_id,roadmap_id,request_sha256,plan_generation,alignment_epoch,baseline_sha,plan_sha256,point_id,task_id,task_spec_sha256,submission_receipt)
    values($1,$2,'metaengine-client-v1',$3,1,1,$4,$3,'generated.browser.collision',$5,$3,'{"schema":"metaengine.client-v1.goal-submit.v2","authority_effect":false,"automatic_retry_allowed":false}')`,[requestId,g.profile.workspace_id,h,baseSha,randomUUID()]);
   await assert.rejects(invoke(g),/native_coding_seed_request_collision/);assert.equal((await count(g)).tasks,0);passed++;
  });
  await t.test('concurrent serializable submissions admit one root; the snapshot/conflict loser uses readback instead of retry',async()=>{
   const f=await fixture(),settled=await Promise.allSettled([invoke(f),invoke(f)]);
   const successes=settled.filter(x=>x.status==='fulfilled');assert.ok(successes.length>=1);
   for(const result of settled)if(result.status==='rejected'){
    // A snapshot taken before the UUID lock was released can report either
    // SERIALIZATION_FAILURE or the exact deterministic permit unique conflict.
    // Neither result grants a retry; the following fresh read is the proof.
    assert.ok(result.reason.code==='40001'||(result.reason.code==='23505'
     &&['native_coding_operator_permit_h205f22_pkey','native_coding_one_active_permit_binding'].includes(result.reason.constraint_name)));
   }
   const [read]=await sql.unsafe('select destruktion_meta.native_coding_seed_read_v1($1,$2) as value',[f.profile.profile_id,f.input.request_id]);
   assert.equal(read.value.receipt.root_task_id,successes[0].value.receipt.root_task_id);
   assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});passed++;
  });
  await t.test('real current ADMIN epoch and device fingerprint are required at SQL and Host boundaries',async()=>{
   for(const column of ['admin_grant_epoch','access_tier','key_fingerprint_sha256']){
    const f=await fixture();const value=column==='admin_grant_epoch'?2:column==='access_tier'?'READ_ONLY':'f'.repeat(64);
    await sql.unsafe(`update public.compute_fabric_a2_browser_device_h205f22 set ${column}=$1 where device_id=$2`,[value,f.profile.device_id]);
    await assert.rejects(invoke(f),/PROJECT_DEVICE_GRANT_REVOKED|native_coding_seed_device_changed/);assert.equal((await count(f)).tasks,0);
   }
   const f=await fixture(),service=await createNativeCodingHostSeedService({...f.options,readCurrentDevice:async()=>({...f.device,device_id:randomUUID()})});
   await assert.rejects(service.SEED_GOAL(f.input),/current_device_changed/);assert.equal((await count(f)).tasks,0);service.close();passed++;
  });
  await t.test('stop, wrong installed artifact and stale/cross-root physical observations roll back all admission',async()=>{
   const f=await fixture();await sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[f.profile.workspace_id]);
   await assert.rejects(invoke(f),/native_coding_seed_environment_fenced/);assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});
   const g=await fixture();for(const kind of ['artifact','stale','root']){const o=g.observation();
    if(kind==='artifact')o.artifact.installed_asar_sha256='f'.repeat(64);if(kind==='stale')o.observed_at=new Date(Date.now()-60000).toISOString();if(kind==='root')o.agents[0].worktree.root_identity_sha256='f'.repeat(64);
    await assert.rejects(invoke(g,g.input,o),/native_coding_seed_(physical|agent)_scope_changed/);
   }
   const service=await createNativeCodingHostSeedService({...g.options,readNativeScope:async permit=>({...await g.options.readNativeScope(permit),artifact:{...g.profile.artifact,installed_exe_sha256:'f'.repeat(64)}})});
   await assert.rejects(service.SEED_GOAL(g.input),/physical_scope_changed/);assert.equal((await count(g)).tasks,0);service.close();passed++;
  });
  await t.test('late correlation failure rolls back existing enqueue, permits, project and history together',async()=>{
   const f=await fixture();await sql.unsafe(`create function destruktion_meta.qa_seed_late_failure() returns trigger language plpgsql as $$begin
    if new.objective='Generated late correlation failure' then raise exception 'qa_seed_late_failure';end if;return new;end$$;
    create trigger zz_qa_seed_late_failure before insert on destruktion_meta.native_coding_seed_h205f22 for each row execute function destruktion_meta.qa_seed_late_failure()`);
   try{await assert.rejects(invoke(f,{...f.input,objective:'Generated late correlation failure'}),/qa_seed_late_failure/);
    assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});
    assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.project_event_h205f22 e join destruktion_meta.project_run_h205f22 p using(project_id)where p.workspace_id=$1',[f.profile.workspace_id]))[0].n,0);
   }finally{await sql.unsafe('drop trigger zz_qa_seed_late_failure on destruktion_meta.native_coding_seed_h205f22;drop function destruktion_meta.qa_seed_late_failure()');}passed++;
  });
  await t.test('pre-dispatch observation failure has an exact durable rejection and no SQL replay',async()=>{
   let dispatches=0;
   const binding={unsafe:(...a)=>sql.unsafe(...a),begin:async(...a)=>{dispatches++;return sql.begin(...a);}};
   const f=await fixture({sqlBinding:binding}),service=await createNativeCodingHostSeedService({...f.options,
    readNativeScope:async()=>{throw Error('generated_observation_failure');}});
   await assert.rejects(service.SEED_GOAL(f.input),/generated_observation_failure/);
   const result=await service.READ_SEED(f.input);assert.equal(result.state,'REJECTED_BEFORE_DISPATCH');
   assert.equal(result.rejection.request_id,f.input.request_id);assert.equal(result.rejection.admission_absent,true);
   assert.deepEqual(await service.SEED_GOAL(f.input),result);assert.equal(dispatches,0);
   assert.deepEqual(await count(f),{seeds:0,projects:0,tasks:0,permits:0,browser_goals:0});service.close();passed++;
  });
  await t.test('an unresolved SQL attempt with no seed stays ambiguous and cannot become a pre-dispatch rejection',async()=>{
   let dispatches=0;const binding={unsafe:(...a)=>sql.unsafe(...a),begin:async()=>{dispatches++;throw Error('generated_unknown_transaction');}};
   const f=await fixture({sqlBinding:binding}),service=await createNativeCodingHostSeedService(f.options);
   assert.equal((await service.SEED_GOAL(f.input)).state,'READBACK_REQUIRED');
   const read=await service.READ_SEED(f.input);assert.equal(read.state,'READBACK_ONLY');assert.equal(read.admission,null);
   assert.equal((await service.SEED_GOAL(f.input)).state,'READBACK_ONLY');assert.equal(dispatches,1);service.close();passed++;
  });
  await t.test('a commit racing the first absent read wins over an absent semantic fence',async()=>{
   let hide=false;const binding={begin:(...a)=>sql.begin(...a),unsafe:async(text,...args)=>{
    if(hide&&text.includes('native_coding_seed_read_v1')){hide=false;return[{value:null}];}return sql.unsafe(text,...args);
   }};
   const f=await fixture({sqlBinding:binding}),service=await createNativeCodingHostSeedService(f.options);
   const admitted=await service.SEED_GOAL(f.input);hide=true;const read=await service.READ_SEED(f.input);
   assert.equal(read.state,'READBACK_ONLY');assert.deepEqual(read.admission,admitted.admission);assert.equal((await count(f)).seeds,1);service.close();passed++;
  });
  await t.test('lost COMMIT ACK is read back from real PG; changing UUID cannot replay an unresolved semantic intent',async()=>{
   let dispatches=0;const binding={unsafe:(...a)=>sql.unsafe(...a),begin:async(...a)=>{dispatches++;const result=await sql.begin(...a);throw Error('generated_ack_loss_after_real_commit');}};
   const f=await fixture({sqlBinding:binding}),service=await createNativeCodingHostSeedService(f.options),first=await service.SEED_GOAL(f.input);
   assert.equal(first.state,'READBACK_ONLY');assert.equal(first.admission.receipt.state,'ADMITTED');assert.equal(dispatches,1);
   const restarted=await createNativeCodingHostSeedService(f.options);const alias=await restarted.SEED_GOAL({...f.input,request_id:randomUUID()});
   assert.equal(alias.state,'READBACK_REQUIRED');assert.equal(alias.original_request_id,f.input.request_id);assert.equal(alias.admission.receipt_sha256,first.admission.receipt_sha256);assert.equal(dispatches,1);
   const exact=await restarted.READ_SEED(f.input);assert.equal(exact.admission.receipt_sha256,first.admission.receipt_sha256);
   assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});service.close();restarted.close();passed++;
  });
  await t.test('seed does not open browser RECOVERING gate; only fresh signed provider plus real W30 claim can lease',async()=>{
   const f=await fixture({pairs:1}),reply=await invoke(f),r=reply.receipt,a=f.profile.agents[0];
   const lease=async()=>(await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',
    [f.profile.workspace_id,a.agent_id,a.role,'native-coding:'+a.provider_id,'codex-cli:'+a.provider_id]))[0].value;
   assert.equal((await lease()).leased,false);
   const [row]=await sql.unsafe('select permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=$1',[r.permit_ids[0]]),p=row.permit;
   const {schema,issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,...scope}=p;
   const payload={...f.generated.payload(),...scope,target_id:'codex-cli:'+p.provider_id,sandbox:a.sandbox,
    proven_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Math.min(Date.now()+50000,Date.parse(p.expires_at))).toISOString()};
   const envelope=f.generated.envelope(payload);await sql.unsafe(`insert into destruktion_meta.native_coding_provider_registration_h205f22(permit_id,envelope,canonical_envelope,envelope_sha256)values($1,$2,$3,$4)`,
    [p.permit_id,sql.json(envelope),canonical(envelope),sha(envelope)]);
   await assert.rejects(lease(),/native_coding_continuity_fenced/);assert.equal((await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[r.root_task_id]))[0].state,'READY');
   await sql.unsafe(`update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{supervisor_lifecycle,keepalive,state}','"WAITING"'),last_seen_at=clock_timestamp()where workspace_id=$1`,[f.profile.workspace_id]);
   const actual=await lease();assert.equal(actual.leased,true);assert.equal(actual.task_id,r.root_task_id);assert.equal(actual.task_spec.native_coding.goal_sha256,r.goal_sha256);
   assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[r.root_task_id]))[0].n,1);passed++;
  });
  await t.test('native goal/profile correlation is immutable; historical catalog remains readable after revocation',async()=>{
   const f=await fixture();await invoke(f);
   await assert.rejects(sql.unsafe("update destruktion_meta.native_coding_seed_h205f22 set objective='changed' where request_id=$1",[f.input.request_id]),/native_coding_seed_immutable/);
   await assert.rejects(sql.unsafe('delete from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=$1',[f.profile.profile_id]),/native_coding_seed_immutable/);
   await sql.unsafe('update destruktion_meta.native_coding_seed_profile_h205f22 set revoked_at=clock_timestamp()where profile_id=$1',[f.profile.profile_id]);
   const service=await createNativeCodingHostSeedService(f.options);assert.equal((await service.READ_SEED(f.input)).admission.receipt.request_id,f.input.request_id);
   await assert.rejects(service.SEED_GOAL({...f.input,request_id:randomUUID()}),/native_coding_seed_profile_unavailable/);service.close();passed++;
  });
  await t.test('real enrolled-key signer authenticates seed admission through current PG device and isolated private context',async()=>{
   const f=await fixture(),statePath=path.join(f.stateDirectory,'generated-test-identity.json');
   // The key is newly generated by this test fixture, never an installed key.
   const pem=f.generated.pair.privateKey.export({format:'pem',type:'pkcs8'});
   await fs.writeFile(statePath,JSON.stringify({schema:'metaengine.native-supervisor.device-identity.v1',profile:f.generated.identity.profile,
    client_id:f.profile.client_id,device_id:f.profile.device_id,public_jwk:f.generated.jwk,
    key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256,encrypted_private_key_b64:Buffer.from(pem).toString('base64')}));
   const identity=new SupervisorDeviceIdentity({statePath,secureStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});await identity.ensure();
   const binding={instance_id:randomUUID(),host_pid:process.pid};
   const verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:binding.instance_id,hostPid:binding.host_pid});
   const context=createNativeCodingAuthenticatedRequestContext({verifier});
   const service=await createNativeCodingHostSeedService({...f.options,readCurrentDevice:context.readCurrentDevice});
   try{
    await assert.rejects(service.SEED_GOAL(f.input),/authenticated_scope_required/);
    const signed=await signNativeCodingDeviceRequest({identity,binding,operation:'SEED_GOAL',input:f.input});
    const reply=await context.run('SEED_GOAL',signed,input=>service.SEED_GOAL(input));assert.equal(reply.state,'ADMITTED');
    assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});
    await assert.rejects(context.run('SEED_GOAL',signed,input=>service.SEED_GOAL(input)),/nonce_reused/);
    const read=await signNativeCodingDeviceRequest({identity,binding,operation:'READ_SEED',input:f.input});
    assert.equal((await context.run('READ_SEED',read,input=>service.READ_SEED(input))).admission.receipt_sha256,reply.admission.receipt_sha256);
    await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.profile.device_id]);
    const changed=await signNativeCodingDeviceRequest({identity,binding,operation:'READ_SEED',input:f.input});
    await assert.rejects(context.run('READ_SEED',changed,input=>service.READ_SEED(input)),/current_device_changed|PROJECT_DEVICE_GRANT_REVOKED/);
   }finally{service.close();context.close();verifier.close();}passed++;
  });
  await sql.unsafe(await source('20261025120000_native_coding_service_heartbeat_admission_v1.sql'));
  const capacityUpgrade=await fs.readFile(new URL('./native-agent-count-unbounded-v2.sql',import.meta.url),'utf8');
  await sql.unsafe(capacityUpgrade);await sql.unsafe(capacityUpgrade);
  await t.test('80 protected agents and a physical budget above 64 are admitted without a roster ceiling',async()=>{
   const f=await fixture({pairs:40,budget:130}),service=await createNativeCodingHostSeedService(f.options);
   try{const reply=await service.SEED_GOAL(f.input);assert.equal(reply.admission.receipt.permit_ids.length,80);
    assert.equal((await count(f)).permits,80);
    assert.deepEqual(reply.admission.receipt.logical_policy,{max_depth:null,max_tasks:null,max_children:null});
   }finally{service.close();}passed++;
  });
  const chatUpgrade=await fs.readFile(new URL('./native-coding-chat-coordination-v1.sql',import.meta.url),'utf8');
  await sql.begin(async tx=>tx.unsafe(chatUpgrade));
  await sql.begin(async tx=>tx.unsafe(chatUpgrade));
  const bindingSource=await source('20260831152000_a2_workspace_binding_registry_v1.sql');
  await sql.unsafe(bindingSource.slice(bindingSource.indexOf('create table public.compute_fabric_a2_workspace_binding_h205f22'),bindingSource.indexOf('alter table public.compute_fabric_a2_workspace_binding_h205f22')));
  await sql.unsafe(await source('20261026020000_browser_parent_suspension_v1.sql'));
  const reviewUpgrade=await fs.readFile(new URL('./native-coding-review-observation-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(reviewUpgrade));await sql.begin(tx=>tx.unsafe(reviewUpgrade));
  const messageUpgrade=await fs.readFile(new URL('./native-coding-chat-messages-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(messageUpgrade));await sql.begin(tx=>tx.unsafe(messageUpgrade));
  const browserMessageUpgrade=await fs.readFile(new URL('./browser-project-messages-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(browserMessageUpgrade));await sql.begin(tx=>tx.unsafe(browserMessageUpgrade));
  await assert.rejects(sql.begin(async tx=>{await tx.unsafe('alter function public.h205f22_project_message_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,text,uuid,text,bigint) stable');
    await tx.unsafe(browserMessageUpgrade);}),/PROJECT_MESSAGE_BODY_REQUIRES_REVIEW/);
  const ackUpgrade=await fs.readFile(new URL('./project-message-ack-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(ackUpgrade));await sql.begin(tx=>tx.unsafe(ackUpgrade));
  await assert.rejects(sql.begin(async tx=>{await tx.unsafe('alter function destruktion_meta.project_message_ack_v1(uuid,uuid,text,bigint,bigint) security definer');
    await tx.unsafe(ackUpgrade);}),/PROJECT_MESSAGE_ACK_BODY_REQUIRES_REVIEW/);
  const [ackPrivileges]=await sql.unsafe(`select
    has_function_privilege('anon','public.h205f22_project_message_ack_v1(uuid,uuid,uuid,bigint,bigint,bigint,uuid,text,bigint)','EXECUTE') as anon_allowed,
    has_function_privilege('service_role','destruktion_meta.project_message_ack_v1(uuid,uuid,text,bigint,bigint)','EXECUTE') as private_allowed`);
  assert.equal(ackPrivileges.anon_allowed,false);assert.equal(ackPrivileges.private_allowed,false);

  const wakeUpgrade=await fs.readFile(new URL('./project-message-wake-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(wakeUpgrade));await sql.begin(tx=>tx.unsafe(wakeUpgrade));
  await sql.begin(async tx=>{await tx.unsafe(reviewUpgrade);await tx.unsafe(wakeUpgrade);});
  await t.test('protected chat-led profile admits a browser planner and native permits, never a CLI planner',async()=>{
   const f=await fixture({chatLed:true}),service=await createNativeCodingHostSeedService(f.options);
   try{
    const admitted=(await service.SEED_GOAL(f.input)).admission.receipt;
    const [task]=await sql.unsafe('select role,claim_class,task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[admitted.root_task_id]);
    assert.equal(task.role,'PLANNER');assert.equal(task.claim_class,'READ_ONLY');
    assert.equal(task.task_spec.native_coding,undefined);assert.equal(task.task_spec.coordination_mode,'CHAT_LED');
    assert.equal(task.task_spec.project_continuity.project_id,admitted.project_id);
    assert.deepEqual(await count(f),{seeds:1,projects:1,tasks:1,permits:4,browser_goals:0});
    const [candidate]=await sql.unsafe('select destruktion_meta.native_coding_chat_child_permit_v1($1,$2,$3) as value',[admitted.project_id,admitted.root_task_id,'IMPLEMENTER']);
    assert.equal(candidate.value.project_id,admitted.project_id);assert.equal(candidate.value.role,'IMPLEMENTER');
    const [critic]=await sql.unsafe('select destruktion_meta.native_coding_chat_child_permit_v1($1,$2,$3) as value',[admitted.project_id,admitted.root_task_id,'CRITIC']);
    assert.equal(critic.value,null,'critic needs the completed writer subject, never a free-form proposal');
    const replay=await service.SEED_GOAL(f.input);assert.equal(replay.admission.receipt.root_task_id,admitted.root_task_id);
   }finally{service.close();}passed++;
  });
  await t.test('legacy profile remains native and cannot acquire chat handoff mode',async()=>{
   const f=await fixture(),admitted=(await invoke(f)).receipt;
   const [task]=await sql.unsafe('select role,task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[admitted.root_task_id]);
   assert.equal(task.role,'IMPLEMENTER');assert.ok(task.task_spec.native_coding);
   const [candidate]=await sql.unsafe('select destruktion_meta.native_coding_chat_child_permit_v1($1,$2,$3) as value',[admitted.project_id,admitted.root_task_id,'IMPLEMENTER']);
   assert.equal(candidate.value,null);passed++;
  });
  await t.test('real browser-parent claim hands IMPLEMENTER children to protected native permits without fallback',async()=>{
   const f=await fixture({chatLed:true}),admitted=(await invoke(f)).receipt;
   const agent='agent_chat-planner-001',tab='tab_'+randomUUID(),target='webcontents:42';
   const heartbeat={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
    transport_identity:{profile:f.generated.identity.profile,device_id:f.profile.device_id,key_fingerprint_sha256:f.profile.device_key_fingerprint_sha256,
     access_tier:'ADMIN',admin_grant_epoch:1,admin_ready:true},
    supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}},
    fleet:{schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',agents:[{
     agent_id:agent,role:'PLANNER',tab_id:tab,target_id:target,generation_epoch:1,ownership:'FLEET_OWNED',lifecycle_state:'ACTIVE',
     authority_effect:false,automatic_retry_allowed:false,transport_proof:{schema:'metaengine.browser.fleet-transport-proof.v1',
      tab_id:tab,target_id:target,generation_epoch:1,conversation_url_sha256:'a'.repeat(64),proven_at:new Date().toISOString(),authority_effect:false},
    }]}};
   await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=$1,last_seen_at=clock_timestamp() where workspace_id=$2',
    [sql.json(heartbeat),f.profile.workspace_id]);
   const [leaseRow]=await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',
    [f.profile.workspace_id,agent,'PLANNER',tab,target]);
   const lease=leaseRow.value;assert.equal(lease.leased,true);assert.equal(lease.task_id,admitted.root_task_id);
   const request=randomUUID(),children=[{role:'IMPLEMENTER',objective:'Implement first bounded patch'},{role:'CODER',objective:'Implement second independent patch'}];
   const spawn=async(id,batch,claim=lease.claim_id)=>(await sql.unsafe('select public.h205f22_project_spawn_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,1) as value',
    [f.profile.workspace_id,admitted.project_id,lease.task_id,claim,lease.lease_generation,id,sql.json(batch),f.profile.device_id,f.profile.client_id]))[0].value;
   const result=await spawn(request,children);assert.equal(result.children.length,2);assert.ok(result.children.every(c=>c.status==='ADMITTED'));
   const tasks=await sql.unsafe('select task_spec,role from destruktion_meta.devos_fleet_task_h205f22 where task_id=any($1::uuid[])',[result.children.map(c=>c.task_id)]);
   assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.role==='IMPLEMENTER'&&t.task_spec.native_coding.project_id===admitted.project_id));
   assert.equal(new Set(tasks.map(t=>t.task_spec.native_coding.permit_id)).size,2);
   assert.equal((await spawn(request,children)).replayed,true);
   const pendingId=randomUUID(),pendingChildren=[{role:'IMPLEMENTER',objective:'Wait for an available protected worker'}];
   const waiting=await spawn(pendingId,pendingChildren);
   assert.equal(waiting.children[0].status,'CAPACITY_WAIT');assert.equal(waiting.children[0].task_id,null);
   await assert.rejects(spawn(randomUUID(),[{role:'CRITIC',objective:'Cannot choose an unbound review subject'}]),/PROJECT_NATIVE_REVIEW_SUBJECT_REQUIRED/);
   await assert.rejects(spawn(randomUUID(),children,Number(lease.claim_id)+9999),/PROJECT_PARENT_CLAIM_FENCED/);
   assert.equal((await count(f)).tasks,3);
   const selected=tasks[0].task_spec.native_coding.permit_id;
   let messageReceipt;
   const pair=await completeChatNativePair({sql,fixture:f,writerPermitId:selected,onRunning:async({run,permit})=>{
    if(permit.role!=='IMPLEMENTER')return;
    const browserId=randomUUID(),browserText='Review the failing test first.  Preserve this spacing. 😀';
    const browserSend=(request=browserId,text=browserText,recipient=permit.agent_id,claim=lease.claim_id)=>sql.unsafe(
      'select public.h205f22_project_message_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) as value',
      [f.profile.workspace_id,admitted.project_id,lease.task_id,claim,lease.lease_generation,request,recipient,text,f.profile.device_id,f.profile.client_id]);
    const [storedBrowser]=await browserSend();
    assert.equal(storedBrowser.value.stored,true);assert.equal(storedBrowser.value.replayed,false);
    assert.equal(storedBrowser.value.recipient_task_id,(await sql.unsafe('select task_id from destruktion_meta.native_coding_job_registration_h205f22 where run_id=$1',[run]))[0].task_id);
    assert.equal(storedBrowser.value.read_by_recipient_proven,false);
    const [replayedBrowser]=await browserSend();assert.equal(replayedBrowser.value.replayed,true);assert.equal(replayedBrowser.value.seq,storedBrowser.value.seq);
    await assert.rejects(browserSend(browserId,'Different body'),/PROJECT_MESSAGE_REQUEST_COLLISION/);
    await assert.rejects(browserSend(randomUUID(),browserText,'agent_foreign-peer-001'),/PROJECT_MESSAGE_RECIPIENT_NOT_UNIQUE/);
    await assert.rejects(browserSend(randomUUID(),browserText,permit.agent_id,Number(lease.claim_id)+9999),/PROJECT_PARENT_CLAIM_FENCED/);
    await assert.rejects(browserSend(randomUUID(),'😀'.repeat(1025)),/PROJECT_MESSAGE_REQUEST_INVALID/);
    const [event]=await sql.unsafe('select content from destruktion_meta.project_event_h205f22 where project_id=$1 and seq=$2',[admitted.project_id,storedBrowser.value.seq]);
    assert.equal(event.content.message,browserText);
    const ackId=randomUUID();
    const nativeAck=(seq=storedBrowser.value.seq,id=ackId)=>sql.unsafe('select destruktion_meta.native_coding_agent_message_ack_v1($1,$2,$3) as value',[run,id,seq]);
    const [ackNative]=await nativeAck();assert.equal(ackNative.value.recipient_acknowledged,true);assert.equal(ackNative.value.processing_verified,false);
    assert.equal((await nativeAck())[0].value.ack_seq,ackNative.value.ack_seq);
    assert.equal((await nativeAck(storedBrowser.value.seq,randomUUID()))[0].value.ack_seq,ackNative.value.ack_seq);
    const [ackIntent]=await sql.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1,$2) as value',[run,ackId]);
    assert.equal(ackIntent.value.operation,'ACK');assert.equal(ackIntent.value.receipt.ack_seq,ackNative.value.ack_seq);
    assert.equal(ackIntent.value.readback_only,true);assert.equal(ackIntent.value.physical_effect_replayed,false);

    await assert.rejects(sql.unsafe("update destruktion_meta.native_coding_agent_intent_h205f22 set receipt='{}' where run_id=$1 and request_id=$2",[run,ackId]),/native_agent_intent_immutable/);
    const browserAck=seq=>sql.unsafe('select public.h205f22_project_message_ack_v1($1,$2,$3,$4,$5,$6,$7,$8,1) as value',
      [f.profile.workspace_id,admitted.project_id,lease.task_id,lease.claim_id,lease.lease_generation,seq,f.profile.device_id,f.profile.client_id]);
    await assert.rejects(browserAck(storedBrowser.value.seq),/PROJECT_MESSAGE_ACK_RECIPIENT_DENIED/);

    const id=randomUUID(),body='Please clarify the next bounded step. This message is project data, not execution authority.';
    const send=()=>sql.unsafe('select destruktion_meta.native_coding_agent_message_v1($1,$2,$3,$4) as value',[run,id,agent,body]);
    await assert.rejects(sql.unsafe('select destruktion_meta.native_coding_agent_message_v1($1,$2,$3,$4)',[run,randomUUID(),'agent_foreign-chat-001','Not a project peer']),/recipient_not_unique/);
    await assert.rejects(sql.begin(async tx=>{
     await tx.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second' where claim_id=$1",[lease.claim_id]);
     await tx.unsafe('select destruktion_meta.native_coding_agent_message_v1($1,$2,$3,$4)',[run,randomUUID(),agent,'Expired chat claim']);
    }),/recipient_not_unique/);
    // Generated suspended-recipient rows test routing only, not browser
    // transport/suspension proof. Roll the entire temporary scenario back.
    const rollback=Error('rollback_generated_suspended_recipient');
    await assert.rejects(sql.begin(async tx=>{
     const conversation='https://chatgpt.com/c/'+randomUUID();
     const checkpoint={schema:'metaengine.browser.parent-checkpoint.v1',conversation_url:conversation,conversation_url_sha256:hash(conversation),
      transcript_floor:0,transcript_total_chars:10,transcript_sha256:'b'.repeat(64),agent_surface_sha256:'c'.repeat(64),confirmed_turn_sha256:'d'.repeat(64),
      delivered_tool_results:[],observed_at:new Date().toISOString(),tab_id:tab,target_id:target,agent_id:agent,agent_generation_epoch:1,control_generation:0,worktree_custody:null};
     await tx.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='SUSPENDED' where task_id=$1",[lease.task_id]);
     await tx.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED' where claim_id=$1",[lease.claim_id]);
     await tx.unsafe(`insert into destruktion_meta.browser_parent_suspension_h205f22(suspension_id,project_id,workspace_id,task_id,old_claim_id,old_lease_generation,checkpoint,checkpoint_sha256,awaited_children)
      values($1,$2,$3,$4,$5,$6,$7::text::jsonb,encode(extensions.digest(convert_to($7::text::jsonb::text,'UTF8'),'sha256'),'hex'),'[]')`,
      [randomUUID(),admitted.project_id,f.profile.workspace_id,lease.task_id,lease.claim_id,lease.lease_generation,canonical(checkpoint)]);
     const [peer]=await tx.unsafe('select destruktion_meta.native_coding_project_peer_v1($1,$2,$3) as value',[admitted.project_id,f.profile.workspace_id,agent]);
     assert.equal(peer.value,lease.task_id);
     const [stored]=await tx.unsafe('select destruktion_meta.native_coding_agent_message_v1($1,$2,$3,$4) as value',[run,randomUUID(),agent,'A suspended planner reads this on resume']);
     assert.equal(stored.value.recipient_task_id,lease.task_id);assert.equal(stored.value.read_by_recipient_proven,false);
     const [wake]=await tx.unsafe('select destruktion_meta.browser_parent_suspension_projection_v1(suspension_id) as value from destruktion_meta.browser_parent_suspension_h205f22 where task_id=$1 and status=$2',[lease.task_id,'SUSPENDED']);
     assert.equal(wake.value.state,'READY_FOR_MESSAGE');

     throw rollback;
    }),error=>error===rollback);
    messageReceipt=(await send())[0].value;assert.equal(messageReceipt.stored,true);assert.equal(messageReceipt.recipient_task_id,lease.task_id);
    assert.equal(messageReceipt.read_by_recipient_proven,false);assert.equal((await send())[0].value.intent_replayed,true);
    const [ackBrowser]=await browserAck(messageReceipt.seq);assert.equal(ackBrowser.value.recipient_acknowledged,true);assert.equal(ackBrowser.value.processing_verified,false);
    assert.equal((await browserAck(messageReceipt.seq))[0].value.ack_seq,ackBrowser.value.ack_seq);
    await assert.rejects(nativeAck(messageReceipt.seq,randomUUID()),/PROJECT_MESSAGE_ACK_RECIPIENT_DENIED/);
    await assert.rejects(browserAck(ackBrowser.value.ack_seq),/PROJECT_MESSAGE_ACK_RECIPIENT_DENIED/);

    const [history]=await sql.unsafe('select public.h205f22_project_history_v1($1,$2,0,null,128,null,null,null,$3,$4,1) as value',
     [f.profile.workspace_id,admitted.project_id,f.profile.device_id,f.profile.client_id]);
    const messages=history.value.entries.filter(e=>e.event_type==='NATIVE_AGENT_MESSAGE');assert.equal(messages.length,1);
    assert.equal(messages[0].content.message,body);assert.equal(messages[0].content.target_agent_id,agent);
   }});
   assert.ok(messageReceipt);
   assert.equal(pair.finalized.root_fence_released,true);assert.equal(pair.finalized.successor_admitted,false);
   const continued=await spawn(pendingId,pendingChildren);assert.equal(continued.children[0].status,'ADMITTED');
   const [next]=await sql.unsafe('select base_sha,task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[continued.children[0].task_id]);
   assert.equal(next.base_sha,pair.receipt.head);assert.equal(next.task_spec.native_coding.permit_id,pair.finalized.next_writer_permit_id);
   assert.notEqual(next.task_spec.native_coding.permit_id,selected);
   assert.equal((await spawn(pendingId,pendingChildren)).children[0].task_id,continued.children[0].task_id);
   const rejected=await completeChatNativePair({sql,fixture:f,writerPermitId:tasks[1].task_spec.native_coding.permit_id,verdict:'REJECT'});
   const [observed]=await sql.unsafe('select public.h205f22_project_snapshot_v1($1,$2,null,0,16,$3,$4,1) as value',
    [f.profile.workspace_id,admitted.project_id,f.profile.device_id,f.profile.client_id]);
   assert.equal(observed.value.state,'BLOCKED');assert.equal(observed.value.native_review_rejection.verdict,'REJECT');
   assert.equal(observed.value.native_review_rejection.writer_task_id,rejected.writer.scope.task_id);
   assert.equal(observed.value.native_review_rejection.critic_task_id,rejected.critic.scope.task_id);
   assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[rejected.writer.scope.task_id]))[0].state,'HELD');
   assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_commit_h205f22 where project_id=$1',[admitted.project_id]))[0].n,1);
   const [otherBranch]=await sql.unsafe('select destruktion_meta.native_coding_review_rejection_v1($1,$2) as value',[admitted.project_id,continued.children[0].task_id]);
   assert.equal(otherBranch.value,null);passed++;
  });
  await t.test('chat profile revocation cannot downgrade native handoff to a browser implementation',async()=>{
   const f=await fixture({chatLed:true}),g=await fixture({chatLed:true});
   const a=(await invoke(f)).receipt,b=(await invoke(g)).receipt;
   const read=(project,task)=>(sql.unsafe('select destruktion_meta.native_coding_chat_child_permit_v1($1,$2,$3) as value',[project,task,'IMPLEMENTER']));
   assert.equal((await read(a.project_id,b.root_task_id))[0].value,null);
   await sql.unsafe('update destruktion_meta.native_coding_seed_profile_h205f22 set revoked_at=clock_timestamp() where profile_id=$1',[f.profile.profile_id]);
   assert.equal((await read(a.project_id,a.root_task_id))[0].value,null);
   assert.equal((await count(f)).tasks,1);passed++;
  });
  await t.test('chat upgrade rejects unreviewed predecessor bodies without changing the live test schema',async()=>{
   await assert.rejects(sql.begin(async tx=>{
    await tx.unsafe(`create or replace function destruktion_meta.native_coding_chat_child_permit_v1(p_project uuid,p_task uuid,p_role text)
     returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$begin return null;end $$`);
    await tx.unsafe(chatUpgrade);
   }),/chat_coordination_native_coding_chat_child_permit_v1_requires_review/);
   for(const alteration of [
    'alter function destruktion_meta.native_coding_seed_profile_v1(uuid,boolean) set search_path=public',
    'alter function destruktion_meta.native_coding_seed_profile_v1(uuid,boolean) stable',
   ])await assert.rejects(sql.begin(async tx=>{await tx.unsafe(alteration);await tx.unsafe(capacityUpgrade);}),/native_agent_capacity_native_coding_seed_profile_v1_requires_review/);
   // Repeated installer order must attest the current chat validator, apply
   // the prior capacity upgrade, then restore chat mode in the SAME transaction.
   await sql.begin(async tx=>{await tx.unsafe(capacityUpgrade);await tx.unsafe(chatUpgrade);});
   const f=await fixture({chatLed:true}),receipt=(await invoke(f)).receipt;
   assert.equal((await sql.unsafe('select role from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[receipt.root_task_id]))[0].role,'PLANNER');passed++;
  });
  assert.equal(passed,25);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.initial-seed.disposable-qa.v1',state:'PASS',
   postgres_version_num:identity.version,postgres_system_identifier:cluster,port,subtests:passed,migration_sha256:migrationSha,
   source_classification:'REAL_DISPOSABLE_PG_AND_HOST_SERVICE_WITH_GENERATED_ENROLLED_DEVICE_INSTALLED_IMAGE_OS_CANARY_AND_ACL_FIXTURES',
   existing_w30_enqueue:true,existing_w30_lease:true,native_goal_correlation:true,browser_meta_activation_fabricated:false,
   actual_device_signer_and_pg_authentication:true,
   model_calls:0,installed_keeper_used:false,installed_autonomy_proven:false,windows_acl_qualified:false,authority_effect:false},null,2)+'\n');
 }finally{
  if(sql)await sql.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,
   postmaster_pid_file_absent:await fs.lstat(path.join(data,'postmaster.pid')).then(()=>false,e=>e.code==='ENOENT'),installed_keeper_used:false})+'\n');
  t.diagnostic('disposable_receipt_directory='+directory);
 }
});
