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

function coordinator(overrides = {}) {
  return new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 8,
    execute: async () => undefined,
    ...overrides,
  });
}

async function expectPlanReject({ commands, code, overrides = {}, signal }) {
  let effects = 0;
  const instance = coordinator({
    ...overrides,
    execute: async (...args) => {
      effects += 1;
      return overrides.execute?.(...args);
    },
  });

  await assert.rejects(
    instance.dispatch(commands, { signal }),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === code,
  );
  assert.equal(effects, 0);
}

test('starts independent BrowserCell effects concurrently after one-shot admission', async () => {
  const started = [];
  const releases = new Map();
  const instance = coordinator({
    readMutationBudget: () => 2,
    execute: async (_command, context) => {
      started.push(context.browserCell);
      await new Promise((resolve) => releases.set(context.browserCell, resolve));
      return `done:${context.browserCell}`;
    },
  });

  const dispatchPromise = instance.dispatch([
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

test('full-width 128 BrowserCell fanout preserves exact caller order', async () => {
  const width = 128;
  const commands = Array.from({ length: width }, (_, index) =>
    command(`cmd-${index}`, `tab-${index}`));
  const resolved = [];
  const started = [];
  const instance = coordinator({
    hardBatchLimit: width,
    readMutationBudget: () => width,
    resolveCellKey: async (entry) => {
      resolved.push(entry.payload.tab_id);
      return entry.payload.tab_id;
    },
    execute: async (_command, context) => {
      assert.equal(resolved.length, width);
      started.push(context.browserCell);
      return context.commandId;
    },
  });

  const result = await instance.dispatch(commands);

  assert.equal(resolved.length, width);
  assert.equal(new Set(resolved).size, width);
  assert.equal(started.length, width);
  assert.equal(new Set(started).size, width);
  assert.deepEqual(result.map((entry) => entry.command_id), commands.map((entry) => entry.command_id));
  assert.deepEqual(result.map((entry) => entry.browser_cell), commands.map((entry) => entry.payload.tab_id));
  assert.deepEqual(result.map((entry) => entry.value), commands.map((entry) => entry.command_id));
  assert.ok(result.every((entry) => entry.status === 'fulfilled'));
});

test('admission failures reject before any physical effect', async (t) => {
  const cases = [
    {
      name: 'pressure overflow',
      commands: [command('cmd-a', 'tab-a'), command('cmd-b', 'tab-b')],
      code: 'pressure_budget_exceeded',
      overrides: { readMutationBudget: () => 1 },
    },
    {
      name: 'same-cell overlap',
      commands: [command('cmd-a', 'tab-a'), command('cmd-b', 'tab-a')],
      code: 'same_cell_overlap',
    },
    {
      name: 'missing explicit BrowserCell',
      commands: [command('cmd-a', '')],
      code: 'missing_browser_cell',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => expectPlanReject(entry));
  }
});

test('keeps provider-neutral command object opaque and unchanged', async () => {
  const original = command('cmd-a', 'tab-a', {
    provider: 'future-provider-x',
    action: { kind: 'custom', nested: { value: 42 } },
  });
  let observed = null;
  const instance = coordinator({
    readMutationBudget: () => 1,
    execute: async (received) => {
      observed = received;
      return 'ok';
    },
  });

  const result = await instance.dispatch([original]);
  assert.equal(observed, original);
  assert.equal(result[0].value, 'ok');
});

test('executor rejection is reported once with no blind retry and peers still settle', async () => {
  const calls = new Map();
  const instance = coordinator({
    readMutationBudget: () => 2,
    execute: async (_command, context) => {
      calls.set(context.commandId, (calls.get(context.commandId) ?? 0) + 1);
      if (context.commandId === 'cmd-a') throw new Error('ambiguous physical outcome');
      return 'peer-ok';
    },
  });

  const result = await instance.dispatch([
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
  const controller = new AbortController();
  controller.abort();

  await expectPlanReject({
    commands: [command('cmd-a', 'tab-a')],
    code: 'aborted',
    signal: controller.signal,
    overrides: {
      readMutationBudget: () => {
        budgetReads += 1;
        return 8;
      },
    },
  });
  assert.equal(budgetReads, 0);
});
