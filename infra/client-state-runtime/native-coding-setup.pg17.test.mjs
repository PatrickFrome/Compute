import {normalizeDraftScopeObservation} from '../../apps/me2-ui/src/lib/draft-scope.mjs';
import {createGoalDraftStore} from '../../apps/me2-ui/src/lib/goal-draft.mjs';
import {readClientDraftScope} from '../../apps/metaengine-browser/src/client-draft-scope.mjs';
import {readLoadedClientNativeSetupRoute} from '../../apps/metaengine-browser/src/client-native-setup-route.mjs';
// REAL disposable own-PG17 + enrolled ES256 packets + actual temporary directory
// identities. Private cold-job callbacks are fixtures, NOT native Windows proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync,fork} from 'node:child_process';
import {configureManagedTaskProjectRepository,readManagedTaskProjectRepository} from '../../apps/metaengine-browser/src/managed-task-project-repository.mjs';
import {MANAGED_TASK_PROJECT_DIRECTORY_NAME} from '../../apps/metaengine-browser/src/managed-task-project-storage.mjs';
import {readClientNativeSetupRoute} from '../../apps/metaengine-browser/src/client-native-setup-route.mjs';
import {readClientGoalSubmissionMode} from '../../apps/metaengine-browser/src/client-native-coding-goal.mjs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostIpcClient} from '../../apps/metaengine-browser/src/native-coding-host-ipc-client.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from './native-coding-preparation-transaction.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import {createNativeCodingHostSetupService} from './native-coding-host-setup-service.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
test('predescriptor setup uses actual current ADMIN/repository/PG authority without native execution readiness',{skip:!bin||!driver,timeout:180000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-setup-pg-'))),data=path.join(root,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('fixture PG command timeout'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture PG command failed '+name));});});
 let started=false,raw;const services=[];
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");started=true;
  await command('pg_ctl',['-D',data,'-l',path.join(root,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default,monitor=createNativePreparationTransactions();
  raw=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,debug:monitor.debug,onclose:monitor.onclose,onnotice:()=>{},connection:{statement_timeout:10000,lock_timeout:1000}});
  const sql=bindNativeCodingTransactionPool(raw,monitor);
  const [pgIdentity]=await raw.unsafe("select current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,inet_server_port() as port,pg_postmaster_start_time() as started_at,(select system_identifier::text from pg_control_system()) as system_identifier");
  pgIdentity.pid=Number((await fs.readFile(path.join(data,'postmaster.pid'),'utf8')).split(/\r?\n/)[0]);
  const pgContinuity=await runtimeRecoveryPostgresProof({identity:pgIdentity,pgDataDirectory:data});
  await raw.unsafe(`create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;create schema destruktion_meta;
   create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
    active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
    admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text);
   create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);`);
  const source=name=>fs.readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
  const history=await source('20261010100000_project_continuity_history_v1.sql');
  // Exact shipped authority function, not a fake always-ADMIN fixture.
  await raw.unsafe(history.slice(history.indexOf('create function destruktion_meta.project_device_grant_h205f22('),history.indexOf('create function destruktion_meta.project_authorize_h205f22(')));
  const managed=await source('20261009194157_managed_project_admission_v1.sql');
  await raw.unsafe(managed.slice(0,managed.indexOf('create or replace function destruktion_meta.a2_managed_project_admission_read_h205f22')));
  const migration=await fs.readFile(new URL('./native-coding-setup-operation-v1.sql',import.meta.url),'utf8');await raw.begin(tx=>tx.unsafe(migration));await raw.begin(tx=>tx.unsafe(migration));
  async function fixture(options={}){
   const directory=await fs.mkdtemp(path.join(root,'scope-')),repo=options.repositoryRoot||path.join(directory,'repo'),managedRoot=path.join(directory,'managed');await fs.mkdir(repo);await fs.mkdir(managedRoot);
   const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});await identity.ensure();await identity.bindDevice(randomUUID());
   const d=identity.snapshot(),workspace=randomUUID(),pair=randomUUID();
   await raw.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pair]);
   await raw.unsafe('insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)values($1,$2,$3,$4::text::jsonb,$5,$6)',[d.device_id,d.client_id,d.profile,JSON.stringify(d.public_jwk),d.key_fingerprint_sha256,pair]);
   await raw.unsafe('select public.h205f22_a2_managed_project_repository_provision_v1($1,$2,$3,1,$4,$5,$6)',[workspace,d.device_id,d.client_id,'fixture:setup',repo,managedRoot]);
   const host={instance_id:randomUUID(),host_pid:process.pid};let beginCount=0,loseAction=null,afterAction=null,failAction=null;
   const observed=new Proxy(sql,{get(target,key){if(key!=='begin')return target[key];return(mode,body)=>sql.begin(mode,async tx=>{
    let action;const result=await body({...tx,unsafe:async(q,args)=>{if(q.includes('native_coding_setup_operation_v1'))action=args[0];if(action===failAction)throw Error('fixture before terminal dispatch');return tx.unsafe(q,args);}});
    if(action==='BEGIN')beginCount++;return{action,result};
   }).then(async({action,result})=>{if(action&&afterAction)await afterAction(action);if(action===loseAction){loseAction=null;throw Error('fixture ACK lost after committed '+action);}return result;});}});
   let service;const create=(binding=host)=>{const x=createNativeCodingHostSetupService({sql:observed,hostInstanceId:binding.instance_id,hostPid:binding.host_pid,pgDataDirectory:data,postgresIdentity:pgIdentity,postgresContinuity:pgContinuity,...options});services.push(x);return x;};service=create();
   const packet=(action,input)=>signNativeCodingDeviceRequest({identity,binding:host,operation:action,input});
   const call=async(action,input={workspace_id:workspace},request)=>service.operations[action](await packet(action,input),request);
   const discover=()=>call('DISCOVER_NATIVE_SETUP_V1');
   const input=async()=>{const v=await discover();return{operation_id:randomUUID(),workspace_id:workspace,...Object.fromEntries(['repository_scope_sha256','repo_root_identity_sha256','managed_root_identity_sha256'].map(k=>[k,v[k]]))};};
   return{directory,host,d,identity,workspace,pair,repo,managedRoot,call,input,discover,packet,get service(){return service;},get begins(){return beginCount;},lose:action=>{loseAction=action;},after:fn=>{afterAction=fn;},fail:action=>{failAction=action;},restart:()=>{service.close();service=create();},create};
  }
  await t.test('no operator descriptor is needed for genuine current repo/PG/root discovery; BEGIN is unavailable not prepared',async()=>{
   const f=await fixture(),v=await f.discover();assert.equal(v.postgres.version>=170000,true);assert.equal(v.repository.repo_root,f.repo);
   assert.match(v.repo_root_identity_sha256,/^[a-f0-9]{64}$/);assert.equal(v.capabilities.materialization,false);assert.equal(v.execution_ready,false);
   const input=await f.input(),ack=await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(ack.state,'HOLD');assert.equal(ack.reason,'MATERIALIZATION_UNAVAILABLE');assert.equal(ack.prepared,false);assert.equal(ack.cleanup_state,'DRAINED');
   assert.deepEqual(await f.call('BEGIN_NATIVE_SETUP_V1',input),ack);assert.equal(f.begins,1);
  });
  await t.test('admission counts pending custody handoffs and retires drained jobs without limiting durable operation history',async()=>{
   const entered=deferred(),gate=deferred(),f=await fixture({readAdmission:()=>({schema:'metaengine.agent-resource-admission.v1',physical_start_allowed:true,physical_parallelism:1})});
   const first=await f.input(),second=await f.input();f.after(async action=>{if(action==='BEGIN'){entered.resolve();await gate.promise;}});
   const pending=f.call('BEGIN_NATIVE_SETUP_V1',first);await entered.promise;assert.equal(f.service.snapshot().pending_handoffs,1);
   try{await assert.rejects(f.call('BEGIN_NATIVE_SETUP_V1',second),/physical_admission_hold/);assert.equal(f.begins,1);}
   finally{gate.resolve();await pending;f.after(null);}
   await f.call('BEGIN_NATIVE_SETUP_V1',second);assert.equal(f.service.snapshot().pending_handoffs,0);assert.equal(f.service.snapshot().active_jobs,0);
   const [count]=await raw.unsafe("select count(*)::int as n from destruktion_meta.native_coding_setup_operation_h205f22 where intent->>'workspace_id'=$1",[f.workspace]);assert.equal(count.n,2);
  });
  await t.test('foreign workspace/device, revoked ADMIN/pairing and changed root identities never insert an intent',async()=>{
   const f=await fixture(),g=await fixture(),input=await f.input();
   await assert.rejects(g.call('DISCOVER_NATIVE_SETUP_V1',{workspace_id:f.workspace}));
   await assert.rejects(f.call('BEGIN_NATIVE_SETUP_V1',{...input,repo_root_identity_sha256:'f'.repeat(64)}),/discovery_changed/);
   await raw.unsafe("update public.compute_fabric_a2_browser_device_h205f22 set access_tier='USER' where device_id=$1",[f.d.device_id]);await assert.rejects(f.discover(),/current_device_unavailable/);
   await raw.unsafe("update public.compute_fabric_a2_browser_device_h205f22 set access_tier='ADMIN' where device_id=$1",[f.d.device_id]);await raw.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[f.pair]);await assert.rejects(f.discover());assert.equal(f.begins,0);
  });
  for(const action of ['BEGIN','CLAIM'])await t.test('lost '+action+' COMMIT acknowledgement retains identity and never starts/replays job',async()=>{
   let effects=0;const f=await fixture({runJob:async()=>{effects++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();f.lose(action);
   await assert.rejects(f.call('BEGIN_NATIVE_SETUP_V1',input),/ACK lost/);assert.equal(effects,0);assert.equal(f.service.snapshot().active_jobs,0);
   assert.equal((await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace})).state,'HOLD');
   f.restart();assert.equal((await f.call('BEGIN_NATIVE_SETUP_V1',input)).state,'HOLD');assert.equal(effects,0);assert.equal(f.begins,1);
  });
  await t.test('shutdown after ledger COMMIT but before registry handoff cannot ACK or restart an unowned job',async()=>{
   let effects=0;const f=await fixture({runJob:async()=>{effects++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();f.after(action=>{if(action==='BEGIN')f.service.close();});
   await assert.rejects(f.call('BEGIN_NATIVE_SETUP_V1',input),/closed/);assert.equal(effects,0);f.after(null);f.restart();assert.equal((await f.call('BEGIN_NATIVE_SETUP_V1',input)).state,'HOLD');assert.equal(f.begins,1);
  });
  await t.test('accepted cold fixture job holds no SQL transaction; CANCEL is requested until callback physically returns',async()=>{
   const gate=deferred(),entered=deferred();let signal;
   const f=await fixture({runJob:async scope=>{signal=scope.signal;entered.resolve();await gate.promise;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   const ack=await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(ack.state,'RUNNING');await entered.promise;
   const active=await raw.unsafe("select count(*)::int as n from pg_stat_activity where datname=current_database() and state='idle in transaction'");assert.equal(active[0].n,0);
   const cancellation=await f.call('CANCEL_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(cancellation.state,'CANCEL_REQUESTED');assert.equal(signal.aborted,true);assert.equal(cancellation.cleanup_state,'HOLD');
   let drained=false;const pending=f.service.drain().then(()=>{drained=true;});await tick();assert.equal(drained,false);gate.resolve();await pending;
   const done=await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(done.state,'STOPPED');assert.equal(done.prepared,false);assert.equal(done.materialization_outcome,'UNKNOWN');
  });
  await t.test('lost CANCEL commit acknowledgement still fences the next job effect through durable current state',async()=>{
   const gate=deferred(),entered=deferred();let effects=0;
   const f=await fixture({runJob:async scope=>{entered.resolve();await gate.promise;try{await scope.revalidate();effects++;}catch{}return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;f.lose('CANCEL');
   await assert.rejects(f.call('CANCEL_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id}),/ACK lost/);
   gate.resolve();await f.service.drain();assert.equal(effects,0);
   const read=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});assert.equal(read.state,'STOPPED');assert.equal(read.cancellation_requested,true);
  });
  await t.test('current grant is rechecked before a later fixture effect, not an expired request boolean',async()=>{
   const gate=deferred(),entered=deferred();let effects=0;
   const f=await fixture({runJob:async scope=>{entered.resolve();await gate.promise;try{await scope.revalidate();effects++;}catch{}return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   await raw.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.d.device_id]);gate.resolve();await f.service.drain();assert.equal(effects,0);
   await assert.rejects(f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace}));
  });
  await t.test('failed physical cleanup remains held and cannot be erased by CANCEL or shutdown promise',async()=>{
   const f=await fixture({runJob:async()=>({cleanup_confirmed:false,reason:'EVIDENCE_REQUIRED'})}),input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);
   const c=await f.call('CANCEL_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(c.cleanup_state,'HOLD');f.service.close();await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);
  });
  await t.test('post-CLAIM close before job start leaves no fake running custody and never invokes producer',async()=>{
   let calls=0;const f=await fixture({runJob:async()=>{calls++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();f.after(action=>{if(action==='CLAIM')f.service.close();});
   await assert.rejects(f.call('BEGIN_NATIVE_SETUP_V1',input),/closed/);assert.equal(calls,0);assert.equal(f.service.snapshot().active_jobs,0);f.after(null);f.restart();
   assert.equal((await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace})).state,'HOLD');assert.equal((await f.call('BEGIN_NATIVE_SETUP_V1',input)).state,'HOLD');assert.equal(calls,0);
  });
  await t.test('swallowed private physical HOLD cannot be cleared by a producer cleanup boolean',async()=>{
   const {markNativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
   const f=await fixture({runJob:async()=>{try{throw markNativePhysicalSettlementUnconfirmed(Error('fixture unconfirmed resource'));}catch{}return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);
   const read=await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(read.state,'HOLD');assert.equal(read.reason,'CLEANUP_UNCONFIRMED');assert.equal(f.service.snapshot().active_jobs,1);
  });
  await t.test('terminal publication failure after physical drain is durable HOLD, never stale local RUNNING',async()=>{
   const f=await fixture({runJob:async()=>({cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'})}),input=await f.input();
   f.after(action=>{if(action==='TERMINAL')throw Error('fixture terminal ACK lost');});await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();assert.equal(f.service.snapshot().active_jobs,0);
   const read=await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(read.state,'HOLD');assert.equal(read.prepared,false);
  });
  await t.test('failed terminal SQL before commit retires physically drained job but projects durable stale RUNNING as HOLD',async()=>{
   const f=await fixture({runJob:async()=>({cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'})}),input=await f.input();f.fail('TERMINAL');
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();assert.equal(f.service.snapshot().active_jobs,0);
   const [row]=await raw.unsafe('select state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);assert.equal(row.state,'RUNNING');
   const read=await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(read.state,'HOLD');assert.equal(read.reason,'CUSTODY_UNCONFIRMED');
  });
  await t.test('terminal SQL private HOLD survives successful producer physical drain',async()=>{
   const {markNativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
   const f=await fixture({runJob:async()=>({cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'})}),input=await f.input();
   f.after(action=>{if(action==='TERMINAL')throw markNativePhysicalSettlementUnconfirmed(Error('fixture terminal physical HOLD'));});
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);assert.equal(f.service.snapshot().active_jobs,1);
   const read=await f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace});assert.equal(read.reason,'CLEANUP_UNCONFIRMED');assert.equal(read.cleanup_state,'HOLD');
  });
  await t.test('nested canonical roots of a distinct workspace cannot overlap a retained physical operation',async()=>{
   const gate=deferred(),entered=deferred(),f=await fixture({runJob:async()=>{entered.resolve();await gate.promise;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   try{const g=await fixture({repositoryRoot:path.join(f.managedRoot,'nested')}),other=await g.input();await assert.rejects(g.call('BEGIN_NATIVE_SETUP_V1',other));assert.equal(g.service.snapshot().active_jobs,0);}
   finally{gate.resolve();await f.service.drain();}
  });
  await t.test('migration refuses widened ACL, altered body/schema or partial install instead of repairing it',async()=>{
   const bodyTamper=migration.slice(migration.indexOf('create or replace function destruktion_meta.native_coding_setup_operation_v1(')).replace("inserted boolean:=false;","inserted boolean:=true;");
   for(const change of [bodyTamper,
    'grant execute on function destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb) to service_role',
    'alter function destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb) stable',
    'alter table destruktion_meta.native_coding_setup_operation_h205f22 add column forged text',
    'grant select on destruktion_meta.native_coding_setup_operation_h205f22 to service_role',
    'alter table destruktion_meta.native_coding_setup_operation_h205f22 disable row level security',
    'drop function destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb)',
    'drop table destruktion_meta.native_coding_setup_operation_h205f22 cascade',
   ])await assert.rejects(raw.begin(async tx=>{await tx.unsafe(change);await tx.unsafe(migration);}),/native_setup_.*(?:requires_review|require_review|partial_install)/);
   await raw.begin(tx=>tx.unsafe(migration));
  });
  await t.test('SQL lexical overlap refuses volume/share roots, trailing separators and Windows case/mixed-separator aliases',async()=>{
   const f=await fixture(),g=await fixture();
   async function original(scope){const input=await scope.input();await scope.call('BEGIN_NATIVE_SETUP_V1',input);const [row]=await raw.unsafe('select intent from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);return row.intent;}
   const a=await original(f),b=await original(g);
   const insert=async(tx,intent,repo,managed)=>{
    const next={...intent,operation_id:randomUUID(),repository:{...intent.repository,repo_root:repo,managed_root:managed}};
    await tx.unsafe('update public.compute_fabric_a2_managed_project_repository_h205f22 set repo_root=$2,managed_root=$3 where coordination_workspace_id=$1',[intent.workspace_id,repo,managed]);
    return tx.unsafe("select destruktion_meta.native_coding_setup_operation_v1('BEGIN',$1::text::jsonb,$2::text::jsonb,'{}')",[JSON.stringify(next.actor),JSON.stringify(next)]);
   };
   for(const rootPath of ['/','C:\\','c:/','//server/share/'])await assert.rejects(raw.begin(tx=>insert(tx,a,rootPath,'D:\\managed')),/repository_roots_invalid/);
   for(const [rootA,rootB] of [['C:\\Repo','c:/repo/nested/'],['C:\\Repo\\','c:/REPO/nested'],['C:\\Repo\\nested','c:/repo/'],['/case/Repo','/CASE/repo/nested']])
    await assert.rejects(raw.begin(async tx=>{await insert(tx,a,rootA,'D:\\managed');await insert(tx,b,rootB,'E:\\managed');}),/physical_scope_held/);
  });
  for(const loseAck of [false,true])await t.test(`actual setup-only child IPC: BEGIN custody handoff settles before cold job; lost ACK=${loseAck} is read-only`,async()=>{
   const f=await fixture(),script=path.join(f.directory,'setup-child.mjs'),instanceId=randomUUID();
   const imported=file=>JSON.stringify(new URL(file,import.meta.url).href);
   await fs.writeFile(script,`
import postgres from ${JSON.stringify(pathToFileURL(driver).href)};
import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from ${imported('./native-coding-preparation-transaction.mjs')};
import {createNativeCodingHostSetupService} from ${imported('./native-coding-host-setup-service.mjs')};
import {createNativeCodingHostIpcServer} from ${imported('./native-coding-host-ipc.mjs')};
const monitor=createNativePreparationTransactions(),raw=postgres({host:'127.0.0.1',port:${port},user:'state_owner',database:'postgres',max:4,debug:monitor.debug,onclose:monitor.onclose,onnotice:()=>{}});
let release;const gate=new Promise(r=>{release=r;});let calls=0,lost=false;
const setup=createNativeCodingHostSetupService({sql:bindNativeCodingTransactionPool(raw,monitor),hostInstanceId:${JSON.stringify(instanceId)},hostPid:process.pid,pgDataDirectory:${JSON.stringify(data)},postgresIdentity:${JSON.stringify(pgIdentity)},postgresContinuity:${JSON.stringify(pgContinuity)},
 runJob:async()=>{calls++;process.send({test:'entered'});await gate;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}});
let rejected=0;
for(const operations of [{...setup.operations,SEED_GOAL:async()=>({})},{...setup.operations,READ_SCOPE:async()=>({})},Object.fromEntries(Object.entries(setup.operations).filter(([k])=>k!=='CANCEL_NATIVE_SETUP_V1'))]){
 try{createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations});}catch(error){if(error.reason==='INVALID_PAYLOAD')rejected++;else throw error;}
}
if(rejected!==3)throw Error('fixture setup-only mount was broadened');
const server=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations:setup.operations,send:(frame,cb)=>{
 if(${loseAck}&&!lost&&frame.schema==='metaengine.native-coding.host-ipc.response.v1'&&frame.action==='BEGIN_NATIVE_SETUP_V1'){lost=true;cb?.();return;}
 process.send(frame,cb);
}});
process.on('message',async message=>{
 if(message.test==='stats'){process.send({test:'stats',calls,...setup.snapshot()});return;}
 if(message.test==='stop'){setup.close();release();await setup.drain();server.close();await raw.end();process.disconnect();return;}
 server.handleMessage(message);
});
process.send({test:'ready'});
`);
   const child=fork(script,[],{stdio:['ignore','ignore','pipe','ipc']});let client;
   const receive=kind=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.off('message',onMessage);reject(Error('fixture child event timeout '+kind));},5000);
    const onMessage=value=>{if(value?.test===kind){clearTimeout(timeout);child.off('message',onMessage);resolve(value);}};child.on('message',onMessage);});
   try{
    await receive('ready');client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs:500});
    const binding={instance_id:instanceId,host_pid:child.pid},sign=(operation,input)=>signNativeCodingDeviceRequest({identity:f.identity,binding,operation,input});
    const input=await f.input(),entered=receive('entered'),request=await sign('BEGIN_NATIVE_SETUP_V1',input);
    if(loseAck)await assert.rejects(client.beginNativeSetup(request),e=>e.reason==='REQUEST_TIMEOUT'&&e.effect_outcome==='UNKNOWN');
    else assert.equal((await client.beginNativeSetup(request)).state,'RUNNING');
    await entered;assert.equal((await client.drainPhysical()).cleanup_confirmed,true,'short IPC handoff is settled, NOT the job');
    const stats=receive('stats');child.send({test:'stats'});const row=await stats;assert.equal(row.active_jobs,1);assert.equal(row.calls,1);
    assert.equal((await client.readNativeSetup(await sign('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id}))).state,'RUNNING');
    assert.equal((await client.beginNativeSetup(await sign('BEGIN_NATIVE_SETUP_V1',input))).state,'RUNNING');
    await assert.rejects(client.readScope(),e=>e.reason==='UNSUPPORTED_ACTION');
    const again=receive('stats');child.send({test:'stats'});assert.equal((await again).calls,1);await client.drainPhysical();
   }finally{
    client?.close();const exit=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));if(child.connected)child.send({test:'stop'});else child.kill();await exit;
   }
  });
  await t.test('BEGIN then removed protected repository config and missing descriptors stays HOLD, never silent Browser',async()=>{
   const f=await fixture();execFileSync('git',['init','--initial-branch=fixture',f.repo],{stdio:'ignore'});
   execFileSync('git',['-C',f.repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','TEST fixture'],{stdio:'ignore'});
   await fs.chmod(f.managedRoot,0o700);
   await configureManagedTaskProjectRepository({userDataPath:f.directory,repository:{schema:'metaengine.devos.managed-project-repository-config.v1',coordination_workspace_id:f.workspace,repo_id:'fixture:setup',repo_root:f.repo,managed_root:f.managedRoot}});
   const readNativeSetupRoute=async()=>readClientNativeSetupRoute({repository:await readManagedTaskProjectRepository({userDataPath:f.directory}),identity:f.identity,
    capability:{snapshot:()=>f.host,readNativeSetupRoute:packet=>f.service.operations.READ_NATIVE_SETUP_ROUTE_V1(packet)}});
   const mode=()=>readClientGoalSubmissionMode({readSummary:()=>({status_file:path.join(f.directory,'status.json')}),readNativeSetupRoute});
   assert.equal((await mode()).kind,'BROWSER');const input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal((await mode()).state,'HOLD');
   await fs.unlink(path.join(f.directory,MANAGED_TASK_PROJECT_DIRECTORY_NAME,'repository.json'));assert.equal((await mode()).state,'HOLD');
   assert.equal((await readNativeSetupRoute()).scope_resolved,false);
   await raw.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set active=false where device_id=$1',[f.d.device_id]);
   assert.equal((await mode()).reason,'NATIVE_SETUP_ROUTE_UNAVAILABLE');
  });
  await t.test('route absence is current-device/workspace scoped; grant/key/Host rotation does not erase retained intent',async()=>{
   const f=await fixture(),g=await fixture(),input=await f.input(),route=workspace_id=>f.call('READ_NATIVE_SETUP_ROUTE_V1',{workspace_id});
   assert.equal((await route(null)).retained_intent,false);await f.call('BEGIN_NATIVE_SETUP_V1',input);
   assert.equal((await g.call('READ_NATIVE_SETUP_ROUTE_V1',{workspace_id:null})).retained_intent,false);
   await assert.rejects(g.call('READ_NATIVE_SETUP_ROUTE_V1',{workspace_id:f.workspace}));
   const other=randomUUID();await raw.unsafe('select public.h205f22_a2_managed_project_repository_provision_v1($1,$2,$3,1,$4,$5,$6)',[other,f.d.device_id,f.d.client_id,'fixture:other',g.repo,g.managedRoot]);
   assert.equal((await route(other)).retained_intent,false);assert.equal((await route(f.workspace)).retained_intent,true);
   await raw.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[f.d.device_id]);
   assert.equal((await route(null)).retained_intent,true);await assert.rejects(route(f.workspace),/repository_denied/);
   await raw.unsafe('update public.compute_fabric_a2_managed_project_repository_h205f22 set admin_grant_epoch=2 where coordination_workspace_id=$1',[f.workspace]);
   assert.equal((await route(f.workspace)).retained_intent,true);
   // TEST-only key rotation keeps the real client/device, with a new ES256 key.
   const state=JSON.parse(await fs.readFile(path.join(g.directory,'identity.json'),'utf8'));state.client_id=f.d.client_id;state.device_id=f.d.device_id;
   const rotatedFile=path.join(f.directory,'rotated-identity.json');await fs.writeFile(rotatedFile,JSON.stringify(state),{mode:0o600});
   const rotated=new SupervisorDeviceIdentity({statePath:rotatedFile,secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});await rotated.ensure();
   await raw.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set public_jwk=$2::text::jsonb,key_fingerprint_sha256=$3 where device_id=$1',[f.d.device_id,JSON.stringify(rotated.snapshot().public_jwk),rotated.snapshot().key_fingerprint_sha256]);
   await assert.rejects(route(null));const nextHost={instance_id:randomUUID(),host_pid:process.pid},next=f.create(nextHost);
   const packet=await signNativeCodingDeviceRequest({identity:rotated,binding:nextHost,operation:'READ_NATIVE_SETUP_ROUTE_V1',input:{workspace_id:f.workspace}});
   assert.equal((await next.operations.READ_NATIVE_SETUP_ROUTE_V1(packet)).retained_intent,true);
  });
  await t.test('draft namespace uses genuine current signed PG scope before preparation and performs zero ensure/persistence',async()=>{
   const f=await fixture(),input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input); // retained setup HOLD is not draft identity failure.
   const repository={schema:'metaengine.devos.managed-project-repository-config.v1',coordination_workspace_id:f.workspace,repo_id:'fixture:setup',repo_root:f.repo,managed_root:f.managedRoot};
   const bytes=await fs.readFile(path.join(f.directory,'identity.json'));let ensureCalls=0;f.identity.ensure=()=>{ensureCalls++;throw Error('ensure forbidden');};
   const read=()=>readClientDraftScope({identity:f.identity,readRepository:async()=>repository,
    readVerifiedRoute:({identity,repository,assertCurrent})=>readLoadedClientNativeSetupRoute({identity,repository,assertOpen:assertCurrent,
     capability:{snapshot:()=>f.host,readNativeSetupRoute:packet=>f.service.operations.READ_NATIVE_SETUP_ROUTE_V1(packet)}})});
   const requestedAt=Date.now(),ready=await read();assert.equal(ready.state,'READY');assert.equal(ready.scope.workspace_id,f.workspace);assert.equal(ready.scope.project_id,null);
   // Actual ES256/current own-PG producer crosses the SAME normalizer/store used
   // by the production Page. Storage is a disposable fixture, not installed UI.
   const presented=normalizeDraftScopeObservation(ready,{requestedAt,now:Date.now()});assert.equal(presented.state,'READY');
   const records=new Map(),storage=()=>({getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)});
   const first=createGoalDraftStore(presented.scope,{storage});first.subscribe(()=>{})();first.write('Real PG-bound draft, never submitted');
   const reloaded=createGoalDraftStore(presented.scope,{storage});reloaded.subscribe(()=>{})();assert.equal(reloaded.getSnapshot().text,'Real PG-bound draft, never submitted');
   assert.ok(!JSON.stringify(ready).includes(f.d.device_id));assert.ok(!JSON.stringify(ready).includes(f.repo));assert.equal(ensureCalls,0);
   await raw.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[f.pair]);
   const revokedAt=Date.now(),revoked=await read();assert.equal(revoked.state,'UNKNOWN');assert.equal(normalizeDraftScopeObservation(revoked,{requestedAt:revokedAt,now:Date.now()}).scope,null);assert.equal(ensureCalls,0);assert.deepEqual(await fs.readFile(path.join(f.directory,'identity.json')),bytes);
  });
  await t.test('same-cluster PG restart invalidates bound postmaster despite unchanged system ID and data root',async()=>{
   const gate=deferred(),entered=deferred();let effects=0;const f=await fixture({runJob:async scope=>{entered.resolve();await gate.promise;try{await scope.revalidate();effects++;}catch{}return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}});
   const before=await f.discover(),input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   await command('pg_ctl',['-D',data,'-m','fast','-w','restart']);
   const [after]=await raw.unsafe('select system_identifier::text as system_identifier from pg_control_system()');assert.equal(after.system_identifier,before.postgres.system_identifier);
   await assert.rejects(f.discover(),/postgres_changed/);await assert.rejects(f.call('READ_NATIVE_SETUP_ROUTE_V1',{workspace_id:null}),/postgres_changed/);gate.resolve();await f.service.drain();assert.equal(effects,0);
   await assert.rejects(f.call('READ_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace}),/postgres_changed/);
  });
 }finally{
  for(const s of services)s.close();if(raw)await raw.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await fs.rm(root,{recursive:true,force:true});
 }
});
