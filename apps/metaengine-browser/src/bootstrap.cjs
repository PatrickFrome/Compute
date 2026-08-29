const { app, BaseWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (app.isPackaged) process.env.METAENGINE_PACKAGED_BOOT_SAFE = '1';

function safeMessage(error) {
  return String(error?.stack || error?.message || error || 'unknown_startup_error').slice(0, 4000);
}

function envReceiptTarget() {
  return String(process.env.METAENGINE_STARTUP_RECEIPT || '').trim();
}

function writeJsonAtomic(target, value) {
  if (!target) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (error) {
    console.error('metaengine-startup-receipt-write-failed', safeMessage(error));
  }
}

function buildReceipt(stage, extra = {}) {
  let windows = [];
  try { windows = BaseWindow.getAllWindows().filter((win) => !win.isDestroyed()); } catch {}
  const visible = windows.filter((win) => {
    try { return win.isVisible(); } catch { return false; }
  });
  return {
    schema: 'metaengine.browser.startup-receipt.v1',
    version: (() => { try { return app.getVersion(); } catch { return null; } })(),
    stage,
    status: extra.status || (visible.length > 0 ? 'READY' : 'STARTING'),
    app_packaged: app.isPackaged,
    pid: process.pid,
    window_count: windows.length,
    visible_window_count: visible.length,
    window_visible: visible.length > 0,
    startup_error: extra.startup_error || null,
    observed_at: new Date().toISOString(),
    authority_effect: false,
  };
}

function persist(stage, extra = {}) {
  const receipt = buildReceipt(stage, extra);
  const envTarget = envReceiptTarget();
  if (envTarget) writeJsonAtomic(envTarget, receipt);
  if (app.isReady()) {
    try { writeJsonAtomic(path.join(app.getPath('userData'), 'metaengine-startup-receipt.json'), receipt); } catch {}
  }
  console.log(`METAENGINE_STARTUP_RECEIPT ${JSON.stringify(receipt)}`);
  return receipt;
}

// Proves that the packaged Electron main entrypoint itself executed, before
// app readiness, custom protocols, remote navigation, fleet, or Development Plane.
persist('CJS_BOOTSTRAP_ENTERED', { status: 'STARTING' });

let settled = false;
app.whenReady().then(() => {
  persist('APP_READY', { status: 'STARTING' });
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const windows = BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
    for (const win of windows) {
      try { win.show(); } catch {}
    }
    try { windows[0]?.focus(); } catch {}
    const visible = windows.some((win) => {
      try { return win.isVisible(); } catch { return false; }
    });
    if (visible) {
      clearInterval(timer);
      persist('WINDOW_VISIBLE_WATCHDOG', { status: 'READY' });
    } else if (attempts >= 80) {
      clearInterval(timer);
      persist('WINDOW_CREATION_TIMEOUT', { status: 'WINDOW_NOT_VISIBLE' });
    }
  }, 250);
}).catch((error) => {
  persist('APP_READY_FAILED', { status: 'FAILED', startup_error: safeMessage(error) });
});

import('./main.mjs').then(() => {
  settled = true;
  const receipt = persist('MAIN_IMPORT_SETTLED');
  if (receipt.window_visible) persist('MAIN_IMPORT_SETTLED_VISIBLE', { status: 'READY' });
}).catch((error) => {
  settled = true;
  persist('MAIN_IMPORT_FAILED', { status: 'FAILED', startup_error: safeMessage(error) });
  console.error('metaengine-main-import-failed', safeMessage(error));
});

process.on('exit', () => {
  if (!settled) persist('PROCESS_EXIT_BEFORE_MAIN_SETTLED', { status: 'FAILED' });
});
