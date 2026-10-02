import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createBrowserGuardianStatusObserver,
} from '../src/browser-guardian-status-observer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function guardianStatus(state = 'READY', reason = 'GUARDIAN_OWNER_AND_DEVICE_BOUND') {
  return Object.freeze({
    schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state,
    reason,
    ready: state === 'READY',
    explicit_user_action_required: state !== 'READY',
    uac_consent_required: state === 'ACTIVATION_REQUIRED',
    fixed_packaged_bootstrap: true,
    caller_supplied_path_used: false,
    caller_supplied_arguments_used: false,
    arbitrary_shell_used: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

test('shared Guardian observer coalesces concurrent Settings and heartbeat reads', async () => {
  let calls = 0;
  let release;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    },
  });

  const settings = observer.observe({ force: true });
  const heartbeat = observer.observe();
  await Promise.resolve();
  assert.equal(calls, 1);
  release(guardianStatus());
  const [a, b] = await Promise.all([settings, heartbeat]);
  assert.equal(a.state, 'READY');
  assert.equal(b.state, 'READY');
  assert.equal(a.stale, false);
  assert.equal(b.stale, false);
});

test('expired READY observation fails closed instead of remaining green', () => {
  let nowMs = 1_000;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => guardianStatus(),
    ttlMs: 10_000,
    now: () => nowMs,
  });

  const fresh = observer.record(guardianStatus());
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.stale, false);

  nowMs = 11_001;
  const stale = observer.snapshot();
  assert.equal(stale.state, 'HOLD');
  assert.equal(stale.reason, 'GUARDIAN_OBSERVATION_STALE');
  assert.equal(stale.last_confirmed_state, 'READY');
  assert.equal(stale.ready, false);
  assert.equal(stale.stale, true);
});

test('activation generation invalidation discards a late prior READY read', async () => {
  let release;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: () => new Promise((resolve) => { release = resolve; }),
  });

  const oldRead = observer.observe({ force: true });
  await Promise.resolve();
  const invalidated = observer.invalidate('GUARDIAN_ACTIVATION_STARTED');
  assert.equal(invalidated.state, 'HOLD');
  assert.equal(invalidated.stale, true);

  release(guardianStatus('READY'));
  await oldRead;
  const afterLate = observer.snapshot();
  assert.equal(afterLate.state, 'HOLD');
  assert.equal(afterLate.reason, 'GUARDIAN_ACTIVATION_STARTED');

  const enrolled = observer.record(guardianStatus(
    'OWNER_ENROLLMENT_REQUIRED',
    'GUARDIAN_SERVICE_READY_OWNER_BINDING_REQUIRED',
  ));
  assert.equal(enrolled.state, 'OWNER_ENROLLMENT_REQUIRED');
  assert.equal(enrolled.stale, false);
});

test('hung or malformed Guardian observation cannot become positive', async () => {
  let fireDeadline;
  const hung = createBrowserGuardianStatusObserver({
    readStatus: () => new Promise(() => {}),
    setTimeoutImpl: (callback) => { fireDeadline = callback; return 1; },
    clearTimeoutImpl: () => {},
  });
  const pending = hung.observe({ force: true });
  fireDeadline();
  const timedOut = await pending;
  assert.equal(timedOut.state, 'HOLD');
  assert.equal(timedOut.reason, 'GUARDIAN_OBSERVATION_FAILED');
  assert.match(String(timedOut.observation_error), /guardian_status_observation_deadline/);

  const malformed = createBrowserGuardianStatusObserver({
    readStatus: async () => ({ schema: 'wrong', state: 'READY' }),
  });
  const bad = await malformed.observe({ force: true });
  assert.equal(bad.state, 'HOLD');
  assert.equal(bad.reason, 'GUARDIAN_OBSERVATION_FAILED');
  assert.match(String(bad.observation_error), /schema_invalid/);
});

test('product wiring publishes Guardian through shared state and Edge preserves the plane', () => {
  const main = fs.readFileSync(path.join(APP_ROOT, 'src', 'main.mjs'), 'utf8');
  const edge = fs.readFileSync(path.join(APP_ROOT, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');

  assert.match(main, /createBrowserGuardianStatusObserver/);
  assert.match(main, /guardianObserver\.refreshIfDue\(\)/);
  assert.match(main, /\n\s*guardian,\n\s*perception,/);
  assert.match(main, /guardian-status'[\s\S]{0,240}observe\(\{ force: true \}\)/);
  assert.match(main, /invalidate\('GUARDIAN_ACTIVATION_STARTED'\)[\s\S]{0,240}quiesce\(\)[\s\S]{0,320}observer\.record\(result\)/);

  assert.match(edge, /PLANE_KEYS=\[[^\]]*'host_resilience','guardian','realtime_process_plane'/);
  assert.match(edge, /if\('guardian'in s\)row\.guardian=boundedObject\(s\.guardian,16384\)/);
});
