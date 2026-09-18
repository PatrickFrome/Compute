import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainParallelFanoutCoordinator } from '../src/browser-brain-parallel-fanout.mjs';

function frozenCommand(index) {
  return Object.freeze({
    command_id: `cmd-${index}`,
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: Object.freeze({
      tab_id: `tab-${index}`,
      provider: `provider-${index % 4}`,
      action: Object.freeze({ kind: 'opaque', sequence: index }),
    }),
  });
}

test('full-width fanout carries exact metadata in sidecars without annotating frozen commands', async () => {
  const width = 128;
  const commands = Object.freeze(Array.from({ length: width }, (_, index) => frozenCommand(index)));
  const originalKeys = commands.map((entry) => Object.keys(entry));
  const seenCommands = new Array(width);

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: width,
    readMutationBudget: () => width,
    resolveCellKey: (entry) => entry.payload.tab_id,
    execute: async (entry, context) => {
      const index = Number(context.commandId.slice(4));
      seenCommands[index] = entry;
      assert.equal(context.browserCell, `tab-${index}`);
      return index;
    },
  });

  const result = await coordinator.dispatch(commands);

  assert.equal(result.length, width);
  for (let index = 0; index < width; index += 1) {
    assert.equal(seenCommands[index], commands[index]);
    assert.deepEqual(Object.keys(commands[index]), originalKeys[index]);
    assert.equal(result[index].command_id, `cmd-${index}`);
    assert.equal(result[index].browser_cell, `tab-${index}`);
    assert.equal(result[index].status, 'fulfilled');
    assert.equal(result[index].value, index);
  }
});

test('sidecar metadata preserves trimmed command identity without mutating caller input', async () => {
  const command = Object.freeze({
    command_id: '  cmd-a  ',
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: Object.freeze({ tab_id: 'tab-a' }),
  });

  let observedContext;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 1,
    execute: async (received, context) => {
      assert.equal(received, command);
      observedContext = context;
      return 'ok';
    },
  });

  const [result] = await coordinator.dispatch([command]);
  assert.equal(command.command_id, '  cmd-a  ');
  assert.equal(observedContext.commandId, 'cmd-a');
  assert.equal(result.command_id, 'cmd-a');
  assert.equal(result.browser_cell, 'tab-a');
  assert.equal(result.value, 'ok');
});
