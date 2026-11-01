import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {provisionLocalApiLogin} from './db-api-grants.mjs';
import {inspectAttachedApiAdmission} from './attached-postgres-onboarding.mjs';
import {startupFilesDigest} from './startup-source-manifest.mjs';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool,bindNativeCodingPublicationTransactionPool} from './native-coding-preparation-transaction.mjs';
import {nativePhysicalSettlementUnconfirmed,markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const LOGIN='generated_host_schema_api',SECRET='GENERATED_ONLY_SCHEMA_PRIVATE_SENTINEL';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>Promise.withResolvers();
async function within(promise,milliseconds=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('generated_host_schema_wait_timeout')),milliseconds);})]);}finally{clearTimeout(timer);}}
async function until(read,accept){const deadline=Date.now()+15000;for(;;){const value=await read();if(accept(value))return value;if(Date.now()>=deadline)throw Error('generated_host_schema_wait_timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const finite=new Set(['CHECKING','MATCHED_SCHEMA_ONLY','SCHEMA_HOLD','RUNTIME_CONTINUITY_HOLD','UNSUPPORTED_PROFILE','CLEANUP_HOLD','CLOSED_SCHEMA_ONLY']);
function diagnosis(value){assert.deepEqual(Object.keys(value).sort(),['schema','state','execution_admitted','authority_effect'].sort());
 assert.equal(value.schema,'metaengine.native-coding.installed-schema-diagnosis.v1');assert.ok(finite.has(value.state));assert.equal(value.execution_admitted,false);assert.equal(value.authority_effect,false);}
function minimal(host){
 for(const name of ['DISCOVER_NATIVE_SETUP_V1','BEGIN_NATIVE_SETUP_V1','READ_NATIVE_SETUP_V1','CANCEL_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1','READ_NATIVE_CAPACITY_V1'])assert.equal(typeof host.nativeCodingAuthority[name],'function');
 for(const name of ['RESERVE_EXECUTION','READ_SCOPE','SEED_GOAL','ACTIVATE_PREPARED_GOAL_V1','SERVICE_HEARTBEAT','SERVICE_HEARTBEAT_V2'])assert.equal(host.nativeCodingAuthority[name],undefined);
 assert.equal(host.descriptor.authority_effect,false);
}

// Real startManagedRuntimeHost, real registered PG17 and restricted API session.
// Only source/runtime launch hooks are generated; they confer no native/Windows
// qualification. The module resolver instruments the actual postgres.js driver,
// never replaces the schema verifier, and never returns fabricated catalog rows.
test('Host schema-only diagnosis with actual registered disposable PG17 preserves minimum service and owned cleanup',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const postgres=(await import(pathToFileURL(driver))).default;
 const hostURL=new URL('./runtime-host.mjs?generated-schema-diagnosis-pg17',import.meta.url).href;
 const stub='data:text/javascript,'+encodeURIComponent('let factory; export function setFactory(value){factory=value;} export default function postgres(...args){return factory(...args);}');
 const loader=registerHooks({resolve(specifier,context,next){if(context.parentURL===hostURL&&specifier==='postgres')return {url:stub,shortCircuit:true};return next(specifier,context);}});
 t.after(()=>loader.deregister());
 const {startManagedRuntimeHost}=await import(hostURL),{setFactory}=await import(stub);
 async function fixture({holdCatalog=false,holdApiEnd=false,rawFailure=false,apiRoleMode='direct',apiEndFailure=false,postgresMode='owned',holdApiServer=false,sanitizeApiError=false}={}){
  const root=await fs.mkdtemp(path.join(base,'native-host-schema-diagnosis-')),state=path.join(root,'state'),data=path.join(postgresMode==='owned'?state:root,'data'),bundle=path.join(root,'bundle');
  await fs.mkdir(state);await fs.mkdir(bundle);
  const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
  const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
   const timer=setTimeout(()=>{child.kill();reject(Error('generated_pg_command_timeout'));},90000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('generated_pg_command_failed_'+name));});});
  let started=false,qualified=false,controller,host,startPromise,stopping,systemIdentifier,apiBackendPid,apiServerStarted=false;const pools=[],events=[],queries=[],created=[];
  const catalogEntered=gate(),catalogRelease=gate(),apiEndEntered=gate(),apiEndRelease=gate(),runtimeStopped=gate(),runtimeFinished=gate(),ownerRollback=gate(),apiServerEntered=gate();
  if(!holdCatalog)catalogRelease.resolve();if(!holdApiEnd)apiEndRelease.resolve();
  const readStatus=async()=>JSON.parse(await fs.readFile(path.join(state,'runtime-instance.json'),'utf8'));
  const lock=path.join(state,'runtime-host-lock.json');
  const dispose=async()=>{
   catalogRelease.resolve();apiEndRelease.resolve();
   if(startPromise)await startPromise.catch(()=>{});if(host)await host.stop().catch(()=>{});
   for(const pool of pools)await pool.end({timeout:1}).catch(()=>{});await controller?.end({timeout:1}).catch(()=>{});
   if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
   assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
   if(qualified){assert.equal(await fs.realpath(data),data);assert.equal(path.dirname(data),postgresMode==='owned'?state:root);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');
    await fs.rm(data,{recursive:true});await fs.writeFile(path.join(root,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:systemIdentifier,
     postmaster_pid_file_absent:true,generated_data_removed:true,installed_state_used:false,native_qualification:false}));}
  };
  try{
   await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
   await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
   started=true;await command('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
   const connection={host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:1,prepare:false,connect_timeout:5,onnotice:()=>{}};
   controller=postgres(connection);
   const [pg]=await controller.unsafe(`select current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
    (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,pg_catalog.inet_server_port() as port,
    to_char(pg_catalog.pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
   const pidLines=(await fs.readFile(path.join(data,'postmaster.pid'),'utf8')).split(/\r?\n/);pg.pid=Number(pidLines[0]);
   assert.equal(path.resolve(pg.data_directory).toLowerCase(),path.resolve(data).toLowerCase());assert.equal(pg.port,port);assert.equal(path.resolve(pidLines[1]).toLowerCase(),path.resolve(data).toLowerCase());assert.ok(pg.version>=170000&&pg.version<180000);systemIdentifier=pg.system_identifier;qualified=true;
   const plan=await loadFreshSchemaApplicationPlan();await controller.begin(async tx=>{
    await tx.unsafe(plan.prerequisite_sql);for(const row of plan.statements)await tx.unsafe(row.sql);
    await applyLocalRuntimeMigrations({sql:{unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)},expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
   });await controller.begin(tx=>tx.unsafe(plan.post_upgrade_acl_sql));
   await provisionLocalApiLogin({sql:controller,databaseName:'postgres',login:LOGIN,password:SECRET.repeat(3),roleMode:'direct'});
   const checkApi=postgres({...connection,user:LOGIN});try{await inspectAttachedApiAdmission({sql:checkApi,apiLogin:LOGIN});}finally{await checkApi.end({timeout:1});}
   await fs.writeFile(path.join(data,'client-vault.key'),'b'.repeat(64)+'\n');
   const sourceFile=path.join(bundle,'generated-source-sentinel.mjs');await fs.writeFile(sourceFile,'// Generated source custody fixture, not installed/native proof.\n');
   const sourceFiles=async()=>{const bytes=await fs.readFile(sourceFile);return [{id:'generated-source-only',kind:'source',bytes:bytes.length,sha256:hash(bytes)}];};
   const initialFiles=await sourceFiles(),config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:bundle,expected_bundle_sha256:'a'.repeat(64),
    state_directory:state,pg_data_directory:data,database_url:`postgresql://${LOGIN}:${SECRET}@127.0.0.1:${port}/postgres`,
    inspect_database_url:`postgresql://state_owner:${SECRET}@127.0.0.1:${port}/postgres`,api_port:25432,edge_port:25433,startup_timeout_ms:1000,api_role_mode:apiRoleMode,...(postgresMode==='attached'?{postgres_mode:'attached',expected_cluster_system_identifier:systemIdentifier}:{})};
   const configFile=path.join(root,'private-config.json');await fs.writeFile(configFile,JSON.stringify(config));
   const runtime={endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',instanceId:randomUUID(),stopped:false,postgresIdentity:pg,
    edgeHealth:{runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}},children:[],
    startupManifest:{source:{files:initialFiles},source_manifest_sha256:hash(JSON.stringify(initialFiles))},finished:runtimeFinished.promise,
    stop(reason){return stopping??=(async()=>{events.push('runtime-stop');runtime.stopped=true;await controller.end({timeout:1});
     if(postgresMode==='owned'&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
     if(postgresMode==='attached')events.push('attached-pg-preserved');events.push('runtime-stopped');runtimeStopped.resolve();const outcome={reason,children_stopped:true};runtimeFinished.resolve(outcome);return outcome;})();}};
   let catalogHeld=false;
   setFactory((url,options)=>{
    const kind=decodeURIComponent(new URL(url).username)==='state_owner'?'owner':'api';created.push({kind,max:options.max});events.push(kind+'-created');
    const pool=postgres(url,{...options,onnotice:()=>{},debug:(id,q,...args)=>{queries.push({kind,q});options.debug?.(id,q,...args);}});pools.push(pool);
    const read=async(reserved,q,args)=>{const result=await reserved.unsafe(q,args);if(kind==='owner'&&catalogHeld&&q==='rollback')ownerRollback.resolve();
     if(kind==='owner'&&!catalogHeld&&q.includes('pg_catalog.pg_proc')&&q.includes('jsonb_array_elements')){catalogHeld=true;events.push('catalog-held');catalogEntered.resolve();await catalogRelease.promise;if(rawFailure)throw Error(SECRET+' postgres://private/raw-query');}return result;};
    return new Proxy(pool,{get(target,key,receiver){
     if(key==='unsafe'&&kind==='api'&&holdApiServer)return async(q,args)=>{
      if(!apiServerStarted){apiServerStarted=true;apiBackendPid=(await pool.unsafe('select pg_catalog.pg_backend_pid() as pid'))[0].pid;
       const active=pool.unsafe('select pg_catalog.pg_sleep(20)');apiServerEntered.resolve();
       try{await active;}catch(error){if(sanitizeApiError)throw Error(SECRET+' generated_api_ack_metadata_lost');throw error;}}
      return pool.unsafe(q,args);
     };
     if(key==='reserve')return async()=>{const reserved=await pool.reserve();return new Proxy(reserved,{get(r,k,recv){if(k==='unsafe')return(q,args)=>read(reserved,q,args);return Reflect.get(r,k,recv);}});};
     if(key==='end')return async options=>{events.push(kind+'-end-start');await pool.end(options);events.push(kind+'-end-physical');if(kind==='api'){apiEndEntered.resolve();await apiEndRelease.promise;if(apiEndFailure)throw Error(SECRET+' generated_api_end_ack_lost');}events.push(kind+'-end-done');};
     return Reflect.get(target,key,receiver);
    }});
   });
   const hooks={verifyBundle:async()=>({manifest:{reviewed_startup_files_sha256:startupFilesDigest(await sourceFiles())},paths:{hostEntry:fileURLToPath(new URL('./runtime-host.mjs',import.meta.url)),nodeExecutable:process.execPath,
    postgresBinDirectory:bin,denoExecutable:process.execPath,denoDirectory:bundle}}),stageDenoCache:async()=>bundle,stageDenoExecutable:async()=>process.execPath,launchRuntime:async()=>runtime,
    onTerminal:async()=>{events.push('terminal');assert.equal(await fs.stat(lock).catch(()=>null),null);}};
   const start=()=>startPromise??=(startManagedRuntimeHost({configFile},hooks).then(value=>{host=value;events.push('host-returned');return value;}));
   return {root,state,data,config,sourceFile,runtime,start,readStatus,lock,dispose,controller,events,queries,created,catalogEntered,catalogRelease,apiEndEntered,apiEndRelease,runtimeStopped,ownerRollback,apiServerEntered,readApiBackendPid:()=>apiBackendPid,
    waitState:expected=>until(readStatus,value=>value.native_publication_schema?.state===expected),
    restart:()=>command('pg_ctl',['-D',data,'-m','fast','-w','restart'])};
  }catch(error){await dispose();throw error;}
 }
 async function withFixture(options,body){const f=await fixture(options);try{await body(f);}finally{await f.dispose();}}
 for(const [profile,code,marked] of [['regular','ECONNRESET',false],['regular','CONNECTION_DESTROYED',false],['publication','ECONNRESET',false],['publication','CONNECTION_DESTROYED',false],['publication','ECONNRESET',true]])
 await t.test('foreign body '+code+' '+profile+(marked?' retains foreign HOLD':' cannot claim owner connection death'),()=>withFixture({},async f=>{
  await f.controller.unsafe('create table public.generated_owner_body_failure(value integer not null)');
  const seen=[];let releases=0,pid,written=0;
  const monitor=createNativePreparationTransactions({debug:(_id,q)=>seen.push(q)});
  const pool=postgres(f.config.inspect_database_url,{max:1,prepare:false,debug:monitor.debug,onclose:monitor.onclose});
  const wrapped=new Proxy(pool,{get(target,key,receiver){if(key==='reserve')return async()=>{const reserved=await pool.reserve();return new Proxy(reserved,{get(r,k,recv){
   if(k==='release')return()=>{releases++;return reserved.release();};return Reflect.get(r,k,recv);
  }});};return Reflect.get(target,key,receiver);}});
  const owner=(profile==='publication'?bindNativeCodingPublicationTransactionPool:bindNativeCodingTransactionPool)(wrapped,monitor);
  const foreign=Object.assign(Error('generated_other_resource_failure'),{code});if(marked)markNativePhysicalSettlementUnconfirmed(foreign);
  try{
   const error=await owner.begin('isolation level serializable',async tx=>{
    pid=(await tx.unsafe('select pg_catalog.pg_backend_pid() as pid'))[0].pid;
    await tx.unsafe('insert into public.generated_owner_body_failure values(7)');written=(await tx.unsafe('select count(*)::int as n from public.generated_owner_body_failure'))[0].n;
    throw foreign; // Another resource/body failure, NOT this owner SQL connection.
   }).then(()=>null,error=>error);
   const [activity]=await f.controller.unsafe('select state,xact_start is not null as transaction_open from pg_catalog.pg_stat_activity where pid=$1',[pid]);
   t.diagnostic(JSON.stringify({foreign_code:code,profile,foreign_marker:marked,generated_owner_pid:pid,body_write_seen:written,
    transaction_open:activity?.transaction_open,rollback_sent:seen.includes('rollback'),releases,physical_hold:nativePhysicalSettlementUnconfirmed(error)}));
   assert.equal(written,1);assert.equal(activity?.transaction_open,false,'a foreign BODY error cannot abandon this live owner transaction');
   assert.equal(releases,1);assert.ok(seen.includes('rollback'));assert.equal(error,foreign);assert.equal(nativePhysicalSettlementUnconfirmed(error),marked);
   assert.equal((await f.controller.unsafe('select count(*)::int as n from public.generated_owner_body_failure'))[0].n,0,'real owner write must roll back');
  }finally{await pool.end({timeout:1});}
 }));
 await t.test('valid schema diagnosis does not delay provider return or admit execution, and normal stop owns API before owner pool',()=>withFixture({holdCatalog:true},async f=>{
  const host=await within(f.start());minimal(host);await within(f.catalogEntered.promise);
  assert.equal((await f.readStatus()).state,'READY');assert.equal(f.events.includes('runtime-stop'),false);
  f.catalogRelease.resolve();const status=await f.waitState('MATCHED_SCHEMA_ONLY');diagnosis(status.native_publication_schema);
  assert.deepEqual(f.created,[{kind:'owner',max:2},{kind:'api',max:1}]);
  assert.ok(f.queries.some(x=>x.q.startsWith('begin isolation level repeatable read read only')));
  assert.ok(f.queries.every(x=>/^(?:select\b|begin\b|commit\b|rollback\b)/i.test(x.q.trim())));
  await assert.rejects(host.nativeCodingAuthority.DISCOVER_NATIVE_SETUP_V1({}),/request_invalid/);
  await assert.rejects(host.nativeCodingAuthority.READ_NATIVE_CAPACITY_V1({}),/request_invalid/);
  await host.stop();await host.finished;const stopped=await f.readStatus();assert.equal(stopped.state,'STOPPED');diagnosis(stopped.native_publication_schema);
  assert.equal(stopped.native_publication_schema.state,'CLOSED_SCHEMA_ONLY');assert.ok(f.events.indexOf('api-end-done')<f.events.indexOf('owner-end-start'));assert.ok(f.events.indexOf('owner-end-done')<f.events.indexOf('terminal'));
 }));
 await t.test('unsupported API profile remains explicit and does not open a diagnostic API pool',()=>withFixture({apiRoleMode:'service_role'},async f=>{
  const host=await f.start();minimal(host);const status=await f.waitState('UNSUPPORTED_PROFILE');diagnosis(status.native_publication_schema);
  assert.deepEqual(f.created,[{kind:'owner',max:2}]);assert.equal(f.events.includes('runtime-stop'),false);
  await host.stop();await host.finished;assert.equal((await f.readStatus()).state,'STOPPED');
 }));
 await t.test('partial installed schema remains SCHEMA_HOLD without repair or removing minimum Host service',()=>withFixture({},async f=>{
  await f.controller.unsafe('drop trigger aa_native_execution_task_fence_v1 on destruktion_meta.native_coding_execution_h205f22');
  const host=await f.start();minimal(host);const status=await f.waitState('SCHEMA_HOLD');diagnosis(status.native_publication_schema);assert.equal(status.state,'READY');assert.equal(f.events.includes('runtime-stop'),false);
  assert.equal((await f.controller.unsafe("select exists(select 1 from pg_catalog.pg_trigger where tgname='aa_native_execution_task_fence_v1') as present"))[0].present,false);
  await assert.rejects(host.nativeCodingAuthority.READ_NATIVE_CAPACITY_V1({}),/request_invalid/);
 }));
 await t.test('raw catalog failure is sanitized to fixed SCHEMA_HOLD and does not kill minimum Host service',()=>withFixture({rawFailure:true},async f=>{
  const host=await f.start();minimal(host);const status=await f.waitState('SCHEMA_HOLD');diagnosis(status.native_publication_schema);
  const bytes=JSON.stringify(status);assert.ok(!bytes.includes(SECRET));assert.ok(!bytes.includes('postgres://'));assert.equal(f.events.includes('runtime-stop'),false);
 }));
 await t.test('generated source drift during genuine catalog read becomes continuity HOLD, never positive schema status',()=>withFixture({holdCatalog:true},async f=>{
  const host=await f.start();minimal(host);await within(f.catalogEntered.promise);await fs.appendFile(f.sourceFile,'// changed generated fixture bytes\n');f.catalogRelease.resolve();
  const status=await f.waitState('RUNTIME_CONTINUITY_HOLD');diagnosis(status.native_publication_schema);assert.equal(status.state,'READY');assert.equal(f.events.includes('runtime-stop'),false);
 }));
 await t.test('wrong original PG birth within the same millisecond is refused without changing the recovery wire',()=>withFixture({},async f=>{
  const original=f.runtime.postgresIdentity.started_at,match=/\.(\d{6})Z$/.exec(original);assert.ok(match);
  const fraction=Number(match[1]),shifted=fraction+(fraction%1000===999?-1:1),wrong=original.replace(/\.\d{6}Z$/,'.'+String(shifted).padStart(6,'0')+'Z');
  assert.notEqual(wrong,original);assert.equal(Date.parse(wrong),Date.parse(original),'legacy millisecond continuity wire cannot distinguish this generated mismatch');
  f.runtime.postgresIdentity.started_at=wrong;const host=await f.start();minimal(host);
  const status=await f.waitState('RUNTIME_CONTINUITY_HOLD');diagnosis(status.native_publication_schema);assert.equal(status.state,'READY');assert.equal(f.events.includes('runtime-stop'),false);
 }));
 await t.test('actual postmaster replacement during diagnosis cannot reuse old schema observation or admit execution',()=>withFixture({holdCatalog:true},async f=>{
  const host=await f.start();minimal(host);await within(f.catalogEntered.promise);await f.restart();f.catalogRelease.resolve();
  const status=await until(f.readStatus,value=>['SCHEMA_HOLD','RUNTIME_CONTINUITY_HOLD'].includes(value.native_publication_schema?.state));diagnosis(status.native_publication_schema);assert.equal(status.state,'READY');assert.equal(f.events.includes('runtime-stop'),false);
 }));
 await t.test('API disposal acknowledgement failure retains cleanup HOLD and Host lock despite proved own PG stop',()=>withFixture({apiEndFailure:true},async f=>{
  const host=await f.start();await f.waitState('MATCHED_SCHEMA_ONLY');const outcome=await host.stop();await host.finished;
  assert.equal(outcome.children_stopped,false);const status=await f.readStatus();assert.equal(status.state,'FAILED');diagnosis(status.native_publication_schema);
  assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');assert.ok(await fs.stat(f.lock));assert.equal(f.events.includes('terminal'),false);
  assert.ok(!JSON.stringify(status).includes(SECRET));assert.ok(f.events.indexOf('api-end-physical')<f.events.indexOf('owner-end-start'));
 }));
 await t.test('attached held diagnosis times out to retained cleanup HOLD without stopping PG or late ownership release',()=>withFixture({postgresMode:'attached',holdCatalog:true},async f=>{
  const host=await f.start();minimal(host);await within(f.catalogEntered.promise);const lockBytes=await fs.readFile(f.lock,'utf8');
  const began=performance.now(),outcome=await within(host.stop(),12000);await host.finished;
  assert.ok(performance.now()-began>=6000,'the bounded cleanup wait must actually elapse before HOLD');assert.equal(outcome.children_stopped,false);
  assert.equal(f.events.includes('attached-pg-preserved'),true);assert.ok(await fs.stat(path.join(f.data,'postmaster.pid')));
  const liveProbe=postgres(f.config.inspect_database_url,{max:1,prepare:false,connect_timeout:3});try{assert.equal((await liveProbe.unsafe('select 1::int as alive'))[0].alive,1);}finally{await liveProbe.end({timeout:1});}
  const status=await f.readStatus();assert.equal(status.state,'FAILED');diagnosis(status.native_publication_schema);assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');
  assert.equal(f.events.includes('owner-end-start'),false);assert.equal(f.events.includes('terminal'),false);assert.equal(await fs.readFile(f.lock,'utf8'),lockBytes);
  assert.ok(f.events.includes('api-end-done'),'API disposal must not wait behind its own held diagnosis');
  f.catalogRelease.resolve();await within(f.ownerRollback.promise);await tick();
  assert.equal((await f.readStatus()).native_publication_schema.state,'CLEANUP_HOLD');assert.equal(f.events.includes('owner-end-start'),false);
  assert.equal(f.events.includes('terminal'),false);assert.equal(await fs.readFile(f.lock,'utf8'),lockBytes,'late read settlement cannot promote an already terminal HOLD');
 }));
 for(const sanitizeApiError of [false,true])await t.test('attached API client timeout '+(sanitizeApiError?'with test-only sanitized ordinary-error ACK loss ':'with genuine driver error ')+'cannot claim server-query settlement or release Host lock',()=>withFixture({postgresMode:'attached',holdApiServer:true,sanitizeApiError},async f=>{
  const host=await f.start();minimal(host);await within(f.apiServerEntered.promise);const pid=f.readApiBackendPid();
  const observer=postgres(f.config.inspect_database_url,{max:1,prepare:false,connect_timeout:3});
  const activity=async()=>(await observer.unsafe('select pid,state,wait_event from pg_catalog.pg_stat_activity where pid=$1',[pid]))[0];
  try{
   await until(activity,row=>row?.state==='active'&&row.wait_event==='PgSleep');
   const lockBytes=await fs.readFile(f.lock,'utf8'),outcome=await within(host.stop(),12000);await host.finished;
   const active=await activity(),status=await f.readStatus();
   t.diagnostic(JSON.stringify({test_only_sanitized_error:sanitizeApiError,generated_api_pid:pid,after_stop_state:active?.state,after_stop_wait_event:active?.wait_event,
    children_stopped:outcome.children_stopped,status:status.state,diagnosis:status.native_publication_schema?.state,
    owner_ended:f.events.includes('owner-end-done'),lock_present:!!await fs.stat(f.lock).catch(()=>null)}));
   assert.equal(active?.state,'active','ending the generated client does not end its PostgreSQL server query');assert.equal(active?.wait_event,'PgSleep');
   assert.equal(outcome.children_stopped,false);assert.equal(status.state,'FAILED');diagnosis(status.native_publication_schema);assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');
   assert.equal(await fs.readFile(f.lock,'utf8'),lockBytes);assert.equal(f.events.includes('terminal'),false);assert.equal(f.events.includes('attached-pg-preserved'),true);
  }finally{await observer.end({timeout:1});}
 }));
 await t.test('stop joins original held diagnosis and API disposal before owner disposal or Host lock release',()=>withFixture({holdCatalog:true,holdApiEnd:true},async f=>{
  const host=await f.start();minimal(host);await within(f.catalogEntered.promise);let done=false;const stopping=host.stop().then(value=>{done=true;return value;});
  await within(f.runtimeStopped.promise);await tick();assert.equal(done,false);assert.equal(f.events.includes('owner-end-start'),false);assert.ok(await fs.stat(f.lock));
  await within(f.apiEndEntered.promise);assert.equal(done,false);assert.equal(f.events.includes('owner-end-start'),false);assert.ok(await fs.stat(f.lock));
  f.catalogRelease.resolve();await tick();assert.equal(done,false,'original API disposal remains joined after catalog delivery');
  f.apiEndRelease.resolve();await stopping;await host.finished;const status=await f.readStatus();diagnosis(status.native_publication_schema);
  assert.ok(f.events.indexOf('api-end-done')<f.events.indexOf('owner-end-start'));
  assert.equal(status.state,'STOPPED');assert.equal(status.native_publication_schema.state,'CLOSED_SCHEMA_ONLY','joined diagnosis ends without late positive status');
  assert.equal(await fs.stat(f.lock).catch(()=>null),null);
 }));
});
