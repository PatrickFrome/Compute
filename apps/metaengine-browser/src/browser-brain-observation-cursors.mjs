const CONSUMER_RE = /^[a-z][a-z0-9_.:-]{0,95}$/i;
const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function normalizeDigest(value, code) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(code);
  return digest;
}

function normalizeEpoch(value, code) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError(code);
  return epoch;
}

export class BrowserBrainObservationCursorLedger {
  #capacity;
  #cursors = new Map();

  constructor({ capacity = 64 } = {}) {
    const bounded = Number(capacity);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 256) {
      throw new TypeError('browser_brain_cursor_capacity_invalid');
    }
    this.#capacity = bounded;
  }

  checkpoint(input) {
    if (!input || typeof input !== 'object') throw new TypeError('browser_brain_cursor_invalid');
    const consumer = String(input.consumer || '').trim();
    if (!CONSUMER_RE.test(consumer)) throw new TypeError('browser_brain_cursor_consumer_invalid');
    const epoch = normalizeEpoch(input.epoch, 'browser_brain_cursor_epoch_invalid');
    const observationDigest = normalizeDigest(input.observation_digest, 'browser_brain_cursor_digest_invalid');
    const existing = this.#cursors.get(consumer);

    if (!existing && this.#cursors.size >= this.#capacity) {
      throw new Error('browser_brain_cursor_capacity_exceeded');
    }
    if (existing && epoch < existing.epoch) {
      return Object.freeze({ accepted: false, disposition: 'REGRESSION', consumer, epoch: existing.epoch, ...ZERO_AUTHORITY });
    }
    if (existing && epoch === existing.epoch) {
      if (existing.observation_digest !== observationDigest) {
        throw new Error('browser_brain_cursor_epoch_collision');
      }
      return Object.freeze({ accepted: true, disposition: 'DUPLICATE', consumer, epoch, ...ZERO_AUTHORITY });
    }

    this.#cursors.set(consumer, Object.freeze({ consumer, epoch, observation_digest: observationDigest }));
    return Object.freeze({ accepted: true, disposition: 'APPLIED', consumer, epoch, ...ZERO_AUTHORITY });
  }

  get(consumerValue) {
    const consumer = String(consumerValue || '').trim();
    if (!CONSUMER_RE.test(consumer)) throw new TypeError('browser_brain_cursor_consumer_invalid');
    return this.#cursors.get(consumer) || null;
  }

  resumeFrom(consumerValue) {
    const cursor = this.get(consumerValue);
    return Object.freeze({
      schema: 'metaengine.browser-brain.observation-resume.v1',
      consumer: String(consumerValue).trim(),
      from_epoch: cursor?.epoch ?? 0,
      canonical_resync_required: false,
      payload_persisted: false,
      ...ZERO_AUTHORITY,
    });
  }

  snapshot() {
    const cursors = [...this.#cursors.values()].sort((a, b) => a.consumer.localeCompare(b.consumer));
    return Object.freeze({
      schema: 'metaengine.browser-brain.observation-cursor-ledger.v1',
      capacity: this.#capacity,
      consumer_count: cursors.length,
      cursors: Object.freeze(cursors),
      payload_persisted: false,
      durable_checkpoint_only: true,
      ...ZERO_AUTHORITY,
    });
  }
}

export function browserBrainObservationCursorContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-cursor-contract.v1',
    max_consumers: 256,
    monotonic_epoch: true,
    duplicate_idempotent: true,
    collision_fail_closed: true,
    durable_checkpoint_only: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
