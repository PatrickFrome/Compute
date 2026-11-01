import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyPackagedNativeTools} from '../src/packaged-native-tools.mjs';
const {prepareNativeToolsPackage}=createRequire(import.meta.url)('../scripts/native-tools-package-binding.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceLock=JSON.parse(await fs.readFile(new URL('../build/native-tools-lock.json',import.meta.url),'utf8'));
const names=['codex/bin/codex.exe','codex/bin/codex-code-mode-host.exe','codex/bin/codex-exec-server.exe',
  'codex/codex-path/rg.exe','codex/codex-resources/codex-command-runner.exe','codex/codex-resources/codex-windows-sandbox-setup.exe',
  'codex/codex-package.json',
  'git/cmd/git.exe','git/mingw64/bin/git.exe','git/mingw64/libexec/git-core/git-remote-https.exe'];
async function writeGeneratedStage(directory,label,lock=sourceLock) {
  const files=[];await fs.mkdir(directory,{recursive:true});
  for(const name of names){const bytes=Buffer.from('MZ synthetic '+label+' '+name),file=path.join(directory,name);
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});
    files.push({path:name,component:name.split('/')[0],size:bytes.length,sha256:hash(bytes)});}
  const manifest={schema:'metaengine.native-tools.manifest.v1',platform:'win32',arch:'x64',
    sources:{codex:lock.codex,git:lock.git},executables:{codex:'codex/bin/codex.exe',git:'git/cmd/git.exe'},files,authority_effect:false};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),manifestPath=path.join(directory,'native-tools-manifest.json');
  await fs.writeFile(manifestPath,manifestBytes,{flag:'wx'});
  return {manifest,manifestPath,manifestSha256:hash(manifestBytes),outputDirectory:directory};
}
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-tools-package-binding-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'build'));await fs.writeFile(path.join(root,'build/native-tools-lock.json'),JSON.stringify(sourceLock));
  const output=path.join(root,'native-dist/native-tools'),options={appRoot:root,sourceHead:'a'.repeat(40),packageVersion:'0.7.0-dev.123.1'};
  let calls=0;
  const stage=async({lock,outputDirectory})=>{calls++;assert.deepEqual(lock,sourceLock);return writeGeneratedStage(outputDirectory,'archive-derived',lock);};
  return {root,output,options,stage,get calls(){return calls;}};
}

test('forged self-described existing stage cannot appoint its own package binding',async t=>{
  const f=await fixture(t),forged=await writeGeneratedStage(f.output,'forged bytes with genuine source metadata');
  await assert.rejects(prepareNativeToolsPackage(f.options,{stage:f.stage}),/native_tools_manifest_digest_mismatch/);
  assert.equal(f.calls,1);
  assert.equal(hash(await fs.readFile(path.join(f.output,'native-tools-manifest.json'))),forged.manifestSha256);
  assert.equal((await fs.readdir(path.join(f.root,'native-dist'))).some(x=>x.startsWith('.native-tools-proof-')),false);
});
test('fresh build publishes only newly archive-derived manifest and removes its proof directory',async t=>{
  const f=await fixture(t),binding=await prepareNativeToolsPackage(f.options,{stage:f.stage});
  assert.equal(f.calls,1);assert.equal(binding.schema,'metaengine.native-tools.package-binding.v1');
  assert.equal(binding.source_head,f.options.sourceHead);assert.equal(binding.package_version,f.options.packageVersion);
  assert.equal(binding.manifest_sha256,hash(await fs.readFile(path.join(f.output,'native-tools-manifest.json'))));
  const installed=await verifyPackagedNativeTools({directory:f.output,binding});
  assert.equal(installed.paths.gitExecutable,path.join(f.output,'git/cmd/git.exe'));
  assert.equal(installed.execution_ready,false);
  assert.deepEqual(await fs.readdir(path.join(f.root,'native-dist')),['native-tools']);
});
test('unchanged existing stage is revalidated against new archive proof on each build',async t=>{
  const f=await fixture(t);const first=await prepareNativeToolsPackage(f.options,{stage:f.stage});
  const before=await fs.stat(path.join(f.output,'codex/bin/codex.exe'));
  const second=await prepareNativeToolsPackage(f.options,{stage:f.stage});
  assert.equal(f.calls,2);assert.deepEqual(first,second);
  assert.equal((await fs.stat(path.join(f.output,'codex/bin/codex.exe'))).ino,before.ino);
  assert.deepEqual(await fs.readdir(path.join(f.root,'native-dist')),['native-tools']);
});
test('failed download/proof preserves existing stage and clears only its disposable proof',async t=>{
  const f=await fixture(t),existing=await writeGeneratedStage(f.output,'prior existing');
  await assert.rejects(prepareNativeToolsPackage(f.options,{stage:async({outputDirectory})=>{
    await fs.mkdir(outputDirectory);await fs.writeFile(path.join(outputDirectory,'partial'),'incomplete');throw Error('fixture_download_failure');
  }}),/fixture_download_failure/);
  assert.equal(hash(await fs.readFile(path.join(f.output,'native-tools-manifest.json'))),existing.manifestSha256);
  assert.deepEqual(await fs.readdir(path.join(f.root,'native-dist')),['native-tools']);
});
test('incomplete existing output and symbolic links are preserved and refused',async t=>{
  const f=await fixture(t);await fs.mkdir(f.output,{recursive:true});await fs.writeFile(path.join(f.output,'preserve'),'partial');
  await assert.rejects(prepareNativeToolsPackage(f.options,{stage:f.stage}),/ENOENT/);
  assert.equal(await fs.readFile(path.join(f.output,'preserve'),'utf8'),'partial');
  await fs.rename(f.output,path.join(f.root,'outside'));await fs.symlink(path.join(f.root,'outside'),f.output,'dir');
  await assert.rejects(prepareNativeToolsPackage(f.options,{stage:f.stage}),/native_tools_staged_directory_invalid/);
  assert.equal((await fs.lstat(f.output)).isSymbolicLink(),true);
  assert.deepEqual(await fs.readdir(path.join(f.root,'native-dist')),['native-tools']);
});
test('invalid build identity stops before staging and official source drift cannot mint a binding',async t=>{
  const f=await fixture(t);
  for(const invalid of [{sourceHead:'short'},{packageVersion:'0.7.0'},{sourceHead:'A'.repeat(40)}])
    await assert.rejects(prepareNativeToolsPackage({...f.options,...invalid},{stage:f.stage}),/native_tools_build_identity_invalid/);
  assert.equal(f.calls,0);
  await assert.rejects(prepareNativeToolsPackage(f.options,{stage:async({lock,outputDirectory})=>{
    const drift=structuredClone(lock);drift.codex.archive_sha256='b'.repeat(64);
    return writeGeneratedStage(outputDirectory,'different official archive identity',drift);
  }}),/native_tools_source_lock_mismatch/);
  assert.deepEqual(await fs.readdir(path.join(f.root,'native-dist')),[]);
});
