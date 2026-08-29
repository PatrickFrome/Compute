import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DurableActionGraphStore } from '../coordination/browser-shared/durable-action-graph-store-v1.mjs';
import { createDurableActionFence } from '../coordination/browser-shared/durable-action-fence-v1.mjs';
import { createExtensionTypedClickActuator } from '../coordination/browser-shared/extension-typed-click-actuator-v1.mjs';
import { digestActionGraphEvidence } from '../coordination/browser-shared/durable-action-graph-core-v1.mjs';

const namespace = Object.freeze({
  target_id: 'target.chatgpt',
  context_id: 'context.main',
  conversation_epoch: 'epoch-1',
  document_epoch: 'doc-1',
});

async function withStore(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'a2-r8d-fence-'));
  try {
    const store = await DurableActionGraphStore.open({ graphId: 'graph.r8d', journalPath: path.join(root, 'actions.jsonl') });
    return await fn(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('transport loss after durable seal becomes AMBIGUOUS and is not retried', async () => {
  await withStore(async (store) => {
    let transportCalls = 0;
    const actuator = createExtensionTypedClickActuator({
      dispatchCommand: async () => {
        transportCalls += 1;
        throw new Error('remote_result_lost');
      },
    });
    const fence = createDurableActionFence({
      store,
      preflight: async () => ({
        status: 'READY',
        pre_effect_evidence_digest: digestActionGraphEvidence({ authority: 'fresh', target: 'R8D Canary' }),
        authority: { decision: 'ALLOW', lease: 'fresh' },
      }),
      actuator,
    });
    const result = await fence.execute({
      actionId: 'r8d.click.uncertain',
      actionKind: 'CLICK',
      intentDigest: digestActionGraphEvidence({ intent: 'click', target: 'R8D Canary' }),
      namespace,
      ephemeral: { platform: 'CHATGPT', role: 'button', accessible_name: 'R8D Canary' },
    });
    assert.equal(result.outcome, 'AMBIGUOUS');
    assert.equal(result.automatic_retry_allowed, false);
    assert.equal(transportCalls, 1);
    const snapshot = store.snapshot();
    const action = snapshot.actions.find((row) => row.action_id === 'r8d.click.uncertain');
    assert.equal(action.state, 'AMBIGUOUS');
  });
});

test('typed COMMITTED completion produces durable COMMITTED terminal state', async () => {
  await withStore(async (store) => {
    let transportCalls = 0;
    const actuator = createExtensionTypedClickActuator({
      dispatchCommand: async (command) => {
        transportCalls += 1;
        return {
          command_id: 'command.r8d.1',
          status: 'COMPLETED',
          result: {
            action_id: command.payload.action_id,
            outcome: 'COMMITTED',
            reason_code: 'typed_click_press_release_acknowledged',
            physical_dispatch_started: true,
            automatic_retry_allowed: false,
            authority_effect: false,
            actuation_eligible: false,
          },
        };
      },
    });
    const fence = createDurableActionFence({
      store,
      preflight: async () => ({
        status: 'READY',
        pre_effect_evidence_digest: digestActionGraphEvidence({ authority: 'fresh', target: 'R8D Canary' }),
        authority: { decision: 'ALLOW', lease: 'fresh' },
      }),
      actuator,
    });
    const result = await fence.execute({
      actionId: 'r8d.click.commit',
      actionKind: 'CLICK',
      intentDigest: digestActionGraphEvidence({ intent: 'click', target: 'R8D Canary' }),
      namespace,
      ephemeral: { platform: 'CHATGPT', role: 'button', accessible_name: 'R8D Canary' },
    });
    assert.equal(result.outcome, 'COMMITTED');
    assert.equal(transportCalls, 1);
    const snapshot = store.snapshot();
    const action = snapshot.actions.find((row) => row.action_id === 'r8d.click.commit');
    assert.equal(action.state, 'COMMITTED');
  });
});
