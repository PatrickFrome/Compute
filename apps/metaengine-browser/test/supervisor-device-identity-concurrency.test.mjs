import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import {
  ENROLLMENT_SIGNATURE_PROFILE,
  SUPERVISOR_DEVICE_PROFILE,
  SupervisorDeviceIdentity,
} from '../src/supervisor-device-identity.mjs';

function testStorage() {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString(value) {
      calls.encrypt += 1;
      return Buffer.from(`test-only:${value}`);
    },
    decryptString(value) {
      calls.decrypt += 1;
      return Buffer.from(value).toString().replace(/^test-only:/, '');
    },
  };
}

async function temporaryState(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-device-concurrency-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'device.json');
}

async function assertEnrollmentSignature(identity, snapshot) {
  const bodyText = JSON.stringify({
    profile: snapshot.profile,
    public_jwk: snapshot.public_jwk,
    key_fingerprint_sha256: snapshot.key_fingerprint_sha256,
  });
  const headers = await identity.enrollmentHeaders(bodyText);
  const material = [
    ENROLLMENT_SIGNATURE_PROFILE,
    `client_id:${snapshot.client_id}`,
    `profile:${SUPERVISOR_DEVICE_PROFILE}`,
    `fingerprint:${snapshot.key_fingerprint_sha256}`,
    `timestamp:${headers['x-metaengine-enroll-timestamp']}`,
    `nonce:${headers['x-metaengine-enroll-nonce']}`,
    `body_sha256:${crypto.createHash('sha256').update(bodyText).digest('hex')}`,
  ].join('\n');
  assert.equal(crypto.verify('sha256', Buffer.from(material), {
    key: crypto.createPublicKey({ key: snapshot.public_jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }, Buffer.from(headers['x-metaengine-enroll-signature'], 'base64url')), true);
}

test('parallel fresh startup persists one identity and every enrollment signature verifies', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const snapshots = await Promise.all(Array.from({ length: 16 }, () => identity.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot, snapshots[0]);
    assert.equal(Object.hasOwn(snapshot, 'encrypted_private_key_b64'), false);
  }
  await Promise.all(snapshots.map((snapshot) => assertEnrollmentSignature(identity, snapshot)));
  const stored = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(stored.client_id, snapshots[0].client_id);
  assert.deepEqual(stored.public_jwk, snapshots[0].public_jwk);
  assert.equal(stored.key_fingerprint_sha256, snapshots[0].key_fingerprint_sha256);
  assert.equal(stored.encrypted_private_key_b64.includes('PRIVATE KEY'), false);

  const restarted = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const restored = await restarted.ensure();
  assert.deepEqual(restored.public_jwk, snapshots[0].public_jwk);
  assert.equal(restored.client_id, snapshots[0].client_id);
  await assertEnrollmentSignature(restarted, restored);
});

test('parallel cold loads decrypt the existing identity once without rotating its key', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  const original = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const initial = await original.ensure();
  const restarted = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const snapshots = await Promise.all(Array.from({ length: 16 }, () => restarted.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  assert.equal(secureStorage.calls.decrypt, 1);
  for (const snapshot of snapshots) assert.deepEqual(snapshot, snapshots[0]);
  assert.equal(snapshots[0].client_id, initial.client_id);
  assert.deepEqual(snapshots[0].public_jwk, initial.public_jwk);
  assert.equal(snapshots[0].key_fingerprint_sha256, initial.key_fingerprint_sha256);
  await Promise.all(snapshots.map((snapshot) => assertEnrollmentSignature(restarted, snapshot)));
});

test('failed shared initialization can recover after secure storage becomes available', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  let available = false;
  secureStorage.isEncryptionAvailable = () => available;
  const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const failed = await Promise.allSettled(Array.from({ length: 16 }, () => identity.ensure()));
  for (const result of failed) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.message, 'supervisor_secure_storage_unavailable');
  }
  assert.equal(identity.snapshot(), null);
  assert.equal(secureStorage.calls.encrypt, 0);
  await assert.rejects(fs.stat(statePath), { code: 'ENOENT' });
  available = true;
  const recovered = await Promise.all(Array.from({ length: 16 }, () => identity.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  await assertEnrollmentSignature(identity, recovered[0]);
});


test('constructor and cancelled setup do not create identity bytes or encrypt a key',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
 assert.equal(identity.snapshot(),null);assert.equal(secureStorage.calls.encrypt,0);
 await assert.rejects(fs.stat(statePath),{code:'ENOENT'});
});

test('malformed existing identity is never replaced or rekeyed',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const bytes=Buffer.from('{broken exact identity bytes');await fs.writeFile(statePath,bytes);
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
 await assert.rejects(identity.ensure(),SyntaxError);
 assert.deepEqual(await fs.readFile(statePath),bytes);assert.equal(secureStorage.calls.encrypt,0);
 assert.equal(identity.snapshot(),null);
});

test('existing unreadable identity fails without creating a key',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();await fs.mkdir(statePath);
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
 await assert.rejects(identity.ensure());assert.equal(secureStorage.calls.encrypt,0);
 assert((await fs.stat(statePath)).isDirectory());
});

test('mismatched stored private and public keys never load or rotate',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 await new SupervisorDeviceIdentity({statePath,secureStorage}).ensure();
 const other=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'});
 const stored=JSON.parse(await fs.readFile(statePath,'utf8'));
 stored.encrypted_private_key_b64=secureStorage.encryptString(other).toString('base64');
 await fs.writeFile(statePath,JSON.stringify(stored));const bytes=await fs.readFile(statePath),calls=secureStorage.calls.encrypt;
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
 await assert.rejects(identity.ensure(),/private_public_key_mismatch/);
 assert.equal(identity.snapshot(),null);assert.equal(secureStorage.calls.encrypt,calls);assert.deepEqual(await fs.readFile(statePath),bytes);
});

test('two distinct first creators cannot overwrite the winning identity',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const first=new SupervisorDeviceIdentity({statePath,secureStorage}),second=new SupervisorDeviceIdentity({statePath,secureStorage});
 const results=await Promise.allSettled([first.ensure(),second.ensure()]);
 assert(results.some(r=>r.status==='fulfilled'));
 const stored=JSON.parse(await fs.readFile(statePath,'utf8'));
 for(const result of results) {
  if(result.status==='fulfilled')assert.equal(result.value.key_fingerprint_sha256,stored.key_fingerprint_sha256);
  else assert.equal(result.reason.code,'EEXIST');
 }
 const before=await fs.readFile(statePath);
 const reloaded=await new SupervisorDeviceIdentity({statePath,secureStorage}).ensure();
 assert.equal(reloaded.client_id,stored.client_id);assert.deepEqual(await fs.readFile(statePath),before);
});

test('symlink or hard-link identities are refused without modifying their target',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 await new SupervisorDeviceIdentity({statePath,secureStorage}).ensure();
 const bytes=await fs.readFile(statePath),calls=secureStorage.calls.encrypt;
 const linked=statePath+'.linked';await fs.link(statePath,linked);
 await assert.rejects(new SupervisorDeviceIdentity({statePath:linked,secureStorage}).ensure(),/storage_invalid/);
 await fs.unlink(linked);
 if(process.platform!=='win32') {
  await fs.symlink(statePath,linked);
  await assert.rejects(new SupervisorDeviceIdentity({statePath:linked,secureStorage}).ensure(),/storage_invalid/);
 }
 assert.deepEqual(await fs.readFile(statePath),bytes);assert.equal(secureStorage.calls.encrypt,calls);
});

test('identity disappearing after initial observation never triggers a replacement key',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 await new SupervisorDeviceIdentity({statePath,secureStorage}).ensure();
 const bytes=await fs.readFile(statePath),calls=secureStorage.calls.encrypt,read=fs.readFile;
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
 fs.readFile=async(file,...args)=>{if(file===statePath)await fs.unlink(statePath);return read.call(fs,file,...args);};
 try{await assert.rejects(identity.ensure(),/storage_changed/);}finally{fs.readFile=read;}
 assert.equal(identity.snapshot(),null);assert.equal(secureStorage.calls.encrypt,calls);
 await assert.rejects(fs.stat(statePath),{code:'ENOENT'});
 // Only the fixture restores its known original bytes; production never does.
 await fs.writeFile(statePath,bytes,{flag:'wx'});
 assert.equal((await identity.ensure()).key_fingerprint_sha256,JSON.parse(bytes).key_fingerprint_sha256);
 assert.deepEqual(await fs.readFile(statePath),bytes);
});

test('queued enrollment mutations preserve the preceding device binding and use owned temp files',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});await identity.ensure();
 const sentinel=statePath+'.tmp';await fs.writeFile(sentinel,'unrelated');
 const rename=fs.rename;let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let first=true;
 fs.rename=async(...args)=>{if(args[1]===statePath&&first){first=false;entered();await gate;}return rename.call(fs,...args);};
 try{
  const device=crypto.randomUUID();const binding=identity.bindDevice(device);
  await started;const clearing=identity.clearEnrollmentRequest();
  const results=Promise.allSettled([binding,clearing]);
  await new Promise(r=>setImmediate(r));release();
  for(const result of await results)assert.equal(result.status,'fulfilled',result.reason?.stack);
  assert.equal(identity.snapshot().device_id,device);
  assert.equal(JSON.parse(await fs.readFile(statePath,'utf8')).device_id,device);
  assert.equal(await fs.readFile(sentinel,'utf8'),'unrelated');
 }finally{release();fs.rename=rename;}
});

for(const failure of ['writeFile','sync','close'])test(`failed ${failure} preserves identity and enrollment without publishing new state`,async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});await identity.ensure();
 await identity.bindEnrollmentRequest('existing-request');
 const before=await fs.readFile(statePath),snapshot=identity.snapshot(),open=fs.open;
 let injected=false;
 fs.open=async(file,...args)=>{
  const handle=await open.call(fs,file,...args);
  if(String(file).startsWith(statePath+'.')) {
   const original=handle[failure].bind(handle);
   handle[failure]=async(...params)=>{
    if(!injected){injected=true;throw Error('TEST_WRITE_FAILURE');}
    return original(...params);
   };
  }
  return handle;
 };
 try{await assert.rejects(identity.bindDevice(crypto.randomUUID()),/TEST_WRITE_FAILURE/);}
 finally{fs.open=open;}
 assert(injected);assert.deepEqual(await fs.readFile(statePath),before);
 assert.deepEqual(identity.snapshot(),snapshot);
 assert.deepEqual(await fs.readdir(path.dirname(statePath)),['device.json']);
 await identity.clearEnrollmentRequest();
 assert.equal(identity.snapshot().enrollment_request_id,null);
 assert.equal(identity.snapshot().client_id,snapshot.client_id);
});

test('write flush and close finish before atomic replacement; ambiguous replacement fences future writes',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});await identity.ensure();
 const original=identity.snapshot(),open=fs.open,rename=fs.rename,events=[];
 fs.open=async(file,...args)=>{
  const handle=await open.call(fs,file,...args);
  if(String(file).startsWith(statePath+'.')) {
   assert.equal(args[0],'wx');
   for(const operation of ['writeFile','sync','close']){
    const actual=handle[operation].bind(handle);
    handle[operation]=async(...params)=>{const value=await actual(...params);events.push(operation);return value;};
   }
  }
  return handle;
 };
 const device=crypto.randomUUID();
 fs.rename=async(...args)=>{assert.deepEqual(events,['writeFile','sync','close']);await rename.call(fs,...args);throw Error('TEST_LOST_RENAME_ACK');};
 try{await assert.rejects(identity.bindDevice(device),/TEST_LOST_RENAME_ACK/);}
 finally{fs.open=open;fs.rename=rename;}
 const committed=await fs.readFile(statePath);
 assert.throws(()=>identity.snapshot(),/persistence_uncertain/);
 await assert.rejects(identity.ensure(),/persistence_uncertain/);
 await assert.rejects(identity.clearEnrollmentRequest(),/persistence_uncertain/);
 assert.deepEqual(await fs.readFile(statePath),committed);
 const restarted=new SupervisorDeviceIdentity({statePath,secureStorage});
 const restored=await restarted.ensure();assert.equal(restored.device_id,device);
 assert.equal(restored.client_id,original.client_id);assert.deepEqual(restored.public_jwk,original.public_jwk);
 await assertEnrollmentSignature(restarted,restored);
});

test('exclusive temp collision never overwrites or cleans up a file not owned by this operation',async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});await identity.ensure();
 const before=await fs.readFile(statePath),random=crypto.randomUUID;
 const collision=statePath+'.fixture-collision.tmp';await fs.writeFile(collision,'unrelated-temp');
 crypto.randomUUID=()=> 'fixture-collision';
 try{await assert.rejects(identity.clearEnrollmentRequest(),{code:'EEXIST'});}
 finally{crypto.randomUUID=random;}
 assert.deepEqual(await fs.readFile(statePath),before);
 assert.equal(await fs.readFile(collision,'utf8'),'unrelated-temp');
});

for(const boundary of ['before','guardian','host','gateway','postgres'])test(`uncertain clear-binding fences W67 capabilities at ${boundary} boundary`,async t=>{
 const statePath=await temporaryState(t),secureStorage=testStorage();
 const identity=new SupervisorDeviceIdentity({statePath,secureStorage});await identity.ensure();
 await identity.bindDevice(crypto.randomUUID());const snap=identity.snapshot();
 const now=new Date().toISOString(),owner={
  schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',authority_effect:false,
  owner_id:snap.client_id,device_id:snap.device_id,pid:123,epoch:2,generation:3,
  project_id:'unit-test-project',process_incarnation_id:'unit-test-incarnation',
  source_sha:'a'.repeat(40),created_at:now,observed_at:now,
 };
 let armed=false,triggered=false,calls=0;
 const ambiguousClear=async()=>{
  const rename=fs.rename;
  fs.rename=async(...args)=>{await rename.call(fs,...args);throw Error('TEST_CLEAR_ACK_LOST');};
  try{await assert.rejects(identity.clearDeviceBindingForReenrollment(),/TEST_CLEAR_ACK_LOST/);}
  finally{fs.rename=rename;}
  assert.equal(JSON.parse(await fs.readFile(statePath,'utf8')).device_id,null);
 };
 const observe=async(kind)=>{calls++;if(armed&&!triggered&&kind===boundary){triggered=true;await ambiguousClear();}};
 identity.bindGuardianOwnerEvidenceW67({status:async()=>{
  await observe('guardian');return {
   schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',state:'READY',
   owner_binding_proven:true,device_binding_proven:true,guardian_client_kernel_birth_verified:true,
   guardian_client_pid:123,guardian_client_created_at:now,
   guardian_client_process_incarnation_id:owner.process_incarnation_id,
   guardian_enrollment_evidence_sha256:'b'.repeat(64),
   guardian_device_key_fingerprint_sha256:snap.key_fingerprint_sha256,
  };
 }});
 // Deliberate in-memory transport fixture: no socket, installed Host or native
 // proof claim. Exercise the actual identity's capability fences only.
 const client=new HostAgentClient({endpoint:'unit-test-unused',sessionKey:'unit-test-unused'});
 client.request=async()=>{await observe('host');return {
  schema:'metaengine.host.owner-native-readback.w60.v1',owner_binding_proven:true,owner,
  kernel:{pid:owner.pid,created_at:now,source:'OS_PROCESS_INVENTORY'},
 };};
 identity.bindHostCustodyW67({hostAgentClient:client,
  privateGatewayReadback:async()=>{await observe('gateway');return {
   owner_id:owner.owner_id,owner_generation:3,source:'NATIVE_OWNER_SECRET_STORE',api_key:'UNIT_TEST_ONLY_'.repeat(4),
  };},
  privatePostgresBirth:async()=>{await observe('postgres');return {
   schema:'metaengine.own-pg.birth-w61.v1',source:'OWN_PG_POSTMASTER_READBACK',
   owner_id:owner.owner_id,owner_epoch:2,owner_generation:3,owner_device_id:owner.device_id,
   owner_process_incarnation_id:owner.process_incarnation_id,owner_project_id:owner.project_id,
   source_sha:owner.source_sha,postgres_started_at:now,observed_at:now,
  };},
 });
 const readers={guardian:()=>identity.readGuardianOwnerEvidenceW67(),host:()=>identity.readHostOwnerIncarnation(),
  gateway:()=>identity.readPrivateOwnerGatewayCredential(owner.owner_id,3),
  postgres:()=>identity.readPrivateOwnPostgresBirthW67(owner.owner_id,2)};
 for(const read of Object.values(readers))assert(await read(),'fixture must reach the pre-failure capability');
 armed=true;
 if(boundary==='before')await ambiguousClear();
 else {assert.equal(await readers[boundary](),null);assert(triggered);}
 const before=calls;
 for(const read of Object.values(readers))assert.equal(await read(),null);
 assert.equal(calls,before,'fenced identity must not invoke external capability readers');
});
