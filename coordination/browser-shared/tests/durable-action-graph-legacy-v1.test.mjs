import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACTION_GRAPH_LEGACY_VERSION,
  ACTION_GRAPH_VERSION,
  ACTION_GRAPH_ZERO_HASH,
  digestActionGraphEvidence,
} from '../durable-action-graph-core-v1.mjs';
import { DurableActionGraphStore } from '../durable-action-graph-store-v1.mjs';

const d = (label) => digestActionGraphEvidence({ label });

test('R8B reader replays R8A v1.0 events and upgrades only the compact head receipt', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r8b-legacy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const journalPath = path.join(dir, 'graph.jsonl');
  const headPath = `${journalPath}.head.json`;
  const body = {
    version: ACTION_GRAPH_LEGACY_VERSION,
    graph_id: 'graph.legacy',
    seq: 1,
    event_type: 'ACTION_DECLARED',
    action_id: 'act.legacy',
    prev_hash: ACTION_GRAPH_ZERO_HASH,
    action_kind: 'CLICK',
    intent_digest: d('legacy-intent'),
    namespace: {
      target_id: 'tgt.legacy', context_id: 'ctx.legacy',
      conversation_epoch: 'conv:legacy', document_epoch: 'doc:legacy',
    },
    depends_on: [],
  };
  const event = { ...body, event_hash: digestActionGraphEvidence(body) };
  await fs.writeFile(journalPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  await fs.writeFile(headPath, `${JSON.stringify({
    version: ACTION_GRAPH_LEGACY_VERSION,
    graph_id: 'graph.legacy',
    seq: 1,
    event_hash: event.event_hash,
  })}\n`, { mode: 0o600 });

  const store = await DurableActionGraphStore.open({ graphId: 'graph.legacy', journalPath, headPath });
  assert.equal(store.snapshot().actions[0].state, 'DECLARED');
  const upgradedHead = JSON.parse(await fs.readFile(headPath, 'utf8'));
  assert.equal(upgradedHead.version, ACTION_GRAPH_VERSION);
  assert.equal(upgradedHead.event_hash, event.event_hash);

  await store.sealEffectIntent({ actionId: 'act.legacy', preEffectEvidenceDigest: d('legacy-fresh') });
  const lines = (await fs.readFile(journalPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines[0].version, ACTION_GRAPH_LEGACY_VERSION);
  assert.equal(lines[1].version, ACTION_GRAPH_VERSION);
  const reopened = await DurableActionGraphStore.open({ graphId: 'graph.legacy', journalPath, headPath });
  assert.equal(reopened.snapshot().actions[0].state, 'EFFECT_INTENT_SEALED');
});
