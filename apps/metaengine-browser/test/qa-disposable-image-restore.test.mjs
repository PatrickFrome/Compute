import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { qualifyDisposableFullImageRestore,DISPOSABLE_RESTORE_SCHEMA }
  from '../scripts/qa-disposable-image-restore.mjs';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-qa-recovery-fixture-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const installed=path.join(root,'installed'),snapshot=path.join(root,'snapshot');
  for(const p of [installed,snapshot]){
    await fs.mkdir(path.join(p,'resources','native'),{recursive:true});
    await fs.mkdir(path.join(p,'resources','empty'));
    await fs.writeFile(path.join(p,'METAENGINE Browser Test.exe'),'EXE:v1');
    await fs.writeFile(path.join(p,'resources','app.asar'),'ASAR:v1');
    await fs.writeFile(path.join(p,'resources','native','module.node'),'NATIVE:v1');
    await fs.writeFile(path.join(p,'Uninstall METAENGINE Browser Test.exe'),'UNINSTALL:v1');
  }
  await fs.writeFile(path.join(installed,'resources','app.asar'),'ASAR:partial-v2');
  await fs.writeFile(path.join(installed,'Uninstall METAENGINE Browser Test.exe'),'UNINSTALL:partial-v2');
  return {root,installed,snapshot,
    expected:(await captureInstalledTreeFingerprint(snapshot)).tree_sha256,
    preimage:(await captureInstalledTreeFingerprint(installed)).tree_sha256};
}
test('disposable interrupted NSIS replacement restores complete EXE, ASAR, native, uninstaller and directories',async t=>{
  const f=await fixture(t);
  const receipt=await qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:f.expected});
  assert.equal(receipt.schema,DISPOSABLE_RESTORE_SCHEMA);
  assert.equal(receipt.state,'RESTORED_IMAGE_VERIFIED');
  assert.equal(receipt.source_tree_sha256,f.expected);
  assert.equal(receipt.preimage_sha256,f.preimage);
  assert.equal(receipt.production_authorized,false);
  assert.equal(receipt.owner_mutated,false);
  assert.equal(receipt.guardian_mutated,false);
  assert.equal(receipt.postgres_mutated,false);
  assert.equal(receipt.automatic_retry_allowed,false);
  assert.equal((await captureInstalledTreeFingerprint(f.installed)).tree_sha256,f.expected);
  assert.equal((await captureInstalledTreeFingerprint(path.join(f.root,'quarantine'))).tree_sha256,f.preimage);
  assert.equal((await fs.readdir(path.join(f.installed,'resources','empty'))).length,0);
  await assert.rejects(qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:f.expected}),
    /qa_disposable_restore_existing_attempt_requires_readback/);
});
test('failure in rename gap compensates only against unchanged exact preimage',async t=>{
  const f=await fixture(t);
  await assert.rejects(
    qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:f.expected,
      onCheckpoint:async stage=>{if(stage==='PREIMAGE_QUARANTINED')throw Error('injected_before_image_promotion');}}),
    err=>{assert.equal(err.message,'injected_before_image_promotion');assert.equal(err.rollbackConfirmed,true);return true;}
  );
  assert.equal((await captureInstalledTreeFingerprint(f.installed)).tree_sha256,f.preimage);
  const journal=JSON.parse(await fs.readFile(path.join(f.root,'restore-receipt.json')));
  assert.equal(journal.state,'ABORTED_PREIMAGE_RESTORED');
  assert.equal(journal.automatic_retry_allowed,false);
});
test('error after image promotion records effect UNKNOWN and forbids auto-replay',async t=>{
  const f=await fixture(t);
  await assert.rejects(
    qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:f.expected,
      onCheckpoint:async stage=>{if(stage==='RESTORED_UNVERIFIED')throw Error('injected_after_image_promotion');}}),
    /injected_after_image_promotion/
  );
  assert.equal((await captureInstalledTreeFingerprint(f.installed)).tree_sha256,f.expected);
  assert.equal((await captureInstalledTreeFingerprint(path.join(f.root,'quarantine'))).tree_sha256,f.preimage);
  const journal=JSON.parse(await fs.readFile(path.join(f.root,'restore-receipt.json')));
  assert.equal(journal.state,'EFFECT_UNKNOWN_REQUIRES_READBACK');
  await assert.rejects(qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:f.expected}),
    /qa_disposable_restore_existing_attempt_requires_readback/);
});
test('invalid source digest or non-disposable root fails before modification',async t=>{
  const f=await fixture(t);
  await assert.rejects(qualifyDisposableFullImageRestore(f.root,{expectedSnapshotSha256:'b'.repeat(64)}),
    /qa_disposable_restore_tree_digest_mismatch/);
  assert.equal((await captureInstalledTreeFingerprint(f.installed)).tree_sha256,f.preimage);
  await assert.rejects(qualifyDisposableFullImageRestore(path.dirname(f.root),
    {expectedSnapshotSha256:f.expected}),/qa_disposable_restore_outside_disposable_fixture/);
  assert.equal((await captureInstalledTreeFingerprint(f.installed)).tree_sha256,f.preimage);
});
