import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';
import { projectDevOSShellViewModel } from '../src/metaengine-devos-shell-view-model.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

function source(sessionLayouts = undefined) {
  return {
    tabs: {
      selected_tab_id: 'tab.loose',
      tabs: [{ tab_id: 'tab.loose', title: 'Loose Browser', url: 'https://example.com', kind: 'WEB' }],
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

test('real workspace projection becomes a session-first renderer DTO without Browser shell fallback', () => {
  const devos = projectWorkspaceWorkbench(source()).devos;
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, true);
  assert.equal(view.primary_object, 'SESSION');
  assert.equal(view.browser_is_shell, false);
  assert.equal(view.browser_is_surface, true);
  assert.equal(view.selected_session.session_id, 'session:browser-unbound');
  assert.equal(view.selected_surface.surface_id, 'browser:tab.loose');
  assert.equal(view.selected_surface.type, 'BROWSER');
  assert.equal(view.default_root, 'NOW');
  assert.deepEqual(view.roots.map((row) => row.root_id), ['NOW', 'WORKSPACES', 'SESSIONS', 'AUTOMATIONS', 'MEMORY', 'SYSTEM']);
  const unbound = view.session_groups.find((group) => group.group_id === 'UNBOUND');
  assert.ok(unbound);
  assert.equal(unbound.count, 1);
  assert.equal(unbound.sessions[0].browser_only, true);
  assert.equal(unbound.sessions[0].selected, true);
  assert.equal(view.renderer_selection_authority, false);
  assert.equal(view.renderer_routing_authority, false);
  assertZeroAuthority(view);
});

test('renderer DTO carries per-session requested layout but never treats stored focus as selection authority', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  layouts.setRequested('session:browser-unbound', { sidebar: 'COMPACT', inspector: 'OPEN' });
  layouts.setActiveSurface('session:browser-unbound', 'browser:old-focus');
  const devos = projectWorkspaceWorkbench(source(layouts.snapshot())).devos;
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, true);
  assert.equal(view.layout_preferences.requested_sidebar, 'COMPACT');
  assert.equal(view.layout_preferences.requested_inspector, 'OPEN');
  assert.equal(view.layout_preferences.stored_surface_id, 'browser:old-focus');
  assert.equal(view.layout_preferences.stored_surface_is_focus_preference, true);
  assert.equal(view.layout_preferences.stored_surface_is_selection_authority, false);
  assert.equal(view.selected_surface.surface_id, 'browser:tab.loose');
  assertZeroAuthority(view.layout_preferences);
});

test('selection ownership mismatch fails closed instead of switching session or surface', () => {
  const devos = structuredClone(projectWorkspaceWorkbench(source()).devos);
  devos.sessions.push({
    session_id: 'session:other', title: 'Other', status: 'ACTIVE', browser_only: false, task_count: 0, surface_ids: [],
    projection_is_authority: false, scheduler_authority: false, execution_authority: false, command_leasing: false,
    automatic_effect_retry_allowed: false, page_model_authority: false, authority_effect: false,
  });
  devos.navigation.session_groups.find((group) => group.group_id === 'ACTIVE').session_ids.push('session:other');
  devos.navigation.session_groups.find((group) => group.group_id === 'ACTIVE').count += 1;
  devos.selected.session_id = 'session:other';
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, false);
  assert.equal(view.reason, 'SELECTION_OWNERSHIP_MISMATCH');
  assert.equal(view.selected_session, null);
  assert.equal(view.selected_surface, null);
  assertZeroAuthority(view);
});

test('unknown or duplicate navigation membership invalidates the renderer DTO', () => {
  const clean = projectWorkspaceWorkbench(source()).devos;

  const unknown = structuredClone(clean);
  unknown.navigation.session_groups.find((group) => group.group_id === 'ACTIVE').session_ids.push('session:missing');
  unknown.navigation.session_groups.find((group) => group.group_id === 'ACTIVE').count += 1;
  assert.equal(projectDevOSShellViewModel(unknown).reason, 'SESSION_GROUP_MEMBERSHIP_INVALID');

  const duplicate = structuredClone(clean);
  const unbound = duplicate.navigation.session_groups.find((group) => group.group_id === 'UNBOUND');
  const active = duplicate.navigation.session_groups.find((group) => group.group_id === 'ACTIVE');
  active.session_ids.push(unbound.session_ids[0]);
  active.count += 1;
  assert.equal(projectDevOSShellViewModel(duplicate).reason, 'SESSION_GROUP_MEMBERSHIP_INVALID');
});

test('navigation must cover every canonical session exactly once', () => {
  const devos = structuredClone(projectWorkspaceWorkbench(source()).devos);
  const unbound = devos.navigation.session_groups.find((group) => group.group_id === 'UNBOUND');
  unbound.session_ids = [];
  unbound.count = 0;
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, false);
  assert.equal(view.reason, 'SESSION_GROUP_COVERAGE_INVALID');
});

test('authority-bearing attention rows invalidate Now instead of being rendered as trusted attention', () => {
  const devos = structuredClone(projectWorkspaceWorkbench(source()).devos);
  devos.attention.push({
    kind: 'TASK_BLOCKED', severity: 'WARNING', priority: 'HIGH', session_id: 'session:browser-unbound',
    title: 'Injected attention', reason: 'bad', projection_is_authority: false, scheduler_authority: true,
    execution_authority: false, command_leasing: false, automatic_effect_retry_allowed: false,
    page_model_authority: false, authority_effect: false,
  });
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, false);
  assert.equal(view.reason, 'ATTENTION_ROW_INVALID');
  assert.deepEqual(view.now, []);
  assertZeroAuthority(view);
});

test('invalid DevOS projection produces a sanitized empty view model', () => {
  const devos = structuredClone(projectWorkspaceWorkbench(source()).devos);
  devos.execution_authority = true;
  const view = projectDevOSShellViewModel(devos);
  assert.equal(view.valid, false);
  assert.equal(view.reason, 'DEVOS_PROJECTION_INVALID');
  assert.deepEqual(view.roots, []);
  assert.deepEqual(view.session_groups, []);
  assert.equal(view.selected_session, null);
  assert.equal(view.selected_surface, null);
  assert.equal(view.browser_is_shell, false);
  assertZeroAuthority(view);
});
