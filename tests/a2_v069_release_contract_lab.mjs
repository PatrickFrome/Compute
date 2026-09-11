import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = 'coordination/chat-control-plane/extension';
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('runtime-package-manifest.json'));

function extensionIdFromKey(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return [...digest].map((byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join('');
}

assert.equal(manifest.version, '0.6.9');
assert.equal(extensionIdFromKey(manifest.key), 'bgklkgkbpkgnjnjjkmemdgmekhhejglo');
assert.equal(manifest.incognito, 'not_allowed');
assert.ok(Number(manifest.minimum_chrome_version) >= 125);

const bootstrap = read('bootstrap-config.js');
for (const marker of ['bridgeSecret: ""', 'supervisorBootstrapSecret: ""', 'pairingEpoch: ""']) {
  assert.ok(bootstrap.includes(marker), `generic bootstrap not empty: ${marker}`);
}

const entry = read('background-entry.js');
assert.match(entry, /storage\.local\.setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
assert.match(entry, /storage\.session\.setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
assert.doesNotMatch(entry, /-v\d{3}\.js/);

const runtimeCore = read('runtime-core.js');
assert.match(runtimeCore, /STRICT_GLM_FIRST_ACTUATED_V1/);
assert.match(runtimeCore, /FAILED_DURABLE_AMBIGUOUS_NO_RETRY/);
assert.match(runtimeCore, /AMBIGUOUS_NO_RETRY/);

const transport = read('supervisor-device-transport.js');
for (const marker of [
  'DEVICE_SIGNED_NO_BEARER_FALLBACK',
  'SCOPED_SINGLE_USE_BOOTSTRAP_THEN_DEVICE_GRANT',
  'KNOWN_TERMINAL_SERVER_CAPABILITY_ONCE',
  'TERMINAL_RECONCILE_LIMIT = 1',
  'credentials: "omit"'
]) assert.ok(transport.includes(marker), `missing supervisor transport invariant: ${marker}`);

const trustedSupervisor = read('trusted-supervisor-chat.js');
for (const marker of ['PRE_ENTER_DURABLE', 'AMBIGUOUS_NO_RETRY', 'Input.dispatchKeyEvent', 'ACTUATED']) {
  assert.ok(trustedSupervisor.includes(marker), `missing supervisor actuation invariant: ${marker}`);
}
const pre = trustedSupervisor.indexOf('PRE_ENTER_DURABLE');
const keyDown = trustedSupervisor.indexOf('rawKeyDown', pre);
const actuated = trustedSupervisor.indexOf('"ACTUATED"', keyDown);
assert.ok(pre >= 0 && keyDown > pre && actuated > keyDown, 'durable pre-actuation ordering drifted');

const trustedGlm = read('trusted-glm.js');
assert.doesNotMatch(trustedGlm, /chrome\.tabs\.reload\s*\(/, 'GLM runtime must not auto-reload');
assert.match(trustedGlm, /mousePressed/);
assert.match(trustedGlm, /mouseReleased/);

const semantic = read('operator-semantic-actions.js');
assert.match(semantic, /backendNodeId/);
assert.match(semantic, /stale|frame/i);

for (const name of pkg.files) {
  const text = read(name);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']/i, `service role material in ${name}`);
  assert.doesNotMatch(text, /["']d["']\s*:\s*["'][A-Za-z0-9_-]{20,}["']/, `private JWK material in ${name}`);
}

console.log('A2 v0.6.9 release/safety contract: PASS', {
  extension_id: extensionIdFromKey(manifest.key),
  package_files: pkg.files.length,
  runtime: pkg.operator_runtime
});
