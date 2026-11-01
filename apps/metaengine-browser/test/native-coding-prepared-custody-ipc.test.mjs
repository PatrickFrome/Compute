import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {createNativeCodingPreparedCustodyAdapter} from '../src/native-coding-prepared-custody-adapter.mjs';
import {createLoadedNativeRunOwnerCallback} from '../src/native-coding-run-owner-main.mjs';
import {createNativeRunCallbackJournal,readNativeRunCallbackJournal} from '../src/native-coding-run-callback-journal.mjs';
import {prepareNativeCodingAgentRunBridge} from '../src/native-coding-agent-run-bridge.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
const id=()=>randomUUID(),tick=()=>new Promise(resolve=>setImmediate(resolve));
// Actual IPC client/server, adapter, direct Main callback, and filesystem
// journal. SQL/publication/Owner data are GENERATED fixtures, not native trust.
async function fixture(t,{mode='normal',ownerHold=null,claimHold=null,bridge='generated'}={}){
 const f=generatedRunOwnerRead(),scope={...f.scope.execution};delete scope.reservation_id;
 const runId=id(),instanceId=id(),expiry=new Date(Date.now()+60000).toISOString(),root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'prepared-adapter-ipc-'));
 const directory=path.join(root,'run');await fs.mkdir(directory);
 const binding=Object.freeze({task_id:scope.task_id,agent_id:scope.agent_id,lease_generation:scope.lease_generation,
  agent_generation_epoch:scope.agent_generation_epoch,base_sha:'a'.repeat(40),role:'IMPLEMENTER'});
 const permit={permit_id:id(),provider_id:scope.target_id.slice('codex-cli:'.length),workspace_id:scope.workspace_id,project_id:f.scope.project_id,
  agent_id:scope.agent_id,agent_generation_epoch:scope.agent_generation_epoch,role:binding.role,owner_epoch:1,user_sid:'S-1-5-21-111-1001',revoked:false,
  trust_namespace:'LOCAL_OPERATOR_QA',expires_at:expiry,worktree:{path:path.join(root,'worktree'),base_sha:binding.base_sha},artifact:{cli_executable_sha256:'a'.repeat(64)}};
 const journal=await createNativeRunCallbackJournal({directory,runId,binding}),script=path.join(root,'host.mjs');
 await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href)};
import {nativeCallbackInitialPublicationAck} from ${JSON.stringify(new URL('../src/native-coding-publication-handoff-contract.mjs',import.meta.url).href)};
const f=${JSON.stringify(f)},mode=${JSON.stringify(mode)};let held;
const operations=Object.fromEntries(['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'].map(action=>[action,async()=>({fixture_only:true})]));
operations.RESERVE_EXECUTION=async(input,ctx)=>{
 process.send({test:'reserved'});
 if(mode==='readback')return {state:'READBACK_ONLY',execution:null,automatic_retry_allowed:false,authority_effect:false};
 for(let i=0;i<6;i++)await ctx.runOwnerPhases.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}});
 if(mode==='unknown')throw Error('generated_unknown');
 return {state:'RESERVED',scope:f.scope.execution,execution:{...f.scope.execution,state:'RESERVED'},automatic_retry_allowed:false,authority_effect:false,
 initial_callback_publication:nativeCallbackInitialPublicationAck({schema:'metaengine.native-coding.callback-publication.v1',job_sha256:null,
 root:{scope:f.scope.execution,reserve_request_id:ctx.requestId,run_id:${JSON.stringify(runId)}},
 cursor:{revision:0,record_count:2,intent_count:0,dispatch_fenced:false,head_sha256:'a'.repeat(64)}},f.scope.execution,ctx.requestId)};
};
const send=(frame,callback)=>{if(mode==='hold-ack'&&frame.action==='RESERVE_EXECUTION'&&frame.schema==='metaengine.native-coding.host-ipc.response.v1'){
 held=()=>process.send(frame,callback);process.send({test:'ack-held'});return;}process.send(frame,callback);};
const server=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations,send});
process.on('message',message=>{if(message.test==='release'){held?.();return;}server.handleMessage(message);});
process.on('disconnect',()=>process.exit(0));process.send({test:'ready'});
`);
 const child=fork(script,[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true}),messages=[];child.on('message',m=>messages.push(m));
 const until=async predicate=>{for(let i=0;i<1000;i++){const found=messages.find(predicate);if(found)return found;await sleep(5);}throw Error('generated_host_event_missing');};
 await until(m=>m.test==='ready');const client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs:3000});
 let ownerCalls=0,opens=0,takes=0,runs=0,retainedTake;const ownerEntered=Promise.withResolvers(),claimEntered=Promise.withResolvers();
 const ownPostgres={...client,async prepareAgentRunCustody(options){const token=await client.prepareAgentRunCustody(options);claimEntered.resolve();await claimHold;return token;},reserveExecution(){throw Error('legacy reserve forbidden');},withRunOwnerScope(){throw Error('nested IPC forbidden');},drainPhysical(){throw Error('global drain forbidden');},
  openAgentRunCustody(){opens++;throw Error('reclaim forbidden');},takePreparedAgentRunCustody(token){takes++;return client.takePreparedAgentRunCustody(token);}};
 const direct=createLoadedNativeRunOwnerCallback({capability:ownPostgres,assertOpen(){},identity:{snapshot:()=>({enrolled:true,device_id:'generated-device',client_id:'generated-client',key_fingerprint_sha256:'a'.repeat(64)}),
  async readLoadedRunOwnerW74({scope,signal,assertLifetime}){ownerCalls++;assert.equal(signal,scope.signal);assertLifetime();ownerEntered.resolve();await ownerHold;
   await scope.readScope();await scope.verifyOwnerRecord(f.evidence);assertLifetime();return f.evidence;}}});
 const adapter=createNativeCodingPreparedCustodyAdapter({ownPostgres,ownerCallback:direct,assertOpen(){}}),abort=new AbortController();
 const descriptor=Object.freeze({schema:'metaengine.codex-cli.prepared-run.v1',state:'PREPARED',runId,binding,callbackJournal:journal,
  worktreePath:permit.worktree.path,expiresAt:expiry,sql_reservation:'NOT_ATTESTED',authority_effect:false,automatic_retry_allowed:false,production_qualified:false}),handle=Object.freeze({});
 const details={runId,binding,callbackJournal:journal,deadlineAt:expiry,authorization:{...binding,authorized:true,trust_namespace:'LOCAL_OPERATOR_QA',
  permit_id:permit.permit_id,owner_epoch:permit.owner_epoch,workspace_id:permit.workspace_id,project_id:permit.project_id,user_sid:permit.user_sid,worktree_path:permit.worktree.path}};
 let bound;const runner={describePrepared:()=>descriptor,abandonPrepared(){},async runPrepared(){runs++;return bound.prepareBridge(details,async take=>{
  retainedTake=take;if(bridge==='default')return prepareNativeCodingAgentRunBridge({...details,ownPostgres,permit,pins:{},takePreparedCustody:take});
  const facet=take();assert.throws(()=>take(),/custody_consumed/);return {close:()=>facet.fence(),drainCallbacks:()=>facet.finish()};
 });}};
 bound=adapter.bindRunner({runner,handle,permit,signal:abort.signal});
 t.after(async()=>{adapter.close();client.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  await adapter.drain().catch(()=>{});await client.drainPhysical({wait:false}).catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
 return {adapter,bound,handle,descriptor,scope,abort,child,client,directory,until,ownerEntered,claimEntered,
  reserve:()=>adapter.reserve(scope,{prepared:descriptor}),run:()=>bound.runPrepared(handle),get ownerCalls(){return ownerCalls;},get opens(){return opens;},get takes(){return takes;},get runs(){return runs;},
  get retainedTake(){return retainedTake;}};
}
async function kinds(f){return Promise.all((await fs.readdir(path.join(f.directory,'host-callback-custody'))).sort().map(async name=>JSON.parse(await fs.readFile(path.join(f.directory,'host-callback-custody',name))).event.kind));}

test('actual client original reservation and six direct Main reads yield one retained facet without nested IPC/drain',async t=>{
 const f=await fixture(t);await f.reserve();assert.equal(f.ownerCalls,6);assert.deepEqual(await kinds(f),['HEADER','BOUND']);
 await f.run();f.adapter.close();await f.adapter.drain();assert.equal(f.takes,1);assert.equal(f.opens,0);
 assert.throws(()=>f.retainedTake(),/closed|fenced|consumed/);assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE','CALLBACKS_JOINED','CANDIDATE']);
 assert.equal((await readNativeRunCallbackJournal(f.directory)).all_effects_cleanup,'UNCONFIRMED');
});
for(const mode of ['readback','unknown'])test('actual client '+mode+' cannot reach runner/bridge or replay original reserve',async t=>{
 const f=await fixture(t,{mode});if(mode==='unknown')await assert.rejects(f.reserve());else assert.equal((await f.reserve()).state,'READBACK_ONLY');
 assert.throws(()=>f.run(),/fenced/);await assert.rejects(f.reserve());f.adapter.close();await f.adapter.drain();
 assert.equal(f.ownerCalls,mode==='readback'?0:6);assert.equal(f.takes,0);assert.equal(f.runs,0);assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);
});
test('actual client cancel after reservation but before bridge fences original BOUND without a new claim',async t=>{
 const f=await fixture(t);await f.reserve();f.abort.abort();assert.throws(()=>f.run(),/fenced/);f.adapter.close();await f.adapter.drain();
 assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);assert.equal(f.takes,0);assert.equal(f.opens,0);
});
test('actual client close during held original ACK rejects late response without custody promotion',async t=>{
 const f=await fixture(t,{mode:'hold-ack'}),work=f.reserve();work.catch(()=>{});await f.until(m=>m.test==='ack-held');f.adapter.close();
 await assert.rejects(work);f.child.send({test:'release'});await f.adapter.drain();assert.equal(f.takes,0);assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);
});
test('actual held Main Owner callback remains joined after local close until original native read returns',async t=>{
 const hold=Promise.withResolvers(),f=await fixture(t,{ownerHold:hold.promise}),work=f.reserve();work.catch(()=>{});await f.ownerEntered.promise;
 f.adapter.close();let done=false;const drain=f.adapter.drain().then(()=>done=true);await tick();assert.equal(done,false);hold.resolve();
 await assert.rejects(work);await drain;assert.equal(f.takes,0);assert.equal(f.ownerCalls,1);assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);
});
test('actual default bridge remains closed even after adapter receives original verified reservation',async t=>{
 const f=await fixture(t,{bridge:'default'});await f.reserve();await assert.rejects(f.run(),/native_run_callback_directory_durability_unqualified/);
 f.adapter.close();await f.adapter.drain();assert.equal(f.takes,0);assert.equal(f.opens,0);assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);
});

for(const action of ['abort','close'])test('actual BOUND held before token return remains owned across '+action,async t=>{
 const hold=Promise.withResolvers(),f=await fixture(t,{claimHold:hold.promise}),work=f.reserve();work.catch(()=>{});await f.claimEntered.promise;
 assert.deepEqual(await kinds(f),['HEADER','BOUND']);if(action==='abort')f.abort.abort();else f.adapter.close();
 f.adapter.close();let done=false;const drain=f.adapter.drain().then(()=>done=true);await tick();assert.equal(done,false);
 hold.resolve();await assert.rejects(work);await drain;assert.equal(f.ownerCalls,0);assert.equal(f.takes,0);assert.equal(f.runs,0);
 assert.deepEqual(await kinds(f),['HEADER','BOUND','FENCE']);
});
