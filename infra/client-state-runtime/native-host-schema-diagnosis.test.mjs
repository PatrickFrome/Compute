// Generated private dependencies exercise the actual Host wiring/lifetime.
// SQL body/catalog correctness and genuine connections are covered separately
// by native-coding-host-schema-diagnosis.pg17.test.mjs. No installed authority.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startupFilesDigest} from './startup-source-manifest.mjs';
import {startManagedRuntimeHost,setNativeStartupFixture,closeLoader} from './test/native-host-startup-lifecycle-loader.mjs';
after(closeLoader);
const gate=()=>Promise.withResolvers(),tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t,stage='none',profile='direct'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-host-schema-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(root,'bundle'),expected_bundle_sha256:'a'.repeat(64),
  state_directory:path.join(root,'state'),pg_data_directory:path.join(root,'state/data'),database_url:'postgres://actual_api:SENTINEL_API_SECRET@127.0.0.1:25434/postgres',
  inspect_database_url:'postgres://state_owner:SENTINEL_OWNER_SECRET@127.0.0.1:25434/postgres',api_port:25432,edge_port:25433,startup_timeout_ms:1000,api_role_mode:profile};
 if(stage==='api-read-rejection'){config.postgres_mode='attached';config.expected_cluster_system_identifier='7654321098765432100';config.pg_data_directory=path.join(root,'external-generated-data');}
 await fs.mkdir(config.bundle_directory);await fs.mkdir(config.state_directory,{recursive:true});await fs.mkdir(config.pg_data_directory,{recursive:true});
 await fs.writeFile(path.join(config.pg_data_directory,'PG_VERSION'),'17\n');await fs.writeFile(path.join(config.pg_data_directory,'client-vault.key'),'b'.repeat(64)+'\n');
 await fs.writeFile(path.join(config.pg_data_directory,'postmaster.pid'),`1234\n${config.pg_data_directory}\n1790000000\n25434\n\n127.0.0.1\nready\n`);
 const configFile=path.join(root,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
 const sourceFile=path.join(config.bundle_directory,'generated-source.mjs'),sourceBytes='// generated source custody fixture\n';await fs.writeFile(sourceFile,sourceBytes);
 const sourceFiles=[{id:'generated-source',bytes:Buffer.byteLength(sourceBytes),sha256:createHash('sha256').update(sourceBytes).digest('hex')}];
 const events=[],entered=gate(),pending=gate(),finished=gate(),afterStop=gate(),afterRead=gate(),terminals=[];
 const counts={owner:0,api:0,verifier:0,admission:0};let utf8PreimageArmed=false,utf8Mutations=0,renames=0,statusAttempts=0,statusCandidate=null,statusCompleted=false,statusNativeErrors=0,sourceReads=0,reservation=0,schemaClosed=false,schemaRead=null,apiOptions,ownerOptions,healthReport;
 const pg={pid:1234,version:170007,system_identifier:'7654321098765432100',started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434};
 const currentPg={...pg};
 const rawOwner={unsafe:async()=>[],reserve:async()=>{const id=++reservation;return{unsafe:async (q,args=[])=>{
  events.push('owner-query:'+q.split(' ')[0]);ownerOptions.debug(id,q,[],[]);
  if(q.startsWith('select pg_catalog.pg_try_advisory_lock_shared'))return[{locked:true}];
  if(q.startsWith('select pg_catalog.pg_advisory_unlock_shared'))return[{unlocked:true}];
  if(q.includes("current_setting('server_version_num')"))return[{...currentPg,current_login:'state_owner',session_login:'state_owner',birth_matches:currentPg.started_at===args[0]}];return[];
 },release:()=>events.push('owner-release')};},async end(){events.push('owner-end');if(stage==='owner-end-failure')throw Error('SENTINEL_OWNER_END');}};
 const rawApi={unsafe:async()=>{if(stage==='api-read-rejection'){entered.resolve();await pending.promise;events.push('api-read-rejected');throw Error('SENTINEL_SANITIZED_RAW_API_FAILURE');}return[];},async end(){events.push('api-end');if(stage==='api-read-rejection'){pending.resolve();await tick();}if(stage==='api-end-held'){entered.resolve();await pending.promise;}if(stage==='api-end-failure')throw Error('SENTINEL_PRIVATE_END');apiOptions.onclose();events.push('api-ended');}};
 const alterUtf8=async(file,before,after)=>{
  const bytes=await fs.readFile(file),at=bytes.indexOf(before),identity=await fs.lstat(file,{bigint:true});assert.ok(at>=0);
  const changed=Buffer.concat([bytes.subarray(0,at),after,bytes.subarray(at+before.length)]);
  assert.notDeepEqual(changed,bytes);assert.equal(changed.toString('utf8'),bytes.toString('utf8'),'distinct byte sequences share the replacement-character decoding');
  await fs.writeFile(file,changed);const observed=await fs.lstat(file,{bigint:true});assert.equal(observed.ino,identity.ino);assert.equal(observed.dev,identity.dev);utf8Mutations++;
 };
 setNativeStartupFixture({async rename(from,to){
  renames++;
  const value=JSON.parse(await fs.readFile(from,'utf8'));
  if(stage==='status-terminal-failure'&&value.state==='STOPPED')throw Object.assign(Error('generated terminal write refusal'),{code:'EIO'});
  if(stage.startsWith('status-')&&!statusCompleted&&value.native_publication_schema?.state==='UNSUPPORTED_PROFILE'){
   statusAttempts++;statusCandidate??=from;assert.equal(from,statusCandidate,'retry must use the one original synced candidate');events.push('status-attempt');
   if(stage==='status-held'){entered.resolve();await pending.promise;}
   if(stage==='status-utf8-ack-loss'){entered.resolve();await fs.rename(from,to);await alterUtf8(to,Buffer.from('\uFFFD'),Buffer.from([0xff]));statusCompleted=true;throw Object.assign(Error('generated corrupt byte ACK loss'),{code:'EPERM'});}
   if(stage==='status-ack-loss'){try{await fs.rename(from,to);}catch(error){assert.ok(['EPERM','EACCES','EBUSY'].includes(error.code));statusNativeErrors++;throw error;}statusCompleted=true;throw Object.assign(Error('generated post-rename acknowledgement loss'),{code:'EPERM'});}
   if(stage==='status-temp-replaced'){const bytes=await fs.readFile(from);await fs.rename(from,from+'.original');await fs.writeFile(from,bytes);}
   if(stage==='status-directory-replaced'){const directory=path.dirname(to),saved=directory+'.original';await fs.rename(directory,saved);await fs.mkdir(directory);for(const name of await fs.readdir(saved))await fs.rename(path.join(saved,name),path.join(directory,name));}
   if(stage==='status-target-replaced'){const bytes=await fs.readFile(to);await fs.rename(to,to+'.original');await fs.writeFile(to,bytes);}
   if(stage.startsWith('status-retry')&&statusAttempts<=2||['status-persistent','status-temp-replaced','status-target-replaced','status-directory-replaced','status-not-retryable'].includes(stage)){
    entered.resolve();throw Object.assign(Error('generated status contention'),{code:stage==='status-not-retryable'?'EIO':stage==='status-retry-eacces'?'EACCES':stage==='status-retry-ebusy'?'EBUSY':'EPERM'});
   }
  }
  try{await fs.rename(from,to);}catch(error){if(stage.startsWith('status-retry')&&value.native_publication_schema?.state==='UNSUPPORTED_PROFILE'){assert.ok(['EPERM','EACCES','EBUSY'].includes(error.code));statusNativeErrors++;}throw error;}
  if(value.native_publication_schema?.state==='UNSUPPORTED_PROFILE')statusCompleted=true;
 },async open(file,...args){
  const handle=await fs.open(file,...args);
  if(utf8PreimageArmed&&file.endsWith('runtime-instance.json')&&args[0]==='r')return new Proxy(handle,{get(target,key){
   if(key==='readFile')return async(...readArgs)=>{const value=await target.readFile(...readArgs);utf8PreimageArmed=false;await alterUtf8(file,Buffer.from([0xff]),Buffer.from([0xfe]));return value;};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  if(stage!=='lock-close-replacement'||!file.endsWith('runtime-host-lock.json')||args[0]!=='wx')return handle;
  return new Proxy(handle,{get(target,key){if(key==='close')return async()=>{await target.close();const bytes=await fs.readFile(file),other=file+'.replacement';await fs.writeFile(other,bytes);await fs.rename(other,file);};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 },sqlFactory(url,options){if(new URL(url).username==='state_owner'){counts.owner++;ownerOptions=options;return rawOwner;}
  assert.equal(url,config.database_url);assert.equal(options.max,1);counts.api++;apiOptions=options;events.push('api-open');return rawApi;},
  schemaVerifier(input){counts.verifier++;assert.notEqual(input.ownerSql,rawOwner);assert.notEqual(input.apiSql,rawApi);assert.equal(typeof input.apiSql.unsafe,'function');assert.equal(input.apiLogin,'actual_api');
   assert.equal(input.assertCurrent(),undefined);return{
    attest(){schemaRead=(async()=>{events.push('schema-read');
     if(stage==='api-read-rejection')await input.apiSql.unsafe('select generated API identity');
     if(['schema-read','late-source','source-drift','pg-drift','pg-same-ms','query-loss'].includes(stage)){entered.resolve();await pending.promise;}
     if(stage==='schema-read'){events.push('schema-after-stop');afterRead.resolve();await afterStop.promise;}
     if(stage==='source-drift')await fs.writeFile(sourceFile,'// changed generated source\n');
     if(stage==='pg-drift')currentPg.system_identifier='7654321098765432101';
     if(stage==='pg-same-ms'){currentPg.started_at=pg.started_at.replace('.000Z','.000001Z');assert.equal(Date.parse(currentPg.started_at),Date.parse(pg.started_at));}
     if(stage==='query-loss')apiOptions.onclose();
     input.assertCurrent();if(schemaClosed)throw Error('native_installed_publication_schema_closed');
     if(stage==='schema-missing')throw Error('native_installed_publication_schema_function');
    })();return schemaRead;},
    close(){schemaClosed=true;events.push('schema-close');},
    async drain(){await schemaRead?.catch(()=>{});events.push('schema-drained');if(stage==='drain-failure')throw Error('SENTINEL_PRIVATE_DRAIN');}
   };},readOperator(){counts.admission++;throw Error('operator absent');},createAuthority(){counts.admission++;throw Error('effect authority forbidden');}});
 const runtime={endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',instanceId:randomUUID(),stopped:false,postgresIdentity:pg,
  edgeHealth:{runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}},
  children:stage.startsWith('status-utf8')?[{name:'generated-\uFFFD',pid:12345}]:[],startupManifest:{source_manifest_sha256:'c'.repeat(64),source:{files:sourceFiles}},finished:finished.promise,
  async stop(reason){events.push('runtime-stop');runtime.stopped=true;if(stage==='schema-read')pending.resolve();
   const outcome={reason,children_stopped:true};finished.resolve(outcome);return outcome;}};
 const controller=new AbortController();
 const start=startManagedRuntimeHost({configFile,signal:controller.signal},{verifyBundle:async()=>{
  sourceReads++;if(stage==='schema-source'&&sourceReads===2||stage==='late-source'&&sourceReads===3){entered.resolve();await pending.promise;}
  if(await fs.readFile(sourceFile,'utf8')!==sourceBytes)throw Object.assign(Error('SENTINEL_SOURCE_PATH'),{code:'offline_bundle_file_digest_mismatch'});
  return{manifest:{reviewed_startup_files_sha256:startupFilesDigest(sourceFiles)},paths:{hostEntry:fileURLToPath(new URL('./runtime-host.mjs',import.meta.url)),
   nodeExecutable:process.execPath,postgresBinDirectory:root,denoExecutable:process.execPath,denoDirectory:root}};},
  stageDenoCache:async()=>root,stageDenoExecutable:async()=>process.execPath,launchRuntime:async(_input,{report})=>{healthReport=report;return runtime;},
  onTerminal:outcome=>{events.push('terminal');terminals.push(outcome);}});
 const status=async()=>JSON.parse(await fs.readFile(path.join(config.state_directory,'runtime-instance.json'),'utf8'));
 const waitStatus=async state=>{for(let i=0;i<300;i++){const value=await status();if(value.native_publication_schema?.state===state)return value;await new Promise(r=>setTimeout(r,5));}throw Error('diagnosis_state_not_observed_'+state);};
 return{root,config,start,status,waitStatus,runtime,controller,entered,pending,afterStop,afterRead,events,counts,terminals,rawOwner,rawApi,statusAttempts:()=>statusAttempts,statusNativeErrors:()=>statusNativeErrors,statusCandidate:()=>statusCandidate,renames:()=>renames,utf8Mutations:()=>utf8Mutations,armUtf8Preimage:async()=>{await alterUtf8(path.join(config.state_directory,'runtime-instance.json'),Buffer.from('\uFFFD'),Buffer.from([0xff]));utf8PreimageArmed=true;},loseApi:()=>apiOptions.onclose(),reportHealth:event=>healthReport(event)};
}
function assertSetupOnly(f,host){
 for(const name of ['DISCOVER_NATIVE_SETUP_V1','READ_NATIVE_SETUP_V1','READ_NATIVE_CAPACITY_V1'])assert.equal(typeof host.nativeCodingAuthority[name],'function');
 for(const name of ['RESERVE_EXECUTION','AGENT_OPERATION','ACTIVATE_PREPARED_GOAL_V1'])assert.equal(host.nativeCodingAuthority[name],undefined);
 assert.deepEqual(f.counts,{...f.counts,owner:1,admission:0});
}
test('actual Host wires one owner pool and one restricted API; matched diagnosis is not execution admission',async t=>{
 const f=await fixture(t),host=await f.start;assertSetupOnly(f,host);const status=await f.waitStatus('MATCHED_SCHEMA_ONLY');
 assert.deepEqual(status.native_publication_schema,{schema:'metaengine.native-coding.installed-schema-diagnosis.v1',state:'MATCHED_SCHEMA_ONLY',execution_admitted:false,authority_effect:false});
 assert.equal(f.counts.api,1);assert.equal(f.counts.verifier,1);assert.equal(status.runtime_ready,true);assert(!JSON.stringify(status).includes('SENTINEL'));
 await host.stop();await host.finished;assert.ok(f.events.indexOf('schema-drained')<f.events.indexOf('owner-end'));assert.ok(f.events.indexOf('api-ended')<f.events.indexOf('owner-end'));
 assert.equal(f.terminals.length,1);assert.equal((await f.status()).native_publication_schema.execution_admitted,false);
});
for(const [stage,expected] of [['schema-missing','SCHEMA_HOLD'],['source-drift','RUNTIME_CONTINUITY_HOLD'],['pg-drift','RUNTIME_CONTINUITY_HOLD'],['pg-same-ms','RUNTIME_CONTINUITY_HOLD']])test(stage+' is sanitized and leaves signed minimum setup/capacity available',async t=>{
 const f=await fixture(t,stage),host=await f.start;assertSetupOnly(f,host);if(stage!=='schema-missing'){await f.entered.promise;f.pending.resolve();}
 const status=await f.waitStatus(expected);assert.equal(status.runtime_ready,true);assert.equal(status.native_publication_schema.execution_admitted,false);assert(!JSON.stringify(status).includes('SENTINEL'));
 assert.equal(f.events.includes('runtime-stop'),false);await host.stop();await host.finished;
});
test('unsupported API profile never opens extra API connection or verifier and does not block setup',async t=>{
 const f=await fixture(t,'none','service_role'),host=await f.start;assertSetupOnly(f,host);await f.waitStatus('UNSUPPORTED_PROFILE');
 assert.equal(f.counts.api,0);assert.equal(f.counts.verifier,0);await host.stop();await host.finished;
});
for(const stage of ['schema-source','late-source'])test('stop joins exact '+stage+' without delaying PG shutdown or late status resurrection',async t=>{
 const f=await fixture(t,stage),host=await f.start;assertSetupOnly(f,host);await f.entered.promise;
 const stopping=host.stop();await tick();assert.equal(f.events.includes('runtime-stop'),true);assert.equal(f.events.includes('owner-end'),false);assert.equal(f.terminals.length,0);
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));f.pending.resolve();await stopping;await host.finished;
 const status=await f.status();assert.equal(status.state,'STOPPED');assert.equal(status.native_publication_schema.state,'CLOSED_SCHEMA_ONLY');
 assert.equal(f.counts.admission,0);if(stage==='schema-source')assert.equal(f.counts.verifier,0);
});
test('stop starts physical shutdown before joining a held schema read and its remaining callback',async t=>{
 const f=await fixture(t,'schema-read'),host=await f.start;assertSetupOnly(f,host);await f.entered.promise;
 const stopping=host.stop();assert.equal(host.stop(),stopping);await f.afterRead.promise;
 assert.equal(f.events.filter(x=>x==='runtime-stop').length,1);assert.equal(f.events.includes('owner-end'),false);assert.equal(f.terminals.length,0);
 f.afterStop.resolve();await stopping;await host.finished;assert.ok(f.events.indexOf('runtime-stop')<f.events.indexOf('schema-drained'));
 assert.ok(f.events.indexOf('schema-drained')<f.events.indexOf('owner-end'));assert.ok(f.events.indexOf('api-ended')<f.events.indexOf('owner-end'));assert.equal((await f.status()).state,'STOPPED');
});
test('API close remains joined before owner pool and Host lock disposal',async t=>{
 const f=await fixture(t,'api-end-held'),host=await f.start;await f.waitStatus('MATCHED_SCHEMA_ONLY');const stop=host.stop();await f.entered.promise;
 assert.equal(f.events.includes('owner-end'),false);assert.equal(f.terminals.length,0);assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
 f.pending.resolve();await stop;await host.finished;assert.equal(f.terminals.length,1);
});
for(const stage of ['api-end-failure','drain-failure','owner-end-failure'])test(stage+' retains cleanup HOLD and original Host lock, never admission',async t=>{
 const f=await fixture(t,stage),host=await f.start;await f.waitStatus('MATCHED_SCHEMA_ONLY');const outcome=await host.stop();await host.finished;
 assert.equal(outcome.children_stopped,false);assert.equal(f.terminals.length,0);assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
 const status=await f.status();assert.equal(status.state,'FAILED');assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');assert(!JSON.stringify(status).includes('SENTINEL'));
 assert.equal(f.counts.admission,0);
});

test('same-byte replacement then original-file restoration cannot resurrect diagnosed Host ownership',async t=>{
 const f=await fixture(t,'late-source'),host=await f.start;await f.entered.promise;
 const lock=path.join(f.config.state_directory,'runtime-host-lock.json'),bytes=await fs.readFile(lock),saved=path.join(f.config.state_directory,'original-lock');
 const original=await fs.lstat(lock,{bigint:true});await fs.rename(lock,saved);await fs.writeFile(lock,bytes);
 assert.notEqual((await fs.lstat(lock,{bigint:true})).ino,original.ino);f.pending.resolve();await f.waitStatus('RUNTIME_CONTINUITY_HOLD');
 await fs.unlink(lock);await fs.rename(saved,lock);assert.equal((await fs.lstat(lock,{bigint:true})).ino,original.ino);
 const outcome=await host.stop();await host.finished;assert.equal(outcome.children_stopped,false);assert.equal(f.terminals.length,0);
 assert.deepEqual(await fs.readFile(lock),bytes);assert.equal((await f.status()).native_publication_schema.state,'CLEANUP_HOLD');
});
test('lock replacement after diagnosis preserves release error and records truthful failed cleanup',async t=>{
 const f=await fixture(t),host=await f.start;await f.waitStatus('MATCHED_SCHEMA_ONLY');
 const lock=path.join(f.config.state_directory,'runtime-host-lock.json'),bytes=await fs.readFile(lock),replacement=path.join(f.config.state_directory,'replacement-lock');
 await fs.writeFile(replacement,bytes);await fs.rename(replacement,lock);
 const lateHealth=f.reportHealth({event:'health_failure',health_failure:{schema:'metaengine.client-state.health-failure.v1',code:'health_timeout',component:'api',consecutive_failures:1,http_status:null,authority_effect:false}});
 await assert.rejects(host.stop(),/runtime_host_owner_lock_changed/);await assert.rejects(host.finished,/runtime_host_owner_lock_changed/);await lateHealth;f.loseApi();
 await f.reportHealth({event:'health_recovered'});await tick();
 const status=await f.status();assert.equal(status.state,'FAILED');assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');assert.equal(f.terminals.length,0);assert.deepEqual(await fs.readFile(lock),bytes);
});

test('actual original API connection loss invalidates matched diagnosis without reconnect/admission',async t=>{
 const f=await fixture(t),host=await f.start;await f.waitStatus('MATCHED_SCHEMA_ONLY');f.loseApi();
 const status=await f.waitStatus('RUNTIME_CONTINUITY_HOLD');assertSetupOnly(f,host);assert.equal(status.runtime_ready,true);assert.equal(f.counts.api,1);
 assert.equal(status.native_publication_schema.execution_admitted,false);assert.equal(f.events.includes('runtime-stop'),false);
 await host.stop();await host.finished;assert.equal((await f.status()).state,'STOPPED');
});

test('lock diagnosis retains canonical ancestry and refuses a newly substituted directory alias',async t=>{
 const f=await fixture(t,'late-source'),host=await f.start;await f.entered.promise;
 const moved=path.join(f.root,'moved-state');await fs.rename(f.config.state_directory,moved);
 // An owned absolute directory junction exercises the Windows reparse boundary
 // without requesting symbolic-link privileges or changing machine policy.
 await fs.symlink(moved,f.config.state_directory,process.platform==='win32'?'junction':'dir');
 assert.equal((await fs.lstat(f.config.state_directory)).isSymbolicLink(),true);
 assert.equal(await fs.realpath(f.config.state_directory),await fs.realpath(moved));
 f.pending.resolve();await tick();await tick();
 // Neither a diagnostic nor terminal status may be written through an alias.
 const stopping=host.stop(),finished=assert.rejects(host.finished,/runtime_host_path_invalid/);
 await assert.rejects(stopping,/runtime_host_path_invalid/);await finished;
 assert.equal(f.terminals.length,0);assert.ok(await fs.stat(path.join(moved,'runtime-host-lock.json')));
 const last=JSON.parse(await fs.readFile(path.join(moved,'runtime-instance.json'),'utf8'));
 assert.notEqual(last.native_publication_schema?.state,'MATCHED_SCHEMA_ONLY');assert.notEqual(last.state,'STOPPED');
 // Remove only this fixture's alias; junction cleanup must not remove its target.
 await fs.unlink(f.config.state_directory);
 await assert.rejects(fs.lstat(f.config.state_directory),{code:'ENOENT'});
 assert.ok(await fs.stat(path.join(moved,'runtime-host-lock.json')));
});

test('same-byte pathname replacement at wx handle close is not adopted as original Host lock',async t=>{
 const f=await fixture(t,'lock-close-replacement');await assert.rejects(f.start,/runtime_host_owner_lock_changed/);
 assert.equal(f.counts.owner,0);assert.equal(f.counts.api,0);assert.equal(f.counts.admission,0);assert.equal(f.terminals.length,0);
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
});

test('attached API raw rejection before intentional onclose retains physical HOLD independently of owner error metadata',async t=>{
 const f=await fixture(t,'api-read-rejection'),host=await f.start;await f.entered.promise;const outcome=await host.stop();await host.finished;
 assert.equal(outcome.children_stopped,false);assert.equal(f.terminals.length,0);assert.equal((await f.status()).native_publication_schema.state,'CLEANUP_HOLD');
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));assert.ok(f.events.indexOf('api-read-rejected')<f.events.indexOf('api-ended'));
 assert.equal(f.events.filter(x=>x==='api-end').length,1);assert.equal(f.counts.admission,0);
});

for(const stage of ['status-retry','status-retry-eacces','status-retry-ebusy','status-ack-loss'])test(stage+' confirms exact status readback and retries sharing failures only on Windows',async t=>{
 const f=await fixture(t,stage,'service_role'),host=await f.start;
 if(stage==='status-ack-loss'||process.platform==='win32'){
  await f.waitStatus('UNSUPPORTED_PROFILE');assert.equal(f.statusAttempts(),(stage==='status-ack-loss'?1:3)+f.statusNativeErrors());assert.ok(f.statusAttempts()<=6);
  const outcome=await host.stop();await host.finished;assert.equal(outcome.children_stopped,true);assert.equal(f.terminals.length,1);
 }else{
  await f.entered.promise;const outcome=await host.stop();await host.finished;assert.equal(outcome.children_stopped,false);assert.equal(f.statusAttempts(),1);assert.equal(f.terminals.length,0);
 }
 assert.equal(f.counts.api,0);assert.equal(f.counts.admission,0);
});
for(const stage of ['status-persistent','status-temp-replaced','status-target-replaced','status-directory-replaced','status-not-retryable'])test(stage+' retains bounded storage HOLD rather than a false schema verdict or unsafe rename retry',async t=>{
 const f=await fixture(t,stage,'service_role'),host=await f.start;await f.entered.promise;
 const outcome=await host.stop();await host.finished;assert.equal(outcome.children_stopped,false);assert.equal(f.terminals.length,0);
 assert.equal(f.statusAttempts(),stage==='status-persistent'&&process.platform==='win32'?6:1);assert.ok(await fs.stat(f.statusCandidate()));
 const status=await f.status();assert.equal(status.native_publication_schema.state,'CLEANUP_HOLD');assert.equal(status.state,'FAILED');
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));assert.equal(f.counts.admission,0);
});
test('held status replacement stays ahead of queued health and terminal writes without late readiness resurrection',async t=>{
 const f=await fixture(t,'status-held','service_role'),host=await f.start;await f.entered.promise;
 const health=f.reportHealth({event:'health_recovered'}),stopping=host.stop();await tick();assert.equal(f.terminals.length,0);
 f.pending.resolve();await stopping;await host.finished;await health;await tick();
 assert.equal((await f.status()).state,'STOPPED');assert.equal((await f.status()).native_publication_schema.state,'CLOSED_SCHEMA_ONLY');assert.equal(f.terminals.length,1);
});
test('terminal status failure retains original ownership and never emits a successful cleanup receipt',async t=>{
 const f=await fixture(t,'status-terminal-failure','service_role'),host=await f.start;await f.waitStatus('UNSUPPORTED_PROFILE');
 const finished=assert.rejects(host.finished,/status_write_failed/);await assert.rejects(host.stop(),/status_write_failed/);await finished;
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));assert.equal(f.terminals.length,0);
});

test('committed status with intended U+FFFD cannot accept same-inode malformed UTF8 after lost rename acknowledgement',async t=>{
 const f=await fixture(t,'status-utf8-ack-loss','service_role'),host=await f.start;await f.entered.promise;
 const outcome=await host.stop();await host.finished;assert.equal(f.utf8Mutations(),1);
 assert.equal(outcome.children_stopped,false);assert.equal(f.terminals.length,0);assert.equal((await f.status()).native_publication_schema.state,'CLEANUP_HOLD');
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
});
test('distinct malformed UTF8 preimage bytes cannot authorize a status rename even when both decode to U+FFFD',async t=>{
 const f=await fixture(t,'status-utf8-preimage','service_role'),host=await f.start;await f.waitStatus('UNSUPPORTED_PROFILE');
 await f.armUtf8Preimage();const before=f.renames();
 try{await assert.rejects(f.reportHealth({event:'health_recovered'}),/status_write_failed/);assert.equal(f.renames(),before);assert.equal(f.utf8Mutations(),2);}
 finally{await host.stop();await host.finished;}
});
