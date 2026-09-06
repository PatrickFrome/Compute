import { ProviderNeutralFanoutReceiptAccumulator } from './browser-provider-neutral-fanout-receipt-accumulator.mjs';
import { normalizeProviderNeutralFanoutReceipt } from './browser-provider-neutral-fanout-receipts.mjs';

const MAX_FANOUT = 128;

export class ProviderNeutralFanoutProgressStream {
  #accumulator;
  #sequence = 0;

  constructor({ actionId, actionDigest, expectedCount } = {}) {
    this.#accumulator = new ProviderNeutralFanoutReceiptAccumulator({
      actionId,
      actionDigest,
      expectedCount,
    });
  }

  accept(rawReceipt) {
    const receipt = normalizeProviderNeutralFanoutReceipt(rawReceipt);
    const accepted = this.#accumulator.accept(receipt);
    if (!accepted.accepted) {
      return Object.freeze({
        accepted: false,
        duplicate: true,
        progress_event: null,
        complete: accepted.complete,
      });
    }

    this.#sequence += 1;
    const snapshot = this.#accumulator.snapshot();
    return Object.freeze({
      accepted: true,
      duplicate: false,
      complete: snapshot.complete,
      progress_event: Object.freeze({
        schema: 'metaengine.browser.provider-neutral-fanout-progress.v1',
        sequence: this.#sequence,
        action_id: snapshot.action_id,
        action_digest: snapshot.action_digest,
        fanout_index: receipt.fanout_index,
        target_binding_digest: receipt.target_binding_digest,
        outcome: receipt.outcome,
        effect_proof_digest: receipt.effect_proof_digest,
        received_count: snapshot.received_count,
        pending_count: snapshot.pending_count,
        counts: snapshot.counts,
        complete: snapshot.complete,
        payload_persisted: false,
        retry_candidates: Object.freeze([]),
        scheduler_authority: false,
        dispatch_authority: false,
        lease_authority: false,
        effect_execution_authority: false,
        automatic_retry_allowed: false,
        ambiguous_retry_allowed: false,
        authority_effect: false,
      }),
    });
  }

  snapshot() {
    const snapshot = this.#accumulator.snapshot();
    return Object.freeze({ ...snapshot, progress_sequence: this.#sequence });
  }
}

export function providerNeutralFanoutProgressStreamContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-progress-contract.v1',
    max_fanout: MAX_FANOUT,
    one_event_per_new_receipt: true,
    duplicate_event_suppression: true,
    monotonic_sequence: true,
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
