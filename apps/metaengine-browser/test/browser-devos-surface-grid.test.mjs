import test from 'node:test';
import assert from 'node:assert/strict';
import { planDevOSSurfaceGrid } from '../src/metaengine-devos-surface-grid.mjs';

function surface(id, type = 'BROWSER', tab = null, session = 'session:a') {
  return {
    surface_id: id,
    session_id: session,
    type,
    title: id,
    tab_id: tab,
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

const bounds = { x: 240, y: 44, width: 1200, height: 800 };

test('AUTO promotes one/two/three/four exact Session surfaces into deterministic main-owned layouts', () => {
  const one = planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a', 'BROWSER', 'a')] });
  assert.equal(one.effective_layout, 'SINGLE');
  assert.equal(one.panes.length, 1);
  assert.equal(one.panes[0].content_bounds.y, 72);

  const two = planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('browser:b', 'BROWSER', 'b')] });
  assert.equal(two.effective_layout, 'SPLIT_VERTICAL');
  assert.equal(two.panes.length, 2);
  assert.equal(two.panes[0].pane_bounds.width + two.panes[1].pane_bounds.width + two.gap, bounds.width);

  const three = planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('artifact:1', 'ARTIFACT'), surface('timeline:1', 'TIMELINE')] });
  assert.equal(three.effective_layout, 'TRIPLE_RIGHT');
  assert.equal(three.panes.length, 3);
  assert.equal(three.browser_panes.length, 1);
  assert.equal(three.shell_panes.length, 2);

  const four = planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('browser:b', 'BROWSER', 'b'), surface('artifact:1', 'ARTIFACT'), surface('timeline:1', 'TIMELINE')] });
  assert.equal(four.effective_layout, 'GRID_2X2');
  assert.equal(four.panes.length, 4);
  assert.equal(four.multi_surface, true);
  assert.equal(four.browser_views_owned_by_main, true);
  assert.equal(four.renderer_dimensions_authoritative, false);
  assert.equal(four.authority_effect, false);
});

test('focused Surface owns the primary pane without crossing Session ownership', () => {
  const plan = planDevOSSurfaceGrid({
    bounds,
    focused_surface_id: 'browser:b',
    surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('browser:b', 'BROWSER', 'b'), surface('artifact:1', 'ARTIFACT')],
  });
  assert.equal(plan.panes[0].surface_id, 'browser:b');
  assert.equal(plan.panes[0].focused, true);
  assert.throws(() => planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('browser:b', 'BROWSER', 'b', 'session:b')] }), /cross_session/);
});

test('narrow geometry degrades requested grid before violating native pane constraints', () => {
  const plan = planDevOSSurfaceGrid({
    bounds: { x: 0, y: 44, width: 500, height: 300 },
    requested_layout: 'GRID_2X2',
    surfaces: [surface('browser:a', 'BROWSER', 'a'), surface('browser:b', 'BROWSER', 'b'), surface('artifact:1', 'ARTIFACT')],
  });
  assert.equal(plan.effective_layout, 'SINGLE');
  assert.equal(plan.panes.length, 1);
  assert.equal(plan.surfaces_truncated, true);
});

test('surface grid rejects duplicate, missing focus and authority-bearing rows before geometry', () => {
  assert.throws(() => planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a'), surface('browser:a')] }), /duplicate_surface/);
  assert.throws(() => planDevOSSurfaceGrid({ bounds, surfaces: [surface('browser:a')], focused_surface_id: 'browser:missing' }), /focused_surface_missing/);
  assert.throws(() => planDevOSSurfaceGrid({ bounds, surfaces: [{ ...surface('browser:a'), execution_authority: true }] }), /surface_authority_invalid/);
});
