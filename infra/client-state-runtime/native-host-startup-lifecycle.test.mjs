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
 await fs.writeFile(path.join(config.state_directory,'native-coding-operator-v1.json'),'generated fixture, intercepted reader');
 const configFile=path.join(root,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
 const pending=gate(),entered=gate(),finished=gate(),events=[],terminals=[];
 const pause=async name=>{events.push(name);if(stage===name){entered.resolve();await pending.promise;}};
 setNativeStartupFixture({readOperator:()=>pause('operator'),sql:{unsafe:async()=>[],end:async()=>{events.push('sql-close');}},
  binding:{prepare:()=>pause('seed'),operations:{},close:()=>events.push('binding-close'),drain:()=>pause('drain')},
  createAuthority:async()=>{await pause('authority');return {close:()=>events.push('authority-close')};}});
 const runtime={endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',instanceId:randomUUID(),stopped:false,
  postgresIdentity:{pid:1234,version:170007,system_identifier:'7654321098765432100',started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434},
  edgeHealth:{runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}},
  children:[],startupManifest:{source_manifest_sha256:'c'.repeat(64)},finished:finished.promise,
  async stop(reason){runtime.stopped=true;const outcome={reason,children_stopped:true};finished.resolve(outcome);return outcome;}};
 const controller=new AbortController();
 const start=startManagedRuntimeHost({configFile,signal:controller.signal},{verifyBundle:async()=>({manifest:{reviewed_startup_files_sha256:'d'.repeat(64)},paths:{
  hostEntry:fileURLToPath(new URL('./runtime-host.mjs',import.meta.url)),nodeExecutable:process.execPath,postgresBinDirectory:root,denoExecutable:process.execPath,denoDirectory:root}}),
  stageDenoCache:async()=>root,stageDenoExecutable:async()=>process.execPath,launchRuntime:async()=>runtime,
  onTerminal:outcome=>{events.push('terminal');terminals.push(outcome);}}).then(value=>({value}),error=>({error}));
 return {root,config,runtime,start,pending,entered,events,terminals,finished,controller};
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
 assert.ok(outcome.value.nativeCodingAuthority);assert.equal(f.terminals.length,0);assert.equal(f.events.includes('sql-close'),false);
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
