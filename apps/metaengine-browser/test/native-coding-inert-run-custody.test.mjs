import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {createNativeRunCallbackJournal,readNativeRunCallbackJournal,requireNativeRunCallbackPublication} from '../src/native-coding-run-callback-journal.mjs';

// Real journal IO and actual IPC client source. The ChildProcess is an inert
// test-only object: no process, broker, endpoint, SQL or native proof is created.
const id=()=>randomUUID(),turn=()=>new Promise(resolve=>setImmediate(resolve));
function clientFixture(t){
 const child=new ChildProcess(),frames=[];child.pid=4242;child.connected=true;child.channel={};
 child.send=(frame,callback)=>{frames.push(frame);callback?.();return true;};
 const instanceId=id(),client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,maxInflight:1});
 t.after(async()=>{client.close();await client.drainPhysical().catch(()=>{});});return {child,client,frames,instanceId};
}
async function journalFixture(t,override={}){
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'native-inert-custody-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const binding={run_id:id(),workspace_id:id(),project_id:id(),task_id:id(),lease_generation:1,
  agent_id:'agent_inert-custody123',agent_generation_epoch:1,provider_id:id(),role:'IMPLEMENTER',...override};
 const journal=await createNativeRunCallbackJournal({directory,runId:binding.run_id,binding:{...binding,base_sha:'a'.repeat(40)}});
 return {directory,binding,journal};
}
async function records(f){
 const dir=path.join(f.directory,'host-callback-custody');return Promise.all((await fs.readdir(dir)).sort().map(async file=>JSON.parse(await fs.readFile(path.join(dir,file),'utf8'))));
}
function holdRecord(t,f,kind,{fail=false,stage='sync'}={}){
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),original=fs.open;
 fs.open=async(...args)=>{
  const handle=await original(...args);
  if(String(args[0]).startsWith(path.join(f.directory,'host-callback-custody'))&&args[1]==='wx'){
   let event;const write=handle.writeFile.bind(handle),sync=handle.sync.bind(handle),close=handle.close.bind(handle);
   handle.writeFile=async bytes=>{event=JSON.parse(bytes).event;return write(bytes);};
   const hold=async selected=>{if(event.kind===kind&&selected===stage){entered.resolve();await release.promise;if(fail)throw Error('PRIVATE_FIXTURE_DISK_ERROR');}};
   handle.sync=async()=>{await hold('sync');return sync();};
   handle.close=async()=>{await hold('close');return close();};
  }
  return handle;
 };
 t.after(()=>{release.resolve();fs.open=original;});return {entered:entered.promise,release:()=>release.resolve()};
}

test('inert preparation appends exactly BOUND with immutable identity and exposes no dispatch capability',async t=>{
 const f=await journalFixture(t),x=clientFixture(t),original=structuredClone(f.binding);
 const pending=x.client.prepareAgentRunCustody(f);f.binding.task_id=id();const token=await pending;
 const descriptor=x.client.describePreparedAgentRunCustody(token);
 assert.equal(descriptor.state,'PREPARED');assert.deepEqual(descriptor.binding,original);
 assert.equal(Object.isFrozen(descriptor),true);assert.equal(Object.isFrozen(descriptor.binding),true);
 assert.equal(descriptor.host_instance_id,x.instanceId);assert.equal(descriptor.host_pid,x.child.pid);
 assert.equal(descriptor.dispatch_available,false);assert.equal(descriptor.authority_effect,false);
 assert.equal(descriptor.all_effects_cleanup,'UNCONFIRMED');assert.equal(descriptor.lineage,'LINEAGE_UNBOUND');
 assert.equal(descriptor.directory_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');assert.equal(descriptor.chain_root,'CHAIN_ROOT_UNANCHORED');
 for(const method of ['agentOperation','trackCallback','finish','fence','append','candidate','promote','activate'])assert.equal(token[method],undefined);
 assert.equal(Object.isFrozen(token),true);assert.throws(()=>JSON.stringify(token),/INVALID_PAYLOAD/);assert.throws(()=>structuredClone(token));
 assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND']);
 assert.equal((await readNativeRunCallbackJournal(f.directory)).requests,0);assert.deepEqual(x.frames,[]);
 assert.equal(x.client.snapshot().physical_inflight,0);assert.equal(x.client.snapshot().local_journal_inflight,0);
 assert.throws(()=>requireNativeRunCallbackPublication(),/directory_durability_unqualified/);
 await x.client.abandonPreparedAgentRunCustody(token);
});

test('foreign, cloned, JSON and descriptor tokens cannot be adopted or converted to either old facet',async t=>{
 const f=await journalFixture(t),x=clientFixture(t),other=clientFixture(t),token=await x.client.prepareAgentRunCustody(f);
 for(const forged of [{},{...token},JSON.parse('{}'),x.client.describePreparedAgentRunCustody(token),null,42]){
  assert.throws(()=>x.client.describePreparedAgentRunCustody(forged),/INVALID_PAYLOAD/);
  assert.throws(()=>x.client.abandonPreparedAgentRunCustody(forged),/INVALID_PAYLOAD/);
 }
 assert.throws(()=>other.client.describePreparedAgentRunCustody(token),/INVALID_PAYLOAD/);
 assert.throws(()=>other.client.abandonPreparedAgentRunCustody(token),/INVALID_PAYLOAD/);
 for(const method of ['prepareAgentRunCustody','openAgentRunCustody','openPublishedAgentRunCustody'])await assert.rejects(x.client[method](token));
 assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND']);assert.deepEqual(x.frames,[]);
 await x.client.abandonPreparedAgentRunCustody(token);
});

test('concurrent same run and same journal claims refuse a second BOUND, including old open facets',async t=>{
 const f=await journalFixture(t),sameRun=await journalFixture(t,{run_id:f.binding.run_id}),x=clientFixture(t),held=holdRecord(t,f,'BOUND');
 const first=x.client.prepareAgentRunCustody(f);await held.entered;
 for(const method of ['prepareAgentRunCustody','openAgentRunCustody','openPublishedAgentRunCustody']){
  await assert.rejects(x.client[method](f),/CHANNEL_CLOSED/);await assert.rejects(x.client[method](sameRun),/CHANNEL_CLOSED/);
 }
 assert.deepEqual((await records(sameRun)).map(row=>row.event.kind),['HEADER']);
 held.release();const token=await first;assert.equal((await records(f)).filter(row=>row.event.kind==='BOUND').length,1);
 await x.client.abandonPreparedAgentRunCustody(token);
 // The real journal remains single-claimed even after its live run is released.
 await assert.rejects(x.client.prepareAgentRunCustody(f),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 assert.equal((await records(f)).filter(row=>row.event.kind==='BOUND').length,1);assert.deepEqual(x.frames,[]);
});

test('abandon is one retained local fence promise, preserves evidence and never mints a scoped candidate',async t=>{
 const f=await journalFixture(t),x=clientFixture(t),token=await x.client.prepareAgentRunCustody(f),before=await records(f),held=holdRecord(t,f,'FENCE');
 const abandoning=x.client.abandonPreparedAgentRunCustody(token);assert.equal(x.client.abandonPreparedAgentRunCustody(token),abandoning);
 await held.entered;assert.equal(x.client.describePreparedAgentRunCustody(token).state,'ABANDONING');
 let done=false;const drain=x.client.drainPhysical().then(value=>{done=true;return value;});await turn();assert.equal(done,false);
 await assert.rejects(x.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 held.release();const result=await abandoning;await drain;
 assert.equal(result.state,'ABANDONED');assert.equal(result.dispatch_fenced,true);assert.equal(result.all_effects_cleanup,'UNCONFIRMED');
 assert.equal(x.client.abandonPreparedAgentRunCustody(token),abandoning);
 const after=await records(f);assert.deepEqual(after.slice(0,2),before);assert.deepEqual(after.map(row=>row.event.kind),['HEADER','BOUND','FENCE']);
 const read=await readNativeRunCallbackJournal(f.directory);assert.equal(read.state,'INCOMPLETE');assert.equal(read.callbacks_joined,false);assert.deepEqual(x.frames,[]);
});

for(const mode of ['prepareAgentRunCustody','openAgentRunCustody','openPublishedAgentRunCustody'])test(`close during held BOUND joins late claim and fence without returning ${mode}`,async t=>{
 const f=await journalFixture(t),x=clientFixture(t),held=holdRecord(t,f,'BOUND');
 const pending=x.client[mode](f);pending.catch(()=>{});await held.entered;x.client.close();x.client.close();
 assert.equal(x.client.snapshot().closed,true);assert.equal(x.client.snapshot().physical_cleanup_state,'DRAINING');
 let settled=false;const drain=x.client.drainPhysical().then(value=>{settled=true;return value;});await turn();assert.equal(settled,false);
 await assert.rejects(x.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 held.release();await assert.rejects(pending,/CHANNEL_CLOSED/);await drain;
 assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND','FENCE']);
 assert.equal(x.client.snapshot().local_journal_inflight,0);assert.equal(x.client.snapshot().physical_cleanup_state,'DRAINED');assert.deepEqual(x.frames,[]);
});

for(const failure of ['BOUND','FENCE'])test(`failed ${failure} remains explicit local HOLD, preserves bytes, and cannot advertise drained cleanup`,async t=>{
 const f=await journalFixture(t),x=clientFixture(t);let token;
 if(failure==='FENCE')token=await x.client.prepareAgentRunCustody(f);
 const held=holdRecord(t,f,failure,{fail:true});
 const pending=token?x.client.abandonPreparedAgentRunCustody(token):x.client.prepareAgentRunCustody(f);pending.catch(()=>{});
 await held.entered;x.client.close();held.release();
 await assert.rejects(pending,error=>error.reason==='PHYSICAL_CLEANUP_UNCONFIRMED'&&!error.message.includes('PRIVATE_FIXTURE_DISK_ERROR'));
 await assert.rejects(x.client.drainPhysical(),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 await assert.rejects(x.client.drainPhysical(),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 assert.equal(x.client.snapshot().local_journal_inflight,0);assert.equal(x.client.snapshot().local_journal_hold,true);
 assert.equal(x.client.snapshot().physical_cleanup_state,'HOLD');assert.deepEqual(x.frames,[]);
 assert.ok((await records(f)).some(row=>row.event.kind===failure));
 if(token){assert.equal(x.client.describePreparedAgentRunCustody(token).state,'HOLD');assert.equal(x.client.abandonPreparedAgentRunCustody(token),pending);}
});

for(const lost of ['disconnect','pid'])test(`changed original child ${lost} while claiming fences the same journal without replacement`,async t=>{
 const f=await journalFixture(t),x=clientFixture(t),held=holdRecord(t,f,'BOUND'),pending=x.client.prepareAgentRunCustody(f);pending.catch(()=>{});
 await held.entered;if(lost==='disconnect'){x.child.connected=false;x.child.emit('disconnect');}else x.child.pid++;
 held.release();await assert.rejects(pending,/CHANNEL_CLOSED/);await x.client.drainPhysical();
 assert.equal(x.client.snapshot().closed,true);assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND','FENCE']);assert.deepEqual(x.frames,[]);
});

test('two inert runs retain independent local fences; one abandonment cannot drain or erase the other',async t=>{
 const a=await journalFixture(t),b=await journalFixture(t),x=clientFixture(t);
 const [ta,tb]=await Promise.all([x.client.prepareAgentRunCustody(a),x.client.prepareAgentRunCustody(b)]);
 await x.client.abandonPreparedAgentRunCustody(ta);assert.equal(x.client.describePreparedAgentRunCustody(tb).state,'PREPARED');
 assert.deepEqual((await records(b)).map(row=>row.event.kind),['HEADER','BOUND']);x.client.close();await x.client.drainPhysical();
 assert.equal(x.client.describePreparedAgentRunCustody(tb).state,'ABANDONED');assert.deepEqual(x.frames,[]);
});

test('already closed client cannot append BOUND',async t=>{
 const f=await journalFixture(t),x=clientFixture(t);x.client.close();
 await assert.rejects(x.client.prepareAgentRunCustody(f),/CHANNEL_CLOSED/);
 assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER']);assert.deepEqual(x.frames,[]);
});

for(const kind of ['BOUND','FENCE'])test(`actual ${kind} file close, not just successful fsync, remains joined by client drain`,async t=>{
 const f=await journalFixture(t),x=clientFixture(t);let token;
 if(kind==='FENCE')token=await x.client.prepareAgentRunCustody(f);
 const held=holdRecord(t,f,kind,{stage:'close'}),pending=token?x.client.abandonPreparedAgentRunCustody(token):x.client.prepareAgentRunCustody(f);pending.catch(()=>{});
 await held.entered;x.client.close();let done=false;
 const drain=x.client.drainPhysical().then(value=>{done=true;return value;});await turn();assert.equal(done,false);
 held.release();if(token)await pending;else await assert.rejects(pending,/CHANNEL_CLOSED/);await drain;
 assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND','FENCE']);assert.deepEqual(x.frames,[]);
});

test('last asynchronous token handoff rechecks the original child instead of returning a late capability',async t=>{
 const f=await journalFixture(t),x=clientFixture(t);let observations=0;
 // Synthetic disconnection precisely after the raw claim recheck, before the
 // outer async API resumes. It is not a process-death or cleanup witness.
 Object.defineProperty(x.child,'connected',{get:()=>++observations<3});
 await assert.rejects(x.client.prepareAgentRunCustody(f),/CHANNEL_CLOSED/);assert.equal(observations,3);
 await x.client.drainPhysical();assert.deepEqual((await records(f)).map(row=>row.event.kind),['HEADER','BOUND','FENCE']);assert.deepEqual(x.frames,[]);
});

test('a second client cannot reclaim the same original journal or disturb its pending BOUND',async t=>{
 const f=await journalFixture(t),x=clientFixture(t),other=clientFixture(t),held=holdRecord(t,f,'BOUND');
 const pending=x.client.prepareAgentRunCustody(f);await held.entered;
 await assert.rejects(other.client.prepareAgentRunCustody(f),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 held.release();const token=await pending;await x.client.abandonPreparedAgentRunCustody(token);await x.client.drainPhysical();
 const events=(await records(f)).map(row=>row.event);assert.deepEqual(events.map(e=>e.kind),['HEADER','BOUND','FENCE']);
 assert.equal(events[1].instance_id,x.instanceId);assert.notEqual(events[1].instance_id,other.instanceId);
 assert.deepEqual(x.frames,[]);assert.deepEqual(other.frames,[]);
});
