import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSPresentationFocusState } from '../src/metaengine-devos-presentation-focus.mjs';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

function input(sessionLayouts = undefined, presentationFocus = undefined) {
  return {
    tabs: {
      selected_tab_id: 'tab.1',
      tabs: [{ tab_id: 'tab.1', title: 'Browser one', url: 'https://example.com', kind: 'WEB' }],
    },
    fleet: { agents: [] },
    supervisor: null,
    ...(sessionLayouts === undefined ? {} : { session_layouts: sessionLayouts }),
    ...(presentationFocus === undefined ? {} : { presentation_focus: presentationFocus }),
  };
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

test('workspace read model keeps canonical Browser selection separate from an empty client presentation focus', () => {
  const workspaces = projectWorkspaceWorkbench(input());
  assert.equal(workspaces.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(workspaces.devos_shell.schema, 'metaengine.devos.shell-view-model.v1');
  assert.equal(workspaces.devos_shell.valid, true);
  assert.notEqual(workspaces.devos_shell, workspaces.devos);
  assert.equal(workspaces.devos.shell_view, undefined);
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.selected_session, null);
  assert.equal(workspaces.devos_shell.selected_surface, null);
  assert.equal(workspaces.devos_shell.presentation_focus.source_state, 'EMPTY');
  assert.equal(workspaces.devos_shell.presentation_focus.replacement_selected_automatically, false);
  assertZeroAuthority(workspaces.devos);
  assertZeroAuthority(workspaces.devos_shell.presentation_focus);
  assertZeroAuthority(workspaces.devos_shell);
});

test('explicit presentation focus is the only input that selects a Session and Surface in devos_shell', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSurface('session:browser-unbound', 'browser:tab.1');
  const workspaces = projectWorkspaceWorkbench(input(undefined, focus.snapshot()));
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.selected_surface.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.presentation_focus.source_state, 'AVAILABLE');
  assert.equal(workspaces.devos_shell.presentation_focus.replacement_selected_automatically, false);
  assertZeroAuthority(workspaces.devos_shell.presentation_focus);
});

test('shell ViewModel consumes stable NOT_EXPOSED layout DTO only after an explicit Session is focused', () => {
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:browser-unbound');
  const workspaces = projectWorkspaceWorkbench(input(undefined, focus.snapshot()));
  const layout = workspaces.devos_shell.layout_preferences;
  assert.ok(layout);
  assert.equal(layout.source_state, 'NOT_EXPOSED');
  assert.equal(layout.requested_sidebar, 'EXPANDED');
  assert.equal(layout.requested_inspector, 'CLOSED');
  assert.equal(layout.stored_surface_is_selection_authority, false);
  assert.equal(workspaces.devos_shell.selected_surface, null);
  assertZeroAuthority(layout);
});

test('available registry enriches only focused Session layout preferences and leaves canonical selection unchanged', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  layouts.setRequested('session:browser-unbound', { sidebar: 'COMPACT', inspector: 'OPEN' });
  layouts.setActiveSurface('session:browser-unbound', 'browser:historical-focus');
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:browser-unbound');
  const workspaces = projectWorkspaceWorkbench(input(layouts.snapshot(), focus.snapshot()));

  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.selected_surface, null);
  assert.equal(workspaces.devos_shell.layout_preferences.source_state, 'AVAILABLE');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_sidebar, 'COMPACT');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_inspector, 'OPEN');
  assert.equal(workspaces.devos_shell.layout_preferences.stored_surface_id, 'browser:historical-focus');
  assert.equal(workspaces.devos_shell.layout_preferences.stored_surface_is_selection_authority, false);
});

test('invalid layout registry degrades preferences but cannot invalidate explicit presentation focus or rewrite canonical DevOS selection', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  const corrupt = structuredClone(layouts.snapshot());
  corrupt.scheduler_authority = true;
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:browser-unbound');
  const workspaces = projectWorkspaceWorkbench(input(corrupt, focus.snapshot()));

  assert.equal(workspaces.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos.layout_preferences.source_state, 'INVALID_REGISTRY');
  assert.equal(workspaces.devos_shell.valid, true);
  assert.equal(workspaces.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.selected_surface, null);
  assert.equal(workspaces.devos_shell.layout_preferences.source_state, 'INVALID_REGISTRY');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_sidebar, 'EXPANDED');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_inspector, 'CLOSED');
  assertZeroAuthority(workspaces.devos_shell);
});
