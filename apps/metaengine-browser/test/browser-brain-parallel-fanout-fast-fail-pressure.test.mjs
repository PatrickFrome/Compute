import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

test('invalid pressure evidence fails before unrelated resolver preflight settles', async () => {
  let resolverStarted = 0;
  let resolverReleased = false;
  let effects = 0;
  let releaseResolvers;
  const resolverGate = new Promise((resolve) => {
    releaseResolvers = () => {
      resolverReleased = true;
      resolve('tab-resolved');
    };
  });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 2,
    readMutationBudget: () => 0,
    resolveCellKey: async () => {
      resolverStarted += 1;
      return resolverGate;
    },
    execute: async () => {
      effects += 1;
    },
  });

  const releaseTimer = setTimeout(releaseResolvers, 25);
  try {
    await assert.rejects(
      coordinator.dispatch([
        { command_id: 'cmd-a', payload: { provider: 'alpha' } },
        { command_id: 'cmd-b', payload: { provider: 'beta' } },
      ]),
      (error) => (
        error instanceof BrowserBrainFanoutPlanError
        && error.code === 'invalid_mutation_budget'
        && error.details.mutation_budget === 0
      ),
    );

    assert.equal(resolverStarted, 2);
    assert.equal(resolverReleased, false);
    assert.equal(effects, 0);
  } finally {
    clearTimeout(releaseTimer);
    releaseResolvers();
  }
});
