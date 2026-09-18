import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSPresentationFocusState } from '../src/metaengine-devos-presentation-focus.mjs';
import { projectDevOSShellViewModel } from '../src/metaengine-devos-shell-view-model.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

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

function devos() {
  return projectWorkspaceWorkbench({
    tabs: {
      selected_tab_id: 'tab.one',
      tabs: [{ tab_id: 'tab.one', title: 'One', url: 'https://example.com', kind: 'WEB' }],
    },
    fleet: { agents: [] },
    supervisor: null,
  }).devos;
}

function assertZeroAuthority(row) {
  assert.equal(row.projection_is_authority, false);
  assert.equal(row.scheduler_authority, false);
  assert.equal(row.execution_authority, false);
  assert.equal(row.command_leasing, false);
  assert.equal(row.automatic_effect_retry_allowed, false);
  assert.equal(row.page_model_authority, false);
  assert.equal(row.authority_effect, false);
}

test('empty presentation focus never exposes canonical Browser selection as selected Session surfaces', () => {
  const view = projectDevOSShellViewModel(devos());
  assert.equal(view.valid, true);
  assert.equal(view.selected_session, null);
  assert.deepEqual(view.selected_session_surfaces, []);
  assert.equal(view.selected_session_surface_count, 0);
  assert.equal(view.selected_session_surfaces_truncated, false);
});

test('explicit Session focus projects exact owned Surface rows without renderer reconstruction', () => {
  const model = devos();
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:browser-unbound');
  const view = projectDevOSShellViewModel(model, focus.snapshot());
  assert.equal(view.valid, true);
  assert.equal(view.selected_session.session_id, 'session:browser-unbound');
  assert.equal(view.selected_surface, null);
  assert.equal(view.selected_session_surface_count, 2);
  assert.equal(view.selected_session_surfaces_truncated, false);
  assert.equal(view.selected_session_surfaces.length, 2);
  assert.deepEqual(
    Object.fromEntries(Object.entries(view.selected_session_surfaces[0]).filter(([key]) => !key.endsWith('_authority') && !['projection_is_authority', 'command_leasing', 'automatic_effect_retry_allowed', 'authority_effect'].includes(key))),
    {
      surface_id: 'browser:tab.one',
      session_id: 'session:browser-unbound',
      type: 'BROWSER',
      title: 'One',
      state: 'WEB',
      tab_id: 'tab.one',
      runtime_bound: true,
      presentation_only: false,
    },
  );
  assertZeroAuthority(view.selected_session_surfaces[0]);
});

test('selected Session surface membership fails closed on missing or duplicate ids', () => {
  for (const mutate of [
    (model) => { model.sessions[0].surface_ids.push('browser:missing'); },
    (model) => { model.sessions[0].surface_ids.push(model.sessions[0].surface_ids[0]); },
  ]) {
    const model = structuredClone(devos());
    mutate(model);
    const focus = createDevOSPresentationFocusState();
    focus.selectSession('session:browser-unbound');
    const view = projectDevOSShellViewModel(model, focus.snapshot());
    assert.equal(view.valid, false);
    assert.equal(view.reason, 'SELECTED_SESSION_SURFACE_MEMBERSHIP_INVALID');
    assert.deepEqual(view.selected_session_surfaces, []);
  }
});

test('selected Session surface projection is bounded at 256 while preserving the exact total count', () => {
  const model = structuredClone(devos());
  const session = model.sessions.find((row) => row.session_id === 'session:browser-unbound');
  for (let index = 0; index < 300; index += 1) {
    const surfaceId = `terminal:extra-${index}`;
    session.surface_ids.push(surfaceId);
    model.surfaces.push({
      surface_id: surfaceId,
      session_id: session.session_id,
      type: 'TERMINAL',
      title: `Terminal ${index}`,
      tab_id: null,
      state: 'AVAILABLE',
      ...zeroAuthority(),
    });
  }
  const focus = createDevOSPresentationFocusState();
  focus.selectSession(session.session_id);
  const view = projectDevOSShellViewModel(model, focus.snapshot());
  assert.equal(view.valid, true);
  assert.equal(view.selected_session_surface_count, 302);
  assert.equal(view.selected_session_surfaces.length, 256);
  assert.equal(view.selected_session_surfaces_truncated, true);
  for (const row of view.selected_session_surfaces) {
    assert.equal(row.session_id, session.session_id);
    assertZeroAuthority(row);
  }
});
