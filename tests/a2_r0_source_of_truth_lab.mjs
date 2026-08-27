import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const ext = path.join(root, 'coordination/chat-control-plane/extension');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const manifest = JSON.parse(read('coordination/chat-control-plane/extension/manifest.json'));
assert.equal(manifest.version, '0.6.7', 'manifest must remain v0.6.7 during R0 parity repair');
assert.ok(Number(manifest.minimum_chrome_version) >= 125, 'Chrome 125+ required for flat debugger child sessions');

const entry = read('coordination/chat-control-plane/extension/background-entry.js');
for (const required of [
  'device-identity-v067.js',
  'bridge-runtime-v067.js',
  'supervisor-device-transport-v067.js',
  'runtime-marker-v067.js',
  'supervisor-chat-session-v067.js',
  'trusted-supervisor-chat-v067.js'
]) assert.ok(entry.includes(required), `background-entry missing ${required}`);

const bootstrap = read('coordination/chat-control-plane/extension/bootstrap-config.js');
for (const required of [
  'bridgeSecret: ""',
  'supervisorBootstrapSecret: ""',
  'pairingEpoch: ""'
]) assert.ok(bootstrap.includes(required), `public bootstrap must remain secret-free: ${required}`);
assert.ok(!/service[_-]?role\s*[:=]\s*["'][^"']+/i.test(bootstrap), 'service_role must never be embedded');

const sidepanel = read('coordination/chat-control-plane/extension/sidepanel-supervisor.js');
assert.ok(sidepanel.includes('$("supervisorPoll")?.addEventListener'), 'explicit Poll control must remain');
const interval = sidepanel.match(/setInterval\(async \(\) => \{[\s\S]*?\n\s*\},\s*2500\);/);
assert.ok(interval, 'sidepanel refresh interval missing');
assert.ok(!interval[0].includes('A2_SUPERVISOR_POLL_NOW'), 'sidepanel must not perform hidden 2.5s supervisor network polling');

const edge = read('supabase/functions/a2-browser-supervisor-v4/index.ts');
for (const required of [
  "browser-operator-v065-embedded-once:",
  "browser-operator-supervisor-bootstrap-v066:",
  "browser-operator-supervisor-bootstrap-v067:",
  'pairingRecordAny',
  'recoverEnrolledDevice',
  'ALREADY_ENROLLED_RECOVERED',
  'recovered_after_bootstrap_rotation:true',
  'enrollment_recovery_after_rotation:true',
  'metaengine.a2-browser-supervisor.state.v7',
  'metaengine.a2-browser-supervisor.status.v7',
  'metaengine.a2-browser-supervisor.health.v7'
]) assert.ok(edge.includes(required), `production Edge source contract missing ${required}`);

const migration = read('supabase/migrations/20260827190000_a2_browser_device_bootstrap_rotation_scope_v6.sql');
for (const required of [
  "browser-operator-v065-embedded-once:%",
  "browser-operator-supervisor-bootstrap-v066:%",
  "browser-operator-supervisor-bootstrap-v067:%",
  "DEVICE_BOOTSTRAP_BINDING_MISMATCH",
  "BOOTSTRAP_ROTATED_TO_SERVER_DEVICE_GRANT",
  "grant execute on function public.h205f22_a2_browser_device_rotate_embedded_bootstrap_v1(uuid,text) to service_role"
]) assert.ok(migration.includes(required), `migration parity contract missing ${required}`);

const transport = read('coordination/chat-control-plane/extension/supervisor-device-transport-v067.js');
for (const required of [
  'a2SupervisorEnrollmentHoldV067',
  'DEVICE_SIGNED_NO_BEARER_FALLBACK',
  'SCOPED_SINGLE_USE_BOOTSTRAP_THEN_DEVICE_GRANT'
]) assert.ok(transport.includes(required), `v067 signed transport missing ${required}`);

for (const name of fs.readdirSync(ext).filter((n) => /^supervisor-.*\.js$/.test(n))) {
  const text = fs.readFileSync(path.join(ext, name), 'utf8');
  assert.ok(!/\bEXECUTE_JS\b|\beval\s*\(|new\s+Function\s*\(/.test(text), `${name} must not accept arbitrary remote code`);
}

const architecture = read('coordination/chat-control-plane/A2_BROWSER_OPERATOR_V1_ARCHITECTURE.md');
for (const required of [
  'R0_SOURCE_OF_TRUTH_REPAIR',
  'MANY AGENTS MAY THINK',
  'NO BLIND RETRY',
  'MV3 = EXECUTOR'
]) assert.ok(architecture.includes(required), `authoritative architecture missing ${required}`);

console.log('A2 R0 SOURCE_OF_TRUTH parity contract: PASS');
