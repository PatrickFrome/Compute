import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  browserGuardianStatusObserverContract,
  createBrowserGuardianStatusObserver,
} from '../src/browser-guardian-status-observer.mjs';
import {
  mergeHostResilienceGuardianObservation,
} from '../src/native-supervisor-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function guardianStatus(state = 'READY', reason = 'GUARDIAN_OWNER_AND_DEVICE_BOUND') {
  const ready = state === 'READY';
  const enrollment = state === 'OWNER_ENROLLMENT_REQUIRED';
  const activation = state === 'ACTIVATION_REQUIRED';
  const serviceReady = ready || enrollment || state === 'AMBIGUOUS';
  return Object.freeze({
    schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state,
    reason,
    ready,
    guardian_service_ready: serviceReady,
    owner_binding_proven: ready,
    device_binding_proven: ready,
    explicit_user_action_required: !ready,
    uac_consent_required: activation,
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
  assert.equal(a.observation_revision, 1);
  assert.equal(b.observation_revision, 1);
  assert.equal(a.owner_binding_proven, true);
  assert.equal(a.device_binding_proven, true);
});

test('expired READY fails closed and moves positive proof to historical fields', () => {
  let nowMs = 1_000;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => guardianStatus(),
    ttlMs: 10_000,
    now: () => nowMs,
  });

  const fresh = observer.record(guardianStatus());
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.observation_revision, 1);
  assert.equal(fresh.owner_binding_proven, true);

  nowMs = 11_001;
  const stale = observer.snapshot();
  assert.equal(stale.state, 'HOLD');
  assert.equal(stale.reason, 'GUARDIAN_OBSERVATION_STALE');
  assert.equal(stale.last_confirmed_state, 'READY');
  assert.equal(stale.ready, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.guardian_service_ready, false);
  assert.equal(stale.owner_binding_proven, false);
  assert.equal(stale.device_binding_proven, false);
  assert.equal(stale.explicit_user_action_required, true);
  assert.equal(stale.uac_consent_required, false);
  assert.equal(stale.last_confirmed_guardian_service_ready, true);
  assert.equal(stale.last_confirmed_owner_binding_proven, true);
  assert.equal(stale.last_confirmed_device_binding_proven, true);
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
  assert.equal(invalidated.reason, 'GUARDIAN_ACTIVATION_STARTED');
  assert.equal(invalidated.stale, true);

  release(guardianStatus('READY'));
  await oldRead;
  const afterLate = observer.snapshot();
  assert.equal(afterLate.state, 'HOLD');
  assert.equal(afterLate.reason, 'GUARDIAN_ACTIVATION_STARTED');
  assert.equal(afterLate.observation_revision, 0);
  assert.equal(afterLate.owner_binding_proven, false);
  assert.equal(afterLate.device_binding_proven, false);

  const enrolled = observer.record(guardianStatus(
    'OWNER_ENROLLMENT_REQUIRED',
    'GUARDIAN_SERVICE_READY_OWNER_BINDING_REQUIRED',
  ));
  assert.equal(enrolled.state, 'OWNER_ENROLLMENT_REQUIRED');
  assert.equal(enrolled.stale, false);
  assert.equal(enrolled.observation_revision, 1);
});

test('invalidation clears an already cached current proof but retains bounded history', () => {
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => guardianStatus(),
  });
  const ready = observer.record(guardianStatus());
  assert.equal(ready.owner_binding_proven, true);

  const invalidated = observer.invalidate('GUARDIAN_ACTIVATION_STARTED');
  assert.equal(invalidated.state, 'HOLD');
  assert.equal(invalidated.reason, 'GUARDIAN_ACTIVATION_STARTED');
  assert.equal(invalidated.guardian_service_ready, false);
  assert.equal(invalidated.owner_binding_proven, false);
  assert.equal(invalidated.device_binding_proven, false);
  assert.equal(invalidated.last_confirmed_state, 'READY');
  assert.equal(invalidated.last_confirmed_owner_binding_proven, true);
  assert.equal(invalidated.last_confirmed_device_binding_proven, true);
  assert.equal(invalidated.observation_revision, 1);
});

test('hung, malformed, or false-positive Guardian observations cannot become positive', async () => {
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

  const falseReady = createBrowserGuardianStatusObserver({
    readStatus: async () => ({
      ...guardianStatus('READY'),
      owner_binding_proven: false,
      device_binding_proven: false,
    }),
  });
  const rejectedReady = await falseReady.observe({ force: true });
  assert.equal(rejectedReady.state, 'HOLD');
  assert.equal(rejectedReady.owner_binding_proven, false);
  assert.equal(rejectedReady.device_binding_proven, false);
  assert.match(String(rejectedReady.observation_error), /ready_proof_invalid/);

  const contradictoryNonReady = createBrowserGuardianStatusObserver({
    readStatus: async () => ({
      ...guardianStatus('HOLD', 'TEST_HOLD'),
      owner_binding_proven: true,
    }),
  });
  const rejectedNonReady = await contradictoryNonReady.observe({ force: true });
  assert.equal(rejectedNonReady.state, 'HOLD');
  assert.match(String(rejectedNonReady.observation_error), /nonready_proof_invalid/);
});

test('failed background Guardian reads back off for one TTL without weakening fail-closed state', async () => {
  let nowMs = 10_000;
  let calls = 0;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => {
      calls += 1;
      throw Object.assign(new Error('guardian_update_actuator_pipe_error:connect EPERM'), { code: 'GUARDIAN_PIPE_IO_ERROR' });
    },
    ttlMs: 10_000,
    now: () => nowMs,
  });

  const first = await observer.observe();
  assert.equal(calls, 1);
  assert.equal(first.state, 'HOLD');
  assert.equal(first.ready, false);
  assert.equal(first.owner_binding_proven, false);
  assert.equal(first.device_binding_proven, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.match(String(first.observation_error), /connect EPERM/);
  assert.equal(first.observation_retry_not_before, new Date(20_000).toISOString());

  // Native heartbeat/status projection may run every 2s, but the expensive
  // failing pipe/bootstrap observation is not re-entered during the backoff.
  for (let i = 0; i < 4; i += 1) {
    nowMs += 2_000;
    assert.equal(observer.refreshIfDue(), false);
    const projected = await observer.observe();
    assert.equal(projected.state, 'HOLD');
  }
  assert.equal(calls, 1);

  // An explicit operator status request still performs one fresh bounded read.
  await observer.observe({ force: true });
  assert.equal(calls, 2);
  assert.equal(observer.snapshot().automatic_retry_allowed, false);

  // After the latest failed read's TTL expires, one background refresh may run.
  nowMs += 10_001;
  assert.equal(observer.refreshIfDue(), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 3);
  assert.equal(observer.refreshIfDue(), false);
});

test('Guardian observer contract exposes bounded failed-read backoff without retry authority', () => {
  const contract = browserGuardianStatusObserverContract();
  assert.equal(contract.failed_background_read_backoff_ms, 10_000);
  assert.equal(contract.forced_operator_read_bypasses_background_backoff, true);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});

test('accepted Guardian reads advance revision while cached reads and invalidation do not', async () => {
  let calls = 0;
  const observer = createBrowserGuardianStatusObserver({
    readStatus: async () => {
      calls += 1;
      return guardianStatus(calls === 1 ? 'READY' : 'OWNER_ENROLLMENT_REQUIRED',
        calls === 1 ? 'GUARDIAN_OWNER_AND_DEVICE_BOUND' : 'GUARDIAN_SERVICE_READY_OWNER_BINDING_REQUIRED');
    },
  });

  const first = await observer.observe({ force: true });
  assert.equal(first.observation_revision, 1);
  const cached = await observer.observe();
  assert.equal(cached.observation_revision, 1);
  assert.equal(calls, 1);

  const invalidated = observer.invalidate('TEST_INVALIDATION');
  assert.equal(invalidated.observation_revision, 1);

  const second = await observer.observe({ force: true });
  assert.equal(second.observation_revision, 2);
  assert.equal(second.state, 'OWNER_ENROLLMENT_REQUIRED');
  assert.equal(calls, 2);
});

test('host resilience merge preserves fresh Guardian diagnostic without changing authority', () => {
  const host = Object.freeze({
    schema: 'metaengine.browser.host-resilience.v1',
    state: 'RUNNING',
    sentinel_ready: true,
    authority_effect: false,
  });
  const ready = guardianStatus();
  const merged = mergeHostResilienceGuardianObservation(host, { guardian: ready });
  assert.equal(merged.state, 'RUNNING');
  assert.equal(merged.sentinel_ready, true);
  assert.deepEqual(merged.guardian, ready);
  assert.equal(merged.authority_effect, false);

  const nested = mergeHostResilienceGuardianObservation(host, {
    host_resilience: { guardian: guardianStatus('HOLD', 'GUARDIAN_OBSERVATION_STALE') },
  });
  assert.equal(nested.guardian.state, 'HOLD');
  assert.equal(nested.guardian.reason, 'GUARDIAN_OBSERVATION_STALE');

  const absent = mergeHostResilienceGuardianObservation(host, {});
  assert.equal(absent.guardian, null);
  assert.equal(absent.state, 'RUNNING');
});

test('product wiring uses the same host-resilience merge in heartbeat and realtime paths without Edge drift', () => {
  const main = fs.readFileSync(path.join(APP_ROOT, 'src', 'main.mjs'), 'utf8');
  const nativeSupervisor = fs.readFileSync(path.join(APP_ROOT, 'src', 'native-supervisor-client.mjs'), 'utf8');
  const edge = fs.readFileSync(path.join(APP_ROOT, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');

  assert.match(main, /createBrowserGuardianStatusObserver/);
  assert.match(main, /guardianObserver\.refreshIfDue\(\)/);
  assert.match(main, /host_resilience:\s*\{[\s\S]{0,420}guardian,/);
  assert.match(main, /guardian-status'[\s\S]{0,240}observe\(\{ force: true \}\)/);
  assert.match(main, /invalidate\('GUARDIAN_ACTIVATION_STARTED'\)[\s\S]{0,240}quiesce\(\)[\s\S]{0,320}observer\.record\(result\)/);

  const mergeCalls = nativeSupervisor.match(/mergeHostResilienceGuardianObservation\(hostResilienceSnapshot\(\), sourceState\)/g) || [];
  assert.equal(mergeCalls.length, 2);
  assert.match(nativeSupervisor, /const getStateWithHostResilience[\s\S]{0,700}const sourceState = await sourceGetState\(\)/);
  assert.match(nativeSupervisor, /#pushRealtimeState\(\)[\s\S]{0,5000}host_resilience:\s*mergeHostResilienceGuardianObservation/);

  // R83 canary equivalence must remain deploy/readback-gated. This slice reuses
  // the already-qualified host_resilience plane instead of silently advancing
  // Edge source or its manifest pin.
  assert.doesNotMatch(edge, /'host_resilience','guardian','realtime_process_plane'/);
  assert.match(edge, /'host_resilience','realtime_process_plane'/);
});
