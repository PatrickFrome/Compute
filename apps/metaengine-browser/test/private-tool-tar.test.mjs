// All payloads are inert handcrafted tar fixtures. No vendor code is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {extractPrivateToolTarGz} from '../scripts/private-tool-tar.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function number(buffer, offset, length, value) {
  buffer.write(Number(value).toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}
function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
}
function tar(rows, {terminator = true, suffix = Buffer.alloc(0), transform} = {}) {
  const chunks = [];
  for (const row of rows) {
    const bytes = Buffer.from(row.bytes ?? ''), header = Buffer.alloc(512);
    header.write(row.name, 0, 100, 'utf8'); number(header, 100, 8, 0o644);
    number(header, 108, 8, 0); number(header, 116, 8, 0);
    number(header, 124, 12, row.size ?? bytes.length); number(header, 136, 12, 0);
    header[156] = (row.kind ?? '0').charCodeAt(0);
    if (row.link) header.write(row.link, 157, 100);
    header.write('ustar\0', 257, 6); header.write('00', 263, 2);
    if (row.prefix) header.write(row.prefix, 345, 155);
    if (row.transform) row.transform(header);
    checksum(header);
    if (transform) transform(header);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  if (terminator) chunks.push(Buffer.alloc(1024));
  chunks.push(suffix);
  return Buffer.concat(chunks);
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-tool-tar-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const archivePath = path.join(root, 'tools.tar.gz'), outputDirectory = path.join(root, 'out');
  const invoke = async (bytes, options = {}) => {
    const compressed = gzipSync(bytes); await fs.writeFile(archivePath, compressed);
    return extractPrivateToolTarGz({archivePath, outputDirectory, expectedSha256: digest(compressed), ...options});
  };
  return {root, archivePath, outputDirectory, invoke};
}

test('strict ustar restores entire nested closure and returns sorted byte hashes', async t => {
  const f = await fixture(t);
  const rows = [{name: 'lib/empty', kind: '5'}, {name: 'bin/codex.exe', bytes: 'inert codex'},
    {name: 'lib/notice.txt', bytes: 'license'}, {name: 'lib/zero.dll', bytes: ''}];
  const result = await f.invoke(tar(rows));
  assert.deepEqual(result, rows.filter(row => row.kind !== '5').map(row => ({path: row.name,
    bytes: Buffer.byteLength(row.bytes), sha256: digest(row.bytes)})).sort((a, b) => a.path.localeCompare(b.path)));
  assert.deepEqual(await fs.readdir(path.join(f.outputDirectory, 'lib/empty')), []);
  assert.equal(await fs.readFile(path.join(f.outputDirectory, 'bin/codex.exe'), 'utf8'), 'inert codex');
});
test('ustar prefix is retained as part of the relative path', async t => {
  const f = await fixture(t);
  const result = await f.invoke(tar([{name: 'license.txt', prefix: 'codex-resources/notices', bytes: 'notice'}]));
  assert.equal(result[0].path, 'codex-resources/notices/license.txt');
});
test('digest mismatch creates no output', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke(tar([{name: 'file'}]), {expectedSha256: '0'.repeat(64)}), /archive_digest_mismatch/);
  await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
});
test('preexisting output and its data are preserved', async t => {
  const f = await fixture(t); await fs.mkdir(f.outputDirectory); await fs.writeFile(path.join(f.outputDirectory, 'keep'), 'keep');
  await assert.rejects(f.invoke(tar([{name: 'file'}])), /destination_exists/);
  assert.equal(await fs.readFile(path.join(f.outputDirectory, 'keep'), 'utf8'), 'keep');
});
for (const name of ['../escape', '/escape', 'C:/escape', 'bin\\file', 'bin/file:stream', 'bin/NUL.exe',
  'con', 'bin/COM¹.txt', 'bin/trailing.', 'bin/trailing ', 'bin/./file', 'bin//file', 'bin/a\u0001b',
  'bin/e\u0301', 'BIN~1/file', 'bin/CON .txt', 'bin/a\u0085b', '\ufeffbin/file', 'bin/a\u202eb']) {
  test('rejects unsafe path ' + JSON.stringify(name), async t => {
    const f = await fixture(t); await assert.rejects(f.invoke(tar([{name}])), /path_invalid/);
    await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
  });
}
for (const rows of [[{name: 'file'}, {name: 'file'}], [{name: 'bin/file'}, {name: 'BIN/other'}],
  [{name: 'bin'}, {name: 'bin/file'}], [{name: 'bin/S.txt'}, {name: 'bin/ſ.txt'}],
  [{name: 'bin', kind: '5'}, {name: 'bin'}]]) {
  test('rejects duplicate, case or file/directory alias ' + JSON.stringify(rows), async t => {
    const f = await fixture(t); await assert.rejects(f.invoke(tar(rows)), /collision|file_directory_alias/);
    await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
  });
}
for (const kind of ['1', '2', '3', '4', '6', '7', 'g', 'L', 'K']) {
  test('rejects special/link/extended entry type ' + kind, async t => {
    const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file', kind}])), /entry_type_forbidden/);
    await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
  });
}
test('accepts only the official local mtime PAX envelope without applying it', async t => {
  const f = await fixture(t);
  const rows = await f.invoke(tar([{name: '././@PaxHeader', kind: 'x', bytes: '28 mtime=1793301255.2535667\n'},
    {name: 'bin/codex.exe', bytes: 'inert'}]));
  assert.deepEqual(rows, [{path: 'bin/codex.exe', bytes: 5, sha256: digest('inert')}]);
});
for (const payload of ['20 path=outside.txt\n', '12 size=999\n', '18 linkpath=other\n',
  '21 mtime=1793301255\n', '28 mtime=1793301255.2535667\n12 size=999\n',
  '30 mtime=1793301255.25356678912\n', '15 mtime=-1.2\n']) {
  test('refuses semantic or malformed local PAX ' + JSON.stringify(payload), async t => {
    const f = await fixture(t);
    await assert.rejects(f.invoke(tar([{name: '././@PaxHeader', kind: 'x', bytes: payload}, {name: 'file'}])), /pax_metadata/);
    await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
  });
}
test('rejects dangling, repeated and differently named local PAX envelopes', async t => {
  for (const entries of [[{name: '././@PaxHeader', kind: 'x', bytes: '28 mtime=1793301255.2535667\n'}],
    [{name: '././@PaxHeader', kind: 'x', bytes: '28 mtime=1793301255.2535667\n'},
      {name: '././@PaxHeader', kind: 'x', bytes: '28 mtime=1793301255.2535667\n'}, {name: 'file'}],
    [{name: 'extension', kind: 'x', bytes: '28 mtime=1793301255.2535667\n'}, {name: 'file'}]]) {
    const f = await fixture(t); await assert.rejects(f.invoke(tar(entries)), /pax_/);
  }
});
test('rejects link metadata even on a regular entry', async t => {
  const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file', link: 'elsewhere'}])), /link_or_device/);
  await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
});
test('rejects invalid checksum before creating files and cleans its directory', async t => {
  const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file'}], {transform: h => { h[0] ^= 1; }})), /checksum/);
  await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
});
test('refuses non-ustar headers', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke(tar([{name: 'file', transform: h => { h[257] = 0; }}])), /ustar_required/);
});
test('refuses directory payloads', async t => {
  const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'dir', kind: '5', bytes: 'bad'}])), /directory_payload/);
});
test('refuses base256 sizes and high-bit ASCII aliases', async t => {
  for (const at of [124, 128]) {
    const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file', transform: h => { h[at] = 0xb1; }}])), /numeric_encoding/);
  }
});
test('refuses claimed file sizes above512MiB', async t => {
  const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file', size: 512 * 1024 ** 2 + 1}])), /file_size_limit/);
});
test('bounded gzip expansion fails and removes its partial output', async t => {
  const f = await fixture(t); await assert.rejects(f.invoke(tar([{name: 'file', bytes: 'a'.repeat(10000)}]), {maxBytes: 2048}), /expanded_size_limit/);
  await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
});
for (const tail of [Buffer.alloc(0), Buffer.alloc(512), Buffer.concat([Buffer.alloc(1024), Buffer.from('bad')]),
  Buffer.concat([Buffer.alloc(512), Buffer.from('nonzero'), Buffer.alloc(505)])]) {
  test('rejects truncated, missing or nonzero terminator', async t => {
    const f = await fixture(t);
    await assert.rejects(f.invoke(tar([{name: 'file'}], {terminator: false, suffix: tail})), /truncated|terminator|trailing_data/);
    await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
  });
}
test('refuses nonzero file padding', async t => {
  const f = await fixture(t), bytes = tar([{name: 'file', bytes: 'a'}]); bytes[513] = 1;
  await assert.rejects(f.invoke(bytes), /file_padding_nonzero/);
  await assert.rejects(fs.lstat(f.outputDirectory), {code: 'ENOENT'});
});
test('refuses symlink ancestors without changing the external destination', async t => {
  if (process.platform === 'win32') return t.skip('junction creation needs separately qualified Windows permissions');
  const f = await fixture(t), real = path.join(f.root, 'real'); await fs.mkdir(real);
  await fs.symlink(real, path.join(f.root, 'alias'));
  await assert.rejects(f.invoke(tar([{name: 'file'}]), {outputDirectory: path.join(f.root, 'alias/out')}), /directory_alias_or_reparse/);
  assert.deepEqual(await fs.readdir(real), []);
});
