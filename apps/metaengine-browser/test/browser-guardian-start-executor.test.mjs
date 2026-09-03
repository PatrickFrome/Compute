import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');
const { executeGuardianStartChild } = require('../src/browser-guardian-start-executor.cjs');

const release = Object.freeze({ release_id: 'release-dev-10', artifact_sha256: 'c'.repeat(64) });
const binding = Object.freeze({ guardian_instance_id: 'guardian-installation-a', executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe' });

function plan() {
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
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-guardian-start-'));
  const journal = new BrowserGuardianEffectJournal({ statePath: path.join(root, 'guardian-state.json') });
  await journal.init(binding);
  return { root, journal };
}

async function cleanup(root) { await fs.rm(root, { recursive: true, force: true }); }

function assertZeroAuthority(out) {
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.browser_authority, false);
  assert.equal(out.task_authority, false);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);
}

test('late child-presence drift fences before effect barrier and never calls dispatch', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(), journal: f.journal, binding,
      revalidateChildAbsence: async () => ({ proven: false, reason: 'child_present_after_plan' }),
      dispatchStart: async () => { dispatchCalls += 1; return { state: 'DISPATCHED', pid: 8001 }; },
      observeDispatched: async () => ({ state: 'UNRESOLVED' }),
    });
    assert.equal(out.state, 'PRE_EFFECT_FENCED');
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot().state, 'NO_EFFECT_PROVEN');
    assert.equal(f.journal.snapshot().physical_effect_attempted, false);
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('exception after durable effect barrier becomes ambiguity and a second invocation cannot dispatch', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  const args = {
    plan: plan(), journal: f.journal, binding,
    revalidateChildAbsence: async () => ({ proven: true }),
    dispatchStart: async () => { dispatchCalls += 1; throw new Error('spawn adapter lost outcome'); },
    observeDispatched: async () => ({ state: 'UNRESOLVED' }),
  };
  try {
    const first = await executeGuardianStartChild(args);
    assert.equal(first.state, 'AMBIGUOUS');
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
    const second = await executeGuardianStartChild(args);
    assert.equal(second.state, 'HELD_UNRESOLVED');
    assert.equal(dispatchCalls, 1);
    assertZeroAuthority(second);
  } finally { await cleanup(f.root); }
});

test('exact dispatched PID plus exact-ready release binding confirms one start generation', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(), journal: f.journal, binding,
      revalidateChildAbsence: async () => ({ proven: true }),
      dispatchStart: async () => { dispatchCalls += 1; return { state: 'DISPATCHED', pid: 8101, process_incarnation_id: 'proc-candidate-1' }; },
      observeDispatched: async ({ pid }) => ({ state: 'READY', pid, process_incarnation_id: 'proc-candidate-1', release, exact_ready_binding: true }),
    });
    assert.equal(out.state, 'CONFIRMED');
    assert.equal(out.pid, 8101);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'CONFIRMED');
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('mismatched ready PID cannot qualify dispatched child and becomes non-replayable ambiguity', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(), journal: f.journal, binding,
      revalidateChildAbsence: async () => ({ proven: true }),
      dispatchStart: async () => { dispatchCalls += 1; return { state: 'DISPATCHED', pid: 8201 }; },
      observeDispatched: async () => ({ state: 'READY', pid: 8202, process_incarnation_id: 'proc-wrong', release, exact_ready_binding: true }),
    });
    assert.equal(out.state, 'AMBIGUOUS');
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
    assert.match(f.journal.snapshot().result, /guardian_effect_confirm_pid_drift/);
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('exact dispatched PID absence closes no-effect and permits a later new generation, never an in-call retry', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  const execute = async (pid) => executeGuardianStartChild({
    plan: plan(), journal: f.journal, binding,
    revalidateChildAbsence: async () => ({ proven: true }),
    dispatchStart: async () => { dispatchCalls += 1; return { state: 'DISPATCHED', pid }; },
    observeDispatched: async ({ pid: exact }) => ({ state: 'PID_ABSENT', pid: exact, exact_pid_absent: true, effect_absent_proven: true }),
  });
  try {
    const first = await execute(8301);
    assert.equal(first.state, 'NO_EFFECT_PROVEN');
    assert.equal(first.effect_generation, 1);
    assert.equal(dispatchCalls, 1);
    const second = await execute(8302);
    assert.equal(second.state, 'NO_EFFECT_PROVEN');
    assert.equal(second.effect_generation, 2);
    assert.equal(dispatchCalls, 2);
    assertZeroAuthority(second);
  } finally { await cleanup(f.root); }
});

test('adapter may report proven no-effect but executor never infers it from an exception', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(), journal: f.journal, binding,
      revalidateChildAbsence: async () => ({ proven: true }),
      dispatchStart: async () => { dispatchCalls += 1; return { state: 'NO_EFFECT_PROVEN', effect_absent_proven: true, reason: 'spawn_rejected_before_os_effect' }; },
      observeDispatched: async () => { throw new Error('must not observe without dispatch'); },
    });
    assert.equal(out.state, 'NO_EFFECT_PROVEN');
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'NO_EFFECT_PROVEN');
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('bounded observation failure after dispatch is ambiguity, not a hidden retry', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(), journal: f.journal, binding,
      revalidateChildAbsence: async () => ({ proven: true }),
      dispatchStart: async () => { dispatchCalls += 1; return { state: 'DISPATCHED', pid: 8401 }; },
      observeDispatched: async () => { throw new Error('readback unavailable'); },
    });
    assert.equal(out.state, 'AMBIGUOUS');
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});
