import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sourceClosure } from './startup-source-manifest.mjs';

export const BUNDLE_SCHEMA = 'compute.runtime-source-bundle.v1';
export const BUNDLE_MANIFEST_FILE = 'runtime-source-bundle.json';
export const BUNDLE_ENTRY_POINTS = Object.freeze([
  'infra/client-state-runtime/launcher.mjs',
  'infra/client-state-runtime/db-api.mjs',
  'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts',
]);

const runtimeRoot = 'infra/client-state-runtime/';
const packageRoot = runtimeRoot + 'node_modules/postgres/';
const locks = Object.freeze(['package.json', 'package-lock.json', 'deno.lock']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.split(sep).join('/');
const digestPattern = /^[a-f0-9]{64}$/;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (root, target) => {
  const value = relative(root, target);
  return !isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep);
};
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length > 512 || value.includes('\\')
    || !value.split('/').every(part => /^[A-Za-z0-9_@+.-]+$/.test(part)
      && part !== '.' && part !== '..' && !part.startsWith('.'))) fail('bundle_path_invalid');
  if (value.split('/').some(part => /^(?:private|secrets?|credentials?|passwords?|dumps?|backups?|pgdata|profiles?)(?:[._-]|$)/i.test(part))) fail('bundle_private_path_forbidden');
  return value;
}

function sourcePathAllowed(value) {
  return /^(?:infra\/client-state-runtime\/[^/]+\.mjs|apps\/metaengine-browser\/src\/meta-(?:objective|orchestrator)-[^/]+\.mjs|apps\/metaengine-browser\/supabase\/a2-browser-native-supervisor-v1\/[^/]+\.(?:mjs|ts))$/.test(value)
    && !/(?:\.test\.|-fixture\.)/.test(value);
}

function classifyRecord(record) {
  if (!record || !digestPattern.test(record.sha256 || '') || !Number.isSafeInteger(record.bytes)
    || record.bytes < 0 || record.bytes > 2 ** 31) fail('bundle_source_record_invalid');
  safeRelativePath(record.id);
  if (record.kind !== 'binary' && record.bytes > 16 * 1024 * 1024) fail('bundle_source_record_invalid');
  if (record.id.startsWith('repository/')) {
    const path = record.id.slice('repository/'.length);
    if (record.kind === 'source' && sourcePathAllowed(path)) return { ...record, path, kind: 'source' };
    if (record.kind === 'dependency_lock' && locks.some(name => path === runtimeRoot + name)) return { ...record, path, kind: 'dependency_lock' };
  }
  for (const prefix of ['node_npm/postgres@3.4.7/', 'deno_npm/postgres@3.4.7/']) {
    if (record.kind === 'dependency' && record.id.startsWith(prefix)) {
      const dependencyPath = safeRelativePath(record.id.slice(prefix.length));
      return prefix.startsWith('node_')
        ? { ...record, path: packageRoot + dependencyPath, kind: 'dependency' }
        : null;
    }
  }
  if (record.kind === 'binary' && /^binary\/(?:node|deno|postgres|psql)$/.test(record.id)) return null;
  fail('bundle_unexpected_source_record');
}

export function reviewedBundlePlan(startupManifest, expectedSourceDigest) {
  if (!digestPattern.test(expectedSourceDigest || '')) fail('bundle_explicit_review_digest_required');
  const source = startupManifest?.source;
  if (startupManifest?.schema !== 'compute.runtime-startup-manifest.v1'
    || startupManifest.stable_during_startup !== true || startupManifest.private_material_included !== false
    || source?.schema !== 'compute.runtime-source-snapshot.v1' || !Array.isArray(source.files)
    || source.files.length < 1 || source.files.length > 1000) fail('bundle_reviewed_startup_receipt_required');
  if (startupManifest.source_manifest_sha256 !== expectedSourceDigest || source.manifest_sha256 !== expectedSourceDigest
    || sha256(JSON.stringify({ files: source.files, policy: source.policy })) !== expectedSourceDigest) fail('bundle_review_digest_mismatch');
  if (source.policy?.mode !== 'LOCAL_POSTGRES' || source.policy?.dependency_policy !== 'FROZEN_LOCKFILE_AND_CACHED_ONLY'
    || source.policy?.address !== '127.0.0.1' || source.policy?.automatic_cloud_fallback !== false
    || source.policy?.credentials_included !== false || source.policy?.private_config_included !== false) fail('bundle_review_policy_invalid');
  const ids = new Set();
  const records = [];
  for (const record of source.files) {
    if (ids.has(record?.id)) fail('bundle_duplicate_source_record');
    ids.add(record?.id);
    const selected = classifyRecord(record);
    if (selected) records.push(selected);
  }
  for (const name of [...BUNDLE_ENTRY_POINTS, ...locks.map(name => runtimeRoot + name), packageRoot + 'package.json']) {
    if (!records.some(record => record.path === name)) fail('bundle_required_resource_missing');
  }
  const paths = records.map(record => record.path);
  if (new Set(paths.map(value => value.toLowerCase())).size !== paths.length) fail('bundle_case_path_collision');
  if (records.reduce((total, record) => total + record.bytes, 0) > 64 * 1024 * 1024) fail('bundle_total_size_limit');
  return records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

async function canonicalDirectory(path) {
  if (!isAbsolute(path || '')) fail('bundle_absolute_directory_required');
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('bundle_directory_invalid');
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) fail('bundle_alias_path_forbidden');
  return canonical;
}

async function fileBytes(root, path) {
  const absolute = resolve(root, safeRelativePath(path));
  if (!within(root, absolute)) fail('bundle_path_outside_root');
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('bundle_regular_file_required');
  if (!samePath(await realpath(absolute), absolute)) fail('bundle_alias_path_forbidden');
  if (before.size > 16 * 1024 * 1024) fail('bundle_file_size_limit');
  const bytes = await readFile(absolute);
  const after = await lstat(absolute);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
    || after.isSymbolicLink() || !samePath(await realpath(absolute), absolute)) fail('bundle_source_changed_during_read');
  return bytes;
}

async function treeFiles(root) {
  const paths = [];
  const walk = async directory => {
    await canonicalDirectory(directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      if (item.isSymbolicLink()) fail('bundle_alias_path_forbidden');
      if (item.isDirectory()) await walk(absolute);
      else if (item.isFile()) paths.push(safeRelativePath(slash(relative(root, absolute))));
      else fail('bundle_regular_file_required');
    }
  };
  await walk(root);
  return paths.sort();
}

function json(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('bundle_dependency_metadata_invalid'); }
}

function verifyLocks(contents) {
  const pkg = json(contents.get(runtimeRoot + 'package.json'));
  const lock = json(contents.get(runtimeRoot + 'package-lock.json'));
  const dependency = json(contents.get(packageRoot + 'package.json'));
  const deno = json(contents.get(runtimeRoot + 'deno.lock'));
  if (pkg.name !== 'compute-client-state-runtime' || pkg.type !== 'module'
    || JSON.stringify(pkg.dependencies) !== JSON.stringify({ postgres: '3.4.7' })
    || lock.lockfileVersion !== 3 || JSON.stringify(Object.keys(lock.packages || {}).sort()) !== JSON.stringify(['', 'node_modules/postgres'])
    || JSON.stringify(lock.packages?.['']?.dependencies) !== JSON.stringify({ postgres: '3.4.7' })
    || lock.packages?.['node_modules/postgres']?.version !== '3.4.7'
    || !/^sha512-[A-Za-z0-9+/=]+$/.test(lock.packages?.['node_modules/postgres']?.integrity || '')
    || dependency.name !== 'postgres' || dependency.version !== '3.4.7'
    || deno.version !== '5' || deno.specifiers?.['npm:postgres@3.4.7'] !== '3.4.7'
    || !/^sha512-[A-Za-z0-9+/=]+$/.test(deno.npm?.['postgres@3.4.7']?.integrity || '')) fail('bundle_frozen_dependency_contract_invalid');
}

function bundleManifest(records, reviewedDigest) {
  const body = {
    schema: BUNDLE_SCHEMA,
    reviewed_startup_source_sha256: reviewedDigest,
    entry_points: [...BUNDLE_ENTRY_POINTS],
    files: records.map(({ path, kind, bytes, sha256: fileDigest }) => ({ path, kind, bytes, sha256: fileDigest })),
    policy: {
      artifact_kind: 'SOURCE_AND_NODE_DEPENDENCY_BUNDLE',
      reviewed_source_bytes_only: true,
      repository_layout_preserved: true,
      credentials_included: false,
      database_included: false,
      private_config_included: false,
      binary_runtime_included: false,
      deno_dependency_cache_included: false,
      provider_bootstrap_included: false,
      installed_client_qualified: false,
      process_code_attested: false,
      publisher_release_authority: false,
      authority_effect: false,
    },
  };
  return { ...body, bundle_sha256: sha256(JSON.stringify(body)) };
}

export async function stageRuntimeSourceBundle({ repositoryRoot, stagingDirectory, startupManifest, expectedSourceDigest }) {
  const root = await canonicalDirectory(repositoryRoot);
  const stage = await canonicalDirectory(stagingDirectory);
  if (within(root, stage) || within(stage, root)) fail('bundle_external_stage_required');
  if ((await readdir(stage)).length !== 0) fail('bundle_empty_stage_required');
  const records = reviewedBundlePlan(startupManifest, expectedSourceDigest);
  const closure = await sourceClosure(BUNDLE_ENTRY_POINTS.map(name => join(root, name)), root);
  const reviewedSources = records.filter(record => record.kind === 'source').map(record => record.path).sort();
  if (JSON.stringify(closure.files.map(file => slash(relative(root, file))).sort()) !== JSON.stringify(reviewedSources)
    || JSON.stringify(closure.npm) !== JSON.stringify(['npm:postgres@3.4.7'])) fail('bundle_reviewed_source_closure_mismatch');
  const dependencyFiles = (await treeFiles(join(root, packageRoot))).map(name => packageRoot + name);
  if (JSON.stringify(dependencyFiles.sort()) !== JSON.stringify(records.filter(record => record.kind === 'dependency').map(record => record.path).sort())) fail('bundle_unreviewed_dependency_file');
  const contents = new Map();
  for (const record of records) {
    const bytes = await fileBytes(root, record.path);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) fail('bundle_reviewed_file_digest_mismatch');
    const text = bytes.toString('utf8');
    if (/(?:\b(?:sbp_|ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----)/.test(text)
      || (record.kind === 'source' && /postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]+@/.test(text))) fail('bundle_private_literal_forbidden');
    contents.set(record.path, bytes);
  }
  verifyLocks(contents);
  if ((await readdir(stage)).length !== 0) fail('bundle_empty_stage_required');
  for (const record of records) {
    const target = join(stage, record.path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await canonicalDirectory(resolve(target, '..'));
    await writeFile(target, contents.get(record.path), { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode: 0o644 });
  }
  const manifest = bundleManifest(records, expectedSourceDigest);
  await writeFile(join(stage, BUNDLE_MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  await verifyRuntimeSourceBundle({ stagingDirectory: stage, startupManifest, expectedSourceDigest, expectedBundleDigest: manifest.bundle_sha256 });
  return manifest;
}

export async function verifyRuntimeSourceBundle({ stagingDirectory, startupManifest, expectedSourceDigest, expectedBundleDigest }) {
  if (!digestPattern.test(expectedBundleDigest || '')) fail('bundle_explicit_bundle_digest_required');
  const stage = await canonicalDirectory(stagingDirectory);
  const records = reviewedBundlePlan(startupManifest, expectedSourceDigest);
  const expected = bundleManifest(records, expectedSourceDigest);
  if (expected.bundle_sha256 !== expectedBundleDigest) fail('bundle_expected_digest_mismatch');
  const manifest = json(await fileBytes(stage, BUNDLE_MANIFEST_FILE));
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) fail('bundle_manifest_mismatch');
  const names = await treeFiles(stage);
  if (JSON.stringify(names) !== JSON.stringify([...records.map(record => record.path), BUNDLE_MANIFEST_FILE].sort())) fail('bundle_unexpected_staged_file');
  const contents = new Map();
  for (const record of records) {
    const bytes = await fileBytes(stage, record.path);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) fail('bundle_staged_file_digest_mismatch');
    contents.set(record.path, bytes);
  }
  verifyLocks(contents);
  return expected;
}
