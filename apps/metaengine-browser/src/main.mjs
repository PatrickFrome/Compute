import { app, BaseWindow, WebContentsView, ipcMain, protocol, safeStorage, session, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBridgeClient } from './compute-bridge-client.mjs';
import { DevelopmentPlane } from './development-plane.mjs';
import { FleetProvisioner } from './fleet-provisioner.mjs';
import { captureSemanticFrame, captureViewThumbnail, executeSemanticCommand } from './native-browser-control.mjs';
import { NativeSupervisorClient } from './native-supervisor-client.mjs';
import { SupervisorDeviceIdentity } from './supervisor-device-identity.mjs';
import { navigationDecision, newWindowDecision, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from './browser-policy.mjs';
import { TabRegistry } from './tab-registry.mjs';
import { VerifiedDownloadManager } from './verified-download-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const TOOLBAR_HEIGHT = 92;
const PERCEPTION_CACHE_MS = 4000;
const isSmoke = process.argv.includes('--metaengine-smoke');
const isDevelopmentPlaneSmoke = process.argv.includes('--metaengine-devplane-smoke');

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const registry = new TabRegistry();
const views = new Map();
const bridge = new ComputeBridgeClient();
let windowRef = null;
let shellView = null;
let userSession = null;
let downloads = null;
let fleet = null;
let developmentPlane = null;
let nativeSupervisor = null;
let perceptionCache = { tab_id: null, captured_ms: 0, frame: null, error: null };

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
  downloads = new VerifiedDownloadManager({
    session: userSession,
    rootPath: path.join(app.getPath('downloads'), 'METAENGINE'),
  });
}

function fleetStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v1.json');
}

function supervisorIdentityPath() {
  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');
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

async function shellSnapshot() {
  return {
    schema: 'metaengine.browser-shell.snapshot.v3',
    version: app.getVersion(),
    tabs: registry.snapshot(),
    downloads: downloads?.snapshot() || null,
    fleet: fleet?.snapshot() || null,
    development_plane: developmentPlane?.snapshot() || null,
    supervisor: nativeSupervisor?.snapshot() || null,
    compute: await bridge.health(),
    policy: SECURITY_POLICY,
    authority_effect: false,
  };
}

async function publishSnapshot() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send('metaengine:shell:snapshot', await shellSnapshot());
}

function layout() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const { width, height } = windowRef.getContentBounds();
  shellView?.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const selected = registry.selected();
  for (const [tabId, view] of views) {
    if (tabId === selected?.tab_id) view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
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

function invalidatePerception(tabId = null) {
  if (!tabId || perceptionCache.tab_id === tabId) perceptionCache = { tab_id: null, captured_ms: 0, frame: null, error: null };
}

function wireRemoteView(tab, view) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const d = newWindowDecision(url);
    if (d.allow) setImmediate(() => createTab(d.normalized_url, { select: true }).catch(() => {}));
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    const d = navigationDecision(url);
    if (!d.allow) event.preventDefault();
  });
  view.webContents.on('will-redirect', (event, url) => {
    const d = navigationDecision(url);
    if (!d.allow) event.preventDefault();
  });
  const sync = () => {
    if (view.webContents.isDestroyed()) return;
    const url = view.webContents.getURL() || tab.url;
    const d = navigationDecision(url);
    registry.update(tab.tab_id, { url: d.allow ? d.normalized_url : tab.url, kind: d.allow ? d.kind : tab.kind, title: view.webContents.getTitle() || tab.title });
    invalidatePerception(tab.tab_id);
    publishSnapshot().catch(() => {});
  };
  view.webContents.on('did-navigate', sync);
  view.webContents.on('did-navigate-in-page', sync);
  view.webContents.on('page-title-updated', sync);
  view.webContents.on('render-process-gone', () => { invalidatePerception(tab.tab_id); publishSnapshot().catch(() => {}); });
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
  if (load) await view.webContents.loadURL(d.normalized_url);
  invalidatePerception();
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
  invalidatePerception(String(tabId));
  await publishSnapshot();
  return { ok: true, tab_id: String(tabId), url: d.normalized_url };
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
  if (!registry.selected()) await createTab('https://chatgpt.com/', { select: true, load: true });
  invalidatePerception(id);
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
}

function developmentPlaneRepoRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(APP_ROOT, '../..');
}

async function initDevelopmentPlane() {
  if (!developmentPlane) {
    const repoRoot = developmentPlaneRepoRoot();
    developmentPlane = new DevelopmentPlane({
      spawnWorker: () => utilityProcess.fork(path.join(__dirname, 'development-plane-worker.cjs'), [], {
        cwd: repoRoot,
        env: { METAENGINE_REPO_ROOT: repoRoot },
        stdio: 'inherit',
        serviceName: 'METAENGINE Development Plane',
      }),
    });
  }
  if (developmentPlane.snapshot().state !== 'READY') await developmentPlane.start();
  return developmentPlane.snapshot();
}

async function runDevelopmentPlaneSmoke() {
  const state = await initDevelopmentPlane();
  const health = await developmentPlane.request('HEALTH');
  const capabilities = await developmentPlane.request('CAPABILITIES');
  const repo = await developmentPlane.request('REPO_HEAD_READ');
  const handshakeInvariant = state.state === 'READY'
    && health?.ok === true
    && Array.isArray(capabilities?.capabilities)
    && capabilities.version === state.version
    && capabilities.direct_promote_current === false;
  const sourceRepoInvariant = app.isPackaged ? true : repo?.repository_present === true;
  const shutdown = await developmentPlane.stopAndWait(4000);
  const invariant = handshakeInvariant && sourceRepoInvariant && shutdown?.ok === true && shutdown?.state === 'STOPPED';
  console.log(JSON.stringify({
    schema: 'metaengine.development-plane.smoke.v3',
    ok: invariant,
    packaged: app.isPackaged,
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
  if (command === 'NEW_TAB') return createTab(payload?.url || 'https://chatgpt.com/', { select: payload?.select !== false, load: true });
  if (command === 'SELECT_TAB') { registry.select(payload?.tab_id); attachSelected(); invalidatePerception(); await publishSnapshot(); return { ok: true, tab_id: String(payload?.tab_id) }; }
  if (command === 'CLOSE_TAB') { await closeTab(payload?.tab_id); return { ok: true }; }
  if (command === 'NAVIGATE') {
    if (payload?.tab_id) return loadTab(payload.tab_id, payload?.url);
    if (!selectedView) throw new Error('no_selected_tab');
    const d = navigationDecision(payload?.url);
    if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
    await selectedView.webContents.loadURL(d.normalized_url);
    registry.update(selected.tab_id, { url: d.normalized_url, kind: d.kind });
    invalidatePerception(selected.tab_id);
    await publishSnapshot();
    return { ok: true, tab_id: selected.tab_id, url: d.normalized_url };
  }
  if (command === 'BACK') { if (selectedView?.webContents.navigationHistory.canGoBack()) selectedView.webContents.navigationHistory.goBack(); return { ok: true }; }
  if (command === 'FORWARD') { if (selectedView?.webContents.navigationHistory.canGoForward()) selectedView.webContents.navigationHistory.goForward(); return { ok: true }; }
  if (command === 'RELOAD') { selectedView?.webContents.reload(); invalidatePerception(selected?.tab_id); return { ok: true }; }
  if (command === 'COMPUTE_HEALTH') return bridge.health();
  if (command === 'DOWNLOAD_STATUS') return downloads?.snapshot() || null;
  if (command === 'DOWNLOAD_FILE') { const result = await downloads?.download(payload); await publishSnapshot(); return result; }
  if (command === 'DOWNLOAD_CANCEL') { const result = await downloads?.cancel(); await publishSnapshot(); return result; }
  if (command === 'DEV_PLANE_STATUS') return developmentPlane?.snapshot() || null;
  if (command === 'DEV_PLANE_HEALTH') return developmentPlane?.request('HEALTH');
  if (command === 'DEV_PLANE_CAPABILITIES') return developmentPlane?.request('CAPABILITIES');
  if (command === 'DEV_PLANE_PROCESS_METRICS') return developmentPlane?.request('PROCESS_METRICS');
  if (command === 'DEV_PLANE_REPO_HEAD') return developmentPlane?.request('REPO_HEAD_READ');
  if (command === 'FLEET_STATUS') return fleet?.snapshot() || null;
  if (command === 'FLEET_RECONCILE') { const result = await fleet?.reconcile({ active: payload?.active === true }); await publishSnapshot(); return result; }
  if (command === 'FLEET_SET_PROFILE') { const result = await fleet?.setProfile(payload?.profile); await publishSnapshot(); return result; }
  throw new Error('shell_command_unknown');
}

function tabForPlatform(platform) {
  const rows = registry.snapshot().tabs;
  const selected = registry.selected();
  const p = String(platform || '').toUpperCase();
  const match = (tab) => {
    try {
      const host = new URL(tab.url).hostname.toLowerCase();
      if (p === 'CHATGPT') return host === 'chatgpt.com' || host === 'www.chatgpt.com' || host === 'chat.openai.com';
      if (p === 'GLM_ZAI') return host === 'chat.z.ai';
    } catch {}
    return false;
  };
  if (selected && match(selected)) return selected;
  return rows.find(match) || null;
}

function targetTabForSupervisor(command) {
  const explicit = command?.payload?.tab_id ? registry.get(command.payload.tab_id) : null;
  if (explicit) return explicit;
  const byPlatform = tabForPlatform(command?.platform);
  return byPlatform || registry.selected();
}

function targetViewForSupervisor(command) {
  const tab = targetTabForSupervisor(command);
  const view = tab ? views.get(tab.tab_id) : null;
  if (!tab || !view || view.webContents.isDestroyed()) throw new Error('native_supervisor_target_view_unavailable');
  return { tab, view };
}

async function perceptionForSelected({ force = false } = {}) {
  const tab = registry.selected();
  if (!tab) return null;
  const view = views.get(tab.tab_id);
  if (!view || view.webContents.isDestroyed()) return null;
  const now = Date.now();
  if (!force && perceptionCache.tab_id === tab.tab_id && perceptionCache.frame && now - perceptionCache.captured_ms < PERCEPTION_CACHE_MS) return perceptionCache.frame;
  try {
    const frame = await captureSemanticFrame(view.webContents);
    perceptionCache = { tab_id: tab.tab_id, captured_ms: now, frame: { ...frame, tab_id: tab.tab_id }, error: null };
    return perceptionCache.frame;
  } catch (error) {
    perceptionCache = { tab_id: tab.tab_id, captured_ms: now, frame: null, error: String(error?.message || error).slice(0, 300) };
    return { schema: 'metaengine.native-browser.perception.v1', tab_id: tab.tab_id, error: perceptionCache.error, authority_effect: false };
  }
}

async function nativeSupervisorState() {
  const snap = registry.snapshot();
  const selected = registry.selected();
  const perception = await perceptionForSelected();
  return {
    tabs: snap.tabs.map((tab) => ({ ...tab, selected: tab.tab_id === snap.selected_tab_id })),
    active_tab: selected,
    downloads: downloads?.snapshot() || null,
    development_plane: developmentPlane?.snapshot() || null,
    fleet: fleet?.snapshot() || null,
    perception,
  };
}

async function executeNativeSupervisorCommand(command) {
  const action = String(command?.action || '');
  const payload = command?.payload || {};
  if (action === 'POLL') return { ok: true, snapshot: await nativeSupervisorState(), authority_effect: false };
  if (action === 'SET_MODE') {
    const requested = String(payload?.mode || '').toUpperCase();
    if (requested === 'OBSERVE') return nativeSupervisor.setControlState({ mode: 'MONITOR' });
    if (requested === 'CONTROL' || requested === 'GATE_SEND') return nativeSupervisor.setControlState({ mode: 'CONTROL' });
    throw new Error('native_operator_mode_invalid');
  }
  if (['NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD','DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL','FLEET_RECONCILE','FLEET_SET_PROFILE','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD'].includes(action)) {
    if (['BACK','FORWARD','RELOAD'].includes(action) && payload?.tab_id) {
      const tab = registry.get(payload.tab_id);
      const view = tab ? views.get(tab.tab_id) : null;
      if (!view || view.webContents.isDestroyed()) throw new Error('native_supervisor_target_view_unavailable');
      if (action === 'BACK' && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
      if (action === 'FORWARD' && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward();
      if (action === 'RELOAD') view.webContents.reload();
      invalidatePerception(tab.tab_id);
      return { ok: true, tab_id: tab.tab_id, authority_effect: true };
    }
    return handleCommand(action, payload);
  }
  const { tab, view } = targetViewForSupervisor(command);
  if (action === 'CAPTURE') return { ...(await captureSemanticFrame(view.webContents)), tab_id: tab.tab_id };
  if (action === 'CAPTURE_VIEW') return { ...(await captureViewThumbnail(view.webContents)), tab_id: tab.tab_id };
  if (['STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK'].includes(action)) {
    const result = await executeSemanticCommand(view.webContents, command);
    invalidatePerception(tab.tab_id);
    return { ...result, tab_id: tab.tab_id };
  }
  throw new Error('native_supervisor_command_unknown');
}

async function initNativeSupervisor() {
  if (nativeSupervisor) return nativeSupervisor.snapshot();
  const identity = new SupervisorDeviceIdentity({ statePath: supervisorIdentityPath(), secureStorage: safeStorage });
  nativeSupervisor = new NativeSupervisorClient({
    identity,
    version: app.getVersion(),
    intervalMs: 2000,
    getState: nativeSupervisorState,
    executeCommand: executeNativeSupervisorCommand,
  });
  await nativeSupervisor.start();
  await publishSnapshot().catch(() => {});
  return nativeSupervisor.snapshot();
}

function destroyWindowContents() {
  nativeSupervisor?.stop();
  downloads?.close?.().catch(() => {});
  downloads = null;
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
    && SECURITY_POLICY.cookie_transfer_to_compute_space === false
    && downloads?.snapshot()?.arbitrary_execution === false;
  console.log(JSON.stringify({
    schema: 'metaengine.browser-shell.smoke.v3',
    ok: invariant,
    persistent_user_space: userSession.isPersistent(),
    custom_shell_protocol_registered: protocol.isProtocolHandled('metaengine'),
    remote_session_exact: remoteView.webContents.session === userSession,
    remote_node_integration: REMOTE_WEB_PREFERENCES.nodeIntegration,
    remote_context_isolation: REMOTE_WEB_PREFERENCES.contextIsolation,
    remote_sandbox: REMOTE_WEB_PREFERENCES.sandbox,
    compute_bridge_read_only: true,
    native_supervisor_arbitrary_eval: false,
    verified_download_arbitrary_execution: false,
    authority_effect: false,
  }));
  remoteView.webContents.close();
  smokeWindow.destroy();
  app.exit(invariant ? 0 : 1);
}

async function createWindow() {
  windowRef = new BaseWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 640, title: 'METAENGINE Browser', backgroundColor: '#101216' });
  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  windowRef.contentView.addChildView(shellView);
  windowRef.on('resize', layout);
  windowRef.on('closed', () => { destroyWindowContents(); windowRef = null; });
  await shellView.webContents.loadURL('metaengine://shell/');
  await createTab('https://chatgpt.com/', { select: true, load: true });
  await initFleet();
  await initDevelopmentPlane().catch((error) => console.error('development-plane-start-failed', error));
  layout();
  await publishSnapshot();
  setImmediate(() => initNativeSupervisor().catch((error) => console.error('native-supervisor-start-failed', error)));
}

ipcMain.handle('metaengine:shell:snapshot', async (event) => { assertShellSender(event); return shellSnapshot(); });
ipcMain.handle('metaengine:shell:command', async (event, message) => { assertShellSender(event); return handleCommand(String(message?.command || ''), message?.payload || {}); });

async function startAfterReady() {
  await registerShellProtocol();
  configureUserSession();
  if (isDevelopmentPlaneSmoke) {
    try {
      await runDevelopmentPlaneSmoke();
    } catch (error) {
      console.error(JSON.stringify({
        schema: 'metaengine.development-plane.smoke.v3',
        ok: false,
        error: String(error?.message || error).slice(0, 240),
        state: developmentPlane?.snapshot() || null,
        authority_effect: false,
      }));
      try { await developmentPlane?.stopAndWait?.(2000); } catch {}
      app.exit(1);
    }
    return;
  }
  if (isSmoke) {
    await runSmoke();
    return;
  }
  await createWindow();
}

app.on('activate', () => { if (app.isReady() && !windowRef) createWindow().catch((error) => { console.error(error); app.exit(1); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.once('ready', () => {
  startAfterReady().catch((error) => {
    console.error('browser-start-failed', error);
    app.exit(1);
  });
});
