import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveMe2DaemonLaunch, waitForMe2DaemonReady } from '../src/me2/me2-daemon-host.mjs';
import { decideMe2UiInitialAction, me2UiExternalAdoptionAllowed, projectMe2UiRoutingAuthority, resolveMe2UiLaunch, startMe2UiHost, stopMe2UiHost, me2UiHostStatus } from '../src/me2/me2-ui-host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '../..');

test('packaged standalone daemon is preferred and needs no external Bun', () => {
  const resourcesPath = path.join(path.sep, 'installed', 'resources');
  const packagedExe = path.join(resourcesPath, 'me2-daemon', 'me2-daemon.exe');
  const sourceIndex = path.join(resourcesPath, 'me2-daemon', 'index.ts');
  const existing = new Set([packagedExe, sourceIndex]);
  const launch = resolveMe2DaemonLaunch({
    resourcesPath,
    cwd: path.join(path.sep, 'irrelevant'),
    env: {},
    exists: (candidate) => existing.has(candidate),
  });
  assert.deepEqual(launch, {
    dir: path.join(resourcesPath, 'me2-daemon'),
    bin: packagedExe,
    args: [],
    mode: 'PACKAGED_STANDALONE',
  });
});

test('R85 packaged ME2 UI prefers installed resources and embedded Electron node', () => {
  const installRoot = path.join(path.sep, 'installed');
  const resourcesPath = path.join(installRoot, 'resources');
  const execPath = path.join(installRoot, 'METAENGINE Browser Test.exe');
  const packagedDir = path.join(resourcesPath, 'me2-ui');
  const sourceCwd = path.join(path.sep, 'repo', 'apps', 'metaengine-browser');
  const sourceDir = path.join(path.sep, 'repo', 'apps', 'me2-ui');
  const existing = new Set([
    path.join(resourcesPath, 'app.asar'),
    path.join(packagedDir, 'package.json'),
    path.join(packagedDir, 'server.js'),
    path.join(sourceDir, 'package.json'),
  ]);
  const launch = resolveMe2UiLaunch({
    resourcesPath,
    execPath,
    cwd: sourceCwd,
    env: { PATH: 'C:\\Windows\\System32' },
    exists: (candidate) => existing.has(candidate),
  });
  assert.deepEqual(launch, {
    dir: packagedDir,
    source: 'PACKAGED_RESOURCE',
    standalone: true,
    bin: execPath,
    args: ['server.js'],
    launch_mode: 'EMBEDDED_NODE_STANDALONE',
    env_patch: { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' },
  });

  const missingPackagedLaunch = resolveMe2UiLaunch({
    resourcesPath,
    execPath,
    cwd: sourceCwd,
    env: { PATH: 'C:\\Windows\\System32' },
    exists: (candidate) => candidate === path.join(resourcesPath, 'app.asar') || candidate === path.join(sourceDir, 'package.json'),
  });
  assert.equal(missingPackagedLaunch, null, 'packaged runtime must not escape to a source-tree UI');
});


test('R85 Browser owns packaged ME2 UI lifecycle and never adopts a healthy port by default', () => {
  assert.equal(me2UiExternalAdoptionAllowed({ env: {} }), false);
  assert.equal(me2UiExternalAdoptionAllowed({ env: { ME2_UI_ALLOW_EXTERNAL_ADOPT: '1' } }), true);
  assert.equal(decideMe2UiInitialAction({ healthOk: false, allowExternalAdopt: false }), 'SPAWN');
  assert.equal(decideMe2UiInitialAction({ healthOk: true, allowExternalAdopt: false }), 'WAIT_FOR_PORT_RELEASE');
  assert.equal(decideMe2UiInitialAction({ healthOk: true, allowExternalAdopt: true }), 'ADOPT');
});

test('source checkout remains an explicit Bun fallback only', () => {
  const cwd = path.join(path.sep, 'repo', 'apps', 'metaengine-browser');
  const sourceDir = path.join(cwd, '..', 'me2-daemon');
  const sourceIndex = path.join(sourceDir, 'index.ts');
  const launch = resolveMe2DaemonLaunch({
    resourcesPath: '',
    cwd,
    env: { ME2_DAEMON_BIN: 'bun-custom' },
    exists: (candidate) => candidate === sourceIndex,
  });
  assert.equal(launch.mode, 'SOURCE_BUN');
  assert.equal(launch.bin, 'bun-custom');
  assert.deepEqual(launch.args, ['index.ts']);
});

test('UI routing requires live ownership and readiness; shutdown revokes external adoption too', () => {
  const child = { pid: 42, exitCode: null, signalCode: null };
  const owned = { mode: 'spawned', state: 'HEALTHY', child };
  const adopted = { mode: 'adopted', state: 'ADOPTED', allowExternalAdopt: true };
  for (const [label, input, expected] of [
    ['healthy owned UI', owned, true],
    ['healthy explicitly adopted UI', adopted, true],
    ['owned process still starting', { ...owned, state: 'STARTING' }, false],
    ['owned process stopping', { ...owned, state: 'STOPPING' }, false],
    ['owned process degraded', { ...owned, state: 'DEGRADED' }, false],
    ['owned health readback after stop', { ...owned, stopped: true }, false],
    ['spawn failed before PID', { ...owned, child: {} }, false],
    ['stale health after child exited', { ...owned, child: { ...child, exitCode: 0 } }, false],
    ['stale health after child signalled', { ...owned, child: { ...child, signalCode: 'SIGTERM' } }, false],
    ['missing child handle', { ...owned, child: null }, false],
    ['healthy unowned port', { state: 'HEALTHY' }, false],
    ['adoption without opt-in', { ...adopted, allowExternalAdopt: false }, false],
    ['adopted process stopped', { ...adopted, state: 'STOPPED' }, false],
    ['adopted health readback after stop', { ...adopted, stopped: true }, false],
    ['adopted process degraded', { ...adopted, state: 'DEGRADED' }, false],
  ]) {
    const result = projectMe2UiRoutingAuthority(input);
    assert.equal(result.routing_authorized, expected, label);
    assert.equal(result.initial_readiness_confirmed, expected, label);
  }
});

test('stopping an adopted UI revokes routing without signalling the external process', async () => {
  const savedFetch = globalThis.fetch;
  const savedOptIn = process.env.ME2_UI_ALLOW_EXTERNAL_ADOPT;
  process.env.ME2_UI_ALLOW_EXTERNAL_ADOPT = '1';
  globalThis.fetch = async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  try {
    const started = await startMe2UiHost();
    assert.equal(started.state, 'ADOPTED');
    assert.equal(started.routing_authorized, true);
    const stopped = stopMe2UiHost({ killChild: true });
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(stopped.child_pid, null);
    assert.equal(stopped.routing_authorized, false);
    assert.equal(me2UiHostStatus().initial_readiness_confirmed, false);
  } finally {
    stopMe2UiHost();
    globalThis.fetch = savedFetch;
    if (savedOptIn === undefined) delete process.env.ME2_UI_ALLOW_EXTERNAL_ADOPT;
    else process.env.ME2_UI_ALLOW_EXTERNAL_ADOPT = savedOptIn;
  }
});

test('R85 package contract aligns daemon version and preserves one scheduler owner', async () => {
  const daemonPackage = JSON.parse(await fs.readFile(path.join(repoRoot, 'apps', 'me2-daemon', 'package.json'), 'utf8'));
  const store = await fs.readFile(path.join(repoRoot, 'apps', 'me2-daemon', 'store.ts'), 'utf8');
  const runtimeVersion = store.match(/export\s+const\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1] || null;
  assert.equal(daemonPackage.version, runtimeVersion);
  assert.equal(runtimeVersion, '0.57.1');

  const builder = JSON.parse(await fs.readFile(path.join(appRoot, 'electron-builder.test.json'), 'utf8'));
  assert.ok(builder.extraResources.some((row) => row.from === 'me2-daemon-dist' && row.to === 'me2-daemon'));

  const beforePack = await fs.readFile(path.join(appRoot, 'scripts', 'electron-builder-before-pack.cjs'), 'utf8');
  assert.match(beforePack, /build-me2-daemon-staging\.ps1/);
  assert.match(beforePack, /me2_daemon_staging_build_failed/);

  const host = await fs.readFile(path.join(appRoot, 'src', 'me2', 'me2-daemon-host.mjs'), 'utf8');
  assert.match(host, /ME2_BOOT_MODE:\s*process\.env\.ME2_DAEMON_BOOT_MODE \|\| 'probe'/);
  assert.match(host, /mode:\s*'PACKAGED_STANDALONE'/);

  const integration = await fs.readFile(path.join(appRoot, 'src', 'me2', 'me2-integration-entry.mjs'), 'utf8');
  assert.match(integration, /startMe2DaemonHost\(\{ dataDir:/);
  assert.match(integration, /stopMe2UiHost\(\{ killChild: true \}\)/);
  assert.match(integration, /stopMe2UiHostAndWait\(\{ graceMs: 2500, forceMs: 2500 \}\)/);
  assert.match(integration, /app\.on\('before-quit'/);
  assert.match(integration, /event: 'ME2_QUIT_DRAIN_CONFIRMED'/);
  assert.match(integration, /event: 'ME2_UI_SHUTDOWN_UNCONFIRMED'/);
  assert.match(integration, /verdict: 'QUIT_FENCED'/);
  assert.match(integration, /stopMe2DaemonHost\(\{ killChild: true \}\)/);
  const uiHost = await fs.readFile(path.join(appRoot, 'src', 'me2', 'me2-ui-host.mjs'), 'utf8');
  assert.match(uiHost, /event: 'UI_UNOWNED_PORT'/);
  assert.match(uiHost, /state = 'WAITING_FOR_PORT_RELEASE'/);
  assert.match(uiHost, /ME2_UI_ALLOW_EXTERNAL_ADOPT/);
  assert.match(uiHost, /\.\.\.projectMe2UiRoutingAuthority\(\{ mode, state, child, stopped,/);
  assert.match(uiHost, /export async function stopMe2UiHostAndWait/);
  assert.match(uiHost, /event: 'UI_FORCE_KILL'/);
  assert.match(uiHost, /event: 'UI_STOP_CONFIRMED'/);
  assert.match(uiHost, /event: 'UI_STOP_UNCONFIRMED'/);
  assert.match(uiHost, /shutdown:\s*Object\.freeze\(\{ confirmed/);
  const finalEntry = await fs.readFile(path.join(appRoot, 'src', 'final-runtime-entry.mjs'), 'utf8');
  assert.match(
    finalEntry,
    /if \(primaryInstance && !probeStdoutReserved && primaryUiRecoveryEnabled && process\.env\.ME2_INTEGRATION !== '0'\)/,
    'only the Electron singleton owner may host or adopt the ME2 daemon plane',
  );
});

test('initial daemon readiness is bounded readback and does not manufacture readiness', async () => {
  let attempts = 0;
  const ready = await waitForMe2DaemonReady({
    attempts: 4,
    intervalMs: 25,
    probe: async () => {
      attempts += 1;
      return attempts === 3 ? { ok: true, last_seq: 17 } : { ok: false, reason: 'not_ready' };
    },
  });
  assert.deepEqual(ready, { ok: true, reason: 'READY', attempt: 3, last_seq: 17 });
  assert.equal(attempts, 3);

  attempts = 0;
  const failed = await waitForMe2DaemonReady({
    attempts: 2,
    intervalMs: 25,
    probe: async () => {
      attempts += 1;
      return { ok: false, reason: 'still_starting' };
    },
  });
  assert.deepEqual(failed, { ok: false, reason: 'still_starting', attempt: 2 });
  assert.equal(attempts, 2);
});
