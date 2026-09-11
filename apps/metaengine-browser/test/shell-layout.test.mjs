import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHELL_MIN_REMOTE_WIDTH,
  SHELL_OPERATIONS_WIDTH,
  SHELL_TOP_HEIGHT,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

test('wide workbench keeps the page primary and Brain closed by default', () => {
  const plan = planShellLayout({ width: 1440, height: 960, state: normalizeShellLayoutState() });
  assert.equal(plan.effective_sidebar, 'EXPANDED');
  assert.equal(plan.effective_operations, 'CLOSED');
  assert.equal(plan.remote_bounds.y, SHELL_TOP_HEIGHT);
  assert.ok(plan.remote_bounds.x > 0);
  assert.equal(plan.operations_bounds.width, 0);
  assert.equal(plan.remote_bounds.x + plan.remote_bounds.width, 1440);
  assert.equal(plan.overlay_remote_content, false);
  assert.equal(plan.renderer_dimensions_authoritative, false);
  assert.equal(plan.authority_effect, false);
});

test('explicit Brain inspector uses a real non-overlapped native inset', () => {
  const state = normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' });
  const plan = planShellLayout({ width: 1600, height: 960, state });
  assert.equal(plan.effective_sidebar, 'EXPANDED');
  assert.equal(plan.effective_operations, 'OPEN');
  assert.equal(plan.operations_bounds.width, SHELL_OPERATIONS_WIDTH);
  assert.equal(plan.remote_bounds.x + plan.remote_bounds.width + plan.operations_bounds.width, 1600);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(plan.overlay_remote_content, false);
  assert.equal(plan.renderer_dimensions_authoritative, false);
  assert.equal(plan.authority_effect, false);
});

test('narrow windows degrade chrome before violating minimum remote width', () => {
  const plan = planShellLayout({ width: 900, height: 640, state: normalizeShellLayoutState() });
  assert.equal(plan.effective_sidebar, 'COMPACT');
  assert.equal(plan.effective_operations, 'CLOSED');
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(plan.remote_bounds.height, 640 - SHELL_TOP_HEIGHT);
});

test('explicit hidden layout returns the page to the legacy full-width content rectangle', () => {
  const state = normalizeShellLayoutState({ sidebar: 'hidden', operations: 'closed' });
  const plan = planShellLayout({ width: 1200, height: 800, state });
  assert.deepEqual(plan.remote_bounds, { x: 0, y: SHELL_TOP_HEIGHT, width: 1200, height: 800 - SHELL_TOP_HEIGHT });
  assert.equal(plan.effective_sidebar, 'HIDDEN');
  assert.equal(plan.effective_operations, 'CLOSED');
});

test('renderer cannot invent arbitrary dimensions or modes', () => {
  assert.throws(() => normalizeShellLayoutState({ sidebar: '283px', operations: 'OPEN' }), /shell_layout_sidebar_invalid/);
  assert.throws(() => normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'FLOATING' }), /shell_layout_operations_invalid/);
  assert.throws(() => planShellLayout({ width: -1, height: 100, state: null }), /shell_layout_width_invalid/);
});
