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
process.env.ME2_UI_GATEWAY_PORT = process.env.ME2_UI_GATEWAY_PORT || '39101';
process.env.ME2_ALLOW_EXTERNAL_UI_ADOPT = '0';

app.enableSandbox();
app.commandLine.appendSwitch('disable-gpu');

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function registerPresentationIpc() {
  let page = 'command';
  let overlay = false;
  let railOpen = true;
  let drawerOpen = false;
  let drawerHeight = 200;

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
      native_browser_surface_visible: !overlay && page === 'command',
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
  ipcMain.handle('metaengine:shell:primary-context-drawer', (_event, rawOpen, rawHeight) => {
    drawerOpen = rawOpen === true;
    const requested = Number(rawHeight);
    if (Number.isFinite(requested)) drawerHeight = Math.max(160, Math.min(360, Math.round(requested)));
    return Object.freeze({
      schema: 'metaengine.browser.r85-visual.context-drawer.v1',
      requested_open: drawerOpen,
      requested_height: drawerHeight,
      effective_open: drawerOpen,
      drawer_height: drawerHeight,
      presentation_only: true,
      authority_effect: false,
    });
  });
}

async function waitFor(contents, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await contents.executeJavaScript(\`Boolean(\${expression})\`);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(\`r85_visual_wait_timeout:\${expression}\`);
}

async function settle(contents) {
  await contents.executeJavaScript('document.fonts?.ready ? document.fonts.ready.then(() => true) : true');
  await contents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function metrics(contents) {
  return contents.executeJavaScript(\`(() => {
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
      browser_shell: rect('browser-shell'),
      context_drawer: rect('context-drawer'),
      context_drawer_toggle: Boolean(document.querySelector('[data-testid="context-drawer-toggle"]')),
      sidebar_toggle: Boolean(document.querySelector('[data-testid="cc-sidebar-toggle"]')),
      attention_button: Boolean(document.querySelector('[data-testid="attention-button"]')),
      palette_mounted: Boolean(document.querySelector('[cmdk-root], [data-testid="registry-action-args"], [role="dialog"]')),
      page: document.querySelector('[data-testid="page-outlet"]')?.getAttribute('data-page') || null,
      body_background: getComputedStyle(document.body).backgroundColor,
    };
  })()\`);
}

async function capture(view, name) {
  await settle(view.webContents);
  const image = await view.webContents.capturePage();
  const png = image.toPNG();
  if (png.length < 4096) throw new Error(\`r85_visual_png_too_small:\${name}:\${png.length}\`);
  const file = path.join(OUTPUT_ROOT, \`\${name}.png\`);
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
  if (Math.round(m?.topbar?.height || 0) !== 42) throw new Error(\`r85_visual_topbar_height:\${m?.topbar?.height}\`);
  if (Math.round(m?.pagebar?.height || 0) !== 36) throw new Error(\`r85_visual_pagebar_height:\${m?.pagebar?.height}\`);
  if (Math.round(m?.statusbar?.height || 0) !== 22) throw new Error(\`r85_visual_statusbar_height:\${m?.statusbar?.height}\`);
  if (Math.round(m?.agent_sidebar?.width || 0) !== 252) throw new Error(\`r85_visual_agent_sidebar_width:\${m?.agent_sidebar?.width}\`);
  if (m?.page !== 'command') throw new Error(\`r85_visual_page:\${m?.page}\`);
  if (!m?.context_drawer_toggle || !m?.sidebar_toggle || !m?.attention_button) throw new Error('r85_visual_global_controls_missing');
  if (m?.palette_mounted) throw new Error('r85_visual_closed_overlay_semantic_pollution');
}

async function main() {
  await app.whenReady();
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  registerPresentationIpc();

  const {
    startMe2UiHost,
    stopMe2UiHostAndWait,
  } = await import('../src/me2/me2-ui-host.mjs');
  const {
    startMe2UiGateway,
    stopMe2UiGateway,
  } = await import('../src/me2/me2-ui-gateway.mjs');

  const host = await startMe2UiHost();
  if (!['HEALTHY', 'ADOPTED'].includes(host.state)) {
    throw new Error(\`r85_visual_ui_host_not_ready:\${JSON.stringify(host)}\`);
  }
  const gateway = await startMe2UiGateway();
  if (gateway.state !== 'LIVE' || !gateway.url) {
    throw new Error(\`r85_visual_gateway_not_ready:\${JSON.stringify(gateway)}\`);
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

  try {
    await shellView.webContents.loadURL(\`\${gateway.url}/#command\`);
    shellView.webContents.setZoomFactor(1);
    windowRef.show();

    await waitFor(shellView.webContents, 'document.querySelector(\\'[data-testid="page-command"]\\')');
    await waitFor(shellView.webContents, 'document.querySelector(\\'[data-testid="context-drawer-toggle"]\\')');
    const closed = await capture(shellView, 'r85-command-1440x960');
    assertBaseMetrics(closed);
    if (closed.metrics.context_drawer != null) throw new Error('r85_visual_drawer_should_start_closed');

    await shellView.webContents.executeJavaScript(\`document.querySelector('[data-testid="context-drawer-toggle"]')?.click(); true\`);
    await waitFor(shellView.webContents, 'document.querySelector(\\'[data-testid="context-drawer"]\\')');
    const drawer = await capture(shellView, 'r85-command-drawer-1440x960');
    assertBaseMetrics(drawer);
    const drawerHeight = Math.round(drawer.metrics?.context_drawer?.height || 0);
    if (drawerHeight < 160 || drawerHeight > 360) throw new Error(\`r85_visual_drawer_height:\${drawerHeight}\`);

    const evidence = Object.freeze({
      schema: 'metaengine.browser.r85-visual-evidence.v1',
      source_head: process.env.ME2_BUILD_SHA || null,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      captures: Object.freeze([closed, drawer]),
      primary_me2_ui_captured: true,
      legacy_shell_captured: false,
      remote_browser_content_captured: false,
      closed_overlays_absent_from_dom: true,
      r85_geometry_verified: true,
      drawer_interaction_verified: true,
      visual_golden_comparison_enabled: false,
      presentation_only: true,
      authority_effect: false,
    });
    await fs.writeFile(path.join(OUTPUT_ROOT, 'r85-visual-evidence.json'), \`\${JSON.stringify(evidence, null, 2)}\\n\`);
    console.log(JSON.stringify(evidence));
  } finally {
    try { shellView.webContents.close(); } catch {}
    try { windowRef.destroy(); } catch {}
    try { stopMe2UiGateway(); } catch {}
    try { await stopMe2UiHostAndWait({ graceMs: 2500, forceMs: 2500 }); } catch {}
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
