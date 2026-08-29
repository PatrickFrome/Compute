import { app, BaseWindow, WebContentsView, ipcMain, protocol, session, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBridgeClient } from './compute-bridge-client.mjs';
import { DevelopmentPlane } from './development-plane.mjs';
import { FleetProvisioner } from './fleet-provisioner.mjs';
import { navigationDecision, newWindowDecision, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from './browser-policy.mjs';
import { TabRegistry } from './tab-registry.mjs';
import { DiagnosticBuffer, sanitizeDiagnosticUrl } from './test-console-diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const SHELL_BAR_HEIGHT = 92;
const TEST_CONSOLE_HEIGHT = 300;
const TEST_BUILD_VERSION = '0.5.0-test.1';
const isSmoke = process.argv.includes('--metaengine-smoke');
const isDevelopmentPlaneSmoke = process.argv.includes('--metaengine-devplane-smoke');

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const registry = new TabRegistry();
const views = new Map();
const bridge = new ComputeBridgeClient();
const diagnostics = new DiagnosticBuffer({ limit: 120 });
let windowRef = null;
let shellView = null;
let userSession = null;
let fleet = null;
let developmentPlane = null;
let testConsoleOpen = true;
let lastSelfTest = null;

diagnostics.record('INFO', 'TEST_BUILD_BOOT', { version: TEST_BUILD_VERSION, platform: process.platform });

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown_error')
    .replace(/((?:bearer|token|secret|password|api[-_ ]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 240);
}

function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function registerShellProtocol() {
  protocol.handle('metaengine', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'shell') return new Response('not found', { status: 404 });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    if (!['index.html', 'app.js', 'app.css'].includes(rel)) return new Response('not found', { status: 404 });
    const body = await fs.readFile(path.join(UI_ROOT, rel));
    return new Response(body, { status: 200, headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' } });
  });
}

function configureUserSession() {
  userSession = session.fromPartition(SECURITY_POLICY.user_space_partition, { cache: true });
  userSession.setPermissionCheckHandler(() => false);
  userSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  userSession.on('will-download', (event) => {
    diagnostics.record('WARN', 'DOWNLOAD_BLOCKED_BY_POLICY', {});
    event.preventDefault();
    publishSnapshot().catch(() => {});
  });
}

function fleetStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v1.json');
}

async function loadFleetState() {
  try {
    return JSON.parse(await fs.readFile(fleetStatePath(), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveFleetState(state) {
  const target = fleetStatePath();
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
}

function assertShellSender(event) {
  if (!shellView || event.sender.id !== shellView.webContents.id) throw new Error('shell_sender_not_trusted');
}

async function safeComputeHealth() {
  try {
    return await bridge.health();
  } catch (error) {
    return { available: false, error: safeErrorMessage(error), authority_effect: false };
  }
}

async function shellSnapshot() {
  return {
    schema: 'metaengine.browser-shell.snapshot.v3',
    version: '0.4.0-test',
    tabs: registry.snapshot(),
    fleet: fleet?.snapshot() || null,
    development_plane: developmentPlane?.snapshot() || null,
    compute: await safeComputeHealth(),
    test_console: {
      schema: 'metaengine.browser-test.console-state.v1',
      build_version: TEST_BUILD_VERSION,
      open: testConsoleOpen,
      panel_height: TEST_CONSOLE_HEIGHT,
      diagnostics: diagnostics.snapshot(),
      last_self_test: lastSelfTest,
      runtime: {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || null,
        chromium: process.versions.chrome || null,
        node: process.versions.node || null,
      },
      authority_effect: false,
    },
    policy: SECURITY_POLICY,
    authority_effect: false,
  };
}

async function publishSnapshot() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send('metaengine:shell:snapshot', await shellSnapshot());
}

function shellHeight() {
  return SHELL_BAR_HEIGHT + (testConsoleOpen ? TEST_CONSOLE_HEIGHT : 0);
}

function layout() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const { width, height } = windowRef.getContentBounds();
  const top = Math.min(height, shellHeight());
  shellView?.setBounds({ x: 0, y: 0, width, height: top });
  const selected = registry.selected();
  for (const [tabId, view] of views) {
    if (tabId === selected?.tab_id) view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }
}

function attachSelected() {
  if (!windowRef) return;
  const selected = registry.selected();
  for (const [tabId, view] of views) {
    if (tabId === selected?.tab_id) {
      try { windowRef.contentView.addChildView(view); } catch {}
    } else {
      try { windowRef.contentView.removeChildView(view); } catch {}
    }
  }
  if (shellView) {
    try { windowRef.contentView.addChildView(shellView); } catch {}
  }
  layout();
}

function wireRemoteView(tab, view) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const d = newWindowDecision(url);
    if (d.allow) {
      diagnostics.record('INFO', 'REMOTE_NEW_WINDOW_ROUTED_TO_TAB', { url: sanitizeDiagnosticUrl(d.normalized_url) });
      setImmediate(() => createTab(d.normalized_url, { select: true }).catch((error) => {
        diagnostics.record('ERROR', 'REMOTE_NEW_WINDOW_TAB_FAILED', { error: safeErrorMessage(error) });
        publishSnapshot().catch(() => {});
      }));
    } else {
      diagnostics.record('WARN', 'REMOTE_NEW_WINDOW_BLOCKED', { url: sanitizeDiagnosticUrl(url), reason: d.reason || 'POLICY' });
    }
    publishSnapshot().catch(() => {});
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    const d = navigationDecision(url);
    if (!d.allow) {
      event.preventDefault();
      diagnostics.record('WARN', 'NAVIGATION_BLOCKED', { tab_id: tab.tab_id, url: sanitizeDiagnosticUrl(url), reason: d.reason || 'POLICY' });
      publishSnapshot().catch(() => {});
    }
  });
  view.webContents.on('will-redirect', (event, url) => {
    const d = navigationDecision(url);
    if (!d.allow) {
      event.preventDefault();
      diagnostics.record('WARN', 'REDIRECT_BLOCKED', { tab_id: tab.tab_id, url: sanitizeDiagnosticUrl(url), reason: d.reason || 'POLICY' });
      publishSnapshot().catch(() => {});
    }
  });
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    diagnostics.record('ERROR', 'PAGE_LOAD_FAILED', {
      tab_id: tab.tab_id,
      error_code: errorCode,
      error: String(errorDescription || '').slice(0, 160),
      url: sanitizeDiagnosticUrl(validatedURL),
    });
    publishSnapshot().catch(() => {});
  });
  const sync = () => {
    if (view.webContents.isDestroyed()) return;
    const url = view.webContents.getURL() || tab.url;
    const d = navigationDecision(url);
    registry.update(tab.tab_id, { url: d.allow ? d.normalized_url : tab.url, kind: d.allow ? d.kind : tab.kind, title: view.webContents.getTitle() || tab.title });
    publishSnapshot().catch(() => {});
  };
  view.webContents.on('did-navigate', (_event, url) => {
    diagnostics.record('INFO', 'TAB_NAVIGATED', { tab_id: tab.tab_id, url: sanitizeDiagnosticUrl(url) });
    sync();
  });
  view.webContents.on('did-navigate-in-page', sync);
  view.webContents.on('page-title-updated', sync);
  view.webContents.on('unresponsive', () => {
    diagnostics.record('WARN', 'REMOTE_RENDERER_UNRESPONSIVE', { tab_id: tab.tab_id, url: sanitizeDiagnosticUrl(view.webContents.getURL()) });
    publishSnapshot().catch(() => {});
  });
  view.webContents.on('responsive', () => {
    diagnostics.record('INFO', 'REMOTE_RENDERER_RESPONSIVE', { tab_id: tab.tab_id });
    publishSnapshot().catch(() => {});
  });
  view.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record('ERROR', 'REMOTE_RENDERER_GONE', {
      tab_id: tab.tab_id,
      reason: String(details?.reason || 'unknown').slice(0, 96),
      exit_code: Number.isInteger(details?.exitCode) ? details.exitCode : null,
      url: sanitizeDiagnosticUrl(view.webContents.getURL()),
    });
    publishSnapshot().catch(() => {});
  });
}

async function createTab(input = 'https://chatgpt.com/', { select = true, load = true } = {}) {
  const d = navigationDecision(input);
  if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
  const tab = registry.create({ url: d.normalized_url, kind: d.kind, title: d.kind === 'CHATGPT' ? 'ChatGPT' : '' });
  const view = new WebContentsView({ webPreferences: { ...REMOTE_WEB_PREFERENCES, session: userSession } });
  views.set(tab.tab_id, view);
  wireRemoteView(tab, view);
  if (select) registry.select(tab.tab_id);
  attachSelected();
  diagnostics.record('INFO', 'TAB_CREATED', { tab_id: tab.tab_id, kind: tab.kind, url: sanitizeDiagnosticUrl(d.normalized_url), load });
  if (load) await view.webContents.loadURL(d.normalized_url);
  await publishSnapshot();
  return { ...tab, webcontents_id: view.webContents.id };
}

async function loadTab(tabId, input) {
  const view = views.get(String(tabId));
  if (!view || view.webContents.isDestroyed()) throw new Error('tab_binding_not_live');
  const d = navigationDecision(input);
  if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
  await view.webContents.loadURL(d.normalized_url);
  registry.update(String(tabId), { url: d.normalized_url, kind: d.kind });
  diagnostics.record('INFO', 'TAB_LOAD_REQUESTED', { tab_id: String(tabId), url: sanitizeDiagnosticUrl(d.normalized_url) });
  await publishSnapshot();
  return { ok: true };
}

async function closeTab(tabId) {
  const id = String(tabId);
  const view = views.get(id);
  if (view) {
    try { windowRef?.contentView.removeChildView(view); } catch {}
    views.delete(id);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  registry.close(id);
  await fleet?.onTabClosed(id, 'PHYSICAL_TAB_CLOSED_BY_SHELL');
  diagnostics.record('INFO', 'TAB_CLOSED', { tab_id: id });
  if (!registry.selected()) await createTab('https://chatgpt.com/', { select: true, load: true });
  attachSelected();
  await publishSnapshot();
}

async function initFleet() {
  fleet = new FleetProvisioner({
    createTab: async ({ url, select, load }) => createTab(url, { select, load }),
    loadTab,
    tabExists: (tabId) => views.has(String(tabId)) && !views.get(String(tabId)).webContents.isDestroyed(),
    loadState: loadFleetState,
    saveState: saveFleetState,
    policy: { profile: 'BALANCED', warm_agents: 2, desired_agents: 6, max_agents: 8 },
  });
  await fleet.init();
  await fleet.reconcile({ active: false });
  diagnostics.record('INFO', 'FLEET_INITIALIZED', { profile: fleet.snapshot()?.profile || 'BALANCED' });
}

async function initDevelopmentPlane() {
  if (!developmentPlane) {
    const repoRoot = path.resolve(APP_ROOT, '../..');
    developmentPlane = new DevelopmentPlane({
      spawnWorker: () => utilityProcess.fork(path.join(__dirname, 'development-plane-worker.cjs'), [], {
        cwd: repoRoot,
        env: { METAENGINE_REPO_ROOT: repoRoot },
        stdio: 'inherit',
        serviceName: 'METAENGINE Development Plane',
      }),
    });
  }
  if (developmentPlane.snapshot().state !== 'READY') {
    diagnostics.record('INFO', 'DEVELOPMENT_PLANE_STARTING', {});
    await developmentPlane.start();
    diagnostics.record('INFO', 'DEVELOPMENT_PLANE_READY', { version: developmentPlane.snapshot().version });
  }
  return developmentPlane.snapshot();
}

async function runSelfTest() {
  const checks = [];
  const add = (id, status, detail, critical = true) => checks.push({ id, status, detail, critical });

  add('REMOTE_NODE_INTEGRATION_DISABLED', REMOTE_WEB_PREFERENCES.nodeIntegration === false ? 'PASS' : 'FAIL', REMOTE_WEB_PREFERENCES.nodeIntegration);
  add('REMOTE_CONTEXT_ISOLATION_ENABLED', REMOTE_WEB_PREFERENCES.contextIsolation === true ? 'PASS' : 'FAIL', REMOTE_WEB_PREFERENCES.contextIsolation);
  add('REMOTE_SANDBOX_ENABLED', REMOTE_WEB_PREFERENCES.sandbox === true ? 'PASS' : 'FAIL', REMOTE_WEB_PREFERENCES.sandbox);
  add('COOKIE_TRANSFER_TO_COMPUTE_DISABLED', SECURITY_POLICY.cookie_transfer_to_compute_space === false ? 'PASS' : 'FAIL', SECURITY_POLICY.cookie_transfer_to_compute_space);
  add('USER_SESSION_PERSISTENT', userSession?.isPersistent() === true ? 'PASS' : 'FAIL', userSession?.isPersistent() === true);
  add('SHELL_PROTOCOL_REGISTERED', protocol.isProtocolHandled('metaengine') ? 'PASS' : 'FAIL', protocol.isProtocolHandled('metaengine'));

  try {
    const state = await initDevelopmentPlane();
    const health = await developmentPlane.request('HEALTH');
    const capabilities = await developmentPlane.request('CAPABILITIES');
    const repo = await developmentPlane.request('REPO_HEAD_READ');
    add('DEVELOPMENT_PLANE_READY', state.state === 'READY' && health?.ok === true ? 'PASS' : 'FAIL', { state: state.state, version: state.version });
    add('NO_DIRECT_PROMOTION', capabilities?.direct_promote_current === false ? 'PASS' : 'FAIL', capabilities?.direct_promote_current);
    add('NO_SANDBOX_EXECUTION', capabilities?.verification_sandbox_execution === false && capabilities?.sandbox_backend_bound === false ? 'PASS' : 'FAIL', { execution: capabilities?.verification_sandbox_execution, backend_bound: capabilities?.sandbox_backend_bound });
    add('ADVISORY_VERIFY_NO_DISPATCH', capabilities?.advisory_evidence_verification === true && capabilities?.advisory_evidence_network_dispatch === false ? 'PASS' : 'FAIL', { verify: capabilities?.advisory_evidence_verification, dispatch: capabilities?.advisory_evidence_network_dispatch });
    add('NO_BROWSER_AUTHORITY_FROM_ADVISORY', capabilities?.advisory_evidence_browser_authority === false ? 'PASS' : 'FAIL', capabilities?.advisory_evidence_browser_authority);
    add('NO_PROMOTION_AUTHORITY_FROM_ADVISORY', capabilities?.advisory_evidence_promotion_authority === false ? 'PASS' : 'FAIL', capabilities?.advisory_evidence_promotion_authority);
    add('REPOSITORY_BOUND', repo?.repository_present === true && /^[0-9a-f]{40}$/.test(String(repo?.head || '')) ? 'PASS' : 'WARN', { repository_present: repo?.repository_present === true, head: repo?.head || null, ref: repo?.ref || null }, false);
  } catch (error) {
    add('DEVELOPMENT_PLANE_READY', 'FAIL', safeErrorMessage(error));
  }

  const selected = registry.selected();
  const selectedView = selected ? views.get(selected.tab_id) : null;
  add('SELECTED_TAB_BOUND', selected && selectedView && !selectedView.webContents.isDestroyed() ? 'PASS' : 'FAIL', { tab_id: selected?.tab_id || null, kind: selected?.kind || null });

  const compute = await safeComputeHealth();
  add('COMPUTE_BRIDGE_AVAILABLE', compute?.available === true ? 'PASS' : 'WARN', compute?.available === true ? (compute.result?.runtime || 'available') : (compute?.error || 'offline'), false);

  const criticalFailure = checks.some((check) => check.critical && check.status === 'FAIL');
  const warning = checks.some((check) => check.status === 'WARN');
  lastSelfTest = Object.freeze({
    schema: 'metaengine.browser-test.self-check.v1',
    status: criticalFailure ? 'FAIL' : warning ? 'WARN' : 'PASS',
    ran_at: new Date().toISOString(),
    checks,
    authority_effect: false,
  });
  diagnostics.record(criticalFailure ? 'ERROR' : warning ? 'WARN' : 'INFO', 'SELF_TEST_COMPLETE', {
    status: lastSelfTest.status,
    pass_count: checks.filter((x) => x.status === 'PASS').length,
    warn_count: checks.filter((x) => x.status === 'WARN').length,
    fail_count: checks.filter((x) => x.status === 'FAIL').length,
  });
  await publishSnapshot();
  return lastSelfTest;
}

async function runDevelopmentPlaneSmoke() {
  const state = await initDevelopmentPlane();
  const health = await developmentPlane.request('HEALTH');
  const capabilities = await developmentPlane.request('CAPABILITIES');
  const repo = await developmentPlane.request('REPO_HEAD_READ');
  const preShutdownInvariant = state.state === 'READY'
    && health?.ok === true
    && Array.isArray(capabilities?.capabilities)
    && capabilities.version === state.version
    && capabilities.direct_promote_current === false
    && repo?.repository_present === true;
  const shutdown = await developmentPlane.stopAndWait(4000);
  const invariant = preShutdownInvariant && shutdown?.ok === true && shutdown?.state === 'STOPPED';
  console.log(JSON.stringify({
    schema: 'metaengine.development-plane.smoke.v2',
    ok: invariant,
    state,
    health,
    capabilities,
    repo,
    shutdown,
    authority_effect: false,
  }));
  app.exit(invariant ? 0 : 1);
}

async function handleCommand(command, payload = {}) {
  const selected = registry.selected();
  const selectedView = selected ? views.get(selected.tab_id) : null;
  if (command === 'NEW_CHATGPT') return createTab('https://chatgpt.com/', { select: true, load: true });
  if (command === 'NEW_TAB') return createTab('https://chatgpt.com/', { select: true, load: true });
  if (command === 'SELECT_TAB') { registry.select(payload?.tab_id); attachSelected(); await publishSnapshot(); return { ok: true }; }
  if (command === 'CLOSE_TAB') { await closeTab(payload?.tab_id); return { ok: true }; }
  if (command === 'NAVIGATE') {
    if (!selectedView) throw new Error('no_selected_tab');
    const d = navigationDecision(payload?.url);
    if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
    await selectedView.webContents.loadURL(d.normalized_url);
    registry.update(selected.tab_id, { url: d.normalized_url, kind: d.kind });
    await publishSnapshot();
    return { ok: true };
  }
  if (command === 'BACK') { if (selectedView?.webContents.navigationHistory.canGoBack()) selectedView.webContents.navigationHistory.goBack(); return { ok: true }; }
  if (command === 'FORWARD') { if (selectedView?.webContents.navigationHistory.canGoForward()) selectedView.webContents.navigationHistory.goForward(); return { ok: true }; }
  if (command === 'RELOAD') { selectedView?.webContents.reload(); return { ok: true }; }
  if (command === 'COMPUTE_HEALTH') return bridge.health();
  if (command === 'DEV_PLANE_STATUS') return developmentPlane?.snapshot() || null;
  if (command === 'DEV_PLANE_HEALTH') return developmentPlane?.request('HEALTH');
  if (command === 'DEV_PLANE_CAPABILITIES') return developmentPlane?.request('CAPABILITIES');
  if (command === 'DEV_PLANE_PROCESS_METRICS') return developmentPlane?.request('PROCESS_METRICS');
  if (command === 'DEV_PLANE_REPO_HEAD') return developmentPlane?.request('REPO_HEAD_READ');
  if (command === 'FLEET_STATUS') return fleet?.snapshot() || null;
  if (command === 'FLEET_RECONCILE') { const result = await fleet?.reconcile({ active: payload?.active === true }); await publishSnapshot(); return result; }
  if (command === 'FLEET_SET_PROFILE') { const result = await fleet?.setProfile(payload?.profile); await publishSnapshot(); return result; }
  if (command === 'TEST_RUN_SELF_CHECK') return runSelfTest();
  if (command === 'TEST_TOGGLE_CONSOLE') {
    testConsoleOpen = payload?.open == null ? !testConsoleOpen : payload.open === true;
    layout();
    diagnostics.record('INFO', 'TEST_CONSOLE_TOGGLED', { open: testConsoleOpen });
    await publishSnapshot();
    return { ok: true, open: testConsoleOpen, authority_effect: false };
  }
  if (command === 'TEST_CLEAR_EVENTS') {
    diagnostics.clear();
    await publishSnapshot();
    return { ok: true, authority_effect: false };
  }
  throw new Error('shell_command_unknown');
}

function destroyWindowContents() {
  for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
  views.clear();
  if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.close();
  shellView = null;
  developmentPlane?.stop();
}

async function runSmoke() {
  const smokeWindow = new BaseWindow({ width: 320, height: 240, title: 'METAENGINE Browser Smoke' });
  const remoteView = new WebContentsView({ webPreferences: { ...REMOTE_WEB_PREFERENCES, session: userSession } });
  smokeWindow.contentView.addChildView(remoteView);
  remoteView.setBounds({ x: 0, y: 0, width: 320, height: 240 });
  await remoteView.webContents.loadURL('about:blank');
  const invariant = userSession.isPersistent()
    && remoteView.webContents.session === userSession
    && protocol.isProtocolHandled('metaengine')
    && REMOTE_WEB_PREFERENCES.nodeIntegration === false
    && REMOTE_WEB_PREFERENCES.contextIsolation === true
    && REMOTE_WEB_PREFERENCES.sandbox === true
    && SECURITY_POLICY.cookie_transfer_to_compute_space === false;
  console.log(JSON.stringify({
    schema: 'metaengine.browser-shell.smoke.v2',
    ok: invariant,
    persistent_user_space: userSession.isPersistent(),
    custom_shell_protocol_registered: protocol.isProtocolHandled('metaengine'),
    remote_session_exact: remoteView.webContents.session === userSession,
    remote_node_integration: REMOTE_WEB_PREFERENCES.nodeIntegration,
    remote_context_isolation: REMOTE_WEB_PREFERENCES.contextIsolation,
    remote_sandbox: REMOTE_WEB_PREFERENCES.sandbox,
    compute_bridge_read_only: true,
    authority_effect: false,
  }));
  remoteView.webContents.close();
  smokeWindow.destroy();
  app.exit(invariant ? 0 : 1);
}

async function createWindow() {
  windowRef = new BaseWindow({ width: 1500, height: 980, minWidth: 980, minHeight: 700, title: 'METAENGINE Browser TEST', backgroundColor: '#101216' });
  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  windowRef.contentView.addChildView(shellView);
  windowRef.on('resize', layout);
  windowRef.on('closed', () => { destroyWindowContents(); windowRef = null; });
  shellView.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record('ERROR', 'SHELL_RENDERER_GONE', { reason: String(details?.reason || 'unknown').slice(0, 96), exit_code: Number.isInteger(details?.exitCode) ? details.exitCode : null });
  });
  await shellView.webContents.loadURL('metaengine://shell/');
  diagnostics.record('INFO', 'SHELL_UI_READY', { console_open: testConsoleOpen });
  await createTab('https://chatgpt.com/', { select: true, load: true });
  await initFleet();
  await initDevelopmentPlane().catch((error) => {
    diagnostics.record('ERROR', 'DEVELOPMENT_PLANE_START_FAILED', { error: safeErrorMessage(error) });
    console.error('development-plane-start-failed', error);
  });
  layout();
  await publishSnapshot();
  runSelfTest().catch((error) => {
    diagnostics.record('ERROR', 'INITIAL_SELF_TEST_FAILED', { error: safeErrorMessage(error) });
    publishSnapshot().catch(() => {});
  });
}

ipcMain.handle('metaengine:shell:snapshot', async (event) => { assertShellSender(event); return shellSnapshot(); });
ipcMain.handle('metaengine:shell:command', async (event, message) => {
  assertShellSender(event);
  const command = String(message?.command || '');
  try {
    const result = await handleCommand(command, message?.payload || {});
    if (!command.startsWith('TEST_') && !['DEV_PLANE_STATUS', 'FLEET_STATUS'].includes(command)) {
      diagnostics.record('INFO', 'SHELL_COMMAND_COMPLETE', { command });
      publishSnapshot().catch(() => {});
    }
    return result;
  } catch (error) {
    diagnostics.record('ERROR', 'SHELL_COMMAND_FAILED', { command, error: safeErrorMessage(error) });
    publishSnapshot().catch(() => {});
    throw error;
  }
});

await app.whenReady();
await registerShellProtocol();
configureUserSession();
if (isDevelopmentPlaneSmoke) {
  try {
    await runDevelopmentPlaneSmoke();
  } catch (error) {
    console.error(JSON.stringify({
      schema: 'metaengine.development-plane.smoke.v2',
      ok: false,
      error: String(error?.message || error).slice(0, 240),
      state: developmentPlane?.snapshot() || null,
      authority_effect: false,
    }));
    try { await developmentPlane?.stopAndWait?.(2000); } catch {}
    app.exit(1);
  }
} else if (isSmoke) await runSmoke();
else {
  await createWindow();
  app.on('activate', () => { if (!windowRef) createWindow().catch((error) => { console.error(error); app.exit(1); }); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
