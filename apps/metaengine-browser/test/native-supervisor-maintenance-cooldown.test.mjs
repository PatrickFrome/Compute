import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('maintenance cooldown starts after maintenance settles so DevOS receives an idle window', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-base.mjs'), 'utf8');
  const coreSource = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-core-base.mjs'), 'utf8');
  const begin = source.indexOf('#kickMaintenance()');
  const end = source.indexOf('async #nextCommand()', begin);
  assert.ok(begin >= 0 && end > begin, 'maintenance source boundary missing');
  const maintenance = source.slice(begin, end);
  const promiseAt = maintenance.indexOf('this.#maintenancePromise = (async () => {');
  const finallyAt = maintenance.indexOf('})().finally(() => {', promiseAt);
  const completionStampAt = maintenance.indexOf('this.#lastMaintenanceAtMs = Date.now()', finallyAt);
  assert.ok(promiseAt >= 0 && finallyAt > promiseAt, 'maintenance promise/finally boundary missing');
  assert.ok(completionStampAt > finallyAt, 'maintenance cooldown must be stamped only after the pass settles');
  assert.doesNotMatch(
    maintenance.slice(0, promiseAt),
    /this\.#lastMaintenanceAtMs\s*=\s*now/,
    'start-time cooldown can immediately re-admit another long maintenance pass and starve DevOS idle work',
  );
  assert.match(coreSource, /const IDLE_MAINTENANCE_WAIT_MAX_MS = 15000;/);
});
