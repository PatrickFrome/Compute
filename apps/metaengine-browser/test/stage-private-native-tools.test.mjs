import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readPrivateNativeToolsLock,stagePrivateNativeTools,acquirePrivateNativeToolArchives,assertPrivateNativeToolsManifestPins} from '../scripts/stage-private-native-tools.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const scratch=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'private-tools-producer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};

test('official full distributions and notices are pinned; standalone Codex EXE is insufficient',async()=>{
  const lock=await readPrivateNativeToolsLock();
  const git=lock.components.find(row=>row.id==='git'),codex=lock.components.find(row=>row.id==='codex');
  assert.equal(git.archive_name,'MinGit-2.56.0.4-64-bit.zip');
  assert.equal(git.entrypoint,'ucrt64/bin/git.exe');
  assert.equal(codex.archive_name,'codex-package-x86_64-pc-windows-msvc.tar.gz');
  assert.equal(codex.entrypoint,'bin/codex.exe');
  assert(codex.required_files.includes('codex-resources/codex-windows-sandbox-setup.exe'));
  for(const row of lock.components){assert(Object.isFrozen(row));assert(row.required_files.some(file=>/LICENSE|NOTICE/.test(file))||row.notices.length>0);}
  const build=fileURLToPath(new URL('../build/',import.meta.url));
  for(const row of lock.components)for(const notice of row.notices)
    assert.equal(hash(await fs.readFile(path.join(build,notice.source))),notice.sha256);
});

test('missing archives cannot create a partial staging directory',async t=>{
  const directory=await scratch(t),output=path.join(directory,'output');
  await assert.rejects(stagePrivateNativeTools({archiveDirectory:directory,outputDirectory:output}),{code:'ENOENT'});
  await assert.rejects(fs.lstat(output),{code:'ENOENT'});
});

test('wrong-size cached payload fails acquisition without download or overwrite',async t=>{
  const directory=await scratch(t),lock=await readPrivateNativeToolsLock(),payload=path.join(directory,lock.components[0].archive_name);
  const wrong=Buffer.from('untrusted existing Git payload');await fs.writeFile(payload,wrong);
  await assert.rejects(acquirePrivateNativeToolArchives({archiveDirectory:directory}),/archive_file_invalid/);
  assert.deepEqual(await fs.readFile(payload),wrong);
  assert.deepEqual(await fs.readdir(directory),[lock.components[0].archive_name]);
});

test('same-size corrupted cache is rejected before any network acquisition',async t=>{
  const directory=await scratch(t),lock=await readPrivateNativeToolsLock(),row=lock.components[0],payload=path.join(directory,row.archive_name);
  const handle=await fs.open(payload,'wx');try{await handle.truncate(row.archive_bytes);}finally{await handle.close();}
  await assert.rejects(acquirePrivateNativeToolArchives({archiveDirectory:directory}),/archive_digest_mismatch/);
  assert.equal((await fs.stat(payload)).size,row.archive_bytes);
  assert.deepEqual(await fs.readdir(directory),[row.archive_name]);
});

test('corrupt archive staging cleans its owned output and preserves neighbours',async t=>{
  const directory=await scratch(t),lock=await readPrivateNativeToolsLock(),output=path.join(directory,'output');
  for(const row of lock.components){const handle=await fs.open(path.join(directory,row.archive_name),'wx');try{await handle.truncate(row.archive_bytes);}finally{await handle.close();}}
  await fs.writeFile(path.join(directory,'preserved.txt'),'independent build evidence');
  await assert.rejects(stagePrivateNativeTools({archiveDirectory:directory,outputDirectory:output}),/private_tool_zip_.*(?:digest|sha)/);
  await assert.rejects(fs.lstat(output),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(directory,'preserved.txt'),'utf8'),'independent build evidence');
});

test('archive directory symlinks and relative destinations fail closed',async t=>{
  const directory=await scratch(t),target=path.join(directory,'target'),alias=path.join(directory,'alias');await fs.mkdir(target);
  try{await fs.symlink(target,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('symlink permission unavailable');return;}throw error;}
  await assert.rejects(stagePrivateNativeTools({archiveDirectory:alias,outputDirectory:path.join(directory,'output')}),/directory_alias/);
  await assert.rejects(stagePrivateNativeTools({archiveDirectory:target,outputDirectory:'relative-output'}),/output_path_invalid/);
});

// Build/CI supplies byte-pinned official inputs explicitly. This is packaging
// evidence only: it does not execute Windows binaries or prove installation.
test('complete official archives stage offline with every member and notice retained',
  {skip:!process.env.METAENGINE_PRIVATE_TOOL_TEST_ARCHIVES},async t=>{
    const directory=await scratch(t),archiveDirectory=path.resolve(process.env.METAENGINE_PRIVATE_TOOL_TEST_ARCHIVES),outputDirectory=path.join(directory,'bundle');
    // A complete pinned cache performs no writes and needs no network fetch.
    const lock=await readPrivateNativeToolsLock(),cacheBefore=await Promise.all(lock.components.map(row=>fs.stat(path.join(archiveDirectory,row.archive_name),{bigint:true})));
    await acquirePrivateNativeToolArchives({archiveDirectory});
    const cacheAfter=await Promise.all(lock.components.map(row=>fs.stat(path.join(archiveDirectory,row.archive_name),{bigint:true})));
    assert.deepEqual(cacheAfter.map(info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs]),cacheBefore.map(info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs]));
    const result=await stagePrivateNativeTools({archiveDirectory,outputDirectory});
    assert.equal(result.manifest.schema,'metaengine.private-native-tools.v1');
    await assertPrivateNativeToolsManifestPins(result.manifest);
    assert.equal(result.manifestSha256,hash(await fs.readFile(result.manifestPath)));
    assert.deepEqual(result.manifest.components.map(row=>[row.id,row.files.length]),[['git',375],['codex',50]]);
    const truncated=structuredClone(result.manifest);truncated.components[0].files.pop();
    await assert.rejects(assertPrivateNativeToolsManifestPins(truncated),/manifest_pin_mismatch/);
    const changed=structuredClone(result.manifest);changed.components[1].files[0].sha256='0'.repeat(64);
    await assert.rejects(assertPrivateNativeToolsManifestPins(changed),/manifest_pin_mismatch/);
    for(const row of result.manifest.components){
      assert(row.files.some(file=>file.path===row.entrypoint));
      for(const file of row.files){const bytes=await fs.readFile(path.join(outputDirectory,row.id,file.path));assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);}
    }
    // No preexisting staging directory, even a valid bundle, is overwritten.
    await assert.rejects(stagePrivateNativeTools({archiveDirectory,outputDirectory}),{code:'EEXIST'});
    assert.equal(hash(await fs.readFile(result.manifestPath)),result.manifestSha256);
  });
