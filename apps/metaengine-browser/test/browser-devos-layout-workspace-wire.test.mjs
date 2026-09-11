import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

function shellProjectionInput(sessionLayouts = undefined) {
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

test('workspace projection exposes stable DevOS layout schema before durable session preferences are wired', () => {
  const view = projectWorkspaceWorkbench(shellProjectionInput());
  assert.equal(view.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(view.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(view.devos.selected.surface_id, 'browser:tab.loose');
  assert.equal(view.devos.layout_preferences.schema, 'metaengine.devos.session-layout-projection.v1');
  assert.equal(view.devos.layout_preferences.source_state, 'NOT_EXPOSED');
  assert.equal(view.devos.layout_preferences.active.session_id, 'session:browser-unbound');
  assert.equal(view.devos.layout_preferences.active.requested_sidebar, 'EXPANDED');
  assert.equal(view.devos.layout_preferences.active.requested_inspector, 'CLOSED');
  assert.equal(view.devos.layout_preferences.execution_authority, false);
  assert.equal(view.devos.layout_preferences.authority_effect, false);
});

test('workspace projection consumes an explicitly supplied bounded session-layout registry without changing selection', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  layouts.setRequested('session:browser-unbound', { sidebar: 'COMPACT', inspector: 'OPEN' });
  layouts.setActiveSurface('session:browser-unbound', 'browser:old-focus');

  const view = projectWorkspaceWorkbench(shellProjectionInput(layouts.snapshot()));
  const prefs = view.devos.layout_preferences;
  assert.equal(prefs.source_state, 'AVAILABLE');
  assert.equal(prefs.selection_alignment, 'ALIGNED');
  assert.equal(prefs.active.requested_sidebar, 'COMPACT');
  assert.equal(prefs.active.requested_inspector, 'OPEN');
  assert.equal(prefs.active.stored_surface_id, 'browser:old-focus');
  assert.equal(prefs.active.selected_surface_id, 'browser:tab.loose');
  assert.equal(prefs.active.stored_surface_is_selection_authority, false);
  assert.equal(view.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(view.devos.selected.surface_id, 'browser:tab.loose');
});

test('invalid session-layout registry fails closed while canonical DevOS selection remains usable', () => {
  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:browser-unbound');
  const corrupt = structuredClone(layouts.snapshot());
  corrupt.scheduler_authority = true;

  const view = projectWorkspaceWorkbench(shellProjectionInput(corrupt));
  assert.equal(view.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(view.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(view.devos.layout_preferences.source_state, 'INVALID_REGISTRY');
  assert.equal(view.devos.layout_preferences.entries.length, 0);
  assert.equal(view.devos.layout_preferences.scheduler_authority, false);
  assert.equal(view.devos.layout_preferences.authority_effect, false);
});
