import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const OFFLINE_INVENTORY_SCHEMA = 'compute.runtime-offline-resource-inventory.v1';
export const OFFLINE_BUNDLE_SCHEMA = 'compute.runtime-offline-bundle.v1';
export const OFFLINE_MANIFEST_FILE = 'offline-runtime-bundle.json';
export const OFFLINE_LAYOUT = Object.freeze({
  source_root: 'source',
  entry: 'source/infra/client-state-runtime/runtime-host.mjs',
  executables: Object.freeze({ node: 'runtime/node/node.exe', deno: 'runtime/deno/deno.exe', postgres_bin: 'runtime/postgresql/bin' }),
  deno_dir: 'runtime/deno-cache',
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const slash = value => value.split(sep).join('/');
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (root, target) => {
  const value = relative(root, target);
  return !isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep);
};
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const maxFileBytes = 256 * 1024 * 1024;
const maxTotalBytes = 2 ** 31;

function safePath(path) {
  if (typeof path !== 'string' || path.length > 512 || path.includes('\\')
    || !path.split('/').every(part => /^[A-Za-z0-9_@+.-]+$/.test(part) && part !== '.' && part !== '..' && !part.startsWith('.'))) fail('offline_bundle_path_invalid');
  if (path.split('/').some(part => /^(?:private|secrets?|credentials?|passwords?|dumps?|backups?|pgdata|profiles?)(?:[._-]|$)/i.test(part))) fail('offline_bundle_private_path_forbidden');
  return path;
}

// On Windows os.tmpdir() and administrator profiles can contain legitimate 8.3
// components (RUNNER~1), which realpath() expands. Reject reparse redirects
// at every existing ancestor, rather than rejecting harmless short-name aliases.
// Return the resolved physical spelling for all subsequent within()/stage checks.
async function checkedRealPath(absolute) {
  const real = await realpath(absolute);
  if (process.platform === 'win32') {
    let current = parse(absolute).root;
    for (const segment of relative(current, absolute).split(sep).filter(Boolean)) {
      current = join(current, segment);
      if ((await lstat(current)).isSymbolicLink()) fail('offline_bundle_alias_forbidden');
    }
  } else if (!same(real, absolute)) fail('offline_bundle_alias_forbidden');
  return real;
}

async function directory(path) {
  if (!isAbsolute(path || '')) fail('offline_bundle_absolute_path_required');
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('offline_bundle_directory_invalid');
  return checkedRealPath(absolute);
}

async function regular(path) {
  if (!isAbsolute(path || '')) fail('offline_bundle_absolute_path_required');
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('offline_bundle_regular_file_required');
  await checkedRealPath(absolute);
  if (info.size > maxFileBytes) fail('offline_bundle_file_size_limit');
  return info;
}

async function measure(path) {
  const before = await regular(path);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  const after = await regular(path);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('offline_bundle_file_changed_during_hash');
  return { bytes: after.size, sha256: hash.digest('hex') };
}

async function tree(root) {
  const files = [];
  const walk = async current => {
    await directory(current);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) fail('offline_bundle_alias_forbidden');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(safePath(slash(relative(root, path))));
      else fail('offline_bundle_regular_file_required');
      if (files.length > 10000) fail('offline_bundle_file_count_limit');
    }
  };
  await walk(root);
  return files.sort();
}

function json(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('offline_bundle_json_invalid'); }
}

function policy() {
  return {
    artifact_kind: 'REVIEWED_WINDOWS_X64_OFFLINE_RESOURCES',
    database_included: false, private_config_included: false, credentials_included: false,
    publisher_provenance_verified: false, installed_client_qualified: false,
    portable_to_other_machines_qualified: false, process_code_attested: false,
    authority_effect: false,
  };
}

function origins(value) {
  const result = {};
  for (const name of ['node', 'deno', 'postgresql']) {
    const input = value?.[name];
    if (!input || typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version)
      || !hex.test(input.archive_sha256 || '')) fail('offline_bundle_recorded_origin_required');
    let url;
    try { url = new URL(input.url); } catch { fail('offline_bundle_origin_url_invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !['nodejs.org', 'github.com', 'get.enterprisedb.com', 'ftp.postgresql.org', 'www.postgresql.org'].includes(url.hostname)
      || input.url.length > 512) fail('offline_bundle_origin_url_invalid');
    if ((name === 'node' && !input.version.startsWith('24.')) || (name === 'deno' && !input.version.startsWith('2.'))
      || (name === 'postgresql' && !input.version.startsWith('17.'))) fail('offline_bundle_component_version_invalid');
    result[name] = { version: input.version, url: url.href, archive_sha256: input.archive_sha256, verification: 'RECORDED_ORIGIN_NOT_PUBLISHER_ATTESTATION' };
  }
  return result;
}

function validateRecords(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 10000) fail('offline_bundle_records_invalid');
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    safePath(file?.path);
    if (!hex.test(file.sha256 || '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > maxFileBytes) fail('offline_bundle_record_invalid');
    const lower = file.path.toLowerCase();
    if (seen.has(lower)) fail('offline_bundle_duplicate_path');
    seen.add(lower);
    total += file.bytes;
    if (total > maxTotalBytes) fail('offline_bundle_total_size_limit');
    const selected = selectedFile(file.path);
    if (selected.component !== file.component || selected.kind !== file.kind) fail('offline_bundle_file_scope_invalid');
  }
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (JSON.stringify(sorted) !== JSON.stringify(files)) fail('offline_bundle_record_order_invalid');
  for (const path of [
    OFFLINE_LAYOUT.entry, 'source/runtime-source-bundle.json', OFFLINE_LAYOUT.executables.node,
    OFFLINE_LAYOUT.executables.deno, 'runtime/postgresql/bin/postgres.exe', 'runtime/postgresql/bin/psql.exe',
    'runtime/postgresql/bin/initdb.exe', 'runtime/postgresql/bin/pg_ctl.exe', 'runtime/postgresql/bin/pg_config.exe',
    'runtime/postgresql/share/postgres.bki', 'runtime/postgresql/lib/plpgsql.dll',
    'runtime/deno-cache/npm/registry.npmjs.org/postgres/3.4.7/package.json',
    'licenses/node.txt', 'licenses/deno.txt', 'licenses/postgresql.txt',
  ]) if (!seen.has(path.toLowerCase())) fail('offline_bundle_required_file_missing');
}

function selectedFile(path) {
  safePath(path);
  if (path.startsWith('source/')) return { component: 'source', kind: 'source_resource' };
  if (path === OFFLINE_LAYOUT.executables.node) return { component: 'node', kind: 'binary' };
  if (path === OFFLINE_LAYOUT.executables.deno) return { component: 'deno', kind: 'binary' };
  if (/^runtime\/postgresql\/(?:bin|lib|share)\//.test(path)) return { component: 'postgresql', kind: 'postgres_resource' };
  if (/^runtime\/deno-cache\/npm\/registry\.npmjs\.org\/postgres\/(?:registry\.json|3\.4\.7\/.+)$/.test(path)) return { component: 'deno_cache', kind: 'dependency' };
  for (const component of ['node', 'deno', 'postgresql']) if (path === 'licenses/' + component + '.txt') return { component, kind: 'license' };
  fail('offline_bundle_file_scope_invalid');
}

async function sourceBinding(root, expectedDigest) {
  if (!hex.test(expectedDigest || '')) fail('offline_bundle_source_pin_required');
  const manifest = json(await readFile(join(root, 'runtime-source-bundle.json')));
  const { bundle_sha256: actualDigest, ...body } = manifest;
  if (manifest.schema !== 'compute.runtime-source-bundle.v1' || actualDigest !== expectedDigest
    || digest(JSON.stringify(body)) !== expectedDigest || !hex.test(manifest.reviewed_startup_source_sha256 || '')
    || !hex.test(manifest.reviewed_startup_files_sha256 || '')
    || manifest.policy?.database_included !== false || manifest.policy?.private_config_included !== false
    || manifest.policy?.credentials_included !== false || !manifest.entry_points?.includes('infra/client-state-runtime/runtime-host.mjs')) fail('offline_bundle_source_binding_invalid');
  if (!Array.isArray(manifest.files) || manifest.files.length > 1000) fail('offline_bundle_source_binding_invalid');
  const names = manifest.files.map(file => safePath(file.path));
  const actualNames = await tree(root);
  if (JSON.stringify([...names, 'runtime-source-bundle.json'].sort()) !== JSON.stringify(actualNames)) fail('offline_bundle_source_file_set_mismatch');
  for (const file of manifest.files) {
    const actual = await measure(join(root, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) fail('offline_bundle_source_file_digest_mismatch');
  }
  return { source_bundle_sha256: expectedDigest, reviewed_startup_source_sha256: manifest.reviewed_startup_source_sha256,
    reviewed_startup_files_sha256: manifest.reviewed_startup_files_sha256 };
}

async function gather(sources) {
  const roots = {
    source: await directory(sources.sourceBundleDirectory), node: await directory(sources.nodeDirectory),
    postgresql: await directory(sources.postgresDirectory), deno_cache: await directory(sources.denoNpmDirectory),
    licenses: await directory(sources.licenseDirectory),
  };
  const deno = await checkedRealPath(resolve(sources.denoExecutable || ''));
  await regular(deno);
  const paths = [];
  const add = (path, absolute) => paths.push({ path, absolute, ...selectedFile(path) });
  for (const path of await tree(roots.source)) add('source/' + path, join(roots.source, path));
  add(OFFLINE_LAYOUT.executables.node, join(roots.node, 'node.exe'));
  add('licenses/node.txt', join(roots.node, 'LICENSE'));
  add(OFFLINE_LAYOUT.executables.deno, deno);
  add('licenses/deno.txt', join(roots.licenses, 'deno-LICENSE.txt'));
  add('licenses/postgresql.txt', join(roots.licenses, 'postgresql-COPYRIGHT.txt'));
  for (const name of ['bin', 'lib', 'share']) for (const path of await tree(join(roots.postgresql, name))) add('runtime/postgresql/' + name + '/' + path, join(roots.postgresql, name, path));
  const dependencyRoot = join(roots.deno_cache, 'registry.npmjs.org/postgres');
  for (const path of await tree(join(dependencyRoot, '3.4.7'))) add('runtime/deno-cache/npm/registry.npmjs.org/postgres/3.4.7/' + path, join(dependencyRoot, '3.4.7', path));
  // A frozen exact-version Deno cache can contain only the package bytes.
  // Registry metadata is optional and is copied only when the input cache has it.
  try {
    await regular(join(dependencyRoot, 'registry.json'));
    add('runtime/deno-cache/npm/registry.npmjs.org/postgres/registry.json', join(dependencyRoot, 'registry.json'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { roots, paths: paths.sort((a, b) => a.path.localeCompare(b.path, 'en')) };
}

async function qualifyMetadata(paths) {
  const index = new Map(paths.map(file => [file.path, file.absolute]));
  for (const component of ['node', 'deno', 'postgresql']) {
    const text = await readFile(index.get('licenses/' + component + '.txt'), 'utf8');
    if (text.length < 400 || text.length > 4 * 1024 * 1024 || !/Copyright/i.test(text)
      || (component === 'node' && !/Node\.js/i.test(text))
      || (component === 'deno' && !/Deno/i.test(text))
      || (component === 'postgresql' && !/PostgreSQL/i.test(text))) fail('offline_bundle_license_invalid');
  }
  const npm = json(await readFile(index.get('runtime/deno-cache/npm/registry.npmjs.org/postgres/3.4.7/package.json')));
  if (npm.name !== 'postgres' || npm.version !== '3.4.7') fail('offline_bundle_deno_dependency_invalid');
  const registryPath = index.get('runtime/deno-cache/npm/registry.npmjs.org/postgres/registry.json');
  if (registryPath && !JSON.stringify(json(await readFile(registryPath))).includes('3.4.7')) fail('offline_bundle_deno_dependency_invalid');
}

export async function captureOfflineRuntimeInventory({ sources, sourceBundleDigest, componentOrigins }) {
  const selected = await gather(sources);
  const binding = await sourceBinding(selected.roots.source, sourceBundleDigest);
  await qualifyMetadata(selected.paths);
  const files = [];
  for (const file of selected.paths) files.push({ path: file.path, component: file.component, kind: file.kind, ...await measure(file.absolute) });
  validateRecords(files);
  const body = { schema: OFFLINE_INVENTORY_SCHEMA, platform: 'win32', arch: 'x64', ...OFFLINE_LAYOUT,
    ...binding, component_origins: origins(componentOrigins), files, policy: policy() };
  return { ...body, inventory_sha256: digest(JSON.stringify(body)) };
}

function validateInventory(inventory, expectedDigest) {
  if (!hex.test(expectedDigest || '')) fail('offline_bundle_inventory_pin_required');
  const { inventory_sha256: actualDigest, ...body } = inventory || {};
  if (inventory?.schema !== OFFLINE_INVENTORY_SCHEMA || actualDigest !== expectedDigest || digest(JSON.stringify(body)) !== expectedDigest) fail('offline_bundle_inventory_pin_mismatch');
  if (inventory.platform !== 'win32' || inventory.arch !== 'x64'
    || inventory.source_root !== OFFLINE_LAYOUT.source_root || inventory.entry !== OFFLINE_LAYOUT.entry
    || inventory.deno_dir !== OFFLINE_LAYOUT.deno_dir || JSON.stringify(inventory.executables) !== JSON.stringify(OFFLINE_LAYOUT.executables)
    || JSON.stringify(inventory.policy) !== JSON.stringify(policy()) || !hex.test(inventory.source_bundle_sha256 || '')
    || !hex.test(inventory.reviewed_startup_source_sha256 || '')
    || !hex.test(inventory.reviewed_startup_files_sha256 || '')
    || JSON.stringify(origins(inventory.component_origins)) !== JSON.stringify(inventory.component_origins)) fail('offline_bundle_inventory_contract_invalid');
  validateRecords(inventory.files);
  return body;
}

function manifestFromInventory(inventory) {
  const { inventory_sha256, schema, ...rest } = inventory;
  const body = { schema: OFFLINE_BUNDLE_SCHEMA, resource_inventory_sha256: inventory_sha256, ...rest };
  return { ...body, bundle_sha256: digest(JSON.stringify(body)) };
}

export async function stageOfflineRuntimeBundle({ stagingDirectory, sources, inventory, expectedInventoryDigest }) {
  validateInventory(inventory, expectedInventoryDigest);
  const stage = await directory(stagingDirectory);
  if ((await readdir(stage)).length !== 0) fail('offline_bundle_empty_stage_required');
  const selected = await gather(sources);
  for (const root of [...Object.values(selected.roots), dirname(resolve(sources.denoExecutable))]) {
    if (within(root, stage) || within(stage, root)) fail('offline_bundle_external_stage_required');
  }
  const binding = await sourceBinding(selected.roots.source, inventory.source_bundle_sha256);
  if (binding.reviewed_startup_source_sha256 !== inventory.reviewed_startup_source_sha256
    || binding.reviewed_startup_files_sha256 !== inventory.reviewed_startup_files_sha256) fail('offline_bundle_source_binding_invalid');
  await qualifyMetadata(selected.paths);
  if (JSON.stringify(selected.paths.map(file => file.path)) !== JSON.stringify(inventory.files.map(file => file.path))) fail('offline_bundle_selected_file_set_mismatch');
  for (let index = 0; index < selected.paths.length; index++) {
    const file = selected.paths[index];
    const actual = await measure(file.absolute);
    if (actual.bytes !== inventory.files[index].bytes || actual.sha256 !== inventory.files[index].sha256) fail('offline_bundle_selected_file_digest_mismatch');
  }
  if ((await readdir(stage)).length !== 0) fail('offline_bundle_empty_stage_required');
  for (const file of selected.paths) {
    const target = join(stage, file.path);
    await mkdir(dirname(target), { recursive: true });
    await directory(dirname(target));
    await copyFile(file.absolute, target, constants.COPYFILE_EXCL);
  }
  const manifest = manifestFromInventory(inventory);
  await writeFile(join(stage, OFFLINE_MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  await verifyOfflineRuntimeBundle({ bundleDirectory: stage, expectedBundleDigest: manifest.bundle_sha256 });
  return manifest;
}

export async function verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest }) {
  if (!hex.test(expectedBundleDigest || '')) fail('offline_bundle_explicit_digest_required');
  const root = await directory(bundleDirectory);
  const manifestPath = join(root, OFFLINE_MANIFEST_FILE);
  const manifestInfo = await regular(manifestPath);
  if (manifestInfo.size > 8 * 1024 * 1024) fail('offline_bundle_manifest_size_limit');
  const manifest = json(await readFile(manifestPath));
  const { bundle_sha256: actualDigest, schema, resource_inventory_sha256, ...rest } = manifest;
  if (schema !== OFFLINE_BUNDLE_SCHEMA || actualDigest !== expectedBundleDigest
    || digest(JSON.stringify({ schema, resource_inventory_sha256, ...rest })) !== expectedBundleDigest) fail('offline_bundle_digest_mismatch');
  const inventory = { schema: OFFLINE_INVENTORY_SCHEMA, ...rest, inventory_sha256: resource_inventory_sha256 };
  validateInventory(inventory, resource_inventory_sha256);
  if (JSON.stringify(await tree(root)) !== JSON.stringify([...manifest.files.map(file => file.path), OFFLINE_MANIFEST_FILE].sort())) fail('offline_bundle_unexpected_file');
  for (const file of manifest.files) {
    const actual = await measure(join(root, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) fail('offline_bundle_file_digest_mismatch');
  }
  const paths = manifest.files.map(file => ({ ...file, absolute: join(root, file.path) }));
  await qualifyMetadata(paths);
  const binding = await sourceBinding(join(root, 'source'), manifest.source_bundle_sha256);
  if (binding.reviewed_startup_source_sha256 !== manifest.reviewed_startup_source_sha256
    || binding.reviewed_startup_files_sha256 !== manifest.reviewed_startup_files_sha256) fail('offline_bundle_source_binding_invalid');
  return {
    manifest,
    paths: {
      sourceRoot: join(root, OFFLINE_LAYOUT.source_root), nodeExecutable: join(root, OFFLINE_LAYOUT.executables.node),
      denoExecutable: join(root, OFFLINE_LAYOUT.executables.deno), postgresBinDirectory: join(root, OFFLINE_LAYOUT.executables.postgres_bin),
      denoDirectory: join(root, OFFLINE_LAYOUT.deno_dir), hostEntry: join(root, OFFLINE_LAYOUT.entry),
    },
  };
}
