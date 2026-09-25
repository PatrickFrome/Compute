/**
 * Window shell — one BrowserWindow, tab surfaces as WebContentsView (Electron 44
 * modern API; BrowserView is long-dead). Roles: MAIN (Mission Control), FLEET
 * (chat.z.ai agents), SUPERVISOR (reserved). Bounds management is explicit.
 */
import { WebContentsView } from 'electron';
import { applyPolicy } from './browser-policy.mjs';
import { TAB_ROLES } from '../shared/me2-constants.mjs';

export function createWindowShell({ BrowserWindow, journal, log = () => {} }) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 360,
    title: 'METAENGINE Desktop',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: { preload: new URL('../preload.cjs', import.meta.url).pathname },
  });
  const views = new Map(); // role -> {view, meta}
  let activeRole = null;

  function bounds() {
    const { width, height } = win.getContentBounds();
    return { x: 0, y: 0, width, height };
  }

  function activate(role) {
    if (!TAB_ROLES.includes(role)) return { ok: false, reason: 'role_invalid' };
    const entry = views.get(role);
    if (!entry) return { ok: false, reason: 'role_absent' };
    for (const [r, v] of views) win.contentView.removeChildView(v.view);
    win.contentView.addChildView(entry.view);
    entry.view.setBounds(bounds());
    activeRole = role;
    entry.view.webContents.focus();
    journal.record('tab_activated', { role });
    return { ok: true, role };
  }

  function addView({ role, url, session }) {
    if (!TAB_ROLES.includes(role)) return { ok: false, reason: 'role_invalid' };
    if (views.has(role)) return { ok: false, reason: 'role_occupied' };
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    applyPolicy({
      webContents: view.webContents,
      mainOrigin: url ? new URL(url).origin : null,
      setWindowOpenHandler: (h) => {
        view.webContents.setWindowOpenHandler(h);
      },
      session: view.webContents.session,
      onBlocked: (detail) => {
        journal.record('navigation_blocked', detail);
        log({ plane: 'window-shell', event: 'blocked', ...detail });
      },
    });
    views.set(role, { view, meta: { url, session } });
    if (url) view.webContents.loadURL(url);
    return { ok: true, role, view };
  }

  function removeView(role) {
    const entry = views.get(role);
    if (!entry) return { ok: false, reason: 'role_absent' };
    win.contentView.removeChildView(entry.view);
    views.delete(role);
    if (activeRole === role) activeRole = null;
    return { ok: true };
  }

  win.on('resize', () => {
    const entry = activeRole && views.get(activeRole);
    if (entry) entry.view.setBounds(bounds());
  });

  return {
    win,
    activate,
    addView,
    removeView,
    activeRole: () => activeRole,
    roles: () => [...views.keys()],
    bounds,
  };
}
