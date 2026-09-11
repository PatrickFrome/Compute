import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianSessionBrokerEffectJournal } = require('../src/browser-guardian-session-broker-effect-journal.cjs');

const binding = Object.freeze({
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINEBrowserSessionBroker.exe',
  expected_owner_sid: 'S-1-5-21-1000-2000-3000-1001',
});

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
    assert.equal(again.plan.selected_session.session_id, 7);
    assert.equal(again.plan.selected_session.user_sid, binding.expected_owner_sid);
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

test('RESTART_EXACT_BROKER is deliberately non-actuable in journal v1', async () => {
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

test('crossing the effect barrier survives controller restart and cannot replay', async () => {
  const f = await fixture();
  try {
    const before = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await before.init(binding);
    const intent = await before.beginStart(binding, startPlan());
    await before.markEffectAttempted(binding, intent.effect_id);

    const after = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    const restored = await after.init(binding);
    assert.equal(restored.state, 'EFFECT_ATTEMPTED');
    assert.equal(after.unresolvedEffect(), true);
    await assert.rejects(
      () => after.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_unresolved:EFFECT_ATTEMPTED/,
    );
    assertZeroAuthority(restored);
  } finally { await cleanup(f.root); }
});

test('dispatched broker identity is exact PID plus process incarnation', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await assert.rejects(
      () => journal.markDispatched(binding, intent.effect_id, { pid: 4100, process_incarnation_id: '' }),
      /guardian_session_broker_effect_dispatched_identity_invalid/,
    );
    const dispatched = await journal.markDispatched(binding, intent.effect_id, {
      pid: 4100,
      process_incarnation_id: 'pid-4100-created-1788450000000',
    });
    assert.equal(dispatched.state, 'EFFECT_DISPATCHED');
    assert.equal(dispatched.dispatched_pid, 4100);
    assert.equal(dispatched.dispatched_process_incarnation_id, 'pid-4100-created-1788450000000');
  } finally { await cleanup(f.root); }
});

test('confirmation requires exact session/process identity, kill-on-close job binding and broker readiness', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await journal.markDispatched(binding, intent.effect_id, {
      pid: 4200,
      process_incarnation_id: 'broker-incarnation-a',
    });
    const proof = {
      pid: 4200,
      process_incarnation_id: 'broker-incarnation-a',
      session_id: 7,
      user_sid: binding.expected_owner_sid,
      exact_session_binding: true,
      exact_process_binding: true,
      kill_on_close_job_binding: true,
      broker_ready: true,
    };
    await assert.rejects(
      () => journal.confirmEffect(binding, intent.effect_id, { ...proof, kill_on_close_job_binding: false }),
      /guardian_session_broker_effect_confirm_proof_invalid/,
    );
    const confirmed = await journal.confirmEffect(binding, intent.effect_id, proof);
    assert.equal(confirmed.state, 'CONFIRMED');
    assertZeroAuthority(confirmed);
    await assert.rejects(
      () => journal.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_confirmed_requires_restart_protocol/,
    );
  } finally { await cleanup(f.root); }
});

test('post-dispatch no-effect proof requires exact process absence and complete selected-session inventory', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginStart(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await journal.markDispatched(binding, intent.effect_id, {
      pid: 4300,
      process_incarnation_id: 'broker-incarnation-b',
    });
    await assert.rejects(
      () => journal.proveNoEffect(binding, intent.effect_id, {
        effect_absent_proven: true,
        selected_session_inventory_complete: true,
        pid: 4300,
        process_incarnation_id: 'broker-incarnation-b',
        exact_process_absent: false,
      }),
      /guardian_session_broker_effect_dispatched_absence_proof_invalid/,
    );
    const absent = await journal.proveNoEffect(binding, intent.effect_id, {
      effect_absent_proven: true,
      selected_session_inventory_complete: true,
      pid: 4300,
      process_incarnation_id: 'broker-incarnation-b',
      exact_process_absent: true,
      reason: 'exact_suspended_broker_absent',
    });
    assert.equal(absent.state, 'NO_EFFECT_PROVEN');
    const next = await journal.beginStart(binding, startPlan());
    assert.equal(next.effect_generation, 2);
    assert.notEqual(next.effect_id, intent.effect_id);
  } finally { await cleanup(f.root); }
});

test('AMBIGUOUS broker effect is quarantined across restart and never converts to no-effect replay', async () => {
  const f = await fixture();
  try {
    const before = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    await before.init(binding);
    const intent = await before.beginStart(binding, startPlan());
    await before.markEffectAttempted(binding, intent.effect_id);
    await before.markDispatched(binding, intent.effect_id, {
      pid: 4400,
      process_incarnation_id: 'broker-incarnation-c',
    });
    await before.markAmbiguous(binding, intent.effect_id, 'job_assignment_readback_lost');

    const after = new BrowserGuardianSessionBrokerEffectJournal({ statePath: f.statePath });
    const restored = await after.init(binding);
    assert.equal(restored.state, 'AMBIGUOUS');
    await assert.rejects(
      () => after.beginStart(binding, startPlan()),
      /guardian_session_broker_effect_unresolved:AMBIGUOUS/,
    );
    await assert.rejects(
      () => after.proveNoEffect(binding, intent.effect_id, {
        effect_absent_proven: true,
        selected_session_inventory_complete: true,
        pid: 4400,
        process_incarnation_id: 'broker-incarnation-c',
        exact_process_absent: true,
      }),
      /guardian_session_broker_effect_no_effect_transition_invalid/,
    );
    const reconciled = await after.confirmEffect(binding, intent.effect_id, {
      pid: 4400,
      process_incarnation_id: 'broker-incarnation-c',
      session_id: 7,
      user_sid: binding.expected_owner_sid,
      exact_session_binding: true,
      exact_process_binding: true,
      kill_on_close_job_binding: true,
      broker_ready: true,
    });
    assert.equal(reconciled.state, 'CONFIRMED');
    assert.equal(reconciled.result, 'late_exact_broker_binding_reconciliation');
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
