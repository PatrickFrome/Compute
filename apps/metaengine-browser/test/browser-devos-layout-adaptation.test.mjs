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

test('wide dark workspace preserves requested chrome while expanding the active surface', () => {
  const view = plan(1400);
  assert.equal(view.effective_sidebar, 'EXPANDED');
  assert.equal(view.effective_operations, 'OPEN');
  assert.deepEqual(view.adaptations, []);
  assert.equal(view.adapted, false);
  assert.equal(view.remote_bounds.width, 840);
  assert.equal(view.active_surface_width_target, SHELL_MIN_REMOTE_WIDTH);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('dark workspace compacts the sidebar at the exact active-surface threshold', () => {
  const view = plan(1279);
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'OPEN');
  assert.deepEqual(view.adaptations, ['SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE']);
  assert.equal(view.remote_bounds.width, 907);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('Brain inspector closes only when compact rail still cannot preserve 720px active surface', () => {
  const view = plan(1000);
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'CLOSED');
  assert.deepEqual(view.adaptations, [
    'SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE',
    'INSPECTOR_CLOSED_FOR_ACTIVE_SURFACE',
  ]);
  assert.equal(view.remote_bounds.width, 948);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('sidebar hides last and gives a sub-720 window fully to the active surface', () => {
  const view = plan(700);
  assert.equal(view.effective_sidebar, 'HIDDEN');
  assert.equal(view.effective_operations, 'CLOSED');
  assert.deepEqual(view.adaptations, [
    'SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE',
    'INSPECTOR_CLOSED_FOR_ACTIVE_SURFACE',
    'SIDEBAR_HIDDEN_FOR_ACTIVE_SURFACE',
  ]);
  assert.equal(view.remote_bounds.width, 700);
  assert.equal(view.active_surface_width_target, 700);
  assert.equal(view.active_surface_target_satisfied, true);
});

test('responsive adaptation preserves requested workspace preference', () => {
  const manual = normalizeShellLayoutState({ sidebar: 'HIDDEN', operations: 'CLOSED' });
  for (const [width, height] of [[900, 700], [1800, 1000]]) {
    const view = planShellLayout({ width, height, state: manual });
    assert.deepEqual(view.requested, manual);
    assert.equal(view.effective_sidebar, 'HIDDEN');
    assert.equal(view.effective_operations, 'CLOSED');
    assert.deepEqual(view.adaptations, []);
    assert.equal(view.adapted, false);
  }
});

test('auto-adaptation never rewrites requested expanded/open state', () => {
  const view = plan(1000);
  assert.equal(view.requested.sidebar, 'EXPANDED');
  assert.equal(view.requested.operations, 'OPEN');
  assert.equal(view.effective_sidebar, 'COMPACT');
  assert.equal(view.effective_operations, 'CLOSED');
});

test('dark responsive adaptation stays geometry-only and zero-authority', () => {
  for (const width of [1600, 1400, 1279, 1180, 1100, 1024, 1000, 800, 700, 480]) {
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
