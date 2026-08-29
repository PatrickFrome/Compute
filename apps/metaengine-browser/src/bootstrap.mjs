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

async function writeStartupReceipt({ startupError = null } = {}) {
  await app.whenReady();
  const windows = BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
  for (const win of windows) {
    try { win.show(); } catch {}
  }
  try { windows[0]?.focus(); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));

  const visible = windows.filter((win) => {
    try { return win.isVisible(); } catch { return false; }
  });
  const receipt = {
    schema: 'metaengine.browser.startup-receipt.v1',
    version: app.getVersion(),
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

  const targets = new Set([
    path.join(app.getPath('userData'), 'metaengine-startup-receipt.json'),
    process.env.METAENGINE_STARTUP_RECEIPT || '',
  ].filter(Boolean));
  for (const target of targets) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error('metaengine-startup-receipt-write-failed', safeMessage(error));
    }
  }
  console.log(`METAENGINE_STARTUP_RECEIPT ${JSON.stringify(receipt)}`);
  return receipt;
}

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

const receipt = await writeStartupReceipt({ startupError });
if (receipt.window_count === 0 && startupError) app.exit(1);
