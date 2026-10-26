import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {assertForwardScope,assertForwardPreservedPaths,writeForwardPreservedGate,retireForwardImage} from '../scripts/qa-forward-install-policy.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'forward-install-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const installedRoot=path.join(root,'Programs','METAENGINE Browser Test');
  const stateDirectory=path.join(root,'METAENGINE','client-state-qa-upgrade-'+randomUUID());
  const retiredRoot=path.join(stateDirectory,'retired-installation');
  await fs.mkdir(installedRoot,{recursive:true});await fs.mkdir(stateDirectory,{recursive:true});
  await fs.writeFile(path.join(installedRoot,'app.bin'),'old installation');
  const preserved=path.join(root,'preserved'),predecessorStateDirectory=path.join(preserved,'state');
  const preservedPaths={keeperExecutable:path.join(preserved,'bin','postgres.exe'),
    pgDataDirectory:path.join(preserved,'pgdata'),ownerFile:path.join(preserved,'owner.json'),
    candidateRoot:path.join(root,'candidate'),installerFile:path.join(root,'installer.exe'),
    configFile:path.join(predecessorStateDirectory,'config.json'),
    statusFile:path.join(predecessorStateDirectory,'runtime-instance.json'),predecessorStateDirectory};
  for(const dir of [path.dirname(preservedPaths.keeperExecutable),preservedPaths.pgDataDirectory,predecessorStateDirectory,preservedPaths.candidateRoot])await fs.mkdir(dir,{recursive:true});
  for(const name of ['keeperExecutable','ownerFile','configFile','statusFile','installerFile'])await fs.writeFile(preservedPaths[name],'fixture '+name);
  const expectedTreeSha256=(await captureInstalledTreeFingerprint(installedRoot)).tree_sha256;
  return {installedRoot,stateDirectory,retiredRoot,expectedTreeSha256,preservedPaths,env:{LOCALAPPDATA:root}};
}
const scope=f=>({...f,...f.preservedPaths});
const junction=(target,link)=>fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
async function blockedBeforeEffects(f,pattern,options={}){
  const gate=f.preservedPaths.ownerFile+'.qa-upgrade-gate.json';
  await assert.rejects(writeForwardPreservedGate(gate,{state:'GATED'},scope(f),{env:f.env,...options}),pattern);
  let effects=0;
  await assert.rejects(retireForwardImage(f,{env:f.env,...options,verify:async()=>{effects++;},
    fingerprint:async()=>{effects++;throw Error('fingerprint should not run');},
    move:async()=>{effects++;throw Error('move should not run');}}),pattern);
  assert.equal(effects,0);
  await assert.rejects(fs.lstat(gate),{code:'ENOENT'});
  await assert.rejects(fs.lstat(path.join(f.stateDirectory,'image-retirement-attempt.json')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(f.installedRoot,'app.bin'),'utf8'),'old installation');
}
test('forward retirement preserves exact image without copying or executing it',async t=>{
  const f=await fixture(t),r=await retireForwardImage(f,{env:f.env});
  assert.equal(r.state,'RETIRED_VERIFIED');assert.equal(r.image_copy_created,false);
  assert.equal(await fs.readFile(path.join(f.retiredRoot,'app.bin'),'utf8'),'old installation');
  await assert.rejects(fs.stat(f.installedRoot),{code:'ENOENT'});
  await assert.rejects(retireForwardImage(f,{env:f.env}),/retired_target_exists/);
});
test('foreign image is not retired when the preimage changed',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.installedRoot,'app.bin'),'foreign');
  await assert.rejects(retireForwardImage(f,{env:f.env}),/image_preimage_changed/);
  assert.equal(await fs.readFile(path.join(f.installedRoot,'app.bin'),'utf8'),'foreign');
});
test('lost rename acknowledgement preserves both the effect and pending fence',async t=>{
  const f=await fixture(t);
  await assert.rejects(retireForwardImage(f,{env:f.env,move:async(a,b)=>{await fs.rename(a,b);throw Error('lost acknowledgement');}}),/effect_unknown_requires_readback/);
  assert.equal(await fs.readFile(path.join(f.retiredRoot,'app.bin'),'utf8'),'old installation');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDirectory,'image-retirement-attempt.json'),'utf8')).state,'EFFECT_PENDING');
  await assert.rejects(retireForwardImage(f,{env:f.env}),/retired_target_exists/);
});
test('quiescence loss prevents retirement',async t=>{
  const f=await fixture(t);let checks=0;
  await assert.rejects(retireForwardImage(f,{env:f.env,verify:async()=>{if(++checks===2)throw Error('process appeared');}}),/process appeared/);
  assert.equal(await fs.readFile(path.join(f.installedRoot,'app.bin'),'utf8'),'old installation');
});
test('targets outside the fixed installation and private state are refused',async t=>{
  const f=await fixture(t);
  assert.throws(()=>assertForwardScope({...f,installedRoot:path.dirname(f.installedRoot)},f.env),/scope_invalid/);
  assert.throws(()=>assertForwardScope({...f,retiredRoot:f.installedRoot},f.env),/scope_invalid/);
});
for(const field of ['keeperExecutable','pgDataDirectory','ownerFile','configFile','statusFile','predecessorStateDirectory','candidateRoot','installerFile']){
  for(const destination of ['installedRoot','stateDirectory','retiredRoot']){
    test(field+' inside '+destination+' blocks both gate and image effects',async t=>{
      const f=await fixture(t),file=path.join(f[destination],'unsafe-preserved',field);
      if(['pgDataDirectory','predecessorStateDirectory','candidateRoot'].includes(field))await fs.mkdir(file,{recursive:true});
      else {await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'preserved fixture');}
      f.preservedPaths[field]=file;
      await blockedBeforeEffects(f,/preserved_path_overlap/);
    });
  }
}
for(const field of ['pgDataDirectory','predecessorStateDirectory','candidateRoot']){
  test(field+' containing effect destinations is refused',async t=>{
    const f=await fixture(t);f.preservedPaths[field]=f.env.LOCALAPPDATA;
    await blockedBeforeEffects(f,/preserved_path_overlap/);
  });
}
test('path-prefix lookalikes remain external and the gate can be published',async t=>{
  const f=await fixture(t);
  f.preservedPaths.pgDataDirectory=f.installedRoot+'-database';
  await fs.mkdir(f.preservedPaths.pgDataDirectory);
  f.preservedPaths.keeperExecutable=path.join(f.stateDirectory+'-keeper','postgres.exe');
  await fs.mkdir(path.dirname(f.preservedPaths.keeperExecutable));await fs.writeFile(f.preservedPaths.keeperExecutable,'fixture');
  assert.equal(await assertForwardPreservedPaths(scope(f),{env:f.env}),true);
  const gate=f.preservedPaths.ownerFile+'.qa-upgrade-gate.json';
  await writeForwardPreservedGate(gate,{state:'GATED'},scope(f),{env:f.env});
  assert.equal(JSON.parse(await fs.readFile(gate,'utf8')).state,'GATED');
});
test('a not-yet-created migration directory is checked through its existing ancestors',async t=>{
  const f=await fixture(t);await fs.rmdir(f.stateDirectory);
  assert.equal(await assertForwardPreservedPaths(scope(f),{env:f.env}),true);
  assert.equal(await fs.stat(f.preservedPaths.pgDataDirectory).then(s=>s.isDirectory()),true);
});
test('a PGDATA ancestor junction into the image is refused before effects',async t=>{
  const f=await fixture(t),alias=path.join(f.env.LOCALAPPDATA,'outside-alias');
  await fs.mkdir(path.join(f.installedRoot,'database'));await junction(f.installedRoot,alias);
  f.preservedPaths.pgDataDirectory=path.join(alias,'database');
  await blockedBeforeEffects(f,/preserved_path_reparse_forbidden/);
});
test('a migration-destination junction is refused before effects',async t=>{
  const f=await fixture(t);await fs.rmdir(f.stateDirectory);await junction(path.dirname(f.preservedPaths.ownerFile),f.stateDirectory);
  await blockedBeforeEffects(f,/preserved_path_reparse_forbidden/);
});
test('a hardlinked keeper executable is refused before effects',async t=>{
  const f=await fixture(t);await fs.unlink(f.preservedPaths.keeperExecutable);
  await fs.link(path.join(f.installedRoot,'app.bin'),f.preservedPaths.keeperExecutable);
  await blockedBeforeEffects(f,/preserved_path_hardlink_forbidden/);
});
test('a missing preserved path is not treated like an absent destination',async t=>{
  const f=await fixture(t);await fs.rmdir(f.preservedPaths.pgDataDirectory);
  await blockedBeforeEffects(f,/preserved_path_unverified/);
});
test('uncertain destination lookup fails closed before effects',async t=>{
  const f=await fixture(t),filesystem={...fs,lstat:async(file,opts)=>{
    if(file===f.stateDirectory)throw Object.assign(Error('denied'),{code:'EACCES'});
    return fs.lstat(file,opts);
  }};
  await blockedBeforeEffects(f,/preserved_path_unverified/,{filesystem});
});
test('uncertain canonical resolution fails closed before effects',async t=>{
  const f=await fixture(t),filesystem={...fs,realpath:async file=>{
    if(file===f.preservedPaths.pgDataDirectory)throw Object.assign(Error('IO uncertainty'),{code:'EIO'});
    return fs.realpath(file);
  }};
  await blockedBeforeEffects(f,/preserved_path_unverified/,{filesystem});
});
test('canonical alias with a mismatched physical identity is refused',async t=>{
  const f=await fixture(t),filesystem={...fs,realpath:async file=>file===f.preservedPaths.pgDataDirectory?f.installedRoot:fs.realpath(file)};
  await blockedBeforeEffects(f,/preserved_path_unverified/,{filesystem});
});
test('unknown kernel identity is refused before effects',async t=>{
  const f=await fixture(t),filesystem={...fs,lstat:async(file,opts)=>{
    const info=await fs.lstat(file,opts);
    if(file===f.preservedPaths.pgDataDirectory)info.ino=0n;
    return info;
  }};
  await blockedBeforeEffects(f,/preserved_path_identity_unknown/,{filesystem});
});
test('late PGDATA alias substitution prevents the image rename',async t=>{
  const f=await fixture(t);let checks=0,moves=0;
  await assert.rejects(retireForwardImage(f,{env:f.env,verify:async()=>{
    if(++checks===2){await fs.rmdir(f.preservedPaths.pgDataDirectory);await junction(f.installedRoot,f.preservedPaths.pgDataDirectory);}
  },move:async()=>{moves++;}}),/preserved_path_reparse_forbidden/);
  assert.equal(moves,0);assert.equal(await fs.readFile(path.join(f.installedRoot,'app.bin'),'utf8'),'old installation');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDirectory,'image-retirement-attempt.json'),'utf8')).state,'EFFECT_PENDING');
  await assert.rejects(fs.lstat(f.retiredRoot),{code:'ENOENT'});
});
test('post-retirement custody change retains the pending fence without claiming success',async t=>{
  const f=await fixture(t);
  await assert.rejects(retireForwardImage(f,{env:f.env,move:async(a,b)=>{
    await fs.rename(a,b);await fs.rmdir(f.preservedPaths.pgDataDirectory);await junction(b,f.preservedPaths.pgDataDirectory);
  }}),/image_effect_unknown_requires_readback/);
  assert.equal(await fs.readFile(path.join(f.retiredRoot,'app.bin'),'utf8'),'old installation');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDirectory,'image-retirement-attempt.json'),'utf8')).state,'EFFECT_PENDING');
  await assert.rejects(fs.lstat(path.join(f.stateDirectory,'image-retirement-completed.json')),{code:'ENOENT'});
});
