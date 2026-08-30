import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dispatchFleetTask } from '../src/fleet-task-dispatcher.mjs';

const AGENT_ID = 'agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAB_ID = 'tab_11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function frame({ url = 'https://chatgpt.com/', stop = false } = {}) {
  return {
    url,
    semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 3 },
      ...(stop ? [{ role: 'button', name: 'Остановить ответ', backend_node_id: 9 }] : []),
    ],
    authority_effect: false,
  };
}

function harness({ submitEffect = 'PROVEN_GENERATING', postFrame = frame({ url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', stop: true }), liveWebContentsId = 77 } = {}) {
  const calls = [];
  let marked = null;
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
      marked = structuredClone(value);
      return { ok: true };
    },
  };
  let captureCount = 0;
  return {
    calls,
    fleet,
    getMarked: () => marked,
    deps: {
      fleet,
      getView: () => ({ webContents: { id: liveWebContentsId, isDestroyed: () => false } }),
      publishSnapshot: async () => { calls.push(['publish']); },
      captureSemanticFrame: async () => {
        captureCount += 1;
        calls.push(['capture', captureCount]);
        return captureCount === 1 ? frame() : structuredClone(postFrame);
      },
      executeSemanticCommand: async (_wc, command) => {
        calls.push(['execute', structuredClone(command)]);
        return {
          action: 'SEMANTIC_TYPE',
          submit_after_type: true,
          effect_state: submitEffect,
          stop_observed: submitEffect === 'PROVEN_GENERATING',
          new_conversation_observed: submitEffect === 'PROVEN_NEW_CONVERSATION',
          post_url_sha256: crypto.createHash('sha256').update(postFrame.url || '').digest('hex'),
          prompt_included: false,
          automatic_retry_allowed: false,
          authority_effect: true,
        };
      },
    },
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

test('fleet dispatcher uses one geometry-independent submit and promotes exact binding after readback', async () => {
  const h = harness();
  const result = await dispatchFleetTask({ payload: payload(), ...h.deps });
  const executeCalls = h.calls.filter(([kind]) => kind === 'execute');
  assert.equal(executeCalls.length, 1);
  const command = executeCalls[0][1];
  assert.equal(command.action, 'SEMANTIC_TYPE');
  assert.equal(command.platform, 'CHATGPT');
  assert.equal(command.payload.submit_after_type, true);
  assert.equal(command.payload.role, 'textbox');
  assert.equal(command.payload.accessible_name, 'Чат с ChatGPT');
  assert.equal(result.schema, 'metaengine.browser.fleet-task-dispatch.v2');
  assert.equal(result.selected_tab_mutation, false);
  assert.equal(result.viewport_geometry_required, false);
  assert.equal(result.mouse_geometry_required, false);
  assert.equal(result.prompt_included, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.prompt_sha256, crypto.createHash('sha256').update(payload().prompt).digest('hex'));
  assert.equal(JSON.stringify(result).includes(payload().prompt), false);
  assert.deepEqual(h.getMarked(), {
    agent_id: AGENT_ID,
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    generation_epoch: 4,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
});

test('ambiguous Enter result never promotes and never retries', async () => {
  const h = harness({
    submitEffect: 'AMBIGUOUS_AFTER_ENTER',
    postFrame: frame({ url: 'https://chatgpt.com/', stop: false }),
  });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    (error) => {
      assert.equal(error.message, 'fleet_task_send_effect_ambiguous');
      assert.equal(error.receipt.automatic_retry_allowed, false);
      assert.equal(error.receipt.effect_state, 'AMBIGUOUS_AFTER_ENTER');
      return true;
    },
  );
  assert.equal(h.getMarked(), null);
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 1);
});

test('physical webContents incarnation mismatch fails before any actuation', async () => {
  const h = harness({ liveWebContentsId: 999 });
  await assert.rejects(
    () => dispatchFleetTask({ payload: payload(), ...h.deps }),
    /fleet_task_target_incarnation_mismatch/,
  );
  assert.equal(h.calls.filter(([kind]) => kind === 'execute').length, 0);
  assert.equal(h.getMarked(), null);
});
