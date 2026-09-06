import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';
import {
  NativeSupervisorCommandLaneScheduler,
  clearNativeSupervisorCommandPressureBudget,
} from '../src/native-supervisor-command-lanes.mjs';

const CELL_COUNT = 128;
const AGENT_COUNT = 128;
const MUTATION_LANES = 32;
const STEPS = Math.max(100_000, Number(process.env.METAENGINE_BRAIN_ENDURANCE_STEPS || 1_000_000));
const YIELD_EVERY = 10_000;
const tabs = Array.from({ length: CELL_COUNT }, (_, i) => `tab_00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

const processes = Object.freeze([
  Object.freeze({ pid: 1, process_key: '1:1000', creation_time_ms: 1000, type: 'Browser', cpu_percent: 4, memory_working_set_kb: 360000 }),
  ...tabs.map((_, i) => Object.freeze({
    pid: 2000 + i,
    process_key: `${2000 + i}:${4000 + i}`,
    creation_time_ms: 4000 + i,
    type: 'Tab',
    cpu_percent: 3 + (i % 5),
    memory_working_set_kb: 88000 + (i % 4) * 4096,
  })),
]);

const webContents = Object.freeze(tabs.map((tabId, i) => Object.freeze({
  web_contents_id: 2000 + i,
  os_pid: 2000 + i,
  process_key: `${2000 + i}:${4000 + i}`,
  tab_id: tabId,
  destroyed: false,
})));

const semanticTargets = Object.freeze(tabs.map((tabId, i) => Object.freeze({
  tab_id: tabId,
  target_id: `endurance-target-${i + 1}`,
  document_generation: 1,
  semantic_revision: 0,
})));

function iso(ms) {
  return new Date(ms).toISOString();
}

function snapshot({ sequence, semanticSequence, nowMs, events = [] }) {
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

function metric(seq, nowMs) {
  return { seq, type: 'METRICS_SAMPLE', observed_at: iso(nowMs) };
}

function mutation(id, tabId) {
  return {
    command_id: id,
    action: 'TYPED_CLICK',
    platform: 'WINDOWS_ENDURANCE',
    payload: { tab_id: tabId, role: 'button', accessible_name: `endurance-${id}` },
  };
}

test(`Windows Browser Brain endurance stays bounded (${CELL_COUNT} cells, ${AGENT_COUNT} agents, ${STEPS} semantic edges)`, { timeout: 180_000 }, async () => {
  let nowMs = Date.parse('2026-09-06T15:00:00.000Z');
  let processSeq = 1;
  let semanticSeq = 0;
  let resourceSample = {
    event_loop_utilization: 0.17,
    event_loop_delay_p95_ms: 4,
    network_inflight: 12,
    command_lease_rtt_p95_ms: 32,
    result_ack_rtt_p95_ms: 41,
  };
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: MUTATION_LANES, maxBatch: 128 });
  const activeCells = new Set();
  let activeMutations = 0;
  let peakMutations = 0;

  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    clock: () => nowMs,
    getExtraPressureSample: () => resourceSample,
    hardBatchLimit: 128,
    executeRuntimeFenced: async (command, context) => {
      const cell = String(context.browserCell || command?.payload?.tab_id || '');
      assert.equal(activeCells.has(cell), false, `same BrowserCell overlapped: ${cell}`);
      activeCells.add(cell);
      activeMutations += 1;
      peakMutations = Math.max(peakMutations, activeMutations);
      await new Promise((resolve) => setImmediate(resolve));
      activeMutations -= 1;
      activeCells.delete(cell);
      return { command_id: command.command_id, runtime_fence_checked: true };
    },
  });

  try {
    coordinator.reconcile(snapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs }), {
      cell_by_tab: new Map(tabs.map((tabId, i) => [tabId, {
        cell_id: `endurance-cell:${i + 1}`,
        cell_generation: 1,
        provider: i % 2 === 0 ? 'openai' : 'provider-b',
        role: i % 5 === 0 ? 'RESEARCHER' : 'WORKER',
      }])),
    });

    for (let i = 0; i < AGENT_COUNT; i += 1) {
      coordinator.observeAgent({
        agent_id: `agent.endurance.${String(i + 1).padStart(3, '0')}`,
        role: i % 5 === 0 ? 'CRITIC' : i % 3 === 0 ? 'RESEARCHER' : 'WORKER',
        provider: i % 2 === 0 ? 'openai' : 'provider-b',
        capabilities: ['observe', 'reason'],
        generation: 1,
        status: 'READY',
        target_tab_id: tabs[i],
        observed_at: iso(nowMs),
      });
    }
    const agentState = coordinator.cognitionSnapshot();
    assert.equal(agentState.agent_count, AGENT_COUNT);
    assert.equal(agentState.max_agents, AGENT_COUNT);
    const route = coordinator.routeAgents({ required_capabilities: ['observe', 'reason'], limit: 128 });
    assert.equal(route.candidates.length, 64);
    assert.equal(route.assignment_created, false);
    assert.equal(route.scheduler_authority, false);

    for (let i = 0; i < 6; i += 1) {
      nowMs += 250;
      processSeq += 1;
      const edge = metric(processSeq, nowMs);
      coordinator.observeEdge(edge, {
        process_snapshot: snapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
    }
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'GREEN');
    assert.equal(scheduler.snapshot().mutation_concurrency, MUTATION_LANES);

    const mutationRows = await coordinator.dispatchMutations(
      tabs.slice(0, MUTATION_LANES).map((tabId, i) => mutation(`endurance-parallel-${i + 1}`, tabId)),
    );
    assert.equal(mutationRows.length, MUTATION_LANES);
    assert.equal(mutationRows.every((row) => row.status === 'fulfilled'), true);
    assert.equal(peakMutations, MUTATION_LANES);

    const before = coordinator.snapshot();
    const started = performance.now();
    for (let i = 0; i < STEPS; i += 1) {
      nowMs += 1;
      processSeq += 1;
      semanticSeq += 1;
      const index = i % CELL_COUNT;
      const edge = {
        seq: processSeq,
        type: 'SEMANTIC_EVENT',
        tab_id: tabs[index],
        web_contents_id: 2000 + index,
        target_id: `endurance-target-${index + 1}`,
        semantic_method: 'Accessibility.nodesUpdated',
        semantic_sequence: semanticSeq,
        observed_at: iso(nowMs),
      };
      coordinator.observeEdge(edge, {
        process_snapshot: snapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
      if ((i + 1) % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    const elapsedMs = performance.now() - started;
    const after = coordinator.snapshot();
    const cognition = coordinator.cognitionSnapshot();

    assert.equal(after.pressure_evaluation_count, before.pressure_evaluation_count);
    assert.equal(after.pressure_reuse_count - before.pressure_reuse_count, STEPS);
    assert.equal(cognition.cell_count, CELL_COUNT);
    assert.equal(cognition.max_cells, CELL_COUNT);
    assert.equal(cognition.cell_fact_count, CELL_COUNT * cognition.facts_per_cell);
    assert.equal(cognition.agent_count, AGENT_COUNT);
    assert.equal(cognition.max_agents, AGENT_COUNT);
    assert.equal(cognition.bounded_memory, true);
    assert.equal(cognition.raw_dom_stored, false);
    assert.equal(cognition.raw_network_stored, false);
    assert.equal(cognition.execution_payload_stored, false);
    assert.equal(after.second_scheduler, false);
    assert.equal(after.hidden_queue, false);
    assert.equal(after.command_leasing, false);

    resourceSample = {
      ...resourceSample,
      event_loop_utilization: 0.96,
      event_loop_delay_p95_ms: 220,
    };
    nowMs += 250;
    processSeq += 1;
    let edge = metric(processSeq, nowMs);
    coordinator.observeEdge(edge, {
      process_snapshot: snapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
    });
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'RED');
    assert.equal(scheduler.snapshot().mutation_concurrency, 2);

    resourceSample = {
      ...resourceSample,
      event_loop_utilization: 0.14,
      event_loop_delay_p95_ms: 2,
    };
    for (let i = 0; i < 9; i += 1) {
      nowMs += 250;
      processSeq += 1;
      edge = metric(processSeq, nowMs);
      coordinator.observeEdge(edge, {
        process_snapshot: snapshot({ sequence: processSeq, semanticSequence: semanticSeq, nowMs, events: [edge] }),
      });
    }
    assert.equal(coordinator.snapshot().pressure_budget.pressure_band, 'GREEN');
    assert.equal(scheduler.snapshot().mutation_concurrency, MUTATION_LANES);

    console.log(JSON.stringify({
      schema: 'metaengine.browser.windows-brain-endurance-128.v1',
      cells: CELL_COUNT,
      agents: AGENT_COUNT,
      semantic_edges: STEPS,
      elapsed_ms: Math.round(elapsedMs * 100) / 100,
      semantic_edges_per_second: Math.round((STEPS / Math.max(1, elapsedMs)) * 1000),
      event_loop_yields: Math.floor(STEPS / YIELD_EVERY),
      peak_parallel_mutations: peakMutations,
      pressure_evaluations: coordinator.snapshot().pressure_evaluation_count,
      pressure_reuses: coordinator.snapshot().pressure_reuse_count,
      bounded_cell_facts: cognition.cell_fact_count,
      max_agents: cognition.max_agents,
      red_pressure_exercised: true,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    }));
  } finally {
    clearNativeSupervisorCommandPressureBudget();
  }
});
