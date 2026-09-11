import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA,
  METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA,
  createDevOSSessionLayoutRegistry,
} from '../src/metaengine-devos-session-layout.mjs';
import { planShellLayout } from '../src/shell-layout.mjs';

function assertZeroAuthority(value) {
  assert.equal(value.projection_is_authority, false);
  assert.equal(value.scheduler_authority, false);
  assert.equal(value.execution_authority, false);
  assert.equal(value.command_leasing, false);
  assert.equal(value.automatic_effect_retry_allowed, false);
  assert.equal(value.page_model_authority, false);
  assert.equal(value.authority_effect, false);
}

test('per-session DevOS layout defaults are bounded, immutable and zero-authority', () => {
  const registry = createDevOSSessionLayoutRegistry({ max_sessions: 3 });
  const entry = registry.ensure('session-a');
  assert.equal(entry.schema, METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA);
  assert.equal(entry.requested_sidebar, 'EXPANDED');
  assert.equal(entry.requested_inspector, 'CLOSED');
  assert.equal(entry.active_surface_id, null);
  assert.equal(entry.revision, 1);
  assert.equal(Object.isFrozen(entry), true);
  assertZeroAuthority(entry);

  const snapshot = registry.snapshot();
  assert.equal(snapshot.schema, METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA);
  assert.equal(snapshot.bounded, true);
  assert.equal(snapshot.max_sessions, 3);
  assert.equal(snapshot.session_count, 1);
  assert.equal(snapshot.requested_state_is_user_preference, true);
  assert.equal(snapshot.effective_responsive_state_persisted, false);
  assert.equal(snapshot.session_layout_is_execution_authority, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.entries), true);
  assertZeroAuthority(snapshot);
});

test('requested session layout survives responsive effective adaptation unchanged', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session-a');
  const requested = registry.setRequested('session-a', { sidebar: 'EXPANDED', inspector: 'OPEN' });
  const revision = requested.revision;

  const effective = planShellLayout({
    width: 1000,
    height: 800,
    state: { sidebar: requested.requested_sidebar, operations: requested.requested_inspector },
  });
  assert.equal(effective.effective_sidebar, 'COMPACT');
  assert.equal(effective.effective_operations, 'CLOSED');

  const after = registry.get('session-a');
  assert.equal(after.requested_sidebar, 'EXPANDED');
  assert.equal(after.requested_inspector, 'OPEN');
  assert.equal(after.revision, revision);
});

test('session activation restores independent requested state and active surface', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.setRequested('session-a', { sidebar: 'HIDDEN', inspector: 'OPEN' });
  registry.setActiveSurface('session-a', 'surface-browser-a');
  registry.setRequested('session-b', { sidebar: 'COMPACT', inspector: 'CLOSED' });
  registry.setActiveSurface('session-b', 'surface-terminal-b');

  const a = registry.activate('session-a');
  assert.equal(registry.activeSessionId, 'session-a');
  assert.equal(a.requested_sidebar, 'HIDDEN');
  assert.equal(a.requested_inspector, 'OPEN');
  assert.equal(a.active_surface_id, 'surface-browser-a');

  const b = registry.activate('session-b');
  assert.equal(registry.activeSessionId, 'session-b');
  assert.equal(b.requested_sidebar, 'COMPACT');
  assert.equal(b.requested_inspector, 'CLOSED');
  assert.equal(b.active_surface_id, 'surface-terminal-b');
});

test('bounded eviction protects active session and deterministically removes oldest inactive state', () => {
  const registry = createDevOSSessionLayoutRegistry({ max_sessions: 3 });
  registry.ensure('session-a');
  registry.ensure('session-b');
  registry.ensure('session-c');
  registry.activate('session-b');
  registry.ensure('session-d');

  const snapshot = registry.snapshot();
  assert.equal(snapshot.session_count, 3);
  assert.equal(snapshot.active_session_id, 'session-b');
  assert.equal(registry.get('session-a'), null);
  assert.notEqual(registry.get('session-b'), null);
  assert.notEqual(registry.get('session-c'), null);
  assert.notEqual(registry.get('session-d'), null);
});

test('restore roundtrip preserves exact user preferences without creating authority', () => {
  const source = createDevOSSessionLayoutRegistry({ max_sessions: 4 });
  source.activate('session-a');
  source.setRequested('session-a', { sidebar: 'COMPACT', inspector: 'OPEN' });
  source.setActiveSurface('session-a', 'surface-a');
  source.ensure('session-b');
  source.setRequested('session-b', { sidebar: 'HIDDEN' });

  const restored = createDevOSSessionLayoutRegistry({ max_sessions: 4 });
  const snapshot = restored.restore(source.snapshot());
  assert.equal(snapshot.active_session_id, 'session-a');
  assert.equal(snapshot.session_count, 2);
  assert.equal(restored.get('session-a').requested_sidebar, 'COMPACT');
  assert.equal(restored.get('session-a').requested_inspector, 'OPEN');
  assert.equal(restored.get('session-a').active_surface_id, 'surface-a');
  assert.equal(restored.get('session-b').requested_sidebar, 'HIDDEN');
  assertZeroAuthority(snapshot);
  for (const entry of snapshot.entries) assertZeroAuthority(entry);
});

test('restore into a smaller bound preserves the active session before newer inactive sessions', () => {
  const source = createDevOSSessionLayoutRegistry({ max_sessions: 4 });
  source.ensure('session-a');
  source.ensure('session-b');
  source.ensure('session-c');
  source.activate('session-a');
  source.setRequested('session-b', { sidebar: 'COMPACT' });
  source.setRequested('session-c', { sidebar: 'HIDDEN' });

  const restored = createDevOSSessionLayoutRegistry({ max_sessions: 1 });
  const snapshot = restored.restore(source.snapshot());
  assert.equal(snapshot.session_count, 1);
  assert.equal(snapshot.active_session_id, 'session-a');
  assert.notEqual(restored.get('session-a'), null);
  assert.equal(restored.get('session-b'), null);
  assert.equal(restored.get('session-c'), null);
});

test('restore fails closed on any authority-bearing or effective-layout persistence claim', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session-a');
  const clean = registry.snapshot();

  for (const mutate of [
    (value) => { value.scheduler_authority = true; },
    (value) => { value.execution_authority = true; },
    (value) => { value.command_leasing = true; },
    (value) => { value.automatic_effect_retry_allowed = true; },
    (value) => { value.page_model_authority = true; },
    (value) => { value.authority_effect = true; },
    (value) => { value.session_layout_is_execution_authority = true; },
    (value) => { value.effective_responsive_state_persisted = true; },
    (value) => { value.requested_state_is_user_preference = false; },
  ]) {
    const corrupt = structuredClone(clean);
    mutate(corrupt);
    assert.throws(() => createDevOSSessionLayoutRegistry().restore(corrupt));
  }

  for (const mutate of [
    (entry) => { entry.scheduler_authority = true; },
    (entry) => { entry.automatic_effect_retry_allowed = true; },
    (entry) => { entry.page_model_authority = true; },
    (entry) => { entry.authority_effect = true; },
  ]) {
    const corrupt = structuredClone(clean);
    mutate(corrupt.entries[0]);
    assert.throws(() => createDevOSSessionLayoutRegistry().restore(corrupt));
  }
});

test('restore rejects malformed counters, duplicates and dangling active session instead of normalizing them', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session-a');
  const clean = registry.snapshot();

  const badRevision = structuredClone(clean);
  badRevision.entries[0].revision = 0;
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(badRevision), /restore_revision_invalid/);

  const badSequence = structuredClone(clean);
  badSequence.entries[0].updated_sequence = -1;
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(badSequence), /restore_updated_sequence_invalid/);

  const regressedSequence = structuredClone(clean);
  regressedSequence.latest_sequence = 0;
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(regressedSequence), /restore_sequence_regression/);

  const duplicate = structuredClone(clean);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  duplicate.session_count = duplicate.entries.length;
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(duplicate), /restore_duplicate_session/);

  const danglingActive = structuredClone(clean);
  danglingActive.active_session_id = 'session-missing';
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(danglingActive), /restore_active_session_missing/);

  const mismatchedCount = structuredClone(clean);
  mismatchedCount.session_count = 0;
  assert.throws(() => createDevOSSessionLayoutRegistry().restore(mismatchedCount), /restore_session_count_mismatch/);
});

test('invalid identifiers and layout modes are rejected at the state boundary', () => {
  const registry = createDevOSSessionLayoutRegistry();
  assert.throws(() => registry.ensure(''), /session_id_invalid/);
  assert.throws(() => registry.ensure('bad\ncontrol'), /session_id_invalid/);
  assert.throws(() => registry.setRequested('session-a', { sidebar: 'FLOATING' }), /sidebar_invalid/);
  assert.throws(() => registry.setRequested('session-a', { inspector: 'PINNED' }), /inspector_invalid/);
  assert.throws(() => registry.setActiveSurface('session-a', 'bad\u0000surface'), /surface_id_invalid/);
});
