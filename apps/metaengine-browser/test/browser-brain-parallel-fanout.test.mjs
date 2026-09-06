import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

function command(commandId, tabId, extra = {}) {
  return {
    command_id: commandId,
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: {
      tab_id: tabId,
      provider: extra.provider ?? 'opaque-provider',
      action: extra.action ?? { kind: 'opaque-action', value: commandId },
    },
    ...extra.command,
  };
}

test('starts independent BrowserCell effects concurrently after one-shot admission', async () => {
  const started = [];
  const releases = new Map();
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 2,
    execute: async (_command, context) => {
      started.push(context.browserCell);
      await new Promise((resolve) => releases.set(context.browserCell, resolve));
      return `done:${context.browserCell}`;
    },
  });

  const dispatchPromise = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
  ]);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(started), new Set(['tab-a', 'tab-b']));

  releases.get('tab-a')();
  releases.get('tab-b')();
  const result = await dispatchPromise;

  assert.deepEqual(result.map((entry) => entry.status), ['fulfilled', 'fulfilled']);
});

test('rejects pressure overflow before any physical effect', async () => {
  let effects = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 1,
    execute: async () => {
      effects += 1;
    },
  });

  await assert.rejects(
    coordinator.dispatch([command('cmd-a', 'tab-a'), command('cmd-b', 'tab-b')]),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'pressure_budget_exceeded',
  );
  assert.equal(effects, 0);
});

test('rejects same-cell overlap before any effect instead of hiding a queue', async () => {
  let effects = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 8,
    execute: async () => {
      effects += 1;
    },
  });

  await assert.rejects(
    coordinator.dispatch([command('cmd-a', 'tab-a'), command('cmd-b', 'tab-a')]),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'same_cell_overlap',
  );
  assert.equal(effects, 0);
});

test('requires explicit BrowserCell binding and never falls back to selection/platform', async () => {
  let effects = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 8,
    execute: async () => {
      effects += 1;
    },
  });

  await assert.rejects(
    coordinator.dispatch([command('cmd-a', '')]),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'missing_browser_cell',
  );
  assert.equal(effects, 0);
});

test('keeps provider-neutral command object opaque and unchanged', async () => {
  const original = command('cmd-a', 'tab-a', {
    provider: 'future-provider-x',
    action: { kind: 'custom', nested: { value: 42 } },
  });
  let observed = null;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 1,
    execute: async (received) => {
      observed = received;
      return 'ok';
    },
  });

  const result = await coordinator.dispatch([original]);
  assert.equal(observed, original);
  assert.equal(result[0].value, 'ok');
});

test('executor rejection is reported once with no blind retry and peers still settle', async () => {
  const calls = new Map();
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 2,
    execute: async (_command, context) => {
      calls.set(context.commandId, (calls.get(context.commandId) ?? 0) + 1);
      if (context.commandId === 'cmd-a') throw new Error('ambiguous physical outcome');
      return 'peer-ok';
    },
  });

  const result = await coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
  ]);

  assert.equal(calls.get('cmd-a'), 1);
  assert.equal(calls.get('cmd-b'), 1);
  assert.equal(result[0].status, 'rejected');
  assert.equal(result[1].status, 'fulfilled');
});

test('pre-aborted signal rejects before budget read or execution', async () => {
  let budgetReads = 0;
  let effects = 0;
  const controller = new AbortController();
  controller.abort();

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => {
      budgetReads += 1;
      return 8;
    },
    execute: async () => {
      effects += 1;
    },
  });

  await assert.rejects(
    coordinator.dispatch([command('cmd-a', 'tab-a')], { signal: controller.signal }),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'aborted',
  );
  assert.equal(budgetReads, 0);
  assert.equal(effects, 0);
});
