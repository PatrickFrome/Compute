import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
const ext = 'coordination/chat-control-plane/extension/';
const manifest = JSON.parse(read(ext + 'manifest.json'));
const entry = read(ext + 'background-entry.js');
const transport = read(ext + 'supervisor-device-transport-v068.js');

assert.equal(manifest.version, '0.6.8');
assert.ok(Number(manifest.minimum_chrome_version) >= 125);
assert.equal(manifest.incognito, 'not_allowed');
assert.ok(entry.includes('importScripts("./bridge-runtime-v068.js")'));
assert.ok(entry.includes('importScripts("./supervisor-device-transport-v068.js")'));
assert.ok(entry.includes('importScripts("./runtime-marker-v068.js")'));
assert.ok(read(ext + 'bridge-runtime-v068.js').includes('0.6.8-final.1'));
assert.ok(read(ext + 'runtime-marker-v068.js').includes('0.6.8-final.1'));

for (const required of [
  'DEVICE_SIGNED_NO_BEARER_FALLBACK',
  'SCOPED_SINGLE_USE_BOOTSTRAP_THEN_DEVICE_GRANT',
  'KNOWN_TERMINAL_SERVER_CAPABILITY_ONCE',
  'TERMINAL_RECONCILE_LIMIT = 1',
  'credentials: "omit"'
]) assert.ok(transport.includes(required), `missing v068 transport contract: ${required}`);

const bootstrap = read(ext + 'bootstrap-config.js');
assert.ok(bootstrap.includes('bridgeSecret: ""'));
assert.ok(bootstrap.includes('supervisorBootstrapSecret: ""'));
assert.ok(bootstrap.includes('pairingEpoch: ""'));
assert.ok(!/SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']/i.test(bootstrap));

const sidepanel = read(ext + 'sidepanel-supervisor.js');
const interval = sidepanel.match(/setInterval\(async \(\) => \{[\s\S]*?\n\s*\},\s*2500\);/)?.[0] || '';
assert.ok(interval.includes('refresh()'));
assert.ok(!interval.includes('A2_SUPERVISOR_POLL_NOW'));

const edge = read('supabase/functions/a2-browser-supervisor-v4/index.ts');
assert.ok(edge.includes('ALREADY_ENROLLED_RECOVERED'));
assert.ok(edge.includes('enrollment_recovery_after_rotation:true'));
assert.ok(edge.includes('metaengine.a2-browser-supervisor.health.v7'));

for (const name of fs.readdirSync(ext).filter((x) => x.endsWith('.js') || x.endsWith('.json'))) {
  const text = read(ext + name);
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']/i.test(text), `service role material in ${name}`);
  assert.ok(!/"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/.test(text), `private JWK material in ${name}`);
}

console.log('A2 v0.6.8 release contract: PASS');
