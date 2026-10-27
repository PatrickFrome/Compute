import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const UI_CONTENT_HASH_SCHEME = 'path-file-sha256-v1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Both packaging and installed verification hash the actual file bytes. The
// root manifest is excluded to avoid a self-referential digest. A manifest is
// still evidence, not a signature or permission to execute its contents.
export function inventoryUiContent(directory) {
  const root = realpathSync(directory);
  const files = [];
  const names = new Set();
  let sizeBytes = 0;
  function inside(file) {
    const real = realpathSync(file);
    const relative = path.relative(root, real);
    assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), 'me2_ui_content_outside_bundle');
    return real;
  }
  function walk(directory, prefix, ancestors) {
    const realDirectory = inside(directory);
    assert.ok(!ancestors.has(realDirectory), 'me2_ui_content_directory_cycle');
    const next = new Set(ancestors).add(realDirectory);
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (relative === 'me2-ui-manifest.json') continue;
      assert.ok(!name.includes('\\') && !name.includes(':') && !/[\x00-\x1f\x7f]/.test(name), 'me2_ui_content_path_invalid');
      const key = relative.toLowerCase();
      assert.ok(!names.has(key), 'me2_ui_content_case_collision');
      names.add(key);
      const absolute = path.join(directory, name);
      const resolved = inside(absolute);
      const stat = statSync(resolved);
      if (stat.isDirectory()) { walk(absolute, relative, next); continue; }
      assert.ok(stat.isFile(), 'me2_ui_content_not_regular_file');
      const fd = openSync(resolved, 'r');
      let bytes;
      try {
        const before = fstatSync(fd, { bigint: true });
        assert.ok(before.isFile(), 'me2_ui_content_not_regular_file');
        bytes = readFileSync(fd);
        const after = fstatSync(fd, { bigint: true });
        assert.ok(before.dev === after.dev && before.ino === after.ino && before.size === after.size
          && before.mtimeNs === after.mtimeNs && BigInt(bytes.length) === after.size, 'me2_ui_content_changed_during_read');
        assert.equal(inside(absolute), resolved, 'me2_ui_content_path_changed');
      } finally { closeSync(fd); }
      files.push({ path: relative, size_bytes: bytes.length, sha256: sha256(bytes) });
      sizeBytes += bytes.length;
      assert.ok(Number.isSafeInteger(sizeBytes), 'me2_ui_content_size_invalid');
    }
  }
  walk(root, '', new Set());
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { content_hash_scheme: UI_CONTENT_HASH_SCHEME, content_files: files,
    size_bytes: sizeBytes, content_sha256: sha256(JSON.stringify(files)) };
}

export function validateUiContentManifest(manifest) {
  assert.equal(manifest.content_hash_scheme, UI_CONTENT_HASH_SCHEME, 'me2_ui_content_scheme_invalid');
  assert.ok(Array.isArray(manifest.content_files) && manifest.content_files.length > 0, 'me2_ui_content_inventory_missing');
  assert.match(manifest.content_sha256 || '', /^[0-9a-f]{64}$/, 'me2_ui_content_digest_invalid');
  let previous = '';
  let sizeBytes = 0;
  const names = new Set();
  for (const row of manifest.content_files) {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'me2_ui_content_row_invalid');
    assert.deepEqual(Object.keys(row).sort(), ['path', 'sha256', 'size_bytes'], 'me2_ui_content_row_fields_invalid');
    assert.ok(typeof row.path === 'string' && row.path.length > 0 && row.path !== 'me2-ui-manifest.json'
      && !/[\\\x00-\x1f\x7f]/.test(row.path) && !row.path.split('/').some(part => !part || part === '.' || part === '..')
      && !row.path.includes(':'), 'me2_ui_content_path_invalid');
    assert.ok(row.path > previous && !names.has(row.path.toLowerCase()), 'me2_ui_content_order_or_duplicate_invalid');
    previous = row.path; names.add(row.path.toLowerCase());
    assert.ok(Number.isSafeInteger(row.size_bytes) && row.size_bytes >= 0, 'me2_ui_content_file_size_invalid');
    assert.match(row.sha256 || '', /^[0-9a-f]{64}$/, 'me2_ui_content_file_digest_invalid');
    sizeBytes += row.size_bytes;
    assert.ok(Number.isSafeInteger(sizeBytes), 'me2_ui_content_size_invalid');
  }
  assert.equal(manifest.size_bytes, sizeBytes, 'me2_ui_content_size_mismatch');
  assert.equal(manifest.content_sha256, sha256(JSON.stringify(manifest.content_files)), 'me2_ui_content_digest_mismatch');
}

export function verifyUiContent(directory, manifest) {
  validateUiContentManifest(manifest);
  const observed = inventoryUiContent(directory);
  assert.deepEqual(manifest.content_files, observed.content_files, 'me2_ui_content_inventory_mismatch');
  assert.equal(manifest.size_bytes, observed.size_bytes, 'me2_ui_content_size_mismatch');
  assert.equal(manifest.content_sha256, observed.content_sha256, 'me2_ui_content_digest_mismatch');
  return observed;
}
