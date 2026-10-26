// Every executable-looking file and receipt in this suite is a synthetic,
// inert source fixture. No Windows installer or PostgreSQL process is run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {crc32, deflateRawSync} from 'node:zlib';
import test from 'node:test';
import {offlineRuntimePackageFixture, HEAD, VERSION} from './fixtures/offline-runtime-package.mjs';
import {captureForwardInventory, FORWARD_UNINSTALLER, FORWARD_SIDECAR_SCHEMA,
  FORWARD_SIDECAR_LIMITS, validateForwardSidecar} from '../scripts/qa-forward-candidate-sidecar.mjs';
import {compareQaInstalledImage} from '../scripts/qa-operator-install-recovery.mjs';
import {materializeForwardSidecar} from '../scripts/qa-forward-candidate-archive.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MANIFEST = 'forward-install-sidecar.json';
const imageName = name => 'win-unpacked/' + name;

// Small independent ZIP writer for boundary controls. Produces ordinary stored
// and deflated archives, ZIP64 records and streaming descriptors; overrides let
// tests corrupt individual facts while keeping the outer archive pin valid.
function zip(entries, {zip64 = false, zip64EndOnly = false, zip64CentralOnly = false, comment = Buffer.alloc(0)} = {}) {
  const centralZip64 = zip64 || zip64CentralOnly, endZip64 = centralZip64 || zip64EndOnly;
  const local = [], central = [], offsets = [];
  let position = 0;
  for (const row of entries) {
    const bytes = Buffer.from(row.bytes ?? ''), method = row.method ?? 0;
    const compressed = row.compressedBytes ?? (method === 8 ? deflateRawSync(bytes) : bytes);
    const name = Buffer.from(row.name), localName = Buffer.from(row.localName ?? row.name);
    const descriptor = row.descriptor ?? false, signed = row.signedDescriptor !== false;
    const flags = row.flags ?? (0x800 | (descriptor ? 8 : 0));
    const size = row.size ?? bytes.length, compressedSize = row.compressedSize ?? compressed.length;
    const crc = row.crc ?? crc32(bytes), mode = row.mode ?? (row.name.endsWith('/') ? 0o40755 : 0o100644);
    const extra = (values, suffix = Buffer.alloc(0), enabled = zip64) => {
      if (!enabled) return suffix;
      const field = Buffer.alloc(4 + values.length * 8);
      field.writeUInt16LE(1, 0); field.writeUInt16LE(values.length * 8, 2);
      values.forEach((value, index) => field.writeBigUInt64LE(BigInt(value), 4 + index * 8));
      return Buffer.concat([field, suffix]);
    };
    const localExtra = extra([descriptor ? 0 : size, descriptor ? 0 : compressedSize], row.localExtra);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(descriptor ? 0 : crc, 14);
    header.writeUInt32LE(zip64 ? 0xffffffff : (descriptor ? 0 : compressedSize), 18);
    header.writeUInt32LE(zip64 ? 0xffffffff : (descriptor ? 0 : size), 22);
    header.writeUInt16LE(localName.length, 26); header.writeUInt16LE(localExtra.length, 28);
    const tail = descriptor ? Buffer.alloc((zip64 ? 20 : 12) + (signed ? 4 : 0)) : Buffer.alloc(0);
    if (descriptor) {
      if (signed) tail.writeUInt32LE(0x08074b50, 0);
      const start = signed ? 4 : 0;
      tail.writeUInt32LE(crc, start);
      if (zip64) { tail.writeBigUInt64LE(BigInt(compressedSize), start + 4); tail.writeBigUInt64LE(BigInt(size), start + 12); }
      else { tail.writeUInt32LE(compressedSize, start + 4); tail.writeUInt32LE(size, start + 8); }
    }
    const centralExtra = extra([size, compressedSize, position], row.centralExtra, centralZip64);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE((3 << 8) | 45, 4); cd.writeUInt16LE(centralZip64 ? 45 : 20, 6);
    cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(centralZip64 ? 0xffffffff : compressedSize, 20); cd.writeUInt32LE(centralZip64 ? 0xffffffff : size, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(centralExtra.length, 30);
    cd.writeUInt32LE(row.attributes ?? ((mode << 16) >>> 0), 38);
    cd.writeUInt32LE(centralZip64 ? 0xffffffff : position, 42);
    offsets.push({local: position, data: position + header.length + localName.length + localExtra.length});
    local.push(header, localName, localExtra, compressed, tail);
    central.push(Buffer.concat([cd, name, centralExtra]));
    position += header.length + localName.length + localExtra.length + compressed.length + tail.length;
  }
  const centralOffset = position;
  for (let index = 0; index < central.length; index++) { offsets[index].central = position; position += central[index].length; }
  const centralSize = position - centralOffset, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(endZip64 ? 0xffff : entries.length, 8); end.writeUInt16LE(endZip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(endZip64 ? 0xffffffff : centralSize, 12); end.writeUInt32LE(endZip64 ? 0xffffffff : centralOffset, 16);
  end.writeUInt16LE(comment.length, 20);
  const zip64Records = [];
  if (endZip64) {
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(centralSize), 40); record.writeBigUInt64LE(BigInt(centralOffset), 48);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(position), 8); locator.writeUInt32LE(1, 16);
    zip64Records.push(record, locator); position += 76;
  }
  return {bytes: Buffer.concat([...local, ...central, ...zip64Records, end, comment]),
    offsets, centralOffset, eocdOffset: position};
}

async function fixture(t) {
  const f = await offlineRuntimePackageFixture(t), candidate = path.join(f.root, 'candidate');
  await fs.mkdir(path.join(candidate, 'resources'), {recursive: true});
  await f.copyBundle(path.join(candidate, 'resources/client-state-runtime'));
  await fs.writeFile(path.join(candidate, 'resources/app.asar'), 'synthetic inert ASAR');
  await fs.writeFile(path.join(candidate, 'METAENGINE Browser Test.exe'), 'synthetic inert Browser');
  await fs.writeFile(path.join(candidate, '.hidden-resource'), 'hidden fixture bytes');
  await fs.mkdir(path.join(candidate, 'empty-directory'));
  const installed = path.join(f.root, 'installed');
  await fs.cp(candidate, installed, {recursive: true});
  const uninstaller = 'synthetic inert NSIS-generated uninstaller';
  await fs.writeFile(path.join(installed, FORWARD_UNINSTALLER), uninstaller);
  const inventory = await captureForwardInventory(candidate);
  const runtime = await captureForwardInventory(path.join(candidate, 'resources/client-state-runtime'));
  const postgres = await captureForwardInventory(path.join(candidate, 'resources/client-state-runtime/runtime/postgresql'));
  const installerSha = digest('synthetic inert installer');
  const manifest = {schema: FORWARD_SIDECAR_SCHEMA, source_head: HEAD, package_version: VERSION,
    producer: {repository: 'PatrickFrome/Compute', workflow: '.github/workflows/browser-windows-package-smoke.yml',
      run_id: '434343', run_number: 3144, run_attempt: 1, event: 'push'},
    installer_artifact: {id: '101', name: 'metaengine-browser-windows-candidate-' + HEAD, sha256: 'e'.repeat(64)},
    installer: {name: `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`, sha256: installerSha},
    asar_sha256: digest('synthetic inert ASAR'),
    runtime: {bundle_sha256: f.manifest.bundle_sha256, tree_sha256: runtime.tree_sha256, postgres_tree_sha256: postgres.tree_sha256},
    image: {root: 'win-unpacked', ...inventory},
    uninstaller: {name: FORWARD_UNINSTALLER, sha256: digest(uninstaller),
      measurement: 'NSIS_GENERATED_AFTER_FRESH_INSTALL', installer_sha256: installerSha},
    installed_image: await compareQaInstalledImage(candidate, installed, {expectedUninstallerSha256: digest(uninstaller)})};
  validateForwardSidecar(manifest);
  const files = [];
  for (const row of inventory.files) if (row.length === 3)
    files.push({name: imageName(row[0]), bytes: await fs.readFile(path.join(candidate, row[0]))});
  const entries = [{name: MANIFEST, bytes: Buffer.from(JSON.stringify(manifest) + '\n')}, ...files];
  const archiveFile = path.join(f.root, 'sidecar.zip'), destination = path.join(f.root, 'materialized');
  const invoke = async (built, extra = {}) => {
    const bytes = Buffer.isBuffer(built) ? built : built.bytes;
    await fs.writeFile(archiveFile, bytes);
    return materializeForwardSidecar({archiveFile, archiveSha256: digest(bytes), destination, ...extra});
  };
  const reject = async (built, pattern, {preflight = true, ...extra} = {}) => {
    await assert.rejects(invoke(built, extra), pattern);
    if (preflight) await assert.rejects(fs.lstat(destination), {code: 'ENOENT'});
    await assert.rejects(fs.lstat(path.join(f.root, 'escaped')), {code: 'ENOENT'});
  };
  return {...f, candidate, manifest, entries, archiveFile, destination, invoke, reject};
}

test('stored file-only artifact restores vetted hidden files and empty directories without qualifying a producer', async t => {
  const f = await fixture(t), built = zip(f.entries);
  const result = await f.invoke(built, {expectedManifestSha256: digest(f.entries[0].bytes)});
  assert.deepEqual(result.manifest, f.manifest);
  assert.equal(result.archive_sha256, digest(built.bytes));
  assert.equal(result.manifest_sha256, digest(f.entries[0].bytes));
  assert.equal(result.tree_sha256, f.manifest.image.tree_sha256);
  assert.equal(result.producer_qualification_required, true);
  assert.equal(result.installer_contract_verification_required, true);
  assert.equal(result.production_authorized, false);
  assert.equal(result.authority_effect, false);
  assert.deepEqual(await fs.readdir(path.join(result.candidate_root, 'empty-directory')), []);
  assert.equal(await fs.readFile(path.join(result.candidate_root, '.hidden-resource'), 'utf8'), 'hidden fixture bytes');
  await assert.rejects(fs.lstat(path.join(result.candidate_root, FORWARD_UNINSTALLER)), {code: 'ENOENT'});
});

for (const [label, options, edit] of [
  ['deflate with signed stream descriptors', {}, entry => ({...entry, method: 8, descriptor: true})],
  ['deflate with unsigned stream descriptors', {}, entry => ({...entry, method: 8, descriptor: true, signedDescriptor: false})],
  ['ZIP64 stored entries and end records', {zip64: true}, entry => entry],
  ['ZIP64 deflate stream descriptors', {zip64: true}, entry => ({...entry, method: 8, descriptor: true})],
  ['ZIP64 unsigned stream descriptors', {zip64: true}, entry => ({...entry, method: 8, descriptor: true, signedDescriptor: false})],
  // compress-commons@6.0.2 forceZip64 affects the archive end, while streamed
  // local headers retain zero sizes and no ZIP64 extra. A later large offset
  // can upgrade only a central record to ZIP64. Source reviewed at:
  // https://github.com/archiverjs/node-compress-commons/blob/6.0.2/lib/archivers/zip/zip-archive-output-stream.js
  ['ZIP64 archive end with classic streaming files', {zip64EndOnly: true}, entry => ({...entry, descriptor: true})],
  ['ZIP64 central metadata with classic streaming local headers', {zip64CentralOnly: true}, entry => ({...entry, descriptor: true})],
]) test('materializes ' + label + ' with the same full inventory', async t => {
  const f = await fixture(t);
  const result = await f.invoke(zip(f.entries.map(edit), options));
  assert.equal(result.tree_sha256, f.manifest.image.tree_sha256);
});

test('explicit safe directory entries and EOCD comments preserve the same image', async t => {
  const f = await fixture(t), dirs = [{name: 'win-unpacked/'}, ...f.manifest.image.files.filter(row => row.length === 2).map(row => ({name: imageName(row[0]) + '/'}))];
  assert.equal((await f.invoke(zip([...dirs, ...f.entries], {comment: Buffer.from('synthetic fixture')}))).tree_sha256, f.manifest.image.tree_sha256);
});

test('optional predecessor dump is allowed only with an exact declared hash', async t => {
  const f = await fixture(t), bytes = Buffer.from('synthetic archive bytes, not a reviewed predecessor');
  f.manifest.schema_fixture = {file: 'predecessor-empty-schema.dump', sha256: digest(bytes), source_head: HEAD,
    kind: 'REVIEWED_OFFLINE_EMPTY_SCHEMA', source_data_rows: 0, synthetic_rpc_bodies: false};
  const entries = [{name: MANIFEST, bytes: JSON.stringify(f.manifest)}, ...f.entries.slice(1), {name: 'predecessor-empty-schema.dump', bytes}];
  const result = await f.invoke(zip(entries));
  assert.equal(result.producer_qualification_required, true, 'synthetic fixture declaration confers no qualification');
  assert.equal(digest(await fs.readFile(path.join(f.destination, 'predecessor-empty-schema.dump'))), digest(bytes));
});

for (const bad of ['../escaped', '/escaped', 'C:/escaped', 'C:escaped', '\\\\host\\share\\escaped',
  'win-unpacked/../escaped', 'win-unpacked\\..\\escaped', 'win-unpacked//escaped',
  'win-unpacked/a/./escaped', 'win-unpacked/file:stream', 'win-unpacked/CON', 'win-unpacked/NUL.txt',
  'win-unpacked/aux./escaped', 'win-unpacked/trailing.', 'win-unpacked/trailing ', 'win-unpacked/a\0b']) {
  test('rejects unsafe archive name ' + JSON.stringify(bad) + ' before writing', async t => {
    const f = await fixture(t);
    await f.reject(zip([...f.entries, {name: bad, bytes: 'escape'}]), /path_|zip_|inventory_/);
  });
}

for (const [label, mutate, pattern] of [
  ['duplicate file', entries => [...entries, entries[1]], /duplicate_or_case_collision/],
  ['case-colliding file', entries => [...entries, {...entries[1], name: entries[1].name.toUpperCase()}], /duplicate_or_case_collision|file_directory_alias/],
  ['case-colliding implicit parent', entries => [...entries, {name: 'win-unpacked/Resources/new', bytes: 'extra'}], /file_directory_alias/],
  ['file alias of directory', entries => [...entries, {name: 'win-unpacked/resources', bytes: 'alias'}], /file_directory_alias/],
  ['unknown extra file', entries => [...entries, {name: 'win-unpacked/unlisted', bytes: 'extra'}], /unlisted_entry/],
  ['unknown extra empty directory', entries => [...entries, {name: 'win-unpacked/unlisted/'}], /unlisted_entry/],
  ['undeclared predecessor dump', entries => [...entries, {name: 'predecessor-empty-schema.dump', bytes: 'fake'}], /unlisted_entry/],
  ['absent manifest', entries => entries.slice(1), /manifest_missing/],
  ['missing inventory file', entries => entries.slice(0, -1), /inventory_file_missing/],
  ['symlink mode', entries => entries.map((entry, i) => i === 1 ? {...entry, mode: 0o120777} : entry), /link_or_special/],
  ['socket mode', entries => entries.map((entry, i) => i === 1 ? {...entry, mode: 0o140600} : entry), /link_or_special/],
  ['Windows reparse attributes', entries => entries.map((entry, i) => i === 1 ? {...entry, attributes: 0x400} : entry), /link_or_special/],
  ['encrypted flag', entries => entries.map((entry, i) => i === 1 ? {...entry, flags: 0x801} : entry), /flags_unsupported/],
  ['unsupported compression', entries => entries.map((entry, i) => i === 1 ? {...entry, method: 9} : entry), /compression_or_flags_unsupported/],
  ['local versus central name', entries => entries.map((entry, i) => i === 1 ? {...entry, localName: '../escaped'} : entry), /local_name_mismatch/],
  ['Unicode alternate path extra', entries => entries.map((entry, i) => i === 1 ? {...entry, centralExtra: Buffer.from([0x75, 0x70, 0, 0])} : entry), /extra_unsupported/],
]) test('rejects ' + label + ' before materialization', async t => {
  const f = await fixture(t);
  await f.reject(zip(mutate(f.entries)), pattern);
});

for (const pair of [['S', 'ſ'], ['ς', 'σ']]) test('rejects Windows Unicode aliases ' + pair.join('/') + ' before writes', async t => {
  const f = await fixture(t);
  await f.reject(zip([...f.entries, ...pair.map(name => ({name: imageName(name), bytes: 'alias'}))]), /duplicate_or_case_collision/);
  await f.reject(zip([...f.entries, ...pair.map(name => ({name: imageName(name + '/child'), bytes: 'alias'}))]), /file_directory_alias|duplicate_or_case_collision/);
});

test('wrong archive and manifest pins refuse all writes', async t => {
  const f = await fixture(t), built = zip(f.entries);
  await f.reject(built, /archive_digest_mismatch/, {archiveSha256: '0'.repeat(64)});
  await f.reject(built, /manifest_digest_mismatch/, {expectedManifestSha256: '0'.repeat(64)});
});

test('manifest tampering is rejected even with a correct outer ZIP pin', async t => {
  const f = await fixture(t), manifest = structuredClone(f.manifest);
  manifest.installed_image.uninstaller_sha256 = '0'.repeat(64);
  await f.reject(zip([{name: MANIFEST, bytes: JSON.stringify(manifest)}, ...f.entries.slice(1)]), /installed_readback_invalid/);
});

for (const [label, mutate, pattern] of [
  ['payload SHA256 mismatch', entry => ({...entry, bytes: Buffer.alloc(entry.bytes.length, 88)}), /payload_digest_mismatch/],
  ['CRC mismatch', entry => ({...entry, crc: (crc32(entry.bytes) ^ 1) >>> 0}), /size_or_crc_mismatch/],
  ['actual expansion larger than header', entry => ({...entry, method: 8, compressedBytes: deflateRawSync(Buffer.alloc(100000, 0))}), /expanded_size_limit/],
  ['trailing deflate bytes', entry => ({...entry, method: 8, compressedBytes: Buffer.concat([deflateRawSync(entry.bytes), Buffer.from('trailing')])}), /deflate_trailing_bytes/],
]) test('rejects ' + label + ' without returning a usable receipt', async t => {
  const f = await fixture(t), entries = f.entries.map((entry, i) => i === 1 ? mutate(entry) : entry);
  await f.reject(zip(entries), pattern, {preflight: false});
  await assert.rejects(f.invoke(zip(f.entries)), /destination_exists/, 'partial attempt cannot be silently retried');
});

test('semantic runtime bundle substitution cannot hide behind valid image hashes', async t => {
  const f = await fixture(t), manifest = structuredClone(f.manifest);
  manifest.runtime.bundle_sha256 = '0'.repeat(64);
  await f.reject(zip([{name: MANIFEST, bytes: JSON.stringify(manifest)}, ...f.entries.slice(1)]), /offline_bundle_digest_mismatch/, {preflight: false});
});

test('reconstruction obeys tightened entry, file, total, manifest and depth ceilings', async t => {
  const f = await fixture(t), built = zip(f.entries);
  for (const limits of [{maxEntries: 1}, {maxFiles: 1}, {maxBytes: 1}, {maxFileBytes: 1}, {maxManifestBytes: 1}, {maxDepth: 1}])
    await f.reject(built, /limit|oversize/, {limits});
  await f.reject(built, /limits_may_only_tighten/, {limits: {maxBytes: FORWARD_SIDECAR_LIMITS.maxBytes + 1}});
});

test('ZIP64 expanded file sizes cannot exceed the production ceiling', async t => {
  const f = await fixture(t), entries = f.entries.map((entry, i) => i === 1 ? {...entry, size: FORWARD_SIDECAR_LIMITS.maxFileBytes + 1} : entry);
  await f.reject(zip(entries, {zip64: true}), /file_size_limit/);
});

test('extreme declared compression expansion is refused before output creation', async t => {
  const f = await fixture(t), entries = f.entries.map((entry, i) => i === 1 ? {...entry, method: 8,
    bytes: Buffer.alloc(2 * 1024 ** 2, 0)} : entry);
  await f.reject(zip(entries), /expansion_ratio_limit/);
});

for (const [label, mutate, pattern] of [
  ['trailing bytes', built => Buffer.concat([built.bytes, Buffer.from('extra')]), /zip_end_missing/],
  ['central count drift', built => {built.bytes.writeUInt16LE(1, built.eocdOffset + 8); built.bytes.writeUInt16LE(1, built.eocdOffset + 10); return built.bytes;}, /central_count_mismatch/],
  ['entry count overflow', built => {built.bytes.writeUInt16LE(50004, built.eocdOffset + 8); built.bytes.writeUInt16LE(50004, built.eocdOffset + 10); return built.bytes;}, /entry_count_limit/],
  ['multidisk archive', built => {built.bytes.writeUInt16LE(1, built.eocdOffset + 4); return built.bytes;}, /multidisk_forbidden/],
  ['local entry overlap', built => {built.bytes.writeUInt32LE(0, built.offsets[1].central + 42); return built.bytes;}, /local_overlap/],
  ['local CRC drift', built => {built.bytes.writeUInt32LE(123, built.offsets[1].local + 14); return built.bytes;}, /local_size_or_crc_mismatch/],
]) test('rejects malformed ZIP structure: ' + label, async t => {
  const f = await fixture(t);
  await f.reject(mutate(zip(f.entries)), pattern);
});

test('existing destination, symlinked ancestor and linked archive cannot be materialized', async t => {
  const f = await fixture(t), built = zip(f.entries);
  await fs.mkdir(f.destination);
  await assert.rejects(f.invoke(built), /destination_exists/);
  await fs.rmdir(f.destination);
  const external = path.join(f.root, 'external'); await fs.mkdir(external);
  const link = path.join(f.root, 'linked-parent');
  await fs.symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.invoke(built, {destination: path.join(link, 'escaped')}), /directory_alias_or_reparse/);
  assert.deepEqual(await fs.readdir(external), []);
  await fs.symlink(external, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.invoke(built), /destination_exists/);
  await fs.rm(f.destination);
  const hardlink = path.join(f.root, 'archive-alias.zip'); await fs.link(f.archiveFile, hardlink);
  await assert.rejects(materializeForwardSidecar({archiveFile: hardlink, archiveSha256: digest(built.bytes), destination: f.destination}), /archive_not_regular/);
});

test('archive byte ceiling is checked before reading contents', async t => {
  const f = await fixture(t), handle = await fs.open(f.archiveFile, 'wx');
  try { await handle.truncate(2049); } finally { await handle.close(); }
  await assert.rejects(materializeForwardSidecar({archiveFile: f.archiveFile, archiveSha256: '1'.repeat(64),
    destination: f.destination, limits: {maxArchiveBytes: 2048}}), /archive_size_limit/);
  await assert.rejects(fs.lstat(f.destination), {code: 'ENOENT'});
});
