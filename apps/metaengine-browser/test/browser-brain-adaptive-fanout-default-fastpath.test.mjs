import assert from 'node:assert/strict';
import test from 'node:test';

import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';
import { BrowserBrainAdaptiveFanoutRuntime } from '../src/browser-brain-adaptive-fanout-runtime.mjs';

const WIDTH = 32;

function tab(index) {
  return `tab_00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function greenSample() {
  return {
    live_cells: WIDTH,
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

const commands = Array.from({ length: WIDTH }, (_, index) => ({
  command_id: `runtime-fast-${index}`,
  action: 'TYPED_CLICK',
  payload: {
    tab_id: tab(index),
    role: 'button',
    accessible_name: `button-${index}`,
  },
}));

test('adaptive runtime uses coordinator default BrowserCell fast path for full mutation capacity', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({
    readConcurrency: 128,
    mutationConcurrency: WIDTH,
  });
  const started = [];
  const releases = new Map();
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    hardBatchLimit: WIDTH,
    executeRuntimeFenced: (command, context) => {
      started.push([command.command_id, context.browserCell]);
      return new Promise((resolve) => releases.set(command.command_id, () => resolve(command.command_id)));
    },
  });

  for (let index = 0; index < 6; index += 1) runtime.observePressure(greenSample());
  assert.equal(runtime.snapshot().mutation_concurrency, WIDTH);

  const pending = runtime.dispatchMutations(commands);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, WIDTH);
  assert.deepEqual(
    started,
    commands.map((command) => [command.command_id, command.payload.tab_id]),
  );

  for (let index = WIDTH - 1; index >= 0; index -= 1) {
    releases.get(commands[index].command_id)();
  }
  const results = await pending;
  assert.deepEqual(results.map(({ command_id }) => command_id), commands.map(({ command_id }) => command_id));
  assert.deepEqual(results.map(({ browser_cell }) => browser_cell), commands.map(({ payload }) => payload.tab_id));
  assert.deepEqual(results.map(({ status }) => status), Array(WIDTH).fill('fulfilled'));
});

test('runtime remains fail-closed before any effect when exact BrowserCell evidence is missing', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  let effects = 0;
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    executeRuntimeFenced: () => { effects += 1; },
  });

  await assert.rejects(
    runtime.dispatchMutations([{
      command_id: 'missing-cell',
      action: 'TYPED_CLICK',
      payload: { role: 'button', accessible_name: 'missing cell' },
    }]),
    /browser_brain_adaptive_fanout_tab_mutation_required:TYPED_CLICK/,
  );
  assert.equal(effects, 0);
});
