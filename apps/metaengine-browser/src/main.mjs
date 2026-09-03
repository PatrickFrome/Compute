import { app, BaseWindow, WebContentsView, ipcMain, protocol, safeStorage, session, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBridgeClient } from './compute-bridge-client.mjs';
import { DevelopmentPlane } from './development-plane.mjs';
import { FleetProvisioner } from './fleet-provisioner.mjs';
import { createFleetTargetLocalObserver } from './fleet-target-local-observer.mjs';
import { retireEligibleFleetAgents } from './fleet-elastic-governor.mjs';
import { OwnerSafetyGateRegistry, bindGlobalOwnerSafetyGateRegistry } from './owner-safety-gate-registry.mjs';
import { captureSemanticFrame, captureViewThumbnail, executeSemanticCommand } from './native-browser-control.mjs';
import { NativeSupervisorClient } from './native-supervisor-client.mjs';
import { SupervisorDeviceIdentity } from './supervisor-device-identity.mjs';
import { navigationDecision, newWindowDecision, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from './browser-policy.mjs';
import { TabRegistry } from './tab-registry.mjs';
import { VerifiedDownloadManager } from './verified-download-manager.mjs';
import { normalizeShellLayoutState, planShellLayout, SHELL_TOP_HEIGHT } from './shell-layout.mjs';
import { projectWorkspaceWorkbench } from './workspace-workbench-projection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const TOOLBAR_HEIGHT = SHELL_TOP_HEIGHT;
const PERCEPTION_CACHE_MS = 4000;
const STARTUP_RETRY_BASE_MS = 1000;
const STARTUP_RETRY_MAX_MS = 30000;
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
let ownerSafetyGates = null;
let developmentPlane = null;
let nativeSupervisor = null;
let shellLayoutState = normalizeShellLayoutState();
let shellLayoutPlan = null;
let perceptionCache = { tab_id: null, captured_ms: 0, frame: null, error: null };
let shutdownRequested = false;
let shellProtocolHandlerReady = false;
let userSessionConfigured = false;
let startupRetryTimer = null;
let startupRetryAttempt = 0;
let startupInFlight = false;
let browserRuntimeReady = false;

function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function registerShellProtocol() {
  if (shellProtocolHandlerReady || protocol.isProtocolHandled('metaengine')) {
    shellProtocolHandlerReady = true;
    return;
  }
  await protocol.handle('metaengine', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'shell') return new Response('not found', { status: 404 });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    if (!['index.html', 'app.js', 'app.css'].includes(rel)) return new Response('not found', { status: 404 });
    const body = await fs.readFile(path.join(UI_ROOT, rel));
    return new Response(body, { status: 200, headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' } });
  });
  shellProtocolHandlerReady = true;
}

function configureUserSession() {
  if (userSessionConfigured && userSession) return;
  userSession = session.fromPartition(SECURITY_POLICY.user_space_partition, { cache: true });
  userSession.setPermissionCheckHandler(() => false);
  userSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  downloads = new VerifiedDownloadManager({
    session: userSession,
    rootPath: path.join(app.getPath('downloads'), 'METAENGINE'),
  });
  userSessionConfigured = true;
}

function fleetStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v1.json');
}

function ownerSafetyGateStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-owner-safety-gates-v1.json');
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

async function loadOwnerSafetyGateState() {
  try {
    return JSON.parse(await fs.readFile(ownerSafetyGateStatePath(), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveOwnerSafetyGateState(state) {
  const target = ownerSafetyGateStatePath();
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
}

function assertShellSender(event) {
  if (!shellView || event.sender.id !== shellView.webContents.id) throw new Error('shell_sender_not_trusted');
}

async function shellSnapshot() {
  const tabs = registry.snapshot();
  const fleetSnapshot = fleet?.snapshot() || null;
  const supervisor = nativeSupervisor?.snapshot() || null;
  const workspaces = projectWorkspaceWorkbench({ tabs, fleet: fleetSnapshot, supervisor });
  return {
    schema: 'metaengine.browser-shell.snapshot.v3',
    version: app.getVersion(),
    tabs,
    downloads: downloads?.snapshot() || null,
    fleet: fleetSnapshot,
    owner_safety_gates: ownerSafetyGates?.snapshot() || null,
    development_plane: developmentPlane?.snapshot() || null,
    supervisor,
    workspaces,
    compute: await bridge.health(),
    layout: shellLayoutPlan ? structuredClone(shellLayoutPlan) : null,
    background_service: {
      close_to_background: !shutdownRequested,
      shutdown_requested: shutdownRequested,
      terminal_requires_external_stop: true,
      startup_retry_pending: startupRetryTimer != null,
      startup_retry_attempt: startupRetryAttempt,
      browser_runtime_ready: browserRuntimeReady,
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

function layout() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const { width, height } = windowRef.getContentBounds();
  shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });
  shellView?.setBounds(shellLayoutPlan.shell_bounds);
  const selected = registry.selected();
  for (const [tabId, view] of views) {
    if (tabId === selected?.tab_id) view.setBounds(shellLayoutPlan.remote_bounds);
  }
}

function attachSelected() {
  if (!windowRef) return;
  if (shellView) {
    try { windowRef.contentView.addChildView(shellView); } catch {}
  }
  const selected = registry.selected();
  for (const [tabId, view] of views) {
    if (tabId === selected?.tab_id) {
      try { windowRef.contentView.addChildView(view); } catch {}
    } else {
      try { windowRef.contentView.removeChildView(view); } catch {}
    }
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

async function createTab(input = 'https://chatgpt.com/', { select = true, load = true, role = 'USER' } = {}) {
  const d = navigationDecision(input);
  if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
  // role tags physical ownership at creation: 'FLEET' tabs are provisioned
  // exclusively by the fleet provisioner and draw from their own 16-slot
  // ceiling; 'USER' tabs keep the full 32-slot wall with a guaranteed 16-slot
  // reservation the fleet can never invade.
  const tab = registry.create({ url: d.normalized_url, kind: d.kind, role, title: d.kind === 'CHATGPT' ? 'ChatGPT' : '' });
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

// Elastic fleet scale-down execution. The governor only proposes claim-ineligible
// surplus agents (PROVISIONING / BOUND_UNVERIFIED — they can never hold a lease);
// this boundary re-validates that at execution time, retires the logical agent
// first, then closes its physical tab through the normal shell path (which
// surfaces capacity backpressure release and snapshot publication). Bounded to
// four agents per call. ACTIVE and PROVISIONING_AMBIGUOUS agents are never
// auto-retired: ACTIVE agents may hold server-side leases, ambiguous agents are
// fenced no-retry evidence.
async function retireFleetSurplus(retireAgentIds) {
  if (!Array.isArray(retireAgentIds) || retireAgentIds.length === 0 || !fleet) return [];
  const ids = retireAgentIds
    .map((value) => String(value || '').toLowerCase())
    .filter((value) => /^agent_[a-z0-9-]{8,64}$/.test(value))
    .slice(0, 4);
  const retired = [];
  for (const agentId of ids) {
    const snapshot = fleet.snapshot();
    const agent = (snapshot?.agents || []).find((row) => String(row.agent_id || '') === agentId);
    if (!agent) continue; // already gone — idempotent no-op
    if (!['PROVISIONING', 'BOUND_UNVERIFIED'].includes(String(agent.lifecycle_state || ''))) continue;
    const tabId = agent.tab_id ? String(agent.tab_id) : null;
    await fleet.retire(agentId);
    if (tabId) {
      try { await closeTab(tabId); } catch { /* tab already closed — retire is still recorded */ }
    }
    retired.push(Object.freeze({ agent_id: agentId, tab_id: tabId, lifecycle_state: 'RETIRED', automatic_retry_allowed: false, authority_effect: false }));
  }
  return retired;
}

// Bounded orphan sweep (W3): a FLEET-role tab with no live binding in the
// provisioner's TRUE snapshot is physical capacity held by nobody (crash
// between createTab and persist, a retired agent whose close failed, or a
// pre-reconcile create that never bound). Closing it through the normal shell
// path releases capacity backpressure evidence and publishes the snapshot.
// USER tabs are never touched. Ambiguous agents still holding a tab binding
// are never swept (fenced no-retry evidence invariant).
async function sweepOrphanFleetTabs() {
  if (!fleet) return [];
  const boundTabIds = new Set((fleet.snapshot()?.agents || [])
    .map((row) => (row?.tab_id ? String(row.tab_id) : null))
    .filter(Boolean));
  const census = registry.census();
  const orphanIds = census.fleet_tab_ids.filter((tabId) => !boundTabIds.has(tabId)).slice(0, 4);
  const swept = [];
  for (const tabId of orphanIds) {
    try {
      await closeTab(tabId);
      swept.push(Object.freeze({ tab_id: tabId, swept: 'ORPHAN_FLEET_TAB_CLOSED', authority_effect: false }));
    } catch {
      // bounded best-effort: a failed close is retried by a later sweep cycle
    }
  }
  return swept;
}

async function initOwnerSafetyGates() {
  if (ownerSafetyGates) return ownerSafetyGates.snapshot();
  ownerSafetyGates = new OwnerSafetyGateRegistry({
    loadState: loadOwnerSafetyGateState,
    saveState: saveOwnerSafetyGateState,
  });
  await ownerSafetyGates.init();
  bindGlobalOwnerSafetyGateRegistry(ownerSafetyGates);
  return ownerSafetyGates.snapshot();
}

async function initFleet() {
  fleet = new FleetProvisioner({
    createTab: async ({ url, select, load, ownership }) => createTab(url, {
      select,
      load,
      role: ownership === 'FLEET_OWNED' ? 'FLEET' : 'USER',
    }),
    loadTab,
    tabExists: (tabId) => views.has(String(tabId)) && !views.get(String(tabId)).webContents.isDestroyed(),
    loadState: loadFleetState,
    saveState: saveFleetState,
    // Read-only capacity census (W3): grounds backpressure in the TRUE physical
    // tab state so provisioning halts before a doomed createTab attempt and
    // restarts (which miss tab-close events) re-learn capacity without probing
    // by side effect.
    census: () => registry.census(),
    policy: { profile: 'BALANCED', warm_agents: 2, desired_agents: 6 },
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
  if (command === 'SHELL_LAYOUT_SET') {
    shellLayoutState = normalizeShellLayoutState(payload);
    layout();
    await publishSnapshot();
    return shellLayoutPlan ? structuredClone(shellLayoutPlan) : null;
  }
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
  if (command === 'FLEET_RECONCILE') {
    const result = await fleet?.reconcile({
      active: payload?.active === true,
      target_agents: payload?.target_agents ?? null,
      spawn_burst_limit: payload?.spawn_burst_limit ?? null,
    });
    const retired = await retireFleetSurplus(payload?.retire_agent_ids);
    const sweptOrphans = await sweepOrphanFleetTabs();
    if (retired.length || sweptOrphans.length) await publishSnapshot();
    return retired.length || sweptOrphans.length
      ? { ...result, elastic_retired: retired, orphan_fleet_tabs_swept: sweptOrphans, authority_effect: false }
      : result;
  }
  if (command === 'FLEET_SET_PROFILE') { const result = await fleet?.setProfile(payload?.profile); await publishSnapshot(); return result; }
  // Read-only capacity census probe (W3): pure registry projection, never
  // creates a tab, never retries provisioning. Consumed by the DevOS cycle
  // and by any trusted operator surface that needs TRUE physical capacity.
  if (command === 'TAB_CENSUS') {
    return {
      ...registry.census(),
      fleet_backpressure: fleet?.snapshot()?.capacity_backpressure || null,
      authority_effect: false,
    };
  }
  if (command === 'GATE_STATUS') return ownerSafetyGates?.snapshot() || null;
  if (command === 'GATE_DISABLE') { const result = await ownerSafetyGates?.disable(payload); await publishSnapshot(); return result; }
  if (command === 'GATE_DISABLE_ALL') { const result = await ownerSafetyGates?.disable({ ...payload, gate_id: '*' }); await publishSnapshot(); return result; }
  if (command === 'GATE_ENABLE') { const result = await ownerSafetyGates?.enable(payload); await publishSnapshot(); return result; }
  if (command === 'GATE_ENABLE_ALL') { const result = await ownerSafetyGates?.enableAll(payload); await publishSnapshot(); return result; }
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
    // Read-only capacity census (W3): grounds the DevOS cycle's elastic plan
    // and every backpressure decision in the TRUE physical tab occupancy.
    tab_census: snap.census,
    active_tab: selected,
    downloads: downloads?.snapshot() || null,
    development_plane: developmentPlane?.snapshot() || null,
    fleet: fleet?.snapshot() || null,
    owner_safety_gates: ownerSafetyGates?.snapshot() || null,
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
  if (['NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD','TAB_CENSUS','DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL','FLEET_RECONCILE','FLEET_SET_PROFILE','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD','GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'].includes(action)) {
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
  if (!nativeSupervisor) {
    const identity = new SupervisorDeviceIdentity({ statePath: supervisorIdentityPath(), secureStorage: safeStorage });
    const observeLocalTarget = createFleetTargetLocalObserver({
      lookupView: (tabId) => views.get(String(tabId)) || null,
    });
    nativeSupervisor = new NativeSupervisorClient({
      identity,
      version: app.getVersion(),
      intervalMs: 2000,
      getState: nativeSupervisorState,
      executeCommand: executeNativeSupervisorCommand,
      observeLocalTarget,
      workerObservationBudget: 4,
    });
  }
  if (nativeSupervisor.snapshot()?.running !== true) await nativeSupervisor.start();
  await publishSnapshot().catch(() => {});
  return nativeSupervisor.snapshot();
}

function destroyWindowContents() {
  nativeSupervisor?.stop();
  downloads?.close?.().catch(() => {});
  downloads = null;
  userSessionConfigured = false;
  for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
  views.clear();
  if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.close();
  shellView = null;
  fleet = null;
  developmentPlane?.stop();
}

async function runSmoke() {
  const smokeWindow = new BaseWindow({ width: 320, height: 240, title: 'METAENGINE Browser Smoke' });
  const remoteView = new WebContentsView({ webPreferences: { ...REMOTE_WEB_PREFERENCES, session: userSession } });
  smokeWindow.contentView.addChildView(remoteView);
  remoteView.setBounds({ x: 0, y: 0, width: 320, height: 240 });
  await remoteView.webContents.loadURL('about:blank');
  const smokeLayout = planShellLayout({ width: 900, height: 640, state: normalizeShellLayoutState() });
  const invariant = userSession.isPersistent()
    && remoteView.webContents.session === userSession
    && protocol.isProtocolHandled('metaengine')
    && REMOTE_WEB_PREFERENCES.nodeIntegration === false
    && REMOTE_WEB_PREFERENCES.contextIsolation === true
    && REMOTE_WEB_PREFERENCES.sandbox === true
    && SECURITY_POLICY.cookie_transfer_to_compute_space === false
    && downloads?.snapshot()?.arbitrary_execution === false
    && smokeLayout.overlay_remote_content === false
    && smokeLayout.renderer_dimensions_authoritative === false
    && smokeLayout.remote_bounds.y === TOOLBAR_HEIGHT;
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
    workbench_overlay_remote_content: smokeLayout.overlay_remote_content,
    renderer_dimensions_authoritative: smokeLayout.renderer_dimensions_authoritative,
    authority_effect: false,
  }));
  remoteView.webContents.close();
  smokeWindow.destroy();
  app.exit(invariant ? 0 : 1);
}

function scheduleBrowserRuntimeRetry(error) {
  if (shutdownRequested || isSmoke || isDevelopmentPlaneSmoke || startupRetryTimer) return;
  startupRetryAttempt += 1;
  const delay = Math.min(STARTUP_RETRY_MAX_MS, STARTUP_RETRY_BASE_MS * (2 ** Math.min(8, startupRetryAttempt - 1)));
  console.error(JSON.stringify({
    schema: 'metaengine.browser-startup-recovery.v1',
    state: 'RETRY_PENDING',
    attempt: startupRetryAttempt,
    delay_ms: delay,
    error: String(error?.message || error).slice(0, 240),
    terminal: false,
    external_stop_required_for_terminal: true,
    authority_effect: false,
  }));
  startupRetryTimer = setTimeout(() => {
    startupRetryTimer = null;
    void startBrowserRuntime();
  }, delay);
  startupRetryTimer.unref?.();
}

function resetFailedWindow() {
  const current = windowRef;
  if (current && !current.isDestroyed()) {
    try { current.destroy(); } catch {}
  } else {
    destroyWindowContents();
    windowRef = null;
  }
}

async function createWindow() {
  if (windowRef && !windowRef.isDestroyed()) return;
  windowRef = new BaseWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 640, title: 'METAENGINE Browser', backgroundColor: '#101216' });
  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  windowRef.contentView.addChildView(shellView);
  windowRef.on('resize', layout);
  windowRef.on('close', (event) => {
    if (shutdownRequested || isSmoke || isDevelopmentPlaneSmoke) return;
    event.preventDefault();
    windowRef.hide();
  });
  windowRef.on('closed', () => {
    const recover = !shutdownRequested && !isSmoke && !isDevelopmentPlaneSmoke;
    destroyWindowContents();
    windowRef = null;
    browserRuntimeReady = false;
    if (recover) scheduleBrowserRuntimeRetry(new Error('browser_window_closed_unexpectedly'));
  });
  layout();
  await shellView.webContents.loadURL('metaengine://shell/');
  await initOwnerSafetyGates();
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

async function startAfterHostResilience() {
  const barrier = globalThis.__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__;
  if (barrier && typeof barrier.then === 'function') await barrier;
  return startAfterReady();
}

async function startBrowserRuntime() {
  if (shutdownRequested || startupInFlight || browserRuntimeReady) return;
  startupInFlight = true;
  try {
    await startAfterHostResilience();
    browserRuntimeReady = true;
    startupRetryAttempt = 0;
  } catch (error) {
    console.error('browser-start-failed', error);
    resetFailedWindow();
    if (isSmoke || isDevelopmentPlaneSmoke) app.exit(1);
    else scheduleBrowserRuntimeRetry(error);
  } finally {
    startupInFlight = false;
  }
}

app.on('before-quit', () => {
  shutdownRequested = true;
  if (startupRetryTimer) clearTimeout(startupRetryTimer);
  startupRetryTimer = null;
});
app.on('activate', () => {
  if (!app.isReady()) return;
  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.show();
    return;
  }
  browserRuntimeReady = false;
  void startBrowserRuntime();
});
app.on('window-all-closed', () => {});
if (app.isReady()) queueMicrotask(() => { void startBrowserRuntime(); });
else app.once('ready', () => { void startBrowserRuntime(); });
