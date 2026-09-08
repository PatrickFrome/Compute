import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

function input(sessionLayouts = undefined) {
  return {
    tabs: {
      selected_tab_id: 'tab.1',
      tabs: [{ tab_id: 'tab.1', title: 'Browser one', url: 'https://example.com', kind: 'WEB' }],
    },
    fleet: { agents: [] },
    supervisor: null,
    ...(sessionLayouts === undefined ? {} : { session_layouts: sessionLayouts }),
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

test('workspace read model exposes canonical DevOS and a separate client shell ViewModel', () => {
  const workspaces = projectWorkspaceWorkbench(input());
  assert.equal(workspaces.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(workspaces.devos_shell.schema, 'metaengine.devos.shell-view-model.v1');
  assert.equal(workspaces.devos_shell.valid, true);
  assert.notEqual(workspaces.devos_shell, workspaces.devos);
  assert.equal(workspaces.devos.shell_view, undefined);
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.selected_session.session_id, workspaces.devos.selected.session_id);
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.selected_surface.surface_id, workspaces.devos.selected.surface_id);
  assertZeroAuthority(workspaces.devos);
  assertZeroAuthority(workspaces.devos_shell);
});

test('shell ViewModel consumes stable NOT_EXPOSED layout DTO without inventing runtime state', () => {
  const workspaces = projectWorkspaceWorkbench(input());
  const layout = workspaces.devos_shell.layout_preferences;
  assert.ok(layout);
  assert.equal(layout.source_state, 'NOT_EXPOSED');
  assert.equal(layout.requested_sidebar, 'EXPANDED');
  assert.equal(layout.requested_inspector, 'CLOSED');
  assert.equal(layout.stored_surface_is_selection_authority, false);
  assertZeroAuthority(layout);
});

test('available registry enriches only client layout preferences and leaves canonical selection unchanged', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  layouts.setRequested('session:browser-unbound', { sidebar: 'COMPACT', inspector: 'OPEN' });
  layouts.setActiveSurface('session:browser-unbound', 'browser:historical-focus');
  const workspaces = projectWorkspaceWorkbench(input(layouts.snapshot()));

  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.selected_surface.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos_shell.layout_preferences.source_state, 'AVAILABLE');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_sidebar, 'COMPACT');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_inspector, 'OPEN');
  assert.equal(workspaces.devos_shell.layout_preferences.stored_surface_id, 'browser:historical-focus');
  assert.equal(workspaces.devos_shell.layout_preferences.stored_surface_is_selection_authority, false);
});

test('invalid layout registry degrades preferences but cannot invalidate or rewrite canonical DevOS selection', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  const corrupt = structuredClone(layouts.snapshot());
  corrupt.scheduler_authority = true;
  const workspaces = projectWorkspaceWorkbench(input(corrupt));

  assert.equal(workspaces.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(workspaces.devos.layout_preferences.source_state, 'INVALID_REGISTRY');
  assert.equal(workspaces.devos_shell.valid, true);
  assert.equal(workspaces.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos_shell.layout_preferences.source_state, 'INVALID_REGISTRY');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_sidebar, 'EXPANDED');
  assert.equal(workspaces.devos_shell.layout_preferences.requested_inspector, 'CLOSED');
  assertZeroAuthority(workspaces.devos_shell);
});
