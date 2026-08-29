import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Packaged builds must never depend on remote network success to make the
// application window visible. The browser-policy module consumes this marker
// exactly once and rewrites only the first ChatGPT boot navigation to
// about:blank. User-initiated ChatGPT navigation remains unchanged afterwards.
if (app.isPackaged) process.env.METAENGINE_PACKAGED_BOOT_SAFE = '1';

try {
  await import('./main.mjs');
} catch (error) {
  const message = String(error?.stack || error?.message || error || 'unknown_startup_error').slice(0, 4000);
  console.error('metaengine-packaged-startup-failed', message);
  try {
    await app.whenReady();
    const target = path.join(app.getPath('userData'), 'metaengine-startup-error.log');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${new Date().toISOString()}\n${message}\n`, { mode: 0o600 });
  } catch {}
  // If main.mjs already created a shell window before a non-fatal remote load
  // rejected, do not force-kill the process here. Otherwise the normal Electron
  // lifecycle will terminate once no windows remain.
}
