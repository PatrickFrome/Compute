import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainAdaptiveFanoutRuntime } from '../src/browser-brain-adaptive-fanout-runtime.mjs';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const TAB_MUTATIONS = [
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE',
  'RESOLVE_PROMPT', 'TYPED_CLICK', 'SELECT_TAB', 'CLOSE_TAB',
  'NAVIGATE', 'BACK', 'FORWARD', 'RELOAD',
];

const tab = (index) => `tab_00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

function greenSample(liveCells) {
  return {
    live_cells: liveCells,
    event_loop_utilization: 0.2,
    event_loop_delay_p95_ms: 2,
    max_renderer_cpu_percent: 10,
    main_working_set_mb: 256,
    network_inflight: 2,
    result_ack_rtt_p95_ms: 20,
    command_lease_rtt_p95_ms: 20,
    unresponsive_cells: 0,
    recent_crashes: 0,
  };
}

function runtimeWith(executeRuntimeFenced) {
  return new BrowserBrainAdaptiveFanoutRuntime({
    scheduler: new NativeSupervisorCommandLaneScheduler({
      readConcurrency: 128,
      mutationConcurrency: 32,
    }),
    executeRuntimeFenced,
  });
}

test('all native exact-tab mutation actions pass the allocation-light adaptive validation path', async () => {
  const executed = [];
  const runtime = runtimeWith(async (command, context) => {
    executed.push([command.action, context.browserCell]);
    return command.action;
  });

  for (let index = 0; index < 6; index += 1) runtime.observePressure(greenSample(TAB_MUTATIONS.length));

  const commands = TAB_MUTATIONS.map((action, index) => ({
    command_id: `fast-classify-${index}`,
    action,
    payload: { tab_id: tab(index) },
  }));
  const rows = await runtime.dispatchMutations(commands);

  assert.deepEqual(executed, commands.map((command) => [command.action, command.payload.tab_id]));
  assert.deepEqual(rows.map(({ status }) => status), Array(TAB_MUTATIONS.length).fill('fulfilled'));
  assert.deepEqual(rows.map(({ browser_cell }) => browser_cell), commands.map(({ payload }) => payload.tab_id));
});

test('fast validation still falls back to authoritative fail-closed classification before effects', async () => {
  let effects = 0;
  const runtime = runtimeWith(async () => { effects += 1; });

  const rejected = [
    { command_id: 'read', action: 'CAPTURE', payload: { tab_id: tab(0) } },
    { command_id: 'global', action: 'NEW_TAB', payload: { url: 'https://example.com' } },
    { command_id: 'implicit', action: 'TYPED_CLICK', payload: { role: 'button' } },
    { command_id: 'malformed', action: 'TYPED_CLICK', payload: { tab_id: 'tab_not_exact' } },
  ];

  for (const command of rejected) {
    await assert.rejects(
      runtime.dispatchMutations([command]),
      new RegExp(`tab_mutation_required:${command.action}`),
    );
  }
  assert.equal(effects, 0);
});
