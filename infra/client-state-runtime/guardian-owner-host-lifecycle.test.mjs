// SYNTHETIC lifecycle-only tests. Real Host control flow, fake acquired service
// and runtime children; not native Windows/PG/package/Guardian proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {startManagedRuntimeHost,setAcquisitionFactory} from './test/guardian-host-lifecycle-loader.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const nonce=randomUUID();
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'guardian-host-lifecycle-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const oldNonce=process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE;process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE=nonce;
  t.after(()=>{if(oldNonce===undefined)delete process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE;else process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE=oldNonce;});
  const config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(root,'bundle'),expected_bundle_sha256:'a'.repeat(64),
    state_directory:path.join(root,'state'),pg_data_directory:path.join(root,'state/data'),
    database_url:'postgres://synthetic:private@127.0.0.1:25434/postgres',inspect_database_url:'postgres://synthetic:private@127.0.0.1:25434/postgres',
    api_port:25432,edge_port:25433,startup_timeout_ms:1000};
  await fs.mkdir(config.bundle_directory);await fs.mkdir(config.pg_data_directory,{recursive:true});
  await fs.writeFile(path.join(config.pg_data_directory,'PG_VERSION'),'17\n');await fs.writeFile(path.join(config.pg_data_directory,'client-vault.key'),'b'.repeat(64)+'\n');
  await fs.writeFile(path.join(config.pg_data_directory,'postmaster.pid'),`1234\n${config.pg_data_directory}\n1790000000\n25434\n\n127.0.0.1\nready\n`);
  const configFile=path.join(root,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
  let finish,stops=0;const terminals=[];
  const runtime={endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',instanceId:randomUUID(),stopped:false,
    postgresIdentity:{pid:1234,version:170007,system_identifier:'7654321098765432100',started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434},
    edgeHealth:{runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}},
    children:[],startupManifest:{source_manifest_sha256:'c'.repeat(64)},finished:new Promise(resolve=>{finish=resolve;}),
    async stop(reason){stops++;runtime.stopped=true;const outcome={reason,children_stopped:true};finish(outcome);return outcome;}};
  const host=await startManagedRuntimeHost({configFile},{verifyBundle:async()=>({manifest:{reviewed_startup_files_sha256:'d'.repeat(64)},paths:{
    hostEntry:fileURLToPath(new URL('./runtime-host.mjs',import.meta.url)),nodeExecutable:process.execPath,postgresBinDirectory:root,denoExecutable:process.execPath,denoDirectory:root}}),
    stageDenoCache:async()=>root,stageDenoExecutable:async()=>process.execPath,launchRuntime:async()=>runtime,onTerminal:outcome=>terminals.push(outcome)});
  const body={schema:'metaengine.private.guardian-owner-consume.v1',request_id:randomUUID(),host_instance_id:runtime.instanceId,
    host_pid:process.pid,parent_pid:process.ppid,launch_nonce:nonce,challenge_sha256:'b'.repeat(64),ticket:'A'.repeat(43),ticket_sha256:hash('A'.repeat(43)),
    owner_sid_sha256:'c'.repeat(64),key_fingerprint_sha256:'d'.repeat(64),admin_grant_epoch:1};
  const message={body,headers:{'content-type':'application/json','x-a2-chat-bridge-client':randomUUID(),'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-id':randomUUID(),'x-a2-device-timestamp':new Date().toISOString(),'x-a2-device-nonce':'a'.repeat(32),
    'x-a2-device-body-sha256':hash(json(body)),'x-a2-device-signature':'A'.repeat(86)}};
  return {host,message,runtime,terminals,stops:()=>stops,lock:path.join(config.state_directory,'runtime-host-lock.json')};
}
test('normal startup and malformed private messages do not acquire, stop fences synchronously',async t=>{
  let acquisitions=0,dispatches=0,closed=false,signal;
  setAcquisitionFactory(async options=>{acquisitions++;signal=options.signal;return {async handleMessage(){dispatches++;},async close(){closed=true;}};});
  const f=await fixture(t);assert.equal(acquisitions,0);
  await f.host.handleGuardianTicketMessage({body:{schema:f.message.body.schema}});assert.equal(acquisitions,0);
  await f.host.handleGuardianTicketMessage(f.message);assert.equal(acquisitions,1);assert.equal(dispatches,1);
  const stopping=f.host.stop();assert.equal(signal.aborted,true);assert.equal(closed,true);
  await f.host.handleGuardianTicketMessage(f.message);await stopping;assert.equal(dispatches,1);assert.equal(f.stops(),1);assert.equal(f.terminals.length,1);
});
test('late acquisition after stop is closed without dispatch or reopening',async t=>{
  let deliver,closed=0,dispatches=0,signal;
  setAcquisitionFactory(options=>{signal=options.signal;return new Promise(resolve=>{deliver=resolve;});});
  const f=await fixture(t),message=f.host.handleGuardianTicketMessage(f.message);await Promise.resolve();
  const stopping=f.host.stop();assert(signal.aborted);deliver({async close(){closed++;},async handleMessage(){dispatches++;}});
  await message;await stopping;await f.host.handleGuardianTicketMessage(f.message);
  assert.equal(closed,1);assert.equal(dispatches,0);assert.equal(f.stops(),1);
});
for(const stage of ['acquisition','drain'])test('permanently pending '+stage+' cannot prevent owned child stop or claim clean terminal',{timeout:18000},async t=>{
  setAcquisitionFactory(()=>stage==='acquisition'?new Promise(()=>{}):Promise.resolve({async handleMessage(){},close(){return new Promise(()=>{});}}));
  const f=await fixture(t),message=f.host.handleGuardianTicketMessage(f.message);await Promise.resolve();
  if(stage==='drain')await message;
  await assert.rejects(f.host.stop(),/cleanup_unconfirmed/);await message;
  assert.equal(f.stops(),1);assert.equal(f.terminals.length,0);assert.equal((await f.host.finished).children_stopped,false);
  assert.equal((await fs.stat(f.lock)).isFile(),true);assert.equal(JSON.parse(await fs.readFile(f.host.statusFile,'utf8')).state,'FAILED');
});
