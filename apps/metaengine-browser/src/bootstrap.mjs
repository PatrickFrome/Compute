import { app, BaseWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Packaged builds must never depend on remote network success to make the
// application window visible. The browser-policy module consumes this marker
// exactly once and rewrites only the first ChatGPT boot navigation to
// about:blank. User-initiated ChatGPT navigation remains unchanged afterwards.
if (app.isPackaged) process.env.METAENGINE_PACKAGED_BOOT_SAFE = '1';

function safeMessage(error) {
  return String(error?.stack || error?.message || error || 'unknown_startup_error').slice(0, 4000);
}

function receiptTargets() {
  const targets = [];
  try { targets.push(path.join(app.getPath('userData'), 'metaengine-startup-receipt.json')); } catch {}
  if (process.env.METAENGINE_STARTUP_RECEIPT) targets.push(process.env.METAENGINE_STARTUP_RECEIPT);
  return [...new Set(targets.filter(Boolean))];
}

async function persistReceipt(receipt) {
  for (const target of receiptTargets()) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error('metaengine-startup-receipt-write-failed', safeMessage(error));
    }
  }
  console.log(`METAENGINE_STARTUP_RECEIPT ${JSON.stringify(receipt)}`);
}

async function observeWindows(stage, startupError = null) {
  const windows = BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
  for (const win of windows) {
    try { win.show(); } catch {}
  }
  try { windows[0]?.focus(); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
  const visible = windows.filter((win) => {
    try { return win.isVisible(); } catch { return false; }
  });
  const receipt = {
    schema: 'metaengine.browser.startup-receipt.v1',
    version: app.getVersion(),
    stage,
    status: startupError ? 'DEGRADED' : (visible.length > 0 ? 'READY' : 'WINDOW_NOT_VISIBLE'),
    app_packaged: app.isPackaged,
    window_count: windows.length,
    visible_window_count: visible.length,
    window_visible: visible.length > 0,
    focused_window_present: Boolean(BaseWindow.getFocusedWindow()),
    startup_error: startupError ? safeMessage(startupError) : null,
    observed_at: new Date().toISOString(),
    authority_effect: false,
  };
  await persistReceipt(receipt);
  return receipt;
}

// This watchdog is intentionally independent of main.mjs completion. A browser
// window must become visible even if a non-UI subsystem stalls during startup.
const visibilityWatchdog = (async () => {
  await app.whenReady();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const windows = BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
    if (windows.length > 0) {
      return observeWindows('WINDOW_CREATED_WATCHDOG');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return observeWindows('WINDOW_CREATION_TIMEOUT');
})().catch((error) => {
  console.error('metaengine-visibility-watchdog-failed', safeMessage(error));
  return null;
});

let startupError = null;
try {
  await import('./main.mjs');
} catch (error) {
  startupError = error;
  const message = safeMessage(error);
  console.error('metaengine-packaged-startup-failed', message);
  try {
    await app.whenReady();
    const target = path.join(app.getPath('userData'), 'metaengine-startup-error.log');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${new Date().toISOString()}\n${message}\n`, { mode: 0o600 });
  } catch {}
}

await app.whenReady();
const watchdogReceipt = await visibilityWatchdog;
const finalReceipt = await observeWindows('MAIN_IMPORT_SETTLED', startupError);
if (finalReceipt.window_count === 0 && startupError && !watchdogReceipt?.window_visible) app.exit(1);
