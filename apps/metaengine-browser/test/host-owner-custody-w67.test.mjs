import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { guardianClientKernelBirthW67 } from '../src/guardian-client-kernel-birth-w67.mjs';
import { SupervisorDeviceIdentity } from '../src/supervisor-device-identity.mjs';
import { createHostAgentServer, HostAgentClient, hostAgentEndpoint } from '../src/host-agent-ipc.mjs';

const genesis = () => {
  const born = new Date('2026-10-15T00:00:00.000Z');
  const ticks = (BigInt(born.getTime()) * 10000n + 116444736000000000n).toString();
  return { client_pid: 9876, client_creation_time_100ns: ticks,
    // A native W75 postchallenge kernel recheck is now mandatory for proof.
    client_kernel_birth_rechecked: true,
    client_process_incarnation_id: `pid:9876:created_100ns:${ticks}` };
};

test('W67 Guardian: native FILETIME precision, process incarnation, numeric overflow', () => {
  const x = genesis();
  const got = guardianClientKernelBirthW67(x);
  assert.deepEqual(got, {pid:9876,created_at:'2026-10-15T00:00:00.000Z',
    process_incarnation_id:x.client_process_incarnation_id});
  for (const bad of [{client_pid:9877}, {client_creation_time_100ns:1},
      {client_creation_time_100ns:'0'}, {client_creation_time_100ns:'9'.repeat(20)},
      {client_process_incarnation_id:'pid:9876:created_100ns:0'},
      {client_pid:0}, {client_pid:2147483648}])
    assert.equal(guardianClientKernelBirthW67({...x,...bad}),null);
});

test('W67 real HMAC Host path refuses process-only diagnostics, STAGING Owner, key and epoch drift', async () => {
  // Only a uniquely disposable source fixture; no installed profile, enrollment,
  // Guardian machine service, production PostgreSQL, Vault, or Owner touched.
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w67-staging-'));
  const endpoint=hostAgentEndpoint({userDataPath:dir});
  const sessionKey=crypto.randomBytes(32).toString('base64url');
  let reply={schema:'metaengine.host.owner-native-readback.w60.v1',
    state:'KERNEL_PROCESS_OBSERVED',owner_binding_proven:false,authority_effect:false,
    kernel:{pid:process.pid,created_at:new Date().toISOString(),source:'OS_PROCESS_INVENTORY'}};
  const server=createHostAgentServer({endpoint,sessionKey,handlers:{
    OWNER_NATIVE_READBACK:async payload=>{
      assert.deepEqual(payload,{});
      return reply;
    },
  }});
  let secretCalls=0,pgCalls=0;
  const identity=new SupervisorDeviceIdentity({
    statePath:path.join(dir,'device-staging.json'),
    secureStorage:{
      isEncryptionAvailable:()=>true,
      encryptString:s=>Buffer.from(s,'utf8'),
      decryptString:b=>Buffer.from(b).toString('utf8'),
    },
  });
  const client=new HostAgentClient({endpoint,sessionKey});
  try {
    await identity.ensure();
    await identity.bindDevice(crypto.randomUUID());
    await server.start();
    await client.connect();
    const unbind=identity.bindHostCustodyW67({
      hostAgentClient:client,
      privateGatewayReadback:async()=>{secretCalls++;return {api_key:'S'.repeat(64)};},
      privatePostgresBirth:async()=>{pgCalls++;return {source:'OWN_PG_POSTMASTER_READBACK'};},
    });
    assert.equal(await identity.readHostOwnerIncarnation(),null);
    assert.equal(await identity.readPrivateOwnerGatewayCredential(identity.snapshot().client_id,3),null);
    assert.equal(await identity.readPrivateOwnPostgresBirthW67(identity.snapshot().client_id,2),null);
    assert.equal(secretCalls,0);
    assert.equal(pgCalls,0);
    // Authenticated transport alone is not Owner proof: reject STAGING/fixture.
    reply={...reply,owner_binding_proven:true,owner:{
      schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
      fixture_classification:'STAGING',staging:true,authority_effect:false,
      owner_id:identity.snapshot().client_id, device_id:identity.snapshot().device_id,
      project_id:crypto.randomUUID(), pid:process.pid,
      created_at:reply.kernel.created_at, generation:3,epoch:2,
      process_incarnation_id:'staging-incarnation-w67',
      source_sha:'1'.repeat(40),observed_at:new Date().toISOString(),
    }};
    assert.equal(await identity.readHostOwnerIncarnation(),null);
    unbind();
    assert.equal(await identity.readHostOwnerIncarnation(),null);
    assert.equal(await identity.readPrivateOwnerGatewayCredential(identity.snapshot().client_id,3),null);
  } finally {
    client.close();
    await server.close();
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('W67 missing signed Guardian/Owner/PG never upgrades enrolled device',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w67-guardian-staging-'));
  try {
    const identity=new SupervisorDeviceIdentity({
      statePath:path.join(dir,'staging-device.json'),
      secureStorage:{isEncryptionAvailable:()=>true,
        encryptString:s=>Buffer.from(s),decryptString:b=>Buffer.from(b).toString('utf8')},
    });
    await identity.ensure();
    await identity.bindDevice(crypto.randomUUID());
    const unbind = identity.bindGuardianOwnerEvidenceW67({status:async()=>({
      schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
      state:'READY',owner_binding_proven:true,device_binding_proven:true,
      guardian_client_kernel_birth_verified:false,
    })});
    assert.equal(await identity.readGuardianOwnerEvidenceW67(),null);
    unbind();
    const owner = genesis();
    let challenge = 0;
    identity.bindGuardianOwnerEvidenceW67({status:async()=>({
      schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
      state:'READY',owner_binding_proven:true,device_binding_proven:true,
      authority_effect:false,guardian_client_kernel_birth_verified:true,
      guardian_client_pid:owner.client_pid + challenge++,
      guardian_client_created_at:'2026-10-15T00:00:00.000Z',
      guardian_client_process_incarnation_id:owner.client_process_incarnation_id,
      guardian_enrollment_evidence_sha256:'1'.repeat(64),
      guardian_device_key_fingerprint_sha256:identity.snapshot().key_fingerprint_sha256,
    })});
    // Two *different* native challenge observations cannot be joined.
    assert.equal(await identity.readGuardianOwnerEvidenceW67(),null);
    assert.equal(await identity.readHostOwnerIncarnation(),null);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

// Regression fence: importing the previous launcher as a static test import
// loaded native-supervisor-endpoints -> local-provider-bootstrap and could start
// a configured Host in a user's profile. Keep W67 test imports side-effect free.
test('W67 source fixture cannot import installed local-provider bootstrap',async()=>{
  const source=await fs.readFile(new URL('../src/guardian-client-kernel-birth-w67.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^\\s*import\\s/m);
  const fixture=await fs.readFile(new URL(import.meta.url),'utf8');
  assert.doesNotMatch(fixture,/^\\s*import\\s+.*browser-guardian-machine-bootstrap-launcher/m);
  assert.doesNotMatch(fixture,/^\\s*import\\s+.*native-supervisor-endpoints/m);
  assert.doesNotMatch(fixture,/^\\s*import\\s+.*local-state-provider-bootstrap/m);
});
