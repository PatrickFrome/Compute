// Build-only extraction of byte-pinned private tool archives. This never runs
// extracted code, qualifies a vendor signature or changes global tool paths.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createInflateRaw, crc32} from 'node:zlib';

const LIMITS = Object.freeze({maxFiles: 50000, maxEntries: 50000,
  maxBytes: 2 * 1024 ** 3, maxDepth: 40, maxFileBytes: 512 * 1024 ** 2,
  maxArchiveBytes: 512 * 1024 ** 2});
function validateName(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 1024
    || name !== name.normalize('NFC') || /[\uD800-\uDFFF\p{Cc}\p{Cf}]/u.test(name)
    || /[\\\x00-\x1f\x7f<>:"|?*]/.test(name)) fail('path_invalid');
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)
      || Buffer.byteLength(part) > 255
      || /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:[ .]|$)/i.test(part)
      || /^[^.]{1,6}~[1-9][0-9]*(?:\.|$)/i.test(part)) fail('path_invalid');
  }
}
const collisionKey = name => name.toUpperCase().normalize('NFC');
const SHA = /^[a-f0-9]{64}$/;
const CHUNK = 256 * 1024;
const MAX_CENTRAL_BYTES = 64 * 1024 ** 2;
const MAX_RATIO = 1000;
const fail = code => { throw new Error('private_tool_zip_' + code); };
const equalIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const equalFile = (a, b) => equalIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs
  && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});

function boundedLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('limits_invalid');
  const result = {...LIMITS};
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
function extras(buffer) {
  const found = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) fail('zip_extra_truncated');
    const id = buffer.readUInt16LE(offset), size = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > buffer.length || found.has(id)) fail('zip_extra_ambiguous');
    // Metadata may not supply alternate file names or links. ZIP64,
    // Unicode-path and ASi Unix fields are deliberately refused.
    if (![0x000a, 0x5455, 0x7875].includes(id)) fail('zip_extra_unsupported');
    found.set(id, buffer.subarray(offset, offset + size));
    offset += size;
  }
  return found;
}
function expandedSizes(raw, extra) {
  // Parse extras even though no extra field may override a size or path.
  void extra;
  if (Object.entries(raw).some(([key, value]) => value === (key === 'disk' ? 0xffff : 0xffffffff))) fail('zip64_forbidden');
  return raw;
}
function decodedName(bytes, flags) {
  if (!(flags & 0x800) && bytes.some(byte => byte > 0x7f)) fail('zip_legacy_encoding_forbidden');
  try { return decoder.decode(bytes); } catch { fail('zip_filename_utf8_invalid'); }
}
function safeZipName(raw, limits) {
  const directory = raw.endsWith('/');
  const name = directory ? raw.slice(0, -1) : raw;
  validateName(name);
  if (name.split('/').length > limits.maxDepth) fail('zip_depth_limit');
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
  const record = {...raw, end: endOffset};
  const locator = endOffset >= 20 ? await readAt(handle, endOffset - 20, 20, size) : null;
  if (locator?.readUInt32LE(0) === 0x07064b50
    || raw.count === 0xffff || raw.diskCount === 0xffff || raw.bytes === 0xffffffff || raw.offset === 0xffffffff)
    fail('zip64_forbidden');
  if (!record.count || record.count !== record.diskCount || record.count > limits.maxEntries)
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
    if (![10, 20].includes(version)) fail('zip_version_unsupported');
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
    if (names.has(collisionKey(name))) fail('zip_duplicate_or_case_collision');
    names.add(collisionKey(name));
    const parts = name.split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/'), key = collisionKey(prefix);
      const kind = depth === parts.length && !directory ? 'file' : 'directory';
      const prior = prefixes.get(key);
      if (prior && (prior.name !== prefix || prior.kind !== kind)) fail('zip_file_directory_alias');
      prefixes.set(key, {name: prefix, kind});
    }
    const fileLimit = limits.maxFileBytes;
    if (sizes.size > fileLimit || sizes.compressed > limits.maxArchiveBytes) fail('zip_file_size_limit');
    if (sizes.size > Math.max(sizes.compressed, 1) * MAX_RATIO) fail('zip_expansion_ratio_limit');
    if (method === 0 && sizes.size !== sizes.compressed) fail('zip_stored_size_mismatch');
    totalBytes += sizes.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxBytes)
      fail('zip_total_size_limit');
    if (!directory && ++fileCount > limits.maxFiles) fail('zip_file_count_limit');
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
      || fixed.readUInt16LE(8) !== entry.method || ![10, 20].includes(fixed.readUInt16LE(4))
      || fixed.readUInt16LE(4) > entry.version) fail('zip_local_header_mismatch');
    const nameLength = fixed.readUInt16LE(26), extraLength = fixed.readUInt16LE(28);
    entry.dataOffset = entry.offset + 30 + nameLength + extraLength;
    if (entry.dataOffset + entry.compressed > next) fail('zip_local_overlap');
    const variable = await readAt(handle, entry.offset + 30, nameLength + extraLength, archiveSize);
    if (!variable.subarray(0, nameLength).equals(entry.nameBytes)) fail('zip_local_name_mismatch');
    const sizes = expandedSizes({size: fixed.readUInt32LE(22), compressed: fixed.readUInt32LE(18)}, extras(variable.subarray(nameLength)));
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
      if (![12, 16].includes(length)) fail('zip_descriptor_invalid');
      const bytes = await readAt(handle, dataEnd, length, archiveSize);
      const signed = length === 16;
      if (signed && bytes.readUInt32LE(0) !== 0x08074b50) fail('zip_descriptor_invalid');
      const start = signed ? 4 : 0;
      const compressed = bytes.readUInt32LE(start + 4);
      const size = bytes.readUInt32LE(start + 8);
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

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const {bytesWritten} = await handle.write(chunk, offset, chunk.length - offset);
    if (!bytesWritten) fail('file_write_incomplete');
    offset += bytesWritten;
  }
}

// Remove only objects created by this invocation. A replaced directory/file or
// an unexpected new member is preserved and reported, never recursively erased.
async function cleanOwnedOutput(created, pins) {
  const errors = [];
  for (const row of [...created].reverse()) {
    try {
      await checkPins(pins, path.dirname(row.file));
      const named = await fs.lstat(row.file, {bigint: true});
      if (!equalIdentity(row.info, named) || named.isSymbolicLink()
        || (row.directory ? !named.isDirectory() : !named.isFile())) fail('cleanup_identity_changed');
      if (row.directory) await fs.rmdir(row.file); else await fs.unlink(row.file);
    } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'private_tool_zip_cleanup_incomplete');
}

/** Build-only byte extraction. The digest must come from a reviewed source
 * lock, not an adjacent archive-supplied checksum. No signature is inferred. */
export async function extractPrivateToolZip({archivePath, outputDirectory, expectedSha256, maxBytes} = {}) {
  if (!SHA.test(expectedSha256 || '')) fail('archive_digest_required');
  const limits = boundedLimits(maxBytes === undefined ? {} : {maxBytes});
  const archive = localAbsolute(archivePath), target = localAbsolute(outputDirectory);
  const archivePins = await pinAncestors(path.dirname(archive));
  const pins = await pinAncestors(path.dirname(target));
  try { await fs.lstat(target); fail('destination_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const before = await fs.lstat(archive, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino <= 0n) fail('archive_not_regular');
  if (before.size < 22n || before.size > BigInt(limits.maxArchiveBytes)) fail('archive_size_limit');
  const size = Number(before.size), handle = await fs.open(archive, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const created = [], files = [], ownedFiles = new Map();
  const assertArchive = async () => {
    await checkPins(archivePins);
    const [opened, named] = await Promise.all([handle.stat({bigint: true}), fs.lstat(archive, {bigint: true})]);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || !equalFile(before, opened) || !equalFile(before, named))
      fail('archive_changed');
  };
  try {
    await assertArchive();
    if (await digestHandle(handle, size) !== expectedSha256) fail('archive_digest_mismatch');
    const entries = await parseEntries(handle, size, limits);
    if (!entries.some(entry => !entry.directory)) fail('archive_empty');
    const directories = new Set();
    for (const entry of entries) {
      const parts = entry.name.split('/');
      for (let depth = 1; depth < parts.length + Number(entry.directory); depth++)
        directories.add(parts.slice(0, depth).join('/'));
    }
    // Implicit parent directories count toward the same inventory bound.
    if (directories.size + entries.filter(entry => !entry.directory).length > limits.maxEntries) fail('inventory_entry_count_limit');
    await assertArchive(); await checkPins(pins);
    await fs.mkdir(target, {mode: 0o700});
    const rootInfo = await directoryInfo(target);
    pins.set(target, rootInfo); created.push({file: target, info: rootInfo, directory: true});
    for (const relative of [...directories].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))) {
      const file = path.join(target, ...relative.split('/'));
      await checkPins(pins, path.dirname(file));
      await fs.mkdir(file, {mode: 0o700});
      const info = await directoryInfo(file);
      pins.set(file, info); created.push({file, info, directory: true});
    }
    for (const entry of entries) {
      if (entry.directory) continue;
      const file = path.join(target, ...entry.name.split('/'));
      await checkPins(pins, path.dirname(file));
      const output = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      try {
        const opened = await output.stat({bigint: true});
        created.push({file, info: opened, directory: false});
        if (!opened.isFile() || opened.nlink !== 1n || opened.ino <= 0n) fail('destination_not_regular');
        const sha256 = await consumeEntry(handle, entry, size, chunk => writeAll(output, chunk));
        await output.sync();
        const named = await fs.lstat(file, {bigint: true}), end = await output.stat({bigint: true});
        if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || !equalIdentity(opened, named)
          || !equalFile(named, end) || Number(named.size) !== entry.size) fail('destination_file_changed');
        ownedFiles.set(file, named);
        files.push({path: entry.name, bytes: entry.size, sha256});
      } finally { await output.close(); }
      await checkPins(pins, path.dirname(file));
    }
    // Rewalk membership and rehash every completed output after extraction.
    const expected = new Map(files.map(row => [row.path, row]));
    let observed = 0;
    const walk = async (directory, prefix = '') => {
      await checkPins(pins, directory);
      for (const name of await fs.readdir(directory)) {
        const relative = prefix ? `${prefix}/${name}` : name, file = path.join(directory, name);
        const info = await fs.lstat(file, {bigint: true});
        if (directories.has(relative)) { if (info.isSymbolicLink() || !info.isDirectory()) fail('output_changed'); await walk(file, relative); }
        else {
          const wanted = expected.get(relative), owned = ownedFiles.get(file);
          if (!wanted || !owned || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n
            || !equalFile(owned, info) || Number(info.size) !== wanted.bytes) fail('output_changed');
          const reader = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
          try {
            if (!equalFile(info, await reader.stat({bigint: true})) || await digestHandle(reader, wanted.bytes) !== wanted.sha256
              || !equalFile(info, await fs.lstat(file, {bigint: true}))) fail('output_changed');
          } finally { await reader.close(); }
          observed++;
        }
      }
    };
    await walk(target);
    if (observed !== expected.size) fail('output_missing');
    const held = await Promise.all(created.map(async row => ({...row, info: await fs.lstat(row.file, {bigint: true})})));
    await assertArchive();
    if (await digestHandle(handle, size) !== expectedSha256) fail('archive_digest_changed');
    await assertArchive(); await checkPins(pins);
    for (const row of held) if (!equalFile(row.info, await fs.lstat(row.file, {bigint: true}))) fail('output_changed');
    return Object.freeze(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(Object.freeze));
  } catch (error) {
    try { await cleanOwnedOutput(created, pins); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'private_tool_zip_extraction_and_cleanup_failed', {cause: error}); }
    throw error;
  } finally { await handle.close(); }
}

export {extractPrivateToolTarGz} from './private-tool-tar.mjs';
