import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { externalBuildWorkDirectory, obtainRuntimeArchive, unpackRuntimeArchive } from '../scripts/stage-client-state-runtime.mjs';

const execute = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'compute-runtime-archive-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function archive(t, entries) {
  const directory = await fixture(t);
  const input = path.join(directory, 'entries.json');
  const zip = path.join(directory, 'runtime.zip');
  await writeFile(input, JSON.stringify(entries));
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; Add-Type -AssemblyName System.IO.Compression; $zip=[IO.Compression.ZipFile]::Open(${quote(zip)},[IO.Compression.ZipArchiveMode]::Create); try { foreach($name in (Get-Content -LiteralPath ${quote(input)} -Raw | ConvertFrom-Json)) { $entry=$zip.CreateEntry($name); $stream=$entry.Open(); try { $bytes=[Text.Encoding]::UTF8.GetBytes('fixture'); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() } } } finally { $zip.Dispose() }`], { windowsHide: true });
  return { directory, zip, target: path.join(directory, 'unpacked') };
}

test('build scratch cannot overlap the repository or use relative paths', () => {
  const root = path.resolve(tmpdir(), 'runtime-repo');
  for (const value of [root, path.join(root, 'scratch'), path.dirname(root)]) {
    assert.throws(() => externalBuildWorkDirectory(root, value), /external_work_directory_required/);
  }
  assert.throws(() => externalBuildWorkDirectory(root, 'relative'), /absolute_path_required/);
  assert.equal(externalBuildWorkDirectory(root, path.resolve(tmpdir(), 'runtime-scratch')), path.resolve(tmpdir(), 'runtime-scratch'));
});

test('cached archive bytes are rehashed before use', async t => {
  const directory = await fixture(t);
  const origin = { url: 'https://example.invalid/runtime.zip', archive_sha256: createHash('sha256').update('reviewed').digest('hex') };
  await writeFile(path.join(directory, 'runtime.zip'), 'changed');
  await assert.rejects(obtainRuntimeArchive(directory, origin), /archive_digest_mismatch/);
  await writeFile(path.join(directory, 'runtime.zip'), 'reviewed');
  assert.equal(await obtainRuntimeArchive(directory, origin), path.join(directory, 'runtime.zip'));
});

const windows = { skip: process.platform !== 'win32' };
test('PostgreSQL archive extracts only runtime bin, lib and share', windows, async t => {
  const sample = await archive(t, ['pgsql/bin/postgres.exe', 'pgsql/lib/runtime.dll', 'pgsql/share/timezone/UTC', `pgsql/pgAdmin 4/${'x'.repeat(300)}`]);
  await unpackRuntimeArchive(sample.zip, sample.target, { postgresOnly: true });
  assert.equal(await readFile(path.join(sample.target, 'pgsql/bin/postgres.exe'), 'utf8'), 'fixture');
  await assert.rejects(readFile(path.join(sample.target, 'pgsql/pgAdmin 4')), { code: 'ENOENT' });
  await assert.rejects(unpackRuntimeArchive(sample.zip, sample.target, { postgresOnly: true }), /extract_target_exists/);
});

test('archive traversal is rejected before any extraction', windows, async t => {
  const sample = await archive(t, ['normal.txt', '../escaped.txt']);
  await assert.rejects(unpackRuntimeArchive(sample.zip, sample.target), /archive_path_invalid/);
  await assert.rejects(readFile(path.join(sample.target, 'normal.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(sample.directory, 'escaped.txt')), { code: 'ENOENT' });
});

test('archive case collisions are rejected before extraction', windows, async t => {
  const sample = await archive(t, ['Runtime/Node.exe', 'runtime/node.exe']);
  await assert.rejects(unpackRuntimeArchive(sample.zip, sample.target), /archive_duplicate_path/);
  await assert.rejects(readFile(path.join(sample.target, 'Runtime/Node.exe')), { code: 'ENOENT' });
});
