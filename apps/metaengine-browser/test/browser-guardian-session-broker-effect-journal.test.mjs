import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BrowserGuardianSessionBrokerEffectJournal,
  journalPath,
} = require('../src/browser-guardian-session-broker-effect-journal.cjs');

const binding = Object.freeze({
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINEBrowserSessionBroker.exe',
  expected_owner_sid: 'S-1-5-21-1000-2000-3000-1001',
});
const ACTUATOR = 'guardian-wts-actuator-v1';
const OBSERVER = 'guardian-process-session-observer-v1';

function startPlan(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.session-broker-plan.v1',
    action: 'START_BROKER',
    process_effect_candidate: true,
    requires_user_session_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    authority_effect: false,
    selected_session: {
      session_id: 7,
      user_sid: binding.expected_owner_sid,
      state: 'ACTIVE',
    },
    broker_absence_proven: true,
    ...overrides,
  };
}

function exactReadback(overrides = {}) {
  return {
    observer_id: OBSERVER,
    pid: 4200,
    process_incarnation_id: 'pid:4200:created_100ns:123456789',
    session_id: 7,
    user_sid: binding.expected_owner_sid,
    executable: binding.broker_executable,
    exact_session_binding: true,
    exact_process_binding: true,
    kill_on_close_job_binding: true,
    broker_ready: true,
    ...overrides,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-broker-effect-journal-'));
  return { root, statePath: path.join(root, 'guardian-state.json') };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

function assertZeroAuthority(row) {
  for (const field of [
    'automatic_retry_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'session_token_authority',
    'process_effect_authority',
    'authority_effect',
  ]) assert.equal(row[field], false, `${field} must remain false`);
}

test('pre-effect START_BROKER intent is durable and idempotent for the exact owner session', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    assert.equal(await journal.init(binding), null);
    const first = await journal.beginStart(binding, startPlan());
    const again = await journal.beginStart(binding, startPlan());
    assert.equal(first.state, 'INTENT_RECORDED');
    assert.equal(again.effect_id, first.effect_id);
    assert.equal(again.sequence, first.sequence);
    assert.equal(again.actuator_id, null);
    assert.equal(again.physical_effect_attempted, false);
    assert.equal(again.effect_barrier_crossed, false);
    assertZeroAuthority(again);
  } finally { await cleanup(f.root); }
});

test('owner SID, ACTIVE session and positive broker absence are mandatory before journaling', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(
      () => journal.beginStart(binding, startPlan({ broker_absence_proven: false })),
      /guardian_session_broker_effect_absence_unproven/,
    );
    await assert.rejects(
      () => journal.beginStart(binding, startPlan({ selected_session: { session_id: 7, user_sid: 'S-1-5-21-999-1-1-1', state: 'ACTIVE' } })),
      /guardian_session_broker_effect_owner_sid_drift/,
    );
    await assert.rejects(
      () => journal.beginStart(binding, startPlan({ selected_session: { session_id: 7, user_sid: binding.expected_owner_sid, state: 'DISCONNECTED' } })),
      /guardian_session_broker_effect_session_invalid/,
    );
  } finally { await cleanup(f.root); }
});

test('ONE_ATTEMPT barrier durably binds an actuator before any WTS process effect', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await assert.rejects(
      () => journal.markEffectAttempted(binding, intent.effect_id),
      /guardian_session_broker_effect_actuator_id_required/,
    );
    const attempted = await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    assert.equal(attempted.state, 'EFFECT_ATTEMPTED');
    assert.equal(attempted.actuator_id, ACTUATOR);
    assert.equal(attempted.physical_effect_attempted, true);
    assert.equal(attempted.effect_barrier_crossed, true);
    assert.equal(attempted.dispatched_pid, null);
    await assert.rejects(
      () => journal.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_unresolved:EFFECT_ATTEMPTED/,
    );
  } finally { await cleanup(f.root); }
});

test('dispatched broker identity is exact PID plus process incarnation and stays bound to the actuator', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await assert.rejects(
      () => journal.markDispatched(binding, intent.effect_id, { pid: 4100, process_incarnation_id: '' }),
      /guardian_session_broker_effect_dispatched_identity_invalid/,
    );
    await assert.rejects(
      () => journal.markDispatched(binding, intent.effect_id, {
        pid: 4100,
        process_incarnation_id: 'pid:4100:created_100ns:99',
        actuator_id: 'different-actuator',
      }),
      /guardian_session_broker_effect_dispatch_actuator_drift/,
    );
    const dispatched = await journal.markDispatched(binding, intent.effect_id, {
      pid: 4100,
      process_incarnation_id: 'pid:4100:created_100ns:99',
      actuator_id: ACTUATOR,
    });
    assert.equal(dispatched.state, 'EFFECT_DISPATCHED');
    assert.equal(dispatched.actuator_id, ACTUATOR);
    assert.equal(dispatched.dispatched_pid, 4100);
    assert.equal(dispatched.dispatched_process_incarnation_id, 'pid:4100:created_100ns:99');
  } finally { await cleanup(f.root); }
});

test('independent exact readback confirms a normally persisted dispatch', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await journal.markDispatched(binding, intent.effect_id, {
      pid: 4200,
      process_incarnation_id: 'pid:4200:created_100ns:123456789',
    });
    const confirmed = await journal.confirmEffect(binding, intent.effect_id, exactReadback());
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.result, 'exact_broker_binding_confirmed');
    assert.equal(confirmed.readback.observer_id, OBSERVER);
    assertZeroAuthority(confirmed);
  } finally { await cleanup(f.root); }
});

test('lost dispatch receipt can be recovered after crash from independent exact process/session readback', async () => {
  const f = await fixture();
  try {
    const before = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await before.init(binding);
    const intent = await before.beginStart(binding, startPlan());
    await before.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await before.markAmbiguous(binding, intent.effect_id, 'service_crashed_after_create_before_dispatch_receipt');

    const after = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    const restored = await after.init(binding);
    assert.equal(restored.state, 'AMBIGUOUS');
    assert.equal(restored.dispatched_pid, null);
    assert.equal(restored.dispatched_process_incarnation_id, null);

    const reconciled = await after.confirmEffect(binding, intent.effect_id, exactReadback());
    assert.equal(reconciled.state, 'CONFIRMED');
    assert.equal(reconciled.result, 'late_exact_broker_binding_recovered_dispatch');
    assert.equal(reconciled.dispatched_pid, 4200);
    assert.equal(reconciled.dispatched_process_incarnation_id, 'pid:4200:created_100ns:123456789');
    assert.equal(reconciled.readback.observer_id, OBSERVER);
    await assert.rejects(
      () => after.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_confirmed_requires_restart_protocol/,
    );
  } finally { await cleanup(f.root); }
});

test('actuator self-attestation can never resolve an attempted or ambiguous WTS effect', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await assert.rejects(
      () => journal.confirmEffect(binding, intent.effect_id, exactReadback({ observer_id: ACTUATOR })),
      /guardian_session_broker_effect_self_attestation_forbidden/,
    );
    const ambiguous = await journal.markAmbiguous(binding, intent.effect_id, 'result_channel_lost');
    assert.equal(ambiguous.state, 'AMBIGUOUS');
    await assert.rejects(
      () => journal.confirmEffect(binding, intent.effect_id, exactReadback({ observer_id: ACTUATOR })),
      /guardian_session_broker_effect_self_attestation_forbidden/,
    );
  } finally { await cleanup(f.root); }
});

test('readback must match exact owner session, executable and persisted dispatch identity', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await journal.markDispatched(binding, intent.effect_id, {
      pid: 4200,
      process_incarnation_id: 'pid:4200:created_100ns:123456789',
    });
    for (const proof of [
      exactReadback({ session_id: 8 }),
      exactReadback({ user_sid: 'S-1-5-21-999-1-1-1' }),
      exactReadback({ executable: 'C:\\Temp\\broker.exe' }),
      exactReadback({ exact_process_binding: false }),
      exactReadback({ broker_ready: false }),
    ]) {
      await assert.rejects(
        () => journal.confirmEffect(binding, intent.effect_id, proof),
        /guardian_session_broker_effect_confirm_proof_invalid/,
      );
    }
    await assert.rejects(
      () => journal.confirmEffect(binding, intent.effect_id, exactReadback({ pid: 9999 })),
      /guardian_session_broker_effect_confirm_dispatch_drift/,
    );
  } finally { await cleanup(f.root); }
});

test('post-dispatch no-effect proof requires independent observer and exact process absence', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await journal.markDispatched(binding, intent.effect_id, {
      pid: 4300,
      process_incarnation_id: 'pid:4300:created_100ns:123',
    });
    const proof = {
      observer_id: OBSERVER,
      effect_absent_proven: true,
      selected_session_inventory_complete: true,
      session_id: 7,
      user_sid: binding.expected_owner_sid,
      pid: 4300,
      process_incarnation_id: 'pid:4300:created_100ns:123',
      exact_process_absent: true,
      reason: 'exact_broker_process_absent',
    };
    await assert.rejects(
      () => journal.proveNoEffect(binding, intent.effect_id, { ...proof, observer_id: ACTUATOR }),
      /guardian_session_broker_effect_self_attestation_forbidden/,
    );
    const absent = await journal.proveNoEffect(binding, intent.effect_id, proof);
    assert.equal(absent.state, 'NO_EFFECT_PROVEN');
    assert.equal(absent.readback.observer_id, OBSERVER);
    const next = await journal.beginStart(binding, startPlan());
    assert.equal(next.effect_generation, 2);
    assert.notEqual(next.effect_id, intent.effect_id);
  } finally { await cleanup(f.root); }
});

test('AMBIGUOUS remains non-retryable and cannot be converted to no-effect by a generic retry path', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    await journal.markAmbiguous(binding, intent.effect_id, 'wts_result_unknown');
    await assert.rejects(
      () => journal.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_unresolved:AMBIGUOUS/,
    );
    await assert.rejects(
      () => journal.proveNoEffect(binding, intent.effect_id, {
        observer_id: OBSERVER,
        effect_absent_proven: true,
        selected_session_inventory_complete: true,
        session_id: 7,
        user_sid: binding.expected_owner_sid,
      }),
      /guardian_session_broker_effect_no_effect_transition_invalid/,
    );
  } finally { await cleanup(f.root); }
});

test('persisted plan tampering is rejected on restart before any recovery decision', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await journal.beginStart(binding, startPlan());
    const file = journalPath(f.statePath);
    const row = JSON.parse(await fs.readFile(file, 'utf8'));
    row.plan.selected_session.session_id = 99;
    await fs.writeFile(file, JSON.stringify(row), 'utf8');

    const restored = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await assert.rejects(
      () => restored.init(binding),
      /guardian_session_broker_effect_plan_digest_invalid/,
    );
  } finally { await cleanup(f.root); }
});

test('impossible durable state/barrier/dispatch combinations fail closed on restart', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id, { actuator_id: ACTUATOR });
    const file = journalPath(f.statePath);
    const row = JSON.parse(await fs.readFile(file, 'utf8'));
    row.state = 'EFFECT_DISPATCHED';
    row.dispatched_pid = 4200;
    row.dispatched_process_incarnation_id = null;
    await fs.writeFile(file, JSON.stringify(row), 'utf8');

    const restored = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await assert.rejects(
      () => restored.init(binding),
      /guardian_session_broker_effect_dispatch_identity_invalid/,
    );
  } finally { await cleanup(f.root); }
});

test('authority-bearing plans and durable binding drift fail closed', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(
      () => journal.beginStart(binding, startPlan({ session_token_authority: true })),
      /guardian_session_broker_effect_plan_authority_invalid:session_token_authority/,
    );
    await journal.beginStart(binding, startPlan());
    const other = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await assert.rejects(
      () => other.init({ ...binding, expected_owner_sid: 'S-1-5-21-1000-2000-3000-1002' }),
      /guardian_session_broker_effect_journal_binding_drift/,
    );
  } finally { await cleanup(f.root); }
});

test('RESTART_EXACT_BROKER stays outside v1 one-attempt start protocol', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(
      () => journal.beginStart(binding, startPlan({ action: 'RESTART_EXACT_BROKER' })),
      /guardian_session_broker_effect_action_not_supported/,
    );
  } finally { await cleanup(f.root); }
});
