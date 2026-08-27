import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = 'coordination/chat-control-plane/extension';
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('runtime-package-manifest.json'));
const entry = read('background-entry.js');
const registry = read('target-registry.js');

function extensionIdFromKey(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return [...digest].map((byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join('');
}

assert.equal(manifest.version, '0.7.0');
assert.equal(pkg.package_version, '0.7.0');
assert.equal(pkg.operator_runtime, '0.7.0-dev.1');
assert.equal(extensionIdFromKey(manifest.key), 'bgklkgkbpkgnjnjjkmemdgmekhhejglo');
assert.equal(manifest.incognito, 'not_allowed');

assert.match(entry, /importScripts\("\.\/runtime-marker\.js"\);\s*importScripts\("\.\/target-registry\.js"\);\s*importScripts\("\.\/bridge-runtime\.js"\);/s);
assert.doesNotMatch(entry, /-v\d{3}\.js/);
assert.ok(pkg.files.includes('target-registry.js'));
assert.equal(new Set(pkg.files).size, pkg.files.length);
for (const name of pkg.files) {
  assert.doesNotMatch(name, /-v\d{3}(?:\.|$)/i, `versioned package file: ${name}`);
  assert.ok(fs.existsSync(path.join(root, name)), `package file missing: ${name}`);
}

const runtimeMarker = read('runtime-marker.js');
assert.match(runtimeMarker, /const RUNTIME = "0\.7\.0-dev\.1"/);
assert.match(runtimeMarker, /milestone: "R3_TARGET_REGISTRY_V1"/);
const runtimeOwners = pkg.files.filter((name) => fs.readFileSync(path.join(root, name), 'utf8').includes('0.7.0-dev.1'));
assert.deepEqual(runtimeOwners, ['runtime-marker.js']);

for (const marker of [
  'metaengine.a2-browser-operator.target-registry.v1',
  'a2TargetRegistryV1',
  'a2TargetBindingsV1',
  'browser_session_nonce',
  'gpt_primary',
  'glm_primary',
  'conversation_epoch',
  'target_registry_duplicate_active_url',
  'target_tab_binding_mismatch',
  'chrome.storage.session',
  'sender?.tab?.id',
  'runtime-core owns its response contract'
]) assert.ok(registry.includes(marker), `target registry invariant missing: ${marker}`);

assert.doesNotMatch(registry, /document\.|querySelector|innerText|textContent/, 'registry must not derive authority from page DOM');
assert.doesNotMatch(registry, /eval\s*\(|new Function|executeScript/, 'registry must not execute arbitrary code');

const runtimeCore = read('runtime-core.js');
assert.match(runtimeCore, /STRICT_GLM_FIRST_ACTUATED_V1/);
assert.match(runtimeCore, /FAILED_DURABLE_AMBIGUOUS_NO_RETRY/);
assert.match(runtimeCore, /const runtimeDescriptor = globalThis\.A2_RUNTIME/);

const trustedSupervisor = read('trusted-supervisor-chat.js');
for (const marker of ['PRE_ENTER_DURABLE', 'AMBIGUOUS_NO_RETRY', 'Input.dispatchKeyEvent', 'ACTUATED']) assert.ok(trustedSupervisor.includes(marker));
const trustedGlm = read('trusted-glm.js');
assert.doesNotMatch(trustedGlm, /chrome\.tabs\.reload\s*\(/);
assert.match(trustedGlm, /mousePressed/);
assert.match(trustedGlm, /mouseReleased/);

const bootstrap = read('bootstrap-config.js');
for (const marker of ['bridgeSecret: ""', 'supervisorBootstrapSecret: ""', 'pairingEpoch: ""']) assert.ok(bootstrap.includes(marker));
for (const name of pkg.files) {
  const text = read(name);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']/i, `service role material in ${name}`);
  assert.doesNotMatch(text, /["']d["']\s*:\s*["'][A-Za-z0-9_-]{20,}["']/, `private JWK material in ${name}`);
}

console.log('A2 v0.7.0 release / target identity contract: PASS', {
  extension_id: extensionIdFromKey(manifest.key),
  package_files: pkg.files.length,
  runtime: pkg.operator_runtime,
  target_registry: true
});
