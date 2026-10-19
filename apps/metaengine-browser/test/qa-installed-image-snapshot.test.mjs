import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {copyInstalledImageToFreshDirectory,QA_IMAGE_SNAPSHOT_SCHEMA}
  from '../scripts/qa-installed-image-snapshot.mjs';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';

async function fixture(t){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-snapshot-fixture-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const source=path.join(home,'app'),target=path.join(home,'backup');
  await fs.mkdir(path.join(source,'resources','guardian-native'),{recursive:true});
  await fs.mkdir(path.join(source,'resources','empty-directory'));
  await fs.writeFile(path.join(source,'METAENGINE Browser Test.exe'),'executable-binary');
  await fs.writeFile(path.join(source,'Uninstall METAENGINE Browser Test.exe'),'uninstaller-binary');
  await fs.writeFile(path.join(source,'resources','app.asar'),'application-asar');
  await fs.writeFile(path.join(source,'resources','guardian-native','guardian.exe'),'guardian-binary');
  return {home,source,target};
}
test('full image staging preserves EXE, ASAR, uninstaller, Guardian and empty directories',async t=>{
  const f=await fixture(t),before=await captureInstalledTreeFingerprint(f.source);
  const receipt=await copyInstalledImageToFreshDirectory(f.source,f.target);
  assert.equal(receipt.schema,QA_IMAGE_SNAPSHOT_SCHEMA);
  assert.equal(receipt.tree_sha256,before.tree_sha256);
  assert.equal(receipt.source_unchanged,true);
  assert.equal(receipt.copied_tree_verified,true);
  assert.equal(receipt.installed_mutated,false);
  assert.equal(receipt.restore_authorized,false);
  assert.equal(receipt.production_authorized,false);
  assert.equal(receipt.authority_effect,false);
  assert.equal((await captureInstalledTreeFingerprint(f.target)).tree_sha256,before.tree_sha256);
  assert.equal((await fs.readdir(path.join(f.target,'resources','empty-directory'))).length,0);
  assert.equal((await fs.readFile(path.join(f.source,'METAENGINE Browser Test.exe'),'utf8')),'executable-binary');
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,f.target),/qa_snapshot_destination_exists/);
});
test('mutated source, extra copied resource and modified uninstaller are detectable',async t=>{
  const f=await fixture(t),receipt=await copyInstalledImageToFreshDirectory(f.source,f.target);
  await fs.writeFile(path.join(f.target,'Uninstall METAENGINE Browser Test.exe'),'changed');
  assert.notEqual((await captureInstalledTreeFingerprint(f.target)).tree_sha256,receipt.tree_sha256);
  await fs.writeFile(path.join(f.target,'new-driver.dll'),'foreign');
  assert.notEqual((await captureInstalledTreeFingerprint(f.target)).tree_sha256,receipt.tree_sha256);
});
test('snapshot refuses nested/overlapping roots and pre-existing destination',async t=>{
  const f=await fixture(t);
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,f.source),/qa_snapshot_separate_absolute_roots_required/);
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,path.join(f.source,'copy')),/qa_snapshot_separate_absolute_roots_required/);
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,path.join(f.home,'other','nested')),{code:'ENOENT'});
  await fs.mkdir(f.target);
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,f.target),/qa_snapshot_destination_exists/);
});
test('hard linked or symbolic link payload is never used as a predecessor image',async t=>{
  const f=await fixture(t),base=path.join(f.source,'METAENGINE Browser Test.exe');
  await fs.link(base,path.join(f.source,'second.exe'));
  await assert.rejects(copyInstalledImageToFreshDirectory(f.source,f.target),/qa_tree_nonregular_or_hardlinked_file/);
});
