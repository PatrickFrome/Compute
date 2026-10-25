import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createNativeCodingHostImageGuard} from './native-coding-host-os-scope.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

test('private Host qualifies real immutable bytes once and denies use before qualification',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-host-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'image.bin');await fs.writeFile(file,'real-test-image');
 const guard=createNativeCodingHostImageGuard();await assert.rejects(guard.read(file),/image_not_prepared/);
 await Promise.all([guard.prepare([file]),guard.prepare([file])]);const expected=createHash('sha256').update('real-test-image').digest('hex');
 assert.equal(await guard.read(file),expected);await guard.prepare([file]);assert.equal(await guard.read(file),expected);
});
for(const mutation of ['bytes','same-byte-replacement','link'])test('prepared Host never silently requalifies '+mutation,async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-host-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'image.bin'),alias=path.join(dir,'alias.bin');await fs.writeFile(file,'image-v1');
 const guard=createNativeCodingHostImageGuard();await guard.prepare([file]);
 if(mutation==='bytes')await fs.writeFile(file,'image-v2');
 if(mutation==='same-byte-replacement'){await fs.rename(file,alias);await fs.writeFile(file,'image-v1');}
 if(mutation==='link')await fs.link(file,alias);
 await assert.rejects(guard.read(file),/image_preparation_invalidated|image_file_unverified/);
 if(mutation==='link')await fs.unlink(alias);
 await assert.rejects(guard.prepare([file]),/image_preparation_invalidated/);
});

test('actual checkpoint and native OS scope functions route PG identity through the private active reader',async()=>{
  const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  async function postgres('),end=source.indexOf('  function journalPath(');
  assert.ok(start>0&&end>start);
  const f=admissionFixture(),p=f.permit,pg=p.postgres.postmaster,host=f.provider.payload.host_process;
  const resources=path.resolve('C:/METAENGINE/fixture-install/resources'),expectedExe=path.join(path.dirname(resources),'METAENGINE Browser Test.exe');
  const config={bundle_directory:path.join(resources,'client-state-runtime'),state_directory:path.resolve('C:/METAENGINE/fixture-state'),
    pg_data_directory:path.resolve('C:/METAENGINE/fixture-pg'),inspect_database_url:'postgresql://127.0.0.1:55432/fixture',
    expected_cluster_system_identifier:p.postgres.system_identifier,expected_bundle_sha256:p.artifact.runtime_bundle_sha256};
  const operator={cli_executable:path.resolve('C:/METAENGINE/fixture-cli/codex.exe'),git_executable:path.resolve('C:/METAENGINE/fixture-git/git.exe')};
  const pidText=[pg.pid,config.pg_data_directory,Math.floor(Date.parse(pg.created_at)/1000),55432,'','127.0.0.1','ready',''].join('\n');
  let transactionReads=0,baseReads=0;
  const tx={unsafe:async text=>{transactionReads++;assert.match(text,/pg_control_system/);return[{data_directory:config.pg_data_directory,
    version:170006,address:'127.0.0.1',port:55432,system_identifier:p.postgres.system_identifier}];}};
  const sql={unsafe:async()=>{baseReads++;throw Error('EXTRA_BASE_POOL_BORROW');}};
  const fileHashes=new Map([[expectedExe,p.artifact.installed_exe_sha256],[path.join(resources,'app.asar'),p.artifact.installed_asar_sha256],
    [operator.cli_executable,p.artifact.cli_executable_sha256]]);
  const scope={sql,config,resources,expectedExe,parentPid:host.pid,path,URL,Date,Number,Promise,
    process:{env:{SystemRoot:'C:/Windows'}},fs:{readFile:async()=>pidText},
    fail:reason=>{throw Error('native_coding_host_os_'+reason);},
    samePath:(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase(),
    publicProcess:value=>({pid:value.pid,created_at:value.created_at,process_incarnation_id:value.process_incarnation_id}),
    readNativeCodingWindowsProcess:async pid=>pid===pg.pid?{...pg,exe_path:path.resolve('C:/METAENGINE/fixture-pg-bin/postgres.exe')}:
      {...host,exe_path:expectedExe,user_sid:p.user_sid},
    readDirectoryIdentity:async directory=>directory===config.pg_data_directory?p.postgres.data_directory_identity_sha256:p.worktree.root_identity_sha256,
    readNativeCodingOperatorPaths:async()=>operator,
    image:{prepare:async()=>{},read:async file=>fileHashes.get(file)},
    run:async()=>({stdout:p.worktree.base_sha}),
    readNativeCodingGitProof:async()=>({head:p.worktree.base_sha,artifact_sha256:'a'.repeat(64)}),
  };
  const readers=vm.runInNewContext(source.slice(start,end)+'\n({readNativeScope,readCheckpointScope})',scope);
  const result=await readers.readCheckpointScope(p,tx);
  assert.equal(result.postgres.system_identifier,p.postgres.system_identifier);
  assert.equal(result.git.head,p.worktree.base_sha);assert.equal(transactionReads,1);assert.equal(baseReads,0);
  await assert.rejects(readers.readCheckpointScope(p),/EXTRA_BASE_POOL_BORROW/);
  assert.equal(baseReads,1,'existing callers still default to the original private SQL connection');
});
