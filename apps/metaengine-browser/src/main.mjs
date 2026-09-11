import { app, BaseWindow, MessageChannelMain, WebContentsView, ipcMain, nativeTheme, protocol, safeStorage, session, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBridgeClient } from './compute-bridge-client.mjs';
import { DevelopmentPlane } from './development-plane.mjs';
import { loadNativeSupervisorControlState } from './native-supervisor-control-state.mjs';
import { ensureRuntimeGenesis } from './runtime-genesis.mjs';
import { FleetProvisioner } from './fleet-provisioner.mjs';
import { createFleetTargetLocalObserver } from './fleet-target-local-observer.mjs';
import { retireEligibleFleetAgents } from './fleet-elastic-governor.mjs';
import { HumanTakeoverController } from './human-takeover.mjs';
import { OwnerSafetyGateRegistry, bindGlobalOwnerSafetyGateRegistry } from './owner-safety-gate-registry.mjs';
import { captureSemanticFrame, captureViewThumbnail, executeSemanticCommand } from './native-browser-control.mjs';
import { NativeSupervisorClient } from './native-supervisor-client.mjs';
import { boundedNavigation } from './bounded-navigation.mjs';
import { SupervisorDeviceIdentity } from './supervisor-device-identity.mjs';
import { navigationDecision, newWindowDecision, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from './browser-policy.mjs';
import { TabRegistry } from './tab-registry.mjs';
import { ExactBrowserTabViewMap } from './browser-webcontents-tab-index.mjs';
import {
  assertExactNativeSupervisorMutationTargetCurrent,
  resolveExactNativeSupervisorMutationTarget,
} from './native-supervisor-exact-target.mjs';
import { VerifiedDownloadManager } from './verified-download-manager.mjs';
import { normalizeShellLayoutState, planShellLayout, SHELL_TOP_HEIGHT } from './shell-layout.mjs';
import { createDevOSSessionLayoutRegistry } from './metaengine-devos-session-layout.mjs';
import { planDevOSSurfaceGrid } from './metaengine-devos-surface-grid.mjs';
import { createDevOSPresentationFocusState } from './metaengine-devos-presentation-focus.mjs';
import { applyDevOSPresentationActivation } from './metaengine-devos-presentation-activation-runtime.mjs';
import { projectWorkspaceWorkbench } from './workspace-workbench-projection.mjs';
import { projectDevOSDevelopmentSources } from './metaengine-devos-development-sources.mjs';

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
nativeTheme.themeSource = 'dark';
protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const registry = new TabRegistry();
const views = new ExactBrowserTabViewMap();
const bridge = new ComputeBridgeClient();
let windowRef = null;
let shellView = null;
let userSession = null;
let downloads = null;
let fleet = null;
let ownerSafetyGates = null;
let developmentPlane = null;
let nativeSupervisor = null;
let shellBrainPortConsumerId = null;
const humanTakeover = new HumanTakeoverController({ getSupervisor: () => nativeSupervisor });
const devosPresentationFocus = createDevOSPresentationFocusState();
const devosSessionLayouts = createDevOSSessionLayoutRegistry({ max_sessions: 128 });
let shellLayoutState = normalizeShellLayoutState();
let shellLayoutPlan = null;
let devosSurfaceGridPlan = null;
let devosSourceSnapshot = null;
let devosSessionLayoutsLoaded = false;
let perceptionCache = { tab_id: null, captured_ms: 0, frame: null, error: null };
let shutdownRequested = false;
let shellProtocolHandlerReady = false;
let userSessionConfigured = false;
let startupRetryTimer = null;
let startupRetryAttempt = 0;
let startupInFlight = false;
let browserRuntimeReady = false;
let startupFailurePresented = false;
let startupControlState = null;
let runtimeGenesisState = null;
const degradedStartupSubsystems = new Map();

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
    if (!['index.html', 'app.js', 'app.css', 'dark-workspace.css'].includes(rel)) return new Response('not found', { status: 404 });
    const body = await fs.readFile(path.join(UI_ROOT, rel));
    return new Response(body, { status: 200, headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' } });
  });
  shellProtocolHandlerReady = true;
}

function configureUserSession() {
  if (userSessionConfigured && userSession) return;
  userSession = session.fromPartition(SECURITY_POLICY.user_space_partition, { cache: true });
  let chatgptPreconnectArmed = false;
  try {
    userSession.preconnect({ url: 'https://chatgpt.com/', numSockets: 2 });
    chatgptPreconnectArmed = true;
  } catch {}
  console.log(JSON.stringify({
    schema: 'metaengine.browser.chat-preconnect.v1',
    state: chatgptPreconnectArmed ? 'ARMED' : 'UNAVAILABLE',
    origin: 'https://chatgpt.com/',
    sockets: 2,
    persistent_partition: SECURITY_POLICY.user_space_partition,
    authority_effect: false,
  }));
  userSession.setPermissionCheckHandler(() => false);
  userSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  downloads = new VerifiedDownloadManager({
    session: userSession,
    rootPath: path.join(app.getPath('downloads'), 'METAENGINE'),
  });
  userSessionConfigured = true;
}

function fleetStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v2.json');
}

function ownerSafetyGateStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-owner-safety-gates-v1.json');
}

function supervisorIdentityPath() {
  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');
}

function supervisorControlStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-control-state-v1.json');
}

function devosSessionLayoutStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-devos-session-layout-registry-v1.json');
}

async function initDevOSSessionLayouts() {
  if (devosSessionLayoutsLoaded) return devosSessionLayouts.snapshot();
  devosSessionLayoutsLoaded = true;
  try {
    const snapshot = JSON.parse(await fs.readFile(devosSessionLayoutStatePath(), 'utf8'));
    devosSessionLayouts.restore(snapshot);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(JSON.stringify({ schema: 'metaengine.devos.session-layout-load.v1', state: 'DEGRADED', reason: String(error?.message || error).slice(0, 240), fallback: 'IN_MEMORY_DEFAULTS', authority_effect: false }));
    }
  }
  return devosSessionLayouts.snapshot();
}

async function saveDevOSSessionLayouts() {
  const target = devosSessionLayoutStatePath();
  const temp = target + '.tmp';
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(devosSessionLayouts.snapshot(), null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, target);
  return devosSessionLayouts.snapshot();
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

function startupDegradedSnapshot() {
  return [...degradedStartupSubsystems.entries()].map(([subsystem, value]) => ({
    subsystem,
    reason: value.reason,
    observed_at: value.observed_at,
    authority_effect: false,
  }));
}

function recordStartupSubsystemDegraded(subsystem, error) {
  const name = String(subsystem || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64) || 'UNKNOWN';
  const reason = String(error?.message || error || 'unknown').slice(0, 240);
  degradedStartupSubsystems.set(name, { reason, observed_at: new Date().toISOString() });
  console.error(JSON.stringify({
    schema: 'metaengine.browser-startup-subsystem.v1',
    state: 'SUBSYSTEM_DEGRADED',
    subsystem: name,
    reason,
    local_shell_kept_alive: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  }));
}

function recordStartupSubsystemReady(subsystem) {
  const name = String(subsystem || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64) || 'UNKNOWN';
  degradedStartupSubsystems.delete(name);
  console.log(JSON.stringify({
    schema: 'metaengine.browser-startup-subsystem.v1',
    state: 'SUBSYSTEM_READY',
    subsystem: name,
    local_shell_kept_alive: true,
    authority_effect: false,
  }));
}

function currentDevOSPresentationProjection() {
  return projectWorkspaceWorkbench({
    tabs: registry.snapshot(),
    fleet: fleet?.snapshot() || null,
    supervisor: nativeSupervisor?.snapshot() || null,
    presentation_focus: devosPresentationFocus.snapshot(),
    session_layouts: devosSessionLayouts.snapshot(),
    devos_sources: devosSourceSnapshot,
  }).devos;
}

function selectBrowserTabForPresentation(tabId) {
  const id = String(tabId || '');
  const tab = registry.get(id);
  const view = views.get(id);
  if (!tab) throw new Error('tab_not_found');
  if (!view || view.webContents.isDestroyed()) throw new Error('tab_binding_not_live');
  registry.select(id);
  attachSelected({ force_single_selected: true });
  invalidatePerception();
  return tab;
}

function applyPresentationFocusIntent(request) {
  return applyDevOSPresentationActivation({
    devos: currentDevOSPresentationProjection(),
    request,
    presentationFocus: devosPresentationFocus,
    selectBrowserTab: selectBrowserTabForPresentation,
  });
}

async function shellSnapshot() {
  const tabs = registry.snapshot();
  const fleetSnapshot = fleet?.snapshot() || null;
  const ownerSafetyGatesSnapshot = ownerSafetyGates?.snapshot() || null;
  const developmentPlaneSnapshot = developmentPlane?.snapshot() || null;
  const supervisor = nativeSupervisor?.snapshot() || null;
  const compute = await bridge.health();
  const presentationFocus = devosPresentationFocus.snapshot();
  const sessionLayouts = devosSessionLayouts.snapshot();
  devosSourceSnapshot = projectDevOSDevelopmentSources({
    development_plane: developmentPlaneSnapshot,
    startup_logs: startupDegradedSnapshot(),
  });
  const workspaces = projectWorkspaceWorkbench({
    tabs,
    fleet: fleetSnapshot,
    owner_safety_gates: ownerSafetyGatesSnapshot,
    development_plane: developmentPlaneSnapshot,
    supervisor,
    compute,
    presentation_focus: presentationFocus,
    session_layouts: sessionLayouts,
    devos_sources: devosSourceSnapshot,
  });
  return {
    schema: 'metaengine.browser-shell.snapshot.v3',
    version: app.getVersion(),
    tabs,
    downloads: downloads?.snapshot() || null,
    fleet: fleetSnapshot,
    owner_safety_gates: ownerSafetyGatesSnapshot,
    development_plane: developmentPlaneSnapshot,
    supervisor,
    human_takeover: supervisor ? humanTakeover.snapshot() : null,
    workspaces,
    compute,
    layout: shellLayoutPlan ? structuredClone(shellLayoutPlan) : null,
    surface_grid: devosSurfaceGridPlan ? structuredClone(devosSurfaceGridPlan) : null,
    session_layouts: structuredClone(sessionLayouts),
    background_service: {
      close_to_background: !shutdownRequested,
      shutdown_requested: shutdownRequested,
      terminal_requires_external_stop: true,
      startup_retry_pending: startupRetryTimer != null,
      startup_retry_attempt: startupRetryAttempt,
      browser_runtime_ready: browserRuntimeReady,
      runtime_genesis: runtimeGenesisState ? structuredClone(runtimeGenesisState) : null,
      startup_degraded_subsystems: startupDegradedSnapshot(),
      local_shell_is_startup_boundary: true,
      remote_network_is_startup_boundary: false,
      fleet_state_is_startup_boundary: false,
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

async function executeHumanTakeover(action) {
  if (!nativeSupervisor) throw new Error('human_takeover_supervisor_unavailable');
  const result = humanTakeover.execute(action);
  await publishSnapshot();
  return result;
}

function installHumanTakeoverAccelerator(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.on('before-input-event', (event, input) => {
    if (input?.type !== 'keyDown' || input?.isAutoRepeat === true) return;
    const control = input?.control === true || input?.meta === true;
    if (!control || input?.shift !== true || String(input?.key || '').toLowerCase() !== 'h') return;
    event.preventDefault();
    if (!nativeSupervisor) return;
    const state = humanTakeover.snapshot();
    const action = state.state === 'PAUSED' ? 'RESUME' : 'PAUSE';
    void executeHumanTakeover(action).catch(() => {});
  });
}

function currentDevOSPresentationShellView() {
  return projectWorkspaceWorkbench({
    tabs: registry.snapshot(),
    fleet: fleet?.snapshot() || null,
    supervisor: nativeSupervisor?.snapshot() || null,
    presentation_focus: devosPresentationFocus.snapshot(),
    session_layouts: devosSessionLayouts.snapshot(),
    devos_sources: devosSourceSnapshot,
  }).devos_shell;
}

function fallbackSelectedSurface() {
  const selected = registry.selected();
  if (!selected) return [];
  return [{
    surface_id: 'browser:' + selected.tab_id,
    session_id: 'session:browser-fallback',
    type: 'BROWSER',
    title: selected.title || 'Browser',
    tab_id: selected.tab_id,
    projection_is_authority: false, scheduler_authority: false, execution_authority: false, command_leasing: false,
    automatic_effect_retry_allowed: false, page_model_authority: false, authority_effect: false,
  }];
}

function computeDevOSSurfaceGrid() {
  if (!shellLayoutPlan) return null;
  const shell = currentDevOSPresentationShellView();
  const focusedSession = shell?.valid === true && shell.selected_session ? shell.selected_session : null;
  const surfaces = focusedSession ? shell.selected_session_surfaces : fallbackSelectedSurface();
  const preferredSurfaceId = focusedSession ? (shell.selected_surface?.surface_id || shell.layout_preferences?.stored_surface_id || null) : null;
  const focusedSurfaceId = preferredSurfaceId && surfaces.some((row) => row.surface_id === preferredSurfaceId) ? preferredSurfaceId : null;
  const requestedLayout = focusedSession ? (shell.layout_preferences?.requested_surface_layout || 'AUTO') : 'SINGLE';
  return planDevOSSurfaceGrid({ bounds: shellLayoutPlan.remote_bounds, surfaces, focused_surface_id: focusedSurfaceId, requested_layout: requestedLayout });
}

function layout() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const { width, height } = windowRef.getContentBounds();
  shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });
  shellView?.setBounds(shellLayoutPlan.shell_bounds);
  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }
  devosSurfaceGridPlan = computeDevOSSurfaceGrid();
  const browserPaneByTab = new Map((devosSurfaceGridPlan?.browser_panes || []).map((pane) => [String(pane.tab_id || ''), pane]));
  for (const [tabId, view] of views) {
    const pane = browserPaneByTab.get(String(tabId));
    if (pane && !view.webContents.isDestroyed()) {
      try { windowRef.contentView.addChildView(view); } catch {}
      view.setBounds(pane.content_bounds);
    } else {
      try { windowRef.contentView.removeChildView(view); } catch {}
    }
  }
}

function attachSelected({ force_single_selected = false } = {}) {
  if (!windowRef) return;
  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }
  if (!shellLayoutPlan) {
    const { width, height } = windowRef.getContentBounds();
    shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });
    shellView?.setBounds(shellLayoutPlan.shell_bounds);
  }
  if (force_single_selected) {
    const selected = registry.selected();
    for (const [tabId, view] of views) {
      if (tabId === selected?.tab_id && !view.webContents.isDestroyed()) {
        try { windowRef.contentView.addChildView(view); } catch {}
        view.setBounds(shellLayoutPlan.remote_bounds);
      } else {
        try { windowRef.contentView.removeChildView(view); } catch {}
      }
    }
    return;
  }
  layout();
}

function invalidatePerception(tabId = null) {
  if (!tabId || perceptionCache.tab_id === tabId) perceptionCache = { tab_id: null, captured_ms: 0, frame: null, error: null };
}

function wireRemoteView(tab, view) {
  installHumanTakeoverAccelerator(view.webContents);
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

async function createTab(input = 'https://chatgpt.com/', { select = true, load = true, awaitLoad = true, role = 'USER' } = {}) {
  if (!userSession) configureUserSession();
  const d = navigationDecision(input);
  if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
  const tab = registry.create({ url: d.normalized_url, kind: d.kind, role, title: d.kind === 'CHATGPT' ? 'ChatGPT' : '' });
  const view = new WebContentsView({ webPreferences: { ...REMOTE_WEB_PREFERENCES, session: userSession } });
  views.set(tab.tab_id, view);
  wireRemoteView(tab, view);
  if (select) registry.select(tab.tab_id);
  attachSelected();
  let navigation = null;
  if (load) {
    const pendingLoad = boundedNavigation(view.webContents, d.normalized_url);
    if (awaitLoad) navigation = await pendingLoad;
    else void pendingLoad.then(() => publishSnapshot().catch(() => {}), () => publishSnapshot().catch(() => {}));
  }
  invalidatePerception();
  await publishSnapshot();
  return {
    ...tab,
    webcontents_id: view.webContents.id,
    load_pending: load && !awaitLoad,
    navigation,
    effect_outcome: 'CONFIRMED',
    automatic_retry_allowed: false,
  };
}

async function loadTab(tabId, input) {
  const view = views.get(String(tabId));
  if (!view || view.webContents.isDestroyed()) throw new Error('tab_binding_not_live');
  const d = navigationDecision(input);
  if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
  const navigation = await boundedNavigation(view.webContents, d.normalized_url);
  const confirmed = navigation.state === 'CONFIRMED';
  if (confirmed) {
    registry.update(String(tabId), { url: d.normalized_url, kind: d.kind });
  } else if (navigation.post_url) {
    const observed = navigationDecision(navigation.post_url);
    if (observed.allow) registry.update(String(tabId), { url: observed.normalized_url, kind: observed.kind });
  }
  invalidatePerception(String(tabId));
  await publishSnapshot();
  return {
    ok: confirmed,
    tab_id: String(tabId),
    url: confirmed ? d.normalized_url : (navigation.post_url || null),
    navigation,
    effect_outcome: confirmed ? 'CONFIRMED' : 'AMBIGUOUS',
    automatic_retry_allowed: false,
  };
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
  invalidatePerception(id);
  attachSelected();
  await publishSnapshot();
}

async function retireFleetSurplus(retireAgentIds) {
  if (!Array.isArray(retireAgentIds) || retireAgentIds.length === 0 || !fleet) return [];
  const ids = retireAgentIds
    .map((value) => String(value || '').toLowerCase())
    .filter((value) => /^agent_[a-z0-9-]{8,64}$/.test(value))
    .slice(0, 4);
  const retired = [];
  for (const agentId of ids) {
    const snapshot = fleet.snapshot();
    const agent = (snapshot?.agents || []).find((row) => String(row.agent_id || '').toLowerCase() === agentId);
    if (!agent) continue;
    if (!['PROVISIONING', 'BOUND_UNVERIFIED'].includes(String(agent.lifecycle_state || ''))) continue;
    const tabId = agent.tab_id ? String(agent.tab_id) : null;
    await fleet.retire(agentId);
    if (tabId) {
      try { await closeTab(tabId); } catch {}
    }
    retired.push(Object.freeze({ agent_id: agentId, tab_id: tabId, lifecycle_state: 'RETIRED', automatic_retry_allowed: false, authority_effect: false }));
  }
  return retired;
}

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
    } catch {}
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
    census: () => registry.census(),
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, spawn_burst_limit: 8 },
  });
  await fleet.init();
  await fleet.reconcile({ active: false });
}

function developmentPlaneRepoRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'devos-source-snapshot') : path.resolve(APP_ROOT, '../..');
}

async function initDevelopmentPlane() {
  if (!developmentPlane) {
    const repoRoot = developmentPlaneRepoRoot();
    developmentPlane = new DevelopmentPlane({
      spawnWorker: () => utilityProcess.fork(path.join(__dirname, 'development-plane-worker.cjs'), [], {
        cwd: repoRoot,
        env: {
          METAENGINE_REPO_ROOT: repoRoot,
          METAENGINE_SOURCE_PROVENANCE: path.join(repoRoot, '.metaengine-source-provenance.json'),
          METAENGINE_GIT_REPOSITORY: 'PatrickFrome/Compute',
        },
        stdio: 'inherit',
        serviceName: 'METAENGINE Development Plane',
      }),
    });
  }
  if (developmentPlane.snapshot().state !== 'READY') await developmentPlane.start();
  if (!developmentPlane.snapshot().devos_repo_read_model) {
    try { await developmentPlane.request('DEVOS_REPO_READ_MODEL'); recordStartupSubsystemReady('DEVOS_REPO_READ_MODEL'); }
    catch (error) { recordStartupSubsystemDegraded('DEVOS_REPO_READ_MODEL', error); }
  }
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
  if (command === 'TAKEOVER_STATUS') {
    if (!nativeSupervisor) throw new Error('human_takeover_supervisor_unavailable');
    return humanTakeover.snapshot();
  }
  if (command === 'TAKEOVER_PAUSE') return executeHumanTakeover('PAUSE');
  if (command === 'TAKEOVER_RESUME') return executeHumanTakeover('RESUME');
  if (command === 'NEW_CHATGPT') return createTab('https://chatgpt.com/', { select: true, load: true, awaitLoad: false });
  if (command === 'NEW_TAB') return createTab(payload?.url || 'https://chatgpt.com/', { select: payload?.select !== false, load: true });
  if (command === 'SELECT_TAB') { registry.select(payload?.tab_id); attachSelected(); invalidatePerception(); await publishSnapshot(); return { ok: true, tab_id: String(payload?.tab_id) }; }
  if (command === 'CLOSE_TAB') { await closeTab(payload?.tab_id); return { ok: true }; }
  if (command === 'NAVIGATE') {
    if (payload?.tab_id) return loadTab(payload.tab_id, payload?.url);
    if (!selectedView) throw new Error('no_selected_tab');
    return loadTab(selected.tab_id, payload?.url);
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
    } catch {}
    return false;
  };
  if (selected && match(selected)) return selected;
  return rows.find(match) || null;
}

function targetTabForSupervisorRead(command) {
  const requestedTabId = command?.payload?.tab_id ? String(command.payload.tab_id) : null;
  if (requestedTabId) return registry.get(requestedTabId) || null;
  const byPlatform = tabForPlatform(command?.platform);
  return byPlatform || registry.selected();
}

function targetViewForSupervisorRead(command) {
  const tab = targetTabForSupervisorRead(command);
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
  const exactMutationTarget = resolveExactNativeSupervisorMutationTarget(command, { registry, views });
  if (action === 'POLL') return { ok: true, snapshot: await nativeSupervisorState(), authority_effect: false };
  if (action === 'SET_MODE') {
    const requested = String(payload?.mode || '').toUpperCase();
    if (requested === 'OBSERVE') return nativeSupervisor.setControlState({ mode: 'MONITOR' });
    if (requested === 'CONTROL' || requested === 'GATE_SEND') return nativeSupervisor.setControlState({ mode: 'CONTROL' });
    throw new Error('native_operator_mode_invalid');
  }
  if (['NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD','TAB_CENSUS','DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL','FLEET_RECONCILE','FLEET_SET_PROFILE','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD','GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'].includes(action)) {
    if (['BACK','FORWARD','RELOAD'].includes(action)) {
      const { tab, view } = assertExactNativeSupervisorMutationTargetCurrent(exactMutationTarget, { views });
      if (action === 'BACK' && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
      if (action === 'FORWARD' && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward();
      if (action === 'RELOAD') view.webContents.reload();
      invalidatePerception(tab.tab_id);
      return { ok: true, tab_id: tab.tab_id, authority_effect: true };
    }
    if (['SELECT_TAB','CLOSE_TAB','NAVIGATE'].includes(action)) {
      const target = assertExactNativeSupervisorMutationTargetCurrent(exactMutationTarget, { views });
      return handleCommand(action, { ...payload, tab_id: target.tab_id });
    }
    return handleCommand(action, payload);
  }
  const { tab, view } = exactMutationTarget
    ? assertExactNativeSupervisorMutationTargetCurrent(exactMutationTarget, { views })
    : targetViewForSupervisorRead(command);
  if (action === 'CAPTURE') return { ...(await captureSemanticFrame(view.webContents)), tab_id: tab.tab_id };
  if (action === 'CAPTURE_VIEW') return { ...(await captureViewThumbnail(view.webContents)), tab_id: tab.tab_id };
  if (['STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK'].includes(action)) {
    assertExactNativeSupervisorMutationTargetCurrent(exactMutationTarget, { views });
    const result = await executeSemanticCommand(view.webContents, command);
    invalidatePerception(tab.tab_id);
    return { ...result, tab_id: tab.tab_id };
  }
  throw new Error('native_supervisor_command_unknown');
}

function detachShellBrainPort() {
  if (!shellBrainPortConsumerId) return false;
  const consumerId = shellBrainPortConsumerId;
  shellBrainPortConsumerId = null;
  try { return nativeSupervisor?.detachCognitiveMessagePort?.(consumerId) === true; } catch { return false; }
}

function attachShellBrainPort() {
  detachShellBrainPort();
  if (!nativeSupervisor || !shellView || shellView.webContents.isDestroyed()) return null;
  const { port1, port2 } = new MessageChannelMain();
  let attached = null;
  try {
    attached = nativeSupervisor.attachCognitiveMessagePort(port1);
    shellView.webContents.postMessage('metaengine:brain:port', {
      schema: 'metaengine.browser.cognitive-port-transfer.v1',
      consumer_id: attached.consumer_id,
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    }, [port2]);
    shellBrainPortConsumerId = attached.consumer_id;
    return attached;
  } catch (error) {
    if (attached?.consumer_id) {
      try { nativeSupervisor.detachCognitiveMessagePort(attached.consumer_id); } catch {}
    }
    try { port1.close(); } catch {}
    try { port2.close(); } catch {}
    throw error;
  }
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
      commandBatchSize: 64,
      commandReadConcurrency: 32,
      commandMutationConcurrency: 16,
      commandBatchWaitMs: 15000,
      legacySingleLeaseFallback: false,
      commandFastlane: false,
      getState: nativeSupervisorState,
      executeCommand: executeNativeSupervisorCommand,
      observeLocalTarget,
      workerObservationBudget: 4,
      controlStatePath: supervisorControlStatePath(),
    });
  }
  if (nativeSupervisor.snapshot()?.running !== true) await nativeSupervisor.start();
  if (!shellBrainPortConsumerId) attachShellBrainPort();
  await publishSnapshot().catch(() => {});
  return nativeSupervisor.snapshot();
}

function destroyWindowContents() {
  detachShellBrainPort();
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
    schema: 'metaengine.browser-startup-recovery.v2',
    state: 'LOCAL_SHELL_RETRY_PENDING',
    attempt: startupRetryAttempt,
    delay_ms: delay,
    error: String(error?.message || error).slice(0, 240),
    timer_keeps_process_alive: true,
    terminal: false,
    external_stop_required_for_terminal: true,
    authority_effect: false,
  }));
  startupRetryTimer = setTimeout(() => {
    startupRetryTimer = null;
    void startBrowserRuntime();
  }, delay);
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

async function presentBrowserStartupFailure(error) {
  if (startupFailurePresented || isSmoke || isDevelopmentPlaneSmoke) return;
  startupFailurePresented = true;
  const reason = String(error?.message || error).slice(0, 500);
  const journalPath = path.join(app.getPath('userData'), 'metaengine-browser-startup-journal-v1.json');
  console.error(JSON.stringify({
    schema: 'metaengine.browser-startup-failure.v1',
    state: 'LOCAL_SHELL_START_FAILED',
    reason,
    startup_journal_path: journalPath,
    retry_pending: true,
    authority_effect: false,
  }));
  try {
    const { dialog } = await import('electron');
    dialog.showErrorBox(
      'METAENGINE Browser — startup error',
      [
        'The local Browser shell could not be opened.',
        'Network, Fleet, supervisor and DevOS failures are no longer allowed to close this shell,',
        'so this indicates a local shell/session/bootstrap failure.',
        '',
        `Diagnostic: ${reason}`,
        `Startup journal: ${journalPath}`,
        '',
        'The recovery host will keep one bounded startup retry path alive.',
      ].join('\n'),
    );
  } catch {}
}

async function runDegradableStartupStep(subsystem, operation) {
  try {
    const result = await operation();
    recordStartupSubsystemReady(subsystem);
    return result;
  } catch (error) {
    recordStartupSubsystemDegraded(subsystem, error);
    return null;
  }
}

async function bootstrapDegradableSubsystems() {
  // Startup topology is independent from supervisor authority. Final runtime is
  // always CONTROL+armed, while clean genesis intentionally requests zero tabs.
  const requestedInitialTabs = Number(runtimeGenesisState?.initial_tabs || 0);
  const shouldCreateInitialRemoteTab = Number.isSafeInteger(requestedInitialTabs) && requestedInitialTabs > 0;
  await runDegradableStartupStep('OWNER_SAFETY_GATES', async () => {
    try {
      return await initOwnerSafetyGates();
    } catch (error) {
      ownerSafetyGates = null;
      throw error;
    }
  });

  const sessionReady = await runDegradableStartupStep('USER_SESSION', async () => {
    configureUserSession();
    return true;
  });

  let initialTab = null;
  if (sessionReady && shouldCreateInitialRemoteTab) {
    initialTab = await runDegradableStartupStep('INITIAL_TAB_CREATE', () => createTab('https://chatgpt.com/', { select: true, load: false }));
    if (initialTab?.tab_id) {
      setImmediate(() => {
        void loadTab(initialTab.tab_id, 'https://chatgpt.com/')
          .then(() => recordStartupSubsystemReady('INITIAL_REMOTE_LOAD'))
          .catch((error) => recordStartupSubsystemDegraded('INITIAL_REMOTE_LOAD', error));
      });
    }
  }

  await runDegradableStartupStep('FLEET', async () => {
    try {
      return await initFleet();
    } catch (error) {
      fleet = null;
      throw error;
    }
  });

  setImmediate(() => {
    void runDegradableStartupStep('DEVELOPMENT_PLANE', () => initDevelopmentPlane());
  });

  await runDegradableStartupStep('SHELL_SNAPSHOT', () => publishSnapshot());

  setImmediate(() => {
    void runDegradableStartupStep('NATIVE_SUPERVISOR', () => initNativeSupervisor());
  });
}

async function createWindow() {
  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.show();
    windowRef.focus();
    return;
  }
  windowRef = new BaseWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'METAENGINE Browser',
    backgroundColor: '#101216',
    show: false,
  });
  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  installHumanTakeoverAccelerator(shellView.webContents);
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

  // The only user-visible startup boundary is the local packaged shell. Remote
  // navigation, persisted Fleet state, supervisor identity, DevOS and local
  // bridge availability are degradable subsystems and must never destroy the UI.
  await shellView.webContents.loadURL('metaengine://shell/');
  layout();
  windowRef.show();
  windowRef.focus();
  console.log(JSON.stringify({
    schema: 'metaengine.browser-local-shell.v1',
    state: 'LOCAL_SHELL_VISIBLE',
    version: app.getVersion(),
    pid: process.pid,
    remote_network_required: false,
    fleet_state_required: false,
    authority_effect: false,
  }));

  // Do not await the degradable plane in the startup critical path. It gets one
  // bootstrap pass and later subsystem-specific paths may recover independently.
  setImmediate(() => {
    void bootstrapDegradableSubsystems().catch((error) => recordStartupSubsystemDegraded('BACKGROUND_BOOTSTRAP', error));
  });
}

ipcMain.handle('metaengine:shell:snapshot', async (event) => { assertShellSender(event); return shellSnapshot(); });
ipcMain.handle('metaengine:shell:command', async (event, message) => { assertShellSender(event); return handleCommand(String(message?.command || ''), message?.payload || {}); });
ipcMain.handle('metaengine:shell:presentation-focus:snapshot', async (event) => {
  assertShellSender(event);
  return devosPresentationFocus.snapshot();
});
ipcMain.handle('metaengine:shell:presentation-layout:set', async (event, sessionId, layoutMode) => {
  assertShellSender(event);
  const id = String(sessionId || '');
  const devos = currentDevOSPresentationProjection();
  if (!devos.sessions.some((row) => String(row.session_id) === id)) throw new Error('devos_surface_layout_session_not_found');
  const entry = devosSessionLayouts.setSurfaceLayout(id, layoutMode);
  await saveDevOSSessionLayouts();
  layout();
  await publishSnapshot();
  return entry;
});
ipcMain.handle('metaengine:shell:presentation-focus:select-session', async (event, sessionId) => {
  assertShellSender(event);
  const result = applyPresentationFocusIntent({ intent: 'SESSION', session_id: sessionId });
  if (result.applied) {
    devosSessionLayouts.activate(String(sessionId));
    await saveDevOSSessionLayouts();
    layout();
  }
  if (result.applied || result.browser_activation_performed) await publishSnapshot();
  return result;
});
ipcMain.handle('metaengine:shell:presentation-focus:select-surface', async (event, sessionId, surfaceId) => {
  assertShellSender(event);
  const result = applyPresentationFocusIntent({ intent: 'SURFACE', session_id: sessionId, surface_id: surfaceId });
  if (result.applied) {
    devosSessionLayouts.activate(String(sessionId));
    devosSessionLayouts.setActiveSurface(String(sessionId), String(surfaceId));
    await saveDevOSSessionLayouts();
    layout();
  }
  if (result.applied || result.browser_activation_performed) await publishSnapshot();
  return result;
});
ipcMain.handle('metaengine:shell:presentation-focus:clear', async (event) => {
  assertShellSender(event);
  const state = devosPresentationFocus.clear();
  layout();
  await publishSnapshot();
  return state;
});

async function startAfterReady() {
  await registerShellProtocol();
  runtimeGenesisState = await ensureRuntimeGenesis({ userDataPath: app.getPath('userData') });
  startupControlState = await loadNativeSupervisorControlState(supervisorControlStatePath());
  await initDevOSSessionLayouts();
  if (isDevelopmentPlaneSmoke || isSmoke) configureUserSession();
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
    else {
      void presentBrowserStartupFailure(error);
      scheduleBrowserRuntimeRetry(error);
    }
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
    windowRef.focus();
    return;
  }
  browserRuntimeReady = false;
  void startBrowserRuntime();
});
app.on('window-all-closed', () => {});
if (app.isReady()) queueMicrotask(() => { void startBrowserRuntime(); });
else app.once('ready', () => { void startBrowserRuntime(); });
