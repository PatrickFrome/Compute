import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createNativeCodingHostImageGuard} from './native-coding-host-os-scope.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

// The production guard intentionally rejects aliased paths. Windows TEMP may
// use an 8.3 spelling; test images must start beneath its physical parent.
async function imageDirectory(t,temporary=os.tmpdir()) {
 const parent=await fs.realpath(temporary);
 const directory=await fs.realpath(await fs.mkdtemp(path.join(parent,'metaengine-host-image-')));
 t.after(async()=>{
  const actual=await fs.realpath(directory),stat=await fs.lstat(directory);
  if(actual!==directory||!stat.isDirectory()||stat.isSymbolicLink()
    ||path.dirname(directory)!==parent||!path.basename(directory).startsWith('metaengine-host-image-'))
   throw Error('fixture_cleanup_scope');
  await fs.rm(directory,{recursive:true,force:false});
 });
 return directory;
}

test('private Host qualifies real immutable bytes once and denies use before qualification',async t=>{
 const dir=await imageDirectory(t);
 const file=path.join(dir,'image.bin');await fs.writeFile(file,'real-test-image');
 const guard=createNativeCodingHostImageGuard();await assert.rejects(guard.read(file),/image_not_prepared/);
 await Promise.all([guard.prepare([file]),guard.prepare([file])]);const expected=createHash('sha256').update('real-test-image').digest('hex');
 assert.equal(await guard.read(file),expected);await guard.prepare([file]);assert.equal(await guard.read(file),expected);
});
for(const mutation of ['bytes','same-byte-replacement','link'])test('prepared Host never silently requalifies '+mutation,async t=>{
 const dir=await imageDirectory(t);
 const file=path.join(dir,'image.bin'),alias=path.join(dir,'alias.bin');await fs.writeFile(file,'image-v1');
 const guard=createNativeCodingHostImageGuard();await guard.prepare([file]);
 if(mutation==='bytes')await fs.writeFile(file,'image-v2');
 if(mutation==='same-byte-replacement'){await fs.rename(file,alias);await fs.writeFile(file,'image-v1');}
 if(mutation==='link')await fs.link(file,alias);
 await assert.rejects(guard.read(file),/image_preparation_invalidated|image_file_unverified/);
 if(mutation==='link')await fs.unlink(alias);
 await assert.rejects(guard.prepare([file]),/image_preparation_invalidated/);
});

test('image fixture canonicalizes an aliased temporary parent without weakening the production path guard',async t=>{
 const root=await imageDirectory(t),physical=path.join(root,'physical'),alias=path.join(root,'alias');
 await fs.mkdir(physical);await fs.symlink(physical,alias,process.platform==='win32'?'junction':'dir');
 const cleanup=[],dir=await imageDirectory({after:fn=>cleanup.push(fn)},alias);
 assert.equal(cleanup.length,1);
 try{
  assert.equal(dir,await fs.realpath(dir));assert.equal(path.dirname(dir),physical);
  const file=path.join(dir,'image.bin');await fs.writeFile(file,'real-aliased-temp-image');
  const guard=createNativeCodingHostImageGuard();await guard.prepare([file]);
  assert.equal(await guard.read(file),createHash('sha256').update('real-aliased-temp-image').digest('hex'));
  const rawAlias=path.join(alias,path.basename(dir),'image.bin');
  await assert.rejects(createNativeCodingHostImageGuard().prepare([rawAlias]),/image_file_unverified/);
 }finally{await cleanup[0]();}
 await assert.rejects(fs.access(dir),error=>error.code==='ENOENT');
});

test('image fixture cleanup refuses a redirected root rather than removing another same-prefix directory',async t=>{
 const parent=await imageDirectory(t),cleanup=[];
 const dir=await imageDirectory({after:fn=>cleanup.push(fn)},parent),retained=dir+'-retained';
 const unrelated=path.join(parent,'metaengine-host-image-unrelated');await fs.mkdir(unrelated);
 const marker=path.join(unrelated,'keep.txt');await fs.writeFile(marker,'not the owned fixture');
 await fs.rename(dir,retained);
 try{
  await fs.symlink(unrelated,dir,process.platform==='win32'?'junction':'dir');
  await assert.rejects(cleanup[0](),/fixture_cleanup_scope/);
  assert.equal(await fs.readFile(marker,'utf8'),'not the owned fixture');
 }finally{
  await fs.rm(dir,{recursive:true,force:false});await fs.rename(retained,dir);await cleanup[0]();
 }
});

async function scopeFixture(){
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
  const counts={transactionReads:0,baseReads:0,processReads:0,operatorReads:0,bootReads:0,sandboxReads:0,worktreeReads:0};
  const tx={unsafe:async text=>{counts.transactionReads++;assert.match(text,/pg_control_system/);return[{data_directory:config.pg_data_directory,
    version:170006,address:'127.0.0.1',port:55432,system_identifier:p.postgres.system_identifier}];}};
  const sql={unsafe:async()=>{counts.baseReads++;throw Error('EXTRA_BASE_POOL_BORROW');}};
  const fileHashes=new Map([[expectedExe,p.artifact.installed_exe_sha256],[path.join(resources,'app.asar'),p.artifact.installed_asar_sha256],
    [operator.cli_executable,p.artifact.cli_executable_sha256]]);
  const scope={sql,config,resources,expectedExe,parentPid:host.pid,path,URL,Date,Number,Promise,structuredClone,
    process:{env:{SystemRoot:'C:/Windows'}},fs:{readFile:async()=>pidText},
    fail:reason=>{throw Error('native_coding_host_os_'+reason);},
    samePath:(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase(),
    publicProcess:value=>({pid:value.pid,created_at:value.created_at,process_incarnation_id:value.process_incarnation_id}),
    readNativeCodingWindowsProcess:async pid=>{counts.processReads++;return pid===pg.pid?{...pg,exe_path:path.resolve('C:/METAENGINE/fixture-pg-bin/postgres.exe')}:
      {...host,exe_path:expectedExe,user_sid:p.user_sid};},
    readDirectoryIdentity:async directory=>{if(directory===config.pg_data_directory)return p.postgres.data_directory_identity_sha256;
      counts.worktreeReads++;return p.worktree.root_identity_sha256;},
    readNativeCodingOperatorPaths:async()=>{counts.operatorReads++;return operator;},
    readWindowsSandboxHostBoot:async()=>{counts.bootReads++;return {kernel_boot_id:101};},
    resolveNativeCodingSandboxPin:(_operator,permit)=>({path:permit.role}),
    readNativeCodingSandboxEvidence:async options=>{counts.sandboxReads++;
      assert.equal((await options.readBoot()).kernel_boot_id,101);
      assert.equal((await options.readProcess(host.pid)).pid,host.pid);
      await assert.rejects(options.readProcess(host.pid+1),/scope_batch_process_mismatch/);
      return structuredClone(p.sandbox);},
    image:{prepare:async()=>{},read:async file=>fileHashes.get(file)},
    run:async()=>({stdout:p.worktree.base_sha}),
    readNativeCodingGitProof:async()=>({head:p.worktree.base_sha,artifact_sha256:'a'.repeat(64)}),
  };
  const readers=vm.runInNewContext(source.slice(start,end)+'\n({readNativeScope,readNativeScopeBatch,readCheckpointScope})',scope);
  return {readers,counts,p,tx,scope};
}

test('actual checkpoint and native OS scope functions route PG identity through the private active reader',async()=>{
  const {readers,counts,p,tx}=await scopeFixture();
  const result=await readers.readCheckpointScope(p,tx);
  assert.equal(result.postgres.system_identifier,p.postgres.system_identifier);
  assert.equal(result.git.head,p.worktree.base_sha);assert.equal(counts.transactionReads,1);assert.equal(counts.baseReads,0);
  await assert.rejects(readers.readCheckpointScope(p),/EXTRA_BASE_POOL_BORROW/);
  assert.equal(counts.baseReads,1,'existing callers still default to the original private SQL connection');
});

test('observation cohort shares native common reads but verifies every agent and never caches a completed cohort',async()=>{
  const {readers,counts,p,tx}=await scopeFixture();
  const permits=[p,{...p,role:'CRITIC'}];
  const results=await readers.readNativeScopeBatch(permits,true,tx);
  assert.equal(results.length,2);assert.equal(counts.transactionReads,1);assert.equal(counts.processReads,2);
  assert.equal(counts.operatorReads,1);assert.equal(counts.bootReads,1);
  assert.equal(counts.worktreeReads,2);assert.equal(counts.sandboxReads,2);
  results[0].postgres.postmaster.pid=1;
  assert.equal(results[1].postgres.postmaster.pid,p.postgres.postmaster.pid,'returned agents do not share mutable identity objects');
  await readers.readNativeScopeBatch(permits,true,tx);
  assert.equal(counts.transactionReads,2);assert.equal(counts.processReads,4);
  assert.equal(counts.bootReads,2);assert.equal(counts.sandboxReads,4);
});

test('concurrent observation cohorts never borrow another transaction or hide its failure',async()=>{
  const {readers,counts,p,tx}=await scopeFixture();let otherReads=0;
  const other={unsafe:async()=>{otherReads++;throw Error('OTHER_TRANSACTION_FAILED');}};
  const result=await Promise.allSettled([readers.readNativeScopeBatch([p],false,tx),readers.readNativeScopeBatch([p],false,other)]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');
  assert.match(result[1].reason.message,/OTHER_TRANSACTION_FAILED/);assert.equal(otherReads,1);
  assert.equal(counts.transactionReads,1);assert.equal(counts.baseReads,0);assert.equal(counts.bootReads,0);
  await assert.rejects(readers.readNativeScopeBatch([p]),/EXTRA_BASE_POOL_BORROW/);
  assert.equal(counts.baseReads,1);
});

test('any agent image mismatch rejects its entire cohort; future reads still physically verify',async()=>{
  const {readers,counts,p,tx}=await scopeFixture();
  await assert.rejects(readers.readNativeScopeBatch([p,{...p,artifact:{...p.artifact,installed_exe_sha256:'0'.repeat(64)}}],false,tx),/installed_artifact_mismatch/);
  const result=await readers.readNativeScopeBatch([p],false,tx);
  assert.equal(result.length,1);assert.equal(counts.transactionReads,2);assert.equal(counts.processReads,4);
});

test('batch preserves distinct worktree, provider pin and role and rejects one failed sandbox',async()=>{
  const {readers,p,tx,scope}=await scopeFixture();
  const other={...p,provider_id:'other-provider',role:'CRITIC',worktree:{...p.worktree,path:path.resolve('C:/METAENGINE/other-worktree')}};
  const seen=[];
  scope.resolveNativeCodingSandboxPin=(_operator,permit)=>({path:permit.provider_id,sha256:permit.role});
  scope.readNativeCodingSandboxEvidence=async options=>{
    seen.push([options.pin.path,options.pin.sha256,options.worktreePath,options.role]);
    if(options.role==='CRITIC')throw Error('SECOND_SANDBOX_REVOKED');
    return structuredClone(p.sandbox);
  };
  await assert.rejects(readers.readNativeScopeBatch([p,other],true,tx),/SECOND_SANDBOX_REVOKED/);
  assert.deepEqual(seen.sort((a,b)=>a[0].localeCompare(b[0])),[
    [p.provider_id,p.role,p.worktree.path,p.role],
    [other.provider_id,other.role,other.worktree.path,other.role],
  ].sort((a,b)=>a[0].localeCompare(b[0])));
});

test('ordinary sandbox read retains default physical observers without caller-supplied common evidence',async()=>{
  const {readers,p,tx,scope,counts}=await scopeFixture();let observed=false;
  scope.readNativeCodingSandboxEvidence=async options=>{
    assert.equal(Object.hasOwn(options,'readBoot'),false);assert.equal(Object.hasOwn(options,'readProcess'),false);
    assert.equal(options.worktreePath,p.worktree.path);assert.equal(options.role,p.role);observed=true;
    return structuredClone(p.sandbox);
  };
  const result=await readers.readNativeScope(p,true,tx);
  assert.equal(observed,true);assert.deepEqual(result.sandbox,p.sandbox);assert.equal(counts.transactionReads,1);
  assert.equal(counts.bootReads,0);
});
