import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const UI_RUNTIME_HASH_SCHEME = 'path-kind-mode-content-link-v1';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const mode = stat => Number(stat.mode & 0o7777n);
const sameStat = (a, b) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);

// Acceptance evidence, separate from the production package content manifest.
// Includes the root, empty directories, links, modes and the manifest itself.
// mtime/ctime/inodes detect concurrent changes but are not stable content identity.
// Windows mode bits do not describe ACLs, alternate streams or reparse metadata.
// This is a sampled tree observation, not an atomic filesystem snapshot or proof
// that a transient write never occurred between observations.
export function inventoryUiRuntime(directory) {
  const root = realpathSync(directory);
  assert.ok(lstatSync(root).isDirectory(), 'me2_ui_runtime_root_not_directory');
  const entries = [];
  const names = new Set();
  const observed = [];
  let sizeBytes = 0;

  const relativeInside = absolute => {
    const relative = path.relative(root, absolute);
    assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), 'me2_ui_runtime_outside_bundle');
    return relative.split(path.sep).join('/') || '.';
  };
  const unchanged = record => {
    assert.equal(realpathSync(record.absolute), record.real, 'me2_ui_runtime_path_changed');
    assert.ok(sameStat(record.linkStat, lstatSync(record.absolute, { bigint: true }))
      && sameStat(record.targetStat, statSync(record.absolute, { bigint: true })), 'me2_ui_runtime_tree_changed_during_read');
    if (record.linkTarget !== null) assert.equal(readlinkSync(record.absolute), record.linkTarget, 'me2_ui_runtime_link_changed');
  };
  function walk(absolute, relative, ancestors) {
    const key = relative.toLowerCase();
    assert.ok(!names.has(key), 'me2_ui_runtime_case_collision');
    names.add(key);
    const linkStat = lstatSync(absolute, { bigint: true });
    const real = realpathSync(absolute);
    relativeInside(real);
    const targetStat = statSync(absolute, { bigint: true });
    const isDirectory = targetStat.isDirectory();
    assert.ok(isDirectory || targetStat.isFile(), 'me2_ui_runtime_not_regular_file');
    const linkTarget = linkStat.isSymbolicLink() ? readlinkSync(absolute) : null;
    const row = { path: relative, kind: linkTarget === null ? (isDirectory ? 'directory' : 'file') : 'symlink', mode: mode(linkStat) };
    if (linkTarget !== null) {
      // Preserve relative link spelling; normalize only the relocatable root of
      // an absolute in-bundle link. Never put an executor path into the digest.
      const lexicalTarget = path.resolve(path.dirname(absolute), linkTarget);
      const normalizedTarget = relativeInside(lexicalTarget);
      row.link_type = path.isAbsolute(linkTarget) ? 'absolute' : 'relative';
      row.link_target = path.isAbsolute(linkTarget) ? normalizedTarget : linkTarget.split(path.sep).join('/');
      row.resolved_target = relativeInside(real);
      row.target_kind = isDirectory ? 'directory' : 'file';
      row.target_mode = mode(targetStat);
    }
    const record = { absolute, real, linkStat, targetStat, linkTarget };
    if (isDirectory) {
      assert.ok(!ancestors.has(real), 'me2_ui_runtime_directory_cycle');
      const next = new Set(ancestors).add(real);
      entries.push(row);
      const children = readdirSync(absolute).sort();
      for (const name of children) {
        assert.ok(!name.includes('\\') && !name.includes(':') && !/[\x00-\x1f\x7f]/.test(name), 'me2_ui_runtime_path_invalid');
        walk(path.join(absolute, name), relative === '.' ? name : `${relative}/${name}`, next);
      }
      assert.deepEqual(readdirSync(absolute).sort(), children, 'me2_ui_runtime_directory_changed');
    } else {
      const fd = openSync(real, 'r');
      try {
        const before = fstatSync(fd, { bigint: true });
        assert.ok(before.isFile() && sameStat(targetStat, before), 'me2_ui_runtime_file_changed_before_read');
        const bytes = readFileSync(fd);
        const after = fstatSync(fd, { bigint: true });
        assert.ok(sameStat(before, after) && BigInt(bytes.length) === after.size, 'me2_ui_runtime_file_changed_during_read');
        row.size_bytes = bytes.length;
        row.sha256 = sha256(bytes);
        sizeBytes += bytes.length;
        assert.ok(Number.isSafeInteger(sizeBytes), 'me2_ui_runtime_size_invalid');
        entries.push(row);
      } finally { closeSync(fd); }
    }
    unchanged(record);
    observed.push(record);
  }
  walk(root, '.', new Set());
  // Also detect a previously read file being replaced while later files were
  // read. A readonly filesystem remains the stronger runtime write guard.
  for (const record of observed) unchanged(record);
  assert.equal(realpathSync(directory), root, 'me2_ui_runtime_root_changed');
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { runtime_hash_scheme: UI_RUNTIME_HASH_SCHEME, entries, size_bytes: sizeBytes, tree_sha256: sha256(JSON.stringify(entries)) };
}

// Pin the original in-memory snapshot before launching the owned child, then
// call during the probe and again after child exit. A fresh on-disk manifest
// must not be allowed to redefine the expected inventory after startup.
export function verifyUiRuntime(directory, expected) {
  assert.equal(expected?.runtime_hash_scheme, UI_RUNTIME_HASH_SCHEME, 'me2_ui_runtime_scheme_invalid');
  assert.ok(Array.isArray(expected.entries) && expected.entries.length > 0, 'me2_ui_runtime_inventory_missing');
  assert.equal(expected.tree_sha256, sha256(JSON.stringify(expected.entries)), 'me2_ui_runtime_expected_digest_invalid');
  const observed = inventoryUiRuntime(directory);
  assert.deepEqual(observed.entries, expected.entries, 'me2_ui_runtime_inventory_mismatch');
  assert.equal(observed.size_bytes, expected.size_bytes, 'me2_ui_runtime_size_mismatch');
  assert.equal(observed.tree_sha256, expected.tree_sha256, 'me2_ui_runtime_digest_mismatch');
  return observed;
}
