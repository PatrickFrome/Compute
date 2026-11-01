import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPackagedNativeTools, loadInstalledNativeTools, installedGitEnvironment} from '../src/packaged-native-tools.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'packaged-tools-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'native-tools');
  const files=[];
  for(const [name,bytes] of [['codex/bin/codex.exe','codex'],['codex/bin/codex-code-mode-host.exe','code host'],['codex/bin/codex-exec-server.exe','executor'],
    ['codex/codex-path/rg.exe','rg'],['codex/codex-resources/codex-command-runner.exe','runner'],['codex/codex-resources/codex-windows-sandbox-setup.exe','setup'],
    ['codex/codex-package.json','{}'],['git/cmd/git.exe','git'],['git/mingw64/bin/git.exe','native git'],['git/mingw64/libexec/git-core/git-remote-https.exe','https'],['git/mingw64/bin/runtime.dll','dll']]) {
    const file=path.join(directory,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
    files.push({path:name,component:name.split('/')[0],size:Buffer.byteLength(bytes),sha256:hash(bytes)});
  }
  const manifest={schema:'metaengine.native-tools.manifest.v1',platform:'win32',arch:'x64',
    sources:{codex:{version:'0.166.0'},git:{version:'2.56.0.windows.4'}},
    executables:{codex:'codex/bin/codex.exe',git:'git/cmd/git.exe'},files,authority_effect:false};
  const bytes=JSON.stringify(manifest)+'\n';await fs.writeFile(path.join(directory,'native-tools-manifest.json'),bytes);
  const binding={schema:'metaengine.native-tools.package-binding.v1',source_head:'a'.repeat(40),package_version:'0.7.0-dev.123.1',
    manifest_sha256:hash(bytes),file_count:files.length,authority_effect:false};
  const pkg={version:binding.package_version,metaengineEmergencyTrustRoot:{build_sha:binding.source_head},metaengineNativeTools:binding};
  const packageFile=path.join(root,'package.json');await fs.writeFile(packageFile,JSON.stringify(pkg));
  return {root,directory,binding,manifest,packageFile};
}

test('resolves only packaged absolute executables, independent of preinstalled tools',async t=>{
  const f=await fixture(t);
  const tools=await loadInstalledNativeTools({resourcesPath:f.root,packageFile:f.packageFile});
  assert.equal(tools.paths.codexExecutable,path.join(f.directory,'codex/bin/codex.exe'));
  assert.equal(tools.paths.gitExecutable,path.join(f.directory,'git/cmd/git.exe'));
  assert.equal(tools.external_login_required,true);
  assert.equal(tools.execution_ready,false);
  assert.equal(tools.authority_effect,false);
});
test('missing bundle never falls back to PATH or another installed Git',async t=>{
  const f=await fixture(t);await fs.rm(f.directory,{recursive:true});
  await assert.rejects(loadInstalledNativeTools({resourcesPath:f.root,packageFile:f.packageFile}),/native_tools_/);
});
for(const name of ['codex/bin/codex.exe','git/mingw64/bin/runtime.dll'])test('rejects changed '+name,async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.directory,name),'substitution');
  await assert.rejects(verifyPackagedNativeTools({directory:f.directory,binding:f.binding}),/native_tools_file_bytes_mismatch/);
});
test('rejects unlisted helper DLL and mutable external manifest',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.directory,'git/cmd/extra.dll'),'injected');
  await assert.rejects(verifyPackagedNativeTools({directory:f.directory,binding:f.binding}),/native_tools_inventory_mismatch/);
  await fs.rm(path.join(f.directory,'git/cmd/extra.dll'));
  await fs.appendFile(path.join(f.directory,'native-tools-manifest.json'),' ');
  await assert.rejects(verifyPackagedNativeTools({directory:f.directory,binding:f.binding}),/native_tools_manifest_digest_mismatch/);
});
test('rejects linked root, files and ancestor directories',async t=>{
  const f=await fixture(t);const alias=path.join(f.root,'alias');await fs.symlink(f.directory,alias,'dir');
  await assert.rejects(verifyPackagedNativeTools({directory:alias,binding:f.binding}),/native_tools_path_alias_denied/);
  await fs.rename(path.join(f.directory,'git'),path.join(f.root,'outside-git'));
  await fs.symlink(path.join(f.root,'outside-git'),path.join(f.directory,'git'),'dir');
  await assert.rejects(verifyPackagedNativeTools({directory:f.directory,binding:f.binding}),/native_tools_path_alias_denied/);
});
test('package source/version binding rejects stale payload generation',async t=>{
  const f=await fixture(t);const pkg=JSON.parse(await fs.readFile(f.packageFile));pkg.version='0.7.0-dev.124.1';
  await fs.writeFile(f.packageFile,JSON.stringify(pkg));
  await assert.rejects(loadInstalledNativeTools({resourcesPath:f.root,packageFile:f.packageFile}),/native_tools_package_identity_mismatch/);
});
test('installed verification rejects a manifest that omits native helpers',async t=>{
  const f=await fixture(t);f.manifest.files=f.manifest.files.filter(row=>row.path!=='codex/codex-resources/codex-command-runner.exe');
  const bytes=JSON.stringify(f.manifest)+'\n';await fs.writeFile(path.join(f.directory,'native-tools-manifest.json'),bytes);
  await assert.rejects(verifyPackagedNativeTools({directory:f.directory,binding:{...f.binding,manifest_sha256:hash(bytes),file_count:f.manifest.files.length}}),/required_helper_missing/);
});
test('packaged Git child PATH contains only own helpers and OS; inherited tool/runtime settings are dropped',()=>{
  const platform=Object.getOwnPropertyDescriptor(process,'platform'),electron=Object.getOwnPropertyDescriptor(process.versions,'electron');
  Object.defineProperty(process,'platform',{...platform,value:'win32'});
  Object.defineProperty(process.versions,'electron',{configurable:true,value:'fixture-only'});
  try {
    const env=installedGitEnvironment('C:\\METAENGINE\\resources\\native-tools\\git\\cmd\\git.exe',
      {PATH:'D:\\preinstalled',Path:'D:\\hijack',NODE_OPTIONS:'--require injected',GIT_EXEC_PATH:'D:\\other-git',USERPROFILE:'C:\\Users\\test'});
    assert.equal(env.PATH,'C:\\METAENGINE\\resources\\native-tools\\git\\cmd;C:\\METAENGINE\\resources\\native-tools\\git\\mingw64\\bin;C:\\METAENGINE\\resources\\native-tools\\git\\usr\\bin;C:\\Windows\\System32');
    assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.GIT_EXEC_PATH,undefined);assert.equal(env.Path,undefined);
  }finally{
    Object.defineProperty(process,'platform',platform);
    if(electron)Object.defineProperty(process.versions,'electron',electron);else delete process.versions.electron;
  }
});
