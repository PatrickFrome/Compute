import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicationOwnerHostPhases,createPublicationOwnerClientPhases,PUBLICATION_OWNER_PHASE} from '../src/native-coding-run-owner-phase.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function pair({action='RESERVE_EXECUTION',callback,clientSend,hostSend}={}){
 const f=generatedRunOwnerRead(),{body_sha256,...origin}=f.binding,binding={...origin,action},abort=new AbortController();
 let client,reads=0,verified=0,calls=0;const frames=[];
 const open=()=>{if(abort.signal.aborted)throw Error('parent closed');};
 const host=createPublicationOwnerHostPhases({binding,signal:abort.signal,assertLifetime:open,
  send:m=>{frames.push(structuredClone(m));queueMicrotask(()=>client.receive(hostSend?hostSend(m):m));}});
 const scope=structuredClone(f.scope.execution);if(action==='RESERVE_EXECUTION')delete scope.reservation_id;
 client=createPublicationOwnerClientPhases({binding,scope,assertLifetime:open,
  send:m=>{frames.push(structuredClone(m));queueMicrotask(()=>host.receive(clientSend?clientSend(m):m));},
  callback:async tx=>{calls++;if(callback)return callback(tx,f,calls);await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
 const run=()=>host.run(f.scope,{readScope:async()=>{reads++;return f.scope;},verifyOwner:async()=>{verified++;}});
 return {...f,binding,abort,host,client,frames,run,get reads(){return reads;},get verified(){return verified;},get calls(){return calls;}};
}
for(const [action,count] of [['RESERVE_EXECUTION',6],['PUBLISH_RUN_CALLBACK_V1',6],['AGENT_OPERATION',3]]){
 test('original '+action+' supports exactly '+count+' sequential fresh Owner cycles',{timeout:3000},async()=>{
  const p=pair({action});for(let i=0;i<count;i++){const result=await p.run();assert.equal(result.send_capability,false);}
  assert.equal(p.reads,count*3);assert.equal(p.calls,count);assert.equal(p.verified,count);
  assert.equal(p.frames.some(f=>Object.hasOwn(f,'body_sha256')),false);
  assert.deepEqual([...new Set(p.frames.map(f=>f.cycle))],Array.from({length:count},(_,i)=>i+1));
  await assert.rejects(p.run(),/invalid/);p.host.finish();await p.client.finish();
 });
}
test('publication cycle budget cannot be chosen by caller or foreign action',()=>{
 const f=generatedRunOwnerRead(),{body_sha256,...b}=f.binding;
 for(const binding of [{...b,action:'READ_SCOPE'},{...b,action:'RESERVE_EXECUTION',cycle_limit:100},{...b,action:'RESERVE_EXECUTION',body_sha256}])
  assert.throws(()=>createPublicationOwnerHostPhases({binding,send(){},assertLifetime(){}}),/invalid/);
});
test('incomplete cycles cannot be promoted by finish',{timeout:3000},async()=>{
 const p=pair();await p.run();assert.throws(()=>p.host.finish(),/invalid/);await assert.rejects(p.client.finish(),/invalid/);p.host.close();p.client.close();
});
test('second concurrent Owner read is rejected without a second callback',{timeout:3000},async()=>{
 let release,entered;const wait=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
 const p=pair({callback:async(tx,f)=>{entered();await wait;await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
 const first=p.run();await entry;await assert.rejects(p.run(),/invalid/);assert.equal(p.calls,1);release();await first;p.host.close();p.client.close();
});
test('later cycle binds the original reservation ID',{timeout:3000},async()=>{
 const p=pair();await p.run();p.scope.execution.reservation_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const second=p.run();await assert.rejects(second);assert.equal(p.calls,1);await p.client.drain();
});
for(const field of ['request_sha256','action','host_pid','instance_id','cycle'])test('publication Owner rejects foreign '+field,{timeout:3000},async()=>{
 const p=pair({clientSend:m=>({...m,[field]:field==='host_pid'?999:field==='cycle'?2:field==='action'?'AGENT_OPERATION':field==='request_sha256'?'a'.repeat(64):'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})});
 await assert.rejects(p.run());assert.equal(p.verified,0);p.client.close();await p.client.drain();
});
test('replayed prior-cycle frame fences the original parent reader',{timeout:3000},async()=>{
 const p=pair();await p.run();const old=p.frames.find(f=>f.phase==='RECHECK_SCOPE');
 assert.equal(p.host.receive(old),true);await assert.rejects(p.run(),/invalid/);p.client.close();await p.client.drain();
});
test('abort retains pending callback until its actual work drains',{timeout:3000},async()=>{
 let release,entered;const wait=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
 const p=pair({callback:async(tx,f)=>{entered();await wait;tx.assertOpen();return f.evidence;}});
 const result=p.run();result.catch(()=>{});await entry;p.abort.abort();p.client.close();await assert.rejects(result);
 let drained=false;p.client.drain().then(()=>drained=true);await tick();assert.equal(drained,false);release();await p.client.drain();assert.equal(drained,true);
});
test('forged cycle result never acknowledges a completed cycle',{timeout:3000},async()=>{
 const p=pair({hostSend:m=>m.phase==='CYCLE_RESULT'?{...m,value:{...m.value,send_capability:true}}:m});
 const result=p.run();result.catch(()=>{});await tick();assert.equal(p.frames.some(f=>f.phase==='CYCLE_RELEASED'),false);
 await assert.rejects(result);await p.client.drain();
});
test('cycle protocol cannot be confused with the standalone Owner wire schema',()=>{
 const p=pair();assert.equal(p.host.receive({schema:'metaengine.native-coding.run-owner-phase.v1',request_id:p.binding.request_id}),false);
 assert.equal(p.client.receive({schema:PUBLICATION_OWNER_PHASE,request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),false);p.host.close();p.client.close();
});
for(const at of ['before-read','after-read','after-verify'])test('callback rejection '+at+' aborts original cycle without manual cancellation',{timeout:3000},async()=>{
 const p=pair({callback:async(tx,f)=>{if(at==='before-read')throw Error('fixture');await tx.readScope();if(at==='after-read')throw Error('fixture');await tx.verifyOwnerRecord(f.evidence);throw Error('fixture');}});
 await assert.rejects(p.run());await p.client.drain();await assert.rejects(p.client.finish());
});
test('callback completion after verify is awaited before Host returns',{timeout:3000},async()=>{
 let release,verified;const wait=new Promise(r=>release=r),entry=new Promise(r=>verified=r);
 const p=pair({callback:async(tx,f)=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);verified();await wait;return f.evidence;}});
 let done=false;const run=p.run().then(v=>{done=true;return v;});await entry;await tick();assert.equal(done,false);
 assert.equal(p.frames.some(f=>f.phase==='RELEASE'),false);release();await run;p.host.close();p.client.close();
});
for(const phase of ['LOCKED','ACK','CYCLE_RESULT'])test('malformed '+phase+' terminates read cycle without a rescue abort',{timeout:3000},async()=>{
 const p=pair({hostSend:m=>m.phase===phase?{...m,unexpected:true}:m});await assert.rejects(p.run());await p.client.drain();
 assert.equal(p.frames.some(f=>f.phase==='CYCLE_RELEASED'),false);
});
test('CYCLE_RELEASED send failure terminates the original Host wait',{timeout:3000},async()=>{
 const f=generatedRunOwnerRead(),{body_sha256,...origin}=f.binding,binding={...origin,action:'AGENT_OPERATION'};let client;
 const host=createPublicationOwnerHostPhases({binding,assertLifetime(){},send:m=>queueMicrotask(()=>client.receive(m))});
 client=createPublicationOwnerClientPhases({binding,scope:f.scope.execution,assertLifetime(){},
  send:m=>{if(m.phase==='CYCLE_RELEASED')throw Error('generated send error');queueMicrotask(()=>host.receive(m));},
  callback:async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
 await assert.rejects(host.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}}));await client.drain();
});
test('Host result send failure closes both peers and cannot qualify the read',{timeout:3000},async()=>{
 const f=generatedRunOwnerRead(),{body_sha256,...origin}=f.binding,binding={...origin,action:'AGENT_OPERATION'};let client;
 const host=createPublicationOwnerHostPhases({binding,assertLifetime(){},send:m=>{if(m.phase==='CYCLE_RESULT')throw Error('generated send error');queueMicrotask(()=>client.receive(m));}});
 client=createPublicationOwnerClientPhases({binding,scope:f.scope.execution,assertLifetime(){},send:m=>queueMicrotask(()=>host.receive(m)),
  callback:async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
 await assert.rejects(host.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}}));await tick();await client.drain();await assert.rejects(client.finish());
});
for(const [action,count] of [['RESERVE_EXECUTION',6],['PUBLISH_RUN_CALLBACK_V1',6],['AGENT_OPERATION',3]])test('late malformed final '+action+' cycle fences both peers before outer finish',{timeout:3000},async()=>{
 const p=pair({action});for(let i=0;i<count;i++)await p.run();
 const last=p.frames.findLast(f=>f.phase==='CYCLE_RESULT');p.client.receive({...last,unexpected:true});await tick();
 assert.ok(p.frames.some(f=>f.phase==='CYCLE_ABORT'&&f.cycle===count));
 assert.throws(()=>p.host.finish());await assert.rejects(p.client.finish());
});
test('premature cycle result aborts Host immediately but retains the held native callback drain',{timeout:3000},async()=>{
 let entered,release,signal;const entry=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const p=pair({callback:async(tx,f)=>{signal=tx.signal;entered();await wait;tx.assertOpen();return f.evidence;}});
 const run=p.run();run.catch(()=>{});await entry;
 p.client.receive({schema:PUBLICATION_OWNER_PHASE,...p.binding,cycle:1,sequence:4,phase:'CYCLE_RESULT',value:{}});
 await assert.rejects(run);assert.equal(signal.aborted,true);
 let drained=false;p.client.drain().then(()=>drained=true);await tick();assert.equal(drained,false);
 release();await p.client.drain();assert.equal(drained,true);await assert.rejects(p.client.finish());
});
