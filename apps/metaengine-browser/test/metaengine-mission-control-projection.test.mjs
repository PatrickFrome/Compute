import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMissionControl, MISSION_CONTROL_SCHEMA } from '../src/metaengine-mission-control-projection.mjs';

function sampleWorkspaces() {
  return {
    devos: {
      objectives: [
        { objective_id: 'objective:ctx-1', context_id: 'ctx-1', title: 'Ship the closed loop', status: 'ACTIVE', session_ids: ['session-1'], attention_count: 1 },
        { objective_id: 'objective:ctx-2', context_id: 'ctx-2', title: 'Harden the shell', status: 'ACTIVE', session_ids: ['session-2'], attention_count: 0 },
      ],
      sessions: [
        {
          session_id: 'session-1',
          objective_id: 'objective:ctx-1',
          tasks: [
            { task_id: 'task-1', objective: 'Bind attribution', status: 'COMPLETED', owner_agent_id: 'agent-a', updated_at: '2026-09-20T16:00:00Z' },
            { task_id: 'task-2', objective: 'Credit ingest', status: 'BLOCKED', owner_agent_id: 'agent-b', blocker: 'receipt pending', updated_at: '2026-09-20T16:05:00Z' },
          ],
        },
        {
          session_id: 'session-2',
          objective_id: 'objective:ctx-2',
          tasks: [
            { task_id: 'task-3', objective: 'Keyed rail', status: 'RUNNING', owner_agent_id: 'agent-c', updated_at: '2026-09-20T16:10:00Z' },
          ],
        },
      ],
      artifacts: [
        { artifact_id: 'art-1', objective_id: 'objective:ctx-1', session_id: 'session-1', ref: 'devos_task:task-1', kind: 'task-result-COMPLETED' },
      ],
      attention: [
        { kind: 'TASK_BLOCKED', severity: 'WARNING', priority: 'HIGH', objective_id: 'objective:ctx-1', task_id: 'task-2', title: 'Credit ingest', reason: 'receipt pending' },
      ],
    },
  };
}

test('projects the full mission control view model from live-shaped inputs', () => {
  const projection = projectMissionControl({
    workspaces: sampleWorkspaces(),
    fleet: { agents: [
      { agent_id: 'agent-a', role: 'worker', lifecycle_state: 'ACTIVE', tab_id: 'tab-1', target_id: 't-1', generation_epoch: 4 },
      { agent_id: 'agent-b', role: 'worker', lifecycle_state: 'RETIRED', tab_id: null, target_id: null, generation_epoch: 3 },
    ] },
    supervisor: { mesh_epoch: 12, cognitive_stream: { stream_id: 'abc', acknowledged_through_sequence: 99 } },
    system_delta_tail: [
      { system_kind: 'SUPERVISOR_COMMAND', subject_id: 'cmd-1', detail: 'CAPTURE/OK/9ms', observed_at: '2026-09-20T16:12:00Z' },
      { system_kind: 'ARTIFACT_RECORDED', subject_id: 'art-1', detail: 'task-result-COMPLETED', observed_at: '2026-09-20T16:13:00Z' },
    ],
    compute: { state: 'HEALTHY' },
  });
  assert.equal(projection.schema, MISSION_CONTROL_SCHEMA);
  assert.equal(projection.state, 'OK');
  assert.equal(projection.counts.objectives, 2);
  assert.equal(projection.counts.tasks, 3);
  assert.equal(projection.counts.agents, 2);
  assert.equal(projection.counts.effects, 2);
  assert.equal(projection.counts.artifacts, 1);
  assert.equal(projection.counts.attention, 1);
  assert.deepEqual(projection.epochs.fleet_generation_epochs, [3, 4]);
  assert.equal(projection.epochs.mesh_epoch, 12);
  assert.equal(projection.epochs.cognitive_stream.acknowledged_through_sequence, 99);
  assert.equal(projection.epochs.compute_state, 'HEALTHY');
  const blocked = projection.tasks.find((task) => task.task_id === 'task-2');
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.blocker, 'receipt pending');
  assert.equal(blocked.session_id, 'session-1');
  for (const row of [...projection.objectives, ...projection.tasks, ...projection.agents, ...projection.effects, ...projection.artifacts, ...projection.attention]) {
    assert.equal(row.authority_effect, false);
    assert.equal(row.page_data_authority, false);
  }
});

test('fails closed to UNAVAILABLE when the devos projection is missing', () => {
  const projection = projectMissionControl({ workspaces: null, fleet: null, supervisor: null });
  assert.equal(projection.state, 'UNAVAILABLE');
  assert.equal(projection.reason, 'DEVOS_PROJECTION_NOT_READY');
  assert.equal(projection.counts.objectives, 0);
  assert.deepEqual(projection.objectives, []);
  assert.deepEqual(projection.effects, []);
  assert.equal(projection.authority_effect, false);
});

test('bounds hot rows: 200 tasks -> 128, 100 agents -> 64, 100 effects -> 32', () => {
  const tasksA = Array.from({ length: 100 }, (_, index) => ({ task_id: `task-a-${index}`, objective: 'o', status: 'RUNNING' }));
  const tasksB = Array.from({ length: 100 }, (_, index) => ({ task_id: `task-b-${index}`, objective: 'o', status: 'RUNNING' }));
  const agents = Array.from({ length: 100 }, (_, index) => ({ agent_id: `agent-${index}`, role: 'worker', lifecycle_state: 'ACTIVE' }));
  const effects = Array.from({ length: 100 }, (_, index) => ({ system_kind: 'SUPERVISOR_COMMAND', subject_id: `cmd-${index}` }));
  const projection = projectMissionControl({
    workspaces: { devos: { objectives: [{ objective_id: 'objective:1', title: 'one', status: 'ACTIVE', session_ids: ['s'] }], sessions: [{ session_id: 's1', objective_id: 'objective:1', tasks: tasksA }, { session_id: 's2', objective_id: 'objective:1', tasks: tasksB }], artifacts: [], attention: [] } },
    fleet: { agents },
    system_delta_tail: effects,
  });
  assert.equal(projection.counts.tasks, 128);
  assert.equal(projection.counts.agents, 64);
  assert.equal(projection.counts.effects, 32);
  assert.equal(projection.epochs.mesh_epoch, null);
  assert.equal(projection.epochs.cognitive_stream, null);
});

test('malformed rows are dropped, never thrown', () => {
  const projection = projectMissionControl({
    workspaces: { devos: {
      objectives: [{ objective_id: '', title: 'dropped' }, { objective_id: 'objective:ok', title: 'kept' }],
      sessions: [{ session_id: 's', objective_id: 'objective:ok', tasks: [{ task_id: 'task-ok', objective: 'ok', status: 'RUNNING' }] }],
      artifacts: [{ artifact_id: null, ref: 'ref-only' }],
      attention: [],
    } },
    fleet: { agents: [{ agent_id: 'agent-ok' }, { agent_id: '' }] },
  });
  assert.equal(projection.counts.objectives, 1);
  assert.equal(projection.counts.agents, 1);
  assert.equal(projection.counts.artifacts, 1);
});
