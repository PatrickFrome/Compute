import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureOfflineRuntimeInventory, stageOfflineRuntimeBundle, verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const origins = {
  node: { version: '24.21.0', url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip', archive_sha256: 'a'.repeat(64) },
  deno: { version: '2.9.7', url: 'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip', archive_sha256: 'b'.repeat(64) },
  postgresql: { version: '17.11.0', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip', archive_sha256: 'c'.repeat(64) },
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compute-offline-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, bytes) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return target;
  };
  const host = 'export const host = true;\n';
  const sourceBody = { schema: 'compute.runtime-source-bundle.v1', reviewed_startup_source_sha256: 'd'.repeat(64),
    reviewed_startup_files_sha256: 'e'.repeat(64), entry_points: ['infra/client-state-runtime/runtime-host.mjs'],
    files: [{ path: 'infra/client-state-runtime/runtime-host.mjs', kind: 'source', bytes: Buffer.byteLength(host), sha256: digest(host) }],
    policy: { database_included: false, private_config_included: false, credentials_included: false } };
  const sourceManifest = { ...sourceBody, bundle_sha256: digest(JSON.stringify(sourceBody)) };
  await put('source/infra/client-state-runtime/runtime-host.mjs', host);
  await put('source/runtime-source-bundle.json', JSON.stringify(sourceManifest));
  await put('node/node.exe', 'synthetic-node-binary');
  await put('node/LICENSE', 'Copyright Node.js\n'.repeat(40));
  const denoExecutable = await put('deno/deno.exe', 'synthetic-deno-binary');
  await put('licenses/deno-LICENSE.txt', 'Copyright Deno\n'.repeat(40));
  await put('licenses/postgresql-COPYRIGHT.txt', 'Copyright PostgreSQL\n'.repeat(40));
  for (const name of ['postgres', 'psql', 'pg_ctl', 'initdb', 'pg_config']) await put('pg/bin/' + name + '.exe', 'synthetic-' + name);
  await put('pg/share/postgres.bki', 'synthetic-schema');
  await put('pg/lib/plpgsql.dll', 'synthetic-extension');
  await put('cache/npm/registry.npmjs.org/postgres/3.4.7/package.json', JSON.stringify({ name: 'postgres', version: '3.4.7' }));
  await put('cache/npm/registry.npmjs.org/postgres/registry.json', JSON.stringify({ versions: ['3.4.7'] }));
  const stage = path.join(root, 'stage');
  await mkdir(stage);
  const sources = { sourceBundleDirectory: path.join(root, 'source'), nodeDirectory: path.join(root, 'node'),
    postgresDirectory: path.join(root, 'pg'), denoExecutable, denoNpmDirectory: path.join(root, 'cache/npm'), licenseDirectory: path.join(root, 'licenses') };
  const options = { sources, sourceBundleDigest: sourceManifest.bundle_sha256, componentOrigins: origins };
  const inventory = await captureOfflineRuntimeInventory(options);
  return { root, stage, sources, options, inventory };
}

test('offline resource bundle binds source, binaries, cache and licenses with no private state', async t => {
  const f = await fixture(t);
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: f.stage, sources: f.sources,
    inventory: f.inventory, expectedInventoryDigest: f.inventory.inventory_sha256 });
  const verified = await verifyOfflineRuntimeBundle({ bundleDirectory: f.stage, expectedBundleDigest: manifest.bundle_sha256 });
  assert.deepEqual(verified.manifest, manifest);
  assert.equal(verified.paths.hostEntry, path.join(await realpath(f.stage), 'source/infra/client-state-runtime/runtime-host.mjs'));
  assert.equal(manifest.policy.database_included, false);
  assert.equal(manifest.policy.private_config_included, false);
  assert.equal(manifest.policy.installed_client_qualified, false);
  assert.equal(JSON.stringify(manifest).includes(f.root), false, 'inventory must not disclose input absolute paths');
});

test('offline staging rejects changed source inventory and execution rejects changed binary bytes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.sources.nodeDirectory, 'node.exe'), 'mutated-node');
  await assert.rejects(stageOfflineRuntimeBundle({ stagingDirectory: f.stage, sources: f.sources,
    inventory: f.inventory, expectedInventoryDigest: f.inventory.inventory_sha256 }), /selected_file_digest_mismatch/);
  await writeFile(path.join(f.sources.nodeDirectory, 'node.exe'), 'synthetic-node-binary');
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: f.stage, sources: f.sources,
    inventory: f.inventory, expectedInventoryDigest: f.inventory.inventory_sha256 });
  await writeFile(path.join(f.stage, 'runtime/deno/deno.exe'), 'mutated-deno');
  await assert.rejects(verifyOfflineRuntimeBundle({ bundleDirectory: f.stage, expectedBundleDigest: manifest.bundle_sha256 }), /file_digest_mismatch/);
});

test('offline verifier rejects missing pins, extra/private files and resource aliases', async t => {
  const f = await fixture(t);
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: f.stage, sources: f.sources,
    inventory: f.inventory, expectedInventoryDigest: f.inventory.inventory_sha256 });
  await assert.rejects(verifyOfflineRuntimeBundle({ bundleDirectory: f.stage }), /explicit_digest_required/);
  await writeFile(path.join(f.stage, 'extra.txt'), 'unexpected');
  await assert.rejects(verifyOfflineRuntimeBundle({ bundleDirectory: f.stage, expectedBundleDigest: manifest.bundle_sha256 }), /unexpected_file/);
  await rm(path.join(f.stage, 'extra.txt'));
  await mkdir(path.join(f.stage, 'private'));
  await writeFile(path.join(f.stage, 'private/config.json'), '{}');
  await assert.rejects(verifyOfflineRuntimeBundle({ bundleDirectory: f.stage, expectedBundleDigest: manifest.bundle_sha256 }), /private_path_forbidden/);
  await rm(path.join(f.stage, 'private'), { recursive: true });
  const alias = path.join(f.root, 'alias');
  await symlink(f.stage, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyOfflineRuntimeBundle({ bundleDirectory: alias, expectedBundleDigest: manifest.bundle_sha256 }), /directory_invalid/);
});

test('a fresh frozen exact-version Deno cache does not require registry metadata', async t => {
  const f = await fixture(t);
  await rm(path.join(f.sources.denoNpmDirectory, 'registry.npmjs.org/postgres/registry.json'));
  const inventory = await captureOfflineRuntimeInventory(f.options);
  assert.equal(inventory.files.some(file => file.path.endsWith('/registry.json')), false);
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: f.stage, sources: f.sources,
    inventory, expectedInventoryDigest: inventory.inventory_sha256 });
  await verifyOfflineRuntimeBundle({ bundleDirectory: f.stage, expectedBundleDigest: manifest.bundle_sha256 });
  assert.ok(manifest.files.some(file => file.path.endsWith('/postgres/3.4.7/package.json')));
});
