import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

test('insufficient pressure budget fails before unrelated BrowserCell preflight settles', async () => {
  const resolverStarted = [];
  let resolverReleased = false;
  let effects = 0;
  let releaseResolver;
  const resolverGate = new Promise((resolve) => {
    releaseResolver = () => {
      resolverReleased = true;
      resolve('tab-b');
    };
  });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 2,
    readMutationBudget: () => 1,
    resolveCellKey: async (command) => {
      resolverStarted.push(command.command_id);
      if (command.command_id === 'cmd-a') return 'tab-a';
      return resolverGate;
    },
    execute: async () => {
      effects += 1;
    },
  });

  const releaseTimer = setTimeout(releaseResolver, 25);
  try {
    await assert.rejects(
      coordinator.dispatch([
        { command_id: 'cmd-a', payload: { provider: 'alpha' } },
        { command_id: 'cmd-b', payload: { provider: 'beta' } },
      ]),
      (error) => (
        error instanceof BrowserBrainFanoutPlanError
        && error.code === 'pressure_budget_exceeded'
        && error.details.batch_size === 2
        && error.details.mutation_budget === 1
      ),
    );

    assert.deepEqual(resolverStarted.sort(), ['cmd-a', 'cmd-b']);
    assert.equal(resolverReleased, false);
    assert.equal(effects, 0);
  } finally {
    clearTimeout(releaseTimer);
    releaseResolver();
  }
});
