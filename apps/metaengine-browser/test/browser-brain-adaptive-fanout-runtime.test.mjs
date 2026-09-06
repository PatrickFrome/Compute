import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';
import { BrowserBrainAdaptiveFanoutRuntime } from '../src/browser-brain-adaptive-fanout-runtime.mjs';

const tab = (suffix) => `tab_00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const command = (id, tabId) => ({
  command_id: id,
  action: 'TYPED_CLICK',
  platform: 'TEST',
  payload: { tab_id: tabId, role: 'button', accessible_name: `button-${id}` },
});

function greenSample(liveCells = 32) {
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

test('one pressure sample tunes existing scheduler and fanout budget without new authority', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 1, mutationConcurrency: 1 });
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({ scheduler, executeRuntimeFenced: async () => ({ ok: true }) });

  runtime.observePressure(greenSample(32));
  runtime.observePressure(greenSample(32));
  const snapshot = runtime.observePressure(greenSample(32));

  assert.equal(snapshot.pressure_band, 'GREEN');
  assert.equal(snapshot.mutation_concurrency, 32);
  assert.equal(snapshot.scheduler.mutation_concurrency, 32);
  assert.equal(snapshot.scheduler.read_concurrency, 128);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.dedicated_timer, false);
  assert.equal(snapshot.authority_effect, false);
});

test('RED pressure immediately shrinks both scheduler and fanout admission before any effect', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32 });
  let effects = 0;
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    executeRuntimeFenced: async () => { effects += 1; return { ok: true }; },
  });

  const snapshot = runtime.observePressure({ ...greenSample(32), unresponsive_cells: 1 });
  assert.equal(snapshot.pressure_band, 'RED');
  assert.equal(snapshot.mutation_concurrency, 2);
  assert.equal(snapshot.scheduler.mutation_concurrency, 2);

  await assert.rejects(
    runtime.dispatchMutations([
      command('c1', tab('1')),
      command('c2', tab('2')),
      command('c3', tab('3')),
    ]),
    (error) => error?.code === 'pressure_budget_exceeded',
  );
  assert.equal(effects, 0);
});

test('independent BrowserCells start concurrently through the injected runtime-fenced executor', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 8, mutationConcurrency: 8 });
  const started = [];
  const releases = new Map();
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    executeRuntimeFenced: async (cmd, context) => {
      started.push({ id: cmd.command_id, cell: context.browserCell });
      await new Promise((resolve) => releases.set(cmd.command_id, resolve));
      return { command_id: cmd.command_id };
    },
  });

  runtime.observePressure({ ...greenSample(8), event_loop_utilization: 0.7 });
  const pending = runtime.dispatchMutations([
    command('c1', tab('1')),
    command('c2', tab('2')),
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, 2);
  assert.notEqual(started[0].cell, started[1].cell);
  releases.get('c1')();
  releases.get('c2')();
  const rows = await pending;
  assert.deepEqual(rows.map((row) => row.status), ['fulfilled', 'fulfilled']);
});

test('global, read-only, implicit-tab and same-cell mutations fail closed before physical execution', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  let effects = 0;
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    executeRuntimeFenced: async () => { effects += 1; },
  });

  await assert.rejects(
    runtime.dispatchMutations([{ command_id: 'g1', action: 'NEW_TAB', payload: { url: 'https://example.com' } }]),
    /tab_mutation_required:NEW_TAB/,
  );
  await assert.rejects(
    runtime.dispatchMutations([{ command_id: 'r1', action: 'CAPTURE', payload: { tab_id: tab('1') } }]),
    /tab_mutation_required:CAPTURE/,
  );
  await assert.rejects(
    runtime.dispatchMutations([{ command_id: 'm1', action: 'TYPED_CLICK', payload: { role: 'button', accessible_name: 'x' } }]),
    /tab_mutation_required:TYPED_CLICK/,
  );
  await assert.rejects(
    runtime.dispatchMutations([command('c1', tab('1')), command('c2', tab('1'))]),
    (error) => error?.code === 'same_cell_overlap',
  );
  assert.equal(effects, 0);
});

test('ambiguous executor rejection is surfaced once and never retried', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  let calls = 0;
  const runtime = new BrowserBrainAdaptiveFanoutRuntime({
    scheduler,
    executeRuntimeFenced: async () => {
      calls += 1;
      throw new Error('ambiguous_after_physical_dispatch');
    },
  });

  const rows = await runtime.dispatchMutations([command('c1', tab('1'))]);
  assert.equal(calls, 1);
  assert.equal(rows[0].status, 'rejected');
  assert.match(String(rows[0].reason?.message || rows[0].reason), /ambiguous_after_physical_dispatch/);
});
