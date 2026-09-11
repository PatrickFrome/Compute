import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';
import {
  NativeSupervisorCommandLaneScheduler,
  clearNativeSupervisorCommandPressureBudget,
} from '../src/native-supervisor-command-lanes.mjs';

const CELL_COUNT = 32;
const AGENT_COUNT = 64;
const STEPS = Math.max(5_000, Number(process.env.METAENGINE_BRAIN_SOAK_STEPS || 20_000));
const tabs = Array.from({ length: CELL_COUNT }, (_, i) => `tab_00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

const processes = Object.freeze([
  Object.freeze({ pid: 1, process_key: '1:1000', creation_time_ms: 1000, type: 'Browser', cpu_percent: 3, memory_working_set_kb: 320000 }),
  ...tabs.map((_, i) => Object.freeze({
    pid: 1000 + i,
    process_key: `${1000 + i}:${2000 + i}`,
    creation_time_ms: 2000 + i,
    type: 'Tab',
    cpu_percent: 5 + (i % 4),
    memory_working_set_kb: 96000 + (i % 3) * 4096,
  })),
]);

const webContents = Object.freeze(tabs.map((tabId, i) => Object.freeze({
  web_contents_id: 1000 + i,
  os_pid: 1000 + i,
  process_key: `${1000 + i}:${2000 + i}`,
  tab_id: tabId,
  destroyed: false,
})));

const semanticTargets = Object.freeze(tabs.map((tabId, i) => Object.freeze({
  tab_id: tabId,
  target_id: `target-${i + 1}`,
  document_generation: 1,
  semantic_revision: 0,
})));

function iso(ms) {
  return new Date(ms).toISOString();
}

function processSnapshot({ sequence, semanticSequence, nowMs, events = [] }) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: iso(nowMs),
    event_driven_lifecycle: true,
    processes,
    web_contents: webContents,
    semantic_plane: {
      sequence: semanticSequence,
      target_count: CELL_COUNT,
      targets: semanticTargets,
    },
    events,
  };
}

function mutation(id, tabId) {
  return {
    command_id: id,
    action: 'TYPED_CLICK',
    platform: 'WINDOWS_SOAK',
    payload: { tab_id: tabId, role: 'button', accessible_name: `button-${id}` },
  };
}

function metricEdge(seq, nowMs) {
  return { seq, type: 'METRICS_SAMPLE', observed_at: iso(nowMs) };
}

test(`continuous Browser Brain soak stays bounded and coordinated (${CELL_COUNT} cells, ${AGENT_COUNT} agents, ${STEPS} semantic edges)`, { timeout: 120_000 }, async () => {
  let nowMs = Date.parse('2026-09-06T12:00:00.000Z');
  let processSeq = 1;
  let semanticSeq = 0;
  let resourceSample = {
    event_loop_utilization: 0.18,
    event_loop_delay_p95_ms: 4,
    network_inflight: 8,
    command_lease_rtt_p95_ms: 35,
    result_ack_rtt_p95_ms: 45,
  };
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32, maxBatch: 128 });
  const activeByCell = new Set();
  let activeMutations = 0;
  let peakMutations = 0;

  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    clock: () => nowMs,
    getExtraPressureSample: () => resourceSample,
    hardBatchLimit: 128,
    executeRuntimeFenced: async (command, context) => {
      const cell = String(context.browserCell || command?.payload?.tab_id || '');
      assert.equal(activeByCell.has(cell), false, `same BrowserCell overlapped: ${cell}`);
      activeByCell.add(cell);
      activeMutations += 1;
      peakMutations = Math.max(peakMutations, activeMutations);
      await new Promise((resolve) => setImmediate(resolve));
      activeMutations -= 1;
      activeByCell.delete(cell);
      return { command_id: command.command_id, runtime_fence_checked: true };
    },
  });

  try {
    coordinator.reconcile(processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs }), {
      cell_by_tab: new Map(tabs.map((tabId, i) => [tabId, {
        cell_id: `cell:${i + 1}`,
        cell_generation: 1,
        provider: i % 2 === 0 ? 'openai' : 'provider-b',
        role: i % 3 === 0 ? 'RESEARCHER' : 'WORKER',
      }])),
    });

    for (let i = 0; i < AGENT_COUNT; i += 1) {
      coordinator.observeAgent({
        agent_id: `agent.${String(i + 1).padStart(3, '0')}`,
        role: i % 4 === 0 ? 'CRITIC' : i % 3 === 0 ? 'RESEARCHER' : 'WORKER',
        provider: i % 2 === 0 ? 'openai' : 'provider-b',
        capabilities: i % 4 === 0 ? ['observe', 'reason', 'critique'] : ['observe', 'reason'],
        generation: 1,
        status: 'READY',
        target_tab_id: tabs[i % CELL_COUNT],
        observed_at: iso(nowMs),
      });
    }
    const routed = coordinator.routeAgents({ required_capabilities: ['observe', 'reason'], limit: 64 });
    assert.equal(routed.candidates.length, AGENT_COUNT);
    assert.equal(routed.assignment_created, false);
    assert.equal(routed.scheduler_authority, false);

    for (let i = 0; i < 6; i += 1) {
      nowMs += 250;
      processSeq += 1;
      const edge = metricEdge(processSeq, nowMs);
      coordinator.observeEdge(edge, {
        process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
    }
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'GREEN');
    assert.equal(coordinator.snapshot().pressure_budget.mutation_concurrency, CELL_COUNT);
    assert.equal(scheduler.snapshot().mutation_concurrency, CELL_COUNT);

    const mutationRows = await coordinator.dispatchMutations(tabs.map((tabId, i) => mutation(`parallel-${i + 1}`, tabId)));
    assert.equal(mutationRows.length, CELL_COUNT);
    assert.equal(mutationRows.every((row) => row.status === 'fulfilled'), true);
    assert.equal(peakMutations, CELL_COUNT, `expected ${CELL_COUNT} concurrent independent BrowserCells, got ${peakMutations}`);

    const beforeBurst = coordinator.snapshot();
    const started = performance.now();
    for (let i = 0; i < STEPS; i += 1) {
      nowMs += 1;
      processSeq += 1;
      semanticSeq += 1;
      const tabId = tabs[i % CELL_COUNT];
      const edge = {
        seq: processSeq,
        type: 'SEMANTIC_EVENT',
        tab_id: tabId,
        web_contents_id: 1000 + (i % CELL_COUNT),
        target_id: `target-${(i % CELL_COUNT) + 1}`,
        semantic_method: 'Accessibility.nodesUpdated',
        semantic_sequence: semanticSeq,
        observed_at: iso(nowMs),
      };
      coordinator.observeEdge(edge, {
        process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
    }
    const elapsedMs = performance.now() - started;
    const afterBurst = coordinator.snapshot();
    const cognition = coordinator.cognitionSnapshot();

    assert.equal(afterBurst.pressure_evaluation_count, beforeBurst.pressure_evaluation_count);
    assert.equal(afterBurst.pressure_reuse_count - beforeBurst.pressure_reuse_count, STEPS);
    assert.equal(cognition.cell_count, CELL_COUNT);
    assert.equal(cognition.cell_fact_count, CELL_COUNT * cognition.facts_per_cell);
    assert.equal(cognition.agent_count, AGENT_COUNT);
    assert.ok(cognition.cell_count <= cognition.max_cells);
    assert.ok(cognition.cell_fact_count <= cognition.max_cells * cognition.facts_per_cell);
    assert.ok(cognition.agent_count <= cognition.max_agents);
    assert.equal(cognition.raw_dom_stored, false);
    assert.equal(cognition.raw_network_stored, false);
    assert.equal(cognition.execution_payload_stored, false);
    assert.equal(afterBurst.second_scheduler, false);
    assert.equal(afterBurst.hidden_queue, false);
    assert.equal(afterBurst.command_leasing, false);

    const planTab = tabs[1];
    const planBinding = coordinator.binding(planTab);
    coordinator.rememberAdvisoryPlan({
      tab_id: planTab,
      intent_id: 'intent.soak.click',
      action: 'TYPED_CLICK',
      candidate_ref: 'node.soak.button',
      semantic_fingerprint: 'fp.soak.semantic',
      locator_fingerprint: 'fp.soak.locator',
      binding_generation: planBinding.binding_generation,
      document_generation: planBinding.document_generation,
      semantic_revision: planBinding.semantic_revision,
    });

    nowMs += 1;
    processSeq += 1;
    semanticSeq += 2;
    const gap = {
      seq: processSeq,
      type: 'SEMANTIC_EVENT',
      tab_id: tabs[0],
      web_contents_id: 1000,
      target_id: 'target-1',
      semantic_method: 'Accessibility.nodesUpdated',
      semantic_sequence: semanticSeq,
      observed_at: iso(nowMs),
    };
    coordinator.observeEdge(gap, {
      process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [gap] }),
    });
    const blocked = coordinator.resolveAdvisoryPlan({
      tab_id: planTab,
      intent_id: 'intent.soak.click',
      action: 'TYPED_CLICK',
      binding_generation: planBinding.binding_generation,
      document_generation: planBinding.document_generation,
      semantic_revision: planBinding.semantic_revision,
      revalidate: () => true,
    });
    assert.equal(blocked.hit, false);
    assert.equal(blocked.reason, 'CAUSAL_RESYNC_REQUIRED');

    nowMs += 250;
    processSeq += 1;
    const resync = { seq: processSeq, type: 'PROCESS_CENSUS_REFRESHED', observed_at: iso(nowMs) };
    coordinator.observeEdge(resync, {
      process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [resync] }),
    });
    const recovered = coordinator.resolveAdvisoryPlan({
      tab_id: planTab,
      intent_id: 'intent.soak.click',
      action: 'TYPED_CLICK',
      binding_generation: planBinding.binding_generation,
      document_generation: planBinding.document_generation,
      semantic_revision: planBinding.semantic_revision,
      revalidate: () => true,
    });
    assert.equal(recovered.hit, true);
    assert.equal(recovered.actuation_eligible, false);

    resourceSample = {
      ...resourceSample,
      event_loop_utilization: 0.94,
      event_loop_delay_p95_ms: 180,
    };
    nowMs += 250;
    processSeq += 1;
    let edge = metricEdge(processSeq, nowMs);
    coordinator.observeEdge(edge, {
      process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
    });
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'RED');
    assert.equal(scheduler.snapshot().mutation_concurrency, 2);

    resourceSample = {
      ...resourceSample,
      event_loop_utilization: 0.16,
      event_loop_delay_p95_ms: 3,
    };
    for (let i = 0; i < 9; i += 1) {
      nowMs += 250;
      processSeq += 1;
      edge = metricEdge(processSeq, nowMs);
      coordinator.observeEdge(edge, {
        process_snapshot: processSnapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
    }
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'GREEN');
    assert.equal(scheduler.snapshot().mutation_concurrency, CELL_COUNT);

    // Malformed effect-bound tab mutation is rejected in the scheduler before
    // executor/maintenance admission, but it remains nonexclusive so 32 valid
    // BrowserCells retain full independent fanout.
    let validActive = 0;
    let validPeak = 0;
    const fencedBatch = [
      { command_id: 'missing-target', action: 'SCROLL', payload: {} },
      ...tabs.map((tabId, i) => mutation(`fenced-parallel-${i + 1}`, tabId)),
    ];
    const fencedRows = await scheduler.drain(fencedBatch, async (command) => {
      assert.notEqual(command.command_id, 'missing-target', 'missing effect target reached executor');
      validActive += 1;
      validPeak = Math.max(validPeak, validActive);
      await new Promise((resolve) => setImmediate(resolve));
      validActive -= 1;
      return { ok: true };
    });
    assert.equal(fencedRows[0].ok, false);
    assert.equal(fencedRows[0].scheduler_rejected, true);
    assert.equal(fencedRows[0].execution_ms, 0);
    assert.equal(fencedRows[0].error, 'native_supervisor_effect_binding_explicit_tab_required:SCROLL');
    assert.equal(fencedRows.slice(1).every((row) => row.ok), true);
    assert.equal(validPeak, CELL_COUNT, `malformed mutation reduced valid cell fanout to ${validPeak}`);

    const evidence = {
      schema: 'metaengine.browser.windows-continuous-brain-soak.v1',
      cells: CELL_COUNT,
      agents: AGENT_COUNT,
      semantic_edges: STEPS,
      elapsed_ms: Math.round(elapsedMs * 100) / 100,
      semantic_edges_per_second: Math.round((STEPS / Math.max(1, elapsedMs)) * 1000),
      peak_parallel_mutations: peakMutations,
      fenced_batch_peak_parallel_mutations: validPeak,
      pressure_evaluations: coordinator.snapshot().pressure_evaluation_count,
      pressure_reuses: coordinator.snapshot().pressure_reuse_count,
      bounded_cell_facts: cognition.cell_fact_count,
      causal_gap_exercised: true,
      red_pressure_exercised: true,
      exact_target_admission_exercised: true,
      malformed_target_global_barrier: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    };
    console.log(JSON.stringify(evidence));
  } finally {
    clearNativeSupervisorCommandPressureBudget();
  }
});
