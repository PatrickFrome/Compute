import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ActionGraphError,
  digestActionGraphEvidence,
} from '../durable-action-graph-core-v1.mjs';
import { DurableActionGraphStore } from '../durable-action-graph-store-v1.mjs';
import { DurableActionFence, DurableActionFenceError } from '../durable-action-fence-v1.mjs';

const d = (label) => digestActionGraphEvidence({ label });
const ns = { target_id: 'tgt.r8b', context_id: 'ctx.r8b', conversation_epoch: 'conv:1', document_epoch: 'doc:1' };

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r8b-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const journalPath = path.join(dir, 'graph.jsonl');
  const headPath = `${journalPath}.head.json`;
  const store = await DurableActionGraphStore.open({ graphId: 'graph.r8b', journalPath, headPath });
  return { dir, journalPath, headPath, store };
}

function input(id, ephemeral = undefined) {
  return {
    actionId: id,
    actionKind: 'CLICK',
    intentDigest: d(`intent:${id}`),
    namespace: ns,
    ephemeral,
  };
}

async function lines(journalPath) {
  return (await fs.readFile(journalPath, 'utf8')).trimEnd().split('\n').filter(Boolean).map(JSON.parse);
}

test('preflight rejection aborts before seal and actuator is never called', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'REJECTED', reason_code: 'TARGET_NOT_ACTIONABLE' }),
    actuator: async () => { calls += 1; return { outcome: 'COMMITTED', effect_receipt_digest: d('should-not-run') }; },
  });
  const result = await fence.execute(input('act.reject'));
  assert.equal(result.outcome, 'ABORTED');
  assert.equal(calls, 0);
  assert.deepEqual((await lines(f.journalPath)).map((e) => e.event_type), ['ACTION_DECLARED', 'ACTION_ABORTED']);
});

test('durable EFFECT_INTENT_SEALED exists on disk before actuator is invoked', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('fresh-preflight'), authority: { live: true } }),
    actuator: async ({ authority }) => {
      calls += 1;
      assert.deepEqual(authority, { live: true });
      const persisted = await lines(f.journalPath);
      assert.equal(persisted.at(-1).event_type, 'EFFECT_INTENT_SEALED');
      assert.equal(JSON.parse(await fs.readFile(f.headPath, 'utf8')).seq, 2);
      return { outcome: 'COMMITTED', effect_receipt_digest: d('definite-effect') };
    },
  });
  const result = await fence.execute(input('act.commit', { secret_text: 'never-persist-me' }));
  assert.equal(result.outcome, 'COMMITTED');
  assert.equal(result.graph_receipt.state, 'COMMITTED');
  assert.equal(calls, 1);
  const journal = await fs.readFile(f.journalPath, 'utf8');
  assert.doesNotMatch(journal, /never-persist-me/);
  assert.equal(result.automatic_retry_allowed, false);
});

test('trusted typed NO_EFFECT after seal becomes terminal NO_EFFECT, not ambiguous', async (t) => {
  const f = await fixture(t);
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: Object.freeze({ token: 'ephemeral' }) }),
    actuator: async () => ({ outcome: 'NO_EFFECT', no_effect_evidence_digest: d('rejected-before-input-dispatch') }),
  });
  const result = await fence.execute(input('act.noeffect'));
  assert.equal(result.outcome, 'NO_EFFECT');
  assert.equal(result.graph_receipt.state, 'NO_EFFECT');
  await assert.rejects(fence.execute(input('act.noeffect')), (error) => error instanceof ActionGraphError && error.code === 'action_graph_action_id_exists');
});

test('typed ambiguous actuator result becomes terminal AMBIGUOUS with no retry', async (t) => {
  const f = await fixture(t);
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: null }),
    actuator: async () => ({ outcome: 'AMBIGUOUS', uncertainty_digest: d('mouse-release-transport-cut') }),
  });
  const result = await fence.execute(input('act.amb'));
  assert.equal(result.outcome, 'AMBIGUOUS');
  assert.equal(result.graph_receipt.state, 'AMBIGUOUS');
  assert.equal(result.automatic_retry_allowed, false);
});

test('untyped actuator throw is conservatively recorded as AMBIGUOUS', async (t) => {
  const f = await fixture(t);
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: null }),
    actuator: async () => { const error = new Error('transport details not durable'); error.code = 'EPIPE'; throw error; },
  });
  const result = await fence.execute(input('act.throw'));
  assert.equal(result.outcome, 'AMBIGUOUS');
  const journal = await fs.readFile(f.journalPath, 'utf8');
  assert.doesNotMatch(journal, /transport details not durable/);
  assert.doesNotMatch(journal, /EPIPE/);
});

test('malformed actuator outcome is conservatively AMBIGUOUS instead of guessed', async (t) => {
  const f = await fixture(t);
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: null }),
    actuator: async () => ({ outcome: 'COMMITTED', effect_receipt_digest: d('receipt'), extra: 'not-allowed' }),
  });
  const result = await fence.execute(input('act.malformed'));
  assert.equal(result.outcome, 'AMBIGUOUS');
  assert.equal(result.graph_receipt.state, 'AMBIGUOUS');
});

test('preflight protocol failure is definite no-attempt and aborts before seal', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', authority: {} }),
    actuator: async () => { calls += 1; return { outcome: 'COMMITTED', effect_receipt_digest: d('x') }; },
  });
  const result = await fence.execute(input('act.badpre'));
  assert.equal(result.outcome, 'ABORTED');
  assert.equal(calls, 0);
  assert.equal(f.store.snapshot().actions[0].state, 'ABORTED');
});

test('terminal persistence failure after actuator never invokes an alternative terminal write or retries actuator', async (t) => {
  const f = await fixture(t);
  let actuatorCalls = 0;
  let ambiguousCalls = 0;
  const wrappedStore = {
    declareAction: f.store.declareAction.bind(f.store),
    sealEffectIntent: f.store.sealEffectIntent.bind(f.store),
    commitEffect: async () => { throw new ActionGraphError('injected_terminal_store_failure', { recoveryRequired: true }); },
    markNoEffect: f.store.markNoEffect.bind(f.store),
    markAmbiguous: async (...args) => { ambiguousCalls += 1; return f.store.markAmbiguous(...args); },
    abortAction: f.store.abortAction.bind(f.store),
  };
  const fence = new DurableActionFence({
    store: wrappedStore,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: null }),
    actuator: async () => { actuatorCalls += 1; return { outcome: 'COMMITTED', effect_receipt_digest: d('done') }; },
  });
  await assert.rejects(fence.execute(input('act.persistfail')), (error) =>
    error instanceof DurableActionFenceError && error.code === 'action_fence_terminal_persistence_failed' && error.recovery_required === true);
  assert.equal(actuatorCalls, 1);
  assert.equal(ambiguousCalls, 0);
  assert.equal(f.store.snapshot().actions[0].state, 'EFFECT_INTENT_SEALED');
  await assert.rejects(fence.execute(input('act.persistfail')), /action_graph_action_id_exists/);
  assert.equal(actuatorCalls, 1);
});

test('same action ID concurrent execution can invoke actuator at most once', async (t) => {
  const f = await fixture(t);
  let actuatorCalls = 0;
  const fence = new DurableActionFence({
    store: f.store,
    preflight: async () => ({ status: 'READY', pre_effect_evidence_digest: d('pre'), authority: null }),
    actuator: async () => { actuatorCalls += 1; return { outcome: 'NO_EFFECT', no_effect_evidence_digest: d('no-effect') }; },
  });
  const settled = await Promise.allSettled([fence.execute(input('act.race')), fence.execute(input('act.race'))]);
  assert.equal(settled.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((x) => x.status === 'rejected').length, 1);
  assert.equal(actuatorCalls, 1);
});
