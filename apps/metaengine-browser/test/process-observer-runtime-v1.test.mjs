import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore } from '../src/fleet-runtime-store-v1.mjs';
import { FleetRuntime } from '../src/fleet-runtime-v1.mjs';
import { SystemIntelligence } from '../src/system-intelligence-v1.mjs';
import { ProcessObserverRuntime } from '../src/process-observer-runtime-v1.mjs';
import { SystemIntelligenceCoordinator } from '../src/system-intelligence-coordinator-v1.mjs';

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-observer-'));
  const statePath = path.join(dir, 'runtime.json');
  let now = Date.parse('2026-08-29T18:30:00Z');
  let seq = 0;
  const store = new FleetRuntimeStore({ statePath, clock: () => now });
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const fleetRuntime = new FleetRuntime({ store, clock: () => now, uuid });
  await fleetRuntime.init();
  const intelligence = new SystemIntelligence({ store, clock: () => now, uuid });
  return {
    dir, store, fleetRuntime, intelligence, uuid,
    clock: () => now,
    advance: (ms) => { now += ms; },
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function observation(overrides = {}) {
  return {
    source_system: 'SUPABASE',
    source_instance: 'xpeibufgzjknrhbhpffp',
    process_kind: 'ROADMAP_MILESTONE',
    process_id: 'C5_AUTONOMOUS_FLEET_RUNTIME_V1',
    state: 'ACTIVE',
    authority: 'SUPABASE',
    source_cursor: 'cursor:1',
    stale_after_ms: 30_000,
    payload_ref: 'supabase:checkpoint:cp2',
    ...overrides,
  };
}

test('one failing Supabase projection does not block the healthy authoritative Supabase feed', async () => {
  const h = await harness();
  const observer = new ProcessObserverRuntime({
    intelligence: h.intelligence,
    clock: h.clock,
    sources: [
      { id: 'supabase-authoritative', read: async () => ({ cursor: 'sb:1', observations: [observation()] }) },
      { id: 'supabase-secondary-projection', read: async () => { throw new Error('supabase_projection_unavailable'); } },
    ],
  });
  const snap = await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1);
  assert.equal(snap.sources.find((x) => x.id === 'supabase-authoritative').ok, true);
  assert.equal(snap.sources.find((x) => x.id === 'supabase-secondary-projection').ok, false);
  assert.match(snap.sources.find((x) => x.id === 'supabase-secondary-projection').last_error, /supabase_projection_unavailable/);
  await h.cleanup();
});

test('Neon is rejected as a process source and cannot compete with Supabase authority', async () => {
  const h = await harness();
  await assert.rejects(() => h.intelligence.ingestProcessObservation({
    source_system: 'NEON',
    source_instance: 'legacy-neon',
    process_kind: 'ROADMAP_MILESTONE',
    process_id: 'C5_AUTONOMOUS_FLEET_RUNTIME_V1',
    state: 'ACTIVE',
    authority: 'SUPABASE',
    source_cursor: 'legacy:1',
    stale_after_ms: 30_000,
  }), /process_source_invalid/);
  assert.equal(h.intelligence.snapshot().policy.database_authority, 'SUPABASE_ONLY');
  await h.cleanup();
});

test('concurrent polls coalesce into one source read and one ingestion pass', async () => {
  const h = await harness();
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const observer = new ProcessObserverRuntime({
    intelligence: h.intelligence,
    clock: h.clock,
    sources: [{
      id: 'supabase',
      read: async () => {
        reads += 1;
        await gate;
        return { cursor: 'sb:1', observations: [observation()] };
      },
    }],
  });
  const a = observer.pollOnce();
  const b = observer.pollOnce();
  release();
  await Promise.all([a, b]);
  assert.equal(reads, 1);
  assert.equal(h.intelligence.snapshot().processes.length, 1);
  await h.cleanup();
});

test('Supabase source failure preserves last known observation but freshness eventually fails closed', async () => {
  const h = await harness();
  let fail = false;
  const observer = new ProcessObserverRuntime({
    intelligence: h.intelligence,
    clock: h.clock,
    sources: [{
      id: 'supabase',
      read: async () => {
        if (fail) throw new Error('temporary_supabase_read_failure');
        return { cursor: 'sb:1', observations: [observation({ stale_after_ms: 5_000 })] };
      },
    }],
  });
  await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1);
  fail = true;
  h.advance(2_000);
  await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1, 'short Supabase outage should retain fresh last-known authoritative state');
  h.advance(4_000);
  assert.equal(h.intelligence.listFreshProcesses().length, 0, 'expired evidence must not remain scheduler-authoritative');
  assert.equal(h.intelligence.snapshot().processes[0].stale, true);
  await h.cleanup();
});

test('coordinator reconciles durable process state before planning independent work', async () => {
  const h = await harness();
  const binding = await h.fleetRuntime.bindWorkerIncarnation({
    agent_id: 'agent_research',
    role: 'RESEARCHER',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab-research',
    target_id: 'webcontents:201',
    generation_epoch: 1,
    conversation_epoch: 0,
  });
  const coordinator = new SystemIntelligenceCoordinator({
    store: h.store,
    clock: h.clock,
    uuid: h.uuid,
    processSources: [{ id: 'github', read: async () => ({
      cursor: 'git:c54b91e',
      observations: [observation({
        source_system: 'GITHUB',
        source_instance: 'PatrickFrome/Compute',
        process_kind: 'WORK_BRANCH',
        process_id: 'work/convergence-fleet-runtime-v1',
        authority: 'GITHUB',
        source_cursor: 'c54b91e9f64c2024d364accebc0536b79f352daa',
        payload_ref: 'github:branch:work/convergence-fleet-runtime-v1',
      })],
    }) }],
  });
  await coordinator.init();
  await coordinator.reconcileNow();
  const process = coordinator.snapshot().intelligence.processes[0];
  const plan = await coordinator.planIndependentWork({
    supervisor_busy: true,
    workers: [{ worker_id: 'agent_research', worker_incarnation_id: binding.worker_incarnation_id, role: 'RESEARCHER', ready: true }],
    opportunities: [{
      objective_key: 'memory-research',
      task_kind: 'RESEARCH',
      work_branch: 'research/system-memory-v1',
      process_refs: [process.process_key],
      effect_class: 'READ_ONLY',
      dependencies_satisfied: true,
      requires_supervisor_exclusive: false,
      urgency: 1,
      expected_information_gain: 4,
      unblock_count: 2,
      confidence: 0.9,
    }],
  });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].worker_incarnation_id, binding.worker_incarnation_id);
  assert.equal(plan.proposals[0].supervisor_busy_at_plan, true);
  assert.equal(plan.proposals[0].automatic_execution_authority, false);
  assert.equal(h.store.snapshot().scheduler_decisions.length, 1);
  await h.cleanup();
});
