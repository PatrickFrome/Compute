import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

const invalidLimits = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '128', null];

test('invalid hard batch limits fail closed at construction', () => {
  for (const hardBatchLimit of invalidLimits) {
    assert.throws(
      () => new BrowserBrainParallelFanoutCoordinator({
        execute: async () => undefined,
        hardBatchLimit,
      }),
      (error) => (
        error instanceof BrowserBrainFanoutPlanError
        && error.code === 'invalid_hard_batch_limit'
        && Object.is(error.details.hard_batch_limit, hardBatchLimit)
      ),
    );
  }
});

test('default hard batch limit remains 128 and rejects oversized batches before preflight', async () => {
  let budgetReads = 0;
  let effects = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => {
      budgetReads += 1;
      return 256;
    },
    execute: async () => {
      effects += 1;
    },
  });
  const commands = Array.from({ length: 129 }, (_, index) => ({
    command_id: `cmd-${index}`,
    payload: { tab_id: `tab-${index}` },
  }));

  await assert.rejects(
    coordinator.dispatch(commands),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'hard_batch_limit',
  );
  assert.equal(budgetReads, 0);
  assert.equal(effects, 0);
});

test('explicit valid hard batch limit remains exact', async () => {
  let effects = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 2,
    readMutationBudget: () => 2,
    execute: async (_command, { browserCell }) => {
      effects += 1;
      return browserCell;
    },
  });

  const result = await coordinator.dispatch([
    { command_id: 'cmd-a', payload: { tab_id: 'tab-a' } },
    { command_id: 'cmd-b', payload: { tab_id: 'tab-b' } },
  ]);

  assert.equal(effects, 2);
  assert.deepEqual(result.map((entry) => entry.value), ['tab-a', 'tab-b']);
});
