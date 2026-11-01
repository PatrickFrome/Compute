// Synthetic inert archive members only. These tests execute no extracted tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {crc32, deflateRawSync} from 'node:zlib';
import {extractPrivateToolZip} from '../scripts/private-tool-zip.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function zip(rows) {
  const locals = [], central = [], offsets = [];
  let offset = 0;
  for (const row of rows) {
    const bytes = Buffer.from(row.bytes ?? ''), method = row.method ?? 0, flags = row.flags ?? 0x800;
    const compressed = row.compressed ?? (method === 8 ? deflateRawSync(bytes) : bytes);
    const name = Buffer.from(row.name), localName = Buffer.from(row.localName ?? row.name);
    const extra = row.extra ?? Buffer.alloc(0), localExtra = row.localExtra ?? extra;
    const size = row.size ?? bytes.length, compressedSize = row.compressedSize ?? compressed.length, crc = row.crc ?? crc32(bytes);
    const local = Buffer.alloc(30), cd = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(row.version ?? 20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(flags & 8 ? 0 : crc, 14); local.writeUInt32LE(flags & 8 ? 0 : compressedSize, 18); local.writeUInt32LE(flags & 8 ? 0 : size, 22);
    local.writeUInt16LE(localName.length, 26); local.writeUInt16LE(localExtra.length, 28);
    cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(3 * 256 + 20, 4); cd.writeUInt16LE(row.version ?? 20, 6);
    cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressedSize, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(extra.length, 30);
    cd.writeUInt32LE(row.attributes ?? (((row.mode ?? (row.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0), 38);
    cd.writeUInt32LE(row.offset ?? offset, 42);
    let tail = Buffer.alloc(0);
    if (flags & 8) {
      tail = Buffer.alloc(16); tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, 4);
      tail.writeUInt32LE(compressedSize, 8); tail.writeUInt32LE(size, 12);
    }
    offsets.push({local: offset, central: 0, data: offset + 30 + localName.length + localExtra.length});
    locals.push(local, localName, localExtra, compressed, tail);
    central.push(Buffer.concat([cd, name, extra]));
    offset += local.length + localName.length + localExtra.length + compressed.length + tail.length;
  }
  const centralOffset = offset;
  for (let index = 0; index < central.length; index++) { offsets[index].central = offset; offset += central[index].length; }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(rows.length, 8); end.writeUInt16LE(rows.length, 10);
  end.writeUInt32LE(offset - centralOffset, 12); end.writeUInt32LE(centralOffset, 16);
  return {bytes: Buffer.concat([...locals, ...central, end]), offsets, centralOffset, endOffset: offset};
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-tool-zip-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const archivePath = path.join(root, 'tool.zip'), outputDirectory = path.join(root, 'out');
  const invoke = async (built, overrides = {}) => {
    await fs.writeFile(archivePath, built.bytes ?? built);
    return extractPrivateToolZip({archivePath, outputDirectory, expectedSha256: hash(built.bytes ?? built), ...overrides});
  };
  const reject = async (built, pattern, overrides) => {
    await assert.rejects(invoke(built, overrides), pattern);
    await assert.rejects(fs.lstat(outputDirectory), {code: 'ENOENT'});
    await assert.rejects(fs.lstat(path.join(root, 'escaped')), {code: 'ENOENT'});
  };
  return {root, archivePath, outputDirectory, invoke, reject};
}

test('extracts the complete stored/deflated tree including libexec, DLL, config, CA, notices and empty dirs', async t => {
  const f = await fixture(t);
  const rows = [{name: 'cmd/git.exe', bytes: 'inert git'}, {name: 'mingw64/bin/library.dll', bytes: 'inert DLL', method: 8},
    {name: 'mingw64/libexec/git-core/git-remote-https.exe', bytes: 'inert helper', method: 8, flags: 0x808},
    {name: 'etc/gitconfig', bytes: '[core]\n'}, {name: 'mingw64/ssl/certs/ca-bundle.crt', bytes: 'inert CA'},
    {name: 'LICENSE.txt', bytes: 'inert notice'}, {name: 'empty/', bytes: ''}];
  const files = await f.invoke(zip(rows));
  assert.deepEqual(files, rows.filter(row => !row.name.endsWith('/')).map(row => ({path: row.name, bytes: Buffer.byteLength(row.bytes), sha256: hash(row.bytes)})).sort((a, b) => a.path < b.path ? -1 : 1));
  for (const row of rows.filter(row => !row.name.endsWith('/'))) assert.equal(await fs.readFile(path.join(f.outputDirectory, row.name), 'utf8'), row.bytes);
  assert.deepEqual(await fs.readdir(path.join(f.outputDirectory, 'empty')), []);
});

for (const name of ['../escaped', '/escaped', 'C:/escaped', 'cmd\\git.exe', 'git.exe:stream', 'AUX.txt', 'CON .txt', 'COM¹.exe', 'dir/NUL', 'a./b', 'a /b', './git.exe', 'x//y', 'x/../y', 'git\0.exe', 'git\u0085.exe', '\ufeffgit.exe', 'git\u202e.exe', 'cafe\u0301.txt']) {
  test(`rejects unsafe Windows path ${JSON.stringify(name)} before output`, async t => (await fixture(t)).reject(zip([{name, bytes: 'x'}]), /path_invalid/));
}
for (const names of [['git.exe', 'GIT.EXE'], ['S/file', 'ſ/file'], ['σ/file', 'ς/file'], ['file', 'file/child'], ['dir/a', 'DIR/b'], ['git.exe', 'git.exe']]) {
  test(`rejects duplicate/file-directory/Unicode aliases ${JSON.stringify(names)}`, async t => (await fixture(t)).reject(zip(names.map(name => ({name, bytes: 'x'}))), /collision|alias/));
}
for (const [label, row, pattern] of [
  ['symlink', {mode: 0o120777}, /special_entry/], ['fifo', {mode: 0o010644}, /special_entry/], ['DOS reparse', {attributes: 0x400}, /special_entry/],
  ['encrypted', {flags: 0x801}, /flags_unsupported/], ['unsupported compression', {method: 12}, /compression/], ['ZIP64', {version: 45}, /version/],
  ['local alias', {localName: 'evil.exe'}, /name_mismatch/], ['CRC mismatch', {crc: 1}, /crc_mismatch/],
  ['stored size mismatch', {size: 7}, /stored_size_mismatch/], ['out of bound offset', {offset: 0xfffffff0}, /preamble|overlap/],
  ['alternate Unicode extra', {extra: Buffer.from([0x75, 0x70, 0, 0])}, /extra_unsupported/],
  ['ZIP64 extra', {extra: Buffer.from([1, 0, 0, 0])}, /extra_unsupported/],
]) {
  test(`rejects ${label}`, async t => (await fixture(t)).reject(zip([{name: 'tool.exe', bytes: 'data', ...row}]), pattern));
}
test('refuses wrong archive digest without creating output', async t => {
  const f = await fixture(t); await f.reject(zip([{name: 'git.exe', bytes: 'x'}]), /digest_mismatch/, {expectedSha256: '0'.repeat(64)});
});
test('refuses compressed expansion past declared size and removes its own partial files', async t => {
  const f = await fixture(t);
  await f.reject(zip([{name: 'ok', bytes: 'first'}, {name: 'large', bytes: 'a'.repeat(1000), method: 8, size: 10}]), /expanded_size_limit/);
});
test('rejects trailing deflate bytes and removes partial output', async t => {
  const f = await fixture(t), compressed = Buffer.concat([deflateRawSync(Buffer.from('value')), Buffer.from('trailing')]);
  await f.reject(zip([{name: 'tool', bytes: 'value', method: 8, compressed}]), /deflate_trailing_bytes/);
});
test('enforces declared per-file and expanded-total bounds before output', async t => {
  const f = await fixture(t);
  await f.reject(zip([{name: 'tool', bytes: 'data'}]), /total_size_limit/, {maxBytes: 3});
  await f.reject(zip([{name: 'tool', bytes: 'data', size: 512 * 1024 ** 2 + 1, compressedSize: 512 * 1024 ** 2 + 1}]), /file_size_limit/);
});
test('refuses preexisting target and preserves its files', async t => {
  const f = await fixture(t); await fs.mkdir(f.outputDirectory); await fs.writeFile(path.join(f.outputDirectory, 'keep'), 'untouched');
  await assert.rejects(f.invoke(zip([{name: 'tool', bytes: 'x'}])), /destination_exists/);
  assert.equal(await fs.readFile(path.join(f.outputDirectory, 'keep'), 'utf8'), 'untouched');
});
test('refuses symbolic-link ancestors and symbolic-link archives', async t => {
  if (process.platform === 'win32') return t.skip('symlink privilege is not assumed');
  const f = await fixture(t), link = path.join(f.root, 'alias');
  await fs.symlink(f.root, link, 'dir');
  await assert.rejects(f.invoke(zip([{name: 'tool', bytes: 'x'}]), {outputDirectory: path.join(link, 'out')}), /alias_or_reparse/);
  const bytes = zip([{name: 'tool', bytes: 'x'}]).bytes; await fs.writeFile(f.archivePath, bytes);
  const archiveAlias = path.join(f.root, 'linked.zip'); await fs.symlink(f.archivePath, archiveAlias);
  await assert.rejects(extractPrivateToolZip({archivePath: archiveAlias, outputDirectory: f.outputDirectory, expectedSha256: hash(bytes)}), /archive_not_regular/);
});
test('rejects overlapping local members even with a valid outer digest', async t => {
  const f = await fixture(t), built = zip([{name: 'a', bytes: 'a'}, {name: 'b', bytes: 'b'}]);
  built.bytes.writeUInt32LE(0, built.offsets[1].central + 42);
  await f.reject(built, /local_overlap/);
});
test('rejects an EOCD ZIP64 sentinel', async t => {
  const f = await fixture(t), built = zip([{name: 'tool', bytes: 'x'}]);
  built.bytes.writeUInt16LE(0xffff, built.endOffset + 10);
  await f.reject(built, /zip64_forbidden/);
});
