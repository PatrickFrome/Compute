import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevOSPresentationFocusState } from '../src/metaengine-devos-presentation-focus.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

function zeroAuthority(value) {
  assert.equal(value.projection_is_authority, false);
  assert.equal(value.scheduler_authority, false);
  assert.equal(value.execution_authority, false);
  assert.equal(value.command_leasing, false);
  assert.equal(value.automatic_effect_retry_allowed, false);
  assert.equal(value.page_model_authority, false);
  assert.equal(value.authority_effect, false);
}

function runtime() {
  const focus = createDevOSPresentationFocusState();
  focus.selectSession('session:browser-unbound');
  return {
    tabs: { selected_tab_id: 'tab.1', tabs: [{ tab_id: 'tab.1', title: 'Browser one', url: 'https://example.com', kind: 'WEB' }] },
    fleet: { counts: { PROVISIONING_AMBIGUOUS: 2, LOST: 1, BOUND_UNVERIFIED: 3 }, agents: [], authority_effect: false },
    supervisor: {
      last_error: 'supervisor failed',
      supervisor_mesh: { last_error: 'mesh failed' },
      self_update: { state: 'ERROR', last_error: 'release hold', authority_effect: false },
      authority_effect: false,
    },
    owner_safety_gates: { wildcard_disabled: true, authority_effect: false },
    development_plane: { state: 'CRASHED', authority_effect: false },
    compute: { available: false, authority_effect: false },
    presentation_focus: focus.snapshot(),
  };
}

test('workspace projection feeds trusted system state into canonical DevOS and shell Now', () => {
  const out = projectWorkspaceWorkbench(runtime());
  const kinds = out.devos.attention.map((row) => row.kind);
  for (const expected of ['SAFETY_OVERRIDE','SUPERVISOR_ERROR','SUPERVISOR_MESH_ERROR','FLEET_AMBIGUITY','FLEET_LOST','SELF_UPDATE_HOLD','COMPUTE_OFFLINE','FLEET_TRANSPORT_UNVERIFIED','DEVELOPMENT_PLANE_DEGRADED']) {
    assert.ok(kinds.includes(expected), `missing ${expected}`);
  }
  assert.equal(out.devos.system_attention.renderer_reconstruction_required, false);
  assert.deepEqual(out.devos_shell.now.map((row) => row.kind), out.devos.attention.slice(0, 256).map((row) => row.kind));
  assert.equal(out.devos_shell.selected_session.session_id, 'session:browser-unbound');
  assert.equal(out.devos_shell.selected_surface, null);
  for (const row of out.devos.attention) zeroAuthority(row);
  for (const row of out.devos_shell.now) zeroAuthority(row);
  zeroAuthority(out.devos.system_attention);
  zeroAuthority(out.devos);
  zeroAuthority(out.devos_shell);
});

test('Browser selection remains canonical read-model state and cannot create presentation focus', () => {
  const source = runtime();
  delete source.presentation_focus;
  const out = projectWorkspaceWorkbench(source);
  assert.equal(out.devos.selected.surface_id, 'browser:tab.1');
  assert.equal(out.devos_shell.selected_session, null);
  assert.equal(out.devos_shell.selected_surface, null);
  assert.ok(out.devos_shell.now.length > 0);
});
