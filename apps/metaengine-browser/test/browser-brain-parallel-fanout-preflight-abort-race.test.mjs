import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

function command(commandId, tabId) {
  return {
    command_id: commandId,
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: {
      tab_id: tabId,
      provider: 'opaque-provider',
      action: { kind: 'opaque-action', value: commandId },
    },
  };
}

test('abort fails fast while provider-backed read-only preflight is still pending', async () => {
  const controller = new AbortController();
  const effects = [];
  const started = [];
  const releases = [];
  const pending = (label, value) => new Promise((resolve) => {
    started.push(label);
    releases.push(() => resolve(value));
  });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => pending('budget', 2),
    resolveCellKey: (entry) => pending(`cell:${entry.command_id}`, entry.payload.tab_id),
    execute: (_entry, context) => {
      effects.push(context.commandId);
      return `ok:${context.commandId}`;
    },
  });

  const dispatchPromise = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
  ], { signal: controller.signal });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, ['budget', 'cell:cmd-a', 'cell:cmd-b']);
  assert.deepEqual(effects, []);

  controller.abort();

  await assert.rejects(
    dispatchPromise,
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'aborted',
  );
  assert.deepEqual(effects, []);

  for (const release of releases) release();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(effects, []);
});

test('flat preflight aggregation preserves exact BrowserCell routing when lanes settle out of order', async () => {
  const releases = new Map();
  const effects = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => Promise.resolve(3),
    resolveCellKey: (entry) => new Promise((resolve) => {
      releases.set(entry.command_id, () => resolve(entry.payload.tab_id));
    }),
    execute: (_entry, context) => {
      effects.push([context.commandId, context.browserCell]);
      return `ok:${context.commandId}`;
    },
  });

  const dispatchPromise = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
    command('cmd-c', 'tab-c'),
  ]);

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(effects, []);
  releases.get('cmd-c')();
  releases.get('cmd-a')();
  releases.get('cmd-b')();

  const results = await dispatchPromise;
  assert.deepEqual(effects, [
    ['cmd-a', 'tab-a'],
    ['cmd-b', 'tab-b'],
    ['cmd-c', 'tab-c'],
  ]);
  assert.deepEqual(results.map((entry) => entry.browser_cell), ['tab-a', 'tab-b', 'tab-c']);
});
