import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CLIENT_AGENT_SELECTION_SCHEMA,
  CLIENT_GOAL_SCHEMA,
  normalizeClientAgentId,
  normalizeClientAgentSelectionReadback,
  normalizeClientGoalActivationReadback,
  normalizeClientGoalIntent,
} from '../src/client-control-contract.mjs';

const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const me2Shell = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');

function activation(goal = 'Ship a useful browser task') {
  return {
    schema: 'metaengine.meta-orchestrator.objective-activation.v1',
    activation: { schema: 'metaengine.meta-orchestrator.plan-state.v1' },
    objective: goal,
    roadmap_id: 'metaengine-development-os-v1',
    plan_generation: 17,
    point_ids: ['obj.ship-a-useful-browser-task.v1'],
    node_count: 1,
    operator_initiated: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
}

test('typed goal intent and exact activation readback are bounded and authority explicit', () => {
  const intent = normalizeClientGoalIntent('  Ship a useful browser task  ');
  assert.equal(intent.goal, 'Ship a useful browser task');
  assert.equal(intent.automatic_retry_allowed, false);
  assert.equal(intent.authority_effect, false);

  const out = normalizeClientGoalActivationReadback(activation(intent.goal), intent.goal);
  assert.equal(out.schema, CLIENT_GOAL_SCHEMA);
  assert.equal(out.objective_id, 'metaengine-development-os-v1:g17');
  assert.deepEqual(out.point_ids, ['obj.ship-a-useful-browser-task.v1']);
  assert.equal(out.task_admission_state, 'PENDING_CANONICAL_SCHEDULER_ADMISSION');
  assert.equal(out.exact_activation_readback, true);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.browser_actuation_authority, false);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);

  assert.throws(() => normalizeClientGoalIntent(''), /client_goal_invalid/);
  assert.throws(() => normalizeClientGoalIntent('x'.repeat(481)), /client_goal_invalid/);
  assert.throws(
    () => normalizeClientGoalActivationReadback({ ...activation(intent.goal), authority_effect: true }, intent.goal),
    /client_goal_activation_readback_invalid/,
  );
});

test('typed agent selection requires exact Native Browser binding readback', () => {
  const agentId = normalizeClientAgentId('AGENT_abcd1234');
  assert.equal(agentId, 'agent_abcd1234');
  const out = normalizeClientAgentSelectionReadback({
    schema: 'metaengine.browser.primary-chat-actor-selection.v1',
    actor_id: 'agent:agent_abcd1234',
    actor_type: 'AGENT',
    tab_id: 'tab_1',
    selection_applied: true,
    exact_native_binding: true,
    presentation_only: true,
    renderer_routing_authority: false,
    browser_command_authority: false,
    scheduler_authority: false,
    update_authority: false,
    authority_effect: false,
  }, agentId);
  assert.equal(out.schema, CLIENT_AGENT_SELECTION_SCHEMA);
  assert.equal(out.agent_id, agentId);
  assert.equal(out.selection_applied, true);
  assert.equal(out.exact_native_binding, true);
  assert.equal(out.browser_actuation_authority, false);
  assert.equal(out.authority_effect, false);

  assert.throws(() => normalizeClientAgentId('supervisor:abc'), /client_agent_id_invalid/);
  assert.throws(() => normalizeClientAgentSelectionReadback({
    ...out,
    schema: 'metaengine.browser.primary-chat-actor-selection.v1',
    actor_id: 'agent:agent_other123',
    actor_type: 'AGENT',
    renderer_routing_authority: false,
    browser_command_authority: false,
  }, agentId), /client_agent_selection_readback_invalid/);
});

test('main process owns dedicated typed IPC routes and Native Supervisor goal transport', () => {
  assert.match(main, /ipcMain\.handle\('metaengine:client:submit-goal'/);
  assert.match(main, /ipcMain\.handle\('metaengine:client:select-agent'/);
  assert.match(main, /nativeSupervisor\.metaObjectiveSet\(\{ objective: intent\.goal \}\)/);
  assert.match(main, /normalizeClientGoalActivationReadback\(activation, intent\.goal\)/);
  assert.match(main, /selectPrimaryChatActor\(\`agent:\$\{agentId\}\`\)/);
  assert.match(main, /normalizeClientAgentSelectionReadback\(selected, agentId\)/);
});

test('primary preload exposes one narrow typed product bridge, not generic command()', () => {
  const marker = "contextBridge.exposeInMainWorld('metaengineClient'";
  const start = preload.indexOf(marker);
  assert.ok(start >= 0);
  const typedBlock = preload.slice(start, preload.indexOf('}));', start) + 4);
  assert.match(typedBlock, /submitGoal: submitClientGoal/);
  assert.match(typedBlock, /selectAgent: selectClientAgent/);
  assert.match(typedBlock, /typed_positive_api: true/);
  assert.match(typedBlock, /generic_command_exposed: false/);
  assert.match(preload, /'metaengine:client:submit-goal'/);
  assert.match(preload, /'metaengine:client:select-agent'/);
  assert.doesNotMatch(typedBlock, /command\s*:/);
  assert.doesNotMatch(typedBlock, /ipcRenderer/);
});

test('primary ME2 product UI submits goals and Agent selection only through typed bridge', () => {
  assert.match(me2Shell, /data-testid="client-goal-composer"/);
  assert.match(me2Shell, /data-testid="client-goal-input"/);
  assert.match(me2Shell, /data-testid="client-goal-submit"/);
  assert.match(me2Shell, /clientControlBridge\(\)/);
  assert.match(me2Shell, /bridge\.submitGoal\(value\)/);
  assert.match(me2Shell, /bridge\.selectAgent\(agentId\)/);
  const composerStart = me2Shell.indexOf('function GoalComposer()');
  const composerEnd = me2Shell.indexOf('function PageOutlet', composerStart);
  const composer = me2Shell.slice(composerStart, composerEnd);
  assert.doesNotMatch(composer, /fetch\s*\(|me2Fetch|sendCommand|metaengineShell|:3041|:3000/);
});
