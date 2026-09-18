import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSPresentationFocusState } from '../src/metaengine-devos-presentation-focus.mjs';
import {
  METAENGINE_DEVOS_PRESENTATION_ACTIVATION_RESULT_SCHEMA,
  applyDevOSPresentationActivation,
} from '../src/metaengine-devos-presentation-activation-runtime.mjs';

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

function devos({ storedB = null } = {}) {
  const sessions = Object.freeze([
    Object.freeze({ session_id: 'session:a', title: 'A', status: 'ACTIVE', surface_ids: Object.freeze(['browser:a1']), task_count: 0, ...zeroAuthority() }),
    Object.freeze({ session_id: 'session:b', title: 'B', status: 'ACTIVE', surface_ids: Object.freeze(['browser:b1', 'browser:b2']), task_count: 0, ...zeroAuthority() }),
    Object.freeze({ session_id: 'session:c', title: 'C', status: 'ACTIVE', surface_ids: Object.freeze(['terminal:c1']), task_count: 0, ...zeroAuthority() }),
  ]);
  const surfaces = Object.freeze([
    Object.freeze({ surface_id: 'browser:a1', session_id: 'session:a', type: 'BROWSER', title: 'A1', tab_id: 'tab.a1', state: 'AVAILABLE', ...zeroAuthority() }),
    Object.freeze({ surface_id: 'browser:b1', session_id: 'session:b', type: 'BROWSER', title: 'B1', tab_id: 'tab.b1', state: 'AVAILABLE', ...zeroAuthority() }),
    Object.freeze({ surface_id: 'browser:b2', session_id: 'session:b', type: 'BROWSER', title: 'B2', tab_id: 'tab.b2', state: 'AVAILABLE', ...zeroAuthority() }),
    Object.freeze({ surface_id: 'terminal:c1', session_id: 'session:c', type: 'TERMINAL', title: 'C1', tab_id: null, state: 'AVAILABLE', ...zeroAuthority() }),
  ]);
  const entries = [];
  if (storedB) entries.push(Object.freeze({
    schema: 'metaengine.devos.session-layout-preference.v1',
    session_id: 'session:b',
    requested_sidebar: 'EXPANDED',
    requested_inspector: 'CLOSED',
    stored_surface_id: storedB,
    stored_surface_is_focus_preference: true,
    stored_surface_is_selection_authority: false,
    revision: 1,
    updated_sequence: 1,
    ...zeroAuthority(),
  }));
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

function assertZeroAuthority(result) {
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

test('invalid intent is a no-op for Browser and presentation focus', () => {
  const focus = createDevOSPresentationFocusState();
  let browserCalls = 0;
  const result = applyDevOSPresentationActivation({
    devos: devos(),
    request: { intent: 'SESSION', session_id: 'session:missing' },
    presentationFocus: focus,
    selectBrowserTab: () => { browserCalls += 1; },
  });
  assert.equal(result.schema, METAENGINE_DEVOS_PRESENTATION_ACTIVATION_RESULT_SCHEMA);
  assert.equal(result.valid, false);
  assert.equal(result.applied, false);
  assert.equal(browserCalls, 0);
  assert.equal(focus.snapshot().active_session_id, null);
  assertZeroAuthority(result);
});

test('ambiguous Session intent commits Session focus without a Browser switch', () => {
  const focus = createDevOSPresentationFocusState();
  let browserCalls = 0;
  const result = applyDevOSPresentationActivation({
    devos: devos(),
    request: { intent: 'SESSION', session_id: 'session:b' },
    presentationFocus: focus,
    selectBrowserTab: () => { browserCalls += 1; },
  });
  assert.equal(result.valid, true);
  assert.equal(result.applied, true);
  assert.equal(result.surface_selection_required, true);
  assert.equal(result.browser_activation_requested, false);
  assert.equal(result.browser_activation_performed, false);
  assert.equal(browserCalls, 0);
  assert.equal(result.presentation_focus.active_session_id, 'session:b');
  assert.equal(result.presentation_focus.active_surface_id, null);
  assertZeroAuthority(result);
});

test('stored Browser preference activates exactly one target before committing Session focus', () => {
  const focus = createDevOSPresentationFocusState();
  const order = [];
  const originalSelectSession = focus.selectSession.bind(focus);
  focus.selectSession = (sessionId) => { order.push(`focus:${sessionId}`); return originalSelectSession(sessionId); };
  const result = applyDevOSPresentationActivation({
    devos: devos({ storedB: 'browser:b2' }),
    request: { intent: 'SESSION', session_id: 'session:b' },
    presentationFocus: focus,
    selectBrowserTab: (tabId) => { order.push(`browser:${tabId}`); },
  });
  assert.deepEqual(order, ['browser:tab.b2', 'focus:session:b']);
  assert.equal(result.applied, true);
  assert.equal(result.browser_activation_requested, true);
  assert.equal(result.browser_activation_performed, true);
  assert.equal(result.target_tab_id, 'tab.b2');
  assert.equal(result.presentation_focus.active_session_id, 'session:b');
  assert.equal(result.presentation_focus.active_surface_id, null);
  assertZeroAuthority(result);
});

test('Browser activation failure is fail-closed: no retry and no presentation focus mutation', () => {
  const focus = createDevOSPresentationFocusState();
  let calls = 0;
  const result = applyDevOSPresentationActivation({
    devos: devos({ storedB: 'browser:b1' }),
    request: { intent: 'SESSION', session_id: 'session:b' },
    presentationFocus: focus,
    selectBrowserTab: () => { calls += 1; throw new Error('tab_not_found'); },
  });
  assert.equal(result.valid, true);
  assert.equal(result.applied, false);
  assert.match(result.reason, /^BROWSER_ACTIVATION_FAILED:/);
  assert.equal(result.browser_activation_requested, true);
  assert.equal(result.browser_activation_performed, false);
  assert.equal(calls, 1);
  assert.equal(focus.snapshot().active_session_id, null);
  assertZeroAuthority(result);
});

test('explicit Browser Surface activates exact tab then commits exact Session+Surface focus', () => {
  const focus = createDevOSPresentationFocusState();
  const calls = [];
  const result = applyDevOSPresentationActivation({
    devos: devos(),
    request: { intent: 'SURFACE', session_id: 'session:b', surface_id: 'browser:b1' },
    presentationFocus: focus,
    selectBrowserTab: (tabId) => calls.push(tabId),
  });
  assert.deepEqual(calls, ['tab.b1']);
  assert.equal(result.applied, true);
  assert.equal(result.presentation_focus.active_session_id, 'session:b');
  assert.equal(result.presentation_focus.active_surface_id, 'browser:b1');
  assertZeroAuthority(result);
});

test('explicit non-Browser Surface commits focus without Browser activation', () => {
  const focus = createDevOSPresentationFocusState();
  let browserCalls = 0;
  const result = applyDevOSPresentationActivation({
    devos: devos(),
    request: { intent: 'SURFACE', session_id: 'session:c', surface_id: 'terminal:c1' },
    presentationFocus: focus,
    selectBrowserTab: () => { browserCalls += 1; },
  });
  assert.equal(result.applied, true);
  assert.equal(browserCalls, 0);
  assert.equal(result.presentation_focus.active_session_id, 'session:c');
  assert.equal(result.presentation_focus.active_surface_id, 'terminal:c1');
  assertZeroAuthority(result);
});

test('missing Browser activator is detected before mutating presentation focus', () => {
  const focus = createDevOSPresentationFocusState();
  const result = applyDevOSPresentationActivation({
    devos: devos({ storedB: 'browser:b2' }),
    request: { intent: 'SESSION', session_id: 'session:b' },
    presentationFocus: focus,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'BROWSER_ACTIVATOR_UNAVAILABLE');
  assert.equal(focus.snapshot().active_session_id, null);
  assertZeroAuthority(result);
});
