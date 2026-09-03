import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_SPLIT_GAP,
  clearNativeSplit,
  normalizeNativeSplitState,
  planNativeSplitView,
  reconcileNativeSplitSelection,
  reconcileNativeSplitTabClosed,
  setNativeSplitSecondary,
} from '../src/native-split-view.mjs';

const live = new Set(['tab_a', 'tab_b', 'tab_c']);
const tabExists = (id) => live.has(String(id));
const remote = { x: 272, y: 92, width: 1000, height: 700 };

test('split plan shows two native panes while primary remains the only selection authority', () => {
  const state = setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a',
    secondary_tab_id: 'tab_b',
    tab_exists: tabExists,
  });
  const plan = planNativeSplitView({ remote_bounds: remote, state, selected_tab_id: 'tab_a', tab_exists: tabExists });
  assert.equal(plan.effective_enabled, true);
  assert.deepEqual(plan.visible_tab_ids, ['tab_a', 'tab_b']);
  assert.equal(plan.active_tab_id, 'tab_a');
  assert.equal(plan.secondary_tab_id, 'tab_b');
  assert.equal(plan.selection_authority, 'PRIMARY_SELECTED_TAB_ONLY');
  assert.equal(plan.secondary_selection_authority, false);
  assert.equal(plan.supervisor_implicit_target_uses_secondary, false);
  assert.equal(plan.primary_bounds.width + plan.secondary_bounds.width + NATIVE_SPLIT_GAP, remote.width);
  assert.equal(plan.authority_effect, false);
});

test('selecting the visible secondary swaps presentation roles instead of creating two selected tabs', () => {
  const state = setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_b', tab_exists: tabExists,
  });
  const next = reconcileNativeSplitSelection(state, {
    previous_selected_tab_id: 'tab_a', selected_tab_id: 'tab_b', tab_exists: tabExists,
  });
  assert.equal(next.enabled, true);
  assert.equal(next.secondary_tab_id, 'tab_a');
  const plan = planNativeSplitView({ remote_bounds: remote, state: next, selected_tab_id: 'tab_b', tab_exists: tabExists });
  assert.deepEqual(plan.visible_tab_ids, ['tab_b', 'tab_a']);
  assert.equal(plan.active_tab_id, 'tab_b');
  assert.equal(plan.secondary_selection_authority, false);
});

test('a third selected tab leaves the exact secondary binding unchanged', () => {
  const state = setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_b', tab_exists: tabExists,
  });
  const next = reconcileNativeSplitSelection(state, {
    previous_selected_tab_id: 'tab_a', selected_tab_id: 'tab_c', tab_exists: tabExists,
  });
  assert.equal(next.enabled, true);
  assert.equal(next.secondary_tab_id, 'tab_b');
});

test('closing or losing secondary fails closed to one pane', () => {
  const state = setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_b', tab_exists: tabExists,
  });
  const afterClose = reconcileNativeSplitTabClosed(state, {
    closed_tab_id: 'tab_b', selected_tab_id: 'tab_a', tab_exists: tabExists,
  });
  assert.equal(afterClose.enabled, false);

  live.delete('tab_b');
  const degraded = planNativeSplitView({ remote_bounds: remote, state, selected_tab_id: 'tab_a', tab_exists: tabExists });
  assert.equal(degraded.effective_enabled, false);
  assert.equal(degraded.degradation_reason, 'SECONDARY_BINDING_INVALID');
  assert.deepEqual(degraded.visible_tab_ids, ['tab_a']);
  live.add('tab_b');
});

test('narrow native geometry degrades presentation without mutating requested state', () => {
  const state = setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_b', tab_exists: tabExists,
  });
  const plan = planNativeSplitView({
    remote_bounds: { x: 0, y: 92, width: 700, height: 600 },
    state,
    selected_tab_id: 'tab_a',
    tab_exists: tabExists,
  });
  assert.equal(plan.effective_enabled, false);
  assert.equal(plan.degradation_reason, 'INSUFFICIENT_NATIVE_WIDTH');
  assert.equal(plan.requested.enabled, true);
  assert.equal(plan.requested.secondary_tab_id, 'tab_b');
});

test('split request requires an exact live secondary and bounded ratio', () => {
  assert.throws(() => setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_a', tab_exists: tabExists,
  }), /secondary_must_differ/);
  assert.throws(() => setNativeSplitSecondary(null, {
    selected_tab_id: 'tab_a', secondary_tab_id: 'tab_missing', tab_exists: tabExists,
  }), /secondary_tab_not_live/);
  assert.throws(() => normalizeNativeSplitState({ enabled: true, secondary_tab_id: 'tab_b', ratio: 0.95 }), /ratio_invalid/);
  assert.equal(clearNativeSplit().enabled, false);
});
