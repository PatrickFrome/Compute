import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compareQaInstalledImage,restorePinnedQaImage,assertOperatorRecoveryPaths} from '../scripts/qa-operator-install-recovery.mjs';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {assertOperatorNsisReceipt,verifyOperatorNsisSnapshot} from '../scripts/qa-operator-nsis-recovery.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-operator-recovery-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
async function tree(root,text){await fs.mkdir(path.join(root,'resources'),{recursive:true});await fs.writeFile(path.join(root,'resources','app.asar'),text);await fs.writeFile(path.join(root,'app.exe'),'native-test');}

test('installed readback compares every packaged byte, every directory and independently pinned NSIS uninstaller',async t=>{
  const root=await fixture(t),candidate=path.join(root,'candidate'),installed=path.join(root,'installed');
  await tree(candidate,'candidate');await tree(installed,'candidate');
  const uninstaller=Buffer.from('NSIS producer bytes'),pin=hash(uninstaller);
  await fs.writeFile(path.join(installed,'Uninstall METAENGINE Browser Test.exe'),uninstaller);
  const proof=await compareQaInstalledImage(candidate,installed,{expectedUninstallerSha256:pin});
  assert.equal(proof.full_tree_verified,true);assert.equal(proof.file_count,3);assert.equal(proof.production_authorized,false);
  await assert.rejects(compareQaInstalledImage(candidate,installed,{expectedUninstallerSha256:'e'.repeat(64)}),/uninstaller_mismatch/);
  await fs.writeFile(path.join(installed,'resources','app.asar'),'tampered');
  await assert.rejects(compareQaInstalledImage(candidate,installed,{expectedUninstallerSha256:pin}),/candidate_image_mismatch/);
  await fs.writeFile(path.join(installed,'resources','app.asar'),'candidate');await fs.mkdir(path.join(installed,'foreign-empty-directory'));
  await assert.rejects(compareQaInstalledImage(candidate,installed,{expectedUninstallerSha256:pin}),/candidate_image_mismatch/);
});
test('operator restore keeps full preimage quarantine, verifies exact snapshot and fences replay',async t=>{
  const root=await fixture(t),installed=path.join(root,'installed'),snapshot=path.join(root,'snapshot');
  await tree(installed,'interrupted NSIS');await tree(snapshot,'old exact image');
  const before=await captureInstalledTreeFingerprint(installed),old=await captureInstalledTreeFingerprint(snapshot);
  const args={installedRoot:installed,snapshotRoot:snapshot,journalFile:path.join(root,'journal.json'),
    expectedSnapshotSha256:old.tree_sha256,expectedPreimageSha256:before.tree_sha256};
  const result=await restorePinnedQaImage(args);
  assert.equal(result.state,'RESTORED_IMAGE_VERIFIED');assert.equal(result.postgres_mutated,false);
  assert.equal((await captureInstalledTreeFingerprint(installed)).tree_sha256,old.tree_sha256);
  assert.equal((await captureInstalledTreeFingerprint(result.quarantine_directory)).tree_sha256,before.tree_sha256);
  await assert.rejects(restorePinnedQaImage(args),/existing_attempt_requires_readback/);
});
test('rename-gap failure restores current preimage, post-promotion failure remains fenced',async t=>{
  for(const point of ['QUARANTINED','PROMOTED'])await t.test(point,async t=>{
    const root=await fixture(t),installed=path.join(root,'installed'),snapshot=path.join(root,'snapshot');
    await tree(installed,'current');await tree(snapshot,'snapshot');
    const before=await captureInstalledTreeFingerprint(installed),old=await captureInstalledTreeFingerprint(snapshot),journal=path.join(root,'journal.json');
    await assert.rejects(restorePinnedQaImage({installedRoot:installed,snapshotRoot:snapshot,journalFile:journal,
      expectedSnapshotSha256:old.tree_sha256,expectedPreimageSha256:before.tree_sha256,
      onCheckpoint:async p=>{if(p===point)throw Error('injected');}}),/injected/);
    const result=JSON.parse(await fs.readFile(journal,'utf8'));
    assert.equal(result.state,point==='QUARANTINED'?'ABORTED_PREIMAGE_RESTORED':'EFFECT_UNKNOWN_REQUIRES_READBACK');
    assert.equal((await captureInstalledTreeFingerprint(installed)).tree_sha256,point==='QUARANTINED'?before.tree_sha256:old.tree_sha256);
  });
});
test('real operator recovery refuses arbitrary profile, snapshot, network and PG targets',()=>{
  const local=path.resolve(os.tmpdir(),'qa-local'),state=path.join(local,'METAENGINE','client-state-qa-upgrade-11111111-2222-3333-4444-555555555555');
  const args={installedRoot:path.join(local,'Programs','METAENGINE Browser Test'),stateDirectory:state,
    snapshotRoot:path.join(state,'predecessor-image-snapshot','image')};
  assert.equal(assertOperatorRecoveryPaths(args,{LOCALAPPDATA:local}),true);
  for(const change of [{installedRoot:path.join(local,'METAENGINE','postgresql-17-live')},{snapshotRoot:state},
    {stateDirectory:path.join(local,'not-private-upgrade')},{installedRoot:'\\\\server\\share'}]){
    assert.throws(()=>assertOperatorRecoveryPaths({...args,...change},{LOCALAPPDATA:local}),/scope_invalid|paths_invalid/);
  }
});
test('operator NSIS proof rejects fixture/authority substitutes and snapshot corruption before mutation',async t=>{
  const root=await fixture(t),snapshot=path.join(root,'snapshot');await fs.mkdir(snapshot);
  const bytes=Buffer.from('exact snapshot fixture'),m={schema:'metaengine.operator.qa-nsis-effects.v1',operator_version:'0.7.0-dev.1.1',
    registry_sha256:hash(bytes),start_menu_sha256:hash(bytes),desktop_sha256:hash(bytes)};
  for(const name of ['registry.json','start-menu.lnk','desktop.lnk'])await fs.writeFile(path.join(snapshot,name),bytes);
  const manifest=Buffer.from(JSON.stringify(m));await fs.writeFile(path.join(snapshot,'manifest.json'),manifest);
  const proof={snapshot_directory:root,snapshot_sha256:hash(manifest)};
  assert.equal(await verifyOperatorNsisSnapshot(proof,m.operator_version),true);
  await fs.writeFile(path.join(snapshot,'desktop.lnk'),'corrupt');
  await assert.rejects(verifyOperatorNsisSnapshot(proof,m.operator_version),/snapshot_content_changed/);
  assert.throws(()=>assertOperatorNsisReceipt({schema:'metaengine.browser.qa-disposable-nsis-effects.v1'},'Capture'),/receipt_unverified/);
});
