import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolvePrivateNativeTools,privateNativeToolsBinding,validatePrivateNativeToolsManifest,PRIVATE_NATIVE_TOOL_REQUIRED_FILES} from '../src/private-native-tools.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-private-tools-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const components=[];
  for(const [id,entrypoint]of [['git','ucrt64/bin/git.exe'],['codex','bin/codex.exe']]){
    const rows=[];
    for(const name of [...PRIVATE_NATIVE_TOOL_REQUIRED_FILES[id],...(id==='git'?['ucrt64/libexec/git-core/git-helper']:[])].sort()){
      const file=path.join(root,id,name),bytes=Buffer.from('fixture '+name);
      await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
      rows.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
    }
    components.push({id,version:id==='git'?'2.56.0.4':'0.166.0',repository:id==='git'?'git-for-windows/git':'openai/codex',tag:'pinned',release_id:1,asset_id:2,
      archive_name:id+'.zip',archive_sha256:'a'.repeat(64),archive_bytes:1,entrypoint,files:rows});
  }
  const bytes=Buffer.from(JSON.stringify({schema:'metaengine.private-native-tools.v1',platform:'win32',arch:'x64',components}));
  await fs.writeFile(path.join(root,'manifest.json'),bytes);
  return {root,binding:privateNativeToolsBinding(bytes)};
}
test('private resolver selects complete package paths and child env regardless of ambient PATH',async t=>{
  const f=await fixture(t),tools=await resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding});
  assert.equal(tools.gitExecutable,path.join(f.root,'git/ucrt64/bin/git.exe'));
  assert.equal(tools.cliExecutable,path.join(f.root,'codex/bin/codex.exe'));
  assert.ok(Object.isFrozen(tools));assert.ok(Object.isFrozen(tools.environment));
  assert.ok(tools.environment.PATH.startsWith(path.join(f.root,'codex/bin')));
  assert.ok(!tools.environment.PATH.split(';').some(p=>p===process.env.PATH));
  assert.equal(tools.environment.GIT_CONFIG_GLOBAL,'NUL');
  await tools.revalidate();
});
for(const target of ['git/ucrt64/bin/libcurl-4.dll','git/ucrt64/etc/ssl/certs/ca-bundle.crt','git/ucrt64/libexec/git-core/git-helper','codex/codex-resources/codex-command-runner.exe']){
  test('missing/tampered dependency refuses before selection '+target,async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.root,target),'tampered');
    await assert.rejects(resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding}),/private_native_tools_/);
  });
  test('dependency change permanently invalidates capability '+target,async t=>{
    const f=await fixture(t),tools=await resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding});
    const old=await fs.readFile(path.join(f.root,target));await fs.writeFile(path.join(f.root,target),'changed');
    await assert.rejects(tools.revalidate(),/private_native_tools_inventory_changed/);
    await fs.writeFile(path.join(f.root,target),old);
    await assert.rejects(tools.revalidate(),/private_native_tools_invalidated/);
  });
}
test('adjacent manifest replacement cannot mint authority',async t=>{
  const f=await fixture(t),file=path.join(f.root,'manifest.json');
  const doc=JSON.parse(await fs.readFile(file));doc.components[0].files[0].sha256='b'.repeat(64);await fs.writeFile(file,JSON.stringify(doc));
  await assert.rejects(resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding}),/manifest_binding_mismatch/);
});
for(const mutation of ['extra','missing','link','hardlink'])test('full inventory rejects '+mutation,async t=>{
  const f=await fixture(t),file=path.join(f.root,'git/ucrt64/bin/git.exe');
  if(mutation==='extra')await fs.writeFile(path.join(f.root,'codex/extra.dll'),'extra');
  if(mutation==='missing')await fs.unlink(file);
  if(mutation==='link'){await fs.rename(file,file+'.real');await fs.symlink(file+'.real',file);}
  if(mutation==='hardlink')await fs.link(file,file+'.alias');
  await assert.rejects(resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding}),/private_native_tools_/);
});
test('extra DLL after selection invalidates complete directory snapshot',async t=>{
  const f=await fixture(t),tools=await resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding});
  await fs.writeFile(path.join(f.root,'git/ucrt64/bin/extra.dll'),'extra');
  await assert.rejects(tools.revalidate(),/inventory_changed/);
});
test('builder includes required private tools and existing protected metadata binding',async()=>{
  const config=JSON.parse(await fs.readFile(new URL('../electron-builder.test.json',import.meta.url)));
  assert.ok(config.extraResources.some(row=>row.from==='native-dist/private-native-tools'&&row.to==='private-native-tools'));
  const hook=await fs.readFile(new URL('../scripts/electron-builder-before-pack.cjs',import.meta.url),'utf8');
  assert.match(hook,/metaenginePrivateNativeTools/);
});

for(const name of ['CON .txt','COM¹.txt','\ufeffgit.exe','CLOCK$.a','a~1.exe'])test('manifest refuses Windows alias '+JSON.stringify(name),async t=>{
  const f=await fixture(t),doc=JSON.parse(await fs.readFile(path.join(f.root,'manifest.json')));
  doc.components[0].files.push({path:name,bytes:1,sha256:'a'.repeat(64)});doc.components[0].files.sort((a,b)=>a.path<b.path?-1:1);
  assert.throws(()=>validatePrivateNativeToolsManifest(doc),/private_native_tools_/);
});
test('manifest refuses Windows-folding prefix aliases',async t=>{
  const f=await fixture(t),doc=JSON.parse(await fs.readFile(path.join(f.root,'manifest.json')));
  doc.components[0].files.push(...['S/a','ſ/b'].map(name=>({path:name,bytes:1,sha256:'a'.repeat(64)})));
  doc.components[0].files.sort((a,b)=>a.path<b.path?-1:1);assert.throws(()=>validatePrivateNativeToolsManifest(doc),/file_path_alias/);
});
test('two EXEs cannot represent a complete dependency manifest',async t=>{
  const f=await fixture(t),doc=JSON.parse(await fs.readFile(path.join(f.root,'manifest.json')));
  for(const component of doc.components)component.files=component.files.filter(row=>row.path===component.entrypoint);
  assert.throws(()=>validatePrivateNativeToolsManifest(doc),/required_dependency_missing/);
});
test('manifest replacement during inventory walk cannot enter the snapshot as new authority',async t=>{
  const f=await fixture(t),manifestPath=path.join(f.root,'manifest.json');
  const original=fs.lstat.bind(fs),bytes=await fs.readFile(manifestPath);let reads=0;
  t.mock.method(fs,'lstat',async(file,...options)=>{
    if(file===manifestPath&&++reads===3)await fs.writeFile(manifestPath,Buffer.from(bytes.toString().replace('pinned','changed')));
    return original(file,...options);
  });
  await assert.rejects(resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding}),/manifest_changed/);
});

test('in-flight package revalidation cannot succeed after a sibling permanently invalidates it',async t=>{
  const f=await fixture(t),tools=await resolvePrivateNativeTools({toolsRoot:f.root,binding:f.binding});
  const manifest=path.join(f.root,'manifest.json'),helper=path.join(f.root,'git/ucrt64/libexec/git-core/git-helper');
  const original=fs.lstat.bind(fs);let hold=true,entered,release;
  const seen=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.mock.method(fs,'lstat',async(file,...options)=>{
    const stat=await original(file,...options);
    if(file===manifest&&hold){hold=false;entered();await gate;}
    return stat;
  });
  const first=tools.revalidate();void first.catch(()=>{});
  await seen;
  try{
    await fs.writeFile(helper,'changed by generated concurrent negative fixture');
    await assert.rejects(tools.revalidate(),/inventory_changed/);
  }finally{release();}
  await assert.rejects(first,/invalidated/);
  await assert.rejects(tools.revalidate(),/invalidated/);
});
