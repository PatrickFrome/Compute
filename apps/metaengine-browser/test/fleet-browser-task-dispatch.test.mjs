import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserTaskDispatch } from '../src/fleet-browser-task-dispatch.mjs';

const AGENT_ID = 'agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAB_ID = 'tab_11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const CONVERSATION_URL = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function frame({ url = 'https://chatgpt.com/', stop = false, send = true } = {}) {
  return {
    url,
    viewport: { width: 1200, height: 600 },
    semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 3 },
      ...(send ? [{ role: 'button', name: 'Отправить промпт', backend_node_id: 8 }] : []),
      ...(stop ? [{ role: 'button', name: 'Остановить ответ', backend_node_id: 9 }] : []),
    ],
    authority_effect: false,
  };
}

function fixture() {
  const calls = [];
  let captureIndex = 0;
  let marked = null;
  let selectedTab = 'tab_supervisor';
  const frames = [frame(), frame(), frame({ url: CONVERSATION_URL, stop: true, send: false })];

  const fleet = {
    snapshot: () => ({ agents: [{
      agent_id: AGENT_ID,
      role: 'IMPLEMENTER',
      lifecycle_state: 'BOUND_UNVERIFIED',
      generation_epoch: 4,
      tab_id: TAB_ID,
      target_id: TARGET_ID,
    }] }),
    markTransportProven: async (value) => {
      calls.push(['mark', structuredClone(value)]);
      marked = structuredClone(value);
      return { ok: true };
    },
  };

  const dispatch = createFleetBrowserTaskDispatch({
    fleet,
    lookupView: (tabId) => {
      calls.push(['lookup', tabId]);
      return tabId === TAB_ID ? { webContents: { id: 77, isDestroyed: () => false } } : null;
    },
    selectTab: async (tabId) => {
      calls.push(['select', tabId]);
      selectedTab = tabId;
      return { ok: true, tab_id: tabId };
    },
    getSelectedTabId: async () => selectedTab,
    captureSemanticFrame: async () => {
      const next = structuredClone(frames[Math.min(captureIndex, frames.length - 1)]);
      captureIndex += 1;
      calls.push(['capture', captureIndex]);
      return next;
    },
    executeSemanticCommand: async (_wc, command) => {
      calls.push(['execute', structuredClone(command)]);
      return { action: command.action, authority_effect: true };
    },
    publishSnapshot: async () => { calls.push(['publish']); },
  });

  return { dispatch, calls, getMarked: () => marked };
}

function payload() {
  return {
    task_id: 'task.autonomy.impl.0001',
    agent_id: AGENT_ID,
    point_id: 'federated.autonomy.dispatch',
    base_sha: '0123456789abcdef0123456789abcdef01234567',
    generation_epoch: 4,
    prompt: 'Implement the next isolated autonomy slice.',
  };
}

test('main-process task dispatch facade exposes only trusted dispatch operation', () => {
  const { dispatch } = fixture();
  assert.equal(Object.isFrozen(dispatch), true);
  assert.equal(typeof dispatch.dispatchTrustedTask, 'function');
  for (const key of ['fleet','provisioner','lookupView','selectTab','getSelectedTabId','captureSemanticFrame','executeSemanticCommand','eval','executeJavaScript']) {
    assert.equal(key in dispatch, false);
  }
  assert.equal(dispatch.raw_fleet_exposed, false);
  assert.equal(dispatch.raw_view_lookup_exposed, false);
  assert.equal(dispatch.raw_selection_exposed, false);
  assert.equal(dispatch.raw_semantic_control_exposed, false);
  assert.equal(dispatch.renderer_input_authority, false);
  assert.equal(dispatch.worker_browser_authority, false);
  assert.equal(dispatch.page_data_authority, false);
  assert.equal(dispatch.arbitrary_eval, false);
  assert.equal(dispatch.automatic_retry_allowed, false);
  assert.equal(dispatch.authority_effect, false);
});

test('trusted dispatch delegates through exact foreground two-phase path and returns no prompt text', async () => {
  const h = fixture();
  const result = await h.dispatch.dispatchTrustedTask(payload());
  const executes = h.calls.filter(([kind]) => kind === 'execute');
  assert.equal(executes.length, 2);
  assert.equal(executes[0][1].action, 'SEMANTIC_TYPE');
  assert.equal(executes[0][1].payload.submit_after_type, false);
  assert.equal(executes[1][1].action, 'TYPED_CLICK');
  assert.equal(result.schema, 'metaengine.browser.fleet-task-dispatch.v3');
  assert.equal(result.effect_state, 'PROVEN_GENERATING');
  assert.equal(result.selected_tab_mutation, true);
  assert.equal(result.viewport_geometry_required, true);
  assert.equal(JSON.stringify(result).includes(payload().prompt), false);
  assert.deepEqual(h.getMarked(), {
    agent_id: AGENT_ID,
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    generation_epoch: 4,
    conversation_url: CONVERSATION_URL,
  });
});

test('invalid dependency composition fails closed before any runtime operation', () => {
  assert.throws(() => createFleetBrowserTaskDispatch({}), /fleet_task_dispatch_fleet_invalid/);
  assert.throws(() => createFleetBrowserTaskDispatch({ fleet: { snapshot: () => ({}), markTransportProven: async () => {} } }), /fleet_task_dispatch_lookup_invalid/);
});
