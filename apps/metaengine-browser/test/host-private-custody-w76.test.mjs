import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHostPrivateCustodyW76 } from '../src/host-private-custody-w76.mjs';

const device = Object.freeze({
  client_id:'c6d3b6ed-99cb-42f9-a654-f18ec08132e9',
  device_id:'f93d5d43-06e8-4e62-881a-8f55c117da5d',
  key_fingerprint_sha256:'a'.repeat(64),enrolled:true,
});
const observed = () => new Date().toISOString();
const owner = () => ({
  schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
  authority_effect:false,owner_id:device.client_id,device_id:device.device_id,
  project_id:'4596c3dc-81de-4102-8f8e-07962c3307a6',
  pid:7340,created_at:observed(),
  process_incarnation_id:'pid:7340:created_100ns:134048012345678901',
  epoch:2,generation:7,source_sha:'b'.repeat(40),observed_at:observed(),
  fixture_classification:'STAGING',
});
function fakeIdentity(read) {
  return {snapshot:()=>device,readTrustedHostOwnerIncarnationW74:read};
}
test('W76 absent W74 genesis never calls the W67 Host reader or creates Owner',async()=>{
  const identity={snapshot:()=>device,readHostOwnerIncarnation:()=>{throw Error('CIRCULAR_W67');}};
  const x=createHostPrivateCustodyW76({identity});
  assert.equal(await x.readTrustedHostOwnerIncarnation(),null);
  assert.equal(await x.readPrivateOwnerGatewayCredential(device.client_id,7),null);
  assert.equal(await x.readPrivateOwnPostgresBirth(device.client_id,2),null);
  assert.equal(await x.readProtectedBackupRoot(),null);
  x.close();
});
test('W76 generated or forged Owner evidence is always STAGING/UNKNOWN',async()=>{
  for(const mutate of [
    x=>x,
    x=>({...x,fixture_classification:undefined,staging:true}),
    x=>({...x,fixture_classification:undefined,process_incarnation_id:'pid:7340:created_100ns:134048012345678902',source_sha:'x'}),
    x=>({...x,fixture_classification:undefined,epoch:0}),
    x=>({...x,fixture_classification:undefined,device_id:'00000000-0000-4000-8000-000000000000'}),
  ]) {
    const fake=mutate(owner());let called=0;
    const x=createHostPrivateCustodyW76({identity:fakeIdentity(async()=>{called++;return fake;}),
      readExistingGatewaySecret:()=>{throw Error('SECRET_MUST_NOT_BE_READ');},
      readExistingOwnPostgresBirth:()=>{throw Error('PG_MUST_NOT_BE_READ');},
      readExistingProtectedBackupRoot:()=>{throw Error('ROOT_MUST_NOT_BE_READ');}});
    assert.equal(await x.readTrustedHostOwnerIncarnation(),null);
    assert.equal(await x.readPrivateOwnerGatewayCredential(device.client_id,7),null);
    assert.equal(await x.readPrivateOwnPostgresBirth(device.client_id,2),null);
    assert.equal(await x.readProtectedBackupRoot(),null);
    assert.ok(called>=1);
    x.close();
  }
});
test('W76 exact 100ns incarnation mismatch rejects equality at ISO millisecond precision',async()=>{
  const seq=[{...owner(),fixture_classification:undefined},
    {...owner(),fixture_classification:undefined,process_incarnation_id:'pid:7340:created_100ns:134048012345678902'}];
  let i=0;
  const x=createHostPrivateCustodyW76({identity:fakeIdentity(async()=>seq[Math.min(i++,1)])});
  assert.equal(await x.readTrustedHostOwnerIncarnation(),null);
  x.close();
});
test('W76 revoke and before/after identity drift fail closed',async()=>{
  let i=0;
  const identity={snapshot:()=>i++===0?device:{...device,device_id:'00000000-0000-4000-8000-000000000000'},
    readTrustedHostOwnerIncarnationW74:async()=>({...owner(),fixture_classification:undefined})};
  const x=createHostPrivateCustodyW76({identity});
  assert.equal(await x.readTrustedHostOwnerIncarnation(),null);
  x.close();
  assert.equal(await x.readTrustedHostOwnerIncarnation(),null);
});
test('W76 production default source integration is an independent W74 reader, never a W67 recursion',async()=>{
  const dir=new URL('../src/',import.meta.url);
  for(const name of ['final-runtime-activation.mjs','host-agent-remote-composition.mjs']) {
    const source=await readFile(new URL(name,dir),'utf8');
    assert.match(source,/createHostPrivateCustodyW76/);
    assert.match(source,/privateCustody\.readTrustedHostOwnerIncarnation/);
    assert.doesNotMatch(source,/privateCustody\s*=\s*identity\.readHostOwnerIncarnation/);
  }
});
