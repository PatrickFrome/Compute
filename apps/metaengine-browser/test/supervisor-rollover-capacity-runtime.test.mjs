import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const URL = 'https://chat.z.ai/c/e1ec5063-0798-46df-b401-df41813e0000';
const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const COMPOSER_REF = {
  schema: 'metaengine.native-browser.semantic-ref.v1',
  semantic_ref_id: 'semref_' + 'a'.repeat(64),
};

function frame() {
  return {
    url: URL,
    title: 'Z.ai',
    text_excerpt: '',
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: COMPOSER_REF, backend_node_id: 3 },
    ],
  };
}

function keepaliveSeed({
  state,
  admission = 'OPEN',
  rolloverAttempt = null,
  rolloverReason = 'CONVERSATION_LIMIT',
} = {}) {
  return {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 2,
    cycle_seq: 2109,
    state,
    conversation_url: URL,
    tab_id: 'tab_supervisor',
    paused: false,
    process_incarnation_id: 'process_test_current',
    admission_state: admission,
    admission_reason: admission === 'CLOSED' ? 'CONTINUOUS_SERVICE_ADMISSION_FENCED' : null,
    admission_generation_floor: 28,
    admission_refill_enabled: admission === 'OPEN',
    admission_supervisor_enabled: admission === 'OPEN',
    admission_observed_at: '2026-10-01T01:00:00.000Z',
    queued_wakes: [],
    pending_wake: null,
    active_wake: null,
    previous_worker_generation: {},
    rollover_reason: rolloverReason,
    rollover_release_at: '2026-09-28T20:59:00.000Z',
    rollover_attempt: rolloverAttempt,
    authority_effect: false,
  };
}

const CLOSED = Object.freeze({
  schema: 'metaengine.devos.environment-state.v1',
  state: 'CLOSED',
  reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
  workspace_id: WORKSPACE_ID,
  generation_floor: 28,
  refill_enabled: false,
  supervisor_admission_enabled: false,
  continuous_service_allowed: false,
  authoritative: true,
  automatic_retry_allowed: false,
  authority_effect: false,
});

async function tempState(seed) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rollover-capacity-'));
  const statePath = path.join(dir, 'keepalive.json');
  await fs.writeFile(statePath, JSON.stringify(seed), 'utf8');
  return { dir, statePath };
}

test('exact live capacity false-ambiguity heals to PARKED without Browser observation or effect', async () => {
  const attemptId = 'rollover_d07ce473-31aa-4dad-a2f9-b62d40bf03e3';
  const { dir, statePath } = await tempState(keepaliveSeed({
    state: 'ROLLOVER_AMBIGUOUS',
    admission: 'CLOSED',
    rolloverReason: 'ROLLOVER_ERROR:tab_capacity_exceeded',
    rolloverAttempt: {
      attempt_id: attemptId,
      supervisor_epoch: 2,
      previous_conversation: URL,
      started_at: '2026-09-28T20:59:09.703Z',
      tab_id: null,
      ambiguous_at: '2026-09-28T20:59:09.706Z',
      ambiguous_reason: 'ROLLOVER_ERROR:tab_capacity_exceeded',
      automatic_retry_allowed: false,
    },
  }));
  let stateReads = 0;
  let effects = 0;
  const runtime = new SupervisorLifecycleRuntime({
    statePath,
    processIncarnationId: 'process_test_current',
    requireAuthoritativeAdmission: true,
    getState: async () => {
      stateReads += 1;
      throw new Error('state read must not be required to settle exact no-effect proof');
    },
    executeCommand: async () => {
      effects += 1;
      throw new Error('Browser effect must not run');
    },
    canActuate: () => true,
  });

  try {
    await runtime.start();
    await runtime.applyRuntimeControl(CLOSED);
    const readsBeforeRecovery = stateReads;
    await runtime.cycle({ force: true });
    const snap = runtime.snapshot();
    assert.equal(snap.keepalive.state, 'PARKED');
    assert.equal(snap.keepalive.rollover_attempt, null);
    assert.equal(snap.keepalive.last_rollover_no_effect.attempt_id, attemptId);
    assert.equal(snap.last_recovery.action, 'ROLLOVER_CAPACITY_PRE_EFFECT_SETTLED');
    assert.equal(snap.last_recovery.ambiguous, false);
    assert.equal(stateReads, readsBeforeRecovery);
    assert.equal(effects, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('read-only census at the shared tab wall suppresses rollover NEW_TAB', async () => {
  const { dir, statePath } = await tempState(keepaliveSeed({
    state: 'ROLLOVER_REQUIRED',
    admission: 'OPEN',
  }));
  const actions = [];
  const runtime = new SupervisorLifecycleRuntime({
    statePath,
    processIncarnationId: 'process_test_current',
    getState: async () => ({
      tabs: [{ tab_id: 'tab_supervisor', url: URL, selected: true }],
      tab_census: {
        schema: 'metaengine.browser.tab-census.v1',
        total_tabs: 32,
        max_tabs: 32,
        total_at_wall: true,
        authority_effect: false,
      },
      fleet: { agents: [] },
    }),
    executeCommand: async (command) => {
      actions.push(command.action);
      if (command.action === 'CAPTURE') return frame();
      if (command.action === 'NEW_TAB') throw new Error('NEW_TAB must be suppressed by census');
      throw new Error(`unexpected_action:${command.action}`);
    },
    canActuate: () => true,
  });

  try {
    await runtime.start();
    const snap = runtime.snapshot();
    assert.equal(snap.keepalive.state, 'ROLLOVER_REQUIRED');
    assert.equal(actions.includes('NEW_TAB'), false);
    assert.equal(snap.last_recovery.action, 'ROLLOVER_CAPACITY_WAIT');
    assert.equal(snap.last_recovery.proof, 'READ_ONLY_TAB_CENSUS_TOTAL_AT_WALL');
    assert.equal(snap.last_recovery.total_tabs, 32);
    assert.equal(snap.last_recovery.max_tabs, 32);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('capacity race before tab allocation returns to required instead of ambiguity', async () => {
  const { dir, statePath } = await tempState(keepaliveSeed({
    state: 'ROLLOVER_REQUIRED',
    admission: 'OPEN',
  }));
  const actions = [];
  const runtime = new SupervisorLifecycleRuntime({
    statePath,
    processIncarnationId: 'process_test_current',
    getState: async () => ({
      tabs: [{ tab_id: 'tab_supervisor', url: URL, selected: true }],
      tab_census: {
        schema: 'metaengine.browser.tab-census.v1',
        total_tabs: 31,
        max_tabs: 32,
        total_at_wall: false,
        authority_effect: false,
      },
      fleet: { agents: [] },
    }),
    executeCommand: async (command) => {
      actions.push(command.action);
      if (command.action === 'CAPTURE') return frame();
      if (command.action === 'NEW_TAB') throw new Error('tab_capacity_exceeded');
      throw new Error(`unexpected_action:${command.action}`);
    },
    canActuate: () => true,
  });

  try {
    await runtime.start();
    const snap = runtime.snapshot();
    assert.equal(actions.filter((action) => action === 'NEW_TAB').length, 1);
    assert.equal(snap.keepalive.state, 'ROLLOVER_REQUIRED');
    assert.equal(snap.keepalive.rollover_attempt, null);
    assert.equal(snap.keepalive.last_rollover_no_effect.reason, 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT');
    assert.equal(snap.last_recovery.action, 'ROLLOVER_CAPACITY_PRE_EFFECT_SETTLED');
    assert.equal(snap.last_recovery.ambiguous, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
