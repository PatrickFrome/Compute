import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapper = await readFile(new URL('../src/devos-native-task-cycle.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../src/devos-native-task-cycle-core.mjs', import.meta.url), 'utf8');

test('R98 Agent session seed belongs only to the pre-admission wrapper', () => {
  assert.match(wrapper, /GLM_ROOT_CONVERSATION_SEED/);
  assert.match(wrapper, /resolveAgentPlatformAgentSurface/);
  assert.match(wrapper, /NEW_TASK_DISPATCHED/);
  assert.match(wrapper, /LOCAL_ACTIVE_AGENT_SESSION/);
  assert.match(wrapper, /expected_agent_surface_sha256/);
  assert.match(wrapper, /beginFleetTransportBootstrapAttempt/);
});

test('R98 scheduler-leased core cannot bootstrap or flush a root Chat surface', () => {
  assert.match(core, /devos_dispatch_requires_preexisting_agent_conversation/);
  assert.match(core, /conversation_bootstrap: 'PREEXISTING_AGENT_SESSION'/);
  assert.doesNotMatch(core, /#submitRootBootstrap/);
  assert.doesNotMatch(core, /#ensureProvenConversation/);
  assert.doesNotMatch(core, /GLM_ROOT_DRAFT_FLUSH_MARKER/);
  assert.doesNotMatch(core, /fleet_task_root_draft_over_flush_limit/);
});

test('R98 bootstrap and leased dispatch remain separate authority phases', () => {
  const bootstrapIndex = wrapper.indexOf('NEW_TASK_DISPATCHED');
  const seedIndex = wrapper.indexOf('GLM_ROOT_CONVERSATION_SEED', bootstrapIndex);
  const proofIndex = wrapper.indexOf('markFleetTransportProvenFromNativeFrame', seedIndex);
  assert.ok(bootstrapIndex >= 0);
  assert.ok(seedIndex > bootstrapIndex);
  assert.ok(proofIndex > seedIndex);
  assert.match(core, /leased dispatch never bootstraps, flushes, or repairs a root Chat surface/);
});
