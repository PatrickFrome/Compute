// Materialize a pinned forward-install sidecar on a disposable consumer only.
// This is a byte/inventory check, not installer or producer qualification. The
// caller must separately verify the original terminal-success producer and the
// existing installer provenance contract before using these files.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createInflateRaw, crc32} from 'node:zlib';
import {verifyOfflineRuntimeBundle} from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import {
  FORWARD_SIDECAR_LIMITS, validateForwardRelativePath, validateForwardSidecar,
  captureForwardInventory, hashForwardFile, forwardPathCollisionKey,
} from './qa-forward-candidate-sidecar.mjs';

const MANIFEST = 'forward-install-sidecar.json';
const IMAGE = 'win-unpacked';
const SHA = /^[a-f0-9]{64}$/;
const CHUNK = 256 * 1024;
const MAX_CENTRAL_BYTES = 64 * 1024 ** 2;
const MAX_RATIO = 1000;
const fail = code => { throw new Error('qa_forward_archive_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equalIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const equalFile = (a, b) => equalIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs
  && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
const decoder = new TextDecoder('utf-8', {fatal: true});

function boundedLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('limits_invalid');
  const result = {...FORWARD_SIDECAR_LIMITS};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(result, key) || !Number.isSafeInteger(value) || value < 1 || value > result[key])
      fail('limits_may_only_tighten');
    result[key] = value;
  }
  return result;
}
function localAbsolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\') || value.includes('\0'))
    fail('absolute_local_path_required');
  return path.resolve(value);
}
async function directoryInfo(file) {
  const info = await fs.lstat(file, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n) fail('directory_alias_or_reparse');
  return info;
}
async function pinAncestors(directory) {
  const pins = new Map();
  let current = localAbsolute(directory);
  for (;;) {
    pins.set(current, await directoryInfo(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const real = await fs.realpath(directory);
  if (!equalIdentity(pins.get(path.resolve(directory)), await directoryInfo(real))) fail('directory_identity_drift');
  return pins;
}
async function checkPins(pins, from) {
  if (from) {
    let current = from;
    for (;;) {
      const pin = pins.get(current);
      if (!pin || !equalIdentity(pin, await directoryInfo(current))) fail('directory_identity_drift');
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } else {
    for (const [file, pin] of pins)
      if (!equalIdentity(pin, await directoryInfo(file))) fail('directory_identity_drift');
  }
}
async function readAt(handle, offset, size, limit) {
  if (![offset, size].every(Number.isSafeInteger) || offset < 0 || size < 0 || offset + size > limit)
    fail('zip_range_invalid');
  const buffer = Buffer.allocUnsafe(size);
  let done = 0;
  while (done < size) {
    const {bytesRead} = await handle.read(buffer, done, size - done, offset + done);
    if (!bytesRead) fail('zip_truncated');
    done += bytesRead;
  }
  return buffer;
}
async function* readChunks(handle, offset, size, limit) {
  for (let position = 0; position < size; position += CHUNK)
    yield await readAt(handle, offset + position, Math.min(CHUNK, size - position), limit);
}
async function digestHandle(handle, size) {
  const digest = createHash('sha256');
  for await (const chunk of readChunks(handle, 0, size, size)) digest.update(chunk);
  return digest.digest('hex');
}
function u64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('zip64_integer_limit');
  return Number(value);
}
function extras(buffer) {
  const found = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) fail('zip_extra_truncated');
    const id = buffer.readUInt16LE(offset), size = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > buffer.length || found.has(id)) fail('zip_extra_ambiguous');
    // ZIP64 and timestamp/UID metadata do not supply alternate file names or
    // links. In particular Unicode-path and ASi Unix link fields are refused.
    if (![0x0001, 0x000a, 0x5455, 0x7875].includes(id)) fail('zip_extra_unsupported');
    found.set(id, buffer.subarray(offset, offset + size));
    offset += size;
  }
  return found;
}
function expandedSizes(raw, extra, local = false) {
  const zip64 = extra.get(1);
  let cursor = 0;
  const result = {...raw};
  for (const key of ['size', 'compressed', ...(local ? [] : ['offset', 'disk'])]) {
    const sentinel = key === 'disk' ? 0xffff : 0xffffffff;
    if (raw[key] !== sentinel) continue;
    const width = key === 'disk' ? 4 : 8;
    if (!zip64 || cursor + width > zip64.length) fail('zip64_extra_missing');
    result[key] = width === 4 ? zip64.readUInt32LE(cursor) : u64(zip64, cursor);
    cursor += width;
  }
  if (zip64 && cursor !== zip64.length) fail('zip64_extra_ambiguous');
  return result;
}
function decodedName(bytes, flags) {
  if (!(flags & 0x800) && bytes.some(byte => byte > 0x7f)) fail('zip_legacy_encoding_forbidden');
  try { return decoder.decode(bytes); } catch { fail('zip_filename_utf8_invalid'); }
}
function safeZipName(raw, limits) {
  const directory = raw.endsWith('/');
  const name = directory ? raw.slice(0, -1) : raw;
  // Prefix is the sole extra level outside the existing candidate inventory.
  const relative = name.startsWith(IMAGE + '/') ? name.slice(IMAGE.length + 1) : name;
  validateForwardRelativePath(relative);
  if (relative.split('/').length > limits.maxDepth) fail('zip_depth_limit');
  return {name, directory};
}
function compression(flags, method) {
  if ((flags & ~0x080e) || ![0, 8].includes(method) || (method === 0 && (flags & 6)))
    fail('zip_compression_or_flags_unsupported');
}

async function directoryRecord(handle, size, limits) {
  if (size < 22) fail('zip_end_missing');
  const tailStart = Math.max(0, size - 65557);
  const tail = await readAt(handle, tailStart, size - tailStart, size);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
  if (end < 0) fail('zip_end_missing');
  const endOffset = tailStart + end;
  const eocd = tail.subarray(end, end + 22);
  if (eocd.readUInt16LE(4) || eocd.readUInt16LE(6)) fail('zip_multidisk_forbidden');
  const raw = {count: eocd.readUInt16LE(10), diskCount: eocd.readUInt16LE(8),
    bytes: eocd.readUInt32LE(12), offset: eocd.readUInt32LE(16)};
  let record = {...raw, end: endOffset};
  const locator = endOffset >= 20 ? await readAt(handle, endOffset - 20, 20, size) : null;
  if (locator?.readUInt32LE(0) === 0x07064b50) {
    if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) fail('zip_multidisk_forbidden');
    const location = u64(locator, 8), fixed = await readAt(handle, location, 56, size);
    if (fixed.readUInt32LE(0) !== 0x06064b50) fail('zip64_end_invalid');
    const bodyLength = u64(fixed, 4);
    if (bodyLength !== 44 || location + 12 + bodyLength !== endOffset - 20
      || fixed.readUInt16LE(14) > 45 || fixed.readUInt32LE(16) || fixed.readUInt32LE(20)) fail('zip64_end_invalid');
    record = {count: u64(fixed, 32), diskCount: u64(fixed, 24), bytes: u64(fixed, 40), offset: u64(fixed, 48), end: location};
    for (const key of ['count', 'diskCount', 'bytes', 'offset']) {
      const sentinel = ['count', 'diskCount'].includes(key) ? 0xffff : 0xffffffff;
      if (raw[key] !== sentinel && raw[key] !== record[key]) fail('zip64_end_mismatch');
    }
  } else if (raw.count === 0xffff || raw.diskCount === 0xffff || raw.bytes === 0xffffffff || raw.offset === 0xffffffff) {
    fail('zip64_locator_missing');
  }
  if (!record.count || record.count !== record.diskCount || record.count > limits.maxEntries + 3)
    fail('zip_entry_count_limit');
  if (record.bytes > MAX_CENTRAL_BYTES || record.offset + record.bytes !== record.end)
    fail('zip_central_range_invalid');
  return record;
}

async function parseEntries(handle, archiveSize, limits) {
  const central = await directoryRecord(handle, archiveSize, limits);
  const entries = [], names = new Set(), prefixes = new Map();
  let offset = central.offset, totalBytes = 0, fileCount = 0;
  for (let index = 0; index < central.count; index++) {
    if (offset + 46 > central.end) fail('zip_central_truncated');
    const fixed = await readAt(handle, offset, 46, archiveSize);
    if (fixed.readUInt32LE(0) !== 0x02014b50) fail('zip_central_signature_invalid');
    const version = fixed.readUInt16LE(6), flags = fixed.readUInt16LE(8), method = fixed.readUInt16LE(10);
    compression(flags, method);
    if (![10, 20, 45].includes(version)) fail('zip_version_unsupported');
    const nameLength = fixed.readUInt16LE(28), extraLength = fixed.readUInt16LE(30), commentLength = fixed.readUInt16LE(32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || end > central.end) fail('zip_central_truncated');
    const variable = await readAt(handle, offset + 46, nameLength + extraLength, archiveSize);
    const nameBytes = variable.subarray(0, nameLength);
    const {name, directory} = safeZipName(decodedName(nameBytes, flags), limits);
    const sizes = expandedSizes({size: fixed.readUInt32LE(24), compressed: fixed.readUInt32LE(20),
      offset: fixed.readUInt32LE(42), disk: fixed.readUInt16LE(34)}, extras(variable.subarray(nameLength)));
    if (sizes.disk !== 0) fail('zip_multidisk_forbidden');
    const attributes = fixed.readUInt32LE(38), mode = attributes >>> 16, type = mode & 0xf000;
    if (![0, 0x4000, 0x8000].includes(type) || (attributes & 0xffff & ~0x00b7)) fail('zip_link_or_special_entry');
    if ((type === 0x4000 || (attributes & 0x10)) && !directory) fail('zip_file_directory_alias');
    if (directory && (type === 0x8000 || sizes.size || sizes.compressed || method !== 0 || fixed.readUInt32LE(16)))
      fail('zip_directory_payload_forbidden');
    if (names.has(forwardPathCollisionKey(name))) fail('zip_duplicate_or_case_collision');
    names.add(forwardPathCollisionKey(name));
    const parts = name.split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/'), key = forwardPathCollisionKey(prefix);
      const kind = depth === parts.length && !directory ? 'file' : 'directory';
      const prior = prefixes.get(key);
      if (prior && (prior.name !== prefix || prior.kind !== kind)) fail('zip_file_directory_alias');
      prefixes.set(key, {name: prefix, kind});
    }
    const fileLimit = name === MANIFEST ? limits.maxManifestBytes : limits.maxFileBytes;
    if (sizes.size > fileLimit || sizes.compressed > limits.maxArchiveBytes) fail('zip_file_size_limit');
    if (sizes.size > Math.max(sizes.compressed, 1) * MAX_RATIO) fail('zip_expansion_ratio_limit');
    if (method === 0 && sizes.size !== sizes.compressed) fail('zip_stored_size_mismatch');
    totalBytes += sizes.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxBytes + limits.maxManifestBytes)
      fail('zip_total_size_limit');
    if (!directory && ++fileCount > limits.maxFiles + 2) fail('zip_file_count_limit');
    entries.push({name, nameBytes: Buffer.from(nameBytes), directory, version, flags, method,
      crc: fixed.readUInt32LE(16), size: sizes.size, compressed: sizes.compressed, offset: sizes.offset});
    offset = end;
  }
  if (offset !== central.end) fail('zip_central_count_mismatch');
  entries.sort((a, b) => a.offset - b.offset);
  if (entries[0].offset !== 0) fail('zip_preamble_forbidden');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], next = entries[index + 1]?.offset ?? central.offset;
    if (entry.offset + 30 > next) fail('zip_local_overlap');
    const fixed = await readAt(handle, entry.offset, 30, archiveSize);
    if (fixed.readUInt32LE(0) !== 0x04034b50 || fixed.readUInt16LE(6) !== entry.flags
      || fixed.readUInt16LE(8) !== entry.method || ![10, 20, 45].includes(fixed.readUInt16LE(4))
      || fixed.readUInt16LE(4) > entry.version) fail('zip_local_header_mismatch');
    const nameLength = fixed.readUInt16LE(26), extraLength = fixed.readUInt16LE(28);
    entry.dataOffset = entry.offset + 30 + nameLength + extraLength;
    if (entry.dataOffset + entry.compressed > next) fail('zip_local_overlap');
    const variable = await readAt(handle, entry.offset + 30, nameLength + extraLength, archiveSize);
    if (!variable.subarray(0, nameLength).equals(entry.nameBytes)) fail('zip_local_name_mismatch');
    const sizes = expandedSizes({size: fixed.readUInt32LE(22), compressed: fixed.readUInt32LE(18)}, extras(variable.subarray(nameLength)), true);
    const crc = fixed.readUInt32LE(14), descriptor = Boolean(entry.flags & 8);
    if (!descriptor && (crc !== entry.crc || sizes.size !== entry.size || sizes.compressed !== entry.compressed))
      fail('zip_local_size_or_crc_mismatch');
    if (descriptor && ((crc && crc !== entry.crc) || (sizes.size && sizes.size !== entry.size)
      || (sizes.compressed && sizes.compressed !== entry.compressed))) fail('zip_local_size_or_crc_mismatch');
    const dataEnd = entry.dataOffset + entry.compressed;
    if (!descriptor) {
      if (dataEnd !== next) fail('zip_unlisted_local_bytes');
    } else {
      const length = next - dataEnd;
      if (![12, 16, 20, 24].includes(length)) fail('zip_descriptor_invalid');
      const bytes = await readAt(handle, dataEnd, length, archiveSize);
      const signed = [16, 24].includes(length), zip64 = [20, 24].includes(length);
      if (signed && bytes.readUInt32LE(0) !== 0x08074b50) fail('zip_descriptor_invalid');
      const start = signed ? 4 : 0;
      const compressed = zip64 ? u64(bytes, start + 4) : bytes.readUInt32LE(start + 4);
      const size = zip64 ? u64(bytes, start + 12) : bytes.readUInt32LE(start + 8);
      if (bytes.readUInt32LE(start) !== entry.crc || compressed !== entry.compressed || size !== entry.size)
        fail('zip_descriptor_mismatch');
    }
  }
  return entries;
}

async function consumeEntry(handle, entry, archiveSize, consume) {
  const input = Readable.from(readChunks(handle, entry.dataOffset, entry.compressed, archiveSize));
  const inflater = entry.method === 8 ? createInflateRaw({chunkSize: 64 * 1024}) : null;
  const stream = inflater ? input.pipe(inflater) : input;
  const forwardError = error => inflater?.destroy(error);
  input.on('error', forwardError);
  let size = 0, crc = 0;
  const digest = createHash('sha256');
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (!Number.isSafeInteger(size) || size > entry.size) fail('zip_expanded_size_limit');
      crc = crc32(chunk, crc); digest.update(chunk);
      await consume(chunk);
    }
    if (size !== entry.size || crc !== entry.crc) fail('zip_size_or_crc_mismatch');
    if (inflater && inflater.bytesWritten !== entry.compressed) fail('zip_deflate_trailing_bytes');
    return digest.digest('hex');
  } finally {
    input.destroy(); inflater?.destroy();
    input.removeListener('error', forwardError);
  }
}
async function manifestFromArchive(handle, entries, size, limits, expectedDigest) {
  const entry = entries.find(item => item.name === MANIFEST && !item.directory);
  if (!entry || entry.size > limits.maxManifestBytes) fail('manifest_missing_or_oversize');
  const chunks = [];
  const manifestDigest = await consumeEntry(handle, entry, size, async chunk => { chunks.push(Buffer.from(chunk)); });
  if (expectedDigest !== undefined && (!SHA.test(expectedDigest) || manifestDigest !== expectedDigest)) fail('manifest_digest_mismatch');
  const bytes = Buffer.concat(chunks);
  let manifest;
  try { manifest = JSON.parse(decoder.decode(bytes)); } catch { fail('manifest_json_invalid'); }
  validateForwardSidecar(manifest);
  if (manifest.image.files.length > limits.maxEntries) fail('inventory_entry_count_limit');
  const expected = new Map([[MANIFEST, {size: bytes.length, sha256: manifestDigest}], [IMAGE, {directory: true}]]);
  let total = 0, files = 0;
  for (const row of manifest.image.files) {
    const directory = row.length === 2;
    if (row[0].split('/').length > limits.maxDepth) fail('inventory_depth_limit');
    expected.set(IMAGE + '/' + row[0], directory ? {directory: true} : {size: row[1], sha256: row[2]});
    if (!directory) {
      if (row[1] > limits.maxFileBytes || ++files > limits.maxFiles) fail('inventory_file_limit');
      total += row[1];
    }
  }
  if (total > limits.maxBytes) fail('inventory_total_size_limit');
  if (manifest.schema_fixture) expected.set(manifest.schema_fixture.file, {sha256: manifest.schema_fixture.sha256});
  for (const entry of entries) {
    const wanted = expected.get(entry.name);
    if (!wanted || Boolean(wanted.directory) !== entry.directory) fail('zip_unlisted_entry');
    if (!entry.directory && wanted.size !== undefined && entry.size !== wanted.size) fail('zip_inventory_size_mismatch');
  }
  const present = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name));
  for (const [name, row] of expected) if (!row.directory && !present.has(name)) fail('zip_inventory_file_missing');
  return {manifest, manifestDigest, expected};
}

/**
 * Only materializes bytes into a new absent directory. Missing/failed producers
 * are never promoted by this receipt; validateForwardSidecarBinding is required
 * separately, as is the unchanged strict installer verifier. A partial failed
 * destination is intentionally not retried, deleted or treated as a receipt.
 */
export async function materializeForwardSidecar({archiveFile, archiveSha256, destination,
  expectedManifestSha256, limits: overrides} = {}) {
  if (!SHA.test(archiveSha256 || '')) fail('archive_digest_required');
  const limits = boundedLimits(overrides), archive = localAbsolute(archiveFile), target = localAbsolute(destination);
  const archiveParents = await pinAncestors(path.dirname(archive));
  const destinationPins = await pinAncestors(path.dirname(target));
  try { await fs.lstat(target); fail('destination_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const before = await fs.lstat(archive, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail('archive_not_regular');
  if (before.size > BigInt(limits.maxArchiveBytes) || before.size < 22n) fail('archive_size_limit');
  const size = Number(before.size), handle = await fs.open(archive, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const assertArchive = async () => {
    await checkPins(archiveParents);
    const [descriptor, named] = await Promise.all([handle.stat({bigint: true}), fs.lstat(archive, {bigint: true})]);
    if (!descriptor.isFile() || !named.isFile() || named.isSymbolicLink() || !equalFile(before, descriptor)
      || !equalFile(before, named) || named.nlink !== 1n) fail('archive_changed');
  };
  try {
    await assertArchive();
    if (await digestHandle(handle, size) !== archiveSha256) fail('archive_digest_mismatch');
    const entries = await parseEntries(handle, size, limits);
    const {manifest, manifestDigest, expected} = await manifestFromArchive(handle, entries, size, limits, expectedManifestSha256);
    await assertArchive(); await checkPins(destinationPins);
    await fs.mkdir(target, {mode: 0o700});
    destinationPins.set(target, await directoryInfo(target));
    const directories = [...expected].filter(([, value]) => value.directory).map(([name]) => name)
      .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));
    for (const relative of directories) {
      const file = path.join(target, ...relative.split('/'));
      await checkPins(destinationPins, path.dirname(file));
      await fs.mkdir(file, {mode: 0o700});
      destinationPins.set(file, await directoryInfo(file));
    }
    for (const entry of entries) {
      if (entry.directory) continue;
      const file = path.join(target, ...entry.name.split('/'));
      await checkPins(destinationPins, path.dirname(file));
      const output = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      try {
        const opened = await output.stat({bigint: true});
        if (!opened.isFile() || opened.nlink !== 1n) fail('destination_not_regular');
        const actualHash = await consumeEntry(handle, entry, size, async chunk => {
          let offset = 0;
          while (offset < chunk.length) {
            const {bytesWritten} = await output.write(chunk, offset, chunk.length - offset);
            if (!bytesWritten) fail('file_write_incomplete');
            offset += bytesWritten;
          }
        });
        if (actualHash !== expected.get(entry.name).sha256) fail('payload_digest_mismatch');
        await output.sync();
        const named = await fs.lstat(file, {bigint: true});
        if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || !equalIdentity(opened, named)
          || Number(named.size) !== entry.size) fail('destination_file_changed');
      } finally { await output.close(); }
      await checkPins(destinationPins, path.dirname(file));
    }
    const candidateRoot = path.join(target, IMAGE);
    const captured = await captureForwardInventory(candidateRoot, {limits});
    if (captured.tree_sha256 !== manifest.image.tree_sha256 || JSON.stringify(captured.files) !== JSON.stringify(manifest.image.files))
      fail('materialized_inventory_mismatch');
    await verifyOfflineRuntimeBundle({bundleDirectory: path.join(candidateRoot, 'resources', 'client-state-runtime'),
      expectedBundleDigest: manifest.runtime.bundle_sha256});
    const rootFiles = (await fs.readdir(target)).sort();
    const allowedRoots = [MANIFEST, IMAGE, ...(manifest.schema_fixture ? [manifest.schema_fixture.file] : [])].sort();
    if (JSON.stringify(rootFiles) !== JSON.stringify(allowedRoots)) fail('materialized_root_changed');
    if (await hashForwardFile(path.join(target, MANIFEST), {maxBytes: limits.maxManifestBytes}) !== manifestDigest)
      fail('materialized_manifest_changed');
    if (manifest.schema_fixture && await hashForwardFile(path.join(target, manifest.schema_fixture.file), {maxBytes: limits.maxFileBytes})
      !== manifest.schema_fixture.sha256) fail('materialized_schema_fixture_changed');
    await assertArchive();
    if (await digestHandle(handle, size) !== archiveSha256) fail('archive_digest_changed');
    await assertArchive(); await checkPins(destinationPins);
    return Object.freeze({schema: 'metaengine.browser.forward-sidecar-materialization.v1',
      manifest, manifest_sha256: manifestDigest, candidate_root: candidateRoot,
      archive_sha256: archiveSha256, tree_sha256: captured.tree_sha256,
      full_tree_verified: true, producer_qualification_required: true,
      installer_contract_verification_required: true, production_authorized: false, authority_effect: false});
  } finally { await handle.close(); }
}
