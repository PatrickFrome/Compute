import fs from 'node:fs';
import assert from 'node:assert/strict';

const ext = 'coordination/chat-control-plane/extension';
const read = (p) => fs.readFileSync(p, 'utf8');
const manifest = JSON.parse(read(`${ext}/manifest.json`));
const entry = read(`${ext}/background-entry.js`);
const transport = read(`${ext}/supervisor-device-transport-v063.js`);
const bootstrap = read(`${ext}/bootstrap-config.js`);
const edge = read('supabase/functions/a2-browser-supervisor-v4/index.ts');
const rotate = read('supabase/migrations/20260827143000_a2_browser_device_embedded_bootstrap_rotate_v5.sql');
const atomic = read('supabase/migrations/20260827141000_a2_browser_supervisor_atomic_result_v4.sql');

assert.equal(manifest.version, '0.6.5');
assert.ok(Number(manifest.minimum_chrome_version) >= 125);
assert.equal(manifest.incognito, 'not_allowed');
assert.match(entry, /importScripts\("\.\/bridge-runtime-v065\.js"\)/);
assert.match(entry, /importScripts\("\.\/runtime-marker-v065\.js"\)/);
assert.match(read(`${ext}/bridge-runtime-v065.js`), /0\.6\.5-final\.1/);
assert.match(read(`${ext}/runtime-marker-v065.js`), /0\.6\.5-final\.1/);

assert.match(transport, /SIGNED_BASE = "https:\/\/xpeibufgzjknrhbhpffp\.supabase\.co\/functions\/v1\/a2-browser-supervisor-v4"/);
assert.match(transport, /SIGNED_RUNTIME_PREFIX = "\/a2-browser-supervisor-v4"/);
assert.doesNotMatch(transport, /SIGNED_BASE = .*v4-canary/);
assert.match(transport, /DEVICE_SIGNED_NO_BEARER_FALLBACK/);

assert.match(bootstrap, /supervisorUrl: "https:\/\/xpeibufgzjknrhbhpffp\.supabase\.co\/functions\/v1\/a2-browser-supervisor-v4"/);
assert.match(bootstrap, /workspaceId: "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"/);
assert.match(bootstrap, /deviceProfile: "A2_DEVICE_HTTP_SIGNATURE_V1"/);
assert.match(bootstrap, /pairingEpoch: ""/);
assert.match(bootstrap, /bridgeSecret: ""/);

for (const f of fs.readdirSync(ext).filter((x) => x.endsWith('.js') || x.endsWith('.json'))) {
  const text = read(`${ext}/${f}`);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']/i, `service role material in ${f}`);
  assert.doesNotMatch(text, /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/, `private JWK material in ${f}`);
}

assert.match(edge, /SERVICE_MARKER='\/a2-browser-supervisor-v4'/);
assert.match(edge, /h205f22_a2_browser_device_rotate_embedded_bootstrap_v1/);
assert.match(edge, /h205f22_a2_browser_supervisor_complete_v4/);
assert.match(rotate, /BOOTSTRAP_ROTATED_TO_SERVER_DEVICE_GRANT/);
assert.match(atomic, /supervisor_lease_expired/);

console.log('a2_v065_release_contract_lab: PASS');
