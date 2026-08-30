import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');

async function read(name) { return fs.readFile(path.join(src, name), 'utf8'); }

test('continuity watchdog is armed before long-lived Browser runtime can block native supervisor startup', async () => {
  const entry = await read('main-entry.mjs');
  const watchdogAt = entry.indexOf('startSelfUpdateContinuityWatchdog({');
  const mainAt = entry.indexOf("await import('./main.mjs')", watchdogAt);
  assert.ok(watchdogAt >= 0);
  assert.ok(mainAt > watchdogAt);
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
