import {prepareNativeRepository} from './native-coding-repository-preparation.mjs';
import {assertNativeRepositoryPreparationGitPlan} from '../../apps/metaengine-browser/src/native-coding-repository-preparation-plan.mjs';
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
import {consumeNativeSetupJobDrain} from './native-coding-setup-job-drain.mjs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostIpcClient} from '../../apps/metaengine-browser/src/native-coding-host-ipc-client.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from './native-coding-preparation-transaction.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {createNativeCodingHostSetupService} from './native-coding-host-setup-service.mjs';
import {createNativeCodingSetupMaterializer} from './native-coding-setup-materializer.mjs';
import {createWorkspaceReservation} from '../../apps/metaengine-browser/src/workspace-manager.mjs';
import {createManagedTaskProjectSqliteJournal} from '../../apps/metaengine-browser/src/managed-task-project-sqlite-journal.mjs';
import {createShellFreeGitExecutor} from '../../apps/metaengine-browser/src/managed-task-project-runtime.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {createNativeCodingPhysicalCustody} from './native-coding-physical-custody.mjs';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('combined_setup_'+label+'_deadline')),7000);})]);}finally{clearTimeout(timer);}}
test('predescriptor setup uses actual current ADMIN/repository/PG authority without native execution readiness',{skip:!bin||!driver,timeout:180000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-setup-pg-'))),data=path.join(root,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('fixture PG command timeout'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture PG command failed '+name));});});
 let started=false,raw;const services=[],journals=[];
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
  const preparationSql=await fs.readFile(new URL('./native-coding-setup-preparation-v1.sql',import.meta.url),'utf8');
  await raw.begin(tx=>tx.unsafe(preparationSql));await raw.begin(tx=>tx.unsafe(preparationSql));
  const physicalSql=await fs.readFile(new URL('./native-coding-physical-custody-v1.sql',import.meta.url),'utf8');
  await raw.begin('isolation level serializable',tx=>tx.unsafe(physicalSql));
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
   return{directory,host,d,identity,workspace,pair,repo,managedRoot,call,input,discover,packet,get service(){return service;},get begins(){return beginCount;},lose:action=>{loseAction=action;},after:fn=>{afterAction=fn;},fail:action=>{failAction=action;},restart:(overrides={})=>{service.close();Object.assign(options,overrides);service=create();},create};
  }
  await t.test('signed ADMIN repository preparation records one real Git effect without inventing task or lease',async()=>{
   let result,workerError,creates=0;
   const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
   const f=await fixture({runJob:async scope=>{
    try{result=await prepareNativeRepository({scope,request:scope.preparationBinding,source:scope.preparationBinding.source,
     executePlan:async plan=>{
      assertNativeRepositoryPreparationGitPlan(plan);
      if(plan.effect==='REPOSITORY_PREPARE_LOCKED')creates++;
      const stdout=execFileSync('git',plan.argv,{cwd:plan.cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      return{code:0,stdout,stderr:''};
     }});return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}
    catch(error){workerError=error;throw error;}
   }});
   const git=args=>execFileSync('git',args,{cwd:f.repo,env,stdio:['ignore','pipe','pipe']});
   git(['init','-q']);await fs.writeFile(path.join(f.repo,'original.txt'),'ADMIN preparation fixture\n');git(['add','original.txt']);
   git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','source']);
   const observed=await readNativeCodingGitProof(f.repo,{env});
   const input={...await f.input(),preparation:{schema:'metaengine.native-coding.repository-preparation.v1',
    source:{head:observed.head,artifact_sha256:observed.artifact_sha256},choices:{worktree:'CREATE_LOCKED_OPERATION_WORKTREE',branch:'CREATE_OPERATION_BRANCH'}}};
   const packet=await f.packet('BEGIN_NATIVE_SETUP_V1',input),requestId=randomUUID();
   const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:f.host.instance_id,host_pid:f.host.host_pid,
    request_id:requestId,action:'BEGIN_NATIVE_SETUP_V1',payload:packet};
   const request=Object.freeze({instanceId:f.host.instance_id,hostPid:f.host.host_pid,requestId,requestDigest:sha(frame),
    action:'BEGIN_NATIVE_SETUP_V1',signal:new AbortController().signal,deadlineAt:Date.now()+60000});
   await f.service.operations.BEGIN_NATIVE_SETUP_V1(packet,request);await bounded(f.service.drain(),'admin_preparation');
   if(workerError)throw workerError;
   assert.equal(creates,1);assert.equal(result.state,'PROVEN');
   assert.equal(await fs.readFile(path.join(result.readback.worktree_path,'original.txt'),'utf8'),'ADMIN preparation fixture\n');
   const [row]=await raw.unsafe('select * from destruktion_meta.native_coding_setup_preparation_h205f22 where operation_id=$1',[input.operation_id]);
   assert.equal(row.state,'PROVEN');assert.equal(row.binding.original_request.requestDigest,sha(frame));
   assert.deepEqual(row.readback,result.readback);
   f.restart();const retained=await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(creates,1);
   assert.equal(retained.prepared,false);assert.equal(retained.execution_ready,false);
   await assert.rejects(raw.unsafe('delete from destruktion_meta.native_coding_setup_preparation_h205f22 where operation_id=$1',[input.operation_id]),/history_retained/);
   await assert.rejects(raw.unsafe("update destruktion_meta.native_coding_setup_preparation_h205f22 set state='RESERVED' where operation_id=$1",[input.operation_id]),/history_immutable/);
  });
  await t.test('preparation migration rejects modified function, widened ACL and partial schema without repairing it',async()=>{
   for(const mutation of [
    "grant select on destruktion_meta.native_coding_setup_preparation_h205f22 to public",
    "drop trigger native_setup_preparation_truncate_guard_v1 on destruktion_meta.native_coding_setup_preparation_h205f22",
    "alter table destruktion_meta.native_coding_setup_preparation_h205f22 add column unexpected text"
   ]){
    await assert.rejects(raw.begin(async tx=>{await tx.unsafe(mutation);await tx.unsafe(preparationSql);}),/requires_review|require_review/);
    await raw.begin(tx=>tx.unsafe(preparationSql));
   }
  });
  // Real disposable Git + FULL SQLite and real signed own-PG setup. Native
  // completion/Owner callbacks remain GENERATED and explicitly UNQUALIFIED.
  async function materializerFixture({physicalCustody=null,nativeFacet=true,join=async()=>{},finalize=async()=>{}}={}){
   let worker,originalScope,creates=0;const originalResults=new WeakMap(),joins=[],created=deferred();
   const f=await fixture({physicalCustody});
   const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
   const git=args=>execFileSync('git',args,{cwd:f.repo,env,stdio:['ignore','pipe','pipe']});
   git(['init','-q']);await fs.writeFile(path.join(f.repo,'source.txt'),'combined disposable source\n');git(['add','source.txt']);
   git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','source']);
   const sourceProof=await readNativeCodingGitProof(f.repo,{env}),claim={coordination_workspace_id:f.workspace,task_id:randomUUID(),claim_id:1,
    point_id:'setup.materialization',claim_class:'MUTATING',base_sha:sourceProof.head,branch_name:'work/setup-'+randomUUID(),agent_id:'agent_'+randomUUID(),
    tab_id:'tab_'+randomUUID(),target_id:'webcontents:7',agent_generation_epoch:1,lease_generation:1,lease_expires_at:new Date(Date.now()+600000).toISOString()};
   const binding=createWorkspaceReservation({claim,trusted_repo:{repo_id:'fixture:setup',repo_root:f.repo},workspace_root:f.managedRoot});
   const request={idempotency_key:'setup:'+randomUUID(),...Object.fromEntries(['coordination_workspace_id','task_id','agent_id','claim_id','lease_generation','workspace_id','workspace_generation'].map(key=>[key,binding[key]]))};
   const journal=createManagedTaskProjectSqliteJournal({filePath:path.join(f.directory,'combined-effects.sqlite')}),executor=createShellFreeGitExecutor();journals.push(journal);
   const executePlan=async(plan,options)=>{
    assert.equal(options.originalJob,originalScope);assert.throws(()=>originalScope.assertJobDrained(),/job_cleanup_unconfirmed/);
    assert.throws(()=>originalScope.assertJobResourcesDrained(),/job_.*unconfirmed/);
    const [activity]=await raw.unsafe("select count(*)::int as n from pg_stat_activity where datname=current_database() and state='idle in transaction'");assert.equal(activity.n,0);
    try{const value=await executor.execute(plan);originalResults.set(value,{plan,job:originalScope});if(plan.effect==='WORKTREE_CREATE_LOCKED'){creates++;created.resolve();}return value;}
    catch(error){originalResults.set(error,{plan,job:originalScope});throw error;}
   };
   if(nativeFacet)Object.defineProperty(executePlan,'joinOriginalDrain',{value:async(value,scope)=>{
    const owned=originalResults.get(value);assert.ok(owned);assert.equal(owned.job,scope);assert.equal(scope,originalScope);joins.push(owned.plan.effect);
    await join({scope,plan:owned.plan,value});
   }});
   worker=createNativeCodingSetupMaterializer({readAdmittedRequest:async scope=>{originalScope=scope;return{request,source:{head:sourceProof.head,artifact_sha256:sourceProof.artifact_sha256}};},
    resolveProjectBinding:async()=>({schema:'metaengine.devos.managed-project-admission.v1',authoritative:true,active:true,
     device_id:f.d.device_id,client_id:f.d.client_id,admin_grant_epoch:1,claim,workspace_binding:binding,authority_effect:false}),
    withOwnerCustody:async(_input,effect)=>effect(()=>{}),journal,reserveBinding:async()=>{},finalizeBinding:finalize,
    readSource:({repo_root,signal,originalJob})=>{assert.equal(originalJob,originalScope);return readNativeCodingGitProof(repo_root,{env,signal});},executePlan});
   f.restart({runJob:worker});
   return {...f,worker,binding,created:created.promise,joins,get service(){return f.service;},get begins(){return f.begins;},get scope(){return originalScope;},get creates(){return creates;}};
  }
  await t.test('no operator descriptor is needed for genuine current repo/PG/root discovery; BEGIN is unavailable not prepared',async()=>{
   const f=await fixture(),v=await f.discover();assert.equal(v.postgres.version>=170000,true);assert.equal(v.repository.repo_root,f.repo);
   assert.match(v.repo_root_identity_sha256,/^[a-f0-9]{64}$/);assert.equal(v.capabilities.materialization,false);assert.equal(v.execution_ready,false);
   const input=await f.input(),ack=await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(ack.state,'HOLD');assert.equal(ack.reason,'MATERIALIZATION_UNAVAILABLE');assert.equal(ack.prepared,false);assert.equal(ack.cleanup_state,'DRAINED');
   assert.deepEqual(await f.call('BEGIN_NATIVE_SETUP_V1',input),ack);assert.equal(f.begins,1);
  });
  await t.test('default setup with no actual materializer cannot issue job-drain ownership or publish a SETUP closure',async()=>{
   let seals=0;const f=await fixture({physicalCustody:{sealSetup:async()=>{seals++;}}}),input=await f.input();
   const ack=await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();
   assert.equal(ack.reason,'MATERIALIZATION_UNAVAILABLE');assert.equal(ack.prepared,false);assert.equal(seals,0);
  });
  await t.test('generic cleanup callbacks and forged materializer facets cannot publish setup origin custody',async()=>{
   let seals=0,forgedCalls=0;
   const forged=async()=>({cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'});
   forged.takeJobDrain=()=>{forgedCalls++;return Object.freeze({});};forged.consumeJobDrain=(_token,_scope,consume)=>{forgedCalls++;return consume({materialization_outcome:'UNKNOWN'});};
   const f=await fixture({runJob:forged,physicalCustody:{sealSetup:async()=>{seals++;}}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await bounded(f.service.drain(),'forged_native_facet');assert.equal(seals,0);assert.equal(forgedCalls,0);
   const done=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});assert.equal(done.prepared,false);assert.equal(done.execution_ready,false);
  });
  await t.test('actual Git/SQLite without an original native drain producer retains no origin publication capability',async()=>{
   let seals=0;const f=await materializerFixture({nativeFacet:false,physicalCustody:{sealSetup:async()=>{seals++;}}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await bounded(f.service.drain(),'unqualified_git_drain');
   assert.equal(f.creates,1);assert.equal(seals,0);assert.equal(f.worker.takeJobDrain(f.scope),null);assert.doesNotThrow(()=>f.scope.assertJobDrained());
   f.restart();await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(f.creates,1);assert.equal(seals,0);assert.equal(f.begins,1);
  });
  await t.test('actual Git materializer publishes one origin token after resource milestone and terminal readback while full job drain waits',async()=>{
   const nativeEntered=deferred(),nativeRelease=deferred(),published=deferred(),publicationRelease=deferred();let seals=0,descriptor,issued;
   const origin=Object.freeze({action:'BEGIN_NATIVE_SETUP_V1',requestId:randomUUID(),requestDigest:'a'.repeat(64),
    signal:new AbortController().signal,privateOriginal:()=>{}});
   const f=await materializerFixture({join:async({scope,plan})=>{if(plan.effect==='WORKTREE_CREATE_LOCKED'){nativeEntered.resolve(scope);await nativeRelease.promise;}},
    physicalCustody:{sealSetup:async token=>{
     seals++;issued=token;assert.equal(Object.isFrozen(token),true);assert.equal(Object.hasOwn(token,'operationId'),false);
     assert.throws(()=>JSON.stringify(token),/not_serializable/);assert.throws(()=>structuredClone(token));
     assert.throws(()=>consumeNativeSetupJobDrain({...token}),/original_job_drain_required/);
     descriptor=consumeNativeSetupJobDrain(token);assert.throws(()=>consumeNativeSetupJobDrain(token),/original_job_drain_required/);
     assert.doesNotThrow(()=>f.scope.assertJobResourcesDrained());assert.throws(()=>f.scope.assertJobDrained(),/job_cleanup_unconfirmed/);
     published.resolve();await publicationRelease.promise;
    }}}),input=await f.input();
   try{
    await f.call('BEGIN_NATIVE_SETUP_V1',input,origin);const scope=await bounded(nativeEntered.promise,'native_entry');
    assert.equal(seals,0);assert.throws(()=>scope.assertJobResourcesDrained(),/job_.*unconfirmed/);
    assert.equal((await f.call('CANCEL_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace})).state,'CANCEL_REQUESTED');
    assert.equal(scope.signal.aborted,true);await tick();assert.equal(seals,0,'requested cancellation is not actual native resource drain');
    nativeRelease.resolve();await bounded(published.promise,'origin_publication');
    let finished=false;const draining=f.service.drain().then(()=>{finished=true;});await tick();assert.equal(finished,false);
    assert.doesNotThrow(()=>scope.assertJobResourcesDrained());assert.throws(()=>scope.assertJobDrained(),/job_cleanup_unconfirmed/);
    publicationRelease.resolve();await bounded(draining,'full_drain');assert.doesNotThrow(()=>scope.assertJobDrained());
    assert.equal(seals,1);assert.equal(descriptor.request,origin);assert.equal(descriptor.operationId,input.operation_id);
    assert.equal(descriptor.hostInstanceId,f.host.instance_id);assert.equal(descriptor.hostPid,f.host.host_pid);
    assert.equal(descriptor.actor.device_id,f.d.device_id);assert.equal(descriptor.operation.custody_id,descriptor.custodyId);
    assert.equal(descriptor.operation.state,'STOPPED');assert.equal(descriptor.operation.cleanup_state,'DRAINED');assert.equal(descriptor.cancellation_requested,true);
    for(const field of ['readiness','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'])assert.equal(descriptor[field],false);
    assert.throws(()=>consumeNativeSetupJobDrain(issued),/original_job_drain_required/);assert.equal(f.creates,1);
   }finally{nativeRelease.resolve();publicationRelease.resolve();await bounded(f.service.drain().catch(()=>{}),'cleanup');}
  });
  await t.test('unconfirmed native resources or lost terminal ACK/readback prevent origin publication and cannot replay Git',async()=>{
   const {markNativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
   for(const phase of ['unconfirmed','terminal-ack','terminal-readback']){
    let seals=0;const f=await materializerFixture({join:async()=>{if(phase==='unconfirmed')markNativePhysicalSettlementUnconfirmed(Error('generated-owned-resource-hold'));},
     physicalCustody:{sealSetup:async()=>{seals++;}}}),input=await f.input();
    if(phase==='terminal-ack')f.lose('TERMINAL');
    if(phase==='terminal-readback')f.after(action=>{if(action==='TERMINAL')f.fail('READ');});
    await f.call('BEGIN_NATIVE_SETUP_V1',input);await bounded(f.service.drain().catch(()=>{}),'refused_origin');assert.equal(seals,0);assert.equal(f.creates,1);
    assert.equal(f.worker.takeJobDrain(f.scope),null);f.after(null);f.fail(null);
    await f.call('BEGIN_NATIVE_SETUP_V1',input);assert.equal(f.creates,1);assert.equal(f.begins,1);
   }
  });
  await t.test('setup ownership publication cannot swallow a physical uncertainty mark or turn it into a clean drain',async()=>{
   const {markNativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
   let consumed=0;const f=await materializerFixture({physicalCustody:{sealSetup:async token=>{consumeNativeSetupJobDrain(token);consumed++;
     markNativePhysicalSettlementUnconfirmed(Error('generated-owned-publication-hold'));}}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);assert.equal(consumed,1);
   assert.equal(f.service.snapshot().active_jobs,1);
  });
  await t.test('unconsumed setup job ownership expires after its original publication attempt and cannot be readopted',async()=>{
   let token;const f=await materializerFixture({physicalCustody:{sealSetup:async value=>{token=value;}}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();assert.ok(token);
   assert.throws(()=>consumeNativeSetupJobDrain(token),/original_job_drain_required/);
  });
  await t.test('late native output and cancellation completion hold the original setup through service close and full shutdown',async()=>{
   const entered=deferred(),outputs=deferred(),cancelled=deferred();let seals=0;
   const f=await materializerFixture({join:async({plan})=>{if(plan.effect==='WORKTREE_CREATE_LOCKED'){entered.resolve();await outputs.promise;await cancelled.promise;}},
    physicalCustody:{sealSetup:async token=>{consumeNativeSetupJobDrain(token);seals++;}}}),input=await f.input();
   try{
    await f.call('BEGIN_NATIVE_SETUP_V1',input);await bounded(entered.promise,'late_native_entry');f.service.close();
    let finished=false;const draining=f.service.drain().then(()=>{finished=true;});await tick();assert.equal(finished,false);assert.equal(seals,0);
    assert.equal(f.scope.signal.aborted,true);assert.throws(()=>f.scope.assertJobResourcesDrained(),/job_.*unconfirmed/);assert.throws(()=>f.scope.assertJobDrained(),/job_cleanup_unconfirmed/);
    outputs.resolve();await tick();assert.equal(finished,false);assert.equal(seals,0);cancelled.resolve();await bounded(draining,'late_native_full_drain');
    assert.equal(f.creates,1);assert.equal(f.service.snapshot().active_jobs,0);assert.doesNotThrow(()=>f.scope.assertJobDrained());
   }finally{outputs.resolve();cancelled.resolve();await bounded(f.service.drain().catch(()=>{}),'late_native_cleanup');}
  });
  await t.test('actual signed setup service hands its opaque joined job token to the real durable writer while historical authority remains HOLD',async()=>{
   const entered=deferred(),gate=deferred();let physical,issued,ack;
   const f=await materializerFixture({join:async({scope,plan})=>{if(plan.effect==='WORKTREE_CREATE_LOCKED'){entered.resolve(scope);await gate.promise;}},
    physicalCustody:{sealSetup:token=>{assert.doesNotThrow(()=>f.scope.assertJobResourcesDrained());assert.throws(()=>f.scope.assertJobDrained(),/job_cleanup_unconfirmed/);issued=token;return physical.sealSetup(token).then(value=>{ack=value;return value;});}}});
   const [birth]=await raw.unsafe(`select to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
   const processProof=(pid,stamp)=>({pid,created_at:new Date(stamp).toISOString(),
    process_incarnation_id:`pid:${pid}:created_100ns:${(BigInt(stamp)+11644473600000n)*10000n}`});
   // Native/process observations are generated; SQL, enrolled signature, setup
   // job ownership, token consumption and durable closure writes are actual.
   const stamp=Date.now(),host=processProof(f.host.host_pid,stamp),main=processProof(f.host.host_pid+10000,stamp-1000);
   const postgres={system_identifier:pgIdentity.system_identifier,data_directory_identity_sha256:await readDirectoryIdentity(data),
    postmaster:processProof(pgIdentity.pid,Date.parse(birth.started_at))};
   physical=createNativeCodingPhysicalCustody({sql,hostInstanceId:f.host.instance_id,hostPid:f.host.host_pid,
    postgresIdentity:{...pgIdentity,started_at:birth.started_at},readNativeScope:async()=>({host_process:main,postgres}),
    readPublicationHost:async()=>host});services.push(physical);
   const input=await f.input(),packet=await f.packet('BEGIN_NATIVE_SETUP_V1',input),requestId=randomUUID();
   const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:f.host.instance_id,host_pid:f.host.host_pid,
    request_id:requestId,action:'BEGIN_NATIVE_SETUP_V1',payload:packet};
   const origin=Object.freeze({instanceId:f.host.instance_id,hostPid:f.host.host_pid,requestId,requestDigest:sha(frame),
    action:'BEGIN_NATIVE_SETUP_V1',signal:new AbortController().signal,deadlineAt:Date.now()+60000});
   const ticket=await physical.beginRequest(frame);
   assert.equal((await f.service.operations.BEGIN_NATIVE_SETUP_V1(packet,origin)).state,'RUNNING');await physical.endRequest(ticket);
   const running=await bounded(entered.promise,'physical_native_entry');assert.equal(issued,undefined);
   f.lose('CANCEL');await assert.rejects(f.call('CANCEL_NATIVE_SETUP_V1',{operation_id:input.operation_id,workspace_id:f.workspace}),/ACK lost/);assert.equal(running.signal.aborted,true);
   gate.resolve();await bounded(f.service.drain(),'physical_full_drain');await physical.drain();
   assert.ok(issued);assert.equal(ack.state,'SOURCE_GRAPH_CANDIDATE');assert.equal(ack.historical_resolution,'HOLD');assert.equal(ack.readiness,false);
   const [stored]=await raw.unsafe("select closure from destruktion_meta.native_coding_physical_closure_h205f22 where kind='SETUP' and key=$1",[input.operation_id]);
   assert.equal(stored.closure.request_id,requestId);assert.equal(stored.closure.request_sha256,sha(frame));
   assert.equal(stored.closure.operation.state,'STOPPED');assert.equal(stored.closure.operation.reason,'CANCELLED');
   assert.equal(stored.closure.operation.cleanup_state,'DRAINED');assert.equal(stored.closure.automatic_retry_allowed,false);
   assert.throws(()=>physical.sealSetup(issued),/original_job_drain_required/);
   assert.equal(await physical.verifyObservation({actor:{device_id:f.d.device_id},evidence:{resolved:[stored.closure]}}),0);
   const [cache]=await raw.unsafe('select count(*)::int as n from destruktion_meta.native_coding_physical_resolution_h205f22 where device_id=$1::uuid',[f.d.device_id]);
   assert.equal(f.creates,1);assert.equal(f.begins,1);assert.doesNotThrow(()=>f.scope.assertJobDrained());assert.equal(cache.n,0);assert.equal(physical.snapshot().historical_resolution,'HOLD');assert.equal(physical.snapshot().readiness,false);
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
  await t.test('private cold-job scope retains exact immutable operation, actor and custody identities',async()=>{
   let observed;const f=await fixture({runJob:async scope=>{observed=scope;assert.throws(()=>scope.assertJobDrained(),/job_cleanup_unconfirmed/);return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();
   const [row]=await raw.unsafe('select intent,custody_id from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);
   assert.equal(observed.operation_id,input.operation_id);assert.equal(observed.custody_id,row.custody_id);assert.deepEqual(observed.input,input);assert.deepEqual(observed.actor,row.intent.actor);
   for(const value of [observed,observed.input,observed.actor,observed.observation,observed.observation.repository,observed.observation.postgres,observed.observation.postgres.postmaster])assert.equal(Object.isFrozen(value),true);
   assert.throws(()=>{observed.input.operation_id=randomUUID();},TypeError);assert.throws(()=>{observed.actor.admin_grant_epoch=999;},TypeError);
   assert.throws(()=>{observed.observation.repository.repo_root='/untrusted';},TypeError);
   assert.doesNotThrow(()=>observed.assertJobDrained());
  });
  await t.test('real own-PG setup hands off to existing Git materializer with no long SQL transaction; native admission/Owner remain fixtures',async()=>{
   let worker,originalScope,creates=0;const f=await fixture({runJob:scope=>worker(scope)});
   const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
   const git=args=>execFileSync('git',args,{cwd:f.repo,env,stdio:['ignore','pipe','pipe']});
   git(['init','-q']);await fs.writeFile(path.join(f.repo,'source.txt'),'disposable source\n');git(['add','source.txt']);
   git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','source']);
   const source=await readNativeCodingGitProof(f.repo,{env}),claim={coordination_workspace_id:f.workspace,task_id:randomUUID(),claim_id:1,
    point_id:'setup.materialization',claim_class:'MUTATING',base_sha:source.head,branch_name:'work/setup-'+randomUUID(),agent_id:'agent_'+randomUUID(),
    tab_id:'tab_'+randomUUID(),target_id:'webcontents:7',agent_generation_epoch:1,lease_generation:1,lease_expires_at:new Date(Date.now()+600000).toISOString()};
   const binding=createWorkspaceReservation({claim,trusted_repo:{repo_id:'fixture:setup',repo_root:f.repo},workspace_root:f.managedRoot});
   const request={idempotency_key:'setup:'+randomUUID(),...Object.fromEntries(['coordination_workspace_id','task_id','agent_id','claim_id','lease_generation','workspace_id','workspace_generation'].map(key=>[key,binding[key]]))};
   const journal=createManagedTaskProjectSqliteJournal({filePath:path.join(f.directory,'effects.sqlite')}),executor=createShellFreeGitExecutor();
   try{
    worker=createNativeCodingSetupMaterializer({readAdmittedRequest:async scope=>{originalScope=scope;return{request,source:{head:source.head,artifact_sha256:source.artifact_sha256}};},
     resolveProjectBinding:async()=>({schema:'metaengine.devos.managed-project-admission.v1',authoritative:true,active:true,
      device_id:f.d.device_id,client_id:f.d.client_id,admin_grant_epoch:1,claim,workspace_binding:binding,authority_effect:false}),
     withOwnerCustody:async(_input,effect)=>effect(()=>{}),journal,reserveBinding:async()=>{},finalizeBinding:async()=>{},
     readSource:({repo_root,signal})=>readNativeCodingGitProof(repo_root,{env,signal}),executePlan:async plan=>{
      const [activity]=await raw.unsafe("select count(*)::int as n from pg_stat_activity where datname=current_database() and state='idle in transaction'");
      assert.equal(activity.n,0);assert.throws(()=>originalScope.assertJobDrained(),/job_cleanup_unconfirmed/);
      if(plan.effect==='WORKTREE_CREATE_LOCKED')creates++;return executor.execute(plan);
     }});
    const input=await f.input();await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();
    assert.equal(creates,1);assert.equal(await fs.readFile(path.join(binding.worktree_path,'source.txt'),'utf8'),'disposable source\n');
    const done=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});
    assert.equal(done.state,'HOLD');assert.equal(done.reason,'EVIDENCE_REQUIRED');assert.equal(done.cleanup_state,'DRAINED');assert.equal(done.prepared,false);
    assert.doesNotThrow(()=>originalScope.assertJobDrained());
    assert.equal(worker.takeJobDrain(originalScope),null,'SQL DRAINED plus a genuine worktree cannot replace the absent native completed-job producer');
    f.restart();assert.deepEqual(await f.call('BEGIN_NATIVE_SETUP_V1',input),done);assert.equal(creates,1);assert.equal(f.begins,1);
   }finally{await journal.close();}
  });
  for(const failure of ['lost_ack','before_sql'])await t.test('authenticated CANCEL '+failure+' aborts a signal-only worker and joins original custody',async()=>{
   const entered=deferred(),release=deferred();let signal,calls=0;
   const f=await fixture({runJob:async scope=>{calls++;signal=scope.signal;entered.resolve();await Promise.race([release.promise,new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});})]);return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   const [before]=await raw.unsafe('select intent,custody_id from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);
   if(failure==='lost_ack')f.lose('CANCEL');else f.fail('CANCEL');
   try{
    await assert.rejects(f.call('CANCEL_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id}),failure==='lost_ack'?/ACK lost/:/before terminal dispatch/);
    assert.equal(signal.aborted,true,'local authorized cancellation must not depend on a SQL acknowledgement');
   }finally{release.resolve();await f.service.drain();}
   const [after]=await raw.unsafe('select intent,custody_id,state,reason,cleanup_state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);
   assert.deepEqual(after.intent,before.intent);assert.equal(after.custody_id,before.custody_id);assert.equal(after.state,'STOPPED');assert.equal(after.reason,'CANCELLED');assert.equal(after.cleanup_state,'DRAINED');
   assert.equal((await f.call('BEGIN_NATIVE_SETUP_V1',input)).state,'STOPPED');assert.equal(calls,1);assert.equal(f.begins,1);
  });
  await t.test('another authenticated actor cannot abort the original local setup custody',async()=>{
   const entered=deferred(),release=deferred();let signal;
   const f=await fixture({runJob:async scope=>{signal=scope.signal;entered.resolve();await release.promise;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),g=await fixture(),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   try{
    const packet=await g.packet('CANCEL_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});
    await assert.rejects(f.service.operations.CANCEL_NATIVE_SETUP_V1(packet));assert.equal(signal.aborted,false);
    await assert.rejects(f.call('CANCEL_NATIVE_SETUP_V1',{workspace_id:g.workspace,operation_id:input.operation_id}));assert.equal(signal.aborted,false);
   }finally{release.resolve();await f.service.drain();}
  });
  await t.test('changed preflight roots before producer entry publish JOB_FAILED with unused custody drained',async()=>{
   let calls=0;const f=await fixture({runJob:async()=>{calls++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   f.after(async action=>{if(action==='CLAIM'){await fs.rename(f.managedRoot,f.managedRoot+'-retained');await fs.mkdir(f.managedRoot);}});
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await f.service.drain();assert.equal(calls,0);assert.equal(f.service.snapshot().active_jobs,0);
   const [row]=await raw.unsafe('select state,reason,cleanup_state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);
   assert.deepEqual(row,{state:'HOLD',reason:'JOB_FAILED',cleanup_state:'DRAINED'});
   const read=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});assert.equal(read.reason,'JOB_FAILED');assert.equal(read.prepared,false);
  });
  await t.test('pre-entry fallback retains original SQL connection-loss cleanup HOLD',async()=>{
   const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
   const entered=deferred(),release=deferred();let f,calls=0,seals=0,terminals=0,killStarted=false,terminalFault;
   const observed=new Proxy(sql,{get(target,key){if(key!=='begin')return target[key];return async(mode,body)=>{
    let action;
    try{
     const result=await sql.begin(mode,tx=>body({...tx,unsafe:async(q,args)=>{
      if(q.includes('native_coding_setup_operation_v1'))action=args[0];
      const lose=action==='TERMINAL'&&++terminals===1;
      const value=await tx.unsafe(q,args);
      // Test-only connection loss on this disposable fixture's exact reservation.
      if(lose){entered.resolve();await release.promise;killStarted=true;await tx.unsafe('select pg_terminate_backend(pg_backend_pid())');}
      return value;
     }}));
     // Change the canonical root only after the original CLAIM has committed.
     if(action==='CLAIM'){await fs.rename(f.managedRoot,f.managedRoot+'-retained');await fs.mkdir(f.managedRoot);}
     return result;
    }catch(error){if(action==='TERMINAL')terminalFault=error;throw error;}
   };}});
   f=await fixture({sql:observed,runJob:async()=>{calls++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};},
    physicalCustody:{sealSetup:async()=>{seals++;}}});const input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);
   let settled=false;const joined=f.service.drain();joined.then(()=>{settled=true;},()=>{settled=true;});
   try{
    await bounded(entered.promise,'fallback_terminal_entry');
    await tick();assert.equal(settled,false,'drain must join the original fallback SQL');
   }finally{
    release.resolve();
    await assert.rejects(bounded(joined,'fallback_connection_loss'),/cleanup_unconfirmed/);
   }
   assert.equal(killStarted,true);
   assert.equal(nativePhysicalSettlementUnconfirmed(terminalFault),true,'original transaction monitor must mark its exact backend loss');
   const [row]=await raw.unsafe('select state,cleanup_state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);
   assert.deepEqual(row,{state:'RUNNING',cleanup_state:'HOLD'});
   const read=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});
   assert.equal(read.state,'HOLD');assert.equal(read.reason,'CLEANUP_UNCONFIRMED');assert.equal(read.cleanup_state,'HOLD');
   assert.equal(read.prepared,false);assert.equal(read.execution_ready,false);assert.equal(read.production_qualified,false);assert.equal(read.automatic_retry_allowed,false);assert.equal(read.authority_effect,false);
   await assert.rejects(bounded(f.service.drain(),'fallback_retained_drain'),/cleanup_unconfirmed/);
   assert.deepEqual(f.service.snapshot(),{active_jobs:1,pending_handoffs:0,active_requests:0,closed:false,authority_effect:false});
   assert.equal(terminals,1);assert.equal(calls,0);assert.equal(seals,0);
  });
  await t.test('cancelled preflight never enters producer and settles only its unused physical custody',async()=>{
   const entered=deferred(),release=deferred();let reads=0,calls=0;
   const f=await fixture({readRootIdentity:async root=>{if(++reads===4){entered.resolve();await release.promise;}return readDirectoryIdentity(root);},runJob:async()=>{calls++;return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   // Reset after input discovery: BEGIN uses three reads, then block only the
   // actual post-CLAIM preflight, never admission.
   reads=0;
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await entered.promise;
   try{await f.call('CANCEL_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});}finally{release.resolve();}
   await f.service.drain();assert.equal(calls,0);assert.equal(f.service.snapshot().active_jobs,0);
   const [row]=await raw.unsafe('select state,reason,cleanup_state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);assert.deepEqual(row,{state:'STOPPED',reason:'CANCELLED',cleanup_state:'DRAINED'});
  });
  await t.test('producer rejection after entry remains physical HOLD without synthesizing a drained terminal',async()=>{
   const f=await fixture({runJob:async()=>{throw Error('fixture producer outcome unknown');}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);assert.equal(f.service.snapshot().active_jobs,1);
   const [row]=await raw.unsafe('select state,cleanup_state from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=$1',[input.operation_id]);assert.deepEqual(row,{state:'RUNNING',cleanup_state:'HOLD'});
   const read=await f.call('READ_NATIVE_SETUP_V1',{workspace_id:f.workspace,operation_id:input.operation_id});assert.equal(read.reason,'CLEANUP_UNCONFIRMED');assert.equal(read.cleanup_state,'HOLD');
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
   let originalScope;const f=await fixture({runJob:async scope=>{originalScope=scope;try{throw markNativePhysicalSettlementUnconfirmed(Error('fixture unconfirmed resource'));}catch{}return{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};}}),input=await f.input();
   await f.call('BEGIN_NATIVE_SETUP_V1',input);await assert.rejects(f.service.drain(),/cleanup_unconfirmed/);
   assert.throws(()=>originalScope.assertJobDrained(),/job_cleanup_unconfirmed/);
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
  for(const s of services)s.close();for(const journal of journals)await journal.close();if(raw)await raw.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await fs.rm(root,{recursive:true,force:true});
 }
});
