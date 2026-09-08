import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMetaengineDevOS } from '../src/metaengine-devos-projection.mjs';

function context(id, tasks) {
  return {
    context_id: id,
    progress: {
      ready: tasks.filter((row) => row.status === 'READY').length,
      active: tasks.filter((row) => row.status === 'ACTIVE').length,
      blocked: tasks.filter((row) => row.status === 'BLOCKED').length,
      completed: tasks.filter((row) => row.status === 'COMPLETED').length,
      failed: tasks.filter((row) => row.status === 'FAILED').length,
      active_agents: [],
    },
    artifact_refs: [],
    tasks: tasks.map((row, index) => ({
      task_id: `${id}.task.${index + 1}`,
      objective: row.objective,
      status: row.status,
      blocker: row.blocker || null,
      progress_revision: 1,
    })),
  };
}

function snapshot() {
  return {
    tabs: {
      selected_tab_id: 'tab.loose',
      tabs: [{ tab_id: 'tab.loose', title: 'Loose docs', url: 'https://example.com', kind: 'WEB' }],
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
                context('ctx.attn', [
                  { objective: 'Keep implementing', status: 'ACTIVE' },
                  { objective: 'Fix physical failure', status: 'BLOCKED', blocker: 'Windows proof missing' },
                ]),
                context('ctx.active', [{ objective: 'Implement clean path', status: 'ACTIVE' }]),
                context('ctx.background', [{ objective: 'Queued verification', status: 'READY' }]),
                context('ctx.done', [{ objective: 'Finished research', status: 'COMPLETED' }]),
              ],
            },
            episodic_memory: {
              schema: 'metaengine.browser-brain.episodic-memory.v1',
              bounded_memory: true,
              scheduler_authority: false,
              execution_authority: false,
              authority_effect: false,
              episode_count: 7,
              semantic_fact_count: 11,
              procedural_playbook_count: 3,
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
      issues: [],
    },
  };
}

function group(view, id) {
  return view.navigation.session_groups.find((row) => row.group_id === id);
}
function root(view, id) {
  return view.navigation.roots.find((row) => row.root_id === id);
}

test('DevOS navigation prioritizes attention before normal active/background/completed work', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.deepEqual(group(view, 'NEEDS_ATTENTION').session_ids, ['session:ctx.attn']);
  assert.deepEqual(group(view, 'ACTIVE').session_ids, ['session:ctx.active']);
  assert.deepEqual(group(view, 'BACKGROUND').session_ids, ['session:ctx.background']);
  assert.deepEqual(group(view, 'COMPLETED').session_ids, ['session:ctx.done']);
  assert.deepEqual(group(view, 'UNBOUND').session_ids, ['session:browser-unbound']);
  const all = view.navigation.session_groups.flatMap((row) => row.session_ids);
  assert.equal(new Set(all).size, all.length, 'a session must appear in only one navigation group');
});

test('unbound Browser is visible but excluded from normal work-session count', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.equal(view.sessions.length, 5);
  assert.equal(root(view, 'SESSIONS').count, 4);
  assert.equal(view.navigation.unbound_is_work_session, false);
  assert.equal(view.sessions.find((row) => row.session_id === 'session:browser-unbound').browser_only, true);
});

test('Now behaves as attention inbox while Automations stays unavailable until a real source exists', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.equal(root(view, 'NOW').count, 1);
  assert.equal(root(view, 'NOW').state, 'ATTENTION');
  assert.equal(view.navigation.attention_outside_normal_workflow, true);
  assert.equal(root(view, 'AUTOMATIONS').source_state, 'NOT_EXPOSED');
  assert.equal(root(view, 'AUTOMATIONS').count, 0);
  assert.equal(view.navigation.automations_source_state, 'NOT_EXPOSED');
});

test('Memory root exposes only validated bounded episodic summary', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.equal(root(view, 'MEMORY').source_state, 'AVAILABLE');
  assert.equal(root(view, 'MEMORY').count, 7);
  assert.equal(view.navigation.memory.semantic_fact_count, 11);
  assert.equal(view.navigation.memory.procedural_playbook_count, 3);

  const invalid = snapshot();
  invalid.supervisor.realtime_process_plane.browser_brain.collaboration_fabric.episodic_memory.execution_authority = true;
  const invalidView = projectMetaengineDevOS(invalid);
  assert.equal(root(invalidView, 'MEMORY').source_state, 'NOT_EXPOSED');
  assert.equal(root(invalidView, 'MEMORY').count, 0);
});

test('navigation projection is recursively zero-authority and cannot become a workflow engine', () => {
  const view = projectMetaengineDevOS(snapshot());
  assert.equal(view.navigation.grouping_is_execution_authority, false);
  assert.equal(view.navigation.scheduler_authority, false);
  assert.equal(view.navigation.execution_authority, false);
  assert.equal(view.navigation.command_leasing, false);
  assert.equal(view.navigation.authority_effect, false);
  for (const row of [...view.navigation.roots, ...view.navigation.session_groups]) {
    assert.equal(row.scheduler_authority, false);
    assert.equal(row.execution_authority, false);
    assert.equal(row.authority_effect, false);
  }
});
