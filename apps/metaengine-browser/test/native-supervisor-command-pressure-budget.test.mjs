import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NativeSupervisorCommandLaneScheduler,
  applyNativeSupervisorCommandPressureBudget,
  clearNativeSupervisorCommandPressureBudget,
  nativeSupervisorCommandPressureBudgetSnapshot,
} from '../src/native-supervisor-command-lanes.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000301';
const TAB_B = 'tab_00000000-0000-4000-8000-000000000302';
const TAB_C = 'tab_00000000-0000-4000-8000-000000000303';

function mutation(id, tabId) {
  return {
    command_id: id,
    action: 'TYPED_CLICK',
    payload: { tab_id: tabId, role: 'button', accessible_name: id },
  };
}

test('process pressure budget changes effective concurrency of the existing scheduler without carrying commands', async () => {
  clearNativeSupervisorCommandPressureBudget();
  const scheduler = new NativeSupervisorCommandLaneScheduler({
    readConcurrency: 1,
    mutationConcurrency: 1,
    maxBatch: 8,
  });
  const release = new Map();
  const started = [];

  try {
    const applied = applyNativeSupervisorCommandPressureBudget({
      pressure_band: 'GREEN',
      read_concurrency: 128,
      mutation_concurrency: 3,
      live_cells: 3,
    });
    assert.equal(applied.contains_commands, false);
    assert.equal(applied.contains_leases, false);
    assert.equal(applied.scheduler_authority, false);
    assert.equal(scheduler.snapshot().configured_mutation_concurrency, 1);
    assert.equal(scheduler.snapshot().mutation_concurrency, 3);
    assert.equal(scheduler.snapshot().pressure_budget_bound, true);

    const running = scheduler.drain([
      mutation('a', TAB_A),
      mutation('b', TAB_B),
      mutation('c', TAB_C),
    ], async (command) => {
      started.push(command.command_id);
      await new Promise((resolve) => release.set(command.command_id, resolve));
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started.sort(), ['a', 'b', 'c']);
    release.get('a')();
    release.get('b')();
    release.get('c')();
    await running;

    const register = nativeSupervisorCommandPressureBudgetSnapshot();
    assert.equal(register.mutation_concurrency, 3);
    assert.equal(register.contains_commands, false);
    assert.equal(register.execution_authority, false);
  } finally {
    clearNativeSupervisorCommandPressureBudget();
  }

  assert.equal(scheduler.snapshot().pressure_budget_bound, false);
  assert.equal(scheduler.snapshot().mutation_concurrency, 1);
});

test('cleared register restores configured scheduler admission without creating another scheduler', async () => {
  clearNativeSupervisorCommandPressureBudget();
  const scheduler = new NativeSupervisorCommandLaneScheduler({ mutationConcurrency: 1, maxBatch: 4 });
  const release = [];
  let active = 0;
  let maxActive = 0;

  const running = scheduler.drain([
    mutation('a', TAB_A),
    mutation('b', TAB_B),
  ], async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => release.push(resolve));
    active -= 1;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maxActive, 1);
  assert.equal(release.length, 1);
  release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(release.length, 1);
  release.shift()();
  await running;
  assert.equal(maxActive, 1);
  assert.equal(scheduler.snapshot().process_pressure_budget_register, true);
  assert.equal(scheduler.snapshot().pressure_register_contains_commands, false);
});
