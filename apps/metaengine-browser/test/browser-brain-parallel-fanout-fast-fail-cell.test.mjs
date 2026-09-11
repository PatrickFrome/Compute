import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

test('missing BrowserCell evidence fails before unrelated resolver preflight settles', async () => {
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
    readMutationBudget: () => 2,
    resolveCellKey: async (command) => {
      resolverStarted.push(command.command_id);
      if (command.command_id === 'cmd-a') return null;
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
        && error.code === 'missing_browser_cell'
        && error.details.command_id === 'cmd-a'
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
