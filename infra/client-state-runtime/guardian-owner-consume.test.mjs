import test from 'node:test';
import assert from 'node:assert/strict';
import * as production from './guardian-owner-consume.mjs';
import {createGuardianConsumeTransaction} from './test/guardian-owner-consume-private-loader.mjs';

test('production exports no injected SQL/verifier/SID transaction or public signing producer',()=>{
  assert.deepEqual(Object.keys(production),['createOwnedGuardianTicketConsumer','validateGuardianOwnerConsumeEnvelope']);
});
test('supplied SQL/credentials/owner assertion/verification override is not an acquisition option',async()=>{
  for(const key of ['sql','databaseUrl','ownerSid','verifyCustody','platform','send','parentPid']){
    await assert.rejects(production.createOwnedGuardianTicketConsumer({runtime:{},config:{},signal:new AbortController().signal,[key]:()=>true}),/private_dependencies_invalid/);
  }
});
test('no actual owned Windows child context means no connection or capability',{skip:process.platform==='win32'},async()=>{
  await assert.rejects(production.createOwnedGuardianTicketConsumer({runtime:{},config:{},signal:new AbortController().signal}),/owned_host_required/);
});
test('malformed private input cannot invoke SQL or custody',async()=>{
  let calls=0;const service=createGuardianConsumeTransaction({sql:{unsafe(){calls++;}},binding:{},verifyCustody(){calls++;}});
  for(const input of [null,{},[],{body:{},headers:{}},{body:{schema:'metaengine.private.guardian-owner-consume.v1'},headers:{},sql:'caller'}]){
    await assert.rejects(service.consume(input),/request_invalid/);
  }
  assert.equal(calls,0);await service.close();
});

test('Host source closure inventories the exact consumer and excludes every private test loader',async()=>{
  const {sourceClosure}=await import('./startup-source-manifest.mjs');
  const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../..',import.meta.url));
  const entry=fileURLToPath(new URL('./runtime-host.mjs',import.meta.url));
  const closure=await sourceClosure([entry],root);
  for(const module of ['./guardian-owner-consume.mjs','./runtime-recovery-postgres-proof.mjs',
    '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs',
    '../../apps/metaengine-browser/src/native-coding-host-observers.mjs',
    '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs']){
    assert(closure.files.includes(fileURLToPath(new URL(module,import.meta.url))),module);
  }
  assert(closure.files.every(file=>!file.includes('/test/')&&!/\.test\.mjs$/.test(file)&&!file.includes('private-loader')));
  assert(!closure.npm.includes('electron'));
});
