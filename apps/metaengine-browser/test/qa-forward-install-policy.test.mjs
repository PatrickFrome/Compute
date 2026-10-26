import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {assertForwardScope,assertForwardPreservedPaths,writeForwardPreservedGate,retireForwardImage,
  forwardDigest,writeForwardEvidence,assertForwardArtifactsUnchanged,assertForwardInstallNotAttempted,
  runForwardEffect,publishForwardOwner} from '../scripts/qa-forward-install-policy.mjs';

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

async function artifactFixture(t){
  const f=await fixture(t),candidateRoot=f.preservedPaths.candidateRoot,installerFile=f.preservedPaths.installerFile;
  const runtimeFile=path.join(candidateRoot,'runtime.bin');await fs.writeFile(runtimeFile,'pinned runtime');
  const pins={candidateRoot,installerFile,expectedTreeSha256:(await captureInstalledTreeFingerprint(candidateRoot)).tree_sha256,
    expectedInstallerSha256:forwardDigest(await fs.readFile(installerFile))};
  return {...f,pins,runtimeFile};
}
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const missing=file=>assert.rejects(fs.lstat(file),{code:'ENOENT'});
test('effect byte pins reject a candidate change after a successful verification',async t=>{
  const f=await artifactFixture(t);
  assert.equal(await assertForwardArtifactsUnchanged(f.pins),true);
  await fs.writeFile(f.runtimeFile,'changed runtime');
  await assert.rejects(assertForwardArtifactsUnchanged(f.pins),/candidate_changed/);
});
test('effect byte pins reject a hardlinked candidate child',async t=>{
  const f=await artifactFixture(t);await fs.link(f.runtimeFile,path.join(f.env.LOCALAPPDATA,'runtime-alias'));
  await assert.rejects(assertForwardArtifactsUnchanged(f.pins),/nonregular_or_hardlinked_file/);
});
for(const field of ['installerFile','runtimeFile'])test(field+' changes after intent: HOLD without an effect or retry',async t=>{
  const f=await artifactFixture(t);let invokes=0;
  const options={stateDirectory:f.stateDirectory,effect:'installer',identity:{installer_sha256:f.pins.expectedInstallerSha256}};
  const callbacks={verifyBefore:()=>assertForwardArtifactsUnchanged(f.pins),invoke:async()=>{invokes++;return {installer_exit_code:0};},
    write:async(file,value)=>{
      const result=await writeForwardEvidence(file,value);
      if(file.endsWith('installer-attempt.json'))await fs.writeFile(field==='installerFile'?f.pins.installerFile:f.runtimeFile,'late substitution');
      return result;
    }};
  await assert.rejects(runForwardEffect(options,callbacks),/installer_hold_requires_readback/);
  assert.equal(invokes,0);
  const hold=await readJson(path.join(f.stateDirectory,'installer-hold.json'));
  assert.equal(hold.state,'HOLD');assert.equal(hold.invocation_started,false);assert.equal(hold.effect_outcome,'NOT_INVOKED');
  await missing(path.join(f.stateDirectory,'installer-completed.json'));
  await assert.rejects(runForwardEffect(options,callbacks),/existing_attempt_requires_readback/);
  assert.equal(invokes,0);
});
test('lost installer acknowledgement retains a durable HOLD and refuses the next invocation',async t=>{
  const f=await fixture(t),effectFile=path.join(f.stateDirectory,'simulated-installer-effect');let invokes=0;
  const options={stateDirectory:f.stateDirectory,effect:'installer',identity:{installer_sha256:'a'.repeat(64)}};
  const callbacks={invoke:async()=>{invokes++;await fs.writeFile(effectFile,'effect occurred');throw Error('lost exit observation');}};
  await assert.rejects(runForwardEffect(options,callbacks),/installer_hold_requires_readback/);
  assert.equal(await fs.readFile(effectFile,'utf8'),'effect occurred');
  const hold=await readJson(path.join(f.stateDirectory,'installer-hold.json'));
  assert.deepEqual([hold.state,hold.invocation_started,hold.effect_outcome,hold.completion_verified,hold.automatic_retry_allowed],['HOLD',true,'UNKNOWN',false,false]);
  assert.equal(Object.hasOwn(hold,'installer_exit_code'),false);
  await missing(path.join(f.stateDirectory,'installer-completed.json'));
  await assert.rejects(runForwardEffect(options,callbacks),/existing_attempt_requires_readback/);
  assert.equal(invokes,1);
});
test('a fresh process cannot repeat an installer with a durable ambiguous intent',async t=>{
  const f=await fixture(t),effectFile=path.join(f.stateDirectory,'effect-count'),readbackFile=path.join(f.stateDirectory,'fresh-process-readback.json');
  const options={stateDirectory:f.stateDirectory,effect:'installer',identity:{}};
  await assert.rejects(runForwardEffect(options,{invoke:async()=>{
    await fs.writeFile(effectFile,'one');throw Error('lost acknowledgement');
  }}),/installer_hold_requires_readback/);
  const moduleUrl=new URL('../scripts/qa-forward-install-policy.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs/promises';
    import {runForwardEffect} from ${JSON.stringify(moduleUrl)};
    try {await runForwardEffect(${JSON.stringify(options)},{invoke:async()=>{
      await fs.appendFile(${JSON.stringify(effectFile)},'replayed');return {};
    }});process.exitCode=2;}catch(error){
      if(!/existing_attempt_requires_readback/.test(error.message))throw error;
      await fs.writeFile(${JSON.stringify(readbackFile)},JSON.stringify({state:'HOLD_NO_REPLAY',pid:process.pid}),{flag:'wx'});
    }`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:10000,windowsHide:true});
  const readback=await readJson(readbackFile);
  assert.equal(readback.state,'HOLD_NO_REPLAY');assert.notEqual(readback.pid,process.pid);assert.equal(await fs.readFile(effectFile,'utf8'),'one');
  await missing(path.join(f.stateDirectory,'installer-completed.json'));
});
test('successful child exit with failed readback cannot create completion',async t=>{
  const f=await fixture(t);let invokes=0;
  const options={stateDirectory:f.stateDirectory,effect:'installer',identity:{}};
  const callbacks={invoke:async()=>{invokes++;return {installer_exit_code:0};},verifyAfter:async()=>{throw Error('payload mismatch');}};
  await assert.rejects(runForwardEffect(options,callbacks),/installer_hold_requires_readback/);
  await missing(path.join(f.stateDirectory,'installer-completed.json'));
  await assert.rejects(runForwardEffect(options,callbacks),/existing_attempt_requires_readback/);
  assert.equal(invokes,1);
});
test('failed durable intent prevents invocation without claiming a recorded HOLD',async t=>{
  const f=await fixture(t);let invokes=0;
  await assert.rejects(runForwardEffect({stateDirectory:f.stateDirectory,effect:'installer',identity:{}}, {
    invoke:async()=>{invokes++;},write:async()=>{throw Error('intent disk failure');}}),/intent disk failure/);
  assert.equal(invokes,0);
  await missing(path.join(f.stateDirectory,'installer-attempt.json'));await missing(path.join(f.stateDirectory,'installer-hold.json'));
});
test('failed HOLD persistence is reported separately while the original intent fences retry',async t=>{
  const f=await fixture(t);let invokes=0;
  const options={stateDirectory:f.stateDirectory,effect:'installer',identity:{}};
  await assert.rejects(runForwardEffect(options,{
    invoke:async()=>{invokes++;throw Error('effect observation lost');},
    write:async(file,value)=>{if(file.endsWith('-hold.json'))throw Error('hold disk failure');return writeForwardEvidence(file,value);},
  }),error=>error instanceof AggregateError&&/hold_not_recorded/.test(error.message)&&error.errors.length===2);
  assert.equal((await readJson(path.join(f.stateDirectory,'installer-attempt.json'))).state,'EFFECT_PENDING');
  await missing(path.join(f.stateDirectory,'installer-hold.json'));await missing(path.join(f.stateDirectory,'installer-completed.json'));
  await assert.rejects(runForwardEffect(options,{invoke:async()=>{invokes++;}}),/existing_attempt_requires_readback/);
  assert.equal(invokes,1);
});
for(const effect of ['image-retirement','registration-retirement','installer','owner-publication'])test(effect+' intent prevents install reentry',async t=>{
  const f=await fixture(t);await assertForwardInstallNotAttempted(f.stateDirectory);
  await fs.writeFile(path.join(f.stateDirectory,effect+'-attempt.json'),'unreadable or incomplete intent');
  await assert.rejects(assertForwardInstallNotAttempted(f.stateDirectory),/existing_attempt_requires_readback/);
});
async function ownerFixture(t){
  const f=await fixture(t),ownerFile=f.preservedPaths.ownerFile,stagedFile=path.join(f.stateDirectory,'pending-owner.json');
  const oldBytes=Buffer.from('{"owner":"previous"}\n'),nextBytes=Buffer.from('{"owner":"successor"}\n');
  await fs.writeFile(ownerFile,oldBytes);await fs.writeFile(stagedFile,nextBytes);
  const gate=ownerFile+'.qa-upgrade-gate.json';await fs.writeFile(gate,'publication blocked');
  return {...f,gate,publication:{stateDirectory:f.stateDirectory,ownerFile,stagedFile,oldBytes,nextBytes}};
}
test('forward Owner publication preserves preimage and leaves admission gated',async t=>{
  const f=await ownerFixture(t),p=f.publication;
  const r=await publishForwardOwner(p);
  assert.equal(r.state,'PUBLISHED_VERIFIED');assert.equal(r.automatic_rollback_attempted,false);
  assert.deepEqual(await fs.readFile(p.ownerFile),p.nextBytes);
  assert.deepEqual(await fs.readFile(path.join(f.stateDirectory,'owner-publication-custody','preimage.json')),p.oldBytes);
  assert.equal(await fs.readFile(f.gate,'utf8'),'publication blocked');
  assert.equal((await fs.lstat(p.ownerFile)).nlink,1);
  await assert.rejects(publishForwardOwner(p),/existing_attempt_requires_readback/);
});
test('lost Owner capture acknowledgement keeps captured bytes, gate and HOLD without restoration',async t=>{
  const f=await ownerFixture(t),p=f.publication;let renames=0;
  const filesystem={...fs,rename:async(a,b)=>{renames++;await fs.rename(a,b);throw Error('capture acknowledgement lost');}};
  await assert.rejects(publishForwardOwner(p,{filesystem}),/owner-publication_hold_requires_readback/);
  await missing(p.ownerFile);
  assert.deepEqual(await fs.readFile(path.join(f.stateDirectory,'owner-publication-custody','preimage.json')),p.oldBytes);
  await missing(path.join(f.stateDirectory,'owner-publication-completed.json'));
  assert.equal((await readJson(path.join(f.stateDirectory,'owner-publication-hold.json'))).state,'HOLD');
  assert.equal(await fs.readFile(f.gate,'utf8'),'publication blocked');
  await assert.rejects(publishForwardOwner(p,{filesystem}),/existing_attempt_requires_readback/);assert.equal(renames,1);
});
test('lost Owner link acknowledgement preserves ambiguous links without repeating publication',async t=>{
  const f=await ownerFixture(t),p=f.publication;let links=0;
  const filesystem={...fs,link:async(a,b)=>{links++;await fs.link(a,b);throw Error('publication acknowledgement lost');}};
  await assert.rejects(publishForwardOwner(p,{filesystem}),/owner-publication_hold_requires_readback/);
  assert.deepEqual(await fs.readFile(p.ownerFile),p.nextBytes);assert.equal((await fs.lstat(p.ownerFile)).nlink,2);
  await missing(path.join(f.stateDirectory,'owner-publication-completed.json'));
  assert.equal(await fs.readFile(f.gate,'utf8'),'publication blocked');
  await assert.rejects(publishForwardOwner(p,{filesystem}),/existing_attempt_requires_readback/);assert.equal(links,1);
});
test('post-publication verification failure preserves new Owner without rollback or completion',async t=>{
  const f=await ownerFixture(t),p=f.publication;let checks=0;
  await assert.rejects(publishForwardOwner(p,{verify:async()=>{if(++checks===3)throw Error('registry changed');}}),/owner-publication_hold_requires_readback/);
  assert.deepEqual(await fs.readFile(p.ownerFile),p.nextBytes);
  assert.deepEqual(await fs.readFile(path.join(f.stateDirectory,'owner-publication-custody','preimage.json')),p.oldBytes);
  assert.equal((await fs.lstat(p.ownerFile)).nlink,1);
  await missing(path.join(f.stateDirectory,'owner-publication-completed.json'));
  await assert.rejects(publishForwardOwner(p),/existing_attempt_requires_readback/);
});
test('concurrent Owner publication is never overwritten or rolled back',async t=>{
  const f=await ownerFixture(t),p=f.publication,foreign=Buffer.from('other operator');
  const filesystem={...fs,rename:async(a,b)=>{await fs.rename(a,b);await fs.writeFile(p.ownerFile,foreign,{flag:'wx'});}};
  await assert.rejects(publishForwardOwner(p,{filesystem}),/owner-publication_hold_requires_readback/);
  assert.deepEqual(await fs.readFile(p.ownerFile),foreign);
  assert.deepEqual(await fs.readFile(path.join(f.stateDirectory,'owner-publication-custody','preimage.json')),p.oldBytes);
  await missing(path.join(f.stateDirectory,'owner-publication-completed.json'));
  await assert.rejects(publishForwardOwner(p),/existing_attempt_requires_readback/);
});
test('runtime qualification cannot use a log directory as the custody state directory',async t=>{
  const f=await fixture(t),configFile=path.join(f.stateDirectory,'config.json');
  await fs.writeFile(configFile,JSON.stringify({state_directory:f.stateDirectory}));
  const {qualifyForwardRuntime}=await import('../scripts/qa-forward-install.mjs');
  let executableAccessed=false;
  const verified={get paths(){executableAccessed=true;throw Error('must not reach launch');}};
  await assert.rejects(qualifyForwardRuntime({verified,configFile,owner:{},stateDirectory:f.env.LOCALAPPDATA}),/runtime_state_directory_mismatch/);
  assert.equal(executableAccessed,false);await missing(path.join(f.env.LOCALAPPDATA,'qualification-host.stderr'));
});
