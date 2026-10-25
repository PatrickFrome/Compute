import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createInstalledRuntimeRecoveryBindingReader} from '../src/runtime-recovery-installed-binding.mjs';
import {runtimeRecoveryPostgresProof} from '../../../infra/client-state-runtime/runtime-recovery-postgres-proof.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-installed-recovery-')));
  t.after(async()=>{assert.ok(root.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(root,{recursive:true,force:true});});
  const resources=path.join(root,'resources'),bundle=path.join(resources,'client-state-runtime'),data=path.join(root,'synthetic-pgdata'),state=path.join(root,'state');
  for(const dir of [bundle,data,state])await fs.mkdir(dir,{recursive:true});
  const appPath=path.join(resources,'app.asar'),pgExe=path.join(root,'postgres.exe'),ownerFile=path.join(root,'owner.json'),statusFile=path.join(state,'runtime-status.json');
  await fs.writeFile(appPath,'synthetic ASAR fixture bytes; not an installed image');await fs.writeFile(pgExe,'synthetic PostgreSQL image fixture');
  await fs.writeFile(path.join(bundle,'offline-runtime-bundle.json'),'synthetic reviewed manifest');
  const version='0.7.0-dev.1107139874589.1',bundleSha='a'.repeat(64),instance_id=randomUUID(),host_pid=321;
  const pkg={version,metaengineClientStateRuntime:{schema:'metaengine.browser.client-state-runtime-binding.v1',schema_version:1,package_version:version,
    source_head_sha:'b'.repeat(40),bundle_manifest_relative_path:'offline-runtime-bundle.json',runtime_verifier_relative_path:'infra/client-state-runtime/offline-runtime-bundle.mjs',
    resource_file_count:10,resource_size_bytes:1234,bundle_sha256:bundleSha,bundle_manifest_sha256:hash('synthetic reviewed manifest'),
    runtime_verifier_sha256:'b'.repeat(64),source_bundle_sha256:'c'.repeat(64),reviewed_startup_source_sha256:'d'.repeat(64),
    reviewed_startup_files_sha256:'e'.repeat(64),resource_inventory_sha256:'f'.repeat(64),authority_effect:false}};
  const owner={schema:'metaengine.browser.local-state-provider-config.v1',version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
    base_url:'http://127.0.0.1:55434/a2-browser-native-supervisor-v1',runtime_identity_file:statusFile,authority_effect:false,
    runtime_host:{bundle_directory:bundle,expected_bundle_sha256:bundleSha,config_file:path.join(root,'never-created-private-server-config.json')}};
  await fs.writeFile(ownerFile,JSON.stringify(owner));
  await fs.writeFile(path.join(data,'PG_VERSION'),'17\n');await fs.writeFile(path.join(data,'postmaster.pid'),`42\n${data}\n1792886400\n25434\n\n127.0.0.1\nready\n`);
  const pg=await runtimeRecoveryPostgresProof({identity:{pid:42,version:170007,system_identifier:'7654321098765432100',started_at:'2026-10-25T00:00:00.000Z',
    data_directory:data,port:25434},pgDataDirectory:data});
  let status={schema:'metaengine.client-state.runtime-status.v1',state:'READY',runtime_ready:true,host_pid,instance_id,bundle_sha256:bundleSha,
    postgres_continuity:pg,authority_effect:false},generation={ever_ready:true,exited:false,stopping:false,transport_failed:false,terminal:null,
      terminal_rejected:false,instance_id,host_pid,launch_nonce:randomUUID()},summary={pid:host_pid,instance_id};
  await fs.writeFile(statusFile,JSON.stringify(status));
  let physical={schema:'metaengine.browser.runtime-recovery-process.v1',state:'PRESENT',pid:42,created_100ns:'134000000000000000',executable:pgExe,authority_effect:false};
  const options={app:{isPackaged:true,getAppPath:()=>appPath,getVersion:()=>version},resourcesPath:resources,ownerFile,
    getBootstrap:()=>({state:'READY',persistent:true,owner_file:ownerFile,instance_id}),readSummary:()=>summary,
    readGeneration:async()=>generation,verifyStorage:async()=>({owner_dacl_verified:true}),readProcess:async()=>physical,readPackage:async()=>pkg};
  return {root,data,statusFile,ownerFile,pgExe,pkg,owner,options,read:createInstalledRuntimeRecoveryBindingReader(options),
    get status(){return status;},set status(value){status=value;},get physical(){return physical;},set physical(value){physical=value;},
    stop:async()=>{status={...status,state:'STOPPED',runtime_ready:false};summary=null;generation={...generation,exited:true};await fs.writeFile(statusFile,JSON.stringify(status));},
    save:()=>fs.writeFile(statusFile,JSON.stringify(status))};
}
test('actual file pins consume Host-only PG proof; terminal Host retains same PG/Owner/artifact identity',async t=>{
  const f=await fixture(t),ready=await f.read();assert.equal(ready.normal_bootstrap_ready,true);assert.equal(ready.host.pid,321);
  assert.ok(!JSON.stringify(ready).includes(f.data));assert.ok(!JSON.stringify(ready).includes('private-server-config'));
  await f.stop();const stopped=await f.read();assert.equal(stopped.normal_bootstrap_ready,false);assert.equal(stopped.host,null);
  for(const key of ['owner_sha256','asar_sha256','bundle_sha256','bundle_manifest_sha256','pg_identity_sha256'])assert.equal(ready[key],stopped[key]);
});
test('PG producer order is rehydrated after JSON key reordering; tampered identity is held',async t=>{
  const f=await fixture(t),expected=await f.read();f.status={...f.status,postgres_continuity:Object.fromEntries(Object.entries(f.status.postgres_continuity).reverse())};await f.save();
  assert.equal((await f.read()).pg_identity_sha256,expected.pg_identity_sha256);
  f.status.postgres_continuity.pid=43;await f.save();await assert.rejects(f.read(),/binding_unproven/);
});
test('physical PG disappearance, a different executable and unprotected Owner never qualify',async t=>{
  const f=await fixture(t);const original=f.physical;f.physical={...original,state:'ABSENT'};await assert.rejects(f.read(),/binding_unproven/);
  f.physical={...original,executable:process.execPath};await assert.rejects(f.read(),/binding_unproven/);
  f.physical=original;
  await assert.rejects(createInstalledRuntimeRecoveryBindingReader({...f.options,verifyStorage:async()=>({owner_dacl_verified:false})})(),/binding_unproven/);
});
test('operator gate, other package version and manifest mutation deny all recovery effects',async t=>{
  const f=await fixture(t);await fs.writeFile(f.ownerFile+'.qa-upgrade-gate.json','{}');await assert.rejects(f.read(),/binding_unproven/);
  await fs.unlink(f.ownerFile+'.qa-upgrade-gate.json');const version=f.pkg.version;f.pkg.version='9.0.0';await assert.rejects(f.read(),/binding_invalid/);
  f.pkg.version=version;await fs.writeFile(path.join(f.owner.runtime_host.bundle_directory,'offline-runtime-bundle.json'),'changed manifest');
  await assert.rejects(f.read(),/binding_unproven/);
});
test('physical PostgreSQL image mutation changes the immutable continuity pin',async t=>{
  const f=await fixture(t),before=await f.read();await fs.writeFile(f.pgExe,'changed synthetic image');
  assert.notEqual((await f.read()).pg_identity_sha256,before.pg_identity_sha256);
});
