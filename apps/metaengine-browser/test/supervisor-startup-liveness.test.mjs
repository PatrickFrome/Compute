import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');

async function read(name) { return fs.readFile(path.join(src, name), 'utf8'); }

test('Browser runtime registers early, waits for host resilience, and retries startup until external stop', async () => {
  const entry = await read('main-entry.mjs');
  const main = await read('main.mjs');
  const barrierAt = entry.indexOf('__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__');
  const mainImportAt = entry.indexOf("import('./main.mjs')", barrierAt);
  const startupInspectionAt = entry.indexOf('inspectSelfUpdateStartup(app)', mainImportAt);
  const watchdogAt = entry.indexOf('startSelfUpdateContinuityWatchdog({', mainImportAt);
  const hostStartAt = entry.indexOf('hostResilience.start()', watchdogAt);
  const releaseAt = entry.indexOf('resolveBrowserBootstrap?.(hostSnapshot)', hostStartAt);
  const mainBarrierAt = main.indexOf('__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__');
  const mainAwaitAt = main.indexOf('await barrier', mainBarrierAt);
  const startupAt = main.indexOf('return startAfterReady()', mainAwaitAt);
  assert.ok(barrierAt >= 0);
  assert.ok(mainImportAt > barrierAt, 'runtime module must see the barrier before it registers app.ready');
  assert.ok(startupInspectionAt > mainImportAt, 'privileged protocol/runtime registration must not be delayed by startup inspection');
  assert.ok(watchdogAt > mainImportAt);
  assert.ok(hostStartAt > watchdogAt, 'continuity watchdog must be armed before host bootstrap can block');
  assert.ok(releaseAt > hostStartAt, 'Browser start barrier may release only after host bootstrap returns');
  assert.ok(mainBarrierAt >= 0 && mainAwaitAt > mainBarrierAt && startupAt > mainAwaitAt);

  assert.match(main, /const STARTUP_RETRY_BASE_MS = 1000/);
  assert.match(main, /const STARTUP_RETRY_MAX_MS = 30000/);
  assert.match(main, /function scheduleBrowserRuntimeRetry\(error\)/);
  assert.match(main, /if \(shutdownRequested \|\| isSmoke \|\| isDevelopmentPlaneSmoke \|\| startupRetryTimer\) return/);
  assert.match(main, /Math\.min\(STARTUP_RETRY_MAX_MS, STARTUP_RETRY_BASE_MS \* \(2 \*\* Math\.min\(8, startupRetryAttempt - 1\)\)\)/);
  assert.match(main, /void presentBrowserStartupFailure\(error\);[\s\S]*scheduleBrowserRuntimeRetry\(error\)/);
  assert.doesNotMatch(main, /startupRetryTimer\.unref/);
  assert.match(main, /timer_keeps_process_alive: true/);
  assert.match(main, /if \(recover\) scheduleBrowserRuntimeRetry\(new Error\('browser_window_closed_unexpectedly'\)\)/);
  assert.match(main, /if \(app\.isReady\(\)\) queueMicrotask\(\(\) => \{ void startBrowserRuntime\(\); \}\)/);
  assert.match(main, /else app\.once\('ready', \(\) => \{ void startBrowserRuntime\(\); \}\)/);
  assert.match(main, /terminal_requires_external_stop: true/);
  assert.match(main, /local_shell_is_startup_boundary: true/);
  assert.match(main, /remote_network_is_startup_boundary: false/);
});

test('watchdog recovery quarantines durable continuity before relaunch and has no browser replay authority', async () => {
  const source = await read('self-update-continuity-watchdog.mjs');
  const targetFenceAt = source.indexOf("String(row.target_version) !== String(currentVersion)");
  const quarantineAt = source.indexOf('await quarantineSelfUpdateSessionContinuity', targetFenceAt);
  const relaunchAt = source.indexOf('relaunch();', quarantineAt);
  const exitAt = source.indexOf('exit(18);', relaunchAt);
  assert.ok(targetFenceAt >= 0);
  assert.ok(quarantineAt > targetFenceAt);
  assert.ok(relaunchAt > quarantineAt);
  assert.ok(exitAt > relaunchAt);
  assert.ok(source.includes('blind_retry: false'));
  assert.ok(source.includes('page_authority: false'));
  assert.ok(source.includes('authority_effect: false'));
});
