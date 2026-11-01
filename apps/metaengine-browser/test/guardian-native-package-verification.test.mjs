import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { verifyStagedGuardianRuntime } = createRequire(import.meta.url)('../scripts/guardian-native-package-verification.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const head = 'a'.repeat(40), version = '0.7.0-dev.12345.1';
// Synthetic staged files exercise byte binding only; they are not PE binaries
// and cannot enter the live PowerShell producer context.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-package-binding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), bytes); };
  const json = (file, value) => write(file, JSON.stringify(value));
  const binding = { contract: 'metaengine.guardian.static-crypto-link-input.v1', build_source_head: head };
  for (const key of ['producer_proof_sha256', 'source_lock_sha256', 'verifier_source_sha256', 'public_header_sha256', 'libcrypto_sha256', 'verifier_archive_sha256']) binding[key] = sha(key);
  const binaries = ['METAENGINEBrowserGuardian.exe', 'METAENGINEBrowserGuardianConfigure.exe'].map(name => {
    const bytes = Buffer.from(name); write(`guardian/${name}`, bytes);
    return { name, sha256: sha(bytes), size: bytes.length };
  });
  const service = { schema: 'metaengine.browser.guardian-native-staging-manifest.v1', source_head: head,
    package_version: version, static_crypto: binding, unlinked_test_build: false, binaries };
  json('guardian/guardian-native-manifest.json', service);
  const peer = { schema: 'metaengine.browser-guardian.peer-native-staging-manifest.v1', source_head: head,
    static_crypto: binding, unlinked_test_build: false, name: 'guardian-connected-peer.node', napi_version: 9, sha256: sha('peer'), bytes: 4 };
  write('guardian-peer/guardian-connected-peer.node', 'peer'); json('guardian-peer/guardian-peer-native-staging-manifest.json', peer);
  const bootstrap = { schema: 'metaengine.browser-guardian.machine-bootstrap-binding.v1', source_head: head,
    package_version: version, static_crypto: binding, unlinked_test_build: false,
    guardian_manifest_sha256: sha(JSON.stringify(service)), service_sha256: binaries[0].sha256, configurator_sha256: binaries[1].sha256,
    bootstrap_name: `METAENGINE-Guardian-Bootstrap-${version}-x64.exe`, bootstrap_sha256: sha('bootstrap'), bootstrap_size: 9 };
  write(`guardian-bootstrap/${bootstrap.bootstrap_name}`, 'bootstrap'); json('guardian-bootstrap/guardian-machine-bootstrap-binding.json', bootstrap);
  return { directory, write, json, service, peer, bootstrap, verify: () => verifyStagedGuardianRuntime({ directory, sourceHead: head, packageVersion: version }) };
}
test('staged peer, service and actual bootstrap file bytes agree', t => {
  const f = fixture(t); assert.deepEqual(f.verify().binding, f.service.static_crypto);
  // Native connected-peer uniqueString requires these keys to occur once in
  // the complete signed staging document, including nested build evidence.
  for (const key of ['schema', 'source_head', 'package_version']) {
    assert.equal((JSON.stringify(f.service).match(new RegExp(`\"${key}\"`, 'g')) || []).length, 1);
  }
});
for (const name of ['guardian/METAENGINEBrowserGuardian.exe', 'guardian/METAENGINEBrowserGuardianConfigure.exe', 'guardian-peer/guardian-connected-peer.node', `guardian-bootstrap/METAENGINE-Guardian-Bootstrap-${version}-x64.exe`]) {
  test(`reject changed actual staged bytes: ${name}`, t => { const f = fixture(t); f.write(name, 'drift'); assert.throws(f.verify, /binary_digest_mismatch/); });
}
for (const [label, mutate, file] of [
  ['unlinked peer', f => { f.peer.unlinked_test_build = true; return f.peer; }, 'guardian-peer/guardian-peer-native-staging-manifest.json'],
  ['old peer source', f => { f.peer.source_head = 'b'.repeat(40); return f.peer; }, 'guardian-peer/guardian-peer-native-staging-manifest.json'],
  ['different crypto build', f => { f.peer.static_crypto = { ...f.peer.static_crypto, libcrypto_sha256: 'b'.repeat(64) }; return f.peer; }, 'guardian-peer/guardian-peer-native-staging-manifest.json'],
  ['duplicate service rows', f => { f.service.binaries[1] = f.service.binaries[0]; return f.service; }, 'guardian/guardian-native-manifest.json'],
  ['bootstrap bound to other service', f => { f.bootstrap.service_sha256 = '0'.repeat(64); return f.bootstrap; }, 'guardian-bootstrap/guardian-machine-bootstrap-binding.json'],
  ['bootstrap path traversal', f => { f.bootstrap.bootstrap_name = '../outside.exe'; return f.bootstrap; }, 'guardian-bootstrap/guardian-machine-bootstrap-binding.json'],
]) test(`reject ${label}`, t => { const f = fixture(t); f.json(file, mutate(f)); assert.throws(f.verify, /guardian_staged_/); });
