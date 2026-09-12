import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');
const { executeGuardianCandidateActivation } = require('../src/browser-guardian-activation-executor.cjs');

const release = Object.freeze({ release_id: 'release-dev-emergency-11', artifact_sha256: 'd'.repeat(64) });
const binding = Object.freeze({
  guardian_instance_id: 'guardian-installation-emergency-a',
  executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe',
});

function plan() {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action: 'ACTIVATE_CANDIDATE',
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
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-guardian-activation-'));
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

test('candidate drift fences before the effect barrier and never dispatches activation', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianCandidateActivation({
      plan: plan(),
      journal: f.journal,
      binding,
      revalidateCandidate: async () => ({ proven: false, reason: 'candidate_digest_drift' }),
      dispatchActivation: async () => {
        dispatchCalls += 1;
        return { state: 'DISPATCHED', pid: 9101, process_incarnation_id: 'activation-1' };
      },
      observeActivation: async () => ({ state: 'UNRESOLVED' }),
    });
    assert.equal(out.state, 'PRE_EFFECT_FENCED');
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot().state, 'NO_EFFECT_PROVEN');
    assert.equal(f.journal.snapshot().physical_effect_attempted, false);
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('unknown activation outcome becomes durable ambiguity and replay cannot dispatch twice', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  const args = {
    plan: plan(),
    journal: f.journal,
    binding,
    revalidateCandidate: async () => ({ proven: true }),
    dispatchActivation: async () => {
      dispatchCalls += 1;
      throw new Error('native activation adapter lost outcome');
    },
    observeActivation: async () => ({ state: 'UNRESOLVED' }),
  };
  try {
    const first = await executeGuardianCandidateActivation(args);
    assert.equal(first.state, 'AMBIGUOUS');
    assert.equal(first.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');

    const second = await executeGuardianCandidateActivation(args);
    assert.equal(second.state, 'HELD_UNRESOLVED');
    assert.equal(second.physical_dispatch_count, 0);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
    assertZeroAuthority(second);
  } finally { await cleanup(f.root); }
});

test('exact ready successor confirms exactly one external activation dispatch', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianCandidateActivation({
      plan: plan(),
      journal: f.journal,
      binding,
      revalidateCandidate: async ({ plan: exactPlan }) => ({
        proven: exactPlan.target_release.release_id === release.release_id
          && exactPlan.target_release.artifact_sha256 === release.artifact_sha256,
      }),
      dispatchActivation: async () => {
        dispatchCalls += 1;
        return {
          state: 'DISPATCHED',
          pid: 9201,
          process_incarnation_id: 'activation-successor-1',
          reason: 'guardian_native_activation_dispatched',
        };
      },
      observeActivation: async ({ pid, process_incarnation_id }) => ({
        state: 'READY',
        pid,
        process_incarnation_id,
        release,
        exact_ready_binding: true,
      }),
    });
    assert.equal(out.state, 'CONFIRMED');
    assert.equal(out.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(out.pid, 9201);
    assert.equal(f.journal.snapshot().state, 'CONFIRMED');
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('bounded readback failure after dispatch is ambiguity, never a hidden retry', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianCandidateActivation({
      plan: plan(),
      journal: f.journal,
      binding,
      revalidateCandidate: async () => ({ proven: true }),
      dispatchActivation: async () => {
        dispatchCalls += 1;
        return { state: 'DISPATCHED', pid: 9301, process_incarnation_id: 'activation-unresolved-1' };
      },
      observeActivation: async () => { throw new Error('successor readback unavailable'); },
    });
    assert.equal(out.state, 'AMBIGUOUS');
    assert.equal(out.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
    assertZeroAuthority(out);
  } finally { await cleanup(f.root); }
});

test('arbitrary non-Guardian activation shape is rejected before any physical effect', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    await assert.rejects(
      executeGuardianCandidateActivation({
        plan: {
          ...plan(),
          target_url: 'https://example.invalid/installer.exe',
          action: 'RUN_ARBITRARY_EXECUTABLE',
        },
        journal: f.journal,
        binding,
        revalidateCandidate: async () => ({ proven: true }),
        dispatchActivation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
        observeActivation: async () => ({ state: 'UNRESOLVED' }),
      }),
      /guardian_activation_executor_plan_invalid/,
    );
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});
