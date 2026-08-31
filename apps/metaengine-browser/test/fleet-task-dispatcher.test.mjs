import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dispatchFleetTask } from '../src/fleet-task-dispatcher.mjs';

const AGENT_ID = 'agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAB_ID = 'tab_11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONVERSATION_URL = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function frame({
  url = 'https://chatgpt.com/',
  stop = false,
  send = true,
  viewport = { width: 1200, height: 600 },
} = {}) {
  return {
    url,
    viewport,
    semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 3 },
      ...(send ? [{ role: 'button', name: 'Отправить промпт', backend_node_id: 8 }] : []),
      ...(stop ? [{ role: 'button', name: 'Остановить ответ', backend_node_id: 9 }] : []),
    ],
    authority_effect: false,
  };
}

function payload() {
  return {
    task_id: 'task.autonomy.impl.0001',
    agent_id: AGENT_ID,
    point_id: 'federated.autonomy.dispatch',
    base_sha: BASE_SHA,
    generation_epoch: 4,
    prompt: 'Implement the next isolated autonomy slice.',
  };
}

function harness({
  captureFrames = [frame(), frame(), frame({ url: CONVERSATION_URL, stop: true, send: false })],
  initialSelectedTab = 'tab_supervisor',
  selectedAfterSelect = TAB_ID,
  selectedBeforeClick = TAB_ID,
  liveWebContentsIds = [77, 77, 77],
} = {}) {
  const calls = [];
  let marked = null;
  let captureIndex = 0;
  let viewIndex = 0;
  let selectedReads = 0;

  const fleet = {
    snapshot: () => ({
      agents: [{
        agent_id: AGENT_ID,
        role: 'IMPLEMENTER',
        lifecycle_state: 'BOUND_UNVERIFIED',
        generation_epoch: 4,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
      }],
    }),
    markTransportProven: async (value) => {
      calls.push(['mark', structuredClone(value)]);
      marked = structuredClone(value);
      return { ok: true };
    },
  };

  return {
    calls,
    getMarked: () => marked,
    deps: {
      fleet,
      getView: () => {
        const id = liveWebContentsIds[Math.min(viewIndex, liveWebContentsIds.length - 1)];
        viewIndex += 1;
        calls.push(['getView', id]);
        return { webContents: { id, isDestroyed: () => false } };
      },
      selectTab: async (tabId) => {
        calls.push(['select', tabId]);
        return { ok: true, tab_id: tabId };
      },
      getSelectedTabId: async () => {
        selectedReads += 1;
        const value = selectedReads === 1 ? selectedAfterSelect : selectedBeforeClick;
        calls.push(['selected', value]);
        return value || initialSelectedTab;
      },
      publishSnapshot: async () => { calls.push(['publish']); },
      captureSemanticFrame: async () => {
        const value = structuredClone(captureFrames[Math.min(captureIndex, captureFrames.length - 1)]);
        captureIndex += 1;
        calls.push(['capture', captureIndex, value]);
        return value;
      },
      executeSemanticCommand: async (_wc, command) => {
        calls.push(['execute', structuredClone(command)]);
        return { action: command.action, authority_effect: true };
      },
    },
  };
}

test('dispatcher selects exact worker and uses type-only then typed Send before promotion', async () => {
  const h = harness();
  const result = await dispatchFleetTask({ payload: payload(), ...h.deps });

  const executeCalls = h.calls.filter(([kind]) => kind === 'execute');
  assert.equal(executeCalls.length, 2);
  assert.equal(executeCalls[0][1].action, 'SEMANTIC_TYPE');
  assert.equal(executeCalls[0][1].platform, 'CHATGPT');
  assert.equal(executeCalls[0][1].payload.submit_after_type, false);
  assert.equal(executeCalls[0][1].payload.accessible_name, 'Чат с ChatGPT');
  assert.equal(executeCalls[1][1].action, 'TYPED_CLICK');
  assert.equal(executeCalls[1][1].payload.role, 'button');
  assert.equal(executeCalls[1][1].payload.accessible_name, 'Отправить промпт');

  const selectIndex = h.calls.findIndex(([kind]) => kind === 'select');
  const firstCaptureIndex = h.calls.findIndex(([kind]) => kind === 'capture');
  const firstExecuteIndex = h.calls.findIndex(([kind]) => kind === 'execute');
  assert.ok(selectIndex >= 0 && selectIndex < firstCaptureIndex && firstCaptureIndex < firstExecuteIndex);

  assert.equal(result.schema, 'metaengine.browser.fleet-task-dispatch.v3');
  assert.equal(result.submit_after_type, false);
  assert.equal(result.selected_tab_mutation, true);
  assert.equal(result.viewport_geometry_required, true);
  assert.equal(result.mouse_geometry_required, true);
  assert.equal(result.effect_state, 'PROVEN_GENERATING');
  assert.equal(result.prompt_included, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.prompt_sha256, crypto.createHash('sha256').update(payload().prompt).digest('hex'));
  assert.equal(JSON.stringify(result).includes(payload().prompt), false);
  assert.deepEqual(h.getMarked(), {
    agent_id: AGENT_ID,
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    generation_epoch: 4,
    conversation_url: CONVERSATION_URL,
  });
});

test('zero viewport fails before typing or click', async () => {
  const h = harness({ captureFrames: [frame({ viewport: { width: 0, height: 0 } })] });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_submit_not_ready:PRE_TYPE:VIEWPORT_NOT_RENDERABLE/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 0);
  assert.equal(h.getMarked(), null);
});

test('foreground selection mismatch fails before typing', async () => {
  const h = harness({ selectedAfterSelect: 'tab_other' });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_foreground_selection_unproven/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 0);
  assert.equal(h.getMarked(), null);
});

test('physical webContents incarnation mismatch fails before selection or typing', async () => {
  const h = harness({ liveWebContentsIds: [999] });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_target_incarnation_mismatch/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'select').length, 0);
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 0);
  assert.equal(h.getMarked(), null);
});

test('target replacement after foreground selection fails before typing', async () => {
  const h = harness({ liveWebContentsIds: [77, 999] });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_target_incarnation_mismatch/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 0);
  assert.equal(h.getMarked(), null);
});

test('readiness lost after type blocks click and promotion without blind retry', async () => {
  const h = harness({
    captureFrames: [
      frame(),
      frame({ viewport: { width: 0, height: 0 } }),
    ],
  });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_submit_not_ready:PRE_CLICK:VIEWPORT_NOT_RENDERABLE/,
  );
  const executeCalls = h.calls.filter(([kind]) => kind === 'execute');
  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0][1].action, 'SEMANTIC_TYPE');
  assert.equal(executeCalls[0][1].payload.submit_after_type, false);
  assert.equal(h.getMarked(), null);
});

test('foreground loss after type blocks click', async () => {
  const h = harness({ selectedBeforeClick: 'tab_other' });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_foreground_lost_after_type/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 1);
  assert.equal(h.getMarked(), null);
});

test('click without post-send proof is ambiguous and is never repeated', async () => {
  const h = harness({
    captureFrames: [frame(), frame(), frame({ url: 'https://chatgpt.com/', stop: false, send: true })],
  });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    (error) => {
      assert.equal(error.message, 'fleet_task_send_effect_ambiguous');
      assert.equal(error.receipt.schema, 'metaengine.browser.fleet-task-dispatch.v3');
      assert.equal(error.receipt.effect_state, 'AMBIGUOUS_AFTER_CLICK');
      assert.equal(error.receipt.automatic_retry_allowed, false);
      return true;
    },
  );
  const executeCalls = h.calls.filter(([kind]) => kind === 'execute');
  assert.equal(executeCalls.length, 2);
  assert.equal(executeCalls.filter(([, command]) => command.action === 'TYPED_CLICK').length, 1);
  assert.equal(h.getMarked(), null);
});

test('existing conversation URL alone never proves a no-op click', async () => {
  const h = harness({
    captureFrames: [
      frame({ url: CONVERSATION_URL, stop: false, send: true }),
      frame({ url: CONVERSATION_URL, stop: false, send: true }),
      frame({ url: CONVERSATION_URL, stop: false, send: true }),
    ],
  });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    (error) => {
      assert.equal(error.message, 'fleet_task_send_effect_ambiguous');
      assert.equal(error.receipt.effect_state, 'AMBIGUOUS_AFTER_CLICK');
      assert.equal(error.receipt.new_conversation_observed, false);
      assert.equal(error.receipt.stop_observed, false);
      assert.equal(error.receipt.automatic_retry_allowed, false);
      return true;
    },
  );
  const clickCalls = h.calls.filter(([kind, command]) => kind === 'execute' && command.action === 'TYPED_CLICK');
  assert.equal(clickCalls.length, 1);
  assert.equal(h.getMarked(), null);
});
