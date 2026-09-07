import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';
import {
  METAENGINE_DEVOS_SESSION_LAYOUT_PROJECTION_SCHEMA,
  attachDevOSSessionLayout,
  projectDevOSSessionLayout,
} from '../src/metaengine-devos-session-layout-projection.mjs';

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

function devos({ selectedSession = 'session:a', selectedSurface = 'browser:tab-a' } = {}) {
  return Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    mode: 'DEVELOPMENT_OS',
    primary_object: 'SESSION',
    sessions: Object.freeze([
      Object.freeze({ session_id: 'session:a', title: 'A', ...zeroAuthority() }),
      Object.freeze({ session_id: 'session:b', title: 'B', ...zeroAuthority() }),
    ]),
    selected: Object.freeze({ session_id: selectedSession, surface_id: selectedSurface }),
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

test('missing registry yields default preference without inventing selection authority', () => {
  const projection = projectDevOSSessionLayout(devos(), null);
  assert.equal(projection.schema, METAENGINE_DEVOS_SESSION_LAYOUT_PROJECTION_SCHEMA);
  assert.equal(projection.source_state, 'NOT_EXPOSED');
  assert.equal(projection.selected_session_id, 'session:a');
  assert.equal(projection.selected_surface_id, 'browser:tab-a');
  assert.equal(projection.active.requested_sidebar, 'EXPANDED');
  assert.equal(projection.active.requested_inspector, 'CLOSED');
  assert.equal(projection.active.source, 'DEFAULT_SESSION_PREFERENCE');
  assert.equal(projection.registry_active_session_is_selection_authority, false);
  assert.equal(projection.stored_surface_is_selection_authority, false);
  assertZeroAuthority(projection);
});

test('valid registry attaches requested layout for the canonical DevOS-selected session', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  registry.setRequested('session:a', { sidebar: 'COMPACT', inspector: 'OPEN' });
  registry.setActiveSurface('session:a', 'browser:last-focused-a');
  registry.ensure('session:b');

  const projection = projectDevOSSessionLayout(devos(), registry.snapshot());
  assert.equal(projection.source_state, 'AVAILABLE');
  assert.equal(projection.selection_alignment, 'ALIGNED');
  assert.equal(projection.active.session_id, 'session:a');
  assert.equal(projection.active.requested_sidebar, 'COMPACT');
  assert.equal(projection.active.requested_inspector, 'OPEN');
  assert.equal(projection.active.stored_surface_id, 'browser:last-focused-a');
  assert.equal(projection.active.selected_surface_id, 'browser:tab-a');
  assert.equal(projection.active.stored_surface_is_selection_authority, false);
  assert.equal(projection.entries.length, 2);
  assertZeroAuthority(projection.active);
});

test('stale registry active session never overrides canonical DevOS selection', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.setRequested('session:a', { sidebar: 'HIDDEN', inspector: 'OPEN' });
  registry.activate('session:b');
  registry.setRequested('session:b', { sidebar: 'COMPACT', inspector: 'CLOSED' });

  const projection = projectDevOSSessionLayout(devos({ selectedSession: 'session:a' }), registry.snapshot());
  assert.equal(projection.registry_active_session_id, 'session:b');
  assert.equal(projection.selected_session_id, 'session:a');
  assert.equal(projection.selection_alignment, 'STALE_REGISTRY_ACTIVE_SESSION');
  assert.equal(projection.active.session_id, 'session:a');
  assert.equal(projection.active.requested_sidebar, 'HIDDEN');
  assert.equal(projection.registry_active_session_is_selection_authority, false);
});

test('stored surface focus never overrides currently selected DevOS surface', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  registry.setActiveSurface('session:a', 'browser:stale-surface');

  const projection = projectDevOSSessionLayout(devos({ selectedSurface: 'browser:current-surface' }), registry.snapshot());
  assert.equal(projection.active.stored_surface_id, 'browser:stale-surface');
  assert.equal(projection.active.selected_surface_id, 'browser:current-surface');
  assert.equal(projection.active.stored_surface_is_focus_preference, true);
  assert.equal(projection.active.stored_surface_is_selection_authority, false);
});

test('stale registry entries for sessions absent from DevOS are filtered from the read model', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  registry.ensure('session:b');
  registry.ensure('session:stale');
  const projection = projectDevOSSessionLayout(devos(), registry.snapshot());
  assert.deepEqual(projection.entries.map((entry) => entry.session_id).sort(), ['session:a', 'session:b']);
});

test('authority-bearing or malformed registry fails closed instead of being sanitized into a usable preference', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  const clean = registry.snapshot();

  for (const mutate of [
    (value) => { value.scheduler_authority = true; },
    (value) => { value.entries[0].automatic_effect_retry_allowed = true; },
    (value) => { value.effective_responsive_state_persisted = true; },
    (value) => { value.entries[0].revision = 0; },
  ]) {
    const corrupt = structuredClone(clean);
    mutate(corrupt);
    const projection = projectDevOSSessionLayout(devos(), corrupt);
    assert.equal(projection.source_state, 'INVALID_REGISTRY');
    assert.equal(projection.entries.length, 0);
    assert.equal(projection.active.source, 'DEFAULT_SESSION_PREFERENCE');
    assertZeroAuthority(projection);
  }
});

test('invalid DevOS projection cannot gain credibility from a valid layout registry', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  const invalid = { ...devos(), scheduler_authority: true };
  const projection = projectDevOSSessionLayout(invalid, registry.snapshot());
  assert.equal(projection.source_state, 'INVALID_DEVOS');
  assert.equal(projection.registry_reason, 'DEVOS_PROJECTION_INVALID');
  assertZeroAuthority(projection);
});

test('attachment is additive read-only data and preserves DevOS selection as source of truth', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:b');
  registry.setRequested('session:a', { sidebar: 'COMPACT', inspector: 'OPEN' });
  const source = devos({ selectedSession: 'session:a', selectedSurface: 'browser:tab-a' });
  const attached = attachDevOSSessionLayout(source, registry.snapshot());
  assert.equal(attached.selected.session_id, 'session:a');
  assert.equal(attached.selected.surface_id, 'browser:tab-a');
  assert.equal(attached.layout_preferences.active.session_id, 'session:a');
  assert.equal(attached.layout_preferences.selection_alignment, 'STALE_REGISTRY_ACTIVE_SESSION');
  assert.equal(Object.isFrozen(attached), true);
  assertZeroAuthority(attached);
});
