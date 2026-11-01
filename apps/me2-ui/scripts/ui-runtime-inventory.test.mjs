import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryUiContent } from './ui-content-inventory.mjs';
import { assertUiRuntimePhysicalRoot, inventoryUiRuntime, verifyUiRuntime } from './ui-runtime-inventory.mjs';

const contentObservation = ({ root_binding: _physicalRoot, ...content }) => content;

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

test('relocatable content identity is separate from the original physical-root binding', t => {
  const { root, bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  fs.utimesSync(path.join(bundle, 'server.js'), new Date(1), new Date(1));
  fs.cpSync(bundle, path.join(root, 'relocated'), { recursive: true });
  assert.deepEqual(inventoryUiRuntime(bundle), before);
  const relocated = inventoryUiRuntime(path.join(root, 'relocated'));
  assert.deepEqual(contentObservation(relocated), contentObservation(before));
  assert.notDeepEqual(relocated.root_binding, before.root_binding);
  assert.throws(() => verifyUiRuntime(path.join(root, 'relocated'), before), /me2_ui_runtime_root_binding_mismatch/);
  assert.deepEqual(verifyUiRuntime(path.join(root, 'relocated'), relocated), relocated);
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
  assert.deepEqual(contentObservation(inventoryUiRuntime(relocated)), contentObservation(before));
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

test('the final sweep rejects earlier content even when file-time observations alias', t => {
  const { bundle } = fixture(t);
  const earlier = fs.realpathSync(path.join(bundle, 'me2-ui-manifest.json'));
  const later = fs.realpathSync(path.join(bundle, 'server.js'));
  const beforeBytes = '{"source":"AAAA"}';
  const afterBytes = '{"source":"BBBB"}';
  const originals = {
    readFileSync: fs.readFileSync, lstatSync: fs.lstatSync, statSync: fs.statSync, fstatSync: fs.fstatSync,
  };
  const before = originals.statSync(earlier, { bigint: true });
  const laterStat = originals.statSync(later, { bigint: true });
  const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const readOrder = [];
  const earlierReads = [];
  const aliased = { lstatSync: 0, statSync: 0, fstatSync: 0 };
  let mutated = false;
  assert.equal(BigInt(Buffer.byteLength(afterBytes)), before.size);
  try {
    // Source-only metadata-alias model, not a native Windows observation.
    // Mask only the earlier file's mtimeNs/ctimeNs, including reopened-fd
    // observations; all bytes and other identity/stat fields stay real.
    for (const method of Object.keys(aliased)) {
      fs[method] = function (...args) {
        const stat = originals[method].apply(this, args);
        if (mutated && typeof stat.mtimeNs === 'bigint' && sameFile(stat, before)) {
          stat.mtimeNs = before.mtimeNs;
          stat.ctimeNs = before.ctimeNs;
          aliased[method]++;
        }
        return stat;
      };
    }
    fs.readFileSync = function (fd, ...args) {
      const bytes = originals.readFileSync.call(this, fd, ...args);
      if (typeof fd === 'number') {
        const stat = originals.fstatSync(fd, { bigint: true });
        if (sameFile(stat, before)) {
          readOrder.push('earlier');
          earlierReads.push(bytes.toString());
        } else if (sameFile(stat, laterStat)) {
          readOrder.push('later');
          if (!mutated) {
            assert.deepEqual(readOrder, ['earlier', 'later']);
            const writer = fs.openSync(earlier, 'r+');
            try {
              fs.writeFileSync(writer, afterBytes);
              fs.fsyncSync(writer);
            } finally { fs.closeSync(writer); }
            mutated = true;
          }
        }
      }
      return bytes;
    };
    syncBuiltinESMExports();
    assert.throws(() => inventoryUiRuntime(bundle), /me2_ui_runtime_tree_changed_during_read: content mismatch/);
    assert.equal(mutated, true, 'the durable earlier-file rewrite must fire during the later fd read');
    assert.deepEqual(readOrder, ['earlier', 'later', 'earlier']);
    assert.deepEqual(earlierReads, [beforeBytes, afterBytes], 'the final fd read must observe the changed bytes');
    assert.equal(originals.readFileSync(earlier, 'utf8'), afterBytes);
    for (const method of Object.keys(aliased)) assert.ok(aliased[method] > 0, method + ' must observe aliased file times');
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
});

test('the original expected inventory must keep its own digest', t => {
  const { bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  before.entries[0].mode ^= 0o020;
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_expected_digest_invalid/);
});

// Directory junctions on Windows do not need symlink-creation privilege. These
// mandatory root controls run on Windows as junction tests, without a skip.
test('an initially supplied root symlink or Windows junction is refused', t => {
  const { root, bundle } = fixture(t);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(bundle, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertUiRuntimePhysicalRoot(alias), /me2_ui_runtime_root_not_physical/);
  assert.throws(() => inventoryUiRuntime(alias), /me2_ui_runtime_root_not_physical/);
});

test('root rename followed by a symlink or Windows junction cannot retain a PASS', t => {
  const { root, bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  const moved = path.join(root, 'moved');
  fs.renameSync(bundle, moved);
  fs.symlinkSync(moved, bundle, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(inventoryUiRuntime(moved).tree_sha256, before.tree_sha256);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_root_not_physical/);
});

test('a byte-identical replacement directory cannot reuse the original physical binding', t => {
  const { root, bundle } = fixture(t);
  const before = inventoryUiRuntime(bundle);
  const retired = path.join(root, 'retired');
  fs.renameSync(bundle, retired);
  fs.cpSync(retired, bundle, { recursive: true });
  const replacement = inventoryUiRuntime(bundle);
  assert.deepEqual(contentObservation(replacement), contentObservation(before));
  assert.notEqual(replacement.root_binding.file_id, before.root_binding.file_id);
  assert.throws(() => verifyUiRuntime(bundle, before), /me2_ui_runtime_root_binding_mismatch/);
});

test('a root reached through a symlink or Windows junction ancestor is refused', t => {
  const { root, bundle } = fixture(t);
  const alias = path.join(root, 'ancestor-alias');
  fs.symlinkSync(bundle, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inventoryUiRuntime(path.join(alias, 'empty')), /me2_ui_runtime_root_ancestor_not_physical/);
});

test('a legacy content-only snapshot cannot establish physical-root immutability', t => {
  const { bundle } = fixture(t);
  assert.throws(() => verifyUiRuntime(bundle, contentObservation(inventoryUiRuntime(bundle))), /me2_ui_runtime_root_binding_missing/);
});

test('W73 invoked package scripts execute all new UI acceptance regressions', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/client-source-candidate-w73.yml', import.meta.url), 'utf8');
  const scripts = [...new Set([...workflow.matchAll(/^\s+bun run (test:[a-z-]+)\s*$/gm)].map(match => match[1]))];
  assert.ok(scripts.length > 0, 'W73 must invoke UI test scripts');
  const invokedFiles = scripts.flatMap(name => {
    assert.match(pkg.scripts[name], /^node --test /, name);
    return pkg.scripts[name].split(/\s+/).slice(2);
  });
  for (const required of ['src/lib/goal-journal-readback.ui.test.mjs', 'src/lib/client-runtime-resource.test.mjs',
    'scripts/ui-runtime-inventory.test.mjs', 'scripts/ui-source-acceptance.test.mjs']) {
    assert.equal(invokedFiles.filter(file => file === required).length, 1, required + ' must execute once in W73');
  }
});
