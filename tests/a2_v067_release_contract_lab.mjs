import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
const ext = 'coordination/chat-control-plane/extension/';
const manifest = JSON.parse(read(ext + 'manifest.json'));

assert.equal(manifest.version, '0.6.7');
assert.ok(Number(manifest.minimum_chrome_version) >= 125);
assert.equal(manifest.incognito, 'not_allowed');
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('sidePanel'));

const entry = read(ext + 'background-entry.js');
for (const module of [
  'device-identity-v067.js', 'bridge-runtime-v067.js', 'supervisor-device-transport-v067.js',
  'runtime-marker-v067.js', 'supervisor-chat-session-v067.js', 'trusted-supervisor-chat-v067.js'
]) assert.ok(entry.includes(`importScripts("./${module}")`), `missing ${module}`);

const runtime = read(ext + 'runtime-marker-v067.js');
const bridge = read(ext + 'bridge-runtime-v067.js');
assert.ok(runtime.includes('0.6.7-final.1'));
assert.ok(bridge.includes('0.6.7-final.1'));

const bootstrap = read(ext + 'bootstrap-config.js');
assert.ok(bootstrap.includes('bridgeSecret: ""'));
assert.ok(bootstrap.includes('supervisorBootstrapSecret: ""'));
assert.ok(bootstrap.includes('pairingEpoch: ""'));
assert.ok(!bootstrap.includes('SUPABASE_SERVICE_ROLE_KEY'));

const sidepanel = read(ext + 'sidepanel-supervisor.js');
const periodic = sidepanel.match(/setInterval\(async \(\) => \{[\s\S]*?\n\s*\},\s*2500\);/)?.[0] || '';
assert.ok(periodic.includes('refresh()'));
assert.ok(!periodic.includes('A2_SUPERVISOR_POLL_NOW'));
assert.ok(sidepanel.includes('$("supervisorPoll")?.addEventListener'));

const edge = read('supabase/functions/a2-browser-supervisor-v4/index.ts');
assert.ok(edge.includes("browser-operator-supervisor-bootstrap-v067:"));
assert.ok(edge.includes('ALREADY_ENROLLED_RECOVERED'));
assert.ok(edge.includes('enrollment_recovery_after_rotation:true'));

console.log('A2 v0.6.7 release contract: PASS');
