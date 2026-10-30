// Generated private dependencies exercise actual runtime-host startup/finalize.
// These tests prove lifetime ordering only, not installed Windows bootstrap.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startManagedRuntimeHost,setNativeStartupFixture,closeLoader} from './test/native-host-startup-lifecycle-loader.mjs';
after(closeLoader);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t,stage){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-host-startup-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(root,'bundle'),expected_bundle_sha256:'a'.repeat(64),
  state_directory:path.join(root,'state'),pg_data_directory:path.join(root,'state/data'),database_url:'postgres://synthetic:private@127.0.0.1:25434/postgres',
  inspect_database_url:'postgres://synthetic:private@127.0.0.1:25434/postgres',api_port:25432,edge_port:25433,startup_timeout_ms:1000};
 await fs.mkdir(config.bundle_directory);await fs.mkdir(config.pg_data_directory,{recursive:true});
 await fs.writeFile(path.join(config.pg_data_directory,'PG_VERSION'),'17\n');await fs.writeFile(path.join(config.pg_data_directory,'client-vault.key'),'b'.repeat(64)+'\n');
 await fs.writeFile(path.join(config.pg_data_directory,'postmaster.pid'),`1234\n${config.pg_data_directory}\n1790000000\n25434\n\n127.0.0.1\nready\n`);
 if(stage!=='missing-operator')await fs.writeFile(path.join(config.state_directory,'native-coding-operator-v1.json'),'generated fixture, intercepted reader');
 const configFile=path.join(root,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
 const pending=gate(),entered=gate(),finished=gate(),afterStop=gate(),afterRead=gate(),events=[],terminals=[];
 const pause=async name=>{events.push(name);if(stage===name){entered.resolve();await pending.promise;}};
 let capacityClosed=false,capacityRead=null;
 const capacityFixture=stage==='capacity-read'?{operations:{READ_NATIVE_CAPACITY_V1(){
  capacityRead=(async()=>{await pause('capacity-read');events.push('capacity-after-stop');afterRead.resolve();await afterStop.promise;if(capacityClosed)throw Error('fixture_capacity_closed');})();return capacityRead;
 }},close(){capacityClosed=true;events.push('capacity-close');},async drain(){if(capacityRead)await capacityRead.catch(()=>{});events.push('capacity-drained');}}:null;
 setNativeStartupFixture({capacityFixture,readOperator:()=>pause('operator'),sql:{unsafe:async()=>[],reserve:async()=>{throw Error('fixture_unused_reservation');},begin:()=>{throw Error('fixture_raw_driver_begin_forbidden');},end:async()=>{events.push('sql-close');}},
  binding:{prepare:()=>pause('seed'),operations:{},close:()=>events.push('binding-close'),drain:()=>pause('drain')},
  createAuthority:async({sql,serviceHeartbeatOperations,callbackPublicationIdentity,readCallbackPrefix,readPublicationHost,readOwnerControl})=>{
   assert.equal(readOwnerControl,null,'default Host cannot invent Main W74 custody');assert.equal(callbackPublicationIdentity.hostPid,process.pid);
   assert.equal(callbackPublicationIdentity.postgresIdentity,runtime.postgresIdentity);assert.match(callbackPublicationIdentity.hostInstanceId,/^[a-f0-9-]{36}$/);
   assert.equal(typeof readCallbackPrefix,'function');assert.equal(typeof readPublicationHost,'function');
   for(const name of ['SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT','SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2'])assert.equal(typeof serviceHeartbeatOperations?.[name],'function');assert.equal(typeof sql.begin,'function');await assert.rejects(sql.begin('read write',async()=>{}),/dependencies_required/);await pause('authority');return {...serviceHeartbeatOperations,close:()=>{serviceHeartbeatOperations.close();events.push('authority-close');}};}});
 const runtime={endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',instanceId:randomUUID(),stopped:false,
  postgresIdentity:{pid:1234,version:170007,system_identifier:'7654321098765432100',started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434},
  edgeHealth:{runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}},
  children:[],startupManifest:{source_manifest_sha256:'c'.repeat(64)},finished:finished.promise,
  async stop(reason){events.push('runtime-stop');if(stage==='capacity-read'){assert.equal(capacityClosed,true);pending.resolve();}runtime.stopped=true;const outcome={reason,children_stopped:true};finished.resolve(outcome);return outcome;}};
 const controller=new AbortController();
 const start=startManagedRuntimeHost({configFile,signal:controller.signal},{verifyBundle:async()=>({manifest:{reviewed_startup_files_sha256:'d'.repeat(64)},paths:{
  hostEntry:fileURLToPath(new URL('./runtime-host.mjs',import.meta.url)),nodeExecutable:process.execPath,postgresBinDirectory:root,denoExecutable:process.execPath,denoDirectory:root}}),
  stageDenoCache:async()=>root,stageDenoExecutable:async()=>process.execPath,launchRuntime:async()=>runtime,
  onTerminal:outcome=>{events.push('terminal');terminals.push(outcome);}}).then(value=>({value}),error=>({error}));
 return {root,config,runtime,start,pending,entered,afterStop,afterRead,events,terminals,finished,controller};
}
for(const stage of ['operator','seed','authority'])for(const ending of ['child-exit','cancel'])test(`${ending} joins pending native ${stage} startup before SQL close and ownership release`,{timeout:10000},async t=>{
 const f=await fixture(t,stage);await f.entered.promise;
 if(ending==='cancel')f.controller.abort();
 else{f.runtime.stopped=true;f.finished.resolve({reason:'generated_runtime_end',children_stopped:true});}
 // Give the actual asynchronous status/lock finalization time to run before
 // releasing acquisition; a premature terminal or SQL close is the regression.
 await new Promise(resolve=>setTimeout(resolve,60));
 const prematureTerminal=f.terminals.length,prematureSqlClose=f.events.includes('sql-close');
 const lockPresent=await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')).then(()=>true,()=>false);
 f.pending.resolve();const outcome=await f.start;
 assert.equal(prematureTerminal,0);assert.equal(prematureSqlClose,false);assert.equal(lockPresent,true);
 assert.match(outcome.error?.message||'',/runtime_host_child_ended_during_startup/);
 assert.equal(f.terminals.length,1);assert.equal(f.terminals[0].children_stopped,true);
 if(stage!=='operator')assert.ok(f.events.indexOf('sql-close')<f.events.indexOf('terminal'));
 if(stage==='authority')assert.ok(f.events.indexOf('authority-close')<f.events.indexOf('sql-close'));
 await assert.rejects(fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')),{code:'ENOENT'});
});

test('successful native startup remains mounted until ordinary Host shutdown',async t=>{
 const f=await fixture(t,'none');const outcome=await f.start;assert.equal(outcome.error,undefined);
 assert.ok(outcome.value.nativeCodingAuthority);
 for(const name of ['SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT','SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2']){
  assert.equal(typeof outcome.value.nativeCodingAuthority[name],'function');
  await assert.rejects(outcome.value.nativeCodingAuthority[name]({}),/request_invalid/);
 }
 assert.equal(f.terminals.length,0);assert.equal(f.events.includes('sql-close'),false);
 await outcome.value.stop();await outcome.value.finished;
 assert.equal(f.terminals.length,1);assert.ok(f.events.indexOf('authority-close')<f.events.indexOf('sql-close'));
 assert.ok(f.events.indexOf('sql-close')<f.events.indexOf('terminal'));
});


test('Host shutdown after successful startup joins active native preparation drain before SQL and lock release',async t=>{
 const f=await fixture(t,'drain'),started=await f.start;assert.equal(started.error,undefined);
 const stopping=started.value.stop();await f.entered.promise;await new Promise(r=>setTimeout(r,30));
 assert.equal(f.events.includes('sql-close'),false);assert.equal(f.terminals.length,0);
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
 f.pending.resolve();await stopping;await started.value.finished;
 assert.ok(f.events.indexOf('drain')<f.events.indexOf('sql-close'));assert.equal(f.terminals.length,1);
});

test('actual Host mounts setup-only signed capability without operator descriptor, never core execution methods',async t=>{
 const f=await fixture(t,'missing-operator'),result=await f.start;assert.equal(result.error,undefined);const a=result.value.nativeCodingAuthority;
 for(const name of ['DISCOVER_NATIVE_SETUP_V1','BEGIN_NATIVE_SETUP_V1','READ_NATIVE_SETUP_V1','CANCEL_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1','READ_NATIVE_CAPACITY_V1'])assert.equal(typeof a[name],'function');
 for(const name of ['SEED_GOAL','RESERVE_EXECUTION','READ_SCOPE','ACTIVATE_PREPARED_GOAL_V1','SERVICE_HEARTBEAT','SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2'])assert.equal(a[name],undefined);
 assert.ok(!f.events.includes('operator'));assert.ok(!f.events.includes('seed'));assert.ok(!f.events.includes('authority'));
 await assert.rejects(a.DISCOVER_NATIVE_SETUP_V1({}),/request_invalid/);await assert.rejects(a.READ_NATIVE_CAPACITY_V1({}),/request_invalid/);await result.value.stop();await result.value.finished;
 assert.equal(f.terminals.length,1);assert.ok(f.events.indexOf('sql-close')<f.events.indexOf('terminal'));
});

test('explicit Host stop can settle held census SQL, then joins its exact remaining callback before lock release',async t=>{
 const f=await fixture(t,'capacity-read'),started=await f.start;assert.equal(started.error,undefined);
 const read=started.value.nativeCodingAuthority.READ_NATIVE_CAPACITY_V1();const rejected=assert.rejects(read,/fixture_capacity_closed/);await f.entered.promise;
 const stop=started.value.stop();assert.equal(started.value.stop(),stop);await f.afterRead.promise;
 assert.equal(f.events.filter(x=>x==='runtime-stop').length,1);assert.equal(f.events.includes('sql-close'),false);assert.equal(f.terminals.length,0);
 assert.ok(await fs.stat(path.join(f.config.state_directory,'runtime-host-lock.json')));
 f.afterStop.resolve();await rejected;await stop;await started.value.finished;
 assert.equal(f.events.filter(x=>x==='runtime-stop').length,1);assert.ok(f.events.indexOf('capacity-drained')<f.events.indexOf('sql-close'));assert.equal(f.terminals.length,1);
});
