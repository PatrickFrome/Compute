import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('maintenance completion creates a real DevOS idle turn instead of a same-pass waiter', () => {
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
    'start-time cooldown can immediately re-admit another long maintenance pass',
  );

  const cycleBegin = coreSource.lastIndexOf('async cycle()');
  assert.ok(cycleBegin >= 0, 'core cycle missing');
  const cycle = coreSource.slice(cycleBegin);
  assert.match(
    cycle,
    /last_batch_count[\s\S]*maintenance_in_flight\s*!==\s*true[\s\S]*this\.#kickIdleWork\(\)/,
    'DevOS must be admitted only on an empty turn where base maintenance is already settled',
  );
  assert.match(
    coreSource,
    /this\.#kickWorkerObservation\(\);[\s\S]*maintenance_in_flight === true[\s\S]*this\.#idleWorkLastError\s*=\s*null;[\s\S]*return;/,
    'previously admitted maintenance must defer the task turn without awaiting advisory capture',
  );
  assert.match(maintenance, /if \(this\.canStartMaintenance\(\) !== true\) return this\.#maintenancePromise;/, 'maintenance cannot start over an admitted task turn');
  assert.match(coreSource, /canStartMaintenance\(\)[\s\S]*this\.#idleWorkPromise == null && super\.canStartMaintenance\(\)/, 'task turn owns the local mutation slot until settlement');
  assert.doesNotMatch(
    coreSource,
    /native_supervisor_idle_maintenance_wait_timeout|IDLE_MAINTENANCE_WAIT_MAX_MS|#waitForBaseMaintenanceIdle/,
    'R82 must not reintroduce a polling timeout between maintenance and DevOS admission',
  );
});
