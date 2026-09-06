import test from 'node:test';
import assert from 'node:assert/strict';

import { activateExistingPrimaryWindow } from '../src/browser-startup-observability.mjs';

function instrumentedWindow({ minimized = false, visible = true, focused = false } = {}) {
  const state = { minimized, visible, focused, destroyed: false };
  const calls = { restore: 0, show: 0, focus: 0 };
  const win = {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    restore: () => {
      calls.restore += 1;
      state.minimized = false;
      state.visible = true;
    },
    show: () => {
      calls.show += 1;
      state.visible = true;
      state.focused = true;
    },
    focus: () => {
      calls.focus += 1;
      state.focused = true;
    },
    isVisible: () => state.visible,
    isFocused: () => state.focused,
  };
  return { win, state, calls };
}

test('secondary activation is idempotent for an already visible focused primary', () => {
  const { win, calls } = instrumentedWindow({ visible: true, focused: true });
  const result = activateExistingPrimaryWindow({
    getAllWindows: () => [win],
    getFocusedWindow: () => win,
  });

  assert.equal(result.ok, true);
  assert.equal(result.visible, true);
  assert.equal(result.focused, true);
  assert.deepEqual(calls, { restore: 0, show: 0, focus: 0 });
});

test('secondary activation focuses a visible unfocused primary without redundant show', () => {
  const { win, calls } = instrumentedWindow({ visible: true, focused: false });
  const result = activateExistingPrimaryWindow({
    getAllWindows: () => [win],
    getFocusedWindow: () => null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.visible, true);
  assert.equal(result.focused, true);
  assert.deepEqual(calls, { restore: 0, show: 0, focus: 1 });
});

test('secondary activation restores a minimized primary without duplicate show or focus transitions', () => {
  const { win, calls } = instrumentedWindow({ minimized: true, visible: false, focused: false });
  const result = activateExistingPrimaryWindow({
    getAllWindows: () => [win],
    getFocusedWindow: () => null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.restored, true);
  assert.equal(result.visible, true);
  assert.equal(result.focused, true);
  assert.deepEqual(calls, { restore: 1, show: 0, focus: 1 });
});

test('secondary activation preserves fail-safe show/focus calls when state probes are unavailable', () => {
  const calls = { show: 0, focus: 0 };
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => { calls.show += 1; },
    focus: () => { calls.focus += 1; },
  };
  const result = activateExistingPrimaryWindow({
    getAllWindows: () => [win],
    getFocusedWindow: () => null,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, { show: 1, focus: 1 });
});
