import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { captureStartupSource } from './startup-source-manifest.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (path) => path.replaceAll('\\', '/');

async function fileDigest(path, root, kind) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('runtime_binding_regular_file_required');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return { path: normalize(relative(root, path)), path_base: kind === 'runtime_source' ? 'repository' : 'workspace',
    kind, bytes: info.size, sha256: digest.digest('hex') };
}

function gitEvidence(repoRoot) {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error('runtime_binding_git_identity_unavailable');
    return result.stdout.trim();
  };
  const head = run(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('runtime_binding_git_head_invalid');
  const status = run(['status', '--porcelain=v1', '--untracked-files=normal']);
  return { head, dirty: status.length > 0, status_sha256: sha(status), status_scope: 'entire_repository' };
}

async function sourceFiles(repoRoot) {
  const files = new Set();
  const visit = async (path) => {
    path = resolve(path);
    const rel = relative(repoRoot, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('runtime_source_outside_repository');
    if (files.has(path)) return;
    files.add(path);
    const content = await readFile(path, 'utf8');
    for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const next = resolve(path, '..', match[1]);
      if (/\.(mjs|js|ts|json)$/.test(next)) await visit(next);
    }
  };
  for (const path of [
    'infra/client-state-runtime/db-api.mjs', 'infra/client-state-runtime/launcher.mjs',
    'infra/client-state-runtime/native-supervisor.integration.test.mjs', 'infra/client-state-runtime/runtime-verification-bindings.mjs',
    'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts',
  ]) await visit(resolve(repoRoot, path));
  for (const name of ['package.json', 'package-lock.json']) files.add(resolve(repoRoot, 'infra/client-state-runtime', name));
  const postgresDir = resolve(repoRoot, 'infra/client-state-runtime/node_modules/postgres');
  files.add(resolve(postgresDir, 'package.json'));
  for (const name of await readdir(resolve(postgresDir, 'src'))) {
    if (name.endsWith('.js')) files.add(resolve(postgresDir, 'src', name));
  }
  return [...files].sort();
}

export function classifyRuntimeBindings({ missing = [], startupMatched = false, diskStable = false } = {}) {
  if (missing.length) return { level: 'SMOKE_ONLY', complete_bindings: false, process_code_attested: false };
  return { level: startupMatched && diskStable ? 'STARTUP_MANIFEST_BOUND_SMOKE' : 'SOURCE_BOUND_SMOKE',
    complete_bindings: true, process_code_attested: false };
}

export async function collectRuntimeBindings({ repoRoot, workspaceRoot, paths = {}, expectedInstanceId, endpoint, apiEndpoint, apiKey } = {}) {
  const missing = [];
  const manifest = [];
  const documents = {};
  for (const [label, kind] of [['restore', 'restore_receipt'], ['migrations', 'migration_receipt'], ['runtime', 'launcher_status'], ['startup', 'startup_manifest'], ['launcher', 'launcher_entry'], ['deno', 'runtime_binary']]) {
    const path = paths[label];
    if (!path) { if (label !== 'startup') missing.push(label + '_path'); continue; }
    if (!isAbsolute(path)) throw new Error('runtime_binding_absolute_path_required');
    manifest.push({ label, ...await fileDigest(path, workspaceRoot, kind) });
    if (['restore', 'migrations', 'runtime', 'startup'].includes(label)) documents[label] = JSON.parse(await readFile(path, 'utf8'));
  }
  for (const path of await sourceFiles(repoRoot)) manifest.push(await fileDigest(path, repoRoot, 'runtime_source'));
  manifest.push({ label: 'node', ...await fileDigest(process.execPath, workspaceRoot, 'runtime_binary') });
  manifest.sort((a, b) => (a.kind + ':' + a.path).localeCompare(b.kind + ':' + b.path, 'en'));
  const runtime = documents.runtime;
  if (!expectedInstanceId) missing.push('expected_instance_id');
  if (runtime && ((expectedInstanceId && runtime.instance_id !== expectedInstanceId) || runtime.endpoint !== endpoint || runtime.state !== 'READY')) throw new Error('runtime_binding_launcher_instance_mismatch');
  if (documents.restore && documents.restore.data_verified !== true) throw new Error('runtime_binding_restore_data_unverified');
  if (documents.migrations && (!Array.isArray(documents.migrations.migrations) || documents.migrations.original_dump_modified !== false)) throw new Error('runtime_binding_migrations_invalid');
  const edgeResponse = await fetch(endpoint + '/health');
  const edge = await edgeResponse.json();
  const selectedInstanceId = expectedInstanceId || edge.instance_id;
  if (edgeResponse.status !== 200 || edge.instance_id !== selectedInstanceId || edge.state_provider !== 'LOCAL_POSTGRES' || edge.runtime_ready !== true) throw new Error('runtime_binding_edge_health_mismatch');
  if (runtime && runtime.instance_id !== selectedInstanceId) throw new Error('runtime_binding_launcher_instance_mismatch');
  let startup;
  if (documents.startup) {
    const launched = documents.startup;
    if (launched.schema !== 'compute.runtime-startup-manifest.v1' || launched.instance_id !== selectedInstanceId || launched.endpoint !== endpoint
      || launched.stable_during_startup !== true || launched.private_material_included !== false || launched.source?.manifest_sha256 !== launched.source_manifest_sha256) throw new Error('runtime_binding_startup_manifest_invalid');
    const current = await captureStartupSource({ repositoryRoot: repoRoot, entries: [resolve(repoRoot, 'infra/client-state-runtime/launcher.mjs'),
      resolve(repoRoot, 'infra/client-state-runtime/db-api.mjs'), resolve(repoRoot, 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts')],
      nodePath: process.execPath, denoPath: paths.deno, denoLockPath: resolve(repoRoot, 'infra/client-state-runtime/deno.lock'), policy: launched.source.policy });
    const expectedFiles = launched.source.files.filter((file) => !['binary/postgres', 'binary/psql'].includes(file.id));
    if (JSON.stringify(expectedFiles) !== JSON.stringify(current.files)) throw new Error('runtime_binding_startup_source_mismatch');
    startup = { matched: true, source_manifest_sha256: launched.source_manifest_sha256, checked_files: current.files.length,
      stable_during_startup: true, process_code_attested: false, limits: launched.source.limitations,
      postgres_binaries_compared_during_probe: false };
  }
  let api;
  if (!apiEndpoint || !apiKey) missing.push('authenticated_api_health');
  else {
    const response = await fetch(apiEndpoint + '/health', { headers: { apikey: apiKey } });
    api = await response.json();
    if (response.status !== 200 || api.instance_id !== selectedInstanceId || api.mode !== 'LOCAL_POSTGRES' || api.ok !== true) throw new Error('runtime_binding_api_health_mismatch');
  }
  return {
    acquired_at: new Date().toISOString(), git: gitEvidence(repoRoot), missing, manifest,
    source_tree_sha256: sha(JSON.stringify(manifest.filter((file) => file.kind === 'runtime_source'))),
    manifest_sha256: sha(JSON.stringify(manifest)),
    health: { endpoint, api_endpoint: apiEndpoint || null, instance_id: selectedInstanceId,
      edge_status: edgeResponse.status, edge_health_sha256: sha(JSON.stringify(edge)),
      api_health_sha256: api ? sha(JSON.stringify(api)) : null,
      db_capability_health: edge.capability_health || null,
    },
    restore: documents.restore ? { source_snapshot_id: documents.restore.source_snapshot_id, source_dump_sha256: documents.restore.source_dump_sha256,
      source_inventory_sha256: documents.restore.source_inventory_sha256, data_verified: documents.restore.data_verified,
      reported_schema_verified: documents.restore.schema_verified, ddl_adaptations: documents.restore.ddl_adaptations } : null,
    migrations: documents.migrations ? { source_sha256: documents.migrations.migrations.map((entry) => ({ source: entry.source, source_sha256: entry.source_sha256, signature: entry.signature, status: entry.status })) } : null,
    startup,
    limitations: [
      'Health attests the database capability contract and selected runtime instance, not loaded process code bytes.',
      startup ? 'Current source and npm dependency bytes match the launch manifest; loaded process memory is not attested.' : 'No matching startup source manifest was supplied; current disk hashes do not establish startup bytes.',
      startup ? 'Deno npm cache source is measured, but compiled cache and in-memory code are not measured.' : 'Deno npm cache and in-memory code were not measured; Node PostgreSQL disk source is included.',
      'Private configuration and credential-derived hashes are excluded from this report.',
    ],
  };
}

export function finishRuntimeBindings(before, after) {
  const diskStable = before.manifest_sha256 === after.manifest_sha256;
  if (!diskStable || before.source_tree_sha256 !== after.source_tree_sha256) throw new Error('runtime_binding_source_changed_during_probes');
  if (before.git.head !== after.git.head || before.git.status_sha256 !== after.git.status_sha256
    || before.health.instance_id !== after.health.instance_id || before.health.endpoint !== after.health.endpoint
    || before.health.edge_health_sha256 !== after.health.edge_health_sha256 || before.health.api_health_sha256 !== after.health.api_health_sha256) throw new Error('runtime_binding_candidate_changed_during_probes');
  const missing = [...new Set([...before.missing, ...after.missing])];
  const startupMatched = before.startup?.matched === true && after.startup?.matched === true
    && before.startup.source_manifest_sha256 === after.startup.source_manifest_sha256;
  return { ...classifyRuntimeBindings({ missing, diskStable, startupMatched }), disk_bytes_stable_during_probes: diskStable, startup_source_manifest_available: startupMatched,
    missing, before, after };
}
