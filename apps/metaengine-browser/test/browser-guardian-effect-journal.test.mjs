import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');

const release = Object.freeze({ release_id: 'release-dev-9', artifact_sha256: 'a'.repeat(64) });
const binding = Object.freeze({ guardian_instance_id: 'guardian-installation-a', executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe' });

function startPlan(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action: 'START_CHILD',
    process_effect_candidate: true,
    requires_external_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    target_release: release,
    process_absence_proven: true,
    ...overrides,
  };
}

function restartPlan(overrides = {}) {
  return startPlan({
    action: 'RESTART_EXACT_CHILD',
    process_absence_proven: false,
    exact_pid: 4242,
    exact_process_incarnation_id: 'proc-old-1',
    ...overrides,
  });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-guardian-journal-'));
  return { root, statePath: path.join(root, 'guardian-state.json') };
}

async function cleanup(root) { await fs.rm(root, { recursive: true, force: true }); }

function assertZeroAuthority(row) {
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.browser_authority, false);
  assert.equal(row.task_authority, false);
  assert.equal(row.scheduler_authority, false);
  assert.equal(row.release_authority, false);
  assert.equal(row.authority_effect, false);
}

test('exact pre-effect intent is idempotent and does not claim a physical attempt', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const first = await journal.beginEffect(binding, startPlan());
    const again = await journal.beginEffect(binding, startPlan());
    assert.equal(first.state, 'INTENT_RECORDED');
    assert.equal(again.effect_id, first.effect_id);
    assert.equal(again.effect_generation, 1);
    assert.equal(again.physical_effect_attempted, false);
    assert.equal(again.effect_barrier_crossed, false);
    assertZeroAuthority(again);
  } finally { await cleanup(f.root); }
});

test('crash after effect barrier is unresolved across process restart and cannot replay', async () => {
  const f = await fixture();
  try {
    const before = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await before.init(binding);
    const intent = await before.beginEffect(binding, startPlan());
    await before.markEffectAttempted(binding, intent.effect_id);

    const after = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    const restored = await after.init(binding);
    assert.equal(restored.state, 'EFFECT_ATTEMPTED');
    assert.equal(after.unresolvedEffect(), true);
    await assert.rejects(() => after.beginEffect(binding, startPlan()), /guardian_effect_unresolved:EFFECT_ATTEMPTED/);
    assertZeroAuthority(restored);
  } finally { await cleanup(f.root); }
});

test('dispatched successor must match exact pid and release before confirmation', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginEffect(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await journal.markDispatched(binding, intent.effect_id, { pid: 5001 });
    await assert.rejects(() => journal.confirmEffect(binding, intent.effect_id, {
      release, pid: 5002, process_incarnation_id: 'proc-new', exact_ready_binding: true,
    }), /guardian_effect_confirm_pid_drift/);
    const confirmed = await journal.confirmEffect(binding, intent.effect_id, {
      release, pid: 5001, process_incarnation_id: 'proc-new', exact_ready_binding: true,
    });
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.dispatched_pid, 5001);
    assertZeroAuthority(confirmed);
  } finally { await cleanup(f.root); }
});

test('exact dispatched pid absence is the only post-dispatch route to no-effect proof', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginEffect(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await journal.markDispatched(binding, intent.effect_id, { pid: 6001 });
    await assert.rejects(() => journal.proveNoEffect(binding, intent.effect_id, {
      effect_absent_proven: true, pid: 6002, exact_pid_absent: true,
    }), /guardian_effect_dispatched_absence_proof_invalid/);
    const absent = await journal.proveNoEffect(binding, intent.effect_id, {
      effect_absent_proven: true, pid: 6001, exact_pid_absent: true, reason: 'exact_candidate_pid_absent',
    });
    assert.equal(absent.state, 'NO_EFFECT_PROVEN');
    assertZeroAuthority(absent);
    const next = await journal.beginEffect(binding, startPlan());
    assert.equal(next.effect_generation, 2);
    assert.notEqual(next.effect_id, intent.effect_id);
  } finally { await cleanup(f.root); }
});

test('ambiguous process effect is terminal for automatic replay of that journal generation', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginEffect(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    const ambiguous = await journal.markAmbiguous(binding, intent.effect_id, 'spawn_ack_lost');
    assert.equal(ambiguous.state, 'AMBIGUOUS');
    assert.equal(journal.unresolvedEffect(), true);
    await assert.rejects(() => journal.beginEffect(binding, startPlan()), /guardian_effect_unresolved:AMBIGUOUS/);
    assertZeroAuthority(ambiguous);
  } finally { await cleanup(f.root); }
});

test('ambiguous process effect may converge only from late exact-ready proof and never replays', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginEffect(binding, startPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await journal.markAmbiguous(binding, intent.effect_id, 'spawn_ack_lost');
    await assert.rejects(() => journal.confirmEffect(binding, intent.effect_id, {
      release: { ...release, artifact_sha256: 'b'.repeat(64) },
      pid: 7001,
      process_incarnation_id: 'proc-late-ready',
      exact_ready_binding: true,
    }), /guardian_effect_confirm_release_drift/);
    const confirmed = await journal.confirmEffect(binding, intent.effect_id, {
      release,
      pid: 7001,
      process_incarnation_id: 'proc-late-ready',
      exact_ready_binding: true,
    });
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.effect_generation, 1);
    assert.equal(confirmed.dispatched_pid, 7001);
    assert.equal(confirmed.result, 'late_exact_ready_reconciliation');
    assertZeroAuthority(confirmed);
  } finally { await cleanup(f.root); }
});

test('restart plan is bound to exact old pid and process incarnation before journaling', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(() => journal.beginEffect(binding, restartPlan({ exact_pid: null })), /guardian_effect_restart_binding_invalid/);
    await assert.rejects(() => journal.beginEffect(binding, restartPlan({ exact_process_incarnation_id: '' })), /guardian_effect_restart_binding_invalid/);
    const row = await journal.beginEffect(binding, restartPlan());
    assert.equal(row.plan.exact_pid, 4242);
    assert.equal(row.plan.exact_process_incarnation_id, 'proc-old-1');
  } finally { await cleanup(f.root); }
});

test('START_CHILD is impossible without positive child-absence proof', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(() => journal.beginEffect(binding, startPlan({ process_absence_proven: false })), /guardian_effect_start_absence_unproven/);
  } finally { await cleanup(f.root); }
});

test('authority-bearing plan or guardian binding drift fails closed before a new effect', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(() => journal.beginEffect(binding, startPlan({ automatic_retry_allowed: true })), /guardian_effect_plan_authority_invalid/);
    const intent = await journal.beginEffect(binding, startPlan());
    const other = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await assert.rejects(() => other.init({ ...binding, guardian_instance_id: 'guardian-installation-b' }), /guardian_effect_journal_binding_drift/);
    assert.equal(intent.state, 'INTENT_RECORDED');
  } finally { await cleanup(f.root); }
});
