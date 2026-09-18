import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMetaengineDevOS } from '../src/metaengine-devos-projection.mjs';

function workbenchContext(contextId, taskId, objective) {
  return {
    context_id: contextId,
    progress: { ready: 0, active: 1, blocked: 0, completed: 0, failed: 0, active_agents: [`agent.${contextId}`] },
    artifact_refs: [],
    tasks: [{ task_id: taskId, objective, status: 'ACTIVE', owner_agent_id: `agent.${contextId}`, progress_revision: 1 }],
  };
}

function snapshot({ ambiguous = false } = {}) {
  const groups = [
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      workspace_generation: 1,
      task_id: 'task.1',
      branch_name: 'work/one',
      base_sha: 'a'.repeat(40),
      tab_id: 'tab.1',
      current_binding: true,
      authority_effect: false,
    },
    {
      workspace_id: '22222222-2222-4222-8222-222222222222',
      workspace_generation: 1,
      task_id: 'task.2',
      branch_name: 'work/two',
      base_sha: 'b'.repeat(40),
      tab_id: 'tab.2',
      current_binding: true,
      authority_effect: false,
    },
  ];
  if (ambiguous) groups.push({ ...groups[1], workspace_id: '33333333-3333-4333-8333-333333333333', task_id: 'task.1', tab_id: 'tab.2' });
  return {
    tabs: {
      selected_tab_id: 'tab.2',
      tabs: [
        { tab_id: 'tab.1', title: 'One', url: 'https://one.example', kind: 'WEB' },
        { tab_id: 'tab.2', title: 'Two', url: 'https://two.example', kind: 'WEB' },
        { tab_id: 'tab.3', title: 'Loose', url: 'https://loose.example', kind: 'WEB' },
      ],
    },
    supervisor: {
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
              contexts: [
                workbenchContext('ctx.1', 'task.1', 'Implement one'),
                workbenchContext('ctx.2', 'task.2', 'Implement two'),
              ],
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
      groups,
      issues: [{ reason: 'LEASE_STALE', workspace_id: groups[0].workspace_id, task_id: 'task.1', tab_id: 'tab.1', authority_effect: false }],
    },
  };
}

test('Browser surfaces belong to sessions only through exact durable task/workspace bindings', () => {
  const view = projectMetaengineDevOS(snapshot());
  const one = view.surfaces.find((surface) => surface.tab_id === 'tab.1');
  const two = view.surfaces.find((surface) => surface.tab_id === 'tab.2');
  const loose = view.surfaces.find((surface) => surface.tab_id === 'tab.3');
  assert.equal(one.session_id, 'session:ctx.1');
  assert.equal(two.session_id, 'session:ctx.2');
  assert.equal(one.ownership, 'EXACT_SESSION_BINDING');
  assert.equal(two.ownership, 'EXACT_SESSION_BINDING');
  assert.equal(loose.session_id, 'session:browser-unbound');
  assert.equal(loose.ownership, 'UNBOUND_BROWSER_SURFACE');
  assert.equal(view.no_url_heuristic_grouping, true);
  assert.equal(view.no_title_heuristic_grouping, true);
});

test('selected Browser surface selects its owning session instead of the first collaboration context', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.equal(view.selected.surface_id, 'browser:tab.2');
  assert.equal(view.selected.session_id, 'session:ctx.2');
  assert.equal(view.active_session.session_id, 'session:ctx.2');
  assert.equal(view.active_session.title, 'Implement two');
  assert.equal(view.active_session.surface_count, 1);
  assert.equal(view.active_session.projection_is_authority, false);
});

test('unbound Browser surfaces remain visible in an explicit browser-only session', () => {
  const view = projectMetaengineDevOS(snapshot());
  const looseSession = view.sessions.find((session) => session.session_id === 'session:browser-unbound');
  assert.ok(looseSession);
  assert.equal(looseSession.browser_only, true);
  assert.deepEqual(looseSession.surface_ids, ['browser:tab.3']);
  assert.equal(looseSession.task_count, 0);
  assert.equal(looseSession.execution_authority, false);
});

test('ambiguous durable ownership fails closed to the unbound Browser session', () => {
  const view = projectMetaengineDevOS(snapshot({ ambiguous: true }));
  const two = view.surfaces.find((surface) => surface.tab_id === 'tab.2');
  assert.equal(two.session_id, 'session:browser-unbound');
  assert.equal(two.ownership, 'UNBOUND_BROWSER_SURFACE');
  assert.equal(view.selected.session_id, 'session:browser-unbound');
});

test('workspace projection issues enter the bounded attention read model without gaining authority', () => {
  const view = projectMetaengineDevOS(snapshot());
  const issue = view.attention.find((row) => row.kind === 'WORKSPACE_BINDING_ISSUE');
  assert.ok(issue);
  assert.equal(issue.reason, 'LEASE_STALE');
  assert.equal(issue.authority_effect, false);
  assert.equal(issue.scheduler_authority, false);
  assert.equal(issue.execution_authority, false);
});
