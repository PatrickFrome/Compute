import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest('hex');
export const startupFilesDigest = files => digest(JSON.stringify(files));
const slash = (value) => value.replaceAll('\\', '/');
const within = (root, target) => {
  const value = relative(root, target);
  return !isAbsolute(value) && value !== '..' && !value.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
};

function manifestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw manifestError('startup_manifest_regular_file_required');
  const canonical = await realpath(path);
  if ((process.platform === 'win32' ? canonical.toLowerCase() : canonical) !== (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))) throw manifestError('startup_manifest_alias_path_forbidden');
  return info;
}

async function hashFile(path, id, kind) {
  const before = await regularFile(path);
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  const after = await regularFile(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw manifestError('startup_manifest_file_changed_during_hash');
  return { id, kind, bytes: after.size, sha256: hash.digest('hex') };
}

async function dependencyFiles(directory) {
  const paths = [];
  const walk = async (current) => {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw manifestError('startup_manifest_dependency_directory_invalid');
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw manifestError('startup_manifest_dependency_symlink_forbidden');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw manifestError('startup_manifest_dependency_file_invalid');
    }
  };
  await walk(directory);
  return paths.sort();
}

export async function sourceClosure(entries, repositoryRoot) {
  const paths = new Set();
  const npm = new Set();
  const visit = async (path) => {
    path = resolve(path);
    if (!within(repositoryRoot, path)) throw manifestError('startup_manifest_source_outside_repository');
    if (paths.has(path)) return;
    await regularFile(path);
    paths.add(path);
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\r\n]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) {
        const imported = resolve(dirname(path), specifier);
        if (!/\.(js|mjs|cjs|ts|json)$/.test(imported)) throw manifestError('startup_manifest_source_extension_unsupported');
        await visit(imported);
      } else if (specifier.startsWith('npm:')) npm.add(specifier);
      else if (!specifier.startsWith('node:') && specifier !== 'postgres') throw manifestError('startup_manifest_import_unsupported');
    }
  };
  for (const entry of entries) await visit(entry);
  return { files: [...paths].sort(), npm: [...npm].sort() };
}

async function denoCacheInfo(command, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['info', '--json'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolvePromise(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(manifestError('startup_manifest_deno_info_timeout')); }, 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 65536) { child.kill(); finish(manifestError('startup_manifest_deno_info_overflow')); }
    });
    child.once('error', () => finish(manifestError('startup_manifest_deno_info_failed')));
    child.once('exit', (code) => {
      if (code !== 0) return finish(manifestError('startup_manifest_deno_info_failed'));
      try { finish(null, JSON.parse(output)); }
      catch { finish(manifestError('startup_manifest_deno_info_invalid')); }
    });
  });
}

export function safeRuntimePolicy(config, { fixture = false } = {}) {
  return {
    mode: 'LOCAL_POSTGRES', postgres_mode: config.postgresMode,
    address: '127.0.0.1', database_port: config.databasePort, api_port: config.apiPort, edge_port: config.edgePort,
    dependency_policy: fixture ? 'FIXTURE_COMMANDS' : 'FROZEN_LOCKFILE_AND_CACHED_ONLY',
    node_modules_mode: 'none', automatic_cloud_fallback: false,
    credentials_included: false, private_config_included: false,
  };
}

export async function captureStartupSource({ repositoryRoot, entries, nodePath = process.execPath, denoPath, pgBinDir,
  denoLockPath, env = process.env, fixture = false, policy, denoInfo } = {}) {
  repositoryRoot = resolve(repositoryRoot);
  const closure = await sourceClosure(entries, repositoryRoot);
  const records = [];
  for (const path of closure.files) records.push(await hashFile(path, 'repository/' + slash(relative(repositoryRoot, path)), 'source'));
  const runtimeDirectory = join(repositoryRoot, 'infra/client-state-runtime');
  for (const name of ['package.json', 'package-lock.json']) {
    records.push(await hashFile(join(runtimeDirectory, name), 'repository/infra/client-state-runtime/' + name, 'dependency_lock'));
  }
  const nodePackage = join(runtimeDirectory, 'node_modules/postgres');
  const nodeMetadata = JSON.parse(await readFile(join(nodePackage, 'package.json'), 'utf8'));
  if (nodeMetadata.name !== 'postgres' || nodeMetadata.version !== '3.4.7') throw manifestError('startup_manifest_node_postgres_version_mismatch');
  for (const path of await dependencyFiles(nodePackage)) records.push(await hashFile(path, 'node_npm/postgres@3.4.7/' + slash(relative(nodePackage, path)), 'dependency'));
  records.push(await hashFile(nodePath, 'binary/node', 'binary'));
  if (!fixture) {
    const lock = JSON.parse(await readFile(denoLockPath, 'utf8'));
    if (lock.version !== '5' || closure.npm.length !== 1 || closure.npm[0] !== 'npm:postgres@3.4.7'
      || lock.specifiers?.['npm:postgres@3.4.7'] !== '3.4.7' || !/^sha512-[A-Za-z0-9+/=]+$/.test(lock.npm?.['postgres@3.4.7']?.integrity || '')) throw manifestError('startup_manifest_deno_lock_invalid');
    records.push(await hashFile(denoLockPath, 'repository/' + slash(relative(repositoryRoot, denoLockPath)), 'dependency_lock'));
    records.push(await hashFile(denoPath, 'binary/deno', 'binary'));
    const cache = denoInfo || await denoCacheInfo(denoPath, env);
    if (!isAbsolute(cache.npmCache || '') || !cache.denoVersion) throw manifestError('startup_manifest_deno_cache_invalid');
    const denoPackage = join(cache.npmCache, 'registry.npmjs.org/postgres/3.4.7');
    const metadata = JSON.parse(await readFile(join(denoPackage, 'package.json'), 'utf8'));
    if (metadata.name !== 'postgres' || metadata.version !== '3.4.7') throw manifestError('startup_manifest_deno_postgres_version_mismatch');
    for (const path of await dependencyFiles(denoPackage)) records.push(await hashFile(path, 'deno_npm/postgres@3.4.7/' + slash(relative(denoPackage, path)), 'dependency'));
  }
  if (pgBinDir) {
    for (const name of ['postgres', 'psql']) {
      const path = join(pgBinDir, process.platform === 'win32' ? name + '.exe' : name);
      records.push(await hashFile(path, 'binary/' + name, 'binary'));
    }
  }
  const files = records.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (new Set(files.map((file) => file.id)).size !== files.length) throw manifestError('startup_manifest_duplicate_file');
  return {
    schema: 'compute.runtime-source-snapshot.v1', files, policy,
    manifest_sha256: digest(JSON.stringify({ files, policy })),
    limitations: [
      'Hashes measure selected file bytes; loaded process memory is not cryptographically attested.',
      'PostgreSQL dynamic libraries and Deno compiled caches are not included.',
      ...(fixture ? ['Child commands are test fixtures; this is not production dependency attestation.'] : []),
    ],
  };
}

export function bindStartupManifest({ before, after, instanceId, endpoint, children, startedAt, readyAt }) {
  if (!/^[a-f0-9-]{36}$/i.test(instanceId || '')) throw manifestError('startup_manifest_instance_invalid');
  if (before.manifest_sha256 !== after.manifest_sha256) throw manifestError('startup_source_changed_during_launch');
  return {
    schema: 'compute.runtime-startup-manifest.v1', instance_id: instanceId, endpoint,
    started_at: startedAt, ready_at: readyAt, children, stable_during_startup: true,
    source_manifest_sha256: before.manifest_sha256, source: before,
    process_code_attested: false, private_material_included: false,
  };
}

export async function persistStartupManifest(path, manifest, repositoryRoot) {
  if (!isAbsolute(path) || within(resolve(repositoryRoot), resolve(path))) throw manifestError('startup_manifest_private_output_required');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return path;
}
