import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore, FLEET_RUNTIME_STORE_VERSION } from '../src/fleet-runtime-store-v1.mjs';
import { FleetRuntime } from '../src/fleet-runtime-v1.mjs';
import { SystemIntelligence } from '../src/system-intelligence-v1.mjs';
import { AutonomousWorkScheduler } from '../src/autonomous-work-scheduler-v1.mjs';

async function harness(seed = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-intelligence-'));
  const statePath = path.join(dir, 'runtime.json');
  let now = Date.parse('2026-08-29T18:00:00Z');
  let seq = 0;
  if (seed) await fs.writeFile(statePath, `${JSON.stringify(seed)}\n`);
  const store = new FleetRuntimeStore({ statePath, clock: () => now });
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const fleetRuntime = new FleetRuntime({ store, clock: () => now, uuid });
  await fleetRuntime.init();
  const intelligence = new SystemIntelligence({ store, clock: () => now, uuid });
  const scheduler = new AutonomousWorkScheduler({ store, clock: () => now, uuid });
  return {
    dir,
    statePath,
    store,
    fleetRuntime,
    intelligence,
    scheduler,
    advance: (ms) => { now += ms; },
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function legacyState() {
  return {
    schema: 'metaengine.browser.fleet-runtime-state.v1',
    version: '1.0.0',
    worker_bindings: [],
    assignments: [],
    readiness_proofs: [],
    result_receipts: [],
    wake_events: [],
    supervisor: {
      emergency_state: 'PAUSE',
      keepalive_state: 'PAUSED',
      binding: null,
      wake_leases: [],
      cooldown_until: null,
      watchdog_deadline_at: null,
      updated_at: '2026-08-29T17:00:00.000Z',
    },
    updated_at: '2026-08-29T17:00:00.000Z',
  };
}

async function ingestFreshProcess(h, overrides = {}) {
  return h.intelligence.ingestProcessObservation({
    source_system: 'SUPABASE',
    source_instance: 'xpeibufgzjknrhbhpffp',
    process_kind: 'ROADMAP_MILESTONE',
    process_id: 'C5_AUTONOMOUS_FLEET_RUNTIME_V1',
    state: 'ACTIVE',
    authority: 'SUPABASE',
    source_cursor: 'cp2:a23b647',
    stale_after_ms: 60_000,
    payload_ref: 'supabase:checkpoint:cp2',
    ...overrides,
  });
}

async function bindSchedulerWorker(h, workerId, role, generationEpoch, targetId) {
  return h.fleetRuntime.bindWorkerIncarnation({
    agent_id: workerId,
    role,
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: `tab-${workerId}`,
    target_id: targetId,
    generation_epoch: generationEpoch,
    conversation_epoch: generationEpoch - 1,
  });
}

test('legacy C5 state migrates forward without losing existing durable state', async () => {
  const h = await harness(legacyState());
  const state = h.store.snapshot();
  assert.equal(state.version, FLEET_RUNTIME_STORE_VERSION);
  assert.equal(state.supervisor.emergency_state, 'PAUSE');
  assert.deepEqual(state.process_observations, []);
  assert.deepEqual(state.system_memory, []);
  assert.deepEqual(state.learning_candidates, []);
  assert.deepEqual(state.scheduler_decisions, []);
  await h.cleanup();
});

test('process universe is provenance-bound, freshness-aware, and ignores stale older observations', async () => {
  const h = await harness();
  const first = await ingestFreshProcess(h);
  assert.equal(first.source_system, 'SUPABASE');
  assert.equal(first.authority, 'SUPABASE');
  assert.equal(first.stale, false);
  const ignored = await h.intelligence.ingestProcessObservation({
    source_system: 'SUPABASE',
    source_instance: 'xpeibufgzjknrhbhpffp',
    process_kind: 'ROADMAP_MILESTONE',
    process_id: 'C5_AUTONOMOUS_FLEET_RUNTIME_V1',
    state: 'OLDER',
    authority: 'SUPABASE',
    source_cursor: 'cp1:older',
    stale_after_ms: 60_000,
    payload_ref: 'supabase:checkpoint:cp1',
    observed_at: '2026-08-29T17:59:00.000Z',
  });
  assert.equal(ignored.ignored, true);
  assert.equal(h.intelligence.listFreshProcesses()[0].state, 'ACTIVE');
  h.advance(61_000);
  assert.equal(h.intelligence.listFreshProcesses().length, 0);
  assert.equal(h.intelligence.snapshot().processes[0].stale, true);
  await h.cleanup();
});

test('procedural memory and self-learning require verifier evidence and remain branch-local', async () => {
  const h = await harness();
  const episode = await h.intelligence.recordMemory({
    kind: 'EPISODIC',
    memory_key: 'episode:c5-observer',
    value_ref: 'git:research/C5_OBSERVER.md',
    provenance_refs: [{ system: 'GITHUB', ref: 'commit:abc' }],
  });
  const procedure = await h.intelligence.recordMemory({
    kind: 'PROCEDURAL',
    memory_key: 'procedure:reduce-idle-capacity',
    value_ref: 'git:test:system-intelligence-v1',
    provenance_refs: [{ system: 'GITHUB', ref: 'commit:def' }],
    verifier_refs: [{ system: 'TRUSTED_CI', ref: 'ci:system-intelligence:pass' }],
  });
  assert.equal(episode.activation_eligible, false);
  assert.equal(procedure.activation_eligible, true);
  const candidate = await h.intelligence.proposeLearningCandidate({
    target: 'SCHEDULER_HEURISTIC',
    rationale_ref: 'memory:reduce-idle-capacity',
    memory_ids: [episode.memory_id, procedure.memory_id],
    evaluation_plan_ref: 'git:test:system-intelligence-v1',
  });
  const verified = await h.intelligence.verifyLearningCandidate({
    candidate_id: candidate.candidate_id,
    verifier_refs: [{ system: 'TRUSTED_CI', ref: 'ci:benchmark:pass' }],
    replay_pass: true,
    safety_pass: true,
    benchmark_delta: 0.12,
    regression_count: 0,
  });
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.activation_scope, 'BRANCH_LOCAL_ONLY');
  assert.equal(verified.production_activation_authority, false);
  await h.cleanup();
});

test('autonomous scheduler can start independent work while supervisor is busy without granting actuation authority', async () => {
  const h = await harness();
  const process = await ingestFreshProcess(h);
  const a = await bindSchedulerWorker(h, 'agent_a', 'IMPLEMENTER', 1, 'webcontents:101');
  const b = await bindSchedulerWorker(h, 'agent_b', 'RESEARCHER', 1, 'webcontents:102');
  const plan = h.scheduler.plan({
    supervisor_busy: true,
    max_parallel: 6,
    workers: [
      { worker_id: 'agent_a', worker_incarnation_id: a.worker_incarnation_id, role: 'IMPLEMENTER', ready: true },
      { worker_id: 'agent_b', worker_incarnation_id: b.worker_incarnation_id, role: 'RESEARCHER', ready: true },
    ],
    opportunities: [
      {
        objective_key: 'independent-research',
        task_kind: 'RESEARCH',
        work_branch: 'research/memory-eval-v1',
        process_refs: [process.process_key],
        effect_class: 'READ_ONLY',
        dependencies_satisfied: true,
        requires_supervisor_exclusive: false,
        urgency: 2,
        expected_information_gain: 3,
        unblock_count: 1,
        confidence: 0.8,
      },
      {
        objective_key: 'exclusive-review',
        task_kind: 'REVIEW',
        work_branch: 'work/exclusive-review-v1',
        process_refs: [process.process_key],
        effect_class: 'BRANCH_LOCAL',
        dependencies_satisfied: true,
        requires_supervisor_exclusive: true,
        urgency: 10,
        expected_information_gain: 10,
        unblock_count: 10,
        confidence: 1,
      },
    ],
  });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].objective_key, 'independent-research');
  assert.equal(plan.proposals[0].supervisor_busy_at_plan, true);
  assert.equal(plan.proposals[0].automatic_execution_authority, false);
  assert.equal(plan.proposals[0].worker_incarnation_id, a.worker_incarnation_id);
  assert.ok(plan.suppressed.some((x) => x.includes('SUPERVISOR_EXCLUSIVE')));

  const decision = await h.scheduler.recordDecision(plan);
  assert.equal(decision.proposals.length, 1);
  assert.equal(h.store.snapshot().scheduler_decisions.length, 1);
  await h.cleanup();
});

test('scheduler suppresses stale state, production effects, ambiguity, and unsafe branch scopes', async () => {
  const h = await harness();
  const process = await ingestFreshProcess(h, { stale_after_ms: 5_000 });
  h.advance(6_000);
  const plan = h.scheduler.plan({
    workers: [{ worker_id: 'agent_a', ready: true }],
    opportunities: [
      { objective_key: 'stale', work_branch: 'work/stale', process_refs: [process.process_key], effect_class: 'READ_ONLY', dependencies_satisfied: true },
      { objective_key: 'prod', work_branch: 'work/prod', process_refs: [process.process_key], effect_class: 'PRODUCTION', dependencies_satisfied: true },
      { objective_key: 'ambiguous', work_branch: 'work/ambiguous', process_refs: [process.process_key], effect_class: 'BRANCH_LOCAL', dependencies_satisfied: true, ambiguous_effect_barrier: true },
      { objective_key: 'main', work_branch: 'main', process_refs: [process.process_key], effect_class: 'BRANCH_LOCAL', dependencies_satisfied: true },
    ],
  });
  assert.equal(plan.proposals.length, 0);
  assert.ok(plan.suppressed.some((x) => x.includes('STALE_PROCESS_STATE')));
  assert.ok(plan.suppressed.some((x) => x.includes('EFFECT_CLASS')));
  assert.ok(plan.suppressed.some((x) => x.includes('AMBIGUOUS_EFFECT_BARRIER')));
  assert.ok(plan.suppressed.some((x) => x.includes('BRANCH_SCOPE')));
  await h.cleanup();
});
