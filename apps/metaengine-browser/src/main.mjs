import { app, BaseWindow, WebContentsView, ipcMain, protocol, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBridgeClient } from './compute-bridge-client.mjs';
import { navigationDecision, newWindowDecision, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from './browser-policy.mjs';
import { TabRegistry } from './tab-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const TOOLBAR_HEIGHT = 92;
const isSmoke = process.argv.includes('--metaengine-smoke');

protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const registry = new TabRegistry();
const views = new Map();
const bridge = new ComputeBridgeClient();
let windowRef = null;
let shellView = null;
let userSession = null;

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
  userSession.on('will-download', (event) => event.preventDefault());
}

function assertShellSender(event) {
  if (!shellView || event.sender.id !== shellView.webContents.id) throw new Error('shell_sender_not_trusted');
}

async function shellSnapshot() {
  return {
    schema: 'metaengine.browser-shell.snapshot.v1',
    version: '0.1.0',
    tabs: registry.snapshot(),
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
    publishSnapshot().catch(() => {});
  };
  view.webContents.on('did-navigate', sync);
  view.webContents.on('did-navigate-in-page', sync);
  view.webContents.on('page-title-updated', sync);
  view.webContents.on('render-process-gone', () => publishSnapshot().catch(() => {}));
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
  if (load && !isSmoke) await view.webContents.loadURL(d.normalized_url);
  await publishSnapshot();
  return tab;
}

async function closeTab(tabId) {
  const view = views.get(tabId);
  if (view) {
    try { windowRef?.contentView.removeChildView(view); } catch {}
    views.delete(tabId);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  registry.close(tabId);
  if (!registry.selected()) await createTab('https://chatgpt.com/', { select: true, load: !isSmoke });
  attachSelected();
  await publishSnapshot();
}

async function handleCommand(command, payload = {}) {
  const selected = registry.selected();
  const selectedView = selected ? views.get(selected.tab_id) : null;
  if (command === 'NEW_CHATGPT') return createTab('https://chatgpt.com/', { select: true, load: !isSmoke });
  if (command === 'NEW_TAB') return createTab('https://chatgpt.com/', { select: true, load: !isSmoke });
  if (command === 'SELECT_TAB') { registry.select(payload?.tab_id); attachSelected(); await publishSnapshot(); return { ok: true }; }
  if (command === 'CLOSE_TAB') { await closeTab(payload?.tab_id); return { ok: true }; }
  if (command === 'NAVIGATE') {
    if (!selectedView) throw new Error('no_selected_tab');
    const d = navigationDecision(payload?.url);
    if (!d.allow) throw new Error(`navigation_blocked:${d.reason}`);
    if (!isSmoke) await selectedView.webContents.loadURL(d.normalized_url);
    registry.update(selected.tab_id, { url: d.normalized_url, kind: d.kind });
    await publishSnapshot();
    return { ok: true };
  }
  if (command === 'BACK') { if (selectedView?.webContents.navigationHistory.canGoBack()) selectedView.webContents.navigationHistory.goBack(); return { ok: true }; }
  if (command === 'FORWARD') { if (selectedView?.webContents.navigationHistory.canGoForward()) selectedView.webContents.navigationHistory.goForward(); return { ok: true }; }
  if (command === 'RELOAD') { selectedView?.webContents.reload(); return { ok: true }; }
  if (command === 'COMPUTE_HEALTH') return bridge.health();
  throw new Error('shell_command_unknown');
}

async function createWindow() {
  windowRef = new BaseWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 640, title: 'METAENGINE Browser', backgroundColor: '#101216' });
  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload-shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  windowRef.contentView.addChildView(shellView);
  windowRef.on('resize', layout);
  windowRef.on('closed', () => {
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    views.clear();
    if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.close();
    shellView = null;
    windowRef = null;
  });
  await shellView.webContents.loadURL('metaengine://shell/');
  await createTab('https://chatgpt.com/', { select: true, load: !isSmoke });
  layout();
  if (isSmoke) {
    const snap = await shellSnapshot();
    const invariant = userSession.isPersistent() && snap.tabs.tabs.length === 1 && snap.tabs.tabs[0].kind === 'CHATGPT' && snap.policy.cookie_transfer_to_compute_space === false;
    console.log(JSON.stringify({ schema: 'metaengine.browser-shell.smoke.v1', ok: invariant, persistent_user_space: userSession.isPersistent(), chatgpt_tab_created: snap.tabs.tabs[0].kind === 'CHATGPT', remote_node_integration: REMOTE_WEB_PREFERENCES.nodeIntegration, remote_sandbox: REMOTE_WEB_PREFERENCES.sandbox, compute_bridge_read_only: true, authority_effect: false }));
    setTimeout(() => app.quit(), 100).unref();
  }
}

ipcMain.handle('metaengine:shell:snapshot', async (event) => { assertShellSender(event); return shellSnapshot(); });
ipcMain.handle('metaengine:shell:command', async (event, message) => { assertShellSender(event); return handleCommand(String(message?.command || ''), message?.payload || {}); });

await app.whenReady();
await registerShellProtocol();
configureUserSession();
await createWindow();
app.on('activate', () => { if (!windowRef) createWindow().catch((error) => { console.error(error); app.quit(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
