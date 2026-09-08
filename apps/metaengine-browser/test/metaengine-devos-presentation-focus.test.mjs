import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
  METAENGINE_DEVOS_PRESENTATION_FOCUS_SCHEMA,
  createDevOSPresentationFocusState,
} from '../src/metaengine-devos-presentation-focus.mjs';

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
  return Object.freeze({
    session_id: sessionId,
    title: sessionId,
    status: 'ACTIVE',
    surface_ids: Object.freeze(surfaceIds),
    task_count: 1,
    ...zeroAuthority(),
  });
}

function surface(surfaceId, sessionId, type = 'BROWSER', tabId = null) {
  return Object.freeze({
    surface_id: surfaceId,
    session_id: sessionId,
    type,
    tab_id: tabId,
    state: 'AVAILABLE',
    ...zeroAuthority(),
  });
}

function devos() {
  return Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    browser_is_shell: false,
    browser_is_surface: true,
    sessions: Object.freeze([
      session('session:a', ['browser:a1']),
      session('session:b', ['browser:b1', 'terminal:b1']),
    ]),
    surfaces: Object.freeze([
      surface('browser:a1', 'session:a', 'BROWSER', 'tab.a1'),
      surface('browser:b1', 'session:b', 'BROWSER', 'tab.b1'),
      surface('terminal:b1', 'session:b', 'TERMINAL'),
    ]),
    selected: Object.freeze({ session_id: 'session:a', surface_id: 'browser:a1' }),
    ...zeroAuthority(),
  });
}

function assertZeroAuthority(value) {
  assert.equal(value.projection_is_authority, false);
  assert.equal(value.scheduler_authority, false);
  assert.equal(value.execution_authority, false);
  assert.equal(value.command_leasing, false);
  assert.equal(value.automatic_effect_retry_allowed, false);
  assert.equal(value.page_model_authority, false);
  assert.equal(value.authority_effect, false);
}

test('empty presentation focus never falls back to canonical Browser selection', () => {
  const focus = createDevOSPresentationFocusState();
  const snapshot = focus.snapshot();
  assert.equal(snapshot.schema, METAENGINE_DEVOS_PRESENTATION_FOCUS_SCHEMA);
  assert.equal(snapshot.active_session_id, null);
  assert.equal(snapshot.active_surface_id, null);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.browser_tab_selection_is_focus_authority, false);
  assert.equal(snapshot.layout_preference_is_focus_authority, false);
  assert.equal(snapshot.model_or_page_is_focus_authority, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assertZeroAuthority(snapshot);

  const result = focus.reconcile(devos());
  assert.equal(result.schema, METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA);
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'EMPTY');
  assert.equal(result.effective_session_id, null);
  assert.equal(result.effective_surface_id, null);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('selectSession records explicit user context and clears any prior surface', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:a', 'browser:a1');
  const before = focus.snapshot();
  const after = focus.selectSession('session:b');
  assert.equal(before.revision, 1);
  assert.equal(after.revision, 2);
  assert.equal(after.active_session_id, 'session:b');
  assert.equal(after.active_surface_id, null);
  assert.equal(after.source, 'USER_SHELL_EXPLICIT');
  assert.equal(after.presentation_only, true);
  assert.equal(after.durable_persistence_enabled, false);
  assertZeroAuthority(after);
});

test('selectSession is idempotent when the same session-only context is already active', () => {
  const focus = createDevOSPresentationFocusState();
  const first = focus.selectSession('session:b');
  const second = focus.selectSession('session:b');
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(second.active_surface_id, null);
  assertZeroAuthority(second);
});

test('selectSurface sets exact explicit Session and Surface presentation context', () => {
  const focus = createDevOSPresentationFocusState();
  const state = focus.selectSurface('session:b', 'terminal:b1');
  assert.equal(state.active_session_id, 'session:b');
  assert.equal(state.active_surface_id, 'terminal:b1');
  assert.equal(state.revision, 1);
  assertZeroAuthority(state);

  const result = focus.reconcile(devos());
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'AVAILABLE');
  assert.equal(result.effective_session_id, 'session:b');
  assert.equal(result.effective_surface_id, 'terminal:b1');
  assert.equal(result.session_focus_valid, true);
  assert.equal(result.surface_focus_valid, true);
  assert.equal(result.stale_focus_detected, false);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('valid session-only focus remains independent from canonical selected Browser tab', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:b');
  const result = focus.reconcile(devos());
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'SESSION_ONLY');
  assert.equal(result.requested_session_id, 'session:b');
  assert.equal(result.effective_session_id, 'session:b');
  assert.equal(result.effective_surface_id, null);
  assert.equal(result.session_focus_valid, true);
  assert.equal(result.surface_focus_valid, false);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('stale explicit Session does not fall back to another canonical or Browser-selected session', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:gone', 'browser:gone');
  const result = focus.reconcile(devos());
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'STALE_SESSION');
  assert.equal(result.stale_focus_detected, true);
  assert.equal(result.requested_session_id, 'session:gone');
  assert.equal(result.effective_session_id, null);
  assert.equal(result.effective_surface_id, null);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('stale Surface preserves valid Session context but never chooses a replacement Surface', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:b', 'browser:gone');
  const result = focus.reconcile(devos());
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'STALE_SURFACE');
  assert.equal(result.reason, 'EXPLICIT_SURFACE_NO_LONGER_PRESENT');
  assert.equal(result.effective_session_id, 'session:b');
  assert.equal(result.effective_surface_id, null);
  assert.equal(result.session_focus_valid, true);
  assert.equal(result.surface_focus_valid, false);
  assert.equal(result.stale_focus_detected, true);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('Surface ownership mismatch degrades to Session-only instead of crossing Session boundary', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:b', 'browser:a1');
  const result = focus.reconcile(devos());
  assert.equal(result.valid, true);
  assert.equal(result.source_state, 'STALE_SURFACE');
  assert.equal(result.reason, 'EXPLICIT_SURFACE_SESSION_MISMATCH');
  assert.equal(result.effective_session_id, 'session:b');
  assert.equal(result.effective_surface_id, null);
  assert.equal(result.replacement_selected_automatically, false);
  assertZeroAuthority(result);
});

test('authority-bearing or structurally inconsistent DevOS projection fails closed', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:b', 'browser:b1');
  const source = devos();
  for (const corrupt of [
    { ...source, scheduler_authority: true },
    { ...source, sessions: [...source.sessions, { ...source.sessions[0] }] },
    { ...source, surfaces: source.surfaces.map((row) => row.surface_id === 'browser:b1' ? { ...row, execution_authority: true } : row) },
    { ...source, surfaces: [...source.surfaces, surface('browser:orphan', 'session:missing', 'BROWSER', 'tab.orphan')] },
  ]) {
    const result = focus.reconcile(corrupt);
    assert.equal(result.valid, false);
    assert.equal(result.source_state, 'INVALID_DEVOS');
    assert.equal(result.effective_session_id, null);
    assert.equal(result.effective_surface_id, null);
    assert.equal(result.replacement_selected_automatically, false);
    assertZeroAuthority(result);
  }
});

test('clear removes presentation context without changing revision on repeated no-op clear', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:b', 'browser:b1');
  const cleared = focus.clear();
  assert.equal(cleared.revision, 2);
  assert.equal(cleared.active_session_id, null);
  assert.equal(cleared.active_surface_id, null);
  const again = focus.clear();
  assert.equal(again.revision, 2);
  assert.equal(again.active_session_id, null);
  assertZeroAuthority(again);
});

test('presentation focus ids reject empty, control-character, and oversized values', () => {
  const focus = createDevOSPresentationFocusState();
  for (const invalid of ['', '   ', 'session:\u0000bad', 's'.repeat(201)]) {
    assert.throws(() => focus.selectSession(invalid), /devos_presentation_focus_session_id_invalid/);
  }
  assert.throws(() => focus.selectSurface('session:a', ''), /devos_presentation_focus_surface_id_invalid/);
  assert.throws(() => focus.selectSurface('session:a', 'x'.repeat(241)), /devos_presentation_focus_surface_id_invalid/);
});
