import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {createNativeRunCallbackJournal,readNativeRunCallbackJournal} from '../src/native-coding-run-callback-journal.mjs';

// Actual parent/child IPC and journal IO. Publication/Owner/PG below are
// GENERATED transport fixtures, not production authorization or PG evidence.
const serverUrl=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const settlementUrl=new URL('../src/native-coding-host-settlement.mjs',import.meta.url).href;
const id=()=>randomUUID();
function request(){return {operation:'CHECK',args:{},binding:{run_id:id(),workspace_id:id(),project_id:id(),task_id:id(),
 lease_generation:1,agent_id:'agent_handoff-test123',agent_generation_epoch:1,provider_id:id(),role:'IMPLEMENTER'},
 job_binding:{job_id:id(),pid:1234,process_incarnation_id:'pid:1234:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)}};}
async function setup(t,mode='normal',{budget=1,timeoutMs=2000,serverTimeoutMs=2000}={}){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'native-publication-handoff-'));
 const instanceId=id(),script=path.join(root,'host.mjs');
 await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(serverUrl)};
import {markNativePhysicalSettlementUnconfirmed} from ${JSON.stringify(settlementUrl)};
const mode=${JSON.stringify(mode)},events=[],waiting=new Map(),custodies=new WeakSet();
let revision=0;
const held=key=>new Promise(resolve=>waiting.set(key,resolve));
const operations=Object.fromEntries(['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT']
 .map(action=>[action,async value=>{events.push({stage:'operation',action,run:value.binding?.run_id});return action==='READ_SCOPE'?{bindings:[]}:{fixture_transport_only:true,operation:value.operation};}]));
const callbackPublication=mode==='unmounted'?null:{
 async publish(intent,context){
  events.push({stage:'publish',intent,requestId:context.requestId});
  process.send({test:'published',run:intent.binding.run_id});
  if(mode==='held-publication')await held('publication');
  if(mode==='rollback')throw Error('generated rollback');
  if(mode==='poison')throw markNativePhysicalSettlementUnconfirmed(Error('generated poisoned reservation'));
  if(mode==='owner-missing')throw Error('native_callback_publication_owner_custody_unbound');
  const custody={intent,revision:++revision};custodies.add(custody);return custody;
 },
 async recheck(custody,context){
  if(!custodies.has(custody))throw Error('generated custody mismatch');
  events.push({stage:'recheck',run:custody.intent.binding.run_id,revision:custody.revision,current:revision});
  process.send({test:'recheck',run:custody.intent.binding.run_id});
  if(mode==='held-recheck')await held(custody.intent.binding.run_id);
  if(mode==='owner-changed')throw Error('generated Owner generation changed');
  if(mode==='pg-changed')throw Error('generated PG identity changed');
  if(mode==='kernel-changed')throw Error('generated kernel identity changed');
  if(context.signal.aborted)throw Error('generated request aborted');
  custodies.delete(custody);
 }
};
const send=(frame,callback)=>{
 if(frame.action==='PUBLISH_RUN_CALLBACK_V1'){
  const terminal=frame.schema==='metaengine.native-coding.host-settlement.v1';
  if(mode==='hold-response'&&!terminal){waiting.set('response',()=>process.send(frame,callback));return;}
  if(mode==='hold-terminal'&&terminal){waiting.set('terminal',()=>process.send(frame,callback));return;}
  if(mode==='wrong-terminal'&&terminal){process.send({...frame,request_sha256:'0'.repeat(64)},callback);return;}
 }
 process.send(frame,callback);
};
const server=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations,callbackPublication,send,
 maxInflight:${budget},timeoutMs:${serverTimeoutMs}});
process.on('message',m=>{
 if(m.test==='stats'){process.send({test:'stats',events,snapshot:server.snapshot()});return;}
 if(m.test==='release'){const r=waiting.get(m.key);waiting.delete(m.key);r?.();return;}
 if(m.test==='close'){server.close();return;}
 server.handleMessage(m);
});
process.on('disconnect',()=>process.exit(0));process.send({test:'ready'});
`);
 const child=fork(script,[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 const messages=[];child.on('message',m=>messages.push(m));
 const until=async predicate=>{for(let n=0;n<2000;n++){const found=messages.find(predicate);if(found)return found;await sleep(2);}throw Error('fixture_event_timeout');};
 await until(m=>m.test==='ready');
 const client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,maxInflight:budget,timeoutMs});
 t.after(async()=>{client.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await fs.rm(root,{recursive:true,force:true});});
 const stats=async()=>{for(let i=messages.length-1;i>=0;i--)if(messages[i].test==='stats')messages.splice(i,1);child.send({test:'stats'});return until(m=>m.test==='stats');};
 async function run(){
  const value=request(),directory=path.join(root,value.binding.run_id);await fs.mkdir(directory);
  const journal=await createNativeRunCallbackJournal({directory,runId:value.binding.run_id,binding:{...value.binding,base_sha:'a'.repeat(40)}});
  const facet=await client.openPublishedAgentRunCustody({binding:value.binding,journal});return {value,directory,facet};
 }
 return {child,client,instanceId,until,stats,run,release:key=>child.send({test:'release',key})};
}
const operations=stats=>stats.events.filter(e=>e.stage==='operation'&&e.action==='AGENT_OPERATION');

test('one existing admission ticket covers durable intent, publication and original request at budget one',async t=>{
 const x=await setup(t,'held-publication'),r=await x.run(),work=r.facet.agentOperation(r.value);
 await x.until(m=>m.test==='published');
 assert.equal(x.client.snapshot().physical_inflight,1);assert.equal((await x.stats()).snapshot.inflight,1);
 await assert.rejects(x.client.readScope(),/INFLIGHT_LIMIT/);
 const second=await x.run();await assert.rejects(second.facet.agentOperation(second.value),/INFLIGHT_LIMIT/);
 x.release('publication');await work;await x.client.drainPhysical();
 const state=await r.facet.finish();assert.equal(state.requests,1);assert.equal(state.state,'SCOPED_REQUESTS_JOINED');
 assert.equal(operations(await x.stats()).length,1);assert.equal(x.client.snapshot().physical_inflight,0);
 await second.facet.finish();
});
for(const mode of ['hold-response','hold-terminal'])test('original requires both exact publication response and settlement: '+mode,async t=>{
 const x=await setup(t,mode),r=await x.run(),work=r.facet.agentOperation(r.value);
 await x.until(m=>m.test==='published');await sleep(40);
 assert.equal(operations(await x.stats()).length,0);assert.equal(x.client.snapshot().physical_inflight,1);
 x.release(mode==='hold-response'?'response':'terminal');await work;await x.client.drainPhysical();
 assert.equal(operations(await x.stats()).length,1);await r.facet.finish();
});
test('lost publication ACK stays unknown and late exact ACK never sends the original',async t=>{
 const x=await setup(t,'hold-response',{timeoutMs:150,serverTimeoutMs:1000}),r=await x.run(),work=r.facet.agentOperation(r.value);work.catch(()=>{});
 await x.until(m=>m.test==='published');await assert.rejects(work,e=>e.automatic_retry_allowed===false);
 x.release('response');await sleep(40);assert.equal(operations(await x.stats()).length,0);
 await x.client.drainPhysical();const result=await r.facet.finish();assert.equal(result.unsent,1);
});
for(const mode of ['rollback','owner-missing','owner-changed','pg-changed','kernel-changed','unmounted'])test('publication handoff holds without valid commit and current control: '+mode,async t=>{
 const x=await setup(t,mode),r=await x.run();await assert.rejects(r.facet.agentOperation(r.value));
 await x.client.drainPhysical();assert.equal(operations(await x.stats()).length,0);await r.facet.finish();
});
test('foreign publication terminal cannot be used as the original physical settlement',async t=>{
 const x=await setup(t,'wrong-terminal'),r=await x.run();await assert.rejects(r.facet.agentOperation(r.value),/RESPONSE_INVALID|CHANNEL_CLOSED/);
 assert.equal(operations(await x.stats()).length,0);assert.equal(x.client.snapshot().closed,true);
});
test('publication poison keeps the same physical slot held and cannot mint original send',async t=>{
 const x=await setup(t,'poison'),r=await x.run();await assert.rejects(r.facet.agentOperation(r.value));
 assert.equal(x.client.snapshot().physical_inflight,1);assert.equal((await x.stats()).snapshot.inflight,1);
 await assert.rejects(x.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 assert.equal(operations(await x.stats()).length,0);
});
test('client close during publication prevents original dispatch after the publication settles',async t=>{
 const x=await setup(t,'held-publication'),r=await x.run(),work=r.facet.agentOperation(r.value);work.catch(()=>{});
 await x.until(m=>m.test==='published');x.client.close();await assert.rejects(work);x.release('publication');
 await x.client.drainPhysical();assert.equal(operations(await x.stats()).length,0);
 assert.equal((await r.facet.finish()).unsent,1);
});
test('Host close while current control is being rechecked forbids later effect dispatch',async t=>{
 const x=await setup(t,'held-recheck'),r=await x.run(),work=r.facet.agentOperation(r.value);work.catch(()=>{});
 await x.until(m=>m.test==='recheck');x.child.send({test:'close'});await assert.rejects(work);x.release(r.value.binding.run_id);
 await x.client.drainPhysical();assert.equal(operations(await x.stats()).length,0);await r.facet.finish();
});
test('two independently published tickets keep their original custody when a later publication advances',async t=>{
 const x=await setup(t,'held-recheck',{budget:2}),a=await x.run(),b=await x.run();
 const first=a.facet.agentOperation(a.value);await x.until(m=>m.test==='recheck'&&m.run===a.value.binding.run_id);
 const second=b.facet.agentOperation(b.value);await x.until(m=>m.test==='recheck'&&m.run===b.value.binding.run_id);
 assert.equal(x.client.snapshot().physical_inflight,2);assert.equal((await x.stats()).snapshot.inflight,2);
 x.release(b.value.binding.run_id);await second;x.release(a.value.binding.run_id);await first;
 await x.client.drainPhysical();assert.equal(operations(await x.stats()).length,2);await a.facet.finish();await b.facet.finish();
});
test('publication frame carries only intent hashes and leaves the v1 original frame unchanged',async t=>{
 const x=await setup(t),r=await x.run();await r.facet.agentOperation(r.value);await x.client.drainPhysical();
 const body='PRIVATE_INTENT_BODY_NEVER_PUBLISHED';await r.facet.agentOperation({...r.value,operation:'agent_send_message',args:{request_id:id(),target_agent_id:'agent_native-peer123',message:body}});
 await x.client.drainPhysical();await r.facet.finish();const records=(await x.stats()).events.filter(e=>e.stage==='publish');
 assert.equal(records.length,2);assert.equal(JSON.stringify(records).includes(body),false);
 for(const e of records)assert.deepEqual(Object.keys(e.intent).sort(),['binding','job_binding_sha256','operation','request_id','request_sha256']);
 const journal=await readNativeRunCallbackJournal(r.directory);assert.equal(journal.requests,2);
});
test('Host pending publication custody consumes the same inflight slot even after physical publication settled',async t=>{
 const x=await setup(t,'hold-response'),r=await x.run(),work=r.facet.agentOperation(r.value);
 await x.until(m=>m.test==='published');await sleep(30);
 const before=await x.stats();assert.equal(before.snapshot.inflight,1);assert.equal(before.snapshot.pending_publication,1);
 const other=id();x.child.send({schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:x.instanceId,host_pid:x.child.pid,request_id:other,action:'READ_SCOPE',payload:{}});
 const refused=await x.until(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1'&&m.request_id===other);
 assert.equal(refused.reason,'INFLIGHT_LIMIT');assert.equal(operations(await x.stats()).length,0);
 x.release('response');await work;await x.client.drainPhysical();await r.facet.finish();
});
test('changed original digest cannot consume a pending ticket even with a valid v1 payload',async t=>{
 const x=await setup(t),r=await x.run(),send=x.child.send.bind(x.child);
 x.child.send=(frame,...rest)=>send(frame.action==='AGENT_OPERATION'?{...frame,payload:{...frame.payload,job_binding:{...frame.payload.job_binding,job_id:id()}}}:frame,...rest);
 await assert.rejects(r.facet.agentOperation(r.value),/REQUEST_ID_REUSED|RESPONSE_INVALID/);
 assert.equal(operations(await x.stats()).length,0);
});
test('replaying the exact completed original frame cannot consume publication custody twice',async t=>{
 const x=await setup(t),r=await x.run(),send=x.child.send.bind(x.child);let original;
 x.child.send=(frame,...rest)=>{if(frame.action==='AGENT_OPERATION')original=structuredClone(frame);return send(frame,...rest);};
 await r.facet.agentOperation(r.value);await x.client.drainPhysical();send(original);await sleep(30);
 assert.equal(operations(await x.stats()).length,1);assert.equal((await x.stats()).snapshot.pending_publication,0);await r.facet.finish();
});
