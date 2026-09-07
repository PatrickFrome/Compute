import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_PROJECTION_SCHEMA,
  METAENGINE_DEVOS_SURFACE_REGISTRY_SCHEMA,
  createMetaengineDevOSSurfaceRegistry,
  projectMetaengineDevOS,
} from '../src/metaengine-devos-projection.mjs';

function snapshot() {
  return {
    tabs: {
      selected_tab_id: 'tab.web',
      tabs: [
        { tab_id: 'tab.web', title: 'Docs', url: 'https://example.com', kind: 'WEB' },
        { tab_id: 'tab.agent', title: 'Verifier', url: 'https://chatgpt.com/c/v', kind: 'CHATGPT' },
      ],
    },
    owner_safety_gates: { wildcard_disabled: false },
    supervisor: {
      last_error: null,
      devos_last_error: null,
      realtime_process_plane: {
        browser_brain: {
          collaboration_fabric: {
            workbench: {
              schema: 'metaengine.browser-brain.collaboration-workbench.v1',
              bounded: true,
              advisory_only: true,
              projection_is_authority: false,
              scheduler_authority: false,
              execution_authority: false,
              command_leasing: false,
              authority_effect: false,
              contexts: [{
                context_id: 'ctx.release',
                progress: { ready: 1, active: 1, blocked: 1, completed: 3, failed: 0, active_agents: ['agent.impl'] },
                artifact_refs: ['artifact:proof'],
                tasks: [
                  { task_id: 'task.active', objective: 'Ship DevOS shell', status: 'ACTIVE', owner_agent_id: 'agent.impl', progress_revision: 4, dependencies: [], required_capabilities: ['ui'] },
                  { task_id: 'task.blocked', objective: 'Physical proof', status: 'BLOCKED', owner_agent_id: 'agent.verify', progress_revision: 3, blocker: 'Windows evidence pending', dependencies: ['task.active'], required_capabilities: ['verification'] },
                ],
              }],
            },
          },
        },
      },
    },
    workspaces: {
      schema: 'metaengine.browser.workspace-workbench-projection.v1',
      grouping_authority: 'DURABLE_WORKSPACE_BINDING_ONLY',
      url_heuristic_grouping: false,
      title_heuristic_grouping: false,
      browser_actuation_authority: false,
      authority_effect: false,
      groups: [],
    },
  };
}

test('DevOS registry treats Browser as a surface and never as shell authority', () => {
  const registry = createMetaengineDevOSSurfaceRegistry();
  assert.equal(registry.schema, METAENGINE_DEVOS_SURFACE_REGISTRY_SCHEMA);
  assert.equal(registry.browser_is_shell, false);
  assert.equal(registry.browser_is_surface, true);
  assert.equal(registry.types.find((row) => row.type === 'BROWSER').runtime_bound, true);
  assert.equal(registry.types.find((row) => row.type === 'TERMINAL').runtime_bound, false);
  assert.equal(registry.scheduler_authority, false);
  assert.equal(registry.execution_authority, false);
});

test('DevOS projection exposes objective/workspace/session/task/surface/artifact hierarchy without creating authority', () => {
  const projection = projectMetaengineDevOS(snapshot());
  assert.equal(projection.schema, METAENGINE_DEVOS_PROJECTION_SCHEMA);
  assert.deepEqual(projection.hierarchy, ['OBJECTIVE', 'WORKSPACE', 'SESSION', 'TASK', 'SURFACE', 'ARTIFACT']);
  assert.equal(projection.primary_object, 'SESSION');
  assert.equal(projection.objectives.length, 1);
  assert.equal(projection.sessions.length, 1);
  assert.equal(projection.sessions[0].tasks[0].status, 'ACTIVE');
  assert.equal(projection.surfaces.length, 2);
  assert.equal(projection.surfaces[0].type, 'BROWSER');
  assert.equal(projection.selected.surface_id, 'browser:tab.web');
  assert.equal(projection.artifacts[0].artifact_id, 'artifact:proof');
  assert.equal(projection.attention[0].kind, 'TASK_BLOCKED');
  assert.equal(projection.browser_is_shell, false);
  assert.equal(projection.browser_is_surface, true);
  assert.equal(projection.scheduler_authority, false);
  assert.equal(projection.execution_authority, false);
  assert.equal(projection.authority_effect, false);
});

test('DevOS projection is bounded and does not infer workspace binding from URL or title', () => {
  const input = snapshot();
  input.workspaces.groups = [{ workspace_id: 'workspace.fake', title: 'example.com', url: 'https://example.com' }];
  const projection = projectMetaengineDevOS(input, { max_objectives: 1, max_tasks_per_session: 1, max_surfaces: 1 });
  assert.equal(projection.sessions[0].tasks.length, 1);
  assert.equal(projection.surfaces.length, 1);
  assert.equal(projection.workspaces[0].binding, 'COLLABORATION_CONTEXT_VIRTUAL');
  assert.equal(projection.no_url_heuristic_grouping, true);
  assert.equal(projection.no_title_heuristic_grouping, true);
});

test('invalid collaboration workbench fails closed instead of synthesizing DevOS objectives', () => {
  const input = snapshot();
  input.supervisor.realtime_process_plane.browser_brain.collaboration_fabric.workbench.execution_authority = true;
  const projection = projectMetaengineDevOS(input);
  assert.equal(projection.objectives.length, 0);
  assert.equal(projection.sessions.length, 0);
  assert.equal(projection.surfaces.length, 2);
  assert.equal(projection.authority_effect, false);
});
