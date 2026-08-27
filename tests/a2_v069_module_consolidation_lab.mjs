import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = 'coordination/chat-control-plane/extension';
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('runtime-package-manifest.json'));
const entry = read('background-entry.js');

assert.equal(manifest.version, '0.6.9');
assert.equal(pkg.schema, 'metaengine.a2-browser-operator.runtime-package.v1');
assert.equal(pkg.package_version, manifest.version);
assert.equal(pkg.operator_runtime, '0.6.9-dev.1');

const imports = [...entry.matchAll(/importScripts\(\s*["']\.\/([^"']+)["']\s*\)/g)].map((m) => m[1]);
assert.ok(imports.length >= 20, 'canonical runtime import graph unexpectedly small');
assert.equal(new Set(imports).size, imports.length, 'duplicate runtime import');
for (const name of imports) {
  assert.doesNotMatch(name, /-v\d{3}(?:\.|$)/i, `versioned active import: ${name}`);
  assert.ok(fs.existsSync(path.join(root, name)), `active import missing: ${name}`);
}
assert.ok(imports.indexOf('runtime-marker.js') < imports.indexOf('bridge-runtime.js'));
assert.ok(imports.indexOf('runtime-marker.js') < imports.indexOf('runtime-core.js'));

const contentScripts = manifest.content_scripts.flatMap((row) => row.js || []);
for (const name of contentScripts) assert.doesNotMatch(name, /-v\d{3}(?:\.|$)/i, `versioned content script: ${name}`);
assert.ok(contentScripts.includes('content-recovery.js'));

const packageFiles = pkg.files;
assert.equal(new Set(packageFiles).size, packageFiles.length, 'duplicate package file');
for (const name of packageFiles) {
  assert.doesNotMatch(name, /-v\d{3}(?:\.|$)/i, `versioned package file: ${name}`);
  assert.ok(fs.existsSync(path.join(root, name)), `package file missing: ${name}`);
}
for (const name of imports) assert.ok(packageFiles.includes(name), `runtime import not packaged: ${name}`);
for (const name of contentScripts) assert.ok(packageFiles.includes(name), `content script not packaged: ${name}`);
for (const name of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page]) {
  assert.ok(packageFiles.includes(name), `manifest reference not packaged: ${name}`);
}

const runtimeMarker = read('runtime-marker.js');
const runtimeCore = read('runtime-core.js');
const bridgeRuntime = read('bridge-runtime.js');
assert.match(runtimeMarker, /const RUNTIME = "0\.6\.9-dev\.1"/);
assert.match(runtimeMarker, /globalThis\.A2_RUNTIME = descriptor/);
assert.match(runtimeCore, /const runtimeDescriptor = globalThis\.A2_RUNTIME/);
assert.match(runtimeCore, /runtime_descriptor_missing/);
assert.doesNotMatch(runtimeCore, /0\.6\.3-supervisor-authority-dev\.2/);
assert.match(bridgeRuntime, /globalThis\.A2_RUNTIME\?\.version/);
assert.doesNotMatch(bridgeRuntime, /const RUNTIME\s*=/);

const runtimeLiteralOwners = packageFiles.filter((name) => {
  const p = path.join(root, name);
  return fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes('0.6.9-dev.1');
});
assert.deepEqual(runtimeLiteralOwners, ['runtime-marker.js'], `runtime version duplicated in package: ${runtimeLiteralOwners.join(',')}`);

const aliases = [
  ['device-identity.js', 'device-identity-v067.js'],
  ['supervisor-device-transport.js', 'supervisor-device-transport-v068.js'],
  ['debugger-watchdog.js', 'debugger-watchdog-v062.js'],
  ['chatgpt-rollover.js', 'chatgpt-rollover-v062.js'],
  ['supervisor-authority.js', 'supervisor-client-v063-authority.js'],
  ['supervisor-chat-session.js', 'supervisor-chat-session-v067.js'],
  ['trusted-supervisor-chat.js', 'trusted-supervisor-chat-v067.js'],
  ['supervisor-chat-action.js', 'supervisor-chat-action-v063.js'],
  ['supervisor-chat-guard.js', 'supervisor-chat-guard-v064.js'],
  ['supervisor-chat-action-monitor.js', 'supervisor-chat-action-monitor-v063.js'],
  ['supervisor-incident-router.js', 'supervisor-incident-router-v063.js'],
  ['supervisor-chat-ui-bridge.js', 'supervisor-chat-ui-bridge-v063.js'],
  ['content-recovery.js', 'content-recovery-v062.js'],
];
for (const [canonical, historical] of aliases) {
  assert.equal(read(canonical), read(historical), `${canonical} drifted while consolidating ${historical}`);
}

assert.ok(!packageFiles.includes('background.js'));
assert.ok(!packageFiles.includes('background-v063.js'));
assert.ok(!packageFiles.includes('supervisor-client.js'));
assert.ok(!packageFiles.includes('supervisor-client-v063.js'));

console.log('A2 v0.6.9 module consolidation contract: PASS', {
  active_imports: imports.length,
  package_files: packageFiles.length,
  runtime_literal_owner: runtimeLiteralOwners[0]
});
