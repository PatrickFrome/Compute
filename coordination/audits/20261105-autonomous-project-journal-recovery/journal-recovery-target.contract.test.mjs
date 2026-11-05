// Source-only target-facing tests, intentionally SKIP until an adapter to the
// verified c265 + e30 snapshot is supplied. No production code is imported by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve, isAbsolute} from 'node:path';
import {stat} from 'node:fs/promises';
import {withFixtureRoot, truncateFixture} from './fixture-tools.mjs';

const EXPECTED_TREE = '90fa5633d7926dd71a7303266073e0625325e740';
const adapterFile = process.env.METAENGINE_JOURNAL_INERT_ADAPTER;
const verifiedTree = process.env.METAENGINE_JOURNAL_VERIFIED_TREE;
const active = Boolean(adapterFile) && verifiedTree === EXPECTED_TREE;
const skipReason = 'NOT RUN: verified reconstructed tree + real journal adapter not available';

async function harness(t) {
  if (!isAbsolute(adapterFile)) throw new Error('adapter path must be absolute');
  const adapter = await import(pathToFileURL(resolve(adapterFile)).href);
  if (typeof adapter.createInertJournalHarness !== 'function') {
    throw new Error('adapter must export createInertJournalHarness');
  }
  return adapter.createInertJournalHarness;
}

async function scenarioRunner(t, fixture, perturb, checks) {
  const factory = await harness(t);
  await withFixtureRoot(async root => {
    const externalEffectAttempts = [];
    const h = await factory({root, onExternalEffect: event => {
      externalEffectAttempts.push(event);
      throw new Error('target tried to emit forbidden external effect');
    }});
    // The adapter must seed ONLY through genuine journal APIs and inert fixtures.
    await h.seed(fixture);
    if (perturb) await perturb(h, root);
    const s = await h.restartAndInspect();
    assert.equal(s.newEffectAuthority, false, 'checkpoint is never a permit');
    assert.deepEqual(externalEffectAttempts, [], 'restart must not emit effects');
    await checks(s, h);
    if (typeof h.close === 'function') await h.close();
  });
}

function targetTest(name, fixture, perturb, checks) {
  test(name, {skip: !active && skipReason}, async t => scenarioRunner(t, fixture, perturb, checks));
}

targetTest('target: confirmed delivery survives restart; no re-delivery',
  'confirmed-delivery', null, async s => {
    assert.deepEqual(s.confirmedDeliveryIds, ['delivery-1']);
    assert.deepEqual(s.completedReplyIds, []);
  });

targetTest('target: an unfinished assistant reply remains pending across restart',
  'confirmed-delivery-pending-reply', null, async s => {
    assert.deepEqual(s.confirmedDeliveryIds, ['delivery-1']);
    assert.deepEqual(s.pendingReplyIds, ['reply-1']);
    assert.deepEqual(s.completedReplyIds, []);
  });

targetTest('target: truncated final pending record cannot become complete',
  'confirmed-delivery-pending-reply', async (h, root) => {
    const {journalFile} = await h.inspectStorage();
    const size = (await stat(journalFile)).size;
    assert.ok(size > 1);
    await truncateFixture(root, journalFile, size - 1);
  }, async s => {
    assert.ok(s.confirmedDeliveryIds.includes('delivery-1'), 'durable earlier record preserved');
    assert.ok(!s.completedReplyIds.includes('reply-1'), 'torn tail not upgraded to complete');
    assert.ok(['HOLD','DEGRADED'].includes(s.recoveryStatus), 'tail corruption remains visible');
  });

targetTest('target: truncating a delivery ACK removes proof of that ACK',
  'pending-delivery-ack-last', async (h, root) => {
    const {journalFile} = await h.inspectStorage();
    const size = (await stat(journalFile)).size;
    assert.ok(size > 1);
    await truncateFixture(root, journalFile, size - 1);
  }, async s => {
    assert.ok(!s.confirmedDeliveryIds.includes('delivery-1'));
    assert.ok(['HOLD','DEGRADED'].includes(s.recoveryStatus));
  });

targetTest('target: old legacy incomplete journal is not silently repaired into success',
  'legacy-incomplete', null, async s => {
    assert.ok(['HOLD','DEGRADED'].includes(s.recoveryStatus));
    assert.deepEqual(s.completedReplyIds, []);
  });

targetTest('target: unknown external effect remains unknown through restart',
  'effect-unknown', null, async s => {
    assert.deepEqual(s.unknownEffectIds, ['effect-1']);
    assert.deepEqual(s.completedReplyIds, []);
  });

targetTest('target: an ENOSPC/torn write cannot acknowledge new checkpoint',
  'confirmed-delivery', async (h) => {
    await h.injectAppendFault({code: 'ENOSPC', partialBytes: 2});
    const result = await Promise.resolve().then(() => h.appendCheckpoint('checkpoint-2'))
      .then(value => ({value}), error => ({error}));
    assert.ok(result.error || result.value?.ok === false, 'append may not claim success after ENOSPC');
  }, async s => {
    assert.deepEqual(s.confirmedDeliveryIds, ['delivery-1']);
    assert.ok(!s.durableCheckpointIds.includes('checkpoint-2'));
  });

targetTest('target: no new effect or duplicate ACK emitted after ambiguous restart',
  'effect-unknown-unfinished-reply', null, async s => {
    assert.deepEqual(s.unknownEffectIds, ['effect-1']);
    assert.deepEqual(s.pendingReplyIds, ['reply-1']);
    assert.ok(!s.completedReplyIds.includes('reply-1'));
  });
