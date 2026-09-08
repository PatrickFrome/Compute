import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_PRESENTATION_ACTIVATION_SCHEMA,
  planDevOSPresentationActivation,
} from '../src/metaengine-devos-presentation-activation.mjs';

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

function session(sessionId, surfaceIds = []) {
  return Object.freeze({ session_id: sessionId, title: sessionId, status: 'ACTIVE', surface_ids: Object.freeze(surfaceIds), task_count: 0, ...zeroAuthority() });
}

function surface(surfaceId, sessionId, type, tabId = null) {
  return Object.freeze({ surface_id: surfaceId, session_id: sessionId, type, title: surfaceId, tab_id: tabId, state: 'AVAILABLE', ...zeroAuthority() });
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

function devos({ storedB = null } = {}) {
  const sessions = Object.freeze([
    session('session:a', ['browser:a1']),
    session('session:b', ['browser:b1', 'browser:b2']),
    session('session:c', ['terminal:c1']),
  ]);
  const surfaces = Object.freeze([
    surface('browser:a1', 'session:a', 'BROWSER', 'tab.a1'),
    surface('browser:b1', 'session:b', 'BROWSER', 'tab.b1'),
    surface('browser:b2', 'session:b', 'BROWSER', 'tab.b2'),
    surface('terminal:c1', 'session:c', 'TERMINAL'),
  ]);
  const entries = [preference('session:a', 'browser:a1')];
  if (storedB) entries.push(preference('session:b', storedB));
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

function assertActivationZeroAuthority(result) {
  assert.equal(result.projection_is_authority, false);
  assert.equal(result.renderer_selection_authority, false);
  assert.equal(result.renderer_routing_authority, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.execution_authority, false);
  assert.equal(result.command_leasing, false);
  assert.equal(result.automatic_effect_retry_allowed, false);
  assert.equal(result.page_model_authority, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.browser_selection_is_session_focus_authority, false);
}

test('unsupported or unknown intent fails closed without presentation or Browser activation', () => {
  for (const request of [{}, { intent: 'TAB', session_id: 'session:a' }]) {
    const result = planDevOSPresentationActivation(devos(), request);
    assert.equal(result.schema, METAENGINE_DEVOS_PRESENTATION_ACTIVATION_SCHEMA);
    assert.equal(result.valid, false);
    assert.equal(result.presentation_focus_mutation_allowed, false);
    assert.equal(result.browser_activation_required, false);
    assert.equal(result.target_tab_id, null);
    assertActivationZeroAuthority(result);
  }
});

test('Session intent with one Browser Surface yields exact physical target without creating explicit Surface focus', () => {
  const result = planDevOSPresentationActivation(devos(), { intent: 'SESSION', session_id: 'session:a' });
  assert.equal(result.valid, true);
  assert.equal(result.intent, 'SESSION');
  assert.equal(result.focus_session_id, 'session:a');
  assert.equal(result.focus_surface_id, null);
  assert.equal(result.target_tab_id, 'tab.a1');
  assert.equal(result.browser_activation_required, false);
  assert.equal(result.presentation_focus_mutation_allowed, true);
  assertActivationZeroAuthority(result);
});

test('ambiguous multi-Browser Session changes only Session focus and requires explicit Surface choice', () => {
  const result = planDevOSPresentationActivation(devos(), { intent: 'SESSION', session_id: 'session:b' });
  assert.equal(result.valid, true);
  assert.equal(result.reason, 'EXPLICIT_SURFACE_SELECTION_REQUIRED');
  assert.equal(result.focus_session_id, 'session:b');
  assert.equal(result.focus_surface_id, null);
  assert.equal(result.surface_selection_required, true);
  assert.equal(result.target_tab_id, null);
  assert.equal(result.browser_activation_required, false);
  assertActivationZeroAuthority(result);
});

test('valid stored Browser preference may provide exact Session navigation target but remains non-authoritative Surface focus', () => {
  const result = planDevOSPresentationActivation(devos({ storedB: 'browser:b2' }), { intent: 'SESSION', session_id: 'session:b' });
  assert.equal(result.valid, true);
  assert.equal(result.reason, 'STORED_FOCUS_PREFERENCE');
  assert.equal(result.focus_session_id, 'session:b');
  assert.equal(result.focus_surface_id, null);
  assert.equal(result.target_tab_id, 'tab.b2');
  assert.equal(result.browser_activation_required, true);
  assert.equal(result.plan.stored_focus_is_execution_authority, false);
  assertActivationZeroAuthority(result);
});

test('Session without Browser remains session-only and cannot activate an unrelated tab', () => {
  const result = planDevOSPresentationActivation(devos(), { intent: 'SESSION', session_id: 'session:c' });
  assert.equal(result.valid, true);
  assert.equal(result.session_only, true);
  assert.equal(result.focus_session_id, 'session:c');
  assert.equal(result.focus_surface_id, null);
  assert.equal(result.target_tab_id, null);
  assert.equal(result.browser_activation_required, false);
  assertActivationZeroAuthority(result);
});

test('explicit Browser Surface intent binds both presentation focus ids and exact tab activation', () => {
  const result = planDevOSPresentationActivation(devos(), { intent: 'SURFACE', session_id: 'session:b', surface_id: 'browser:b1' });
  assert.equal(result.valid, true);
  assert.equal(result.intent, 'SURFACE');
  assert.equal(result.focus_session_id, 'session:b');
  assert.equal(result.focus_surface_id, 'browser:b1');
  assert.equal(result.target_tab_id, 'tab.b1');
  assert.equal(result.browser_activation_required, true);
  assertActivationZeroAuthority(result);
});

test('explicit non-Browser Surface intent updates presentation focus without Browser actuation', () => {
  const result = planDevOSPresentationActivation(devos(), { intent: 'SURFACE', session_id: 'session:c', surface_id: 'terminal:c1' });
  assert.equal(result.valid, true);
  assert.equal(result.focus_session_id, 'session:c');
  assert.equal(result.focus_surface_id, 'terminal:c1');
  assert.equal(result.target_tab_id, null);
  assert.equal(result.browser_activation_required, false);
  assertActivationZeroAuthority(result);
});

test('unknown Session/Surface or authority-bearing DevOS cannot mutate focus or Browser selection', () => {
  const corrupt = { ...devos(), execution_authority: true };
  for (const result of [
    planDevOSPresentationActivation(devos(), { intent: 'SESSION', session_id: 'session:missing' }),
    planDevOSPresentationActivation(devos(), { intent: 'SURFACE', session_id: 'session:b', surface_id: 'browser:missing' }),
    planDevOSPresentationActivation(corrupt, { intent: 'SESSION', session_id: 'session:a' }),
  ]) {
    assert.equal(result.valid, false);
    assert.equal(result.presentation_focus_mutation_allowed, false);
    assert.equal(result.target_tab_id, null);
    assert.equal(result.browser_activation_required, false);
    assertActivationZeroAuthority(result);
  }
});
