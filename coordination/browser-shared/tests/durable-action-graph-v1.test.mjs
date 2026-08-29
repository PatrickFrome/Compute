import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ActionGraphError,
  ActionGraphState,
  digestActionGraphEvidence,
} from '../durable-action-graph-core-v1.mjs';
import { DurableActionGraphStore } from '../durable-action-graph-store-v1.mjs';

const d = (label) => digestActionGraphEvidence({ label });
const ns = (document = 'doc:1') => ({
  target_id: 'tgt.one',
  context_id: 'ctx.one',
  conversation_epoch: 'conv:1',
  document_epoch: document,
});

async function fixture(t, graphId = 'graph.r8a') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r8a-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const journalPath = path.join(dir, 'action-graph.jsonl');
  const headPath = path.join(dir, 'action-graph.head.json');
  const store = await DurableActionGraphStore.open({ graphId, journalPath, headPath });
  return { dir, journalPath, headPath, store, graphId };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ActionGraphError && error.code === code);
}

test('durable intent is persisted before effect resolution and survives reopen', async (t) => {
  const f = await fixture(t);
  const declared = await f.store.declareAction({
    actionId: 'act.one', actionKind: 'CLICK', intentDigest: d('intent-1'), namespace: ns(), payload: 'super-secret-never-store',
  });
  assert.equal(declared.state, 'DECLARED');
  assert.equal(declared.authority_effect, false);
  assert.equal(declared.actuation_eligible, false);

  const sealed = await f.store.sealEffectIntent({ actionId: 'act.one', preEffectEvidenceDigest: d('fresh-actionability') });
  assert.equal(sealed.state, 'EFFECT_INTENT_SEALED');
  assert.equal(sealed.fresh_authority_required, true);
  assert.equal(sealed.authority_effect, false);
  assert.equal(sealed.actuation_eligible, false);

  const journalBeforeCommit = await fs.readFile(f.journalPath, 'utf8');
  assert.match(journalBeforeCommit, /EFFECT_INTENT_SEALED/);
  assert.doesNotMatch(journalBeforeCommit, /super-secret-never-store/);

  await f.store.commitEffect({ actionId: 'act.one', effectReceiptDigest: d('effect-observed') });
  const reopened = await DurableActionGraphStore.open(f);
  const snap = reopened.snapshot();
  assert.equal(snap.event_count, 3);
  assert.equal(snap.actions[0].state, 'COMMITTED');
  assert.equal(snap.authority_effect, false);
  assert.equal(snap.actuation_eligible, false);
});

test('ambiguous effect is terminal and cannot be retried, committed, or aborted', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.amb', actionKind: 'CLICK', intentDigest: d('amb-intent'), namespace: ns() });
  await f.store.sealEffectIntent({ actionId: 'act.amb', preEffectEvidenceDigest: d('amb-pre') });
  await f.store.markAmbiguous({ actionId: 'act.amb', uncertaintyDigest: d('transport-cut-after-effect') });
  await expectCode(f.store.sealEffectIntent({ actionId: 'act.amb', preEffectEvidenceDigest: d('again') }), 'action_graph_effect_intent_state_invalid');
  await expectCode(f.store.commitEffect({ actionId: 'act.amb', effectReceiptDigest: d('late') }), 'action_graph_effect_resolution_state_invalid');
  await expectCode(f.store.abortAction({ actionId: 'act.amb', reasonCode: 'CANCELLED' }), 'action_graph_abort_after_effect_intent_forbidden');
  assert.equal(f.store.snapshot().actions[0].state, 'AMBIGUOUS');
});

test('causal dependency must exist and be committed before child effect intent can seal', async (t) => {
  const f = await fixture(t);
  await expectCode(f.store.declareAction({ actionId: 'act.child', actionKind: 'CLICK', intentDigest: d('child'), namespace: ns(), dependsOn: ['act.parent'] }), 'action_graph_dependency_missing');
  await f.store.declareAction({ actionId: 'act.parent', actionKind: 'FOCUS', intentDigest: d('parent'), namespace: ns() });
  await f.store.declareAction({ actionId: 'act.child', actionKind: 'CLICK', intentDigest: d('child'), namespace: ns('doc:2'), dependsOn: ['act.parent'] });
  await expectCode(f.store.sealEffectIntent({ actionId: 'act.child', preEffectEvidenceDigest: d('child-pre') }), 'action_graph_dependency_not_committed');
  await f.store.sealEffectIntent({ actionId: 'act.parent', preEffectEvidenceDigest: d('parent-pre') });
  await f.store.commitEffect({ actionId: 'act.parent', effectReceiptDigest: d('parent-done') });
  const receipt = await f.store.sealEffectIntent({ actionId: 'act.child', preEffectEvidenceDigest: d('child-pre') });
  assert.equal(receipt.state, 'EFFECT_INTENT_SEALED');
});

test('abort is allowed only before durable effect intent', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.cancel', actionKind: 'PRESS', intentDigest: d('cancel'), namespace: ns() });
  await f.store.abortAction({ actionId: 'act.cancel', reasonCode: 'USER_CANCELLED' });
  assert.equal(f.store.snapshot().actions[0].state, 'ABORTED');
  await expectCode(f.store.sealEffectIntent({ actionId: 'act.cancel', preEffectEvidenceDigest: d('nope') }), 'action_graph_effect_intent_state_invalid');
});

test('duplicate ids, self-dependencies, and duplicate dependencies fail closed', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.base', actionKind: 'CLICK', intentDigest: d('base'), namespace: ns() });
  await expectCode(f.store.declareAction({ actionId: 'act.base', actionKind: 'CLICK', intentDigest: d('dup'), namespace: ns() }), 'action_graph_action_id_exists');
  await expectCode(f.store.declareAction({ actionId: 'act.self', actionKind: 'CLICK', intentDigest: d('self'), namespace: ns(), dependsOn: ['act.self'] }), 'action_graph_self_dependency');
  await expectCode(f.store.declareAction({ actionId: 'act.dupdep', actionKind: 'CLICK', intentDigest: d('dupdep'), namespace: ns(), dependsOn: ['act.base', 'act.base'] }), 'action_graph_dependency_duplicate');
});

test('concurrent mutations serialize into one monotonic hash chain', async (t) => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 32 }, (_, i) => f.store.declareAction({
    actionId: `act.c${String(i).padStart(2, '0')}`,
    actionKind: 'CLICK', intentDigest: d(`c-${i}`), namespace: ns(),
  })));
  const lines = (await fs.readFile(f.journalPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines.length, 32);
  for (let i = 0; i < lines.length; i += 1) {
    assert.equal(lines[i].seq, i + 1);
    if (i > 0) assert.equal(lines[i].prev_hash, lines[i - 1].event_hash);
  }
});

test('tampered journal content fails hash verification on restart', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.tamper', actionKind: 'CLICK', intentDigest: d('tamper'), namespace: ns() });
  const text = await fs.readFile(f.journalPath, 'utf8');
  await fs.writeFile(f.journalPath, text.replace('CLICK', 'FOCUS'));
  await expectCode(DurableActionGraphStore.open(f), 'action_graph_event_hash_mismatch');
});

test('truncated journal fails closed rather than replaying a partial event', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.trunc', actionKind: 'CLICK', intentDigest: d('trunc'), namespace: ns() });
  const text = await fs.readFile(f.journalPath, 'utf8');
  await fs.writeFile(f.journalPath, text.slice(0, -5));
  await expectCode(DurableActionGraphStore.open(f), 'action_graph_journal_truncated');
});

test('stale head after fsynced journal is repaired from a fully valid hash-chain suffix', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.recover', actionKind: 'CLICK', intentDigest: d('recover'), namespace: ns() });
  const firstHead = JSON.parse(await fs.readFile(f.headPath, 'utf8'));
  await f.store.sealEffectIntent({ actionId: 'act.recover', preEffectEvidenceDigest: d('recover-pre') });
  await fs.writeFile(f.headPath, `${JSON.stringify(firstHead)}\n`);
  const reopened = await DurableActionGraphStore.open(f);
  assert.equal(reopened.snapshot().event_count, 2);
  assert.equal(JSON.parse(await fs.readFile(f.headPath, 'utf8')).seq, 2);
});

test('head that claims history beyond durable journal fails closed', async (t) => {
  const f = await fixture(t);
  await f.store.declareAction({ actionId: 'act.head', actionKind: 'CLICK', intentDigest: d('head'), namespace: ns() });
  const head = JSON.parse(await fs.readFile(f.headPath, 'utf8'));
  head.seq = 2;
  await fs.writeFile(f.headPath, `${JSON.stringify(head)}\n`);
  await expectCode(DurableActionGraphStore.open(f), 'action_graph_head_sequence_invalid');
});

test('symlinked journal is rejected instead of following ambient filesystem authority', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t, 'graph.link');
  const other = path.join(f.dir, 'other');
  await fs.writeFile(other, '');
  await fs.rm(f.journalPath, { force: true });
  await fs.symlink(other, f.journalPath);
  await assert.rejects(DurableActionGraphStore.open(f));
});

test('pure state receipts never grant actuation authority', () => {
  const state = new ActionGraphState('graph.pure');
  const declared = state.prepareDeclared({ actionId: 'act.pure', actionKind: 'CLICK', intentDigest: d('pure'), namespace: ns() });
  const receipt = state.acceptPrepared(declared);
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.actuation_eligible, false);
  const seal = state.prepareSeal({ actionId: 'act.pure', preEffectEvidenceDigest: d('fresh') });
  const sealed = state.acceptPrepared(seal);
  assert.equal(sealed.fresh_authority_required, true);
  assert.equal(sealed.actuation_eligible, false);
});
