import crypto from 'node:crypto';
import { ProviderNeutralFanoutReceiptAccumulator } from './browser-provider-neutral-fanout-receipt-accumulator.mjs';
import { normalizeProviderNeutralFanoutReceipt } from './browser-provider-neutral-fanout-receipts.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-durable-checkpoint.v1';
const MAX_FANOUT = 128;
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function requiredString(value, name, max = 160) {
  const out = String(value ?? '').slice(0, max).trim();
  if (!out) throw new Error(`fanout_checkpoint_${name}_required`);
  return out;
}

function expectedCount(value) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > MAX_FANOUT) {
    throw new Error('fanout_checkpoint_expected_count_invalid');
  }
  return out;
}

function coreCheckpoint(actionId, actionDigest, count, receipts) {
  return {
    schema: SCHEMA,
    action_id: actionId,
    action_digest: actionDigest,
    expected_count: count,
    receipts,
  };
}

function receiptProjection(receipt) {
  return Object.freeze({
    fanout_index: receipt.fanout_index,
    target_binding_digest: receipt.target_binding_digest,
    outcome: receipt.outcome,
    effect_proof_digest: receipt.effect_proof_digest,
    receipt_digest: receipt.receipt_digest,
  });
}

export class ProviderNeutralFanoutDurableCheckpoint {
  #actionId;
  #actionDigest;
  #expectedCount;
  #accumulator;
  #receipts = new Map();

  constructor({ actionId, actionDigest, expectedCount: count } = {}) {
    this.#actionId = requiredString(actionId, 'action_id');
    this.#actionDigest = requiredString(actionDigest, 'action_digest', 64);
    this.#expectedCount = expectedCount(count);
    this.#accumulator = new ProviderNeutralFanoutReceiptAccumulator({
      actionId: this.#actionId,
      actionDigest: this.#actionDigest,
      expectedCount: this.#expectedCount,
    });
  }

  accept(rawReceipt) {
    const receipt = normalizeProviderNeutralFanoutReceipt(rawReceipt);
    const accepted = this.#accumulator.accept(receipt);
    if (accepted.accepted) this.#receipts.set(receipt.fanout_index, receiptProjection(receipt));
    return accepted;
  }

  checkpoint() {
    const receipts = Object.freeze([...this.#receipts.values()].sort((a, b) => a.fanout_index - b.fanout_index));
    const core = coreCheckpoint(this.#actionId, this.#actionDigest, this.#expectedCount, receipts);
    const snapshot = this.#accumulator.snapshot();
    return Object.freeze({
      ...core,
      checkpoint_digest: sha256(JSON.stringify(core)),
      received_count: snapshot.received_count,
      pending_count: snapshot.pending_count,
      complete: snapshot.complete,
      counts: snapshot.counts,
      payload_persisted: false,
      semantic_payload_persisted: false,
      retry_candidates: Object.freeze([]),
      scheduler_authority: false,
      dispatch_authority: false,
      lease_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
      ambiguous_retry_allowed: false,
      authority_effect: false,
    });
  }

  snapshot() {
    return this.#accumulator.snapshot();
  }
}

export function restoreProviderNeutralFanoutDurableCheckpoint(input = {}) {
  if (input.schema !== SCHEMA) throw new Error('fanout_checkpoint_schema_invalid');
  const actionId = requiredString(input.action_id, 'action_id');
  const actionDigest = requiredString(input.action_digest, 'action_digest', 64);
  const count = expectedCount(input.expected_count);
  if (!Array.isArray(input.receipts) || input.receipts.length > count) {
    throw new Error('fanout_checkpoint_receipts_invalid');
  }

  const normalized = [];
  const seen = new Set();
  for (const saved of input.receipts) {
    const receipt = normalizeProviderNeutralFanoutReceipt({
      action_id: actionId,
      action_digest: actionDigest,
      fanout_index: saved.fanout_index,
      target_binding_digest: saved.target_binding_digest,
      outcome: saved.outcome,
      effect_proof_digest: saved.effect_proof_digest,
    });
    if (receipt.fanout_index >= count) throw new Error('fanout_checkpoint_index_out_of_range');
    if (seen.has(receipt.fanout_index)) throw new Error('fanout_checkpoint_duplicate_index');
    if (receipt.receipt_digest !== saved.receipt_digest) throw new Error('fanout_checkpoint_receipt_digest_mismatch');
    seen.add(receipt.fanout_index);
    normalized.push(receipt);
  }

  const projections = Object.freeze(normalized
    .map(receiptProjection)
    .sort((a, b) => a.fanout_index - b.fanout_index));
  const core = coreCheckpoint(actionId, actionDigest, count, projections);
  if (sha256(JSON.stringify(core)) !== requiredString(input.checkpoint_digest, 'checkpoint_digest', 64)) {
    throw new Error('fanout_checkpoint_digest_mismatch');
  }

  const restored = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: count });
  for (const receipt of normalized) restored.accept(receipt);
  return restored;
}

export function providerNeutralFanoutDurableCheckpointContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-durable-checkpoint-contract.v1',
    max_fanout: MAX_FANOUT,
    deterministic_checkpoint_digest: true,
    restart_restore_supported: true,
    receipt_collision_fence_preserved: true,
    payload_persisted: false,
    semantic_payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}
