import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOfflineRuntimeInventory, stageOfflineRuntimeBundle } from '../../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import { PRIVATE_NATIVE_TOOL_REQUIRED_FILES, privateNativeToolsBinding, resolvePrivateNativeTools } from '../../src/private-native-tools-core.mjs';

export const HEAD = 'a'.repeat(40);
export const VERSION = '0.7.0-dev.37628000001.1';
export const verifierRelativePath = 'infra/client-state-runtime/offline-runtime-bundle.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function offlineRuntimePackageFixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'me2-offline-package-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, bytes) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return target;
  };
  // Inert generated package data only: exercise the real canonical manifest
  // producer/verifier without running fixture binaries or claiming a release.
  const components = [];
  const toolsRoot = path.join(root, 'resources/private-native-tools');
  for (const [id, entrypoint] of [['git', 'ucrt64/bin/git.exe'], ['codex', 'bin/codex.exe']]) {
    const extras = id === 'git' ? ['ucrt64/libexec/git-core/git-helper', 'ucrt64/etc/ssl/cert.pem',
      'ucrt64/etc/ssl/openssl.cnf', 'ucrt64/lib/ossl-modules/fixture.dll'] : [];
    const files = [];
    for (const name of [...new Set([...PRIVATE_NATIVE_TOOL_REQUIRED_FILES[id], ...extras])].sort()) {
      const bytes = Buffer.from('inert generated package resource: ' + id + '/' + name);
      await put('resources/private-native-tools/' + id + '/' + name, bytes);
      files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
    }
    components.push({ id, version: id === 'git' ? '2.56.0.4' : '0.166.0',
      repository: id === 'git' ? 'git-for-windows/git' : 'openai/codex', tag: 'generated-package-test',
      release_id: 1, asset_id: 2, archive_name: id + '.zip', archive_sha256: 'f'.repeat(64), archive_bytes: 1,
      entrypoint, files });
  }
  const toolsBytes = Buffer.from(JSON.stringify({ schema: 'metaengine.private-native-tools.v1',
    platform: 'win32', arch: 'x64', components }));
  await put('resources/private-native-tools/manifest.json', toolsBytes);
  const privateToolsBinding = privateNativeToolsBinding(toolsBytes);
  const privateTools = await resolvePrivateNativeTools({ toolsRoot, binding: privateToolsBinding });
  const host = 'export const host = true;\n';
  const firstRun = 'export const firstRun = true;\n';
  const support = 'export const support = true;\n';
  const sourceBody = { schema: 'compute.runtime-source-bundle.v1', reviewed_startup_source_sha256: 'd'.repeat(64),
    reviewed_startup_files_sha256: 'e'.repeat(64), entry_points: ['infra/client-state-runtime/runtime-host.mjs', 'infra/client-state-runtime/fresh-pg17-initdb.mjs', 'apps/metaengine-browser/src/remote-support-mcp.mjs'],
    files: [
      { path: 'infra/client-state-runtime/runtime-host.mjs', kind: 'source', bytes: Buffer.byteLength(host), sha256: digest(host) },
      { path: 'infra/client-state-runtime/fresh-pg17-initdb.mjs', kind: 'source', bytes: Buffer.byteLength(firstRun), sha256: digest(firstRun) },
      { path: 'apps/metaengine-browser/src/remote-support-mcp.mjs', kind: 'source', bytes: Buffer.byteLength(support), sha256: digest(support) },
    ],
    policy: { database_included: false, private_config_included: false, credentials_included: false } };
  const sourceManifest = { ...sourceBody, bundle_sha256: digest(JSON.stringify(sourceBody)) };
  await put('source/infra/client-state-runtime/runtime-host.mjs', host);
  await put('source/infra/client-state-runtime/fresh-pg17-initdb.mjs', firstRun);
  await put('source/apps/metaengine-browser/src/remote-support-mcp.mjs', support);
  await put('source/runtime-source-bundle.json', JSON.stringify(sourceManifest));
  await put('checkout/infra/client-state-runtime/runtime-host.mjs', host);
  await put('checkout/infra/client-state-runtime/fresh-pg17-initdb.mjs', firstRun);
  await put('checkout/apps/metaengine-browser/src/remote-support-mcp.mjs', support);
  const verifierBytes = await readFile(fileURLToPath(new URL('../../../../' + verifierRelativePath, import.meta.url)));
  await put('checkout/' + verifierRelativePath, verifierBytes);
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
  const bundleDirectory = path.join(root, 'resources/client-state-runtime');
  await mkdir(bundleDirectory, { recursive: true });
  const sources = { sourceBundleDirectory: path.join(root, 'source'), nodeDirectory: path.join(root, 'node'),
    postgresDirectory: path.join(root, 'pg'), denoExecutable, denoNpmDirectory: path.join(root, 'cache/npm'), licenseDirectory: path.join(root, 'licenses') };
  const componentOrigins = {
    node: { version: '24.21.0', url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip', archive_sha256: 'a'.repeat(64) },
    deno: { version: '2.9.7', url: 'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip', archive_sha256: 'b'.repeat(64) },
    postgresql: { version: '17.11.0', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip', archive_sha256: 'c'.repeat(64) },
  };
  const inventory = await captureOfflineRuntimeInventory({ sources, sourceBundleDigest: sourceManifest.bundle_sha256, componentOrigins, privateNativeToolsBinding: privateToolsBinding });
  const manifest = await stageOfflineRuntimeBundle({ stagingDirectory: bundleDirectory, sources,
    inventory, expectedInventoryDigest: inventory.inventory_sha256 });
  await privateTools.revalidate();
  return { root, put, toolsRoot, privateToolsBinding, bundleDirectory, repoRoot: path.join(root, 'checkout'), resourcesDir: path.join(root, 'resources'), verifierBytes, manifest, sources,
    copyBundle: async target => cp(bundleDirectory, target, { recursive: true }) };
}
