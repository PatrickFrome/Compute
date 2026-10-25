import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
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

test('real Electron pins physical ASAR bytes while package reads remain archive-aware',async t=>{
  const electron=process.env.METAENGINE_ELECTRON_BINARY;
  if(!electron){t.skip('Set METAENGINE_ELECTRON_BINARY to run the real Electron ASAR boundary regression');return;}
  assert.ok(path.isAbsolute(electron));
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-recovery-electron-')));
  t.after(async()=>{assert.ok(root.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(root,{recursive:true,force:true});});
  const entry=path.join(root,'probe.mjs');
  const imports=[
    "import assert from 'node:assert/strict';",
    "import {createHash,randomUUID} from 'node:crypto';",
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import raw from 'original-fs';",
    "import {app} from 'electron';",
    `import {createInstalledRuntimeRecoveryBindingReader} from ${JSON.stringify(new URL('../src/runtime-recovery-installed-binding.mjs',import.meta.url).href)};`,
    `import {runtimeRecoveryPostgresProof} from ${JSON.stringify(new URL('../../../infra/client-state-runtime/runtime-recovery-postgres-proof.mjs',import.meta.url).href)};`,
    "const hash=value=>createHash('sha256').update(value).digest('hex');",
  ];
  const probe=`
let exitCode=0;
try {
  const f=await fixture({after:()=>{}});
  const packageBytes=Buffer.from(JSON.stringify(f.pkg));
  const header=Buffer.from(JSON.stringify({files:{'package.json':{offset:'0',size:packageBytes.length}}}));
  const headerBuffer=Buffer.alloc(8+Math.ceil(header.length/4)*4);
  headerBuffer.writeUInt32LE(headerBuffer.length-4,0);headerBuffer.writeUInt32LE(header.length,4);header.copy(headerBuffer,8);
  const sizeBuffer=Buffer.alloc(8);sizeBuffer.writeUInt32LE(4,0);sizeBuffer.writeUInt32LE(headerBuffer.length,4);
  const archive=Buffer.concat([sizeBuffer,headerBuffer,packageBytes]),appPath=f.options.app.getAppPath();
  await raw.promises.writeFile(appPath,archive);
  assert.equal((await fs.lstat(appPath)).isDirectory(),true);
  assert.equal((await raw.promises.lstat(appPath)).isFile(),true);
  // Exercise the production default package reader, rather than a mock which
  // would hide accidentally switching internal archive reads to original-fs.
  const {readPackage,...options}=f.options;
  const read=createInstalledRuntimeRecoveryBindingReader(options),ready=await read();
  assert.equal(ready.normal_bootstrap_ready,true);assert.equal(ready.asar_sha256,hash(archive));
  await f.stop();const stopped=await read();assert.equal(stopped.normal_bootstrap_ready,false);
  assert.equal(stopped.asar_sha256,ready.asar_sha256);
  await raw.promises.link(appPath,path.join(f.root,'archive-hardlink'));
  await assert.rejects(read(),/binding_unproven/);
  console.log(JSON.stringify({schema:'metaengine.test.runtime-recovery-asar.v1',state:'PASS',
    actual_electron:process.versions.electron,physical_archive_sha256:ready.asar_sha256,
    archive_aware_package_read:true,hardlink_rejected:true,installed_runtime_proof:false,authority_effect:false}));
} catch(error) {exitCode=1;console.error(error.stack||error);}
// Electron keeps archive handles cached until exit. The parent removes this
// private temporary tree after process completion, including on assertion failure.
app.exit(exitCode);
`;
  await fs.writeFile(entry,[...imports,fixture.toString(),probe].join('\n'));
  const {stdout,stderr}=await new Promise((resolve,reject)=>{
    const child=execFile(electron,[entry],{windowsHide:true,timeout:30000,maxBuffer:32768,
      env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}},(error,stdout,stderr)=>{
      if(error){error.message+='\n'+stdout+'\n'+stderr;reject(error);}else resolve({stdout,stderr});
    });child.stdin?.end();
  });
  const receipt=stdout.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}})
    .find(value=>value?.schema==='metaengine.test.runtime-recovery-asar.v1');
  assert.equal(receipt?.state,'PASS',stdout+'\n'+stderr);
  assert.equal(receipt?.archive_aware_package_read,true);assert.equal(receipt?.hardlink_rejected,true);
  assert.equal(receipt?.installed_runtime_proof,false);
});
