/** One shell, many native conversations. Only Mission Control receives preload. */
import { fileURLToPath } from 'node:url';
import { applyPolicy } from './browser-policy.mjs';
import { TAB_ROLES } from '../shared/me2-constants.mjs';

export function createWindowShell({ BrowserWindow, WebContentsView, journal, log = () => {} }) {
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 480,
    minHeight: 360, title: 'METAENGINE Desktop', backgroundColor: '#09090b',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const views = new Map();
  let activeId = null;
  function bounds() {
    const { width, height } = win.getContentBounds();
    return { x: 0, y: 0, width, height };
  }
  function activate(id) {
    const entry = views.get(id);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: false, reason: 'tab_absent' };
    if (activeId && views.has(activeId)) win.contentView.removeChildView(views.get(activeId).view);
    win.contentView.addChildView(entry.view);
    entry.view.setBounds(bounds());
    activeId = id;
    entry.view.webContents.focus();
    journal.record('tab_activated', { id, role: entry.role });
    return { ok: true, id, role: entry.role };
  }
  function addView({ role, id = role, url }) {
    if (!TAB_ROLES.includes(role)) return { ok: false, reason: 'role_invalid' };
    if (views.has(id)) return { ok: false, reason: 'tab_occupied' };
    const trusted = role === 'MAIN';
    const view = new WebContentsView({ webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: trusted ? 'persist:me2-control' : 'persist:me2-web-agents',
      ...(trusted ? { preload: fileURLToPath(new URL('../preload.cjs', import.meta.url)) } : {}),
    } });
    applyPolicy({ webContents: view.webContents, mainOrigin: trusted && url ? new URL(url).origin : null,
      trusted, setWindowOpenHandler: h => view.webContents.setWindowOpenHandler(h),
      session: view.webContents.session,
      onBlocked: detail => { journal.record('navigation_blocked', detail); log(detail); } });
    views.set(id, { view, role, origin: trusted && url ? new URL(url).origin : null });
    // Caller awaits loading, so success cannot precede the actual navigation.
    return { ok: true, id, role, view };
  }
  function removeView(id) {
    const entry = views.get(id);
    if (!entry) return { ok: false, reason: 'tab_absent' };
    if (activeId === id) win.contentView.removeChildView(entry.view);
    views.delete(id);
    if (activeId === id) { activeId = null; if (id !== 'MAIN') activate('MAIN'); }
    return { ok: true };
  }
  function trustedSender(event) {
    const main = views.get('MAIN');
    if (!main || event.sender !== main.view.webContents || event.sender.isDestroyed() ||
        !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    try { return new URL(event.senderFrame.url).origin === main.origin; } catch { return false; }
  }
  win.on('resize', () => { if (activeId) views.get(activeId)?.view.setBounds(bounds()); });
  win.on('closed', () => {
    for (const { view } of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    views.clear(); activeId = null;
  });
  return { win, activate, addView, removeView, trustedSender, activeRole: () => views.get(activeId)?.role ?? null,
    roles: () => [...views.values()].map(e => e.role), bounds };
}
