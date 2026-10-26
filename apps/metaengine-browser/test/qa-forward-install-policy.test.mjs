import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {assertForwardScope,retireForwardImage} from '../scripts/qa-forward-install-policy.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'forward-install-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const installedRoot=path.join(root,'Programs','METAENGINE Browser Test');
  const stateDirectory=path.join(root,'METAENGINE','client-state-qa-upgrade-'+randomUUID());
  const retiredRoot=path.join(stateDirectory,'retired-installation');
  await fs.mkdir(installedRoot,{recursive:true});await fs.mkdir(stateDirectory,{recursive:true});
  await fs.writeFile(path.join(installedRoot,'app.bin'),'old installation');
  const expectedTreeSha256=(await captureInstalledTreeFingerprint(installedRoot)).tree_sha256;
  return {installedRoot,stateDirectory,retiredRoot,expectedTreeSha256,env:{LOCALAPPDATA:root}};
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
