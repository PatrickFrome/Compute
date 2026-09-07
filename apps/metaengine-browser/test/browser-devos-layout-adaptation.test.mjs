import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const requested = normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' });

function plan(width) {
  return planShellLayout({ width, height: 900, state: requested });
}

test('wide DevOS layout preserves requested chrome when active surface already meets its target', () => {
  const view = plan(1400);
  assert.equal(view.effective_sidebar, 'EXPANDED');
  assert.equal(view.effective_operations, 'OPEN');
  assert.deepEqual(view.adaptations, []);
  assert.equal(view.adapted, false);
  assert.equal(view.remote_bounds.width, 776);
  assert.equal(view.active_surface_width_target, SHELL_MIN_REMOTE_WIDTH);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('session sidebar compacts before the active surface is allowed below 720px', () => {
  const view = plan(1300);
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'OPEN');
  assert.deepEqual(view.adaptations, ['SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE']);
  assert.equal(view.remote_bounds.width, 892);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('Inspector closes after sidebar compaction when more room is required for active surface', () => {
  const view = plan(1000);
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'CLOSED');
  assert.deepEqual(view.adaptations, [
    'SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE',
    'INSPECTOR_CLOSED_FOR_ACTIVE_SURFACE',
  ]);
  assert.equal(view.remote_bounds.width, 944);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('session sidebar hides last and gives the active surface the full viewport when necessary', () => {
  const view = plan(700);
  assert.equal(view.effective_sidebar, 'HIDDEN');
  assert.equal(view.effective_operations, 'CLOSED');
  assert.deepEqual(view.adaptations, [
    'SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE',
    'INSPECTOR_CLOSED_FOR_ACTIVE_SURFACE',
    'SIDEBAR_HIDDEN_FOR_ACTIVE_SURFACE',
  ]);
  assert.equal(view.remote_bounds.width, 700);
  assert.equal(view.active_surface_width_target, 700, 'target cannot exceed the physical window width');
  assert.equal(view.active_surface_target_satisfied, true);
});

test('responsive adaptation preserves manual requested state instead of mutating workspace preference', () => {
  const manual = normalizeShellLayoutState({ sidebar: 'HIDDEN', operations: 'CLOSED' });
  const narrow = planShellLayout({ width: 900, height: 700, state: manual });
  const wide = planShellLayout({ width: 1800, height: 1000, state: manual });
  for (const view of [narrow, wide]) {
    assert.deepEqual(view.requested, manual);
    assert.equal(view.effective_sidebar, 'HIDDEN');
    assert.equal(view.effective_operations, 'CLOSED');
    assert.deepEqual(view.adaptations, []);
    assert.equal(view.adapted, false);
  }
});

test('auto-adaptation does not overwrite requested expanded/open state', () => {
  const view = plan(1000);
  assert.equal(view.requested.sidebar, 'EXPANDED');
  assert.equal(view.requested.operations, 'OPEN');
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'CLOSED');
});

test('responsive adaptation remains geometry-only and never creates renderer or execution authority', () => {
  for (const width of [1600, 1400, 1300, 1180, 1000, 800, 700, 480]) {
    const view = plan(width);
    assert.equal(view.active_surface_priority, true);
    assert.equal(view.chrome_degrades_before_active_surface, true);
    assert.equal(view.overlay_remote_content, false);
    assert.equal(view.renderer_dimensions_authoritative, false);
    assert.equal(view.authority_effect, false);
    assert.equal(view.remote_bounds.width >= view.active_surface_width_target, true);
    assert.equal(Object.isFrozen(view.adaptations), true);
  }
});
