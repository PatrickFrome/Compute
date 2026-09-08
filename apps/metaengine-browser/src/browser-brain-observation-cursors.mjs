const CONSUMER_RE = /^[a-z][a-z0-9_.:-]{0,95}$/i;
const MAX_BATCH = 128;
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

function applyCheckpoint(cursors, capacity, input) {
  if (!input || typeof input !== 'object') throw new TypeError('browser_brain_cursor_invalid');
  const consumer = String(input.consumer || '').trim();
  if (!CONSUMER_RE.test(consumer)) throw new TypeError('browser_brain_cursor_consumer_invalid');
  const epoch = normalizeEpoch(input.epoch, 'browser_brain_cursor_epoch_invalid');
  const observationDigest = normalizeDigest(input.observation_digest, 'browser_brain_cursor_digest_invalid');
  const existing = cursors.get(consumer);

  if (!existing && cursors.size >= capacity) {
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

  cursors.set(consumer, Object.freeze({ consumer, epoch, observation_digest: observationDigest }));
  return Object.freeze({ accepted: true, disposition: 'APPLIED', consumer, epoch, ...ZERO_AUTHORITY });
}

function assertZeroAuthority(input) {
  for (const [key, expected] of Object.entries(ZERO_AUTHORITY)) {
    if (input[key] !== expected) throw new Error('browser_brain_cursor_snapshot_authority_invalid');
  }
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

  static restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('browser_brain_cursor_snapshot_invalid');
    if (snapshot.schema !== 'metaengine.browser-brain.observation-cursor-ledger.v1') {
      throw new Error('browser_brain_cursor_snapshot_schema_invalid');
    }
    if (snapshot.payload_persisted !== false || snapshot.durable_checkpoint_only !== true) {
      throw new Error('browser_brain_cursor_snapshot_contract_invalid');
    }
    assertZeroAuthority(snapshot);
    if (!Array.isArray(snapshot.cursors) || snapshot.cursors.length > MAX_BATCH) {
      throw new TypeError('browser_brain_cursor_snapshot_cursors_invalid');
    }
    if (snapshot.consumer_count !== snapshot.cursors.length) {
      throw new Error('browser_brain_cursor_snapshot_count_invalid');
    }

    const ledger = new BrowserBrainObservationCursorLedger({ capacity: snapshot.capacity });
    const results = ledger.checkpointBatch(snapshot.cursors);
    if (results.some((result) => result.disposition !== 'APPLIED')) {
      throw new Error('browser_brain_cursor_snapshot_duplicate_invalid');
    }
    return ledger;
  }

  checkpoint(input) {
    return applyCheckpoint(this.#cursors, this.#capacity, input);
  }

  checkpointBatch(inputs = []) {
    if (!Array.isArray(inputs) || inputs.length > MAX_BATCH) {
      throw new TypeError('browser_brain_cursor_batch_invalid');
    }
    const staged = new Map(this.#cursors);
    const results = inputs.map((input) => applyCheckpoint(staged, this.#capacity, input));
    this.#cursors = staged;
    return Object.freeze(results);
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
    max_batch_checkpoints: MAX_BATCH,
    monotonic_epoch: true,
    duplicate_idempotent: true,
    collision_fail_closed: true,
    transactional_batch_checkpoint: true,
    transactional_snapshot_restore: true,
    durable_checkpoint_only: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
