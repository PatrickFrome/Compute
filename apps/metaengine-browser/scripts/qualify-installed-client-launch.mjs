import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyWindowsTcpListener } from './verify-windows-tcp-listener.mjs';
import { verifyMe2UiBundle } from './verify-me2-ui-bundle.mjs';
import { validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity,
  localStateProviderHealthAttested } from '../src/local-state-provider-policy.mjs';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const { assertPackagedOfflineRuntimeBinding } = require('./offline-runtime-package-binding.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
export const ISOLATED_OWNER_MARKER = 'metaengine-isolated-launch-qa.json';
export const INSTALLED_LAUNCH_SOURCE_FILES = Object.freeze([
  'src/final-runtime-entry.mjs', 'src/main-entry.mjs', 'src/main.mjs',
  'src/local-state-provider-bootstrap.mjs', 'src/local-state-provider-policy.mjs',
  'src/local-runtime-host-controller.mjs', 'src/local-restored-pg17-setup.mjs',
  'src/local-restored-pg17-auto-prepare.mjs',
  'src/private-windows-storage-acl.mjs',
  'src/local-restored-pg17-setup.html', 'src/local-restored-pg17-setup-preload.cjs',
  'src/me2/me2-ui-host.mjs', 'src/me2/me2-ui-gateway.mjs',
]);

function fail(category) { throw new Error('installed_launch_' + category); }
function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// A dedicated profile is essential: Electron's --user-data-dir does not bind
// the owner file, which is selected from APPDATA before app.getPath is queried.
// Never inherit provider endpoints, loader flags, credentials or machine paths.
export function isolatedLaunchEnvironment({ appData, localAppData, temporaryDirectory, uiPort, gatewayPort, daemonPort }, inherited = process.env) {
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'Path']) {
    if (typeof inherited[key] === 'string') env[key] = inherited[key];
  }
  Object.assign(env, { APPDATA: appData, LOCALAPPDATA: localAppData, TEMP: temporaryDirectory, TMP: temporaryDirectory,
    HOSTNAME: '0.0.0.0', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '1' });
  if (uiPort) Object.assign(env, { ME2_UI_PORT: String(uiPort), ME2_UI_HEALTH_URL: `http://127.0.0.1:${uiPort}/`,
    ME2_UI_DEV: '0', ME2_UI_ALLOW_EXTERNAL_ADOPT: '0' });
  if (gatewayPort) env.ME2_UI_GATEWAY_PORT = String(gatewayPort);
  if (daemonPort) Object.assign(env, { ME2_REST_PORT: String(daemonPort),
    ME2_DAEMON_HEALTH_URL: `http://127.0.0.1:${daemonPort}/state`, ME2_DAEMON_REST: `http://127.0.0.1:${daemonPort}` });
  return env;
}

export function assertInstalledLaunchIdentity(pkg, { expectedHead, expectedVersion }) {
  if (!/^[a-f0-9]{40}$/.test(expectedHead || '') || !expectedVersion) fail('expected_identity_invalid');
  if (pkg?.version !== expectedVersion || pkg.main !== 'src/final-runtime-entry.mjs'
    || pkg.metaengineEmergencyTrustRoot?.build_sha !== expectedHead
    || pkg.metaengineBuildIdentity?.source_head !== expectedHead
    || pkg.metaengineBuildIdentity?.package_version !== expectedVersion
    || pkg.metaengineClientStateRuntime?.source_head_sha !== expectedHead
    || pkg.metaengineClientStateRuntime?.package_version !== expectedVersion
    || !SHA.test(pkg.metaengineClientStateRuntime?.bundle_sha256 || '')) fail('package_identity_mismatch');
  return Object.freeze({ source_head: expectedHead, package_version: expectedVersion,
    bundle_sha256: pkg.metaengineClientStateRuntime.bundle_sha256 });
}

export function assertFirstRunDomContract(dom) {
  if (!dom?.config || !dom.receipt || !dom.connect || !dom.digest || !dom.consent_preload
    || dom.node_in_page !== false || !/connect-src 'none'/.test(dom.csp || '')
    || !/PostgreSQL 17/i.test(dom.heading || '') || !/^file:/.test(dom.url)
    || !Array.isArray(dom.resources) || !dom.resources.every(url => /^(file:|data:)/.test(url))) fail('first_run_dom_contract_invalid');
  return true;
}

export function assertOwnerStartupGrace({ before, after, sentinelBefore, sentinelAfter, progressBefore, progressAfter, pid, now = Date.now() }) {
  const progressAge = now - Date.parse(progressAfter?.progress_at);
  if (after?.current_boot_id !== before?.current_boot_id || !before?.current_boot_id
    || !sentinelBefore?.token || sentinelAfter?.token !== sentinelBefore.token
    || sentinelBefore.parent_pid !== pid || sentinelAfter?.parent_pid !== pid
    || !Number.isSafeInteger(sentinelBefore.worker_pid) || sentinelBefore.worker_pid < 1
    || sentinelAfter?.worker_pid !== sentinelBefore.worker_pid
    || sentinelAfter?.relaunch_attempted !== false || sentinelAfter?.worker_released !== false
    || sentinelAfter?.worker_recovery_generation !== sentinelBefore.worker_recovery_generation
    || progressBefore?.token !== sentinelBefore.token || progressAfter?.token !== sentinelAfter.token
    || progressBefore.parent_pid !== pid || progressAfter.parent_pid !== pid
    || !Number.isSafeInteger(progressBefore.progress_seq) || !Number.isSafeInteger(progressAfter.progress_seq)
    || progressAfter.progress_seq <= progressBefore.progress_seq
    || !Number.isFinite(progressAge) || progressAge < 0 || progressAge > 30000) fail('normal_startup_grace_survival_unproven');
  return true;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const deadline = (ms, category) => delay(ms, undefined, { ref: false }).then(() => fail(category));

async function assertPortClosed(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('installed_launch_port_probe_timeout')); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('installed_launch_child_port_still_open')); });
    socket.once('error', error => {
      clearTimeout(timer); socket.destroy();
      error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('installed_launch_port_probe_failed'));
    });
  });
}

function start(executable, args, env, cwd) {
  const child = spawn(executable, args, { env, cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError = null;
  const append = bytes => { output = (output + bytes.toString('utf8')).slice(-256 * 1024); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const closed = new Promise(resolve => {
    child.once('error', error => { spawnError = error; resolve({ code: null }); });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const alive = () => {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) fail('process_ended_before_readback');
  };
  return { child, closed, alive, output: () => output };
}

async function stop(launch) {
  if (launch.child.exitCode !== null || launch.child.signalCode !== null) return launch.closed;
  // The tracked launch owns this exact PID; cleanup is never by image name.
  try { await execute('taskkill.exe', ['/PID', String(launch.child.pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }); }
  catch { if (launch.child.exitCode === null) fail('process_cleanup_unconfirmed'); }
  await Promise.race([launch.closed, deadline(15000, 'process_cleanup_timeout')]);
}

async function waitUntil(action, launch, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    launch?.alive();
    try { const result = await action(); if (result) return result; }
    catch (error) { lastError = error; }
    await delay(200);
  }
  fail('readback_timeout_' + (String(lastError?.message || '').startsWith('installed_launch_') ? lastError.message.slice(17) : 'unavailable'));
}

async function cdp(url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  await Promise.race([new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('installed_launch_cdp_connect_failed')), { once: true });
  }), deadline(10000, 'cdp_connect_timeout')]);
  socket.addEventListener('message', event => {
    const row = JSON.parse(String(event.data));
    const request = pending.get(row.id);
    if (!request) return;
    pending.delete(row.id); clearTimeout(request.timer);
    row.error ? request.reject(new Error('installed_launch_cdp_request_failed')) : request.resolve(row.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('installed_launch_cdp_closed')); }
    pending.clear();
  });
  return {
    command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('installed_launch_cdp_request_timeout')); }, 10000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function targetAt(port, matches) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
  const targets = await response.json();
  return targets.find(target => target.type === 'page' && matches(target.url) && target.webSocketDebuggerUrl);
}

async function profileProbe(executable, env, directory) {
  const launch = start(executable, ['--metaengine-profile-probe', '--user-data-dir=' + path.join(env.APPDATA, 'BrowserProfile')],
    { ...env, METAENGINE_PROFILE_PROBE_WRITE: '1' }, directory);
  try {
    const result = await Promise.race([launch.closed, deadline(20000, 'profile_probe_timeout')]);
    assert.equal(result.code, 0);
    const rows = launch.output().split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const profile = rows.find(row => row.schema === 'metaengine.browser.profile-probe.v1');
    if (!profile?.primary_instance || !contained(env.APPDATA, profile.user_data_path)) fail('profile_not_isolated');
    return profile;
  } finally {
    await stop(launch);
    await fs.writeFile(path.join(directory, 'installed-profile-probe-' + randomUUID() + '.log'), launch.output());
  }
}

export async function qualifyInstalledFirstRun({ executable, directory, identity }) {
  const appData = path.join(directory, 'first-run', 'Roaming');
  const localAppData = path.join(directory, 'first-run', 'Local');
  const temporaryDirectory = path.join(directory, 'first-run', 'Temp');
  for (const target of [appData, localAppData, temporaryDirectory]) await fs.mkdir(target, { recursive: true });
  const ports = [];
  while (ports.length < 4) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const [uiPort, gatewayPort, daemonPort, debuggingPort] = ports;
  const env = isolatedLaunchEnvironment({ appData, localAppData, temporaryDirectory, uiPort, gatewayPort, daemonPort });
  const profile = await profileProbe(executable, env, directory);
  // This is the ordinary installed entry. CDP supplies observation only;
  // no application smoke/probe flag or provider bypass is present.
  const launch = start(executable, [`--remote-debugging-port=${debuggingPort}`, '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile.user_data_path,
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'], env, directory);
  let client;
  let proof;
  try {
    const target = await waitUntil(() => targetAt(debuggingPort, url => /\/local-restored-pg17-setup\.html$/.test(url)), launch, 90000);
    client = await cdp(target.webSocketDebuggerUrl);
    const result = await client.command('Runtime.evaluate', { returnByValue: true, expression: `(() => ({
      heading: document.querySelector('h1')?.textContent,
      config: !!document.querySelector('#config'), receipt: !!document.querySelector('#receipt'),
      connect: !!document.querySelector('#connect'), digest: !!document.querySelector('#digest'),
      consent_preload: typeof window.metaengineRestore?.connect === 'function',
      node_in_page: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
      url: location.href, resources: performance.getEntriesByType('resource').map(row => row.name)
    }))()` });
    const dom = result.result?.value;
    assertFirstRunDomContract(dom);
    const listener = await verifyWindowsTcpListener({ port: debuggingPort, pid: launch.child.pid });
    const screenshot = await client.command('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(screenshot.data, 'base64');
    assert(png.length > 4096);
    await fs.writeFile(path.join(directory, 'installed-first-run.png'), png);
    // Give asynchronous prewarm a chance to reveal an admission regression.
    await delay(3000); launch.alive();
    const log = launch.output();
    if (/RUNTIME_IMPORT_OK|ME2_INTEGRATION_START|DAEMON_HEALTHY|ME2_PRIMARY_SHELL_VISIBLE/.test(log)) fail('first_run_bypassed_owner_admission');
    for (const file of [path.join(appData, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json'),
      path.join(profile.user_data_path, 'metaengine-browser-startup-journal-v1.json')]) {
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
    proof = { schema: 'metaengine.browser.installed-first-run-proof.v1', ...identity,
      launch: 'NORMAL_INSTALLED_ENTRY', profile_isolated: true, first_run_visible: true,
      consent_preload_verified: true, node_renderer_access: false, renderer_connect_src_none: true,
      owner_profile_written: false, browser_runtime_admitted: false,
      screenshot_sha256: digest(png), screenshot_bytes: png.length, debugger_listener: listener,
      owner_boot_qualified: false, production_ready: false, authority_effect: false };
  } finally {
    client?.close();
    await stop(launch);
    await fs.writeFile(path.join(directory, 'installed-first-run.log'), launch.output());
    for (const port of ports) await assertPortClosed(port);
  }
  return Object.freeze({ ...proof, process_cleanup_confirmed: true });
}

export async function qualifyInstalledUiHost({ executable, asar, archive, directory, resourcesDir, identity }) {
  const uiProof = verifyMe2UiBundle(path.join(resourcesDir, 'me2-ui'), identity.source_head);
  const port = await freePort();
  const hostBytes = asar.extractFile(archive, 'src/me2/me2-ui-host.mjs');
  const hostFile = path.join(directory, 'installed-me2-ui-host.mjs');
  await fs.writeFile(hostFile, hostBytes, { flag: 'wx' });
  const harnessFile = path.join(directory, 'installed-me2-ui-host-harness.mjs');
  await fs.writeFile(harnessFile, `import { pathToFileURL } from 'node:url';
const host = await import(pathToFileURL(process.argv[2]).href);
try {
  const state = await host.startMe2UiHost();
  if (state.state !== 'HEALTHY' || state.mode !== 'spawned' || state.child_owned !== true
    || state.launch_mode !== 'EMBEDDED_NODE_STANDALONE') throw new Error('installed_launch_host_not_owned');
  process.send({ schema: 'metaengine.browser.installed-ui-host-readback.v1', ...state });
  await new Promise(resolve => process.once('message', resolve));
} finally {
  const state = await host.stopMe2UiHostAndWait();
  if (state.shutdown.confirmed !== true) throw new Error('installed_launch_ui_cleanup_unconfirmed');
  process.send({ schema: 'metaengine.browser.installed-ui-host-cleanup.v1', cleanup_confirmed: true });
}
`, { flag: 'wx' });
  const env = isolatedLaunchEnvironment({ appData: path.join(directory, 'host', 'Roaming'),
    localAppData: path.join(directory, 'host', 'Local'), temporaryDirectory: directory, uiPort: port });
  const child = spawn(executable, [harnessFile, hostFile], { cwd: directory, windowsHide: true, shell: false,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '', cleanup = false;
  child.stdout.on('data', bytes => { output = (output + bytes).slice(-256 * 1024); });
  child.stderr.on('data', bytes => { output = (output + bytes).slice(-256 * 1024); });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  closed.catch(() => {});
  child.on('message', row => { if (row?.schema === 'metaengine.browser.installed-ui-host-cleanup.v1') cleanup = row.cleanup_confirmed === true; });
  let proof;
  try {
    const state = await Promise.race([new Promise((resolve, reject) => {
      child.once('message', row => row.schema === 'metaengine.browser.installed-ui-host-readback.v1' ? resolve(row) : reject(new Error('installed_launch_host_readback_invalid')));
      child.once('error', reject); child.once('close', () => reject(new Error('installed_launch_host_ended')));
    }), deadline(60000, 'host_ready_timeout')]);
    const listener = await verifyWindowsTcpListener({ port, pid: state.child_pid });
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10000) });
    assert(response.ok);
    const html = await response.text(); assert.match(html, /<html/i);
    proof = { schema: 'metaengine.browser.installed-owned-ui-host-proof.v1', ...identity,
      installed_host_source_sha256: digest(hostBytes), host_module_source: 'EXACT_INSTALLED_ASAR_BYTES',
      installed_ui_manifest_sha256: uiProof.manifest_sha256, installed_ui_size_bytes: uiProof.installed_size_bytes,
      launch_mode: state.launch_mode, browser_runtime_admitted: false, child_owned: true,
      hostile_hostname_overridden: true, os_listener: listener, html_sha256: digest(html),
      owner_boot_qualified: false, production_ready: false, authority_effect: false };
  } finally {
    if (child.connected) child.send({ command: 'stop' });
    const result = await Promise.race([closed, delay(15000, null, { ref: false })]);
    await fs.writeFile(path.join(directory, 'installed-owned-ui-host.log'), output);
    if (!result || result.code !== 0 || !cleanup) {
      await stop({ child, closed });
      fail('host_cleanup_unconfirmed');
    }
  }
  return Object.freeze({ ...proof, process_cleanup_confirmed: true });
}

async function ownerProfile({ ownerQaRoot, resourcesDir, identity }) {
  const root = await fs.realpath(ownerQaRoot);
  const marker = JSON.parse(await fs.readFile(path.join(root, ISOLATED_OWNER_MARKER), 'utf8'));
  if (marker.schema !== 'metaengine.browser.isolated-owner-launch-fixture.v1' || marker.production_profile !== false
    || marker.source_data_rows_restored !== 0 || marker.source_head !== identity.source_head) fail('owner_fixture_marker_invalid');
  const appData = path.join(root, 'Roaming'), localAppData = path.join(root, 'Local'), temporaryDirectory = path.join(root, 'Temp');
  for (const directory of [appData, localAppData, temporaryDirectory]) await fs.mkdir(directory, { recursive: true });
  const ownerFile = path.join(appData, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json');
  const ownerBytes = await fs.readFile(ownerFile);
  const owner = validateLocalStateProviderConfig(JSON.parse(ownerBytes));
  if (!owner.runtime_host || path.resolve(owner.runtime_host.bundle_directory).toLowerCase() !== path.join(resourcesDir, 'client-state-runtime').toLowerCase()
    || owner.runtime_host.expected_bundle_sha256 !== identity.bundle_sha256
    || !contained(root, owner.runtime_identity_file) || !contained(root, owner.runtime_host.config_file)) fail('owner_fixture_not_pinned');
  const config = JSON.parse(await fs.readFile(owner.runtime_host.config_file, 'utf8'));
  for (const key of ['pg_data_directory', 'state_directory']) if (!contained(root, config[key] || '')) fail('owner_fixture_outside_qa');
  const database = new URL(config.database_url);
  if (database.hostname !== '127.0.0.1' || !database.username) fail('owner_fixture_database_not_loopback');
  return { root, appData, localAppData, temporaryDirectory, owner, ownerFile, ownerSha256: digest(ownerBytes), config };
}

async function normalUiSocket(port, primaryPid, executable) {
  const script = `$ErrorActionPreference='Stop'; $rows=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop); $ids=@($rows.OwningProcess | Select-Object -Unique); if($ids.Count -ne 1){throw 'owner_socket_ambiguous'}; Get-CimInstance Win32_Process -Filter ('ProcessId='+$ids[0]) | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress`;
  const { stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  const row = JSON.parse(stdout);
  if (row.ParentProcessId !== primaryPid || String(row.ExecutablePath).toLowerCase() !== executable.toLowerCase()) fail('normal_ui_child_process_mismatch');
  return verifyWindowsTcpListener({ port, pid: row.ProcessId });
}

export async function qualifyInstalledOwnerBoot({ executable, resourcesDir, directory, ownerQaRoot, identity }) {
  const fixture = await ownerProfile({ ownerQaRoot, resourcesDir, identity });
  const ports = [];
  while (ports.length < 4) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const [uiPort, gatewayPort, daemonPort, debuggingPort] = ports;
  const env = isolatedLaunchEnvironment({ ...fixture, uiPort, gatewayPort, daemonPort });
  const profile = await profileProbe(executable, env, directory);
  const journalPath = path.join(profile.user_data_path, 'metaengine-browser-startup-journal-v1.json');
  const postmasterFile = path.join(fixture.config.pg_data_directory, 'postmaster.pid');
  const attachedPostmasterBefore = fixture.config.postgres_mode === 'attached' ? await fs.readFile(postmasterFile, 'utf8') : null;
  const launch = start(executable, [`--remote-debugging-port=${debuggingPort}`, '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile.user_data_path,
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'], env, directory);
  const currentEvents = journal => journal.events?.filter(row => row.boot_id === journal.current_boot_id && row.pid === launch.child.pid && row.version === identity.package_version) || [];
  const journal = () => fs.readFile(journalPath, 'utf8').then(JSON.parse);
  let client, proof, statusBefore;
  try {
    const before = await waitUntil(async () => {
      const row = await journal();
      const events = currentEvents(row);
      if (events.some(event => event.state === 'RUNTIME_IMPORT_FAILED')) fail('normal_runtime_import_failed');
      return events.some(event => event.state === 'PRIMARY_WINDOW_STABLE' && event.details.visible === true)
        && events.some(event => event.state === 'RUNTIME_IMPORT_OK') ? row : null;
    }, launch, 150000);
    statusBefore = JSON.parse(await fs.readFile(fixture.owner.runtime_identity_file, 'utf8'));
    const runtimeIdentity = validateLocalStateRuntimeIdentity(statusBefore, fixture.owner.base_url);
    const apiChild = statusBefore.children?.find(row => row.name === 'api');
    const edgeChild = statusBefore.children?.find(row => row.name === 'edge');
    if (!Number.isSafeInteger(statusBefore.host_pid) || !apiChild?.pid || !edgeChild?.pid) fail('owner_runtime_pid_readback_missing');
    const apiListener = await verifyWindowsTcpListener({ port: fixture.config.api_port, pid: apiChild.pid });
    const edgeListener = await verifyWindowsTcpListener({ port: fixture.config.edge_port, pid: edgeChild.pid });
    const health = await fetch(fixture.owner.base_url + '/health', { signal: AbortSignal.timeout(10000) });
    assert(health.ok && localStateProviderHealthAttested(await health.json(), runtimeIdentity.instance_id));
    const uiListener = await normalUiSocket(uiPort, launch.child.pid, executable);
    const gatewayListener = await verifyWindowsTcpListener({ port: gatewayPort, pid: launch.child.pid });
    const target = await waitUntil(() => targetAt(debuggingPort, url => url.startsWith(`http://127.0.0.1:${gatewayPort}/`)), launch);
    client = await cdp(target.webSocketDebuggerUrl);
    const screenshot = await client.command('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(screenshot.data, 'base64'); assert(png.length > 4096);
    await fs.writeFile(path.join(directory, 'installed-owner-ui.png'), png);
    const second = start(executable, ['--user-data-dir=' + profile.user_data_path], env, directory);
    let secondResult;
    try { secondResult = await Promise.race([second.closed, deadline(20000, 'second_instance_timeout')]); }
    finally { await stop(second); }
    assert.equal(secondResult.code, 0);
    const ack = second.output().split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
      .find(row => row.schema === 'metaengine.browser.secondary-launch.v1');
    if (ack?.state !== 'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED' || ack.primary_pid !== launch.child.pid
      || ack.second_browser_runtime_started !== false || ack.primary_version !== identity.package_version) fail('second_instance_ack_invalid');
    const sentinelPath = path.join(profile.user_data_path, 'metaengine-browser-sentinel-v1.json');
    const progressPath = sentinelPath + '.parent-progress-v1.json';
    const sentinelBefore = JSON.parse(await fs.readFile(sentinelPath, 'utf8'));
    const progressBefore = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    await delay(190000); launch.alive();
    const after = await journal();
    const sentinelAfter = JSON.parse(await fs.readFile(sentinelPath, 'utf8'));
    const progressAfter = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    assertOwnerStartupGrace({ before, after, sentinelBefore, sentinelAfter, progressBefore, progressAfter, pid: launch.child.pid });
    const activation = currentEvents(after).find(row => row.state === 'PRIMARY_WINDOW_ACTIVATED' && row.details.launch_id === ack.launch_id
      && row.sequence === ack.event_sequence && row.details.visible === true);
    if (!activation) fail('second_instance_activation_missing');
    const log = launch.output();
    for (const state of ['DAEMON_HEALTHY', 'ME2_CONTRACT_OK', 'ME2_PRIMARY_SHELL_VISIBLE', 'ME2_R97_UI_CONTRACT_CONFIRMED']) {
      if (!log.includes(state)) fail('normal_ui_contract_missing');
    }
    if (/FAIL_CLOSED_RECOVERY_VISIBLE|ME2_R97_UI_CONTRACT_INCOMPLETE|DAEMON_INITIAL_READINESS_FAILED|ME2_CONTRACT_MISMATCH/.test(log)) fail('normal_ui_degraded');
    const afterListener = await normalUiSocket(uiPort, launch.child.pid, executable);
    if (afterListener.owner_pid !== uiListener.owner_pid) fail('normal_ui_child_restarted');
    assert.equal(digest(await fs.readFile(fixture.ownerFile)), fixture.ownerSha256);
    await fs.writeFile(path.join(directory, 'installed-owner-startup-journal.json'), JSON.stringify(after, null, 2) + '\n');
    proof = { schema: 'metaengine.browser.installed-owner-boot-proof.v1', ...identity,
      launch: 'NORMAL_INSTALLED_ENTRY', profile_isolated: true, fixture_source_rows_restored: 0,
      real_local_runtime_attested: true, runtime_instance_id: runtimeIdentity.instance_id,
      normal_ui_boot_verified: true, me2_r97_dom_contract_verified: true,
      second_instance_activation_verified: true, startup_grace_survival_seconds: 190,
      sentinel_relaunch_attempted: false, ui_listener: uiListener, gateway_listener: gatewayListener,
      api_listener: apiListener, edge_listener: edgeListener,
      same_ui_child_across_startup_grace: true, screenshot_sha256: digest(png), screenshot_bytes: png.length,
      owner_boot_qualified: true, production_ready: false, authority_effect: false };
  } finally {
    client?.close();
    // Use the existing installer shutdown barrier to stop the owned API/edge
    // host. An attached PostgreSQL clone stays with the fixture's owner.
    const shutdown = start(executable, ['--metaengine-installer-shutdown', '--user-data-dir=' + profile.user_data_path], env, directory);
    try {
      const signal = await Promise.race([shutdown.closed, deadline(50000, 'owner_shutdown_signal_timeout')]);
      assert.equal(signal.code, 0);
      await Promise.race([launch.closed, deadline(50000, 'owner_shutdown_cleanup_timeout')]);
      if (statusBefore) {
        const stoppedStatus = JSON.parse(await fs.readFile(fixture.owner.runtime_identity_file, 'utf8'));
        if (stoppedStatus.state !== 'STOPPED' || stoppedStatus.runtime_ready !== false || stoppedStatus.children_stopped !== true
          || stoppedStatus.instance_id !== statusBefore.instance_id || stoppedStatus.host_pid !== statusBefore.host_pid) fail('owner_runtime_shutdown_status_unconfirmed');
        await assert.rejects(fs.stat(path.join(fixture.config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
        for (const port of [fixture.config.api_port, fixture.config.edge_port, uiPort, gatewayPort, debuggingPort]) await assertPortClosed(port);
        for (const pid of [statusBefore.host_pid, ...statusBefore.children.map(row => row.pid)]) {
          try { process.kill(pid, 0); fail('owner_runtime_child_still_alive'); }
          catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        if (attachedPostmasterBefore !== null) {
          assert.equal(await fs.readFile(postmasterFile, 'utf8'), attachedPostmasterBefore);
          const pgPid = Number(attachedPostmasterBefore.split(/\r?\n/)[0]);
          process.kill(pgPid, 0);
        }
      }
    } finally {
      await stop(shutdown); await stop(launch);
      await fs.writeFile(path.join(directory, 'installed-owner-ui.log'), launch.output());
    }
  }
  return Object.freeze({ ...proof, process_cleanup_confirmed: true, runtime_host_lock_released: true,
    runtime_children_stopped: true, runtime_ports_closed: true, attached_postgres_incarnation_preserved: attachedPostmasterBefore !== null,
    shutdown_method: 'EXISTING_INSTALLER_SHUTDOWN_BARRIER' });
}

export async function qualifyInstalledClientLaunch({ installRoot, sourceRoot, expectedHead, expectedVersion, evidenceDirectory, ownerQaRoot }) {
  if (process.platform !== 'win32') fail('windows_required');
  const directory = await fs.realpath(evidenceDirectory);
  const resourcesDir = path.join(await fs.realpath(installRoot), 'resources');
  const executable = path.join(path.dirname(resourcesDir), 'METAENGINE Browser Test.exe');
  const archive = path.join(resourcesDir, 'app.asar');
  const asar = await import('@electron/asar');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const identity = assertInstalledLaunchIdentity(pkg, { expectedHead, expectedVersion });
  const sourceFiles = {};
  for (const relative of INSTALLED_LAUNCH_SOURCE_FILES) {
    const installed = asar.extractFile(archive, relative);
    const source = await fs.readFile(path.join(sourceRoot, 'apps/metaengine-browser', relative));
    if (!installed.equals(source)) fail('installed_source_bytes_mismatch');
    sourceFiles[relative] = digest(installed);
  }
  const runtime = await assertPackagedOfflineRuntimeBinding(pkg.metaengineClientStateRuntime, {
    expectedHead, packageVersion: expectedVersion, resourcesDir,
    verifierBytes: asar.extractFile(archive, 'infra/client-state-runtime/offline-runtime-bundle.mjs'),
  });
  const isolatedDirectory = path.join(directory, 'isolated-launch-' + randomUUID());
  await fs.mkdir(isolatedDirectory);
  const firstRun = await qualifyInstalledFirstRun({ executable, directory: isolatedDirectory, identity });
  await fs.writeFile(path.join(directory, 'installed-first-run-proof.json'), JSON.stringify(firstRun, null, 2) + '\n');
  const uiHost = await qualifyInstalledUiHost({ executable, asar, archive, directory: isolatedDirectory, resourcesDir, identity });
  await fs.writeFile(path.join(directory, 'installed-owned-ui-host-proof.json'), JSON.stringify(uiHost, null, 2) + '\n');
  const owner = ownerQaRoot ? await qualifyInstalledOwnerBoot({ executable, resourcesDir, directory: isolatedDirectory, ownerQaRoot, identity }) : null;
  if (owner) await fs.writeFile(path.join(directory, 'installed-owner-boot-proof.json'), JSON.stringify(owner, null, 2) + '\n');
  const proof = Object.freeze({ schema: 'metaengine.browser.installed-launch-qualification.v1', ...identity,
    installed_source_files: sourceFiles, installed_source_bytes_verified: true,
    installed_asar_sha256: digest(await fs.readFile(archive)), installed_executable_sha256: digest(await fs.readFile(executable)),
    protected_offline_runtime_verified: runtime.packaged_resources_verified === true,
    first_run_qualified: firstRun.first_run_visible, installed_ui_host_qualified: uiHost.child_owned,
    os_ui_listener_verified: uiHost.os_listener.loopback_only === true,
    owner_boot_qualified: owner?.owner_boot_qualified === true,
    normal_ui_boot_verified: owner?.normal_ui_boot_verified === true,
    owner_qualification_state: owner ? 'PASSED_ISOLATED_REAL_RUNTIME' : 'REQUIRES_ISOLATED_SCHEMA_FIXTURE',
    evidence_directory: isolatedDirectory, candidate_first_run_and_ui_host_qualified: true,
    candidate_install_qualified: owner?.owner_boot_qualified === true,
    production_ready: false, release_published: false, promotion_authorized: false, authority_effect: false });
  await fs.writeFile(path.join(directory, 'installed-launch-qualification.json'), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'install-root': { type: 'string' }, 'source-root': { type: 'string' },
      'expected-head': { type: 'string' }, 'expected-version': { type: 'string' },
      'evidence-dir': { type: 'string' }, 'owner-qa-root': { type: 'string' } } });
    for (const key of ['install-root', 'source-root', 'evidence-dir']) if (!path.isAbsolute(values[key] || '')) fail('absolute_input_paths_required');
    const result = await qualifyInstalledClientLaunch({ installRoot: values['install-root'], sourceRoot: values['source-root'],
      expectedHead: values['expected-head'], expectedVersion: values['expected-version'], evidenceDirectory: values['evidence-dir'], ownerQaRoot: values['owner-qa-root'] });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error('INSTALLED_CLIENT_LAUNCH_QUALIFICATION_FAILED: ' + (String(error.message).startsWith('installed_launch_') ? error.message : 'installed_launch_contract_unproven'));
    process.exitCode = 1;
  }
}
