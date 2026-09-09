import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA,
  METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA,
  planDevOSSessionFocus,
  planDevOSSurfaceFocus,
} from '../src/metaengine-devos-session-focus.mjs';

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function session(sessionId, title, surfaceIds = []) {
  return Object.freeze({
    session_id: sessionId,
    title,
    status: 'ACTIVE',
    surface_ids: Object.freeze(surfaceIds),
    task_count: 1,
    ...zeroAuthority(),
  });
}

function surface(surfaceId, sessionId, type, tabId = null) {
  return Object.freeze({
    surface_id: surfaceId,
    session_id: sessionId,
    type,
    title: surfaceId,
    tab_id: tabId,
    state: 'AVAILABLE',
    ...zeroAuthority(),
  });
}

function preference(sessionId, storedSurfaceId) {
  return Object.freeze({
    schema: 'metaengine.devos.session-layout-preference.v1',
    session_id: sessionId,
    requested_sidebar: 'EXPANDED',
    requested_inspector: 'CLOSED',
    stored_surface_id: storedSurfaceId,
    stored_surface_is_focus_preference: true,
    stored_surface_is_selection_authority: false,
    revision: 1,
    updated_sequence: 1,
    ...zeroAuthority(),
  });
}

function devos({ withStoredFocus = true, staleStoredFocus = false } = {}) {
  const sessions = Object.freeze([
    session('session:a', 'A', ['browser:a1']),
    session('session:b', 'B', ['browser:b1', 'browser:b2']),
    session('session:c', 'C', ['terminal:c1']),
  ]);
  const surfaces = Object.freeze([
    surface('browser:a1', 'session:a', 'BROWSER', 'tab.a1'),
    surface('browser:b1', 'session:b', 'BROWSER', 'tab.b1'),
    surface('browser:b2', 'session:b', 'BROWSER', 'tab.b2'),
    surface('terminal:c1', 'session:c', 'TERMINAL'),
  ]);
  const entries = [preference('session:a', 'browser:a1')];
  if (withStoredFocus) entries.push(preference('session:b', staleStoredFocus ? 'browser:a1' : 'browser:b2'));
  return Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    browser_is_shell: false,
    browser_is_surface: true,
    sessions,
    surfaces,
    selected: Object.freeze({ session_id: 'session:a', surface_id: 'browser:a1' }),
    layout_preferences: Object.freeze({
      schema: 'metaengine.devos.session-layout-projection.v1',
      selected_session_id: 'session:a',
      selected_surface_id: 'browser:a1',
      registry_active_session_id: 'session:a',
      entries: Object.freeze(entries),
      stored_surface_is_selection_authority: false,
      ...zeroAuthority(),
    }),
    ...zeroAuthority(),
  });
}

function assertZeroAuthority(plan) {
  assert.equal(plan.projection_is_authority, false);
  assert.equal(plan.scheduler_authority, false);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.command_leasing, false);
  assert.equal(plan.automatic_effect_retry_allowed, false);
  assert.equal(plan.page_model_authority, false);
  assert.equal(plan.authority_effect, false);
  assert.equal(plan.plan_is_execution_authority, false);
}

test('explicit session focus keeps the already selected canonical Browser surface', () => {
  const plan = planDevOSSessionFocus(devos(), { session_id: 'session:a' });
  assert.equal(plan.schema, METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA);
  assert.equal(plan.valid, true);
  assert.equal(plan.reason, 'CURRENT_SELECTED_SURFACE');
  assert.equal(plan.target_session_id, 'session:a');
  assert.equal(plan.target_surface_id, 'browser:a1');
  assert.equal(plan.target_tab_id, 'tab.a1');
  assert.equal(plan.shell_navigation_required, false);
  assert.equal(plan.explicit_user_intent_required, true);
  assert.equal(plan.automatic_surface_selection, false);
  assertZeroAuthority(plan);
});

test('explicit session focus may restore a valid stored Browser focus preference', () => {
  const plan = planDevOSSessionFocus(devos(), { session_id: 'session:b' });
  assert.equal(plan.valid, true);
  assert.equal(plan.reason, 'STORED_FOCUS_PREFERENCE');
  assert.equal(plan.target_surface_id, 'browser:b2');
  assert.equal(plan.target_tab_id, 'tab.b2');
  assert.equal(plan.browser_surface_count, 2);
  assert.equal(plan.surface_selection_required, false);
  assert.equal(plan.shell_navigation_required, true);
  assert.equal(plan.stored_focus_is_execution_authority, false);
  assertZeroAuthority(plan);
});

test('multiple Browser surfaces without a valid stored focus require explicit Surface choice', () => {
  for (const source of [devos({ withStoredFocus: false }), devos({ withStoredFocus: true, staleStoredFocus: true })]) {
    const plan = planDevOSSessionFocus(source, { session_id: 'session:b' });
    assert.equal(plan.valid, true);
    assert.equal(plan.reason, 'EXPLICIT_SURFACE_SELECTION_REQUIRED');
    assert.equal(plan.target_surface_id, null);
    assert.equal(plan.target_tab_id, null);
    assert.equal(plan.surface_selection_required, true);
    assert.equal(plan.browser_surface_count, 2);
    assert.equal(plan.shell_navigation_required, false);
    assertZeroAuthority(plan);
  }
});

test('session with no Browser surface remains session-only instead of selecting an unrelated tab', () => {
  const plan = planDevOSSessionFocus(devos(), { session_id: 'session:c' });
  assert.equal(plan.valid, true);
  assert.equal(plan.reason, 'SESSION_HAS_NO_BROWSER_SURFACE');
  assert.equal(plan.session_only, true);
  assert.equal(plan.browser_surface_count, 0);
  assert.equal(plan.target_surface_id, null);
  assert.equal(plan.target_tab_id, null);
  assert.equal(plan.shell_navigation_required, false);
  assertZeroAuthority(plan);
});

test('explicit Surface focus requires exact Session ownership and maps Browser surface to its exact tab', () => {
  const plan = planDevOSSurfaceFocus(devos(), { session_id: 'session:b', surface_id: 'browser:b1' });
  assert.equal(plan.schema, METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA);
  assert.equal(plan.valid, true);
  assert.equal(plan.reason, 'EXPLICIT_SURFACE_SELECTION');
  assert.equal(plan.target_session_id, 'session:b');
  assert.equal(plan.target_surface_id, 'browser:b1');
  assert.equal(plan.target_tab_id, 'tab.b1');
  assert.equal(plan.surface_type, 'BROWSER');
  assert.equal(plan.shell_navigation_required, true);
  assertZeroAuthority(plan);

  const mismatch = planDevOSSurfaceFocus(devos(), { session_id: 'session:b', surface_id: 'browser:a1' });
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reason, 'SURFACE_SESSION_MISMATCH');
  assert.equal(mismatch.target_tab_id, null);
  assertZeroAuthority(mismatch);
});

test('explicit non-Browser Surface focus changes presentation context without inventing a browser tab', () => {
  const plan = planDevOSSurfaceFocus(devos(), { session_id: 'session:c', surface_id: 'terminal:c1' });
  assert.equal(plan.valid, true);
  assert.equal(plan.surface_type, 'TERMINAL');
  assert.equal(plan.target_tab_id, null);
  assert.equal(plan.shell_navigation_required, false);
  assertZeroAuthority(plan);
});

test('authority-bearing or inconsistent canonical DevOS data fails closed', () => {
  const source = devos();
  for (const corrupt of [
    { ...source, scheduler_authority: true },
    { ...source, selected: { session_id: 'session:b', surface_id: 'browser:a1' } },
    { ...source, surfaces: source.surfaces.map((row) => row.surface_id === 'browser:b1' ? { ...row, execution_authority: true } : row) },
  ]) {
    const sessionPlan = planDevOSSessionFocus(corrupt, { session_id: 'session:b' });
    assert.equal(sessionPlan.valid, false);
    assert.equal(sessionPlan.target_surface_id, null);
    assert.equal(sessionPlan.target_tab_id, null);
    assertZeroAuthority(sessionPlan);
  }
});

test('unknown session or surface ids never fall back to another session', () => {
  const unknownSession = planDevOSSessionFocus(devos(), { session_id: 'session:missing' });
  assert.equal(unknownSession.valid, false);
  assert.equal(unknownSession.reason, 'SESSION_NOT_FOUND');
  const unknownSurface = planDevOSSurfaceFocus(devos(), { session_id: 'session:b', surface_id: 'browser:missing' });
  assert.equal(unknownSurface.valid, false);
  assert.equal(unknownSurface.reason, 'SURFACE_NOT_FOUND');
  assertZeroAuthority(unknownSession);
  assertZeroAuthority(unknownSurface);
});
