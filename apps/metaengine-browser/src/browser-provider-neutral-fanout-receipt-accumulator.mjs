import { normalizeProviderNeutralFanoutReceipt } from './browser-provider-neutral-fanout-receipts.mjs';

const MAX_FANOUT = 128;
const OUTCOMES = Object.freeze(['APPLIED', 'REJECTED', 'AMBIGUOUS', 'BLOCKED']);

function requiredString(value, name, max = 160) {
  const out = String(value ?? '').slice(0, max).trim();
  if (!out) throw new Error(`fanout_accumulator_${name}_required`);
  return out;
}

function expectedCount(value) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > MAX_FANOUT) {
    throw new Error('fanout_accumulator_expected_count_invalid');
  }
  return out;
}

function bitmapHex(received, count) {
  const bytes = Buffer.alloc(Math.ceil(count / 8));
  for (const index of received.keys()) bytes[index >> 3] |= 1 << (index & 7);
  return bytes.toString('hex');
}

export class ProviderNeutralFanoutReceiptAccumulator {
  #actionId;
  #actionDigest;
  #expectedCount;
  #received = new Map();
  #counts = { APPLIED: 0, REJECTED: 0, AMBIGUOUS: 0, BLOCKED: 0 };

  constructor({ actionId, actionDigest, expectedCount: count } = {}) {
    this.#actionId = requiredString(actionId, 'action_id');
    this.#actionDigest = requiredString(actionDigest, 'action_digest', 64);
    this.#expectedCount = expectedCount(count);
  }

  accept(rawReceipt) {
    const receipt = normalizeProviderNeutralFanoutReceipt(rawReceipt);
    if (receipt.action_id !== this.#actionId || receipt.action_digest !== this.#actionDigest) {
      throw new Error('fanout_accumulator_action_mismatch');
    }
    if (receipt.fanout_index >= this.#expectedCount) {
      throw new Error('fanout_accumulator_index_out_of_range');
    }

    const prior = this.#received.get(receipt.fanout_index);
    if (prior) {
      if (prior.receipt_digest !== receipt.receipt_digest) {
        throw new Error('fanout_accumulator_receipt_collision');
      }
      return Object.freeze({ accepted: false, duplicate: true, complete: this.complete });
    }

    this.#received.set(receipt.fanout_index, receipt);
    this.#counts[receipt.outcome] += 1;
    return Object.freeze({ accepted: true, duplicate: false, complete: this.complete });
  }

  get complete() {
    return this.#received.size === this.#expectedCount;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser.provider-neutral-fanout-receipt-accumulator.v1',
      action_id: this.#actionId,
      action_digest: this.#actionDigest,
      expected_count: this.#expectedCount,
      received_count: this.#received.size,
      pending_count: this.#expectedCount - this.#received.size,
      complete: this.complete,
      received_bitmap_hex: bitmapHex(this.#received, this.#expectedCount),
      counts: Object.freeze({ ...this.#counts }),
      payload_persisted: false,
      receipt_payload_persisted: false,
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
}

export function providerNeutralFanoutReceiptAccumulatorContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-receipt-accumulator-contract.v1',
    max_fanout: MAX_FANOUT,
    supported_outcomes: OUTCOMES,
    incremental_accept_complexity: 'O(1)',
    bounded_memory: true,
    compact_received_bitmap: true,
    payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}
