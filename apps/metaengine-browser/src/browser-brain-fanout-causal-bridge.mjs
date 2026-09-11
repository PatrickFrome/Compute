import { BrowserBrainStreamClock } from './browser-brain-stream-clock.mjs';

const PROGRESS_SCHEMA = 'metaengine.browser.provider-neutral-fanout-progress.v1';
const ACTION_DIGEST_RE = /^[a-f0-9]{64}$/i;

function sourceFor(event) {
  const digest = String(event?.action_digest || '').trim().toLowerCase();
  if (!ACTION_DIGEST_RE.test(digest)) {
    throw new TypeError('browser_brain_fanout_causal_action_digest_invalid');
  }
  return `fanout:${digest.slice(0, 48)}`;
}

function validateProgressEvent(event) {
  if (!event || event.schema !== PROGRESS_SCHEMA) {
    throw new TypeError('browser_brain_fanout_causal_progress_schema_invalid');
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new TypeError('browser_brain_fanout_causal_progress_sequence_invalid');
  }
  if (!Number.isSafeInteger(event.received_count) || event.received_count < 1) {
    throw new TypeError('browser_brain_fanout_causal_received_count_invalid');
  }
  if (!Number.isSafeInteger(event.pending_count) || event.pending_count < 0) {
    throw new TypeError('browser_brain_fanout_causal_pending_count_invalid');
  }
  return sourceFor(event);
}

export class BrowserBrainFanoutCausalBridge {
  #clock;

  constructor({ clock = new BrowserBrainStreamClock({ maxSources: 128 }) } = {}) {
    if (!clock || typeof clock.observe !== 'function' || typeof clock.snapshot !== 'function') {
      throw new TypeError('browser_brain_fanout_causal_clock_invalid');
    }
    this.#clock = clock;
  }

  observe(progressEvent) {
    const source = validateProgressEvent(progressEvent);
    const causal = this.#clock.observe(source, progressEvent.sequence);
    if (!causal.accepted || causal.disposition !== 'APPLIED') {
      return Object.freeze({
        accepted: causal.accepted,
        disposition: causal.disposition,
        brain_epoch: causal.epoch,
        source,
        progress: null,
        resync_required: Boolean(causal.source?.resync_required),
        authority_effect: false,
      });
    }

    return Object.freeze({
      accepted: true,
      disposition: 'APPLIED',
      brain_epoch: causal.epoch,
      source,
      resync_required: false,
      progress: Object.freeze({
        action_id: progressEvent.action_id,
        action_digest: progressEvent.action_digest,
        fanout_index: progressEvent.fanout_index,
        target_binding_digest: progressEvent.target_binding_digest,
        effect_proof_digest: progressEvent.effect_proof_digest,
        outcome: progressEvent.outcome,
        received_count: progressEvent.received_count,
        pending_count: progressEvent.pending_count,
        complete: Boolean(progressEvent.complete),
      }),
      authority_effect: false,
    });
  }

  snapshot() {
    return this.#clock.snapshot();
  }
}

export function browserBrainFanoutCausalBridgeContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.fanout-causal-bridge-contract.v1',
    input_schema: PROGRESS_SCHEMA,
    causal_source_per_action_digest: true,
    max_fanout_sources: 128,
    payload_persisted: false,
    gap_requires_canonical_resync: true,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    dedicated_timer: false,
    authority_effect: false,
  });
}
