import test from 'node:test';
import assert from 'node:assert/strict';
import crypto,{randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SupervisorDeviceIdentity,SUPERVISOR_DEVICE_PROFILE} from '../src/supervisor-device-identity.mjs';
import {NATIVE_CODING_DEVICE_PATHS,signLoadedNativeSetupRouteRead} from '../src/native-coding-device-request.mjs';
import {nativeCodingCanonicalJson as json} from '../src/native-coding-task-context.mjs';
const body=()=>({operation:'READ_NATIVE_SETUP_ROUTE_V1',host_instance_id:randomUUID(),host_pid:1234,input:{workspace_id:randomUUID()}});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'loaded-signer-fixture-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'device.json'),calls={encrypt:0,decrypt:0,ensure:0};
 const storage={isEncryptionAvailable:()=>true,encryptString:v=>{calls.encrypt++;return Buffer.from(v);},decryptString:v=>{calls.decrypt++;return v.toString();}};
 const identity=new SupervisorDeviceIdentity({statePath:file,secureStorage:storage});return{dir,file,calls,storage,identity};}
test('loaded signer shares canonical bytes with ordinary signing and never calls ensure, storage or persistence',async t=>{
 const f=await fixture(t);await f.identity.ensure();await f.identity.bindDevice(randomUUID());const b=body(),s=f.identity.snapshot(),opts={timestamp:new Date().toISOString(),nonce:'a'.repeat(32)};
 const old=await f.identity.deviceHeaders('POST',NATIVE_CODING_DEVICE_PATHS.READ_NATIVE_SETUP_ROUTE_V1,json(b),opts),bytes=await fs.readFile(f.file),before={...f.calls};
 f.identity.ensure=()=>{f.calls.ensure++;throw Error('ensure forbidden');};const read=f.identity.nativeSetupRouteReadHeaders(b,opts);
 const without=v=>{const copy={...v};delete copy['x-a2-device-signature'];return copy;};assert.deepEqual(without(read),without(old));
 const material=[SUPERVISOR_DEVICE_PROFILE,`device_id:${s.device_id}`,'method:POST',`path:${NATIVE_CODING_DEVICE_PATHS.READ_NATIVE_SETUP_ROUTE_V1}`,`timestamp:${opts.timestamp}`,`nonce:${opts.nonce}`,`body_sha256:${read['x-a2-device-body-sha256']}`].join('\n');
 for(const headers of [old,read])assert.equal(crypto.verify('sha256',Buffer.from(material),{key:crypto.createPublicKey({key:s.public_jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(headers['x-a2-device-signature'],'base64url')),true);
 const packet=await signLoadedNativeSetupRouteRead({identity:f.identity,binding:{instance_id:b.host_instance_id,host_pid:b.host_pid},input:b.input});assert.equal(packet.body.operation,'READ_NATIVE_SETUP_ROUTE_V1');assert.deepEqual(f.calls,before);assert.deepEqual(await fs.readFile(f.file),bytes);
});
test('missing and existing-but-unloaded identities do not create, load or decrypt a key',async t=>{
 const f=await fixture(t);assert.throws(()=>f.identity.nativeSetupRouteReadHeaders(body()),/not_loaded/);await assert.rejects(fs.stat(f.file),{code:'ENOENT'});assert.deepEqual(f.calls,{encrypt:0,decrypt:0,ensure:0});
 await f.identity.ensure();await f.identity.bindDevice(randomUUID());const before={...f.calls},restarted=new SupervisorDeviceIdentity({statePath:f.file,secureStorage:f.storage});assert.throws(()=>restarted.nativeSetupRouteReadHeaders(body()),/not_loaded/);assert.equal(restarted.snapshot(),null);assert.deepEqual(f.calls,before);
});
test('loaded signer refuses every effect operation, extra selector and unenrolled state',async t=>{
 const f=await fixture(t);await f.identity.ensure();await f.identity.bindDevice(randomUUID());const b=body();
 for(const changed of [{...b,operation:'BEGIN_NATIVE_SETUP_V1'},{...b,operation:'DISCOVER_NATIVE_SETUP_V1'},{...b,path:'/mutate'},
  {...b,input:{...b.input,command:'run'}},{...b,host_pid:0}])assert.throws(()=>f.identity.nativeSetupRouteReadHeaders(changed));
 await f.identity.clearDeviceBindingForReenrollment();f.identity.ensure=()=>{throw Error('ensure forbidden');};assert.throws(()=>f.identity.nativeSetupRouteReadHeaders(b),/not_loaded/);
});
