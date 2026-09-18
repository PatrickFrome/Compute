import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

test('same-cell overlap fails before unrelated BrowserCell preflight settles', async () => {
  const resolverStarted = [];
  let blockedReleased = false;
  let effects = 0;
  let releaseBlocked;
  const blockedGate = new Promise((resolve) => {
    releaseBlocked = () => {
      blockedReleased = true;
      resolve('tab-c');
    };
  });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 3,
    readMutationBudget: () => 3,
    resolveCellKey: async (command) => {
      resolverStarted.push(command.command_id);
      if (command.command_id === 'cmd-c') return blockedGate;
      return 'tab-shared';
    },
    execute: async () => {
      effects += 1;
    },
  });

  const releaseTimer = setTimeout(releaseBlocked, 25);
  try {
    await assert.rejects(
      coordinator.dispatch([
        { command_id: 'cmd-a', payload: { provider: 'alpha' } },
        { command_id: 'cmd-b', payload: { provider: 'beta' } },
        { command_id: 'cmd-c', payload: { provider: 'gamma' } },
      ]),
      (error) => (
        error instanceof BrowserBrainFanoutPlanError
        && error.code === 'same_cell_overlap'
        && error.details.browser_cell === 'tab-shared'
      ),
    );

    assert.deepEqual(resolverStarted.sort(), ['cmd-a', 'cmd-b', 'cmd-c']);
    assert.equal(blockedReleased, false);
    assert.equal(effects, 0);
  } finally {
    clearTimeout(releaseTimer);
    releaseBlocked();
  }
});
