import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPackage, extractFile } from '@electron/asar';
import bindingTools from '../scripts/offline-runtime-package-binding.cjs';
import { HEAD, VERSION, offlineRuntimePackageFixture, verifierRelativePath } from './fixtures/offline-runtime-package.mjs';

const { buildOfflineRuntimeBinding, assertPackagedOfflineRuntimeBinding } = bindingTools;
const build = f => buildOfflineRuntimeBinding({ ...f, sourceHead: HEAD, packageVersion: VERSION });
const verify = (f, binding, extra = {}) => assertPackagedOfflineRuntimeBinding(binding, {
  expectedHead: HEAD, packageVersion: VERSION, resourcesDir: f.resourcesDir, verifierBytes: f.verifierBytes, ...extra,
});

test('ASAR metadata seals actual offline source, runtime bytes and the protected verifier', async t => {
  const f = await offlineRuntimePackageFixture(t);
  const binding = await build(f);
  assert.equal(binding.schema, 'metaengine.browser.client-state-runtime-binding.v1');
  assert.equal(binding.bundle_sha256, f.manifest.bundle_sha256);
  assert.equal(binding.resource_file_count, f.manifest.files.length);
  assert.equal(binding.runtime_verifier_relative_path, verifierRelativePath);
  const appRoot = path.join(f.root, 'app');
  await f.put('app/package.json', JSON.stringify({ version: VERSION, metaengineClientStateRuntime: binding }));
  await f.put('app/' + verifierRelativePath, f.verifierBytes);
  const asarFile = path.join(f.root, 'app.asar');
  await createPackage(appRoot, asarFile);
  // Build-node's checkout has changed. The after-pack verifier must still use
  // the exact independently extracted ASAR module, never this new checkout.
  await writeFile(path.join(f.repoRoot, verifierRelativePath), 'throw new Error("checkout fallback executed");');
  const packageJson = JSON.parse(extractFile(asarFile, 'package.json'));
  const proof = await verify(f, packageJson.metaengineClientStateRuntime, { verifierBytes: extractFile(asarFile, verifierRelativePath.split('/').join(path.sep)) });
  assert.equal(proof.protected_asar_binding_present, true);
  assert.equal(proof.packaged_resources_verified, true);
  assert.equal(proof.runtime_verifier_sha256, binding.runtime_verifier_sha256);
  assert.equal(proof.resource_size_bytes, f.manifest.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(proof.installed_client_qualified, false);
  assert.equal(proof.publisher_provenance_verified, false);
  assert.equal(proof.authority_effect, false);
});

test('before-pack refuses staged byte drift and a stale checkout source bundle', async t => {
  const f = await offlineRuntimePackageFixture(t);
  await writeFile(path.join(f.bundleDirectory, 'runtime/node/node.exe'), 'tampered');
  await assert.rejects(build(f), /offline_bundle_file_digest_mismatch/);
  await writeFile(path.join(f.bundleDirectory, 'runtime/node/node.exe'), 'synthetic-node-binary');
  await writeFile(path.join(f.repoRoot, 'infra/client-state-runtime/runtime-host.mjs'), 'changed checkout');
  await assert.rejects(build(f), /client_state_runtime_checkout_bytes_mismatch/);
});

test('after-pack refuses changed resources, manifest formatting and verifier bytes', async t => {
  const f = await offlineRuntimePackageFixture(t);
  const binding = await build(f);
  await assert.rejects(verify(f, binding, { verifierBytes: Buffer.from('throw new Error("untrusted verifier executed");') }), /verifier_bytes_mismatch/);
  await assert.rejects(verify(f, binding, { verifierBytes: undefined }), /verifier_bytes_mismatch/);
  await writeFile(path.join(f.bundleDirectory, 'runtime/deno/deno.exe'), 'tampered');
  await assert.rejects(verify(f, binding), /offline_bundle_file_digest_mismatch/);
  await writeFile(path.join(f.bundleDirectory, 'runtime/deno/deno.exe'), 'synthetic-deno-binary');
  const manifestFile = path.join(f.bundleDirectory, 'offline-runtime-bundle.json');
  await writeFile(manifestFile, (await readFile(manifestFile, 'utf8')) + '\n');
  await assert.rejects(verify(f, binding), /manifest_bytes_mismatch/);
});

test('after-pack rejects mismatched protected metadata and resource inventory totals', async t => {
  const f = await offlineRuntimePackageFixture(t);
  const binding = await build(f);
  for (const [change, pattern] of [
    [{ source_head_sha: 'b'.repeat(40) }, /source_head_mismatch/],
    [{ package_version: '0.7.0-dev.1.1' }, /version_mismatch/],
    [{ authority_effect: true }, /contract_invalid/],
    [{ runtime_verifier_relative_path: '../outside.mjs' }, /contract_invalid/],
    [{ resource_file_count: binding.resource_file_count + 1 }, /resource_inventory_mismatch/],
    [{ source_bundle_sha256: 'b'.repeat(64) }, /source_binding_mismatch/],
  ]) await assert.rejects(verify(f, { ...binding, ...change }), pattern);
});
