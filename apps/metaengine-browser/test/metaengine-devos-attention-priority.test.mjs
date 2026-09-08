import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMetaengineDevOS } from '../src/metaengine-devos-projection.mjs';

function baseSnapshot(contexts) {
  return {
    tabs: { selected_tab_id: null, tabs: [] },
    owner_safety_gates: { wildcard_disabled: true },
    supervisor: {
      last_error: 'supervisor unavailable',
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
              contexts,
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
      issues: [{ reason: 'LEASE_STALE', task_id: 'task.z', workspace_id: 'workspace.z', tab_id: 'tab.z', authority_effect: false }],
    },
  };
}

function context(id, tasks) {
  return {
    context_id: id,
    progress: { ready: 0, active: 0, blocked: 1, completed: 0, failed: 1, active_agents: [] },
    artifact_refs: [],
    tasks,
  };
}

const rows = [
  context('ctx.z', [
    { task_id: 'task.z.blocked', objective: 'Blocked Z', status: 'BLOCKED', blocker: 'blocked z', progress_revision: 1 },
    { task_id: 'task.z.failed', objective: 'Failed Z', status: 'FAILED', blocker: 'failed z', progress_revision: 1 },
  ]),
  context('ctx.a', [
    { task_id: 'task.a.blocked', objective: 'Blocked A', status: 'BLOCKED', blocker: 'blocked a', progress_revision: 1 },
    { task_id: 'task.a.failed', objective: 'Failed A', status: 'FAILED', blocker: 'failed a', progress_revision: 1 },
  ]),
];

test('Now priority is stable: system critical before task failures, blockers, then binding warnings', () => {
  const view = projectMetaengineDevOS(baseSnapshot(rows));
  assert.deepEqual(view.attention.map((row) => row.kind), [
    'SAFETY_OVERRIDE',
    'SUPERVISOR_ERROR',
    'TASK_FAILED',
    'TASK_FAILED',
    'TASK_BLOCKED',
    'TASK_BLOCKED',
    'WORKSPACE_BINDING_ISSUE',
  ]);
  assert.deepEqual(view.attention.map((row) => row.priority), [
    'CRITICAL', 'CRITICAL', 'HIGH', 'HIGH', 'HIGH', 'HIGH', 'MEDIUM',
  ]);
  assert.deepEqual(
    view.attention.filter((row) => row.kind === 'TASK_FAILED').map((row) => row.session_id),
    ['session:ctx.a', 'session:ctx.z'],
  );
});

test('attention order does not depend on collaboration-context input order', () => {
  const forward = projectMetaengineDevOS(baseSnapshot(rows)).attention.map((row) => [row.kind, row.session_id, row.task_id, row.reason]);
  const reverse = projectMetaengineDevOS(baseSnapshot([...rows].reverse())).attention.map((row) => [row.kind, row.session_id, row.task_id, row.reason]);
  assert.deepEqual(reverse, forward);
});

test('priority inbox remains a read model and never gains workflow or execution authority', () => {
  const view = projectMetaengineDevOS(baseSnapshot(rows));
  assert.equal(view.navigation.attention_outside_normal_workflow, true);
  for (const row of view.attention) {
    assert.equal(row.projection_is_authority, false);
    assert.equal(row.scheduler_authority, false);
    assert.equal(row.execution_authority, false);
    assert.equal(row.command_leasing, false);
    assert.equal(row.automatic_effect_retry_allowed, false);
    assert.equal(row.authority_effect, false);
  }
});
