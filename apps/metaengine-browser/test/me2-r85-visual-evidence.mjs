import { app, BaseWindow, WebContentsView, ipcMain, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const PRELOAD = path.join(APP_ROOT, 'src', 'preload-shell.cjs');
const OUTPUT_ROOT = path.resolve(
  process.env.METAENGINE_R85_VISUAL_EVIDENCE_DIR || path.join(APP_ROOT, 'r85-visual-evidence'),
);
const UI_DIR = path.resolve(
  process.env.METAENGINE_R85_VISUAL_UI_DIR || path.join(APP_ROOT, 'me2-ui-dist'),
);

process.env.ME2_UI_DIR = UI_DIR;
process.env.ME2_UI_PORT = process.env.ME2_UI_PORT || '39100';
process.env.ME2_UI_HEALTH_URL = process.env.ME2_UI_HEALTH_URL || `http://127.0.0.1:${process.env.ME2_UI_PORT}/`;
process.env.ME2_UI_GATEWAY_PORT = process.env.ME2_UI_GATEWAY_PORT || '39101';
process.env.ME2_ALLOW_EXTERNAL_UI_ADOPT = '0';

app.enableSandbox();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const VISUAL_PHASE_TIMEOUT_MS = 120_000;
let phase = 'BOOT';
const blockedRemoteBrowserPorts = new Set();

function installRemoteBrowserTransportFence() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const url = new URL(String(details?.url || ''));
      const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
      if (port === '3042' || port === '3043') {
        blockedRemoteBrowserPorts.add(port);
        callback({ cancel: true });
        return;
      }
    } catch {}
    callback({ cancel: false });
  });
}

function markPhase(next) {
  phase = next;
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r97-visual-phase.v1',
    phase,
    authority_effect: false,
  }));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`r97_visual_timeout:${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fixtureRoster(selected = 'supervisor:sup_visual') {
  const actors = [
    {
      actor_id: 'supervisor:sup_visual',
      actor_type: 'SUPERVISOR',
      role: 'SUPERVISOR',
      state: 'ACTIVE',
      tab_id: 'tab_supervisor_visual',
      selected: selected === 'supervisor:sup_visual',
      title: 'GLM Supervisor',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
    {
      actor_id: 'agent:agent_planner_visual',
      actor_type: 'AGENT',
      role: 'PLANNER',
      state: 'ACTIVE',
      tab_id: 'tab_planner_visual',
      selected: selected === 'agent:agent_planner_visual',
      title: 'Planner',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
    {
      actor_id: 'agent:agent_impl_visual',
      actor_type: 'AGENT',
      role: 'IMPLEMENTER',
      state: 'ACTIVE',
      tab_id: 'tab_impl_visual',
      selected: selected === 'agent:agent_impl_visual',
      title: 'Implementer',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
  ];
  return Object.freeze({
    schema: 'metaengine.browser.primary-chat-fleet-roster.v1',
    actors: Object.freeze(actors),
    actor_count: actors.length,
    supervisor_count: 1,
    agent_count: 2,
    selected_actor_id: selected,
    bounded: true,
    renderer_routing_authority: false,
    browser_command_authority: false,
    scheduler_authority: false,
    update_authority: false,
    authority_effect: false,
  });
}

function registerPresentationIpc() {
  let page = 'browser';
  let overlay = false;
  let selectedActor = 'supervisor:sup_visual';

  ipcMain.handle('metaengine:shell:primary-page', (_event, rawPage) => {
    page = String(rawPage || 'browser');
    return Object.freeze({
      schema: 'metaengine.browser.r97-visual.primary-page.v1',
      page,
      native_browser_surface_visible: !overlay && page === 'browser',
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-overlay', (_event, rawActive) => {
    overlay = rawActive === true;
    return Object.freeze({
      schema: 'metaengine.browser.r97-visual.primary-overlay.v1',
      active: overlay,
      native_browser_surface_visible: !overlay && page === 'browser',
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-command-rail', () => Object.freeze({
    schema: 'metaengine.browser.r97-visual.legacy-command-rail.v1',
    requested_open: false,
    effective_open: false,
    presentation_only: true,
    authority_effect: false,
  }));
  ipcMain.handle('metaengine:shell:primary-context-drawer', () => Object.freeze({
    schema: 'metaengine.browser.r97-visual.legacy-context-drawer.v1',
    requested_open: false,
    effective_open: false,
    presentation_only: true,
    authority_effect: false,
  }));
  ipcMain.handle('metaengine:shell:primary-chat-fleet-roster', () => fixtureRoster(selectedActor));
  ipcMain.handle('metaengine:shell:primary-chat-actor-select', (_event, rawActorId) => {
    const actorId = String(rawActorId || '');
    const match = fixtureRoster(selectedActor).actors.find((row) => row.actor_id === actorId);
    if (!match) throw new Error('visual_actor_not_bound');
    selectedActor = actorId;
    return Object.freeze({
      schema: 'metaengine.browser.primary-chat-actor-selection.v1',
      actor_id: actorId,
      actor_type: match.actor_type,
      tab_id: match.tab_id,
      selection_applied: true,
      exact_native_binding: true,
      presentation_only: true,
      authority_effect: false,
    });
  });
}

async function waitFor(contents, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await contents.executeJavaScript(`Boolean(${expression})`);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`r97_visual_wait_timeout:${expression}`);
}

async function settle(contents) {
  await withTimeout(contents.executeJavaScript(`Promise.race([
    document.fonts?.ready ? document.fonts.ready.then(() => 'fonts-ready') : Promise.resolve('fonts-unavailable'),
    new Promise((resolve) => setTimeout(() => resolve('fonts-timeout'), 3000))
  ])`), 5000, 'fonts');
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function metrics(contents) {
  return contents.executeJavaScript(`(() => {
    const rect = (id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (!el || el.getClientRects().length === 0) return null;
      const r = el.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height };
    };
    return {
      topbar: rect('topbar'),
      primary: rect('primary-chat-fleet'),
      rail: rect('chat-fleet-rail'),
      native_slot: rect('native-chat-surface-slot'),
      cmdbar: rect('global-cmdbar'),
      settings: rect('settings-button'),
      supervisor_rows: document.querySelectorAll('[data-testid="chat-supervisor-row"]').length,
      agent_rows: document.querySelectorAll('[data-testid="chat-agent-row"]').length,
      page: document.querySelector('[data-testid="page-outlet"]')?.getAttribute('data-page') || null,
      pagebar_present: Boolean(document.querySelector('[data-testid="pagebar"]')),
      statusbar_present: Boolean(document.querySelector('[data-testid="statusbar"]')),
      context_drawer_present: Boolean(document.querySelector('[data-testid="context-drawer"]')),
      run_inspector_present: Boolean(document.querySelector('[data-testid="run-telemetry-inspector"]')),
      palette_present: Boolean(document.querySelector('[cmdk-root], [role="dialog"]')),
      body_background: getComputedStyle(document.body).backgroundColor,
    };
  })()`);
}

async function capture(view, name) {
  await settle(view.webContents);
  const image = await withTimeout(view.webContents.capturePage(), 10_000, `capture:${name}`);
  const png = image.toPNG();
  if (png.length < 4096) throw new Error(`r97_visual_png_too_small:${name}:${png.length}`);
  const file = path.join(OUTPUT_ROOT, `${name}.png`);
  await fs.writeFile(file, png);
  return Object.freeze({
    name,
    file: path.basename(file),
    bytes: png.length,
    sha256: digest(png),
    metrics: await metrics(view.webContents),
  });
}

function assertMain(row) {
  const m = row.metrics;
  if (Math.round(m?.topbar?.height || 0) !== 42) throw new Error(`r97_visual_topbar_height:${m?.topbar?.height}`);
  if (m?.page !== 'browser') throw new Error(`r97_visual_start_page:${m?.page}`);
  if (!m?.primary || !m?.rail || !m?.native_slot) throw new Error('r97_visual_primary_workspace_missing');
  if (Math.round(m.rail.width || 0) !== 288) throw new Error(`r97_visual_rail_width:${m.rail.width}`);
  if (Math.round(m.native_slot.x || 0) !== 288) throw new Error(`r97_visual_native_slot_x:${m.native_slot.x}`);
  if (Math.round(m.native_slot.width || 0) !== 1152) throw new Error(`r97_visual_native_slot_width:${m.native_slot.width}`);
  if (m.supervisor_rows !== 1 || m.agent_rows !== 2) {
    throw new Error(`r97_visual_actor_rows:${m.supervisor_rows}:${m.agent_rows}`);
  }
  if (!m.cmdbar || !m.settings) throw new Error('r97_visual_global_search_or_settings_missing');
  if (m.pagebar_present || m.statusbar_present || m.context_drawer_present || m.run_inspector_present) {
    throw new Error(`r97_visual_legacy_persistent_chrome_present:${JSON.stringify(m)}`);
  }
  if (m.palette_present) throw new Error('r97_visual_palette_should_start_closed');
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({
      schema: 'metaengine.browser.r97-visual-evidence.v1',
      ok: false,
      error: `r97_visual_phase_watchdog:${phase}`,
      authority_effect: false,
    }));
    app.exit(2);
  }, VISUAL_PHASE_TIMEOUT_MS);

  await withTimeout(app.whenReady(), 20_000, 'app_ready');
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  installRemoteBrowserTransportFence();
  registerPresentationIpc();

  markPhase('START_UI_HOST');
  const { startMe2UiHost, stopMe2UiHostAndWait } = await import('../src/me2/me2-ui-host.mjs');
  const { startMe2UiGateway, stopMe2UiGateway } = await import('../src/me2/me2-ui-gateway.mjs');
  const host = await withTimeout(startMe2UiHost(), 25_000, 'start_ui_host');
  if (!['HEALTHY','ADOPTED'].includes(host.state)) throw new Error(`r97_visual_ui_host_not_ready:${JSON.stringify(host)}`);
  const gateway = await withTimeout(startMe2UiGateway(), 10_000, 'start_gateway');
  if (gateway.state !== 'LIVE' || !gateway.url) throw new Error(`r97_visual_gateway_not_ready:${JSON.stringify(gateway)}`);

  const windowRef = new BaseWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#09090b',
    title: 'METAENGINE R97 Visual Qualification',
  });
  const shellView = new WebContentsView({
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  windowRef.contentView.addChildView(shellView);
  shellView.setBounds({ x:0, y:0, width:1440, height:960 });

  const evidence = {
    schema: 'metaengine.browser.r97-visual-evidence.v1',
    source_head: String(process.env.ME2_BUILD_SHA || ''),
    ok: false,
    captures: [],
    exact_main_workspace: false,
    advanced_surfaces_settings_only: false,
    command_search_available: false,
    primary_me2_ui_captured: true,
    legacy_shell_captured: false,
    remote_browser_content_captured: false,
    remote_browser_transport_blocked: true,
    blocked_remote_browser_ports: ['3042','3043'],
    presentation_only: true,
    authority_effect: false,
  };

  try {
    markPhase('LOAD_PRIMARY_CHAT_FLEET');
    await withTimeout(shellView.webContents.loadURL(`${gateway.url}/#browser`), 25_000, 'load_primary');
    shellView.webContents.setZoomFactor(1);
    windowRef.show();

    await waitFor(shellView.webContents, "document.querySelector('[data-testid=primary-chat-fleet]')");
    await waitFor(shellView.webContents, "document.querySelectorAll('[data-testid=chat-agent-row]').length === 2");
    const mainCapture = await capture(shellView, 'r97-chat-fleet-main-1440x960');
    assertMain(mainCapture);
    evidence.captures.push(mainCapture);
    evidence.exact_main_workspace = true;

    markPhase('SELECT_AGENT');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="chat-agent-row"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=chat-agent-row]')?.getAttribute('aria-current') === 'page'");
    evidence.captures.push(await capture(shellView, 'r97-chat-fleet-agent-selected-1440x960'));

    markPhase('OPEN_SETTINGS');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="settings-button"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-outlet]')?.getAttribute('data-page') === 'system'");
    await waitFor(shellView.webContents, "document.querySelectorAll('[data-testid^=settings-open-]').length === 8");
    const settingsCapture = await capture(shellView, 'r97-settings-advanced-surface-1440x960');
    if (settingsCapture.metrics.primary != null || settingsCapture.metrics.rail != null) {
      throw new Error('r97_visual_main_rail_persisted_inside_settings');
    }
    evidence.captures.push(settingsCapture);
    evidence.advanced_surfaces_settings_only = true;

    markPhase('RETURN_MAIN_AND_OPEN_SEARCH');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="brand"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-outlet]')?.getAttribute('data-page') === 'browser'");
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="global-cmdbar"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "Boolean(document.querySelector('[cmdk-root], [role=dialog]'))");
    const searchCapture = await capture(shellView, 'r97-command-search-1440x960');
    if (!searchCapture.metrics.palette_present) throw new Error('r97_visual_command_search_not_visible');
    evidence.captures.push(searchCapture);
    evidence.command_search_available = true;

    // The R97 shell never needs the old remote Browser streaming endpoints.
    // The qualification session blocks both ports for the whole capture window;
    // evidence records the policy even when no request was attempted. Any actual
    // request is cancelled above and observed in blockedRemoteBrowserPorts.
    evidence.remote_browser_transport_blocked = true;
    evidence.blocked_remote_browser_ports = ['3042','3043'];
    evidence.observed_blocked_remote_browser_ports = [...blockedRemoteBrowserPorts].sort();
    evidence.ok = true;
    evidence.capture_count = evidence.captures.length;
    evidence.generated_at = new Date().toISOString();
    await fs.writeFile(path.join(OUTPUT_ROOT, 'r85-visual-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    clearTimeout(watchdog);
    try { if (!shellView.webContents.isDestroyed()) shellView.webContents.close(); } catch {}
    try { windowRef.destroy(); } catch {}
    try { await stopMe2UiGateway(); } catch {}
    try { await stopMe2UiHostAndWait(); } catch {}
  }
}

main().then(() => app.exit(0)).catch(async (error) => {
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r97-visual-evidence.v1',
    ok: false,
    phase,
    error: String(error?.stack || error?.message || error).slice(0, 4000),
    authority_effect: false,
  }));
  app.exit(1);
});
