import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
const server=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const fixture=new URL('./fixtures/native-run-owner-read.mjs',import.meta.url).href;
async function setup(t,{timeoutMs=5000,cycles=6,resultState='RESERVED',forged=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-owner-ipc-')),file=path.join(root,'child.mjs'),instanceId=randomUUID();
 await fs.writeFile(file,`import {createNativeCodingHostIpcServer} from ${JSON.stringify(server)};
 import {generatedRunOwnerRead} from ${JSON.stringify(fixture)};
 const actions=['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'];
 const operations=Object.fromEntries(actions.map(k=>[k,async()=>({fixture:true})]));
 operations.RESERVE_EXECUTION=async(request,context)=>{
  const f=generatedRunOwnerRead(),scope={...request.scope,reservation_id:f.scope.execution.reservation_id};f.scope.execution=scope;
  const original=context;let verified=0;
  for(let n=0;n<${cycles};n++)await context.runOwnerPhases.run(f.scope,{readScope:async()=>{if(context!==original)throw Error('changed request');return f.scope;},verifyOwner:async()=>{verified++;}});
  if(${JSON.stringify(resultState)}==='READBACK_ONLY')return {state:'READBACK_ONLY',execution:{...scope,state:'ATTEMPTED',automatic_retry_allowed:false,authority_effect:false},automatic_retry_allowed:false,authority_effect:${JSON.stringify(forged)}};
  return {state:'RESERVED',scope,fixture_only:true,verified,body_digest_present:Object.hasOwn(context,'bodyDigest'),request_id:context.requestId};
 };
 const api=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations,maxInflight:1,timeoutMs:3000});
 process.on('message',(m,h)=>api.handleMessage(m,h));process.on('disconnect',()=>process.exit(0));process.send({ready:true});`);
 const child=fork(file,[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});let client;
 t.after(async()=>{
  client?.close();if(child.exitCode===null&&child.signalCode===null)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('fixture exit unconfirmed; retained '+root)),5000);
   child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();
  });await fs.rm(root,{recursive:true,force:true});
 });
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture startup timeout')),5000);
  const done=error=>{clearTimeout(timer);child.off('message',message);child.off('error',failed);child.off('exit',exited);error?reject(error):resolve();};
  const message=m=>{if(m.ready)done();},failed=()=>done(Error('fixture startup failed')),exited=()=>done(Error('fixture startup exited'));
  child.on('message',message);child.once('error',failed);child.once('exit',exited);
 });
 client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,maxInflight:1,timeoutMs});
 const f=generatedRunOwnerRead(),scope={...f.scope.execution};delete scope.reservation_id;
 const callback=async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;};return{client,child,scope,f,callback};
}
test('six actual RESERVE Owner reads share one request and one physical slot without a fictional body digest',{timeout:10000},async t=>{
 const f=await setup(t);let callbacks=0;
 const value=await f.client.reserveExecutionWithOwner(f.scope,async tx=>{callbacks++;assert.equal(f.client.snapshot().physical_inflight,1);return f.callback(tx);});
 assert.equal(callbacks,6);assert.equal(value.verified,6);assert.equal(value.body_digest_present,false);assert.equal(value.state,'RESERVED');
 assert.equal(value.scope.reservation_id,f.f.scope.execution.reservation_id);await f.client.drainPhysical();assert.equal(f.client.snapshot().physical_inflight,0);
});
test('partial RESERVE read budget cannot produce successful outer response',{timeout:10000},async t=>{
 const f=await setup(t,{cycles:5});await assert.rejects(f.client.reserveExecutionWithOwner(f.scope,f.callback),e=>e.effect_outcome==='UNKNOWN');
 await f.client.drainPhysical();assert.equal(f.client.snapshot().physical_inflight,0);
});
test('original RESERVE timeout retains held native callback and denies a second physical request',{timeout:10000},async t=>{
 const f=await setup(t,{timeoutMs:200});let release,entered;const wait=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
 const pending=f.client.reserveExecutionWithOwner(f.scope,async tx=>{entered();await wait;return f.callback(tx);});pending.catch(()=>{});
 await entry;await sleep(260);assert.equal(f.client.snapshot().physical_inflight,1);
 await assert.rejects(f.client.reserveExecution(f.scope),e=>e.reason==='INFLIGHT_LIMIT');release();await assert.rejects(pending,e=>e.effect_outcome==='UNKNOWN');
 await f.client.drainPhysical();assert.equal(f.client.snapshot().physical_inflight,0);
});
test('async native send callback error cancels the original request and never delivers a success',{timeout:10000},async t=>{
 const f=await setup(t),send=f.child.send.bind(f.child);let injected=false;
 f.child.send=(message,...args)=>{
  if(!injected&&message.schema==='metaengine.native-coding.publication-owner-phase.v1'){
   injected=true;const callback=args.find(v=>typeof v==='function');setImmediate(()=>callback?.(Error('generated async send failure')));return false;
  }return send(message,...args);
 };
 await assert.rejects(f.client.reserveExecutionWithOwner(f.scope,f.callback));assert.equal(injected,true);
 await assert.rejects(f.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
});
test('existing reservation returns strict READBACK_ONLY without any fresh Owner callback',{timeout:10000},async t=>{
 const f=await setup(t,{cycles:0,resultState:'READBACK_ONLY'});let calls=0;
 const value=await f.client.reserveExecutionWithOwner(f.scope,()=>{calls++;throw Error('not a fresh reservation');});
 assert.equal(value.state,'READBACK_ONLY');assert.equal(value.authority_effect,false);assert.equal(calls,0);
 await f.client.drainPhysical();assert.equal(f.client.snapshot().physical_inflight,0);
});
for(const [cycles,resultState,forged] of [[0,'RESERVED',false],[0,'READBACK_ONLY',true],[1,'READBACK_ONLY',false]])test('reserve cannot hide missing or partial Owner reads '+JSON.stringify({cycles,resultState,forged}),{timeout:10000},async t=>{
 const f=await setup(t,{cycles,resultState,forged});await assert.rejects(f.client.reserveExecutionWithOwner(f.scope,f.callback));
 await f.client.drainPhysical();assert.equal(f.client.snapshot().physical_inflight,0);
});
test('legacy reserve without a fresh-read callback preserves actual readback compatibility',{timeout:10000},async t=>{
 const f=await setup(t,{cycles:0,resultState:'READBACK_ONLY'});assert.equal((await f.client.reserveExecution(f.scope)).state,'READBACK_ONLY');await f.client.drainPhysical();
});
