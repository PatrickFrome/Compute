import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
const binding={instance_id:randomUUID(),host_pid:23456},input={request_id:randomUUID(),objective:'Implement a useful reviewed change'};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-device-signature-fixture-'));
  // Generated identity uses explicit plaintext TEST secure-storage callbacks.
  // It never reads the installed identity or qualifies Windows secure storage.
  const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'generated-identity.json'),secureStorage:{
    isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));await identity.ensure();await identity.bindDevice(randomUUID());
  const s=identity.snapshot(),device={device_id:s.device_id,client_id:s.client_id,profile:s.profile,public_jwk:s.public_jwk,
    key_fingerprint_sha256:s.key_fingerprint_sha256,admin_grant_epoch:'3',admitted:true};
  let rows=[device];const sql={unsafe:async(query,values)=>{assert(query.includes('current_user'));assert(query.includes('p.active'));
    assert.deepEqual(values,[s.device_id,s.client_id]);return structuredClone(rows);}};
  return {identity,device,sql,setRows:value=>{rows=value;},
    request:(operation='SEED_GOAL',payload=input)=>signNativeCodingDeviceRequest({identity,binding,operation,input:payload}),
    verifier:options=>createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:binding.instance_id,hostPid:binding.host_pid,...options})};
}

test('actual enrolled identity signer binds a private Host request and verifier resolves current DB grant',async t=>{
  const f=await fixture(t),verifier=f.verifier(),request=await f.request();
  assert.deepEqual(await verifier.verify({operation:'SEED_GOAL',...request}),{device_id:f.device.device_id,client_id:f.device.client_id,
    key_fingerprint_sha256:f.device.key_fingerprint_sha256,admin_grant_epoch:3});verifier.close();
});
test('body, Host generation, PID and signing purpose cannot be exchanged',async t=>{
  const f=await fixture(t),original=await f.request();
  for(const change of [v=>{v.body.input.objective+=' altered';},v=>{v.body.host_instance_id=randomUUID();},
    v=>{v.body.host_pid++;},v=>{v.body.operation='READ_SEED';}]){
    const request=structuredClone(original);change(request);
    await assert.rejects(f.verifier().verify({operation:request.body.operation,...request}));
  }
  const request=structuredClone(original);request.headers['x-a2-device-signature']='a'.repeat(86);
  await assert.rejects(f.verifier().verify({operation:'SEED_GOAL',...request}),/signature_invalid/);
});
test('only the current own-PG key and positive ADMIN pairing grant authenticate a device',async t=>{
  const f=await fixture(t),request=await f.request();
  for(const rows of [[],[{...f.device,admitted:false}],[{...f.device,key_fingerprint_sha256:'a'.repeat(64)}],
    [{...f.device,admin_grant_epoch:'0'}],[{...f.device,client_id:randomUUID()}]]){
    f.setRows(rows);await assert.rejects(f.verifier().verify({operation:'SEED_GOAL',...request}));
  }
});
test('stale signatures and slow current-grant lookup cannot extend the authentication window',async t=>{
  const f=await fixture(t),request=await f.request(),timestamp=Date.parse(request.headers['x-a2-device-timestamp']);
  await assert.rejects(f.verifier({now:()=>timestamp+30001}).verify({operation:'SEED_GOAL',...request}),/timestamp_invalid/);
  let now=timestamp;
  const verifier=createNativeCodingDeviceRequestVerifier({hostInstanceId:binding.instance_id,hostPid:binding.host_pid,now:()=>now,
    sql:{unsafe:async()=>{now+=30001;return [f.device];}}});
  await assert.rejects(verifier.verify({operation:'SEED_GOAL',...request}),/timestamp_invalid/);
});
test('concurrent replay authenticates once and expired nonce capacity is recovered without a timer',async t=>{
  const f=await fixture(t),request=await f.request(),timestamp=Date.parse(request.headers['x-a2-device-timestamp']);let now=timestamp;
  const verifier=f.verifier({now:()=>now,maxNonces:1});
  const results=await Promise.allSettled([verifier.verify({operation:'SEED_GOAL',...request}),verifier.verify({operation:'SEED_GOAL',...request})]);
  assert.equal(results.filter(v=>v.status==='fulfilled').length,1);assert.match(results.find(v=>v.status==='rejected').reason.message,/nonce_reused/);
  await assert.rejects(verifier.verify({operation:'SEED_GOAL',...await f.request()}),/nonce_capacity/);
  now=timestamp+30001;
  const body=request.body,headers=await f.identity.deviceHeaders('POST','/private/native-coding/seed-goal',
    (await import('./native-coding-task-context.mjs')).nativeCodingCanonicalJson(body),{timestamp:new Date(now).toISOString()});
  await verifier.verify({operation:'SEED_GOAL',body,headers});verifier.close();
  await assert.rejects(verifier.verify({operation:'SEED_GOAL',body,headers}),/closed/);
});
test('read-only recovery is freshly signed for the same original UUID and a different purpose',async t=>{
  const f=await fixture(t),write=await f.request(),read=await f.request('READ_SEED'),verifier=f.verifier();
  await verifier.verify({operation:'SEED_GOAL',...write});await verifier.verify({operation:'READ_SEED',...read});
  assert.equal(write.body.input.request_id,read.body.input.request_id);
  assert.notEqual(write.headers['x-a2-device-signature'],read.headers['x-a2-device-signature']);
});
test('authenticated identity is isolated per concurrent async invocation and absent outside it',async t=>{
  const f=await fixture(t),verifier=f.verifier(),context=createNativeCodingAuthenticatedRequestContext({verifier});
  await assert.rejects(context.readCurrentDevice(),/authenticated_scope_required/);
  const [a,b]=await Promise.all(['SEED_GOAL','READ_SEED'].map(async operation=>context.run(operation,await f.request(operation),async value=>{
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(value,input);return context.readCurrentDevice();})));
  assert.deepEqual(a,b);assert.equal(a.device_id,f.device.device_id);await assert.rejects(context.readCurrentDevice(),/authenticated_scope_required/);
  context.close();await assert.rejects(context.run('READ_SEED',await f.request('READ_SEED'),()=>{}),/context_closed/);
});
