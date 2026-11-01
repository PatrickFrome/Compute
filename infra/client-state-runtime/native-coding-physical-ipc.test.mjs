import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const server=new URL('./native-coding-host-ipc.mjs',import.meta.url).href;
async function fixture(t,{failBegin=false,failEnd=false,timeoutMs=2000}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-physical-ipc-')),script=path.join(root,'host.mjs'),instance=randomUUID();
 await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(server)};
const instance=${JSON.stringify(instance)},events=[],tickets=new WeakSet();
const emit=kind=>{events.push(kind);process.send({test:kind});};
const release=kind=>new Promise(resolve=>{const on=m=>{if(m?.release===kind){process.off('message',on);resolve();}};process.on('message',on);});
const call=async()=>{emit('effect');return {completed:true};};
const operations=Object.fromEntries(['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'].map(k=>[k,call]));
const physicalCustody={
 async beginRequest(frame){emit('begin');await release('begin');if(${failBegin})throw Error('generated_storage_failure');const ticket={};tickets.add(ticket);emit('durable');return ticket;},
 async endRequest(ticket,held){if(!tickets.has(ticket))throw Error('original_ticket_required');emit('terminal-start');await release('terminal');if(${failEnd})throw Error('generated_terminal_ack_loss');emit('terminal-durable');}
};
const ipc=createNativeCodingHostIpcServer({instanceId:instance,operations,physicalCustody,timeoutMs:${timeoutMs}});
process.on('message',m=>{if(m?.stats)process.send({test:'stats',events,snapshot:ipc.snapshot()});else if(!m?.release)ipc.handleMessage(m);});
process.send({test:'ready'});
`);
 const child=fork(script,[],{stdio:['ignore','ignore','pipe','ipc']}),messages=[];let stderr='';child.stderr.on('data',b=>{stderr+=b;});
 const wait=predicate=>new Promise((resolve,reject)=>{
  const found=messages.find(predicate);if(found){resolve(found);return;}
  const timer=setTimeout(()=>{child.off('message',on);reject(Error('fixture_timeout '+stderr));},5000);
  const on=m=>{if(predicate(m)){clearTimeout(timer);child.off('message',on);resolve(m);}};child.on('message',on);
 });
 child.on('message',m=>messages.push(m));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}await fs.rm(root,{recursive:true,force:true});});
 await wait(m=>m.test==='ready');
 const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instance,host_pid:child.pid,request_id:randomUUID(),action:'RESERVE_EXECUTION',payload:{scope:{
  workspace_id:randomUUID(),task_id:randomUUID(),lease_generation:1,agent_id:'agent_physical-ipc-1234',target_id:'codex-cli:'+randomUUID(),
  agent_generation_epoch:1,host_incarnation:'pid:1234:created_100ns:134371917225776174',scope_sha256:'a'.repeat(64)}}};
 const stats=async()=>{const start=messages.length;child.send({stats:true});return wait(m=>messages.indexOf(m)>=start&&m.test==='stats');};
 child.send(frame);await wait(m=>m.test==='begin');
 return {child,messages,wait,stats,frame};
}
test('actual Host IPC waits for original durable request before effect and durable terminal before releasing capacity',async t=>{
 const f=await fixture(t);assert.equal(f.messages.some(m=>m.test==='effect'),false);
 f.child.send({release:'begin'});await f.wait(m=>m.test==='terminal-start');
 let s=await f.stats();assert.deepEqual(s.events,['begin','durable','effect','terminal-start']);assert.equal(s.snapshot.inflight,1);
 assert.equal(f.messages.some(m=>m.schema==='metaengine.native-coding.host-settlement.v1'),false);
 f.child.send({release:'terminal'});const terminal=await f.wait(m=>m.schema==='metaengine.native-coding.host-settlement.v1');
 assert.equal(terminal.state,'SETTLED');const reply=await f.wait(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1');assert.equal(reply.outcome,'OK');
 s=await f.stats();assert.equal(s.snapshot.inflight,0);assert.equal(s.events.at(-1),'terminal-durable');
});
test('actual Host IPC retains HOLD if terminal persistence is uncertain',async t=>{
 const f=await fixture(t,{failEnd:true});f.child.send({release:'begin'});await f.wait(m=>m.test==='terminal-start');f.child.send({release:'terminal'});
 const terminal=await f.wait(m=>m.schema==='metaengine.native-coding.host-settlement.v1');assert.equal(terminal.state,'HOLD');assert.equal(terminal.cleanup_confirmed,false);
 const s=await f.stats();assert.equal(s.snapshot.inflight,1);assert.equal(s.snapshot.held,1);assert.equal(s.events.filter(e=>e==='effect').length,1);
});
test('durable request failure cannot dispatch an effect or reconstruct an original ticket',async t=>{
 const f=await fixture(t,{failBegin:true});f.child.send({release:'begin'});
 const reply=await f.wait(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1');assert.equal(reply.outcome,'UNKNOWN');
 const s=await f.stats();assert.deepEqual(s.events,['begin']);assert.equal(s.snapshot.inflight,0);
});
test('caller timeout stays UNKNOWN while original delayed producer still joins terminal and prevents late dispatch',async t=>{
 const f=await fixture(t,{timeoutMs:40});
 const reply=await f.wait(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1');assert.equal(reply.outcome,'UNKNOWN');
 f.child.send({release:'begin'});await f.wait(m=>m.test==='terminal-start');f.child.send({release:'terminal'});
 const terminal=await f.wait(m=>m.schema==='metaengine.native-coding.host-settlement.v1');assert.equal(terminal.state,'SETTLED');
 const s=await f.stats();assert.equal(s.events.includes('effect'),false);assert.equal(s.snapshot.inflight,0);
 assert.equal(f.messages.filter(m=>m.schema==='metaengine.native-coding.host-ipc.response.v1').length,1);
});
