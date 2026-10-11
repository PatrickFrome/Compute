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
import { localAttachedProviderAutoConnectFile, LOCAL_ATTACHED_AUTOCONNECT_SCHEMA } from '../src/local-restored-pg17-setup.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const { assertPackagedOfflineRuntimeBinding } = require('./offline-runtime-package-binding.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
export const ISOLATED_OWNER_MARKER = 'metaengine-isolated-launch-qa.json';
export const REMOVED_DATABASE_WIZARD_FILES = Object.freeze([
  'src/local-restored-pg17-setup.html', 'src/local-restored-pg17-setup-preload.cjs',
]);
export const INSTALLED_LAUNCH_SOURCE_FILES = Object.freeze([
  'src/final-runtime-entry.mjs', 'src/main-entry.mjs', 'src/main.mjs',
  'src/single-instance-guard.mjs', 'src/self-update-handoff.mjs',
  'src/self-update-transaction-journal.mjs', 'src/durable-json-file.cjs',
  'src/local-state-provider-bootstrap.mjs', 'src/local-state-provider-policy.mjs',
  'src/local-runtime-host-controller.mjs', 'src/local-restored-pg17-setup.mjs',
  'src/local-restored-pg17-auto-prepare.mjs',
  'src/private-windows-storage-acl.mjs',
  'src/github-repository-connection.mjs', 'src/preload-shell.cjs',
  'src/remote-support-mcp.mjs', 'src/me2/me2-daemon-host.mjs',
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
    METAENGINE_GITHUB_CONNECTION_OFFLINE: '1', METAENGINE_DISABLE_SELF_UPDATE: '1',
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

export function assertMissingDescriptorAdmissionContract(row, output = '') {
  if (row?.schema !== 'metaengine.browser.provider-startup.v1' || row.state !== 'LOCAL_PROVIDER_STARTUP_BLOCKED'
    || row.reason !== 'local_state_packaged_owner_not_ready' || row.browser_runtime_started !== false
    || row.automatic_cloud_fallback !== false || row.authority_effect !== false
    || /RUNTIME_IMPORT_OK|ME2_INTEGRATION_START|DAEMON_HEALTHY|ME2_PRIMARY_SHELL_VISIBLE/.test(output)) {
    fail('missing_descriptor_admission_contract_invalid');
  }
  return true;
}

export function assertInstalledPrimaryWindowJournal(journal, { pid, version, expectedWindowId } = {}) {
  if (!journal?.current_boot_id || journal.current_pid !== pid || journal.current_version !== version
    || !Array.isArray(journal.events)) fail('normal_primary_window_journal_identity_invalid');
  const events = journal.events.filter(event => event.boot_id === journal.current_boot_id);
  if (events.some(event => event.pid !== pid || event.version !== version || !Number.isSafeInteger(event.sequence)
    || event.sequence < 1 || /FAILED/.test(event.state || ''))) fail('normal_primary_window_journal_failed');
  const imported = events.find(event => event.state === 'RUNTIME_IMPORT_OK');
  const stable = events.findLast(event => event.state === 'PRIMARY_WINDOW_STABLE');
  const windowId = stable?.details?.window_id;
  if (!imported || !stable || imported.sequence >= stable.sequence || stable.details?.visible !== true
    || !Number.isSafeInteger(windowId) || windowId < 1 || !Number.isFinite(stable.details.stable_ms) || stable.details.stable_ms < 1500
    || (expectedWindowId !== undefined && windowId !== expectedWindowId)) fail('normal_primary_window_stability_unproven');
  for (const event of events.filter(event => /TIMEOUT/.test(event.state || ''))) {
    if (event.state !== 'PRIMARY_WINDOW_STABLE_TIMEOUT' || event.sequence >= stable.sequence
      || event.details?.window_id !== windowId || !Number.isSafeInteger(event.details.window_count)
      || event.details.window_count < 1) fail('normal_primary_window_timeout_unreconciled');
  }
  return Object.freeze({ window_id: windowId, stable_sequence: stable.sequence,
    bootstrap_timeout_superseded: events.some(event => event.state === 'PRIMARY_WINDOW_STABLE_TIMEOUT'),
    visible: true, authority_effect: false });
}

export function assertInstalledPrimaryCdpWindow(before, after = before) {
  const valid = row => row && Number.isSafeInteger(row.window_id) && row.window_id > 0
    && ['normal', 'maximized'].includes(row.window_state) && row.width > 400 && row.height > 300;
  if (!valid(before) || !valid(after) || before.window_id !== after.window_id) fail('normal_primary_cdp_window_unproven');
  return true;
}

export function assertInstalledVisibleWindow(rows, { pid, expectedHandle } = {}) {
  const windows = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const candidates = windows.filter(row => row?.pid === pid && row.visible === true
    && row.minimized === false && row.class_name === 'Chrome_WidgetWin_1' && row.title === 'METAENGINE Browser'
    && row.width > 400 && row.height > 300 && /^[1-9][0-9]*$/.test(String(row.handle || '')));
  if (candidates.length !== 1 || (expectedHandle !== undefined && candidates[0].handle !== expectedHandle)) {
    fail('normal_primary_os_window_unproven');
  }
  return Object.freeze({ pid, handle: candidates[0].handle, width: candidates[0].width,
    height: candidates[0].height, title: 'METAENGINE Browser', class_name: 'Chrome_WidgetWin_1',
    visible: true, minimized: false, authority_effect: false });
}

export async function verifyInstalledVisiblePrimaryWindow(pid, expectedHandle) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('normal_primary_os_window_identity_invalid');
  const script = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class MetaengineVisibleWindow {
  public delegate bool Visitor(IntPtr handle, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr handle, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr handle, StringBuilder text, int length);
  public static string[] Read(uint wanted) {
    var rows = new List<string>();
    EnumWindows((handle, data) => {
      uint pid; Rect rect; GetWindowThreadProcessId(handle, out pid);
      var title = new StringBuilder(256); var className = new StringBuilder(128);
      GetWindowTextW(handle, title, title.Capacity); GetClassNameW(handle, className, className.Capacity);
      if (pid == wanted && IsWindowVisible(handle) && !IsIconic(handle)
          && title.ToString() == "METAENGINE Browser" && className.ToString() == "Chrome_WidgetWin_1"
          && GetClientRect(handle, out rect))
        rows.Add(handle.ToInt64().ToString()+","+(rect.Right-rect.Left).ToString()+","+(rect.Bottom-rect.Top).ToString());
      return true;
    }, IntPtr.Zero); return rows.ToArray();
  }
}
'@
$rows=@([MetaengineVisibleWindow]::Read([uint32]$env:METAENGINE_QUALIFY_WINDOW_PID) | ForEach-Object {
 $parts=$_.Split(','); @{pid=[int]$env:METAENGINE_QUALIFY_WINDOW_PID;handle=$parts[0];width=[int]$parts[1];height=[int]$parts[2];visible=$true;minimized=$false;title='METAENGINE Browser';class_name='Chrome_WidgetWin_1'}
})
ConvertTo-Json -InputObject $rows -Compress`;
  const windows = 'C:\\Windows';
  const safeEnv = Object.fromEntries(['USERPROFILE', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']
    .filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
  Object.assign(safeEnv, { SystemRoot: windows, SYSTEMROOT: windows, WINDIR: windows,
    PATH: path.win32.join(windows, 'System32'),
    PSModulePath: path.win32.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    METAENGINE_QUALIFY_WINDOW_PID: String(pid) });
  const result = await execute(path.win32.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, shell: false, timeout: 60000, maxBuffer: 16384,
      env: safeEnv });
  return assertInstalledVisibleWindow(JSON.parse(result.stdout), { pid, expectedHandle });
}

export function assertOwnerStartupGrace({ before, after, sentinelBefore, sentinelAfter, progressBefore, progressAfter, pid, now = Date.now(), version }) {
  const initialWindow = assertInstalledPrimaryWindowJournal(before, { pid, version });
  assertInstalledPrimaryWindowJournal(after, { pid, version, expectedWindowId: initialWindow.window_id });
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

export function assertOfflineSuccessorBinding({ preInstall, preInstallBytes, successor, transaction, transactionBefore,
  pid, appId, expectedVersion, expectedHead }) {
  const preInstallSha256 = digest(preInstallBytes);
  if (preInstall?.schema !== 'metaengine.self-update.pre-install-receipt.v1'
    || preInstall.version !== expectedVersion || preInstall.available_version !== expectedVersion
    || preInstall.successor_startup !== 'PROBE_ONLY' || preInstall.metadata_verified !== true
    || preInstall.restart_gate_safe !== true || preInstall.authority_effect !== false
    || preInstall.resolved_git_sha !== expectedHead || !/^[a-f0-9]{40}$/.test(expectedHead || '')
    || successor?.schema !== 'metaengine.self-update.successor-receipt.v1'
    || successor.version !== expectedVersion || successor.pid !== pid || successor.primary_instance !== true
    || successor.app_id !== appId || successor.successor_startup !== 'PROBE_ONLY'
    || successor.qualification_state !== 'BOOT_VERIFIED'
    || successor.pre_install_receipt_sha256 !== preInstallSha256
    || successor.pre_install_recorded_at !== preInstall.recorded_at || successor.authority_effect !== false
    || transaction?.schema !== 'metaengine.self-update.transaction.v1'
    || transaction.state !== 'SUCCESSOR_BOOTED' || transaction.target_version !== expectedVersion
    || transaction.resolved_git_sha !== expectedHead || transaction.qualified !== false || transaction.quarantined !== false
    || transaction.automatic_retry_allowed !== false || transaction.authority_effect !== false
    || transactionBefore?.state !== 'PREPARED' || !transactionBefore.transaction_id
    || transaction.transaction_id !== transactionBefore.transaction_id
    || transaction.source_version !== transactionBefore.source_version
    || transaction.created_at !== transactionBefore.created_at || transaction.attempt_count !== transactionBefore.attempt_count
    || transaction.evidence?.updated_argv !== true || transaction.evidence?.primary_instance !== true
    || transaction.evidence?.boot_version_match !== true || transaction.evidence?.physical_effect_attempted === true
    || transaction.evidence?.effect_barrier_crossed === true) {
    fail('offline_successor_binding_invalid');
  }
  if (!Number.isSafeInteger(successor.pid) || successor.pid < 1
    || !SHA.test(successor.pre_install_receipt_sha256)
    || !Number.isFinite(Date.parse(successor.recorded_at))) fail('offline_successor_receipt_invalid');
  return Object.freeze({ pre_install_receipt_sha256: preInstallSha256, transaction_id: transaction.transaction_id });
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
  try { await execute('taskkill.exe', ['/PID', String(launch.child.pid), '/T', '/F'], { windowsHide: true, timeout: 60000 }); }
  catch { if (launch.child.exitCode === null) fail('process_cleanup_unconfirmed'); }
  await Promise.race([launch.closed, deadline(60000, 'process_cleanup_timeout')]);
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

async function storageSnapshot(root) {
  const rows = {};
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file);
      if (entry.isSymbolicLink()) fail('offline_fixture_storage_link_refused');
      if (entry.isDirectory()) { rows[relative] = 'DIRECTORY'; await visit(file); }
      else if (entry.isFile()) rows[relative] = digest(await fs.readFile(file));
      else fail('offline_fixture_storage_type_invalid');
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
}

// The normal CLI uses the exact installed executable without module loader or
// provider bypass flags. Process boundaries are injectable only for behavior
// tests; receipt persistence and final-path readback use production modules.
export async function qualifyInstalledOfflineSuccessor({ executable, archive, directory, identity }, {
  launchProcess = start, stopProcess = stop, probeProfile = profileProbe,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(identity?.source_head || '') || !identity.package_version
    || !SHA.test(identity.bundle_sha256 || '')) fail('offline_successor_identity_invalid');
  const root = path.join(directory, 'offline-successor-' + randomUUID());
  const appData = path.join(root, 'Roaming'), localAppData = path.join(root, 'Local'), temporaryDirectory = path.join(root, 'Temp');
  const protectedStorage = path.join(root, 'protected-storage');
  for (const target of [appData, localAppData, temporaryDirectory, protectedStorage]) await fs.mkdir(target, { recursive: true });
  const ports = [];
  while (ports.length < 3) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const env = isolatedLaunchEnvironment({ appData, localAppData, temporaryDirectory,
    uiPort: ports[0], gatewayPort: ports[1], daemonPort: ports[2] });
  const artifactHashes = { installed_executable_sha256: digest(await fs.readFile(executable)),
    installed_asar_sha256: digest(await fs.readFile(archive)) };
  const profile = await probeProfile(executable, env, root);
  const userData = await fs.realpath(profile.user_data_path);
  if (!contained(await fs.realpath(appData), userData) || profile.version !== identity.package_version
    || profile.app_id !== 'com.metaengine.browser.test' || profile.primary_instance !== true) fail('offline_profile_binding_invalid');
  const ownerFile = path.join(appData, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json');
  await fs.mkdir(path.dirname(ownerFile), { recursive: true });
  // A provider bootstrap cannot accept this owner. Exit 0 with a bound receipt
  // therefore exercises the receipt-first admission fence in installed bytes.
  const ownerBytes = Buffer.from('isolated-offline-successor-invalid-owner\n');
  await fs.writeFile(ownerFile, ownerBytes, { flag: 'wx' });
  for (const name of ['pg-data', 'runtime-state', 'vault']) {
    const target = path.join(protectedStorage, name);
    await fs.mkdir(target); await fs.writeFile(path.join(target, 'qualification-sentinel'), randomUUID(), { flag: 'wx' });
  }
  const storageBefore = await storageSnapshot(protectedStorage);
  const { persistPreInstallReceipt, selfUpdateHandoffPaths } = await import('../src/self-update-handoff.mjs');
  const { readSelfUpdateTransaction } = await import('../src/self-update-transaction-journal.mjs');
  const app = { isPackaged: true, hasSingleInstanceLock: () => true,
    getPath: () => userData, getVersion: () => identity.package_version };
  const preInstall = { schema: 'metaengine.self-update.pre-install-receipt.v1', version: identity.package_version,
    available_version: identity.package_version, resolved_git_sha: identity.source_head,
    metadata_verified: true, restart_gate_safe: true, successor_startup: 'PROBE_ONLY',
    recorded_at: new Date().toISOString(), qa_synthetic_handoff: true, installation_performed: false, authority_effect: false };
  await persistPreInstallReceipt(app, preInstall);
  const paths = selfUpdateHandoffPaths(app), transactionBefore = await readSelfUpdateTransaction(app);
  const preInstallBytes = await fs.readFile(paths.pre_install);
  const launch = launchProcess(executable, ['--updated', '--user-data-dir=' + userData], env, root);
  let successor, transaction, binding;
  try {
    const result = await Promise.race([launch.closed, deadline(20000, 'offline_successor_exit_timeout')]);
    if (result.code !== 0 || result.signal) fail('offline_successor_exit_invalid');
    successor = JSON.parse(await fs.readFile(paths.successor, 'utf8'));
    transaction = await readSelfUpdateTransaction(app);
    binding = assertOfflineSuccessorBinding({ preInstall, preInstallBytes, successor, transaction, transactionBefore,
      pid: launch.child.pid, appId: profile.app_id, expectedVersion: identity.package_version, expectedHead: identity.source_head });
    const output = launch.output().split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    if (!output.some(row => row.schema === successor.schema && JSON.stringify(row) === JSON.stringify(successor))) fail('offline_successor_output_readback_mismatch');
    if (/LOCAL_PROVIDER_STARTUP_BLOCKED|RUNTIME_IMPORT_OK|ME2_INTEGRATION_START|DAEMON_HEALTHY|ME2_PRIMARY_SHELL_VISIBLE/.test(launch.output())) fail('offline_successor_runtime_admitted');
    if (!(await fs.readFile(paths.pre_install)).equals(preInstallBytes)) fail('offline_pre_install_receipt_modified');
    if (!(await fs.readFile(ownerFile)).equals(ownerBytes)) fail('offline_owner_fixture_modified');
    if (JSON.stringify(await storageSnapshot(protectedStorage)) !== JSON.stringify(storageBefore)) fail('offline_fixture_storage_modified');
    for (const name of ['metaengine-browser-startup-journal-v1.json', 'metaengine-browser-sentinel-v1.json', 'runtime-host-lock.json']) {
      try { await fs.stat(path.join(userData, name)); fail('offline_successor_runtime_artifact_created'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const port of ports) await assertPortClosed(port);
    if (digest(await fs.readFile(executable)) !== artifactHashes.installed_executable_sha256
      || digest(await fs.readFile(archive)) !== artifactHashes.installed_asar_sha256) fail('offline_installed_artifacts_modified');
  } finally {
    await stopProcess(launch);
    await fs.writeFile(path.join(directory, 'installed-offline-successor.log'), launch.output());
  }
  // Remove only the synthetic owner created above. The ordinary exact-binary
  // profile probe can then independently reacquire the same singleton profile.
  await fs.unlink(ownerFile);
  const transactionBytes = await fs.readFile(path.join(userData, 'metaengine-self-update-transaction-v1.json'));
  const successorBytes = await fs.readFile(paths.successor);
  const reacquired = await probeProfile(executable, env, root);
  if (reacquired.primary_instance !== true || reacquired.user_data_path !== profile.user_data_path
    || reacquired.version !== identity.package_version || reacquired.app_id !== profile.app_id) fail('offline_singleton_reacquisition_invalid');
  if (!(await fs.readFile(paths.successor)).equals(successorBytes)
    || !(await fs.readFile(path.join(userData, 'metaengine-self-update-transaction-v1.json'))).equals(transactionBytes)) fail('offline_handoff_modified_by_profile_probe');
  return Object.freeze({ schema: 'metaengine.browser.installed-offline-successor-proof.v1', ...identity, ...artifactHashes, ...binding,
    launch: 'INSTALLED_UPDATED_PROBE_ONLY', profile_isolated: true, synthetic_handoff: true, installation_performed: false,
    durable_successor_receipt_verified: true, successor_startup: successor.successor_startup,
    successor_pid: successor.pid, successor_app_id: successor.app_id, transaction_state: transaction.state,
    receipt_first_admission_fence_verified: true, malformed_owner_fixture_unchanged: true,
    isolated_fixture_storage_unchanged: true, runtime_startup_artifacts_absent: true, runtime_ports_closed: true,
    installed_artifacts_unchanged: true, process_cleanup_confirmed: true, singleton_reacquisition_verified: true,
    offline_successor_probe_qualified: true, physical_update_qualified: false,
    owner_boot_qualified: false, production_ready: false, authority_effect: false });
}

export async function qualifyInstalledFirstRun({ executable, directory, identity }) {
  const appData = path.join(directory, 'first-run', 'Roaming');
  const localAppData = path.join(directory, 'first-run', 'Local');
  const temporaryDirectory = path.join(directory, 'first-run', 'Temp');
  for (const target of [appData, localAppData, temporaryDirectory]) await fs.mkdir(target, { recursive: true });
  const ports = [];
  while (ports.length < 3) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const [uiPort, gatewayPort, daemonPort] = ports;
  const env = isolatedLaunchEnvironment({ appData, localAppData, temporaryDirectory, uiPort, gatewayPort, daemonPort });
  const descriptorFile = localAttachedProviderAutoConnectFile({ env, platform: 'win32' });
  await assert.rejects(fs.stat(descriptorFile), { code: 'ENOENT' });
  const profile = await profileProbe(executable, env, directory);
  // Missing trust input must block ordinary startup. A separate real-runtime
  // Owner run proves successful automatic attachment and the primary UI.
  const launch = start(executable, ['--user-data-dir=' + profile.user_data_path], env, directory);
  let proof;
  try {
    const blocked = await waitUntil(async () => launch.output().split(/\r?\n/).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).find(row => row.schema === 'metaengine.browser.provider-startup.v1' && row.state === 'LOCAL_PROVIDER_STARTUP_BLOCKED'), null, 90000);
    assertMissingDescriptorAdmissionContract(blocked, launch.output());
    for (const file of [path.join(appData, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json'),
      path.join(profile.user_data_path, 'metaengine-browser-startup-journal-v1.json')]) {
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
    proof = { schema: 'metaengine.browser.installed-first-run-proof.v2', ...identity,
      launch: 'NORMAL_INSTALLED_ENTRY', profile_isolated: true, database_wizard_removed: true,
      descriptor_absent: true, missing_descriptor_admission_fence_verified: true,
      owner_profile_written: false, browser_runtime_admitted: false, automatic_cloud_fallback: false,
      owner_boot_qualified: false, production_ready: false, authority_effect: false };
  } finally {
    await stop(launch);
    await fs.writeFile(path.join(directory, 'installed-first-run.log'), launch.output());
    for (const port of ports) await assertPortClosed(port);
  }
  return Object.freeze({ ...proof, process_cleanup_confirmed: true });
}

export async function qualifyInstalledUiHost({ executable, asar, archive, directory, resourcesDir, identity }) {
  const uiProof = verifyMe2UiBundle(path.join(resourcesDir, 'me2-ui'), identity.source_head);
  const port = await freePort();
  const hostBytes = asar.extractFile(archive, path.normalize('src/me2/me2-ui-host.mjs'));
  const hostFile = path.join(directory, 'installed-me2-ui-host.mjs');
  await fs.writeFile(hostFile, hostBytes, { flag: 'wx' });
  const harnessFile = path.join(directory, 'installed-me2-ui-host-harness.mjs');
  await fs.writeFile(harnessFile, `import { pathToFileURL } from 'node:url';
const host = await import(pathToFileURL(process.argv[2]).href);
try {
  const state = await host.startMe2UiHost();
  if (state.state !== 'HEALTHY' || state.mode !== 'spawned' || state.child_owned !== true
    || state.launch_mode !== 'EMBEDDED_NODE_STANDALONE') throw new Error('installed_launch_host_not_owned');
  process.send({ ...state, schema: 'metaengine.browser.installed-ui-host-readback.v1' });
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
    }), deadline(150000, 'host_ready_timeout')]);
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
    const result = await Promise.race([closed, delay(60000, null, { ref: false })]);
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
  return { root, appData, localAppData, temporaryDirectory, owner, ownerFile, ownerBytes, ownerSha256: digest(ownerBytes), config };
}

/** The fixture marker above excludes the user's profile. Only that disposable
 * fixture's Owner is retired here so ordinary installed startup must consume
 * a real private descriptor and publish a newly attested Owner itself. */
export async function prepareIsolatedAttachedAutoConnect(fixture, identity, {
  protectStorage = protectOwnerOnlyWindowsDirectory, verifyStorage = verifyOwnerOnlyWindowsStorage,
} = {}) {
  if (fixture.config?.postgres_mode !== 'attached' || fixture.config.api_role_mode !== 'direct'
    || !contained(fixture.root, fixture.ownerFile) || !contained(fixture.root, fixture.owner.runtime_host.config_file)) {
    fail('automatic_attached_fixture_required');
  }
  const marker = JSON.parse(await fs.readFile(path.join(fixture.root, ISOLATED_OWNER_MARKER), 'utf8'));
  if (marker.schema !== 'metaengine.browser.isolated-owner-launch-fixture.v1' || marker.production_profile !== false
    || marker.source_data_rows_restored !== 0 || marker.source_head !== identity.source_head) fail('owner_fixture_marker_invalid');
  const restoreFile = path.join(fixture.root, 'schema-only-restore-report.json');
  const restoreBytes = await fs.readFile(restoreFile);
  const restore = JSON.parse(restoreBytes);
  if (restore.schema !== 'metaengine.database-restore-report.v1' || restore.schema_verified !== true
    || restore.data_verified !== true || restore.schema_only !== true || restore.disposable !== true
    || restore.source_data_rows_restored !== 0 || !SHA.test(restore.source_dump_sha256 || '')
    || !Array.isArray(restore.errors) || restore.errors.length !== 0) fail('automatic_attached_restore_fixture_invalid');
  const descriptorFile = localAttachedProviderAutoConnectFile({ env: { LOCALAPPDATA: fixture.localAppData }, platform: 'win32' });
  if (!contained(fixture.root, descriptorFile)) fail('automatic_attached_fixture_escape');
  await fs.mkdir(path.dirname(descriptorFile), { recursive: true, mode: 0o700 });
  const protectedDirectory = await protectStorage(path.dirname(descriptorFile));
  if (protectedDirectory?.owner_dacl_verified !== true || protectedDirectory.operation !== 'PROTECT_DIRECTORY') fail('automatic_attached_descriptor_acl_unverified');
  const descriptorBytes = Buffer.from(JSON.stringify({ schema: LOCAL_ATTACHED_AUTOCONNECT_SCHEMA, version: 1,
    postgres_mode: 'attached', config_file: fixture.owner.runtime_host.config_file,
    restore_receipt_file: restoreFile, restore_receipt_sha256: digest(restoreBytes), authority_effect: false }) + '\n');
  await fs.writeFile(descriptorFile, descriptorBytes, { flag: 'wx', mode: 0o600 });
  const privateFile = await verifyStorage(descriptorFile, { operation: 'VERIFY_FILE' });
  if (privateFile?.owner_dacl_verified !== true || privateFile.operation !== 'VERIFY_FILE') fail('automatic_attached_descriptor_acl_unverified');
  const currentOwner = await fs.readFile(fixture.ownerFile);
  if (!currentOwner.equals(fixture.ownerBytes)) fail('automatic_attached_fixture_owner_changed');
  const sourceConfigBytes = await fs.readFile(fixture.owner.runtime_host.config_file);
  await fs.rename(fixture.ownerFile, path.join(fixture.root, 'owner-before-autoconnect.json'));
  await assert.rejects(fs.stat(fixture.ownerFile), { code: 'ENOENT' });
  return { descriptorFile, descriptorSha256: digest(descriptorBytes), sourceConfigBytes,
    originalConfigFile: fixture.owner.runtime_host.config_file };
}

export function assertAutomaticAttachedOwnerBinding({ previous, current, config, expectedConfig,
  resourcesDir, identity, fixtureRoot }) {
  if (current?.base_url !== previous?.base_url || current?.runtime_identity_file !== previous?.runtime_identity_file
    || current?.runtime_host?.expected_bundle_sha256 !== identity.bundle_sha256
    || path.resolve(current?.runtime_host?.bundle_directory || '') !== path.resolve(resourcesDir, 'client-state-runtime')
    || !contained(fixtureRoot, current?.runtime_host?.config_file || '')
    || current.runtime_host.config_file === previous?.runtime_host?.config_file
    || config?.postgres_mode !== 'attached' || config.api_role_mode !== 'direct') fail('automatic_attached_owner_binding_invalid');
  // Rebinding changes only package path/digest. Credentials, PGDATA, state,
  // ports and the pinned external cluster remain exactly the fixture's input.
  const expected = { ...expectedConfig, bundle_directory: path.resolve(resourcesDir, 'client-state-runtime'),
    expected_bundle_sha256: identity.bundle_sha256,
    state_directory: path.resolve(expectedConfig.state_directory), pg_data_directory: path.resolve(expectedConfig.pg_data_directory) };
  if (JSON.stringify(Object.entries(config).sort()) !== JSON.stringify(Object.entries(expected).sort())) fail('automatic_attached_config_binding_invalid');
  return true;
}

async function normalUiSocket(port, primaryPid, executable) {
  const script = `$ErrorActionPreference='Stop'; $rows=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop); $ids=@($rows.OwningProcess | Select-Object -Unique); if($ids.Count -ne 1){throw 'owner_socket_ambiguous'}; Get-CimInstance Win32_Process -Filter ('ProcessId='+$ids[0]) | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress`;
  const { stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60000, maxBuffer: 16384 });
  const row = JSON.parse(stdout);
  if (row.ParentProcessId !== primaryPid || String(row.ExecutablePath).toLowerCase() !== executable.toLowerCase()) fail('normal_ui_child_process_mismatch');
  return verifyWindowsTcpListener({ port, pid: row.ProcessId });
}

export async function qualifyInstalledOwnerBoot({ executable, resourcesDir, directory, ownerQaRoot, identity }) {
  const fixture = await ownerProfile({ ownerQaRoot, resourcesDir, identity });
  const automatic = await prepareIsolatedAttachedAutoConnect(fixture, identity);
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
  const liveCdpWindow = async () => {
    const window = await client.command('Browser.getWindowForTarget');
    const readback = await client.command('Browser.getWindowBounds', { windowId: window.windowId });
    return { window_id: window.windowId, window_state: readback.bounds?.windowState,
      width: readback.bounds?.width, height: readback.bounds?.height };
  };
  try {
    const before = await waitUntil(async () => {
      const row = await journal();
      const events = currentEvents(row);
      if (events.some(event => event.state === 'RUNTIME_IMPORT_FAILED')) fail('normal_runtime_import_failed');
      assertInstalledPrimaryWindowJournal(row, { pid: launch.child.pid, version: identity.package_version });
      return row;
    }, launch, 420000);
    const ownerBytes = await fs.readFile(fixture.ownerFile);
    const currentOwner = validateLocalStateProviderConfig(JSON.parse(ownerBytes));
    const currentConfig = JSON.parse(await fs.readFile(currentOwner.runtime_host.config_file, 'utf8'));
    assertAutomaticAttachedOwnerBinding({ previous: fixture.owner, current: currentOwner, config: currentConfig,
      expectedConfig: fixture.config, resourcesDir, identity, fixtureRoot: fixture.root });
    if (!(await fs.readFile(automatic.originalConfigFile)).equals(automatic.sourceConfigBytes)
      || digest(await fs.readFile(automatic.descriptorFile)) !== automatic.descriptorSha256) fail('automatic_attached_input_changed');
    fixture.owner = currentOwner; fixture.ownerSha256 = digest(ownerBytes); fixture.config = currentConfig;
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
    const cdpWindowBefore = await liveCdpWindow();
    assertInstalledPrimaryCdpWindow(cdpWindowBefore);
    const osWindowBefore = await verifyInstalledVisiblePrimaryWindow(launch.child.pid);
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
    assertOwnerStartupGrace({ before, after, sentinelBefore, sentinelAfter, progressBefore, progressAfter,
      pid: launch.child.pid, version: identity.package_version });
    const journalWindow = assertInstalledPrimaryWindowJournal(after, { pid: launch.child.pid, version: identity.package_version });
    const cdpWindowAfter = await liveCdpWindow();
    assertInstalledPrimaryCdpWindow(cdpWindowBefore, cdpWindowAfter);
    const osWindowAfter = await verifyInstalledVisiblePrimaryWindow(launch.child.pid, osWindowBefore.handle);
    const activation = currentEvents(after).find(row => row.state === 'PRIMARY_WINDOW_ACTIVATED' && row.details.launch_id === ack.launch_id
      && row.sequence === ack.event_sequence && row.details.visible === true);
    if (!activation || activation.details.window_id !== journalWindow.window_id) fail('second_instance_activation_missing');
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
      database_wizard_removed: true, automatic_attached_connection_qualified: true,
      automatic_owner_publication_verified: true, private_autoconnect_descriptor_verified: true,
      descriptor_sha256: automatic.descriptorSha256, source_config_preserved: true,
      second_instance_activation_verified: true, startup_grace_survival_seconds: 190,
      sentinel_relaunch_attempted: false, ui_listener: uiListener, gateway_listener: gatewayListener,
      api_listener: apiListener, edge_listener: edgeListener,
      same_ui_child_across_startup_grace: true, screenshot_sha256: digest(png), screenshot_bytes: png.length,
      stable_primary_window_id: journalWindow.window_id, same_primary_window_across_startup_grace: true,
      current_cdp_window: cdpWindowAfter, bootstrap_window_timeout_superseded: journalWindow.bootstrap_timeout_superseded,
      current_os_window: osWindowAfter, current_os_window_visible: true, same_os_window_across_startup_grace: true,
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
  const installedHashes = { installed_asar_sha256: digest(await fs.readFile(archive)),
    installed_executable_sha256: digest(await fs.readFile(executable)) };
  const asar = await import('@electron/asar');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const identity = assertInstalledLaunchIdentity(pkg, { expectedHead, expectedVersion });
  const installedEntries = new Set(asar.listPackage(archive).map(entry => path.normalize(entry).replace(/^[\\/]+/, '')));
  if (REMOVED_DATABASE_WIZARD_FILES.some(file => installedEntries.has(path.normalize(file)))) fail('database_wizard_still_packaged');
  const sourceFiles = {};
  for (const relative of INSTALLED_LAUNCH_SOURCE_FILES) {
    const installed = asar.extractFile(archive, path.normalize(relative));
    const source = await fs.readFile(path.join(sourceRoot, 'apps/metaengine-browser', relative));
    if (!installed.equals(source)) fail('installed_source_bytes_mismatch');
    sourceFiles[relative] = digest(installed);
  }
  const runtime = await assertPackagedOfflineRuntimeBinding(pkg.metaengineClientStateRuntime, {
    expectedHead, packageVersion: expectedVersion, resourcesDir,
    verifierBytes: asar.extractFile(archive, path.normalize('infra/client-state-runtime/offline-runtime-bundle.mjs')),
  });
  const isolatedDirectory = path.join(directory, 'isolated-launch-' + randomUUID());
  await fs.mkdir(isolatedDirectory);
  const offlineSuccessor = await qualifyInstalledOfflineSuccessor({ executable, archive, directory: isolatedDirectory, identity });
  if (offlineSuccessor.installed_asar_sha256 !== installedHashes.installed_asar_sha256
    || offlineSuccessor.installed_executable_sha256 !== installedHashes.installed_executable_sha256) fail('installed_artifact_identity_changed');
  await fs.writeFile(path.join(directory, 'installed-offline-successor-proof.json'), JSON.stringify(offlineSuccessor, null, 2) + '\n');
  const firstRun = await qualifyInstalledFirstRun({ executable, directory: isolatedDirectory, identity });
  await fs.writeFile(path.join(directory, 'installed-first-run-proof.json'), JSON.stringify(firstRun, null, 2) + '\n');
  const uiHost = await qualifyInstalledUiHost({ executable, asar, archive, directory: isolatedDirectory, resourcesDir, identity });
  await fs.writeFile(path.join(directory, 'installed-owned-ui-host-proof.json'), JSON.stringify(uiHost, null, 2) + '\n');
  const owner = ownerQaRoot ? await qualifyInstalledOwnerBoot({ executable, resourcesDir, directory: isolatedDirectory, ownerQaRoot, identity }) : null;
  if (owner) await fs.writeFile(path.join(directory, 'installed-owner-boot-proof.json'), JSON.stringify(owner, null, 2) + '\n');
  if (digest(await fs.readFile(archive)) !== installedHashes.installed_asar_sha256
    || digest(await fs.readFile(executable)) !== installedHashes.installed_executable_sha256) fail('installed_artifact_identity_changed');
  const proof = Object.freeze({ schema: 'metaengine.browser.installed-launch-qualification.v1', ...identity,
    installed_source_files: sourceFiles, installed_source_bytes_verified: true,
    database_wizard_removed: true,
    ...installedHashes, offline_successor_probe_qualified: offlineSuccessor.offline_successor_probe_qualified === true,
    protected_offline_runtime_verified: runtime.packaged_resources_verified === true,
    first_run_qualified: firstRun.missing_descriptor_admission_fence_verified, installed_ui_host_qualified: uiHost.child_owned,
    automatic_attached_connection_qualified: owner?.automatic_attached_connection_qualified === true,
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
