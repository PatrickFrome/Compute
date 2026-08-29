import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore } from '../src/fleet-runtime-store-v1.mjs';
import { SystemIntelligence } from '../src/system-intelligence-v1.mjs';
import { ProcessObserverRuntime } from '../src/process-observer-runtime-v1.mjs';
import { SystemIntelligenceCoordinator } from '../src/system-intelligence-coordinator-v1.mjs';

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-observer-'));
  const statePath = path.join(dir, 'runtime.json');
  let now = Date.parse('2026-08-29T18:30:00Z');
  let seq = 0;
  const store = new FleetRuntimeStore({ statePath, clock: () => now });
  await store.init();
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const intelligence = new SystemIntelligence({ store, clock: () => now, uuid });
  return {
    dir, store, intelligence, uuid,
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

test('one failing source does not block healthy authoritative observations', async () => {
  const h = await harness();
  const observer = new ProcessObserverRuntime({
    intelligence: h.intelligence,
    clock: h.clock,
    sources: [
      { id: 'supabase', read: async () => ({ cursor: 'sb:1', observations: [observation()] }) },
      { id: 'neon-control-plane', read: async () => { throw new Error('archived_compute_unavailable'); } },
    ],
  });
  const snap = await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1);
  assert.equal(snap.sources.find((x) => x.id === 'supabase').ok, true);
  assert.equal(snap.sources.find((x) => x.id === 'neon-control-plane').ok, false);
  assert.match(snap.sources.find((x) => x.id === 'neon-control-plane').last_error, /archived_compute_unavailable/);
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

test('source failure preserves last known observation but freshness eventually fails closed', async () => {
  const h = await harness();
  let fail = false;
  const observer = new ProcessObserverRuntime({
    intelligence: h.intelligence,
    clock: h.clock,
    sources: [{
      id: 'supabase',
      read: async () => {
        if (fail) throw new Error('temporary_read_failure');
        return { cursor: 'sb:1', observations: [observation({ stale_after_ms: 5_000 })] };
      },
    }],
  });
  await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1);
  fail = true;
  h.advance(2_000);
  await observer.pollOnce();
  assert.equal(h.intelligence.listFreshProcesses().length, 1, 'short source outage should retain fresh last-known authoritative state');
  h.advance(4_000);
  assert.equal(h.intelligence.listFreshProcesses().length, 0, 'expired evidence must not remain scheduler-authoritative');
  assert.equal(h.intelligence.snapshot().processes[0].stale, true);
  await h.cleanup();
});

test('coordinator reconciles durable process state before planning independent work', async () => {
  const h = await harness();
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
    workers: [{ worker_id: 'agent_research', role: 'RESEARCHER', ready: true }],
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
  assert.equal(plan.proposals[0].supervisor_busy_at_plan, true);
  assert.equal(plan.proposals[0].automatic_execution_authority, false);
  assert.equal(h.store.snapshot().scheduler_decisions.length, 1);
  await h.cleanup();
});
