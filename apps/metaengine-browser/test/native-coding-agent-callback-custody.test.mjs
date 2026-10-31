import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inMemoryNativeBroker} from './fixtures/native-coding-in-memory-broker.mjs';
// Actual broker source; ONLY its net module is an in-memory duplex fixture.
// Opens no endpoint, socket, pipe or native worker; not Windows/socket evidence.
async function fixture(t,options={}){
 const exports=await inMemoryNativeBroker(t);
 const binding={run_id:randomUUID(),workspace_id:randomUUID(),project_id:randomUUID(),task_id:randomUUID(),lease_generation:1,
  agent_id:'agent_callback-fixture123',agent_generation_epoch:1,provider_id:randomUUID(),role:'IMPLEMENTER'};
 const job={job_id:randomUUID(),pid:123,process_incarnation_id:'pid:123:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)};
 const broker=await exports.createNativeCodingAgentMcpBroker({endpoint:process.platform==='win32'?String.raw`\\.\pipe\METAENGINE-NativeMcp-${randomUUID()}`:'/fixture/in-memory-only',timeoutMs:50,
  operations:{project_overview:async()=>({read:true}),agent_send_message:async()=>({stored:true})},assertInvocationAuthorized:async()=>{},...options});
 const registration=broker.issueRun({binding,jobBinding:job,expiresAt:Date.now()+60000,allowedTools:['project_overview','agent_send_message']});
 const client=await exports.connectNativeCodingAgentMcpBroker(registration);t.after(async()=>{client.close();await broker.close();});
 return{broker,client,binding,registration};
}
const gate=()=>Promise.withResolvers(),turn=()=>new Promise(r=>setImmediate(r));
for(const phase of ['authorization','handler'])test(`actual ${phase} callback stays retained after transport close and must join original promise`,async t=>{
 const held=gate(),entered=gate(),f=await fixture(t,phase==='authorization'?{assertInvocationAuthorized:async()=>{entered.resolve();await held.promise;}}
  :{operations:{project_overview:async()=>{entered.resolve();await held.promise;return{read:true};},agent_send_message:async()=>({})}});
 const invoked=f.client.invoke('project_overview',{});invoked.catch(()=>{});await entered.promise;
 const closing=f.broker.close();assert.equal(f.broker.close(),closing);await closing;await assert.rejects(invoked);
 assert.equal(f.broker.snapshot().retained_callbacks,1);assert.equal(f.broker.snapshot().inflight,1);
 const joined=f.broker.drainCallbacks(f.binding.run_id);assert.equal(f.broker.drainCallbacks(f.binding.run_id),joined);let done=false;joined.then(()=>{done=true;});
 await turn();assert.equal(done,false);held.resolve();const receipt=await joined;assert.equal(receipt.callbacks,1);assert.equal(f.broker.snapshot().retained_callbacks,0);assert.equal(f.broker.snapshot().inflight,0);
});
test('cancelled request cannot free shared physical inflight before its actual handler settles',async t=>{
 const held=gate(),entered=gate();let handlers=0;
 const f=await fixture(t,{maxInflight:1,operations:{project_overview:async()=>{handlers++;entered.resolve();await held.promise;return{};},agent_send_message:async()=>({})}});
 const abort=new AbortController(),first=f.client.invoke('project_overview',{}, {signal:abort.signal});first.catch(()=>{});await entered.promise;abort.abort();await assert.rejects(first);
 await assert.rejects(f.client.invoke('project_overview',{}));assert.equal(handlers,1);assert.equal(f.broker.snapshot().retained_callbacks,1);
 await f.broker.close();held.resolve();await f.broker.drainCallbacks(f.binding.run_id);assert.equal(f.broker.snapshot().inflight,0);
});
test('readback authorization and handler are retained after public deadline/transport close',async t=>{
 const held=gate(),entered=gate();let writes=0;
 const f=await fixture(t,{operations:{project_overview:async()=>({}),agent_send_message:async()=>{writes++;throw Error('unknown fixture effect');}},
  readIntentReceipt:async()=>{entered.resolve();await held.promise;throw Error('unknown fixture readback');}});
 const request_id=randomUUID();await assert.rejects(f.client.invoke('agent_send_message',{request_id,target_agent_id:'agent_other-peer123',message:'private fixture'}));
 const reading=f.broker.reconcileIntent(f.binding.run_id,request_id);reading.catch(()=>{});await entered.promise;await f.broker.close();await assert.rejects(reading);
 assert.equal(f.broker.snapshot().retained_callbacks,1);let done=false;const join=f.broker.drainCallbacks(f.binding.run_id).then(v=>{done=true;return v;});await turn();assert.equal(done,false);
 held.resolve();assert.equal((await join).callbacks,2);assert.equal(f.broker.snapshot().retained_callbacks,0);assert.equal(writes,1);
});
test('an open run cannot claim callback join while still accepting dispatch',async t=>{
 const f=await fixture(t);assert.throws(()=>f.broker.drainCallbacks(f.binding.run_id),/requires_fence/);await f.broker.close();assert.equal((await f.broker.drainCallbacks(f.binding.run_id)).callbacks,0);
});
