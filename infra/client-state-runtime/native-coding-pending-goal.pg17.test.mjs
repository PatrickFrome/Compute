import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {generatedStage} from './test/native-workspace-preparation-fixture.mjs';
import {createNativeWorkspacePreparation} from './native-coding-workspace-preparation.mjs';
import {createNativePreparationTransactions} from './native-coding-preparation-transaction.mjs';
import {readNativeWorkspaceStage,NATIVE_WORKSPACE_STAGE} from '../../apps/metaengine-browser/src/native-coding-workspace-preparation.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const source=name=>fs.readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
const migration='20261025110000_native_coding_initial_goal_seed_v1.sql';
const hash=text=>createHash('sha256').update(text).digest('hex');
test('native PG17 prepared goal remains durably nonrunnable through signed admission and recovery', {skip:!bin||!driver,timeout:180000},async t=>{
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-goal-pg-'))),data=path.join(directory,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('fixture command timeout'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture command failed '+name));});});
 let started=false,sql,migrationSha;
 const disposables=[];
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");started=true;
  await command('pg_ctl',['-D',data,'-l',path.join(directory,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default,monitor=createNativePreparationTransactions();
  sql=postgres({debug:monitor.debug,onclose:monitor.onclose,host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connection:{statement_timeout:15000,lock_timeout:5000}});
  assert.equal(Math.floor(Number((await sql.unsafe("select current_setting('server_version_num') as value"))[0].value)/10000),17);
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

  const suspended=await source('20261026020000_browser_parent_suspension_v1.sql');
  await sql.unsafe(suspended.slice(suspended.indexOf('alter table destruktion_meta.devos_fleet_task_h205f22 drop constraint'),suspended.indexOf('create function destruktion_meta.browser_parent_suspension_projection_v1')));
  const managed=await source('20261009194157_managed_project_admission_v1.sql');
  await sql.unsafe(managed.slice(0,managed.indexOf('create or replace function destruktion_meta.a2_managed_project_admission_read_h205f22')));
  const pendingSql=await fs.readFile(new URL('./native-coding-pending-goal-v1.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(pendingSql));await sql.begin(tx=>tx.unsafe(pendingSql));
  async function fixture(){
   const root=await fs.realpath(await fs.mkdtemp(path.join(directory,'scope-'))),c=generatedStage();
   c.postgres.system_identifier=(await sql.unsafe('select system_identifier::text as value from pg_control_system()'))[0].value;
   const identity=new SupervisorDeviceIdentity({statePath:path.join(root,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});
   await identity.ensure();await identity.bindDevice(randomUUID());const d=identity.snapshot(),pair=randomUUID();
   await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values($1)',[pair]);
   await sql.unsafe('insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash) values($1,$2,$3,$4::text::jsonb,$5,$6)',[d.device_id,d.client_id,d.profile,JSON.stringify(d.public_jwk),d.key_fingerprint_sha256,pair]);
   await sql.unsafe('select public.h205f22_a2_managed_project_repository_provision_v1($1,$2,$3,$4,$5,$6,$7)',[c.workspace_id,d.device_id,d.client_id,1,c.repo_id,c.repo_root,c.managed_root]);
   await sql.unsafe('insert into public.qa_native_environment values($1,true)',[c.workspace_id]);
   await fs.writeFile(path.join(root,NATIVE_WORKSPACE_STAGE),JSON.stringify(c));const verifyStorage=async()=>({owner_dacl_verified:true});
   const selector=(await readNativeWorkspaceStage(root,{verifyStorage})).input,host={instance_id:randomUUID(),host_pid:process.pid};
   const verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:host.instance_id,hostPid:host.host_pid}),context=createNativeCodingAuthenticatedRequestContext({verifier});
   let observations=0,failObserve=false,loseCommit=false,observeHook=async()=>{};
   const readNativeScope=async p=>{observations++;await observeHook();if(failObserve)throw Error('generated_observation_failed');
    return{artifact:c.artifact,postgres:c.postgres,user_sid:c.user_sid,worktree:p.worktree,sandbox:p.sandbox,host_process:c.postgres.postmaster};};
   const options={transaction:async(mode,body)=>{const value=await monitor.transaction(sql,mode,body);if(loseCommit)throw Error('generated_commit_reply_lost');return value;},stateDirectory:root,readCurrentDevice:context.readCurrentDevice,readNativeScope,verifyStorage,
    readRootIdentity:async p=>p===c.repo_root?c.repo_root_identity_sha256:p===c.managed_root?c.managed_root_identity_sha256:'a'.repeat(64)};
   let service=createNativeWorkspacePreparation(options);
   const call=async(action,input=goal,requestContext)=>context.run(action,await signNativeCodingDeviceRequest({identity,binding:host,operation:action,input}),v=>service[action](v,requestContext));
   const goal={...selector,request_id:randomUUID(),objective:'Implement the user requested reliable project restart without duplicate work'};
   disposables.push(()=>{service.close();context.close();verifier.close();});
   return{root,c,d,pair,selector,goal,call,observations:()=>observations,observeControl:fn=>{observeHook=fn;},fail:()=>{failObserve=true;},lose:v=>{loseCommit=v;},restart:()=>{service.close();service=createNativeWorkspacePreparation(options);}};
  }
  const f=await fixture();
  await t.test('actual user objective requires signed PREPARED workspace, startup creates no project',async()=>{
   await assert.rejects(f.call('ADMIT_PREPARED_GOAL_V1'),/goal_preparation_required/);
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.project_run_h205f22'))[0].count),0);
   await f.call('PREPARE_WORKSPACE_V1',f.selector);
   assert.equal((await f.call('READ_PREPARED_GOAL_V1')).state,'NOT_STARTED');
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.project_run_h205f22'))[0].count),0);
  });
  let receipt;
  await t.test('initial insert BLOCKED/PAUSED is atomic and creates zero permits or claims',async()=>{
   const result=await f.call('ADMIT_PREPARED_GOAL_V1');receipt=result.admission;
   assert.equal(result.state,'PENDING_ACTIVATION');assert.equal(receipt.objective,f.goal.objective);assert.equal(receipt.execution_ready,false);
   const [row]=await sql.unsafe('select t.state as task_state,p.state as project_state,t.lease_generation from destruktion_meta.devos_fleet_task_h205f22 t join destruktion_meta.project_run_h205f22 p on p.root_task_id=t.task_id where t.task_id=$1',[receipt.root_task_id]);
   assert.deepEqual({...row,lease_generation:Number(row.lease_generation)},{task_state:'BLOCKED',project_state:'PAUSED',lease_generation:0});
   for(const table of ['native_coding_operator_permit_h205f22','devos_fleet_claim_h205f22','native_coding_seed_h205f22'])assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.'+table))[0].count),0);
  });
  await t.test('restart and repeated write invocation only read immutable existing admission',async()=>{
   const n=f.observations();f.restart();assert.deepEqual((await f.call('READ_PREPARED_GOAL_V1')).admission,receipt);
   assert.deepEqual((await f.call('ADMIT_PREPARED_GOAL_V1')).admission,receipt);assert.equal(f.observations(),n);
   await assert.rejects(f.call('READ_PREPARED_GOAL_V1',{...f.goal,objective:'different objective'}),/goal_intent_conflict/);
   await assert.rejects(f.call('ADMIT_PREPARED_GOAL_V1',{...f.goal,request_id:randomUUID()}),/goal_intent_conflict/);
  });
  await t.test('ordinary resume and role/target changes cannot release or rebind pending task',async()=>{
   for(const expr of ["state='READY'","state='LEASED'","role='IMPLEMENTER'","lease_target_id='codex-cli:generated'","task_spec='{}'::jsonb","lease_generation=1"])
    await assert.rejects(sql.unsafe('update destruktion_meta.devos_fleet_task_h205f22 set '+expr+' where task_id=$1',[receipt.root_task_id]),/native_pending_goal_activation_required/);
   await assert.rejects(sql.unsafe("update destruktion_meta.project_run_h205f22 set state='ACTIVE' where project_id=$1",[receipt.project_id]),/native_pending_goal_activation_required/);
   await assert.rejects(sql.unsafe('delete from destruktion_meta.native_coding_pending_goal_h205f22 where request_id=$1',[f.goal.request_id]),/binding_immutable/);
   await assert.rejects(sql.unsafe('update destruktion_meta.project_run_h205f22 set root_task_id=$2 where project_id=$1',[receipt.project_id,randomUUID()]),/activation_required/);
  });
  await t.test('claim fence refuses both chat and CLI targets independently of task role',async()=>{
   for(const target of ['chat:generated','codex-cli:generated'])await assert.rejects(sql.unsafe(`insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at)
    select task_id,workspace_id,point_id,base_sha,role,claim_class,'generated','generated',$2,1,1,clock_timestamp()+interval '1 minute' from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1`,[receipt.root_task_id,target]),/native_pending_goal_claim_forbidden/);
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.devos_fleet_claim_h205f22'))[0].count),0);
  });
  await t.test('generic enqueue cannot manufacture runnable pending children through any continuity pointer',async()=>{
   for(const [field,value] of [['project_id',receipt.project_id],['root_task_id',receipt.root_task_id],['parent_task_id',receipt.root_task_id],['root_request_id',f.goal.request_id]]){
    const spec={objective:'generated forbidden child',project_continuity:{[field]:value}};
    await assert.rejects(sql.unsafe('select public.devos_fleet_enqueue_v1($1,$2,$3,$4,$5::text::jsonb,$6)',
     [f.c.workspace_id,'generated.child','PLANNER','a'.repeat(40),JSON.stringify(spec),'generated:'+randomUUID()]),/native_pending_goal_child_forbidden/);
   }
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.devos_fleet_task_h205f22 where workspace_id=$1',[f.c.workspace_id]))[0].count),1);
   const normal=(await sql.unsafe('select public.devos_fleet_enqueue_v1($1,$2,$3,$4,$5::text::jsonb,$6) as result',
    [randomUUID(),'unrelated.goal','PLANNER','a'.repeat(40),JSON.stringify({objective:'Unrelated legacy task'}),'generated:'+randomUUID()]))[0].result;
   assert.equal(normal.accepted,true);
   for(const field of ['root_task_id','parent_task_id'])await assert.rejects(sql.unsafe(`insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth)
    values($1,$2,1,$3,$4,0)`,[normal.task_id,randomUUID(),field==='root_task_id'?receipt.root_task_id:normal.task_id,field==='parent_task_id'?receipt.root_task_id:null]),/native_pending_goal_child_forbidden/);
   await assert.rejects(sql.unsafe(`insert into destruktion_meta.project_child_proposal_h205f22(project_id,request_id,child_index,request_sha256,parent_task_id,depth,role,objective,status)
    values($1,$2,0,$3,$4,1,'PLANNER','generated','BUDGET_WAIT')`,[receipt.project_id,randomUUID(),'a'.repeat(64),receipt.root_task_id]),/native_pending_goal_child_forbidden/);
  });
  await t.test('cross-kind request identity and SQL malformed input cannot create another project',async()=>{
   await assert.rejects(sql.unsafe('insert into destruktion_meta.client_v1_goal_request_h205f22(request_id) values($1)',[f.goal.request_id]),/native_pending_goal_request_collision/);
   await assert.rejects(sql.unsafe('insert into destruktion_meta.native_coding_seed_h205f22(request_id) values($1)',[f.goal.request_id]),/native_pending_goal_request_collision/);
   const prep=JSON.parse(await fs.readFile(path.join(f.root,'native-coding-workspace-preparation-intent-v1.json'),'utf8'));
   for(const input of [null,{}, {...f.goal,objective:null},{...f.goal,objective:42},{...f.goal,owner_epoch:1}])await assert.rejects(sql.begin('isolation level serializable',tx=>tx.unsafe(
    'select destruktion_meta.native_coding_pending_goal_v1($1::text::jsonb,$2::text::jsonb,$3::text::jsonb,false)',[JSON.stringify(input),JSON.stringify(f.c),JSON.stringify(prep)])));
  });
  await t.test('guarded reapplication refuses changed functions, disabled triggers, partial installs and relation drift',async()=>{
   const cases=[
    ['drop table destruktion_meta.native_coding_pending_goal_h205f22',/partial_install/],
    ["create or replace function destruktion_meta.native_coding_pending_goal_fence_v1() returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$begin return NEW;end$$",/function_requires_review/],
    ['alter table destruktion_meta.devos_fleet_claim_h205f22 disable trigger aa_native_pending_goal_fence_trg',/trigger_requires_review/],
    ['drop trigger aa_native_pending_goal_fence_trg on destruktion_meta.project_task_h205f22',/partial_install/],
    ['alter table destruktion_meta.native_coding_pending_goal_h205f22 add column extra text',/table_requires_review/],
    ['grant select on destruktion_meta.native_coding_pending_goal_h205f22 to seed_api',/table_authority_requires_review/],
    ['grant select(input) on destruktion_meta.native_coding_pending_goal_h205f22 to seed_api',/table_authority_requires_review/],
    ['grant execute on function destruktion_meta.native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean) to seed_api',/function_requires_review/],
    ["create or replace trigger aa_native_pending_goal_fence_trg before update of state or insert on destruktion_meta.devos_fleet_claim_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1()",/trigger_requires_review/],
    ['alter table destruktion_meta.native_coding_pending_goal_h205f22 disable row level security',/table_authority_requires_review/],
    ['alter table destruktion_meta.native_coding_pending_goal_h205f22 drop constraint native_coding_pending_goal_h205f22_preparation_id_key',/constraints_require_review/],
   ];
   for(const [change,pattern] of cases)await assert.rejects(sql.begin(async tx=>{await tx.unsafe(change);await tx.unsafe(pendingSql);}),pattern);
   await sql.begin(tx=>tx.unsafe(pendingSql));
  });
  await t.test('lost commit acknowledgement reads same project without automatic mutation replay',async()=>{
   const g=await fixture();await g.call('PREPARE_WORKSPACE_V1',g.selector);g.lose(true);
   await assert.rejects(g.call('ADMIT_PREPARED_GOAL_V1'),/commit_reply_lost/);g.lose(false);g.restart();
   const n=g.observations(),read=await g.call('READ_PREPARED_GOAL_V1');assert.equal(read.state,'PENDING_ACTIVATION');
   assert.deepEqual((await g.call('ADMIT_PREPARED_GOAL_V1')).admission,read.admission);assert.equal(g.observations(),n);
  });
  await t.test('failure after dispatch intent preserves unknown and never retries physical or SQL writes',async()=>{
   const g=await fixture();await g.call('PREPARE_WORKSPACE_V1',g.selector);g.fail();
   await assert.rejects(g.call('ADMIT_PREPARED_GOAL_V1'),/observation_failed/);const n=g.observations();g.restart();
   assert.equal((await g.call('READ_PREPARED_GOAL_V1')).state,'READBACK_REQUIRED');assert.equal((await g.call('ADMIT_PREPARED_GOAL_V1')).state,'READBACK_REQUIRED');assert.equal(g.observations(),n);
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.project_run_h205f22 where workspace_id=$1',[g.c.workspace_id]))[0].count),0);
  });
  await t.test('cancellation after intent joins observation and retains a nonretryable absent SQL outcome',async()=>{
   const g=await fixture();await g.call('PREPARE_WORKSPACE_V1',g.selector);
   let entered,release;const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
   g.observeControl(async()=>{entered();await gate;});const abort=new AbortController();
   const pending=g.call('ADMIT_PREPARED_GOAL_V1',g.goal,{signal:abort.signal});pending.catch(()=>{});await ready;
   abort.abort();release();await assert.rejects(pending,/cancel|abort|closed/i);
   const n=g.observations();g.restart();assert.equal((await g.call('READ_PREPARED_GOAL_V1')).state,'READBACK_REQUIRED');assert.equal(g.observations(),n);
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.project_run_h205f22 where workspace_id=$1',[g.c.workspace_id]))[0].count),0);
  });
  await t.test('concurrent signed requests cannot duplicate the same preparation or its physical admission',async()=>{
   const g=await fixture();await g.call('PREPARE_WORKSPACE_V1',g.selector);const before=g.observations();
   const results=await Promise.allSettled([g.call('ADMIT_PREPARED_GOAL_V1'),g.call('ADMIT_PREPARED_GOAL_V1')]);
   assert(results.some(r=>r.status==='fulfilled'&&r.value.state==='PENDING_ACTIVATION'));
   assert.equal(g.observations()-before,2);assert.equal((await g.call('READ_PREPARED_GOAL_V1')).state,'PENDING_ACTIVATION');
   assert.equal(Number((await sql.unsafe('select count(*) from destruktion_meta.project_run_h205f22 where workspace_id=$1',[g.c.workspace_id]))[0].count),1);
  });
  await t.test('revoked current pairing cannot read old receipt as authority',async()=>{
   await sql.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[f.pair]);
   await assert.rejects(f.call('READ_PREPARED_GOAL_V1'),/current_device_unavailable/);
  });
 }finally{
  for(const close of disposables)close();if(sql)await sql.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await fs.rm(directory,{recursive:true,force:true});
 }
});
