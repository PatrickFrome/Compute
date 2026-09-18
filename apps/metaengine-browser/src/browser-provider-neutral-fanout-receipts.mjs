import crypto from 'node:crypto';
import { fanoutProviderNeutralAction } from './browser-provider-neutral-action.mjs';

const MAX_BATCH = 64;
const OUTCOMES = new Set(['APPLIED', 'REJECTED', 'AMBIGUOUS', 'BLOCKED']);
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function positiveInt(value, name, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`fanout_receipt_${name}_invalid`);
  return out;
}

function requiredString(value, name, max = 240) {
  const out = String(value ?? '').slice(0, max).trim();
  if (!out) throw new Error(`fanout_receipt_${name}_required`);
  return out;
}

export function partitionProviderNeutralFanout(actionInput, targetBindings, { batchSize = 32 } = {}) {
  const size = positiveInt(batchSize, 'batch_size', MAX_BATCH);
  const items = fanoutProviderNeutralAction(actionInput, targetBindings);
  const batches = [];
  for (let offset = 0; offset < items.length; offset += size) {
    const slice = items.slice(offset, offset + size);
    batches.push(Object.freeze({
      schema: 'metaengine.browser.provider-neutral-fanout-batch.v1',
      action_id: slice[0].action_id,
      action_digest: slice[0].action_digest,
      batch_index: batches.length,
      first_fanout_index: slice[0].fanout_index,
      last_fanout_index: slice[slice.length - 1].fanout_index,
      items: Object.freeze(slice),
      dispatch_authority: false,
      scheduler_authority: false,
      automatic_retry_allowed: false,
    }));
  }
  return Object.freeze(batches);
}

export function normalizeProviderNeutralFanoutReceipt(input = {}) {
  const outcome = requiredString(input.outcome, 'outcome', 40).toUpperCase();
  if (!OUTCOMES.has(outcome)) throw new Error('fanout_receipt_outcome_unsupported');
  const receipt = {
    schema: 'metaengine.browser.provider-neutral-fanout-receipt.v1',
    action_id: requiredString(input.action_id, 'action_id', 160),
    action_digest: requiredString(input.action_digest, 'action_digest', 64),
    fanout_index: positiveInt(Number(input.fanout_index) + 1, 'fanout_index') - 1,
    target_binding_digest: requiredString(input.target_binding_digest, 'target_binding_digest', 64),
    outcome,
    effect_proof_digest: input.effect_proof_digest ? requiredString(input.effect_proof_digest, 'effect_proof_digest', 64) : null,
    payload_persisted: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  };
  receipt.receipt_digest = sha256(JSON.stringify(receipt));
  return Object.freeze(receipt);
}

export function reduceProviderNeutralFanoutReceipts({ actionId, actionDigest, expectedCount, receipts = [] } = {}) {
  const action_id = requiredString(actionId, 'action_id', 160);
  const action_digest = requiredString(actionDigest, 'action_digest', 64);
  const expected_count = positiveInt(expectedCount, 'expected_count', 128);
  const byIndex = new Map();
  for (const raw of receipts) {
    const receipt = normalizeProviderNeutralFanoutReceipt(raw);
    if (receipt.action_id !== action_id || receipt.action_digest !== action_digest) {
      throw new Error('fanout_receipt_action_mismatch');
    }
    if (receipt.fanout_index >= expected_count) throw new Error('fanout_receipt_index_out_of_range');
    const prior = byIndex.get(receipt.fanout_index);
    if (prior && prior.receipt_digest !== receipt.receipt_digest) throw new Error('fanout_receipt_collision');
    byIndex.set(receipt.fanout_index, prior || receipt);
  }
  const counts = { APPLIED: 0, REJECTED: 0, AMBIGUOUS: 0, BLOCKED: 0 };
  for (const receipt of byIndex.values()) counts[receipt.outcome] += 1;
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-receipt-summary.v1',
    action_id,
    action_digest,
    expected_count,
    received_count: byIndex.size,
    pending_count: expected_count - byIndex.size,
    complete: byIndex.size === expected_count,
    counts: Object.freeze(counts),
    retry_candidates: Object.freeze([]),
    payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}

export function providerNeutralFanoutReceiptSnapshot() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-receipt-contract.v1',
    max_batch_size: MAX_BATCH,
    supported_outcomes: Object.freeze([...OUTCOMES]),
    deterministic_partitioning: true,
    durable_payload_persistence: false,
    scheduler_authority: false,
    dispatch_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}
