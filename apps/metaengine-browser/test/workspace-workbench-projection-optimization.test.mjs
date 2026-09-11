import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

const makeSnapshot = () => ({
  tabs: {
    tabs: [
      { tab_id: 'tab_44444444-4444-4444-8444-444444444444', title: 'Workspace', url: 'https://chatgpt.com/c/abc', kind: 'CHATGPT', untrusted_nested: { page_text: 'do not expose' } },
      { tab_id: 'tab_session', title: 'Session', url: 'https://example.com/', kind: 'WEB', untrusted_nested: { page_text: 'do not expose' } },
    ],
  },
  fleet: {
    agents: [{
      agent_id: 'agent_12345678', role: 'IMPLEMENTER', tab_id: 'tab_44444444-4444-4444-8444-444444444444',
      target_id: 'webcontents:9', generation_epoch: 3, lifecycle_state: 'ACTIVE', transport_proof: { secret: 'not needed by workbench projection' },
    }],
  },
  supervisor: {
    workspace_bindings: {
      state: 'AVAILABLE', source_implemented: true, runtime_deployed: true, bindings: [{
        workspace_id: '11111111-1111-4111-8111-111111111111', workspace_generation: 2,
        coordination_workspace_id: '33333333-3333-4333-8333-333333333333', task_id: '22222222-2222-4222-8222-222222222222',
        point_id: 'c5', repo_id: 'PatrickFrome/Compute', base_sha: 'a'.repeat(40), branch_name: 'work/example',
        agent_id: 'agent_12345678', tab_id: 'tab_44444444-4444-4444-8444-444444444444', target_id: 'webcontents:9',
        agent_generation_epoch: 3, lease_generation: 4, lease_expires_at: '2026-09-02T12:00:00.000Z',
        lease_current: true, state: 'READY', ambiguity_code: null, dirty_hold: false,
      }],
    },
  },
});

test('hot-path projection exposes only renderer-required bounded tab and agent fields', () => {
  const input = makeSnapshot();
  const out = projectWorkspaceWorkbench(input);
  assert.deepEqual(Object.keys(out.groups[0].tab).sort(), ['kind','tab_id','title','url']);
  assert.deepEqual(Object.keys(out.groups[0].agent).sort(), ['agent_id','generation_epoch','lifecycle_state','role','tab_id','target_id']);
  assert.equal('untrusted_nested' in out.groups[0].tab, false);
  assert.equal('transport_proof' in out.groups[0].agent, false);
  assert.equal('untrusted_nested' in out.sessions[0], false);
});

test('projection output is detached from later source mutation without deep cloning unused nested payloads', () => {
  const input = makeSnapshot();
  const out = projectWorkspaceWorkbench(input);
  input.tabs.tabs[0].title = 'changed after projection';
  input.fleet.agents[0].lifecycle_state = 'LOST';
  assert.equal(out.groups[0].tab.title, 'Workspace');
  assert.equal(out.groups[0].agent.lifecycle_state, 'ACTIVE');
});

test('workspace state counters are accumulated in the admission pass', () => {
  const input = makeSnapshot();
  const base = input.supervisor.workspace_bindings.bindings[0];
  const tab2 = { ...input.tabs.tabs[0], tab_id: 'tab_55555555-5555-4555-8555-555555555555', title: 'Frozen' };
  const agent2 = { ...input.fleet.agents[0], agent_id: 'agent_87654321', tab_id: tab2.tab_id, target_id: 'webcontents:10', generation_epoch: 4 };
  input.tabs.tabs.push(tab2);
  input.fleet.agents.push(agent2);
  input.supervisor.workspace_bindings.bindings.push({
    ...base,
    workspace_id: '55555555-5555-4555-8555-555555555555', workspace_generation: 1,
    agent_id: agent2.agent_id, tab_id: tab2.tab_id, target_id: agent2.target_id,
    agent_generation_epoch: 4, lease_generation: 1, state: 'FROZEN', ambiguity_code: 'EFFECT_UNKNOWN',
  });
  const out = projectWorkspaceWorkbench(input);
  assert.deepEqual(out.counts, { workspaces: 2, sessions: 1, issues: 0, ready: 1, frozen: 1, reserved: 0 });
});
