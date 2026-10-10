import fs from 'node:fs/promises';
import path from 'node:path';

// This is a read-only status surface, NOT an installer or database provisioner.
// Normal startup already automatically reconnects an owner-bound LOCAL_POSTGRES
// runtime when its exact identity and health have been attested.
export async function inspectMissingLocalProvider({ localAppData = process.env.LOCALAPPDATA, read = fs } = {}) {
  if (typeof localAppData !== 'string' || !path.isAbsolute(localAppData) ||
      /^(?:\\\\|\/\/)/.test(localAppData) || /[\x00-\x1f]/.test(localAppData)) {
    return Object.freeze({ state: 'LOCAL_STORAGE_UNAVAILABLE', authority_effect: false });
  }
  const directory = path.join(localAppData, 'METAENGINE', 'restored-postgres-17');
  try {
    const stat = await read.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return Object.freeze({ state: 'PRIVATE_STATE_RECONCILIATION_REQUIRED', authority_effect: false });
    }
    const names = await read.readdir(directory);
    if (names.length) return Object.freeze({ state: 'PRIVATE_STATE_RECONCILIATION_REQUIRED', authority_effect: false });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return Object.freeze({ state: 'LOCAL_STORAGE_UNAVAILABLE', authority_effect: false });
    }
  }
  return Object.freeze({ state: 'FRESH_LOCAL_DATABASE_NOT_PROVISIONED', authority_effect: false });
}

// Keep a strong reference while an Electron window is open. Otherwise GC can
// close the status window after the nonblocking startup preflight returns.
const openBoundaries = new Set();

const recoveryMessages = Object.freeze({
  PRIVATE_STATE_RECONCILIATION_REQUIRED: 'Existing local PostgreSQL files were detected, but there is no verified owner registration. An incomplete restore or initialization must be reconciled before this client can safely connect. The database and Vault were not modified.',
  FRESH_LOCAL_DATABASE_NOT_PROVISIONED: 'This installation does not yet have an owner-bound local PostgreSQL runtime. Fresh automatic provisioning is not qualified in this release. The client has not initialized a database or selected a cloud provider.',
  LOCAL_STORAGE_UNAVAILABLE: 'Local state storage could not be safely inspected. No database was started or changed.',
});

// No form, OS file chooser, IPC handler, external page, credential prompt or
// automatic replay. A separate explicit, reviewed recovery tool may still
// migrate a previously restored PG17 when its independent evidence exists.
export async function showUnprovisionedLocalStateBoundary({
  app, BrowserWindow, env = process.env, inspect = inspectMissingLocalProvider,
} = {}) {
  if (!app?.isPackaged || typeof app.whenReady !== 'function' || typeof BrowserWindow !== 'function') {
    throw new Error('local_provider_boundary_packaged_app_required');
  }
  await app.whenReady();
  const status = await inspect({ localAppData: env.LOCALAPPDATA });
  if (!Object.hasOwn(recoveryMessages, status?.state)) throw new Error('local_provider_boundary_status_invalid');
  const title = 'METAENGINE - Local runtime unavailable';
  const win = new BrowserWindow({
    width: 680, height: 360, minWidth: 540, minHeight: 260, show: false, title,
    autoHideMenuBar: true, backgroundColor: '#101216',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true },
  });
  openBoundaries.add(win);
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const message = recoveryMessages[status.state];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title}</title><style>
body{background:#101216;color:#e8edf4;font:15px system-ui,sans-serif;padding:24px 32px;line-height:1.55}
h1{font-size:22px;margin-bottom:12px}p{max-width:580px}
small{display:block;color:#a8b3c3;margin-top:18px}
</style></head><body><h1>Local runtime unavailable</h1><p>${message}</p>
<small>Automatic reconnection is enabled for verified, registered local runtimes.
No PostgreSQL ownership or execution authority was fabricated.</small></body></html>`;
  // Return after the inert window is displayed, NOT after it is closed:
  // installer-shutdown and singleton handoff must never wait on human input.
  // The Electron window itself stays open independently until closed by user.
  win.on('closed', () => { openBoundaries.delete(win); });
  // Show a trusted inert boundary even when rendering fails; never silently
  // start Browser/main or show the retired restore-selection wizard.
  win.show();
  let timeout;
  try {
    await Promise.race([
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('local_boundary_load_timeout')), 15000); }),
    ]);
    if (!win.isDestroyed()) win.setTitle(title);
  } catch (error) {
    console.error(JSON.stringify({ schema: 'metaengine.browser.local-provider-boundary.v1',
      state: 'BOUNDARY_RENDER_UNCONFIRMED', error: String(error?.message || error).slice(0, 80),
      authority_effect: false }));
  } finally { clearTimeout(timeout); }
  console.log(JSON.stringify({ schema: 'metaengine.browser.local-provider-boundary.v1',
    state: status.state, automatic_cloud_fallback: false, authority_effect: false }));
  return Object.freeze({
    state: status.state, local_runtime_ready: false, owner_profile_written: false,
    automatic_cloud_fallback: false, authority_effect: false,
  });
}
