#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ORIGINS = Object.freeze({
  node: { version: '24.21.0', url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
    archive_sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541' },
  deno: { version: '2.9.7', url: 'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip',
    archive_sha256: 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238' },
  postgresql: { version: '17.11.0', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip',
    archive_sha256: '6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3' },
});

export function externalBuildWorkDirectory(repositoryRoot, workDirectory) {
  if (!path.isAbsolute(repositoryRoot || '') || !path.isAbsolute(workDirectory || '')) throw new Error('runtime_build_absolute_path_required');
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(workDirectory));
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error('runtime_build_external_work_directory_required');
  }
  const opposite = path.relative(path.resolve(workDirectory), path.resolve(repositoryRoot));
  if (!opposite || (!path.isAbsolute(opposite) && opposite !== '..' && !opposite.startsWith('..' + path.sep))) {
    throw new Error('runtime_build_external_work_directory_required');
  }
  return path.resolve(workDirectory);
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export async function obtainRuntimeArchive(directory, origin) {
  const file = path.join(directory, path.basename(new URL(origin.url).pathname));
  try { await stat(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(origin.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error('runtime_build_archive_download_failed');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx' }));
  }
  if (await hashFile(file) !== origin.archive_sha256) throw new Error('runtime_build_archive_digest_mismatch');
  return file;
}

const quotePS = value => "'" + value.replaceAll("'", "''") + "'";
export async function unpackRuntimeArchive(archive, destination, { postgresOnly = false } = {}) {
  // Fixed official archives still get path validation before extraction.
  // There is no recursive deletion or overwrite of a previously staged tree.
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if(Test-Path -LiteralPath ${quotePS(destination)}) { throw 'runtime_build_extract_target_exists' }; $zip=[IO.Compression.ZipFile]::OpenRead(${quotePS(archive)}); try { $seen=@{}; foreach($entry in $zip.Entries) { $name=$entry.FullName.Replace('\\','/').TrimEnd('/'); if (!$name -or $name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or !$_ })) { throw 'runtime_build_archive_path_invalid' }; if(($entry.ExternalAttributes -band 0xF0000000) -eq 0xA0000000) { throw 'runtime_build_archive_link_invalid' }; if($seen.ContainsKey($name.ToLowerInvariant())) { throw 'runtime_build_archive_duplicate_path' }; $seen[$name.ToLowerInvariant()]=$true }; foreach($entry in $zip.Entries) { $name=$entry.FullName.Replace('\\','/'); if (${postgresOnly ? '$true' : '$false'} -and $name -notmatch '^pgsql/(bin|lib|share)(/|$)') { continue }; $target=Join-Path ${quotePS(destination)} $name; if($name.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; $inputStream=$entry.Open(); try { $outputStream=[IO.File]::Open($target,[IO.FileMode]::CreateNew); try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() } } finally { $inputStream.Dispose() } } } finally { $zip.Dispose() }`;
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
}

export async function stageClientStateRuntime({ repositoryRoot = path.resolve(here, '../../..'), workDirectory, outputDirectory, archiveDirectory } = {}) {
  if (process.platform !== 'win32') throw new Error('runtime_build_windows_x64_required');
  const root = await realpath(repositoryRoot);
  const work = externalBuildWorkDirectory(root, workDirectory);
  const output = path.resolve(outputDirectory || path.join(root, 'apps/metaengine-browser/client-state-runtime-dist'));
  await mkdir(work, { recursive: true });
  externalBuildWorkDirectory(root, await realpath(work));
  await writeFile(path.join(work, 'runtime-build-work.json'), JSON.stringify({ schema: 'compute.runtime-build-work.v1',
    repository_root: root, runtime_liveness_proven: false, private_data_included: false }) + '\n', { flag: 'wx' });
  const archives = archiveDirectory ? externalBuildWorkDirectory(root, await realpath(archiveDirectory)) : path.join(work, 'archives');
  if (!archiveDirectory) await mkdir(archives);
  const [nodeZip, denoZip, pgZip] = await Promise.all([
    obtainRuntimeArchive(archives, RUNTIME_ORIGINS.node),
    obtainRuntimeArchive(archives, RUNTIME_ORIGINS.deno),
    obtainRuntimeArchive(archives, RUNTIME_ORIGINS.postgresql),
  ]);
  await unpackRuntimeArchive(nodeZip, path.join(work, 'node'));
  await unpackRuntimeArchive(denoZip, path.join(work, 'deno'));
  await unpackRuntimeArchive(pgZip, path.join(work, 'postgresql'), { postgresOnly: true });
  const nodeDirectory = path.join(work, 'node/node-v24.21.0-win-x64');
  const denoExecutable = path.join(work, 'deno/deno.exe');
  const postgresDirectory = path.join(work, 'postgresql/pgsql');
  const cache = path.join(work, 'deno-cache');
  const licenses = path.join(work, 'licenses');
  const sourceStage = path.join(work, 'source-stage');
  await mkdir(cache); await mkdir(licenses); await mkdir(sourceStage); await mkdir(output, { recursive: true });
  for (const [url, name] of [
    ['https://raw.githubusercontent.com/denoland/deno/v2.9.7/LICENSE.md', 'deno-LICENSE.txt'],
    ['https://raw.githubusercontent.com/postgres/postgres/REL_17_11/COPYRIGHT', 'postgresql-COPYRIGHT.txt'],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('runtime_build_license_download_failed');
    await writeFile(path.join(licenses, name), await response.text(), { flag: 'wx' });
  }
  const entry = path.join(root, 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts');
  const lock = path.join(root, 'infra/client-state-runtime/deno.lock');
  const env = { ...process.env, DENO_DIR: cache, DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1' };
  await execute(denoExecutable, ['cache', '--no-config', '--node-modules-dir=none', '--lock', lock, '--frozen-lockfile', entry],
    { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  const { captureRuntimeBuildInventory, stageRuntimeSourceBundle } = await import('../../../infra/client-state-runtime/package-runtime-resources.mjs');
  const { captureOfflineRuntimeInventory, stageOfflineRuntimeBundle } = await import('../../../infra/client-state-runtime/offline-runtime-bundle.mjs');
  const buildInventory = await captureRuntimeBuildInventory({ repositoryRoot: root, nodePath: path.join(nodeDirectory, 'node.exe'),
    denoPath: denoExecutable, pgBinDir: path.join(postgresDirectory, 'bin'), denoLockPath: lock, denoDirectory: cache, includeRuntimeHost: true });
  const source = await stageRuntimeSourceBundle({ repositoryRoot: root, stagingDirectory: sourceStage, buildInventory,
    expectedSourceDigest: buildInventory.source_manifest_sha256, includeRuntimeHost: true });
  const sources = { sourceBundleDirectory: sourceStage, nodeDirectory, postgresDirectory, denoExecutable,
    denoNpmDirectory: path.join(cache, 'npm'), licenseDirectory: licenses };
  const inventory = await captureOfflineRuntimeInventory({ sources, sourceBundleDigest: source.bundle_sha256, componentOrigins: RUNTIME_ORIGINS });
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: output, sources, inventory, expectedInventoryDigest: inventory.inventory_sha256 });
  await writeFile(path.join(work, 'build-resource-inventory.json'), JSON.stringify(buildInventory, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(work, 'offline-resource-inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ schema: 'compute.client-runtime-package-stage.v1', bundle_sha256: manifest.bundle_sha256,
    source_bundle_sha256: manifest.source_bundle_sha256, output_directory: output,
    runtime_liveness_proven: false, private_data_included: false }));
  return { manifest, paths: { nodeDirectory, denoExecutable, postgresDirectory, cache, sourceStage, output } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argumentsMap = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (!['--work-dir', '--out', '--archives'].includes(name) || !process.argv[index + 1] || argumentsMap.has(name)) throw new Error('runtime_build_arguments_invalid');
    argumentsMap.set(name, process.argv[index + 1]);
  }
  stageClientStateRuntime({ workDirectory: argumentsMap.get('--work-dir'), outputDirectory: argumentsMap.get('--out'), archiveDirectory: argumentsMap.get('--archives') })
    .catch(error => { console.error(String(error.message)); process.exitCode = 1; });
}
