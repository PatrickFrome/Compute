import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryUiContent } from './ui-content-inventory.mjs';
import { inventoryUiRuntime, verifyUiRuntime } from './ui-runtime-inventory.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-ui-runtime-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'bundle');
  fs.mkdirSync(path.join(bundle, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'server.js'), 'AAAA');
  fs.writeFileSync(path.join(bundle, 'twin.js'), 'AAAA');
  fs.writeFileSync(path.join(bundle, 'me2-ui-manifest.json'), '{"source":"AAAA"}');
  return { root, bundle };
}

test('runtime inventory includes root, empty directories and the original manifest', t => {
  const { bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  assert.deepEqual(before.entries.map(row => [row.path, row.kind]), [
    ['.', 'directory'], ['empty', 'directory'], ['me2-ui-manifest.json', 'file'], ['server.js', 'file'], ['twin.js', 'file'],
  ]);
  assert.equal(before.entries.find(row => row.path === 'server.js').sha256,
    '63c1dd951ffedf6f7fd968ad4efa39b8ed584f162f46e715114ee184f8de9201');
  assert.deepEqual(verifyUiRuntime(bundle, before), before);
});

test('runtime identity is stable after relocation and mtime-only changes', t => {
  const { root, bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  fs.utimesSync(path.join(bundle, 'server.js'), new Date(1), new Date(1));
  fs.cpSync(bundle, path.join(root, 'relocated'), { recursive: true });
  assert.deepEqual(inventoryUiRuntime(bundle), before);
  assert.deepEqual(inventoryUiRuntime(path.join(root, 'relocated')), before);
  assert.ok(!JSON.stringify(before).includes(root));
});

for (const [name, mutate] of [
  ['same-size file mutation', bundle => fs.writeFileSync(path.join(bundle, 'server.js'), 'BBBB')],
  ['self-rewritten manifest', bundle => fs.writeFileSync(path.join(bundle, 'me2-ui-manifest.json'), '{"source":"BBBB"}')],
  ['added empty cache directory', bundle => fs.mkdirSync(path.join(bundle, '.cache'))],
  ['removed empty directory', bundle => fs.rmdirSync(path.join(bundle, 'empty'))],
  ['new empty file', bundle => fs.writeFileSync(path.join(bundle, 'new-file'), '')],
  ['file replaced by directory', bundle => { fs.unlinkSync(path.join(bundle, 'server.js')); fs.mkdirSync(path.join(bundle, 'server.js')); }],
]) test(`runtime inventory rejects ${name}`, t => {
  const { bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  mutate(bundle);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_inventory_mismatch/);
});

test('empty directories remain covered even though the package content hash intentionally excludes them', t => {
  const { bundle } = fixture(t);
  const content = inventoryUiContent(bundle);
  const before = inventoryUiRuntime(bundle);
  fs.mkdirSync(path.join(bundle, '.runtime-cache'));
  assert.equal(inventoryUiContent(bundle).content_sha256, content.content_sha256);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_inventory_mismatch/);
});

for (const target of ['.', 'empty', 'server.js']) test(`runtime inventory rejects ${target} mode changes`, {
  skip: process.platform === 'win32' ? 'POSIX mode mutation does not qualify Windows ACL behavior' : false,
}, t => {
  const { bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  const absolute = path.join(bundle, target);
  fs.chmodSync(absolute, (fs.statSync(absolute).mode & 0o777) ^ 0o020);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_inventory_mismatch/);
});

const linkOptions = { skip: process.platform === 'win32' ? 'symlink creation requires separate Windows privilege qualification' : false };
test('same-byte link retargeting and file-to-link replacement are detected', linkOptions, t => {
  const { bundle } = fixture(t);
  const link = path.join(bundle, 'link.js');
  fs.symlinkSync('server.js', link);
  const before = inventoryUiRuntime(bundle);
  const content = inventoryUiContent(bundle);
  fs.unlinkSync(link);
  fs.symlinkSync('twin.js', link);
  assert.equal(inventoryUiContent(bundle).content_sha256, content.content_sha256);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_inventory_mismatch/);
  const retargeted = inventoryUiRuntime(bundle);
  fs.unlinkSync(path.join(bundle, 'server.js'));
  fs.symlinkSync('twin.js', path.join(bundle, 'server.js'));
  assert.throws(() => verifyUiRuntime(bundle, retargeted), /me2_ui_runtime_inventory_mismatch/);
});

test('internal absolute links retain relocatable identity without executor paths', linkOptions, t => {
  const { root, bundle } = fixture(t);
  fs.symlinkSync(path.join(bundle, 'server.js'), path.join(bundle, 'link.js'));
  const before = inventoryUiRuntime(bundle);
  const relocated = path.join(root, 'relocated');
  fs.cpSync(bundle, relocated, { recursive: true, verbatimSymlinks: true });
  fs.unlinkSync(path.join(relocated, 'link.js'));
  fs.symlinkSync(path.join(relocated, 'server.js'), path.join(relocated, 'link.js'));
  assert.deepEqual(inventoryUiRuntime(relocated), before);
  assert.ok(!JSON.stringify(before).includes(root));
});

test('escaping links, directory cycles and dangling links cannot qualify a snapshot', linkOptions, t => {
  const { root, bundle } = fixture(t);
  const link = path.join(bundle, 'link');
  fs.writeFileSync(path.join(root, 'outside'), 'AAAA');
  fs.symlinkSync('../outside', link);
  assert.throws(() => inventoryUiRuntime(bundle), /me2_ui_runtime_outside_bundle/);
  fs.unlinkSync(link);
  fs.symlinkSync('.', link);
  assert.throws(() => inventoryUiRuntime(bundle), /me2_ui_runtime_directory_cycle/);
  fs.unlinkSync(link);
  fs.symlinkSync('missing', link);
  assert.throws(() => inventoryUiRuntime(bundle), /ENOENT/);
});

test('a same-name file replacement during the read cannot hide behind the opened descriptor', t => {
  const { bundle } = fixture(t);
  const target = path.join(bundle, 'me2-ui-manifest.json');
  const original = fs.readFileSync;
  let replaced = false;
  fs.readFileSync = function (fd, ...args) {
    const result = original.call(this, fd, ...args);
    if (!replaced && typeof fd === 'number') {
      replaced = true;
      fs.renameSync(target, path.join(bundle, 'retired-manifest'));
      fs.writeFileSync(target, result);
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => inventoryUiRuntime(bundle), /me2_ui_runtime_(?:tree|file)_changed_during_read/);
    assert.equal(replaced, true);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
});

test('a mutation of an earlier file during a later read is caught by the final sweep', t => {
  const { bundle } = fixture(t);
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (fd, ...args) {
    const result = original.call(this, fd, ...args);
    if (typeof fd === 'number' && ++reads === 2) {
      fs.writeFileSync(path.join(bundle, 'me2-ui-manifest.json'), '{"source":"BBBB"}');
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => inventoryUiRuntime(bundle), /me2_ui_runtime_tree_changed_during_read/);
    assert.ok(reads >= 2);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
});

test('the original expected inventory must keep its own digest', t => {
  const { bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  before.entries[0].mode ^= 0o020;
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_expected_digest_invalid/);
});
