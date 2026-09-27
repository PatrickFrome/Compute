import { app, BaseWindow, WebContentsView, ipcMain } from 'electron';
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

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const VISUAL_PHASE_TIMEOUT_MS = 120_000;
let visualPhase = 'BOOT';
const blockedRemoteBrowserPorts = new Set();

function markPhase(phase) {
  visualPhase = phase;
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r85-visual-phase.v1',
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
        timer = setTimeout(() => reject(new Error(`r85_visual_timeout:${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function registerPresentationIpc() {
  let page = 'command';
  let overlay = false;
  let railOpen = true;
  let drawerOpen = false;
  let drawerDock = 'bottom';
  let drawerHeight = 200;
  let drawerWidth = 380;

  ipcMain.handle('metaengine:shell:primary-page', (_event, rawPage) => {
    page = String(rawPage || 'command');
    return Object.freeze({
      schema: 'metaengine.browser.r85-visual.primary-page.v1',
      page,
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-overlay', (_event, rawActive) => {
    overlay = rawActive === true;
    return Object.freeze({
      schema: 'metaengine.browser.r85-visual.primary-overlay.v1',
      active: overlay,
      native_browser_surface_visible: !overlay && page === 'browser',
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-command-rail', (_event, rawOpen) => {
    railOpen = rawOpen === true;
    return Object.freeze({
      schema: 'metaengine.browser.r85-visual.command-rail.v1',
      requested_open: railOpen,
      effective_open: railOpen,
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-context-drawer', (_event, rawOpen, rawDock, rawHeight, rawWidth) => {
    drawerOpen = rawOpen === true;
    drawerDock = String(rawDock || 'bottom').toLowerCase() === 'right' ? 'right' : 'bottom';
    const requestedHeight = Number(rawHeight);
    const requestedWidth = Number(rawWidth);
    if (Number.isFinite(requestedHeight)) drawerHeight = Math.max(160, Math.min(360, Math.round(requestedHeight)));
    if (Number.isFinite(requestedWidth)) drawerWidth = Math.max(320, Math.min(520, Math.round(requestedWidth)));
    return Object.freeze({
      schema: 'metaengine.browser.r95-visual.utility-panel.v1',
      requested_open: drawerOpen,
      requested_dock: drawerDock,
      requested_height: drawerHeight,
      requested_width: drawerWidth,
      effective_open: drawerOpen,
      dock: drawerDock,
      drawer_height: drawerDock === 'bottom' ? drawerHeight : 0,
      drawer_width: drawerDock === 'right' ? drawerWidth : 0,
      presentation_only: true,
      authority_effect: false,
    });
  });
}

async function waitFor(contents, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await contents.executeJavaScript(`Boolean(${expression})`);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`r85_visual_wait_timeout:${expression}`);
}

async function waitForRemoteIsolation(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (blockedRemoteBrowserPorts.has('3042') && blockedRemoteBrowserPorts.has('3043')) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`r85_visual_remote_transport_not_isolated:${[...blockedRemoteBrowserPorts].sort().join(',')}`);
}

async function settle(contents) {
  await withTimeout(contents.executeJavaScript(`Promise.race([
    document.fonts?.ready ? document.fonts.ready.then(() => 'fonts-ready') : Promise.resolve('fonts-unavailable'),
    new Promise((resolve) => setTimeout(() => resolve('fonts-timeout'), 3000))
  ])`), 5000, 'fonts_settle');
  await withTimeout(contents.executeJavaScript(`Promise.race([
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('frames-ready')))),
    new Promise((resolve) => setTimeout(() => resolve('frames-timeout'), 1500))
  ])`), 3000, 'frame_settle');
  await new Promise((resolve) => setTimeout(resolve, 250));
}
async function metrics(contents) {
  return contents.executeJavaScript(`(() => {
    const rect = (id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height };
    };
    return {
      topbar: rect('topbar'),
      pagebar: rect('pagebar'),
      statusbar: rect('statusbar'),
      command: rect('page-command'),
      agent_sidebar: rect('agent-sidebar'),
      mission_objective: rect('mission-objective-card'),
      mission_active_work: rect('mission-active-work'),
      browser_shell: rect('browser-shell'),
      evidence_timeline: rect('evidence-timeline'),
      evidence_binding_mode: document.querySelector('[data-testid="evidence-timeline"]')?.getAttribute('data-binding-mode') || null,
      context_drawer: rect('context-drawer'),
      utility_panel_body: rect('utility-panel-body'),
      context_drawer_dock: document.querySelector('[data-testid="context-drawer"]')?.getAttribute('data-drawer-dock') || null,
      context_drawer_toggle: Boolean(document.querySelector('[data-testid="context-drawer-toggle"]')),
      sidebar_toggle: Boolean(document.querySelector('[data-testid="cc-sidebar-toggle"]')),
      attention_button: Boolean(document.querySelector('[data-testid="attention-button"]')),
      palette_mounted: Boolean(document.querySelector('[cmdk-root], [data-testid="registry-action-args"], [role="dialog"]')),
      browser_images: Array.from(document.querySelectorAll('[data-testid="browser-cast-image"], [data-testid="browser-cdp-fallback-image"]')).map((el) => ({
        testid: el.getAttribute('data-testid'),
        complete: Boolean(el.complete),
        natural_width: Number(el.naturalWidth || 0),
        opacity: Number(getComputedStyle(el).opacity),
      })),
      broken_browser_images_hidden: Array.from(document.querySelectorAll('[data-testid="browser-cast-image"], [data-testid="browser-cdp-fallback-image"]')).every((el) => (
        Number(el.naturalWidth || 0) > 0 || Number(getComputedStyle(el).opacity) === 0
      )),
      remote_browser_pixels_visible: Array.from(document.querySelectorAll('[data-testid="browser-cast-image"], [data-testid="browser-cdp-fallback-image"]')).some((el) => (
        Number.parseFloat(getComputedStyle(el).opacity || '0') > 0 && Number(el.naturalWidth || 0) > 0
      )),
      page: document.querySelector('[data-testid="page-outlet"]')?.getAttribute('data-page') || null,
      body_background: getComputedStyle(document.body).backgroundColor,
    };
  })()`);
}

async function capture(view, name) {
  await settle(view.webContents);
  const image = await withTimeout(view.webContents.capturePage(), 10_000, `capture_page:${name}`);
  const png = image.toPNG();
  if (png.length < 4096) throw new Error(`r85_visual_png_too_small:${name}:${png.length}`);
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

function assertBaseMetrics(row) {
  const m = row.metrics;
  if (Math.round(m?.topbar?.height || 0) !== 42) throw new Error(`r85_visual_topbar_height:${m?.topbar?.height}`);
  if (Math.round(m?.pagebar?.height || 0) !== 36) throw new Error(`r85_visual_pagebar_height:${m?.pagebar?.height}`);
  if (Math.round(m?.statusbar?.height || 0) !== 22) throw new Error(`r85_visual_statusbar_height:${m?.statusbar?.height}`);
  if (!m?.context_drawer_toggle || !m?.attention_button) throw new Error('r85_visual_global_controls_missing');
  if (m?.palette_mounted) throw new Error('r85_visual_closed_overlay_semantic_pollution');
  if (m?.broken_browser_images_hidden !== true) {
    throw new Error(`r85_visual_broken_browser_image_visible:${JSON.stringify(m?.browser_images || [])}`);
  }
  if (m?.remote_browser_pixels_visible) throw new Error('r85_visual_remote_browser_pixels_visible');
  if (m?.page === 'command') {
    if (Math.round(m?.agent_sidebar?.width || 0) !== 252) throw new Error(`r95c_visual_agent_sidebar_width:${m?.agent_sidebar?.width}`);
    if (!m?.sidebar_toggle) throw new Error('r95c_visual_command_sidebar_toggle_missing');
    if (!m?.mission_objective || !m?.mission_active_work) throw new Error('r95c_visual_mission_control_missing');
    if (m?.browser_shell != null) throw new Error('r95c_visual_command_must_not_host_browser');
    return;
  }
  if (m?.page === 'browser') {
    if (!m?.browser_shell || Math.round(m.browser_shell.width || 0) < 500 || Math.round(m.browser_shell.height || 0) < 300) {
      throw new Error(`r95c_visual_run_browser_missing:${JSON.stringify(m?.browser_shell)}`);
    }
    return;
  }
  if (m?.page === 'observability') {
    if (!m?.evidence_timeline || Math.round(m.evidence_timeline.width || 0) < 400 || Math.round(m.evidence_timeline.height || 0) < 80) {
      throw new Error(`r95e_visual_evidence_timeline_missing:${JSON.stringify(m?.evidence_timeline)}`);
    }
    if (m?.browser_shell != null) throw new Error('r95e_visual_observe_must_not_host_browser');
    if (!['UNBOUND', 'EXACT_TASK_ID'].includes(String(m?.evidence_binding_mode || ''))) {
      throw new Error(`r95e_visual_evidence_binding_mode_invalid:${m?.evidence_binding_mode}`);
    }
    return;
  }
  throw new Error(`r95c_visual_unexpected_page:${m?.page}`);
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({
      schema: 'metaengine.browser.r85-visual-evidence.v1',
      ok: false,
      error: `r85_visual_phase_watchdog:${visualPhase}`,
      authority_effect: false,
    }));
    app.exit(2);
  }, VISUAL_PHASE_TIMEOUT_MS);
  await withTimeout(app.whenReady(), 20_000, 'app_ready');
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  registerPresentationIpc();
  markPhase('START_UI_HOST');

  const {
    startMe2UiHost,
    stopMe2UiHostAndWait,
  } = await import('../src/me2/me2-ui-host.mjs');
  const {
    startMe2UiGateway,
    stopMe2UiGateway,
  } = await import('../src/me2/me2-ui-gateway.mjs');

  const host = await withTimeout(startMe2UiHost(), 25_000, 'start_ui_host');
  if (!['HEALTHY', 'ADOPTED'].includes(host.state)) {
    throw new Error(`r85_visual_ui_host_not_ready:${JSON.stringify(host)}`);
  }
  markPhase('START_GATEWAY');
  const gateway = await withTimeout(startMe2UiGateway(), 10_000, 'start_gateway');
  if (gateway.state !== 'LIVE' || !gateway.url) {
    throw new Error(`r85_visual_gateway_not_ready:${JSON.stringify(gateway)}`);
  }

  const windowRef = new BaseWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#09090b',
    title: 'METAENGINE R85 Visual Qualification',
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
  shellView.setBounds({ x: 0, y: 0, width: 1440, height: 960 });

  shellView.webContents.session.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      try {
        const url = new URL(details.url);
        const port = url.searchParams.get('XTransformPort');
        if (port === '3042' || port === '3043') {
          blockedRemoteBrowserPorts.add(port);
          callback({ cancel: true });
          return;
        }
      } catch { /* non-standard URL: allow */ }
      callback({});
    },
  );

  try {
    markPhase('LOAD_PRIMARY_ME2');
    await withTimeout(shellView.webContents.loadURL(`${gateway.url}/#command`), 25_000, 'load_primary_me2');
    shellView.webContents.setZoomFactor(1);
    windowRef.show();

    markPhase('WAIT_PRIMARY_COMMAND');
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-command]')");
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=context-drawer-toggle]')");
    markPhase('CAPTURE_COMMAND_MISSION');
    const closed = await capture(shellView, 'r95c-command-mission-1440x960');
    assertBaseMetrics(closed);
    if (closed.metrics.context_drawer != null) throw new Error('r95c_visual_drawer_should_start_closed');

    markPhase('NAVIGATE_RUN');
    await withTimeout(
      shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="workflow-stage-run"]')?.click(); true`),
      5000,
      'navigate_run',
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-browser]')");
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=browser-shell]')");
    await waitForRemoteIsolation();

    markPhase('OPEN_RUN_UTILITY_BOTTOM');
    await withTimeout(
      shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="context-drawer-toggle"]')?.click(); true`),
      5000,
      'open_run_utility_bottom',
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=context-drawer]')?.getAttribute('data-drawer-dock') === 'bottom'");
    const drawer = await capture(shellView, 'r95c-run-utility-bottom-1440x960');
    assertBaseMetrics(drawer);
    const drawerHeight = Math.round(drawer.metrics?.context_drawer?.height || 0);
    if (drawerHeight < 160 || drawerHeight > 360) throw new Error(`r95c_visual_drawer_height:${drawerHeight}`);

    markPhase('DOCK_RUN_UTILITY_RIGHT');
    await withTimeout(
      shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="utility-panel-dock-right"]')?.click(); true`),
      5000,
      'dock_run_utility_right',
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=context-drawer]')?.getAttribute('data-drawer-dock') === 'right'");
    const rightDrawer = await capture(shellView, 'r95c-run-utility-right-1440x960');
    assertBaseMetrics(rightDrawer);
    const drawerWidth = Math.round(rightDrawer.metrics?.context_drawer?.width || 0);
    if (drawerWidth < 320 || drawerWidth > 520) throw new Error(`r95c_visual_right_drawer_width:${drawerWidth}`);
    if (Math.round(rightDrawer.metrics?.context_drawer?.height || 0) <= drawerHeight) {
      throw new Error(`r95c_visual_right_drawer_not_vertical:${JSON.stringify(rightDrawer.metrics?.context_drawer)}`);
    }
    const rightBody = rightDrawer.metrics?.utility_panel_body;
    if (!rightBody || Math.round(rightBody.width || 0) < drawerWidth - 16 || Math.round(rightBody.height || 0) < 300) {
      throw new Error(`r95c_visual_right_drawer_body_missing:${JSON.stringify(rightBody)}`);
    }
    const rightControlsVisible = await shellView.webContents.executeJavaScript(`(() => {
      const tab = document.querySelector('[data-testid="context-drawer"] [role="tab"]');
      const dock = document.querySelector('[data-testid="utility-panel-dock-bottom"]');
      if (!tab || !dock) return false;
      const a = tab.getBoundingClientRect();
      const b = dock.getBoundingClientRect();
      return a.width > 20 && a.height > 10 && b.width > 20 && b.height > 10;
    })()`);
    if (rightControlsVisible !== true) throw new Error('r95c_visual_right_drawer_controls_not_visible');

    markPhase('CLOSE_RUN_UTILITY');
    await withTimeout(
      shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="context-drawer-toggle"]')?.click(); true`),
      5000,
      'close_run_utility',
    );
    await waitFor(shellView.webContents, "!document.querySelector('[data-testid=context-drawer]')");

    markPhase('NAVIGATE_OBSERVE');
    await withTimeout(
      shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="workflow-stage-observe"]')?.click(); true`),
      5000,
      'navigate_observe',
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-observability]')");
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=evidence-timeline]')");
    const evidenceTimeline = await capture(shellView, 'r95e-observe-evidence-1440x960');
    assertBaseMetrics(evidenceTimeline);
    if (evidenceTimeline.metrics.context_drawer != null) throw new Error('r95e_visual_observe_drawer_should_be_closed');

    const evidence = Object.freeze({
      schema: 'metaengine.browser.r85-visual-evidence.v1',
      source_head: process.env.ME2_BUILD_SHA || null,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      captures: Object.freeze([closed, drawer, rightDrawer, evidenceTimeline]),
      primary_me2_ui_captured: true,
      legacy_shell_captured: false,
      remote_browser_content_captured: false,
      remote_browser_transport_blocked: blockedRemoteBrowserPorts.has('3042') && blockedRemoteBrowserPorts.has('3043'),
      blocked_remote_browser_ports: Object.freeze([...blockedRemoteBrowserPorts].sort()),
      closed_overlays_absent_from_dom: true,
      r85_geometry_verified: true,
      drawer_interaction_verified: true,
      mission_control_verified: true,
      run_surface_verified: true,
      utility_panel_bottom_verified: true,
      utility_panel_right_verified: true,
      evidence_timeline_verified: true,
      evidence_binding_fail_closed: evidenceTimeline.metrics.evidence_binding_mode === 'UNBOUND' || evidenceTimeline.metrics.evidence_binding_mode === 'EXACT_TASK_ID',
      broken_image_fallback_hidden: true,
      visual_golden_comparison_enabled: false,
      presentation_only: true,
      authority_effect: false,
    });
    await fs.writeFile(path.join(OUTPUT_ROOT, 'r85-visual-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence));
  } finally {
    markPhase('SHUTDOWN');
    try { shellView.webContents.session.webRequest.onBeforeRequest(null); } catch {}
    try { shellView.webContents.close(); } catch {}
    try { windowRef.destroy(); } catch {}
    try { stopMe2UiGateway(); } catch {}
    try { await withTimeout(stopMe2UiHostAndWait({ graceMs: 2500, forceMs: 2500 }), 7000, 'stop_ui_host'); } catch {}
    clearTimeout(watchdog);
    app.exit(0);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r85-visual-evidence.v1',
    ok: false,
    error: String(error?.stack || error),
    authority_effect: false,
  }));
  app.exit(1);
});
