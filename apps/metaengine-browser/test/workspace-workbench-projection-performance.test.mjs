import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

const source = await fs.readFile(new URL('../src/workspace-workbench-projection.mjs', import.meta.url), 'utf8');

function workspaceId(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function largeSnapshot(bound = 900, sessions = 300) {
  const tabs = [];
  const agents = [];
  const bindings = [];
  for (let i = 0; i < bound; i += 1) {
    const tabId = `tab_scale_${String(i).padStart(8, '0')}`;
    const agentId = `agent_scale-${String(i).padStart(8, '0')}`;
    const targetId = `webcontents:${i + 1}`;
    const state = ['READY', 'FROZEN', 'RESERVED'][i % 3];
    tabs.push({ tab_id: tabId, title: `tab ${i}`, url: `https://example.invalid/${i}`, kind: 'WEB' });
    agents.push({ agent_id: agentId, role: 'IMPLEMENTER', tab_id: tabId, target_id: targetId, generation_epoch: 4, lifecycle_state: 'ACTIVE' });
    bindings.push({
      workspace_id: workspaceId(i), workspace_generation: 2, coordination_workspace_id: workspaceId(bound + i),
      task_id: workspaceId((bound * 2) + i), point_id: `point-${i}`, repo_id: 'PatrickFrome/Compute',
      branch_name: `work/scale-${i}`, base_sha: 'a'.repeat(40), agent_id: agentId, tab_id: tabId,
      target_id: targetId, agent_generation_epoch: 4, lease_generation: 5, lease_current: true,
      state, ambiguity_code: state === 'FROZEN' ? 'SCALE_HOLD' : null, dirty_hold: false,
    });
  }
  for (let i = 0; i < sessions; i += 1) {
    tabs.push({ tab_id: `tab_session_${i}`, title: `session ${i}`, url: 'https://example.invalid/session', kind: 'WEB' });
  }
  return {
    tabs: { selected_tab_id: tabs[0]?.tab_id || null, tabs },
    fleet: { agents },
    supervisor: { workspace_bindings: { state: 'AVAILABLE', source_implemented: true, runtime_deployed: true, bindings } },
  };
}

test('projection hot path is indexed and state counts do not allocate three filter passes', () => {
  assert.match(source, /const tabMap=byId\(tabs,'tab_id'\)/);
  assert.match(source, /const agentMap=byId\(fleet,'agent_id'\)/);
  assert.doesNotMatch(source, /groups\.filter\(/);
  assert.match(source, /if\(state==='READY'\)ready\+=1;else if\(state==='FROZEN'\)frozen\+=1;else reserved\+=1/);
});

test('large mixed snapshot preserves exact counts and session fallback after optimization', () => {
  const out = projectWorkspaceWorkbench(largeSnapshot());
  assert.deepEqual(out.counts, { workspaces: 900, sessions: 300, issues: 0, ready: 300, frozen: 300, reserved: 300 });
  assert.equal(out.groups.length, 900);
  assert.equal(out.sessions.length, 300);
  assert.equal(out.grouping_authority, 'DURABLE_WORKSPACE_BINDING_ONLY');
  assert.equal(out.url_heuristic_grouping, false);
  assert.equal(out.title_heuristic_grouping, false);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.browser_actuation_authority, false);
  assert.equal(out.authority_effect, false);
});
