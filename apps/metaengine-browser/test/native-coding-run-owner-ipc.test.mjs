import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
import {SupervisorDeviceIdentity} from '../src/supervisor-device-identity.mjs';
import {signLoadedRunOwnerRead,validateNativeCodingDeviceRequest} from '../src/native-coding-device-request.mjs';
const server=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const fixtureUrl=new URL('./fixtures/native-run-owner-read.mjs',import.meta.url).href;
async function transport(t,{timeoutMs=3000,maxInflight=2}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owner-ipc-')),file=path.join(root,'child.mjs'),instanceId=randomUUID();
 await fs.writeFile(file,`import {createNativeCodingHostIpcServer} from ${JSON.stringify(server)};
 import {generatedRunOwnerRead} from ${JSON.stringify(fixtureUrl)};
 const actions=['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'];
 const operations=Object.fromEntries(actions.map(k=>[k,async()=>({fixture:true})]));
 operations.READ_RUN_OWNER_CUSTODY_V1=async(request,context)=>{
  const f=generatedRunOwnerRead();f.scope.execution=request.body.input.scope;
  return context.runOwnerPhases.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}});
 };
 const api=createNativeCodingHostIpcServer({instanceId:${JSON.stringify(instanceId)},operations,timeoutMs:5000});
 process.on('message',(m,h)=>api.handleMessage(m,h));process.send({ready:true});`);
 const child=fork(file,[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.on('message',m=>{if(m.ready)resolve();});});
 const client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs,maxInflight});
 t.after(async()=>{client.close();const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;await fs.rm(root,{recursive:true,force:true});});
 const f=generatedRunOwnerRead();
 const request=scope=>({body:{host_instance_id:instanceId,host_pid:child.pid,operation:'READ_RUN_OWNER_CUSTODY_V1',input:{scope}},headers:{
  'content-type':'application/json','x-a2-chat-bridge-client':f.scope.device.client_id,'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
  'x-a2-device-id':f.scope.device.device_id,'x-a2-device-timestamp':new Date().toISOString(),'x-a2-device-nonce':'a'.repeat(32),
  'x-a2-device-body-sha256':'b'.repeat(64),'x-a2-device-signature':'A'.repeat(86)}});
 const callback=async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;};
 return{client,f,request,callback};
}
test('real owned ChildProcess run Owner action shares phase/settlement maps across two reads',async t=>{
 const x=await transport(t),a=x.f.scope.execution,b={...a,reservation_id:randomUUID()};
 const results=await Promise.all([x.client.withRunOwnerScope(x.request(a),x.callback),x.client.withRunOwnerScope(x.request(b),x.callback)]);
 assert.ok(results.every(r=>r.state==='OWNER_RECORD_BOUND_SOURCE_ONLY'&&r.qualification.execution_ready===false));
 assert.notEqual(results[0].execution_scope_sha256,results[1].execution_scope_sha256);
 await x.client.drainPhysical();assert.equal(x.client.snapshot().physical_inflight,0);
});
test('timeout retains original native callback and shared maxInflight until it settles',async t=>{
 const x=await transport(t,{timeoutMs:200,maxInflight:1});let entered,release;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const pending=x.client.withRunOwnerScope(x.request(x.f.scope.execution),async tx=>{entered();await gate;return x.callback(tx);});pending.catch(()=>{});
 await ready;await new Promise(r=>setTimeout(r,260));assert.equal(x.client.snapshot().physical_inflight,1);
 await assert.rejects(x.client.withRunOwnerScope(x.request(x.f.scope.execution),x.callback),e=>e.reason==='INFLIGHT_LIMIT');
 release();await assert.rejects(pending,e=>e.reason==='REQUEST_TIMEOUT');await x.client.drainPhysical();assert.equal(x.client.snapshot().physical_inflight,0);
});
test('fixed loaded signer uses existing identity without ensure/persistence and rejects malformed reservation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owner-signer-')),file=path.join(root,'identity.json');
 const secureStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 try{
  const identity=new SupervisorDeviceIdentity({statePath:file,secureStorage}),f=generatedRunOwnerRead();
  await assert.rejects(signLoadedRunOwnerRead({identity,binding:{instance_id:f.binding.instance_id,host_pid:1},input:f.input}));
  await identity.ensure();await identity.bindDevice(f.scope.device.device_id);const before=await fs.readFile(file);
  identity.ensure=()=>{throw Error('ensure forbidden');};
  const request=await signLoadedRunOwnerRead({identity,binding:{instance_id:f.binding.instance_id,host_pid:1},input:f.input});
  assert.equal(validateNativeCodingDeviceRequest(request,'READ_RUN_OWNER_CUSTODY_V1').body.operation,'READ_RUN_OWNER_CUSTODY_V1');
  await assert.rejects(signLoadedRunOwnerRead({identity,binding:{instance_id:f.binding.instance_id,host_pid:1},input:{scope:{...f.input.scope,reservation_id:null}}}));
  assert.deepEqual(await fs.readFile(file),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
