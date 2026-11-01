// Build-only unpacking. A pinned archive is data, never an executable or a
// source of release authority. No files are written outside a new destination.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createGunzip} from 'node:zlib';

const MiB = 1024 ** 2;
const MAX_ARCHIVE = 512 * MiB, MAX_EXPANDED = 2 * 1024 ** 3;
const MAX_FILE = 512 * MiB, MAX_ENTRIES = 50000, BLOCK = 512;
const fail = code => { throw Error('private_tool_tar_' + code); };
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs
  && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.startsWith('\\\\'))
    fail('absolute_local_path_required');
  return path.resolve(value);
}
function safeName(name) {
  if (!name || Buffer.byteLength(name) > 1024 || name !== name.normalize('NFC')
    || /[\uD800-\uDFFF\p{Cc}\p{Cf}]/u.test(name) || /[\\\x00-\x1f\x7f<>:"|?*]/.test(name)) fail('path_invalid');
  const parts = name.split('/');
  if (parts.length > 40) fail('path_invalid');
  for (const part of parts) if (!part || part === '.' || part === '..' || /[. ]$/.test(part)
    || Buffer.byteLength(part) > 255
    || /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:[ .]|$)/i.test(part)
    || /^[^.]{1,6}~[1-9][0-9]*(?:\.|$)/i.test(part)) fail('path_invalid');
  return name;
}
function field(bytes) {
  const end = bytes.indexOf(0), size = end < 0 ? bytes.length : end;
  if (end >= 0 && bytes.subarray(end).some(byte => byte !== 0)) fail('field_nonzero_padding');
  try { return decoder.decode(bytes.subarray(0, size)); } catch { fail('field_utf8_invalid'); }
}
function octal(bytes) {
  // Base-256 numeric fields, negative values and alternate encodings are refused.
  if (bytes.some(byte => byte > 0x7f)) fail('numeric_encoding_unsupported');
  const raw = bytes.toString('ascii');
  if (!/^[ 0-7]*[\0 ]*$/.test(raw)) fail('numeric_invalid');
  const value = Number.parseInt(raw.replace(/[\0 ]+$/g, '').trim() || '0', 8);
  if (!Number.isSafeInteger(value) || value < 0) fail('numeric_invalid');
  return value;
}
function headerInfo(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (octal(header.subarray(148, 156)) !== sum) fail('header_checksum_invalid');
  if (!header.subarray(257, 263).equals(Buffer.from('ustar\0'))
    || !header.subarray(263, 265).equals(Buffer.from('00'))) fail('ustar_required');
  // Nothing in the link target, device number or unused tail may introduce
  // alternate semantics even when a producer marks an entry as regular.
  if (field(header.subarray(157, 257)) !== '' || octal(header.subarray(329, 337)) !== 0
    || octal(header.subarray(337, 345)) !== 0 || header.subarray(500).some(byte => byte !== 0))
    fail('link_or_device_metadata_forbidden');
  const kind = header[156];
  if (![0, 48, 53, 120].includes(kind)) fail('entry_type_forbidden');
  const directory = kind === 53, size = octal(header.subarray(124, 136));
  if (directory && size !== 0) fail('directory_payload_forbidden');
  if (size > MAX_FILE) fail('file_size_limit');
  const prefix = field(header.subarray(345, 500)), base = field(header.subarray(0, 100));
  const raw = prefix ? prefix + '/' + base : base;
  if (kind === 120) {
    // The pinned official Codex archive emits this local PAX timestamp envelope
    // ahead of each ordinary entry. It cannot supply a path, size, link target,
    // charset, ownership or any other extraction semantics.
    if (raw !== '././@PaxHeader' || size < 1 || size > 256) fail('pax_metadata_forbidden');
    return {timestampEnvelope: true, size};
  }
  const name = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return {name: safeName(name), directory, size};
}
async function directoryInfo(file) {
  const info = await fs.lstat(file, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino <= 0n) fail('directory_alias_or_reparse');
  return info;
}
async function pinAncestors(directory) {
  const pins = new Map();
  for (let current = directory;; current = path.dirname(current)) {
    pins.set(current, await directoryInfo(current));
    if (path.dirname(current) === current) break;
  }
  return pins;
}
async function checkPins(pins) {
  for (const [file, info] of pins) if (!sameIdentity(info, await directoryInfo(file))) fail('directory_identity_changed');
}
async function* compressedChunks(handle, size) {
  for (let offset = 0; offset < size;) {
    const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, size - offset));
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) fail('archive_truncated');
    offset += bytesRead; yield buffer.subarray(0, bytesRead);
  }
}
async function archiveDigest(handle, size) {
  const hash = createHash('sha256');
  for await (const chunk of compressedChunks(handle, size)) hash.update(chunk);
  return hash.digest('hex');
}
function readerFor(stream, maxBytes) {
  const iterator = stream[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0), position = 0, total = 0, ended = false;
  const next = async () => {
    const row = await iterator.next();
    if (row.done) { ended = true; return false; }
    total += row.value.length;
    if (total > maxBytes) fail('expanded_size_limit');
    pending = row.value; position = 0; return true;
  };
  return {
    async read(size, allowEof = false) {
      const result = Buffer.allocUnsafe(size); let done = 0;
      while (done < size) {
        if (position === pending.length && (ended || !await next())) {
          if (!done && allowEof) return null;
          fail('tar_truncated');
        }
        const count = Math.min(size - done, pending.length - position);
        pending.copy(result, done, position, position + count); done += count; position += count;
      }
      return result;
    },
  };
}

export async function extractPrivateToolTarGz({archivePath, outputDirectory, expectedSha256, maxBytes = MAX_EXPANDED} = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) fail('archive_digest_required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_EXPANDED) fail('limits_may_only_tighten');
  const archive = absolute(archivePath), target = absolute(outputDirectory);
  const archivePins = await pinAncestors(path.dirname(archive)), destinationPins = await pinAncestors(path.dirname(target));
  try { await fs.lstat(target); fail('destination_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const before = await fs.lstat(archive, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino <= 0n) fail('archive_not_regular');
  if (before.size < 18n || before.size > BigInt(MAX_ARCHIVE)) fail('archive_size_limit');
  const size = Number(before.size), handle = await fs.open(archive, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const assertArchive = async () => {
    await checkPins(archivePins);
    const [opened, named] = await Promise.all([handle.stat({bigint: true}), fs.lstat(archive, {bigint: true})]);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || !sameFile(before, opened)
      || !sameFile(before, named)) fail('archive_changed');
  };
  const created = [], names = new Set(), prefixes = new Map(), rows = [];
  let input, gunzip, ownedTarget = null, primary;
  const record = (name, directory) => {
    const key = name.toUpperCase().normalize('NFC');
    if (names.has(key)) fail('duplicate_or_case_collision');
    names.add(key);
    const parts = name.split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/'), folded = prefix.toUpperCase().normalize('NFC');
      const kind = depth === parts.length && !directory ? 'file' : 'directory', prior = prefixes.get(folded);
      if (prior && (prior.name !== prefix || prior.kind !== kind)) fail('file_directory_alias');
      prefixes.set(folded, {name: prefix, kind});
      if (prefixes.size > MAX_ENTRIES) fail('entry_count_limit');
    }
  };
  const ensureDirectory = async relative => {
    let full = target;
    for (const part of relative.split('/').filter(Boolean)) {
      const parent = full; full = path.join(full, part);
      await checkPins(destinationPins);
      if (!destinationPins.has(full)) {
        await fs.mkdir(full, {mode: 0o700});
        const info = await directoryInfo(full); destinationPins.set(full, info); created.push({file: full, info, directory: true});
      }
      if (!sameIdentity(destinationPins.get(parent), await directoryInfo(parent))) fail('directory_identity_changed');
    }
  };
  try {
    await assertArchive();
    if (await archiveDigest(handle, size) !== expectedSha256) fail('archive_digest_mismatch');
    await assertArchive(); await checkPins(destinationPins);
    await fs.mkdir(target, {mode: 0o700}); ownedTarget = await directoryInfo(target); destinationPins.set(target, ownedTarget);
    input = Readable.from(compressedChunks(handle, size)); gunzip = createGunzip({chunkSize: 64 * 1024});
    input.on('error', error => gunzip.destroy(error)); input.pipe(gunzip);
    // Header/padding bytes also count towards the expansion ceiling. Real
    // archives cannot hide a gzip bomb in an unlimited run of empty records.
    const reader = readerFor(gunzip, maxBytes); let entries = 0, bytes = 0, timestampPending = false;
    for (;;) {
      const header = await reader.read(BLOCK);
      if (header.every(byte => byte === 0)) {
        if (timestampPending) fail('pax_dangling');
        const second = await reader.read(BLOCK);
        if (second.some(byte => byte !== 0)) fail('terminator_invalid');
        for (;;) { const trailing = await reader.read(BLOCK, true); if (!trailing) break;
          if (trailing.some(byte => byte !== 0)) fail('trailing_data_forbidden'); }
        break;
      }
      if (++entries > MAX_ENTRIES) fail('entry_count_limit');
      const entry = headerInfo(header);
      if (entry.timestampEnvelope) {
        if (timestampPending) fail('pax_repeated');
        const payload = await reader.read(entry.size);
        if (payload.some(byte => byte > 0x7f)) fail('pax_metadata_forbidden');
        const match = /^([1-9][0-9]{0,2}) mtime=[0-9]{1,20}(?:\.[0-9]{1,9})?\n$/.exec(payload.toString('ascii'));
        if (!match || Number(match[1]) !== payload.length) fail('pax_metadata_forbidden');
        const padding = (BLOCK - entry.size % BLOCK) % BLOCK;
        if (padding && (await reader.read(padding)).some(byte => byte !== 0)) fail('file_padding_nonzero');
        timestampPending = true; continue;
      }
      timestampPending = false; record(entry.name, entry.directory);
      bytes += entry.size; if (bytes > maxBytes) fail('expanded_size_limit');
      const full = path.join(target, ...entry.name.split('/'));
      await ensureDirectory(entry.directory ? entry.name : path.posix.dirname(entry.name) === '.' ? '' : path.posix.dirname(entry.name));
      if (entry.directory) continue;
      await checkPins(destinationPins);
      const output = await fs.open(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      const info = await output.stat({bigint: true}); created.push({file: full, info, directory: false});
      const hash = createHash('sha256');
      try {
        for (let remaining = entry.size; remaining;) {
          const chunk = await reader.read(Math.min(remaining, 64 * 1024)); remaining -= chunk.length; hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const {bytesWritten} = await output.write(chunk, offset, chunk.length - offset);
            if (!bytesWritten) fail('file_write_incomplete'); offset += bytesWritten;
          }
        }
        const padding = (BLOCK - entry.size % BLOCK) % BLOCK;
        if (padding && (await reader.read(padding)).some(byte => byte !== 0)) fail('file_padding_nonzero');
        await output.sync();
        const [named, opened] = await Promise.all([fs.lstat(full, {bigint: true}), output.stat({bigint: true})]);
        if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || !sameIdentity(info, named)
          || !sameIdentity(info, opened) || Number(named.size) !== entry.size || Number(opened.size) !== entry.size)
          fail('destination_file_changed');
        created.at(-1).info = named;
      } finally { await output.close(); }
      rows.push({path: entry.name, bytes: entry.size, sha256: hash.digest('hex')});
    }
    if (!rows.length) fail('archive_has_no_files');
    await assertArchive(); await checkPins(destinationPins);
    const expected = new Map(created.map(item => [item.file, item]));
    const expectedHashes = new Map(rows.map(row => [row.path, row]));
    const readbackDirectories = new Map();
    let observed = 0;
    const readback = async (directory, relative = '') => {
      const held = await directoryInfo(directory), listing = await fs.readdir(directory);
      for (const name of listing) {
        const full = path.join(directory, name), wanted = expected.get(full);
        if (!wanted) fail('destination_unlisted_entry');
        const info = await fs.lstat(full, {bigint: true});
        if (info.isSymbolicLink() || !sameIdentity(wanted.info, info)) fail('destination_file_changed');
        observed++;
        const member = relative ? relative + '/' + name : name;
        if (wanted.directory) { if (!info.isDirectory()) fail('destination_file_changed'); await readback(full, member); }
        else {
          if (!info.isFile() || info.nlink !== 1n || !sameFile(wanted.info, info)) fail('destination_file_changed');
          const file = await fs.open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
          try {
            const opened = await file.stat({bigint: true});
            if (!sameFile(info, opened)) fail('destination_file_changed');
            const hash = createHash('sha256');
            for await (const chunk of compressedChunks(file, Number(info.size))) hash.update(chunk);
            if (hash.digest('hex') !== expectedHashes.get(member)?.sha256
              || !sameFile(info, await file.stat({bigint: true}))
              || !sameFile(info, await fs.lstat(full, {bigint: true}))) fail('destination_file_changed');
          } finally { await file.close(); }
        }
      }
      if (!sameFile(held, await directoryInfo(directory))) fail('destination_directory_changed');
      readbackDirectories.set(directory, held);
    };
    await readback(target);
    if (observed !== expected.size) fail('destination_member_missing');
    if (await archiveDigest(handle, size) !== expectedSha256) fail('archive_digest_changed');
    for (const item of created) if (!item.directory) {
      const info = await fs.lstat(item.file, {bigint: true});
      if (!info.isFile() || info.isSymbolicLink() || !sameFile(item.info, info)) fail('destination_file_changed');
    }
    for (const [directory, info] of readbackDirectories)
      if (!sameFile(info, await directoryInfo(directory))) fail('destination_directory_changed');
    await checkPins(destinationPins); await assertArchive();
    return Object.freeze(rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(Object.freeze));
  } catch (error) { primary = error; throw error; }
  finally {
    input?.destroy(); gunzip?.destroy(); await handle.close();
    if (primary && ownedTarget) {
      try {
        await checkPins(destinationPins);
        for (const item of [...created].reverse()) {
          for (let parent = path.dirname(item.file);; parent = path.dirname(parent)) {
            if (!sameIdentity(destinationPins.get(parent), await directoryInfo(parent))) fail('cleanup_identity_changed');
            if (path.dirname(parent) === parent) break;
          }
          const current = await fs.lstat(item.file, {bigint: true});
          if (!sameIdentity(item.info, current) || current.isSymbolicLink()) fail('cleanup_identity_changed');
          if (item.directory) await fs.rmdir(item.file); else await fs.unlink(item.file);
        }
        if (!sameIdentity(ownedTarget, await directoryInfo(target))) fail('cleanup_identity_changed');
        await fs.rmdir(target);
      } catch (cleanup) { throw new AggregateError([primary, cleanup], 'private_tool_tar_cleanup_refused', {cause: primary}); }
    }
  }
}
