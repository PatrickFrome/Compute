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
    payload: { tab_id: tabId },
  };
}

for (const invalidBudget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '8', null, undefined]) {
  test(`invalid mutation budget ${String(invalidBudget)} fails closed before effects`, async () => {
    let effects = 0;
    const coordinator = new BrowserBrainParallelFanoutCoordinator({
      readMutationBudget: () => invalidBudget,
      resolveCellKey: (entry) => entry.payload.tab_id,
      execute: async () => {
        effects += 1;
        return 'unexpected';
      },
    });

    await assert.rejects(
      coordinator.dispatch([command('cmd-a', 'tab-a')]),
      (error) => error instanceof BrowserBrainFanoutPlanError
        && error.code === 'invalid_mutation_budget',
    );
    assert.equal(effects, 0);
  });
}

test('positive safe integer mutation budget preserves admitted parallel fanout', async () => {
  const effects = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 2,
    resolveCellKey: (entry) => entry.payload.tab_id,
    execute: async (_entry, context) => {
      effects.push(context.browserCell);
      return context.commandId;
    },
  });

  const result = await coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
  ]);

  assert.deepEqual(new Set(effects), new Set(['tab-a', 'tab-b']));
  assert.deepEqual(result.map((entry) => entry.status), ['fulfilled', 'fulfilled']);
  assert.deepEqual(result.map((entry) => entry.browser_cell), ['tab-a', 'tab-b']);
});
