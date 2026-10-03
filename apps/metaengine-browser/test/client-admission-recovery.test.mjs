import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ClientAdmissionRecoveryJournal,
  classifyAdmissionRecoveryObservation,
} from '../src/client-admission-recovery-journal.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';

const WORKSPACE = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const READ_REQUEST = '33333333-3333-4333-8333-333333333333';
const OBSERVED_AT = '2026-10-03T20:00:05.000Z';

function state({ floor = 28, open = false, readRequestId = READ_REQUEST, observedAt = OBSERVED_AT } = {}) {
  return {
    schema: 'metaengine.devos.environment-state.v1',
    state: open ? 'OPEN' : 'CLOSED',
    reason: open ? null : 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
    workspace_id: WORKSPACE,
    generation_floor: floor,
    read_request_id: readRequestId,
    observed_at: observedAt,
    refill_enabled: open,
    supervisor_admission_enabled: open,
    continuous_service_allowed: open,
    authoritative: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function memoryJournal(seed = null) {
  let durable = seed == null ? null : structuredClone(seed);
  const journal = new ClientAdmissionRecoveryJournal({
    async loadState() {
      if (durable == null) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return structuredClone(durable);
    },
    async saveState(value) { durable = structuredClone(value); },
  });
  return { journal, snapshot: () => structuredClone(durable) };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); },
  };
}

function identity() {
  return {
    async ensure() { return { device_id: 'device_admission_recovery_test', profile: 'BROWSER_SUPERVISOR' }; },
    snapshot() { return { device_id: 'device_admission_recovery_test', profile: 'BROWSER_SUPERVISOR' }; },
    async deviceHeaders(method, requestPath, bodyText) {
      return {
        'content-type': 'application/json',
        'x-test-method': method,
        'x-test-path': requestPath,
        'x-test-body-sha': String(bodyText.length),
      };
    },
    async enrollmentHeaders() { return { 'content-type': 'application/json' }; },
  };
}

test('journal makes effect intent durable before any ambiguous outcome and never marks retry automatic', async () => {
  const { journal, snapshot } = memoryJournal();
  await journal.load();
  await journal.begin({ attempt_id: ATTEMPT, expected_generation_floor: 28 });
  assert.equal(snapshot().latest.state, 'PREPARED');
  assert.equal(snapshot().latest.effect_intent_durable, false);

  await journal.markSendIntent();
  assert.equal(snapshot().latest.state, 'SEND_INTENT_DURABLE');
  assert.equal(snapshot().latest.effect_intent_durable, true);
  assert.equal(snapshot().latest.automatic_retry_allowed, false);
  assert.equal(snapshot().latest.retry_requires_new_user_action, true);

  await journal.markAmbiguous(new Error('network_lost_after_send'));
  assert.equal(snapshot().latest.state, 'AMBIGUOUS');
  assert.equal(journal.hasPending(), true);
  await assert.rejects(
    () => journal.begin({ attempt_id: '22222222-2222-4222-8222-222222222222', expected_generation_floor: 28 }),
    /client_admission_recovery_pending_reconcile_required/,
  );
});

test('ambiguous intent is reconciled by independent state readback before a new effect can exist', async () => {
  const { journal } = memoryJournal();
  await journal.load();
  await journal.begin({ attempt_id: ATTEMPT, expected_generation_floor: 28 });
  await journal.markSendIntent();
  await journal.markAmbiguous('lost_response');

  const absent = await journal.reconcile(state({ floor: 28, open: false }));
  assert.equal(absent.state, 'ABSENCE_CONFIRMED');
  assert.equal(journal.hasPending(), false);

  const next = await journal.begin({
    attempt_id: '22222222-2222-4222-8222-222222222222',
    expected_generation_floor: 28,
  });
  assert.equal(next.state, 'PREPARED');
});

test('open and generation-drift readbacks close pending recovery without replay', async () => {
  for (const [observed, expected] of [
    [state({ floor: 28, open: true }), 'OPEN_CONFIRMED'],
    [state({ floor: 29, open: false }), 'REJECTED'],
  ]) {
    const { journal } = memoryJournal();
    await journal.load();
    await journal.begin({ attempt_id: ATTEMPT, expected_generation_floor: 28 });
    await journal.markSendIntent();
    await journal.markAmbiguous('lost_response');
    const row = await journal.reconcile(observed);
    assert.equal(row.state, expected);
    assert.equal(row.automatic_retry_allowed, false);
  }
});

test('legacy or uncorrelated CLOSED readback cannot clear an ambiguous effect', async () => {
  const { journal } = memoryJournal();
  await journal.load();
  await journal.begin({ attempt_id: ATTEMPT, expected_generation_floor: 28 });
  await journal.markSendIntent();
  await journal.markAmbiguous('lost_response');

  const legacyClosed = state({ floor: 28, open: false });
  delete legacyClosed.read_request_id;
  delete legacyClosed.observed_at;
  const stillPending = await journal.reconcile(legacyClosed);
  assert.equal(stillPending.state, 'AMBIGUOUS');
  assert.equal(journal.hasPending(), true);
});

test('reconciliation classifier fails closed on unavailable authority', () => {
  const pending = {
    schema: 'metaengine.client.admission-recovery-attempt.v1',
    attempt_id: ATTEMPT,
    expected_generation_floor: 28,
    state: 'AMBIGUOUS',
    receipt: null,
    observation: null,
    last_error: null,
    created_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z',
    operator_initiated: true,
    effect_intent_durable: true,
    retry_requires_new_user_action: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  assert.equal(classifyAdmissionRecoveryObservation(pending, { state: 'OPEN' }).disposition, 'UNAVAILABLE');
});

test('native client signs exact environment read and exact-generation resume routes', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, method: init.method, body: init.body, pathHeader: init.headers?.['x-test-path'] });
    if (pathname.endsWith('/v1/devos/environment-state')) {
      const request = JSON.parse(init.body || '{}');
      return response(200, {
        schema: 'metaengine.devos.environment-state.v1',
        workspace_id: WORKSPACE,
        generation_floor: 28,
        read_request_id: request.read_request_id,
        observed_at: OBSERVED_AT,
        refill_enabled: false,
        supervisor_admission_enabled: false,
        reset_at: '2026-10-03T12:00:00.000Z',
        reset_reason: 'CONTROLLED_RESET',
        authority_effect: false,
      });
    }
    if (pathname.endsWith('/v1/devos/resume-admission')) return response(200, {
      schema: 'metaengine.devos.environment-resume.v1',
      resumed: true,
      requested_floor: 28,
      before: { state: 'CLOSED', generation_floor: 28, supervisor_admission_enabled: false },
      after: { state: 'OPEN', generation_floor: 28, supervisor_admission_enabled: true, continuous_service_allowed: true },
      operator_initiated: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity: identity(),
    fetchImpl,
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => ({ authority_effect: false }),
    intervalMs: 60_000,
  });

  const before = await client.devosEnvironmentState();
  assert.equal(before.state, 'CLOSED');
  assert.equal(before.generation_floor, 28);
  const receipt = await client.resumeDevosAdmission(28);
  assert.equal(receipt.resumed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname.endsWith('/v1/devos/environment-state'), true);
  assert.equal(calls[0].pathHeader.endsWith('/v1/devos/environment-state'), true);
  assert.match(JSON.parse(calls[0].body).read_request_id, /^[0-9a-f-]{36}$/);
  assert.equal(before.read_request_id, JSON.parse(calls[0].body).read_request_id);
  assert.equal(before.observed_at, OBSERVED_AT);
  assert.deepEqual(JSON.parse(calls[1].body), { confirm: true, expected_generation_floor: 28 });
  assert.equal(calls[1].pathHeader.endsWith('/v1/devos/resume-admission'), true);
  client.stop();
});

test('native environment read rejects an uncorrelated response instead of accepting stale CLOSED state', async () => {
  const client = new NativeSupervisorClient({
    identity: identity(),
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/v1/devos/environment-state')) {
        return response(200, {
          schema: 'metaengine.devos.environment-state.v1',
          workspace_id: WORKSPACE,
          generation_floor: 28,
          read_request_id: READ_REQUEST,
          observed_at: OBSERVED_AT,
          refill_enabled: false,
          supervisor_admission_enabled: false,
          authority_effect: false,
        });
      }
      throw new Error(`unexpected_fetch:${pathname}`);
    },
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => ({ authority_effect: false }),
    intervalMs: 60_000,
  });
  await assert.rejects(
    () => client.devosEnvironmentState(),
    /native_supervisor_environment_state_readback_invalid/,
  );
  client.stop();
});

test('native resume returns known-absent conflict without inventing success or retry authority', async () => {
  const client = new NativeSupervisorClient({
    identity: identity(),
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/v1/devos/resume-admission')) {
        return response(409, { error: 'devos_resume_generation_mismatch' });
      }
      throw new Error(`unexpected_fetch:${pathname}`);
    },
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => ({ authority_effect: false }),
    intervalMs: 60_000,
  });
  const result = await client.resumeDevosAdmission(28);
  assert.equal(result.effect_state, 'ABSENT');
  assert.equal(result.status, 409);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  client.stop();
});

test('Client bridge exposes only explicit admission recovery and UI never schedules the effect', async () => {
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');

  assert.match(preload, /resumeAdmission:\s*resumeClientAdmission/);
  assert.match(preload, /admission_resume_requires_explicit_user_action:\s*true/);
  assert.match(preload, /admission_resume_automatic_retry_allowed:\s*false/);
  assert.match(main, /ipcMain\.handle\('metaengine:client:resume-admission'/);
  assert.match(main, /await journal\.markSendIntent\(\);[\s\S]*nativeSupervisor\.resumeDevosAdmission/);
  assert.match(main, /if \(journal\.hasPending\(\)\)[\s\S]*journal\.reconcile\(observed\)/);
  assert.match(main, /prior_effect_replayed:\s*false/);
  assert.match(main, /RECOVERY_JOURNAL_INCOMPATIBLE/);
  assert.match(main, /clientAdmissionRecoveryJournalLoadError/);
  assert.match(ui, /data-testid="client-resume-execution"/);
  assert.match(ui, /onClick=\{\(\) => void resumeExecution\(\)\}/);
  assert.doesNotMatch(ui, /setInterval\([\s\S]{0,300}resumeAdmission/);
  assert.doesNotMatch(preload, /generic_command_exposed:\s*true/);

  const freshRead = ui.indexOf('const freshReadiness = await loadReadiness();');
  const submitEffect = ui.indexOf('const next = await bridge.submitGoal(value);', freshRead);
  assert.ok(freshRead > 0, 'fresh readiness read missing from submit');
  assert.ok(submitEffect > freshRead, 'goal effect must follow fresh readiness read');
  assert.match(ui.slice(freshRead, submitEffect), /if \(!freshReadiness\?\.execution_ready\)/);
  const runButton = ui.match(/data-testid="client-goal-submit"[\s\S]{0,900}/)?.[0] || '';
  assert.doesNotMatch(runButton, /readiness\?\.execution_ready === false/);
});
