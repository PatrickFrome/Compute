import assert from 'node:assert/strict';
import test from 'node:test';
import { executeGuardedSupervisorLocalClick, positiveViewport } from '../src/supervisor-local-click-guard.mjs';

const command = Object.freeze({
  action: 'TYPED_CLICK',
  payload: { tab_id: 'tab_supervisor', role: 'button', accessible_name: 'Send' },
  platform: null,
});

function frame({ process = 'proc_1', target = 'webcontents:9', width = 0, height = 0, control = true } = {}) {
  return {
    tab_id: 'tab_supervisor',
    process_incarnation_id: process,
    target_id: target,
    viewport: { width, height },
    semantic_targets: control ? [{ role: 'button', name: 'Send' }] : [],
  };
}

function state({ selected = false, fleet = false } = {}) {
  return {
    active_tab: selected ? { tab_id: 'tab_supervisor' } : { tab_id: 'tab_user' },
    tabs: [
      { tab_id: 'tab_supervisor', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected },
      { tab_id: 'tab_user', url: 'https://chatgpt.com/c/bbbbbbbb-cccc-dddd-eeee-ffffffffffff', selected: !selected },
    ],
    fleet: { agents: fleet ? [{ agent_id: 'agent_1', tab_id: 'tab_supervisor' }] : [] },
  };
}

test('positiveViewport requires finite positive width and height', () => {
  assert.equal(positiveViewport({ viewport: { width: 800, height: 600 } }), true);
  assert.equal(positiveViewport({ viewport: { width: 0, height: 600 } }), false);
  assert.equal(positiveViewport({ viewport: { width: 800, height: Number.NaN } }), false);
});

test('hidden supervisor tab is selected, rebound and clicked exactly once', async () => {
  let selected = false;
  let rawClicks = 0;
  const actions = [];
  const getState = async () => state({ selected });
  const executeCommand = async (row) => {
    actions.push(row.action);
    if (row.action === 'CAPTURE') return frame({ width: selected ? 900 : 0, height: selected ? 700 : 0 });
    if (row.action === 'SELECT_TAB') { selected = true; return { ok: true, tab_id: 'tab_supervisor' }; }
    if (row.action === 'TYPED_CLICK') { rawClicks += 1; return { ok: true, clicked: true }; }
    throw new Error(`unexpected:${row.action}`);
  };
  const result = await executeGuardedSupervisorLocalClick({ command, getState, executeCommand });
  assert.equal(result.handled, true);
  assert.equal(result.result.ok, true);
  assert.equal(rawClicks, 1);
  assert.deepEqual(actions, ['CAPTURE', 'SELECT_TAB', 'CAPTURE', 'TYPED_CLICK']);
});

test('process or target drift after SELECT_TAB fails closed without click', async () => {
  let selected = false;
  let captureCount = 0;
  let rawClicks = 0;
  const result = await executeGuardedSupervisorLocalClick({
    command,
    getState: async () => state({ selected }),
    executeCommand: async (row) => {
      if (row.action === 'SELECT_TAB') { selected = true; return { ok: true }; }
      if (row.action === 'CAPTURE') {
        captureCount += 1;
        return captureCount === 1
          ? frame({ width: 0, height: 0, process: 'proc_1', target: 'webcontents:9' })
          : frame({ width: 900, height: 700, process: 'proc_2', target: 'webcontents:9' });
      }
      if (row.action === 'TYPED_CLICK') rawClicks += 1;
      return { ok: true };
    },
  });
  assert.equal(result.handled, true);
  assert.equal(result.result.reason, 'SUPERVISOR_CLICK_BINDING_DRIFT');
  assert.equal(result.result.automatic_retry_allowed, false);
  assert.equal(rawClicks, 0);
});

test('selected tab with zero viewport fails closed without click', async () => {
  let selected = false;
  let rawClicks = 0;
  const result = await executeGuardedSupervisorLocalClick({
    command,
    getState: async () => state({ selected }),
    executeCommand: async (row) => {
      if (row.action === 'SELECT_TAB') { selected = true; return { ok: true }; }
      if (row.action === 'CAPTURE') return frame({ width: 0, height: 0 });
      if (row.action === 'TYPED_CLICK') rawClicks += 1;
      return { ok: true };
    },
  });
  assert.equal(result.result.reason, 'SUPERVISOR_VIEWPORT_NOT_POSITIVE');
  assert.equal(rawClicks, 0);
});

test('failed selected-tab readback fails closed without click', async () => {
  let rawClicks = 0;
  const result = await executeGuardedSupervisorLocalClick({
    command,
    getState: async () => state({ selected: false }),
    executeCommand: async (row) => {
      if (row.action === 'CAPTURE') return frame();
      if (row.action === 'SELECT_TAB') return { ok: true };
      if (row.action === 'TYPED_CLICK') rawClicks += 1;
      return { ok: true };
    },
  });
  assert.equal(result.result.reason, 'SUPERVISOR_SELECTED_TAB_MISMATCH');
  assert.equal(rawClicks, 0);
});

test('fleet worker click is not intercepted by supervisor guard', async () => {
  let rawClicks = 0;
  const result = await executeGuardedSupervisorLocalClick({
    command,
    getState: async () => state({ selected: false, fleet: true }),
    executeCommand: async (row) => { if (row.action === 'TYPED_CLICK') rawClicks += 1; return { ok: true }; },
  });
  assert.equal(result.handled, false);
  assert.equal(rawClicks, 0);
});
