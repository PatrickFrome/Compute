import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPartiallyAppliedRolloverTranscript } from '../src/supervisor-rollover-transcript-proof.mjs';

const previous = 'https://chatgpt.com/c/6a92f23a-0ef8-83e9-a43b-24cf85a7f5ab';
const successor = 'https://chatgpt.com/c/6a9c12d6-04cc-83e9-9adb-4aca80a77e7e';
const attempt = 'rollover_18cccc71-9373-4c5d-a172-bfa50eec1aac';
const keepalive = {
  state: 'ROLLOVER_AMBIGUOUS',
  supervisor_epoch: 2,
  cycle_seq: 0,
  conversation_url: previous,
  rollover_attempt: null,
  rollover_reason: 'ROLLOVER_ERROR:keepalive_supervisor_conversation_invalid',
};

function transcript({ epoch = 2, prior = previous, id = attempt } = {}) {
  return [
    'prefix text',
    'METAENGINE_SUPERVISOR_ROLLOVER_V1',
    'supervisor_id=METAENGINE_SUPERVISOR',
    `supervisor_epoch=${epoch}`,
    `previous_conversation=${prior}`,
    `rollover_attempt_id=${id}`,
    'integration_line=integration/metaengine-development-os-v1',
    'legacy_convergence_line=integration/compute-unified-v1',
    '',
    'continuation text',
  ].join('\n');
}

test('matches the exact live partial-bind rollover transcript without trusting prose', () => {
  const proof = matchPartiallyAppliedRolloverTranscript({
    keepalive,
    frame: { url: successor, text_excerpt: transcript() },
  });
  assert.equal(proof.matched, true);
  assert.equal(proof.rollover_attempt_id, attempt);
  assert.equal(proof.supervisor_epoch, 2);
  assert.equal(proof.previous_conversation, previous);
  assert.equal(proof.successor_conversation, successor);
  assert.equal(proof.authority_effect, false);
});

test('fails closed on mismatched epoch, predecessor, corruption reason, or duplicate proof', () => {
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive,
    frame: { url: successor, text_excerpt: transcript({ epoch: 3 }) },
  }).matched, false);
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive,
    frame: { url: successor, text_excerpt: transcript({ prior: 'https://chatgpt.com/c/other' }) },
  }).matched, false);
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive: { ...keepalive, rollover_reason: 'ROLLOVER_WITHOUT_POSITIVE_READBACK' },
    frame: { url: successor, text_excerpt: transcript() },
  }).matched, false);
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive,
    frame: { url: successor, text_excerpt: `${transcript()}\n${transcript()}` },
  }).matched, false);
});

test('does not match the predecessor tab or a state that still has a durable attempt', () => {
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive,
    frame: { url: previous, text_excerpt: transcript() },
  }).matched, false);
  assert.equal(matchPartiallyAppliedRolloverTranscript({
    keepalive: { ...keepalive, rollover_attempt: { attempt_id: attempt } },
    frame: { url: successor, text_excerpt: transcript() },
  }).matched, false);
});
