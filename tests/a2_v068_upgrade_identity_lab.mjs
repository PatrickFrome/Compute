import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const ext = 'coordination/chat-control-plane/extension/';
const read = (p) => fs.readFileSync(p, 'utf8');
const manifest = JSON.parse(read(ext + 'manifest.json'));
const identity = read(ext + 'device-identity-v067.js');
const transport = read(ext + 'supervisor-device-transport-v068.js');
const supervisor = read(ext + 'supervisor-client-v063-authority.js');

assert.equal(manifest.version, '0.6.8');
assert.equal(typeof manifest.key, 'string');
assert.ok(manifest.key.length > 100, 'stable manifest key required for unpacked upgrade identity');

const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
const alphabet = 'abcdefghijklmnop';
const extensionId = [...digest].map((b) => alphabet[b >> 4] + alphabet[b & 15]).join('');
assert.equal(extensionId, 'bgklkgkbpkgnjnjjkmemdgmekhhejglo', 'development extension ID drifted');

for (const required of [
  'const DB_NAME = "metaengine-a2-device-identity"',
  'const KEYPAIR_ID = "p256_keypair_v1"',
  'const META_ID = "enrollment_v1"',
  'indexedDB.open(DB_NAME, DB_VERSION)',
  'pair.privateKey.extractable === true',
  'A2_DEVICE_SIGN_REQUEST',
  'A2_DEVICE_ENROLL'
]) assert.ok(identity.includes(required), `upgrade identity contract missing: ${required}`);

assert.ok(transport.includes('chrome.storage.session.get(HOLD_KEY)'), 'terminal hold must remain session-scoped');
assert.ok(transport.includes('chrome.storage.session.remove(HOLD_KEY)'), 'terminal hold must be clearable without deleting durable device identity');
assert.ok(!transport.includes('chrome.storage.local.get(HOLD_KEY)'), 'terminal hold must not migrate into persistent local storage');

for (const required of [
  'async function resetSessionAuthority(reason)',
  'chrome.storage.session.set({ [MODE_KEY]: "OFF" })',
  'chrome.storage.local.set({ armed: false })',
  'resetSessionAuthority("install")',
  'return heartbeat()',
  'resetSessionAuthority("browser_start")'
]) assert.ok(supervisor.includes(required), `upgrade authority-reset contract missing: ${required}`);

const installIndex = supervisor.indexOf('resetSessionAuthority("install")');
const installHeartbeat = supervisor.indexOf('return heartbeat()', installIndex);
assert.ok(installIndex >= 0 && installHeartbeat > installIndex, 'update/install must reset authority before first heartbeat');

console.log('A2 v0.6.8 upgrade identity/authority contract: PASS', { extensionId });
