import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserComposition } from '../src/fleet-browser-composition.mjs';

const CONVERSATION_URL = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function semanticFrame({ url = 'https://chatgpt.com/', stop = false, send = true } = {}) {
  return {
    url,
    viewport: { width: 1200, height: 640 },
    semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 3 },
      ...(send ? [{ role: 'button', name: 'Отправить промпт', backend_node_id: 8 }] : []),
      ...(stop ? [{ role: 'button', name: 'Остановить ответ', backend_node_id: 9 }] : []),
    ],
    authority_effect: false,
  };
}

function fixture({ captureFrames = null } = {}) {
  const saved = [];
  const control = [];
  let selectedTabId = 'tab_supervisor';
  let captureIndex = 0;
  const frames = captureFrames || [semanticFrame(), semanticFrame(), semanticFrame({ url: CONVERSATION_URL, stop: true, send: false })];
  const state = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.4.0',
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    agents: [{
      agent_id: 'agent_compose-12345678',
      role: 'PLANNER',
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'BOUND_UNVERIFIED',
      tab_id: 'tab_1',
      target_id: 'webcontents:101',
      conversation_epoch: 0,
      generation_epoch: 7,
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
    updated_at: '2026-08-31T00:00:00.000Z',
  };
  const composition = createFleetBrowserComposition({
    createTab: async () => { throw new Error('unexpected_create'); },
    loadTab: async () => { throw new Error('unexpected_load'); },
    tabExists: (tabId) => tabId === 'tab_1',
    loadState: async () => state,
    saveState: async (next) => { saved.push(structuredClone(next)); },
    lookupView: (tabId) => tabId === 'tab_1' ? {
      webContents: {
        id: 101,
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        getURL: () => CONVERSATION_URL,
      },
    } : null,
    selectTab: async (tabId) => {
      control.push(['select', tabId]);
      selectedTabId = tabId;
      return { ok: true, tab_id: tabId };
    },
    getSelectedTabId: async () => selectedTabId,
    captureSemanticFrame: async () => {
      const frame = structuredClone(frames[Math.min(captureIndex, frames.length - 1)]);
      captureIndex += 1;
      control.push(['capture', frame.url]);
      return frame;
    },
    executeSemanticCommand: async (_wc, command) => {
      control.push(['execute', command.action]);
      return { action: command.action, authority_effect: true };
    },
    publishSnapshot: async () => { control.push(['publish']); },
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    clock: () => Date.parse('2026-08-31T12:00:00.000Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
  });
  return { composition, saved, control };
}

test('composition does not expose raw FleetProvisioner promotion, dispatcher or proof input', async () => {
  const { composition } = fixture();
  await composition.init();
  assert.equal(Object.isFrozen(composition), true);
  assert.equal('markTransportProven' in composition, false);
  assert.equal('fleet' in composition, false);
  assert.equal('provisioner' in composition, false);
  assert.equal('dispatchFleetTask' in composition, false);
  assert.equal(composition.raw_dispatcher_exposed, false);
  assert.equal(composition.raw_transport_promotion_exposed, false);
  assert.equal(composition.proof_input_surface_exposed, false);
  assert.equal(composition.renderer_input_authority, false);
  assert.equal(composition.worker_browser_authority, false);
});

test('promotion derives exact live proof and ignores forged proof-shaped fields', async () => {
  const { composition } = fixture();
  await composition.init();
  const result = await composition.promoteAgentFromLiveBrowser({
    agent_id: 'agent_compose-12345678',
    tab_id: 'tab_attacker',
    target_id: 'webcontents:999',
    generation_epoch: 999,
    authority_effect: true,
  });
  const agent = result.agents.find((row) => row.agent_id === 'agent_compose-12345678');
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.equal(agent.transport_proof.tab_id, 'tab_1');
  assert.equal(agent.transport_proof.target_id, 'webcontents:101');
  assert.equal(agent.transport_proof.generation_epoch, 7);
  assert.equal(agent.authority_effect, false);
  assert.equal(agent.automatic_retry_allowed, false);
});

test('composition dispatches exact-bound task only through foreground two-phase Browser-main dependencies', async () => {
  const { composition, control } = fixture();
  await composition.init();
  const result = await composition.dispatchTask({
    task_id: 'task.compose.dispatch.0001',
    agent_id: 'agent_compose-12345678',
    point_id: 'devbrowser.transport.runtime-wire.v1',
    base_sha: '0123456789abcdef0123456789abcdef01234567',
    generation_epoch: 7,
    prompt: 'Produce branch-local evidence only.',
  });

  assert.equal(result.schema, 'metaengine.browser.fleet-task-dispatch.v3');
  assert.equal(result.effect_state, 'PROVEN_GENERATING');
  assert.equal(result.selected_tab_mutation, true);
  assert.equal(result.viewport_geometry_required, true);
  assert.equal(result.mouse_geometry_required, true);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(composition.dispatch_surface, 'TYPED_EXACT_BOUND_TASK_ONLY');
  assert.deepEqual(control.filter(([kind]) => kind === 'execute').map(([, action]) => action), ['SEMANTIC_TYPE', 'TYPED_CLICK']);
  assert.deepEqual(control.find(([kind]) => kind === 'select'), ['select', 'tab_1']);
  const agent = result.fleet.agents.find((row) => row.agent_id === 'agent_compose-12345678');
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.equal(agent.transport_proof.tab_id, 'tab_1');
  assert.equal(agent.transport_proof.target_id, 'webcontents:101');
  assert.equal(agent.transport_proof.generation_epoch, 7);
});

test('composition preserves ambiguity when existing conversation URL has no STOP proof', async () => {
  const existing = semanticFrame({ url: CONVERSATION_URL, stop: false, send: true });
  const { composition, control } = fixture({ captureFrames: [existing, existing, existing] });
  await composition.init();
  await assert.rejects(
    () => composition.dispatchTask({
      task_id: 'task.compose.dispatch.0002',
      agent_id: 'agent_compose-12345678',
      point_id: 'devbrowser.transport.runtime-wire.v1',
      base_sha: '0123456789abcdef0123456789abcdef01234567',
      generation_epoch: 7,
      prompt: 'Do not treat an existing conversation as send proof.',
    }),
    (error) => {
      assert.equal(error.message, 'fleet_task_send_effect_ambiguous');
      assert.equal(error.receipt.effect_state, 'AMBIGUOUS_AFTER_CLICK');
      assert.equal(error.receipt.new_conversation_observed, false);
      assert.equal(error.receipt.automatic_retry_allowed, false);
      return true;
    },
  );
  assert.equal(control.filter(([kind, action]) => kind === 'execute' && action === 'TYPED_CLICK').length, 1);
  const agent = composition.snapshot().agents.find((row) => row.agent_id === 'agent_compose-12345678');
  assert.equal(agent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(agent.transport_proof, null);
});

test('composition keeps lifecycle operations but no arbitrary eval or execution surface', async () => {
  const { composition } = fixture();
  await composition.init();
  for (const key of ['eval', 'execute', 'executeJavaScript', 'dispatchWorker', 'rawFleet']) {
    assert.equal(key in composition, false);
  }
  await assert.rejects(composition.promoteAgentFromLiveBrowser({}), /agent_id_required/);
});
