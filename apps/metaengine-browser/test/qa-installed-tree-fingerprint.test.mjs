import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureInstalledTreeFingerprint,INSTALLED_TREE_SCHEMA}
  from '../scripts/qa-installed-tree-fingerprint.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-qa-tree-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'resources','client-state-runtime'),{recursive:true});
  await fs.mkdir(path.join(root,'resources','guardian-native'),{recursive:true});
  await fs.writeFile(path.join(root,'METAENGINE Browser Test.exe'),'executable-v1');
  await fs.writeFile(path.join(root,'resources','app.asar'),'asar-v1');
  await fs.writeFile(path.join(root,'resources','client-state-runtime','manifest.json'),'runtime-v1');
  await fs.writeFile(path.join(root,'resources','guardian-native','guardian.exe'),'guardian-v1');
  await fs.writeFile(path.join(root,'Uninstall METAENGINE Browser Test.exe'),'uninstaller-v1');
  return root;
}
test('whole installed image SHA256 is repeatable and includes all resources',async t=>{
  const root=await fixture(t);
  const one=await captureInstalledTreeFingerprint(root);
  const two=await captureInstalledTreeFingerprint(root);
  assert.deepEqual(one,two);
  assert.equal(one.schema,INSTALLED_TREE_SCHEMA);
  assert.match(one.tree_sha256,/^[a-f0-9]{64}$/);
  assert.equal(one.file_count,5);
  assert.equal(one.total_bytes,Buffer.byteLength(
    'executable-v1asar-v1runtime-v1guardian-v1uninstaller-v1'));
});
test('any changed file beyond app.asar/runtime invalidates full-tree digest',async t=>{
  const root=await fixture(t);
  const predecessor=await captureInstalledTreeFingerprint(root);
  const files=[
    ['Uninstall METAENGINE Browser Test.exe','other-uninstaller'],
    ['resources/guardian-native/guardian.exe','other-native'],
    ['METAENGINE Browser Test.exe','new-executable'],
    ['resources/client-state-runtime/manifest.json','new-runtime'],
  ];
  for(const [relative,replacement] of files){
    const file=path.join(root,relative),original=await fs.readFile(file);
    await fs.writeFile(file,replacement);
    const actual=await captureInstalledTreeFingerprint(root);
    assert.notEqual(actual.tree_sha256,predecessor.tree_sha256,relative);
    await fs.writeFile(file,original);
    assert.equal((await captureInstalledTreeFingerprint(root)).tree_sha256,
      predecessor.tree_sha256,'restored exact bytes must produce same digest');
  }
});
test('added, deleted and hard-linked payloads cannot silently pass readback',async t=>{
  const root=await fixture(t),base=await captureInstalledTreeFingerprint(root);
  const extra=path.join(root,'resources','injected.dll');
  await fs.writeFile(extra,'unexpected file');
  assert.notEqual((await captureInstalledTreeFingerprint(root)).tree_sha256,base.tree_sha256);
  await fs.unlink(extra);
  const source=path.join(root,'METAENGINE Browser Test.exe');
  const alias=path.join(root,'fake-exe-hardlink');
  await fs.link(source,alias);
  await assert.rejects(captureInstalledTreeFingerprint(root),/qa_tree_nonregular_or_hardlinked_file/);
  await fs.unlink(alias);
  await fs.rm(path.join(root,'Uninstall METAENGINE Browser Test.exe'));
  assert.notEqual((await captureInstalledTreeFingerprint(root)).tree_sha256,base.tree_sha256);
});
test('reject relative roots, empty installs and reparse links',async t=>{
  await assert.rejects(captureInstalledTreeFingerprint('.'),/qa_tree_absolute_local_root_required/);
  const empty=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-qa-empty-'));
  t.after(()=>fs.rm(empty,{recursive:true,force:true}));
  await assert.rejects(captureInstalledTreeFingerprint(empty),/qa_tree_empty_installed_tree/);
  const root=await fixture(t),candidate=path.join(root,'resources','unsafe-link');
  try {
    await fs.symlink(path.join(root,'METAENGINE Browser Test.exe'),candidate,'file');
  } catch (error) {
    if(['EPERM','EACCES','ENOTSUP'].includes(error.code))return;
    throw error;
  }
  await assert.rejects(captureInstalledTreeFingerprint(root),/qa_tree_reparse_path_forbidden/);
});
