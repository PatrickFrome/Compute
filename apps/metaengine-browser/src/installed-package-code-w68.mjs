// A byte inventory, NOT a trust root or a native loaded-image attestation.
// The W77 release signature binds these bytes; W68 checks the physical tree.
import crypto from 'node:crypto';
import nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Electron virtualizes ASAR through node:fs. This inventory needs the archive's
// physical bytes, not virtual members. Never toggle global process.noAsar and
// never fall back to patched fs when Electron's physical primitive is absent.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises : nodeFs;
if (!fs || typeof fs.open !== 'function') throw new Error('w68_package_code_physical_fs_unavailable');

export const PACKAGE_CODE_SCHEMA_W68 = 'metaengine.browser.installed-package-code.v1';
export const PACKAGE_CODE_FILE_W68 = 'metaengine-installed-package-code.v1.json';
export const RELEASE_FILES_W68 = Object.freeze({
  envelope: 'metaengine-installed-release-proof.v2.json',
  bundle: 'installer-slsa-provenance.bundle.json',
  evidence: 'browser-package-slsa-provenance-evidence.json',
  packageCode: PACKAGE_CODE_FILE_W68,
});
export const PACKAGE_CODE_MAX_MANIFEST_BYTES_W68 = 32 * 1024 * 1024;
const MAX_ENTRIES = 100_000, MAX_BYTES = 12 * 1024 ** 3, MAX_DEPTH = 48;
const fail = code => { throw new Error('w68_package_code_' + code); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).sort().join('\0') === [...keys].sort().join('\0');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonicalEqual = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const component = x => typeof x === 'string' && x.length > 0 && x !== '.' && x !== '..' &&
  !/[<>:"\\/|?*\x00-\x1f]/.test(x) && !/[. ]$/.test(x) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x);
const relative = x => typeof x === 'string' && x.length <= 2048 && x.split('/').every(component);
const sameStat = (a, b) => !a.isSymbolicLink() && !b.isSymbolicLink() &&
  a.isDirectory() === b.isDirectory() && a.isFile() === b.isFile() &&
  ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].every(k => a[k] === b[k]);

// Only detached proof files and the NSIS-generated uninstaller are outside
// the running-app closure. No directories, wildcard exclusions, user paths,
// resources, DLLs, workers, native modules or scripts can be exempted.
const excluded = name => Object.values(RELEASE_FILES_W68).includes(name) ||
  name === 'Uninstall METAENGINE Browser Test.exe';
const reservedNames = new Set([...Object.values(RELEASE_FILES_W68),
  'Uninstall METAENGINE Browser Test.exe'].map(name => name.toLowerCase()));
const reserved = name => reservedNames.has(name.toLowerCase());

async function physical(file, directory) {
  const info = await fs.lstat(file, { bigint: true });
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n) ||
      !canonicalEqual(await fs.realpath(file), file)) fail('nonphysical_path');
  return info;
}

async function checkAncestors(root) {
  for (let current = root;; current = path.dirname(current)) {
    await physical(current, true);
    if (current === path.dirname(current)) break;
  }
}

async function stableHash(file, before, buffer) {
  // Hash through a single descriptor and fence both descriptor and pathname.
  const handle = await fs.open(file, 'r');
  try {
    if (!sameStat(before, await handle.stat({ bigint: true }))) fail('open_toctou');
    const hash = crypto.createHash('sha256');
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > Number(before.size)) fail('read_toctou');
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (BigInt(size) !== before.size || !sameStat(before, await handle.stat({ bigint: true })) ||
        !sameStat(before, await physical(file, false))) fail('read_toctou');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

export function validatePackageCodeManifestW68(doc, { sourceSha, version, exeName } = {}) {
  if (!exact(doc, ['schema', 'source_sha', 'package_version', 'exe_name', 'entries']) ||
      doc.schema !== PACKAGE_CODE_SCHEMA_W68 || !/^[a-f0-9]{40}$/.test(doc.source_sha || '') ||
      !/^0\.7\.0-dev\.[1-9][0-9]*\.1$/.test(doc.package_version || '') ||
      !['METAENGINE Browser Test.exe', 'METAENGINE-Browser.exe'].includes(doc.exe_name) ||
      (sourceSha !== undefined && doc.source_sha !== sourceSha) ||
      (version !== undefined && doc.package_version !== version) ||
      (exeName !== undefined && doc.exe_name !== exeName) ||
      !Array.isArray(doc.entries) || doc.entries.length < 3 || doc.entries.length > MAX_ENTRIES) fail('manifest_schema');
  let previous = '', bytes = 0;
  const seen = new Map();
  for (const entry of doc.entries) {
    if (!object(entry) || !relative(entry.path) || compare(previous, entry.path) >= 0 ||
        reserved(entry.path) || entry.path.toLowerCase() === 'resources/app' ||
        entry.path.toLowerCase().startsWith('resources/app/') ||
        seen.has(entry.path.toLowerCase())) fail('manifest_path');
    previous = entry.path;
    const parent = path.posix.dirname(entry.path);
    if (parent !== '.' && seen.get(parent.toLowerCase()) !== 'directory') fail('manifest_parent');
    if (entry.kind === 'file') {
      if (!exact(entry, ['path', 'kind', 'size', 'sha256']) || !Number.isSafeInteger(entry.size) ||
          entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) fail('manifest_file');
      bytes += entry.size;
      if (bytes > MAX_BYTES) fail('byte_limit');
    } else if (entry.kind !== 'directory' || !exact(entry, ['path', 'kind'])) fail('manifest_entry');
    seen.set(entry.path.toLowerCase(), entry.kind);
  }
  // These entrypoints have exact canonical spellings, even on case-insensitive
  // filesystems. Never combine folded presence with an exact optional size test.
  const exe = doc.entries.find(e => e.path === doc.exe_name);
  const resources = doc.entries.find(e => e.path === 'resources');
  const asar = doc.entries.find(e => e.path === 'resources/app.asar');
  if (exe?.kind !== 'file' || exe.size < 1 || resources?.kind !== 'directory' ||
      asar?.kind !== 'file' || asar.size < 1) fail('required_code_missing');
  return doc;
}

export function serializePackageCodeManifestW68(doc) {
  validatePackageCodeManifestW68(doc);
  // Explicit order, independent of the caller's object insertion order.
  const bytes = Buffer.from(JSON.stringify({ schema: doc.schema, source_sha: doc.source_sha,
    package_version: doc.package_version, exe_name: doc.exe_name,
    entries: doc.entries.map(e => e.kind === 'file'
      ? { path: e.path, kind: e.kind, size: e.size, sha256: e.sha256 }
      : { path: e.path, kind: e.kind }) }) + '\n');
  if (bytes.length > PACKAGE_CODE_MAX_MANIFEST_BYTES_W68) fail('manifest_byte_limit');
  return bytes;
}

export async function capturePackageCodeW68(root, { sourceSha, version, exeName, installed = false } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root ||
      root.startsWith('\\\\') || root.includes('\0')) fail('root_path');
  await checkAncestors(root);
  const entries = [], snapshots = new Map(), folded = new Set();
  const readBuffer = Buffer.allocUnsafe(1024 * 1024);
  let totalBytes = 0;
  async function visit(dir, prefix, depth) {
    if (depth > MAX_DEPTH) fail('depth_limit');
    const before = await physical(dir, true);
    snapshots.set(dir, before);
    for (const name of (await fs.readdir(dir)).sort(compare)) {
      if (!component(name)) fail('filename');
      const rel = prefix ? prefix + '/' + name : name;
      if (folded.has(rel.toLowerCase())) fail('case_alias');
      folded.add(rel.toLowerCase());
      if (folded.size > MAX_ENTRIES) fail('entry_limit');
      const file = path.join(dir, name);
      const raw = await fs.lstat(file, { bigint: true });
      const info = await physical(file, raw.isDirectory());
      snapshots.set(file, info);
      if (!prefix && reserved(name)) {
        if (!installed || !excluded(name) || !info.isFile()) fail('reserved_package_entry');
        continue;
      }
      if (info.isDirectory()) {
        entries.push({ path: rel, kind: 'directory' });
        await visit(file, rel, depth + 1);
      } else {
        const size = Number(info.size);
        if (!Number.isSafeInteger(size) || size < 0 || (totalBytes += size) > MAX_BYTES) fail('byte_limit');
        entries.push({ path: rel, kind: 'file', size, sha256: await stableHash(file, info, readBuffer) });
      }
    }
    if (!sameStat(before, await physical(dir, true))) fail('directory_toctou');
  }
  await visit(root, '', 0);
  const manifest = { schema: PACKAGE_CODE_SCHEMA_W68, source_sha: sourceSha,
    package_version: version, exe_name: exeName, entries: entries.sort((a, b) => compare(a.path, b.path)) };
  const bytes = serializePackageCodeManifestW68(manifest);
  const fence = async () => {
    await checkAncestors(root);
    for (const [file, before] of snapshots) {
      if (!sameStat(before, await physical(file, before.isDirectory()))) fail('tree_toctou');
    }
  };
  await fence();
  return { manifest, bytes, sha256: sha(bytes), fileCount: entries.filter(e => e.kind === 'file').length,
    totalBytes, fence };
}

export async function verifyPackageCodeW68(root, bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length > PACKAGE_CODE_MAX_MANIFEST_BYTES_W68) fail('manifest_bytes');
  const doc = validatePackageCodeManifestW68(JSON.parse(bytes.toString('utf8')), expected);
  if (!serializePackageCodeManifestW68(doc).equals(bytes)) fail('noncanonical_manifest');
  const observed = await capturePackageCodeW68(root, { ...expected, installed: true });
  if (!observed.bytes.equals(bytes)) fail('tree_mismatch');
  return observed;
}
