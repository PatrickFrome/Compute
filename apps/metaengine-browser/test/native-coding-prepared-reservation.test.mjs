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
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
const serverUrl=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const ackUrl=new URL('../src/native-coding-publication-handoff-contract.mjs',import.meta.url).href;
const settlementUrl=new URL('../src/native-coding-host-settlement.mjs',import.meta.url).href;
const id=()=>randomUUID(),turn=()=>new Promise(resolve=>setImmediate(resolve));
// Actual original IPC server, fixed Owner cycles and filesystem journal. SQL,
// publication and Owner evidence are GENERATED fixtures, not native authority.
async function fixture(t,{mode='normal',timeoutMs=3000,budget=2,readShutdownSettlement=null}={}){
 const f=generatedRunOwnerRead(),instanceId=id(),binding={run_id:id(),workspace_id:f.scope.execution.workspace_id,project_id:f.scope.project_id,
  task_id:f.scope.execution.task_id,lease_generation:1,agent_id:f.scope.execution.agent_id,agent_generation_epoch:f.scope.execution.agent_generation_epoch,
  provider_id:f.scope.execution.target_id.slice('codex-cli:'.length),role:'IMPLEMENTER'},scope={...f.scope.execution};delete scope.reservation_id;
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'native-prepared-reservation-')),directory=path.join(root,'run');await fs.mkdir(directory);
 const journal=await createNativeRunCallbackJournal({directory,runId:binding.run_id,binding:{...binding,base_sha:'a'.repeat(40)}});
 const script=path.join(root,'host.mjs');await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(serverUrl)};
import {nativeCallbackInitialPublicationAck} from ${JSON.stringify(ackUrl)};
import {nativeCodingHostSettlement,markNativePhysicalSettlementUnconfirmed} from ${JSON.stringify(settlementUrl)};
const f=${JSON.stringify(f)},mode=${JSON.stringify(mode)},held=new Map();let context=null,reserves=0,cycles=0,publishedCycles=0,agentCycles=0,agents=0;
const waiting=key=>new Promise(resolve=>held.set(key,resolve));
const result=ctx=>({state:'RESERVED',scope:f.scope.execution,execution:{...f.scope.execution,state:'RESERVED'},automatic_retry_allowed:false,authority_effect:false,
 initial_callback_publication:nativeCallbackInitialPublicationAck({schema:'metaengine.native-coding.callback-publication.v1',job_sha256:null,
 root:{scope:f.scope.execution,reserve_request_id:ctx.requestId,run_id:${JSON.stringify(binding.run_id)}},
 cursor:{revision:0,record_count:2,intent_count:0,dispatch_fenced:false,head_sha256:'a'.repeat(64)}},f.scope.execution,ctx.requestId)});
const readback=()=>({state:'READBACK_ONLY',execution:null,automatic_retry_allowed:false,authority_effect:false});
const operations=Object.fromEntries(['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT']
 .map(action=>[action,async()=>({fixture_only:true})]));
operations.READ_SCOPE=async()=>{process.send({test:'read-started'});await waiting('read');return {bindings:[]};};
operations.RESERVE_EXECUTION=async(value,ctx)=>{
 context=ctx;reserves++;process.send({test:'reserve-started',request_id:ctx.requestId});
 if(mode==='readback')return readback();
 const n=mode==='five-cycles'?5:mode==='zero-cycles'?0:6;
 for(let i=0;i<n;i++){
  const current=structuredClone(f.scope);if(mode==='foreign-project')current.project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if(mode==='changed-root'&&i===1)current.root_task_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await ctx.runOwnerPhases.run(current,{readScope:async()=>current,verifyOwner:async()=>{}});cycles++;
 }
 if(mode==='rollback-poison')throw markNativePhysicalSettlementUnconfirmed(Error('generated rollback poison'));
 return mode==='readback-six'?readback():result(ctx);
};
operations.AGENT_OPERATION=async()=>{agents++;return {fixture_only:true};};
const round=ctx=>ctx.runOwnerPhases.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}});
const callbackPublication=mode.startsWith('published-')?{
 async publish(intent,ctx){
  if(mode==='published-held'){process.send({test:'publication-held'});await waiting('publication');}
  const count=mode==='published-five'?5:mode==='published-zero'?0:6;
  for(let i=0;i<count;i++){await round(ctx);publishedCycles++;}return {intent};
 },
 async recheck(custody,ctx,dispatch){
  const count=mode==='published-agent-two'?2:3;
  // Generated fixture supports the upcoming same-transaction dispatcher too;
  // this branch is not a production fallback or proof of SQL atomicity.
  for(let i=0;i<Math.min(2,count);i++){await round(ctx);agentCycles++;}
  const result=dispatch&&count===3?await dispatch({fixture_only:true}):undefined;
  if(count===3){await round(ctx);agentCycles++;}return result;
 }
}:null;
const send=(frame,callback)=>{
 if(frame.action==='RESERVE_EXECUTION'){
  const terminal=frame.schema==='metaengine.native-coding.host-settlement.v1',response=frame.schema==='metaengine.native-coding.host-ipc.response.v1';
  if(mode==='hold-ack'&&response){held.set('ack',()=>process.send(frame,callback));process.send({test:'ack-held'});return;}
  if(mode==='hold-terminal'&&terminal){held.set('terminal',()=>process.send(frame,callback));process.send({test:'terminal-held'});return;}
  if(mode==='foreign-terminal'&&terminal)frame={...frame,request_sha256:'0'.repeat(64)};
  if(response&&frame.outcome==='OK'){
   if(mode==='foreign-ack-run')frame={...frame,value:{...frame.value,initial_callback_publication:{...frame.value.initial_callback_publication,run_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}};
   if(mode==='foreign-ack-reservation')frame={...frame,value:{...frame.value,initial_callback_publication:{...frame.value.initial_callback_publication,reservation_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}};
   if(mode==='malformed-root')frame={...frame,value:{...frame.value,initial_callback_publication:{...frame.value.initial_callback_publication,root_sha256:'invalid'}}};
   if(mode==='foreign-returned-scope')frame={...frame,value:{...frame.value,scope:{...frame.value.scope,host_incarnation:'pid:9101:created_100ns:134000000000000002'}}};
  }
 }
 process.send(frame,callback);
};
const server=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations,callbackPublication,send,maxInflight:${budget},timeoutMs:10000});
process.on('message',m=>{
 if(m.test==='release'){const work=held.get(m.key);held.delete(m.key);work?.();return;}
 if(m.test==='stats'){process.send({test:'stats',id:m.id,reserves,cycles,publishedCycles,agentCycles,agents,snapshot:server.snapshot()});return;}
 if(m.test==='premature-ack'&&context){
  const b={instance_id:context.instanceId,host_pid:context.hostPid,request_id:context.requestId,action:'RESERVE_EXECUTION',request_sha256:context.requestDigest};
  process.send(nativeCodingHostSettlement(b));process.send({schema:'metaengine.native-coding.host-ipc.response.v1',...b,outcome:'OK',value:result(context),reason:null});return;
 }
 server.handleMessage(m);
});
process.on('disconnect',()=>process.exit(0));process.send({test:'ready'});
`);
 const child=fork(script,[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true}),messages=[];child.on('message',m=>messages.push(m));
 const until=async predicate=>{for(let i=0;i<2000;i++){const value=messages.find(predicate);if(value)return value;await sleep(5);}throw Error('generated_fixture_event_missing');};
 await until(m=>m.test==='ready');
 const client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs,maxInflight:budget,readShutdownSettlement});
 t.after(async()=>{client.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await client.drainPhysical({wait:false}).catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
 const token=await client.prepareAgentRunCustody({binding,journal});let callbacks=0;
 const owner=async tx=>{callbacks++;await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;};
 const reserve=callback=>client.reservePreparedExecution(scope,token,callback||owner);
 return {f,root,directory,journal,scope,binding,child,client,instanceId,token,until,reserve,owner,get callbacks(){return callbacks;},
  release:key=>child.send({test:'release',key}),stats:async()=>{const request=id();child.send({test:'stats',id:request});return until(m=>m.test==='stats'&&m.id===request);}};
}
async function kinds(x){const root=path.join(x.directory,'host-callback-custody');return Promise.all((await fs.readdir(root)).sort().map(async f=>JSON.parse(await fs.readFile(path.join(root,f),'utf8')).event.kind));}

test('original RESERVED, six actual Owner cycles and exact terminal permit a single private facet take',async t=>{
 const x=await fixture(t);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token),/INVALID_PAYLOAD/);
 const value=await x.reserve();assert.equal(value.state,'RESERVED');assert.equal(value.initial_callback_publication.execution_ready,false);
 assert.equal(x.callbacks,6);assert.deepEqual(await kinds(x),['HEADER','BOUND']);
 const facet=x.client.takePreparedAgentRunCustody(x.token);assert.equal(typeof facet.agentOperation,'function');
 assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token),/INVALID_PAYLOAD/);
 assert.throws(()=>x.client.abandonPreparedAgentRunCustody(x.token),/INVALID_PAYLOAD/);
 await assert.rejects(x.reserve(),/INVALID_PAYLOAD/);assert.equal((await x.stats()).reserves,1);await facet.finish();
});
for(const mode of ['hold-ack','hold-terminal'])test(`original ${mode} cannot promote early; later exact counterpart permits promotion`,async t=>{
 const x=await fixture(t,{mode});let done=false;const work=x.reserve().then(v=>{done=true;return v;});
 await x.until(m=>m.test===(mode==='hold-ack'?'ack-held':'terminal-held'));await turn();assert.equal(done,false);
 assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token),/INVALID_PAYLOAD/);assert.deepEqual(await kinds(x),['HEADER','BOUND']);
 x.release(mode==='hold-ack'?'ack':'terminal');await work;await x.client.takePreparedAgentRunCustody(x.token).finish();
});
test('one unrelated held physical request does not block exact original reservation promotion',async t=>{
 const x=await fixture(t),read=x.client.readScope();await x.until(m=>m.test==='read-started');
 await x.reserve();assert.equal(x.client.snapshot().physical_inflight,1);await x.client.takePreparedAgentRunCustody(x.token).finish();
 x.release('read');await read;await x.client.drainPhysical();
});
for(const mode of ['hold-ack','hold-terminal'])test(`original deadline remains armed after ${mode}; late OK or SETTLED cannot reactivate`,async t=>{
 const x=await fixture(t,{mode,timeoutMs:500}),work=x.reserve();work.catch(()=>{});
 await x.until(m=>m.test===(mode==='hold-ack'?'ack-held':'terminal-held'));
 await assert.rejects(work,e=>e.reason==='REQUEST_TIMEOUT'&&e.effect_outcome==='UNKNOWN');
 x.release(mode==='hold-ack'?'ack':'terminal');await sleep(30);
 assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));await assert.rejects(x.reserve());
 assert.equal((await x.stats()).reserves,1);assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);
});
for(const mode of ['zero-cycles','five-cycles','readback-six','foreign-project','changed-root','foreign-ack-run','foreign-ack-reservation','malformed-root','foreign-returned-scope'])test(`invalid initial publication cannot mint a private facet: ${mode}`,async t=>{
 const x=await fixture(t,{mode,timeoutMs:500});await assert.rejects(x.reserve());assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);assert.equal((await x.stats()).reserves,1);
});
test('strict zero-cycle READBACK_ONLY returns original readback and fences without publication authority',async t=>{
 const x=await fixture(t,{mode:'readback'}),value=await x.reserve();assert.deepEqual(value,{state:'READBACK_ONLY',execution:null,automatic_retry_allowed:false,authority_effect:false});
 assert.equal(x.callbacks,0);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));await assert.rejects(x.reserve());
 assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);assert.equal((await x.stats()).reserves,1);
});
for(const key of ['workspace_id','task_id','lease_generation','agent_id','agent_generation_epoch','target_id'])test(`prepared binding refuses foreign ${key} before RESERVE send`,async t=>{
 const x=await fixture(t),scope={...x.scope,[key]:key==='lease_generation'||key==='agent_generation_epoch'?2:key==='agent_id'?'agent_foreign-one':key==='target_id'?`codex-cli:${id()}`:id()};
 await assert.rejects(x.client.reservePreparedExecution(scope,x.token,x.owner));assert.equal((await x.stats()).reserves,0);
 assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);
});
test('foreign, cloned and JSON tokens cannot reserve or take',async t=>{
 const x=await fixture(t),y=await fixture(t);
 for(const token of [{},JSON.parse('{}'),{...x.token},y.token,x.client.describePreparedAgentRunCustody(x.token)]){
  await assert.rejects(x.client.reservePreparedExecution(x.scope,token,x.owner),/INVALID_PAYLOAD/);assert.throws(()=>x.client.takePreparedAgentRunCustody(token),/INVALID_PAYLOAD/);
 }
 assert.equal((await x.stats()).reserves,0);assert.deepEqual(await kinds(x),['HEADER','BOUND']);
});
test('concurrent repeated reserve consumes the prepared token before any await',async t=>{
 const x=await fixture(t,{mode:'hold-terminal'}),first=x.reserve();await assert.rejects(x.reserve(),/INVALID_PAYLOAD/);
 await x.until(m=>m.test==='terminal-held');x.release('terminal');await first;assert.equal((await x.stats()).reserves,1);await x.client.takePreparedAgentRunCustody(x.token).finish();
});
for(const mode of ['foreign-terminal','rollback-poison'])test(`cleanup-only shutdown cannot promote ${mode}`,async t=>{
 let witness=null;const x=await fixture(t,{mode,timeoutMs:500,readShutdownSettlement:async()=>witness});await assert.rejects(x.reserve());
 witness={schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:x.instanceId,host_pid:x.child.pid,cleanup_confirmed:true,authority_effect:false};
 await x.client.drainPhysical();assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));assert.equal((await readNativeRunCallbackJournal(x.directory)).all_effects_cleanup,'UNCONFIRMED');
});
test('timeout immediately fences token but still joins a held actual Owner callback',async t=>{
 const x=await fixture(t,{timeoutMs:150}),entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
 const work=x.reserve(async tx=>{signal=tx.signal;entered.resolve();await release.promise;tx.assertOpen();return x.f.evidence;});work.catch(()=>{});
 await entered.promise;await sleep(180);assert.equal(signal.aborted,true);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 let done=false;work.finally(()=>{done=true;}).catch(()=>{});await turn();assert.equal(done,false);
 release.resolve();await assert.rejects(work,e=>e.effect_outcome==='UNKNOWN');assert.equal((await x.stats()).reserves,1);
});
test('an early exact-looking ACK and SETTLED cannot substitute for actual held callback completion',async t=>{
 const x=await fixture(t,{timeoutMs:500}),entered=Promise.withResolvers(),release=Promise.withResolvers();
 const work=x.reserve(async tx=>{entered.resolve();await release.promise;return x.owner(tx);});work.catch(()=>{});await entered.promise;
 x.child.send({test:'premature-ack'});await sleep(30);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 release.resolve();await assert.rejects(work);assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);
});
test('async original send error after delivery fences the token despite a possible committed Host result',async t=>{
 const x=await fixture(t),original=x.child.send.bind(x.child);
 x.child.send=(frame,callback)=>original(frame,error=>{if(frame.action==='RESERVE_EXECUTION'&&frame.schema==='metaengine.native-coding.host-ipc.request.v1')callback?.(Error('PRIVATE_SEND_FAILURE'));else callback?.(error);});
 await assert.rejects(x.reserve(),e=>e.reason==='SEND_FAILED'&&!e.message.includes('PRIVATE_SEND_FAILURE'));assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
});

for(const phase of ['original','last-owner-phase'])test(`promotion waits actual ${phase} send callback, not only received ACK and SETTLED`,async t=>{
 const x=await fixture(t),original=x.child.send.bind(x.child),held=Promise.withResolvers();let release;
 x.child.send=(frame,callback)=>original(frame,error=>{
  const target=phase==='original'?frame.schema==='metaengine.native-coding.host-ipc.request.v1'&&frame.action==='RESERVE_EXECUTION'
   :frame.schema==='metaengine.native-coding.publication-owner-phase.v1'&&frame.phase==='CYCLE_RELEASED'&&frame.cycle===6;
  if(target){release=()=>callback?.(error);held.resolve();}else callback?.(error);
 });
 let done=false;const work=x.reserve().then(v=>{done=true;return v;});work.catch(()=>{});await held.promise;
 await x.until(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1'&&m.action==='RESERVE_EXECUTION');await turn();
 assert.equal(done,false);assert.equal(x.client.snapshot().physical_inflight,1);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 release();await work;await x.client.takePreparedAgentRunCustody(x.token).finish();
});

test('timeout with held original send completion retains physical row even after journal abandonment',async t=>{
 const x=await fixture(t,{timeoutMs:500}),original=x.child.send.bind(x.child),held=Promise.withResolvers();let release;
 x.child.send=(frame,callback)=>original(frame,error=>{
  if(frame.schema==='metaengine.native-coding.host-ipc.request.v1'&&frame.action==='RESERVE_EXECUTION'){release=()=>callback?.(error);held.resolve();}else callback?.(error);
 });
 const work=x.reserve();work.catch(()=>{});await held.promise;
 await assert.rejects(work,e=>e.reason==='REQUEST_TIMEOUT');assert.equal(x.client.snapshot().physical_inflight,1);
 await assert.rejects(x.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 release();await x.client.drainPhysical();assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
});

test('close after ACK while original SETTLED is withheld fences without global callback join',async t=>{
 const x=await fixture(t,{mode:'hold-terminal'}),work=x.reserve();work.catch(()=>{});await x.until(m=>m.test==='terminal-held');
 await x.until(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1'&&m.action==='RESERVE_EXECUTION');x.client.close();
 await assert.rejects(work);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 x.release('terminal');await x.client.drainPhysical();assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);
});

const checkRequest=x=>({operation:'CHECK',args:{},binding:x.binding,
 job_binding:{job_id:id(),pid:1234,process_incarnation_id:'pid:1234:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)}});

test('promoted facet carries actual original publication six and effect three Owner cycles on unchanged IPC frames',async t=>{
 const x=await fixture(t,{mode:'published-normal',budget:1});await x.reserve();assert.deepEqual(await kinds(x),['HEADER','BOUND']);
 const facet=x.client.takePreparedAgentRunCustody(x.token);await facet.agentOperation(checkRequest(x));await x.client.drainPhysical();
 const stats=await x.stats();assert.equal(stats.cycles,6);assert.equal(stats.publishedCycles,6);assert.equal(stats.agentCycles,3);assert.equal(stats.agents,1);
 assert.equal(x.callbacks,15);const done=await facet.finish();assert.equal(done.requests,1);assert.equal(done.all_effects_cleanup,'UNCONFIRMED');
 assert.equal((await kinds(x)).filter(kind=>kind==='BOUND').length,1);
});

test('promoted publication shares the one original request ticket while the actual publisher is held',async t=>{
 const x=await fixture(t,{mode:'published-held',budget:1});await x.reserve();const facet=x.client.takePreparedAgentRunCustody(x.token),work=facet.agentOperation(checkRequest(x));
 await x.until(m=>m.test==='publication-held');assert.equal(x.client.snapshot().physical_inflight,1);
 assert.equal((await x.stats()).snapshot.inflight,1);await assert.rejects(x.client.readScope(),/INFLIGHT_LIMIT/);
 x.release('publication');await work;await x.client.drainPhysical();assert.equal((await x.stats()).agents,1);await facet.finish();
});

for(const mode of ['published-zero','published-five','published-agent-two'])test(`promoted run refuses incomplete fixed Owner budget: ${mode}`,async t=>{
 const x=await fixture(t,{mode});await x.reserve();const facet=x.client.takePreparedAgentRunCustody(x.token);
 await assert.rejects(facet.agentOperation(checkRequest(x)));await x.client.drainPhysical();
 assert.equal((await x.stats()).agents,0);assert.equal((await facet.finish()).all_effects_cleanup,'UNCONFIRMED');
});

test('explicit abandonment fences and aborts original Owner phase without pretending remote callback joined',async t=>{
 const x=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
 const work=x.reserve(async tx=>{signal=tx.signal;entered.resolve();await release.promise;tx.assertOpen();return x.f.evidence;});work.catch(()=>{});await entered.promise;
 const abandoned=await x.client.abandonPreparedAgentRunCustody(x.token);assert.equal(abandoned.state,'ABANDONED');assert.equal(signal.aborted,true);
 let done=false;work.finally(()=>{done=true;}).catch(()=>{});await turn();assert.equal(done,false);
 assert.equal(x.client.snapshot().physical_inflight,1);assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token));
 release.resolve();await assert.rejects(work,e=>e.reason==='CLIENT_CLOSED'&&e.effect_outcome==='UNKNOWN');
 assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);
});

test('a verified initial request does not extend its original deadline for a later take',async t=>{
 const x=await fixture(t,{timeoutMs:500});await x.reserve();await sleep(510);
 assert.throws(()=>x.client.takePreparedAgentRunCustody(x.token),e=>e.reason==='REQUEST_TIMEOUT');
 await x.client.drainPhysical();assert.deepEqual(await kinds(x),['HEADER','BOUND','FENCE']);assert.equal((await x.stats()).reserves,1);
});

test('caller mutation after reserve invocation cannot redirect the original scope or private binding',async t=>{
 const x=await fixture(t),input={...x.scope},work=x.client.reservePreparedExecution(input,x.token,x.owner);input.task_id=id();input.scope_sha256='b'.repeat(64);
 const value=await work;assert.deepEqual(value.scope,x.f.scope.execution);assert.equal(x.callbacks,6);await x.client.takePreparedAgentRunCustody(x.token).finish();
});
