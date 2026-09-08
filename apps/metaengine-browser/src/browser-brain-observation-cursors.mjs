const CONSUMER_RE = /^[a-z][a-z0-9_.:-]{0,95}$/i;
const MAX_BATCH = 128;
const MAX_CONSUMERS = 256;
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

function assertNoDuplicateSnapshotConsumers(cursors) {
  const seen = new Set();
  for (const cursor of cursors) {
    if (!cursor || typeof cursor !== 'object') continue;
    const consumer = String(cursor.consumer || '').trim();
    if (!CONSUMER_RE.test(consumer)) continue;
    if (seen.has(consumer)) throw new Error('browser_brain_cursor_snapshot_duplicate_invalid');
    seen.add(consumer);
  }
}

function toResume(cursor) {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume.v1',
    consumer: cursor.consumer,
    from_epoch: cursor.epoch,
    canonical_resync_required: false,
    payload_persisted: false,
    ...ZERO_AUTHORITY,
  });
}

export class BrowserBrainObservationCursorLedger {
  #capacity;
  #cursors = new Map();
  #revision = 0;

  constructor({ capacity = 64 } = {}) {
    const bounded = Number(capacity);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > MAX_CONSUMERS) {
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
    if (!Array.isArray(snapshot.cursors) || snapshot.cursors.length > MAX_CONSUMERS) {
      throw new TypeError('browser_brain_cursor_snapshot_cursors_invalid');
    }
    if (snapshot.consumer_count !== snapshot.cursors.length) {
      throw new Error('browser_brain_cursor_snapshot_count_invalid');
    }
    assertNoDuplicateSnapshotConsumers(snapshot.cursors);
    const revision = snapshot.revision === undefined
      ? snapshot.consumer_count
      : normalizeEpoch(snapshot.revision, 'browser_brain_cursor_snapshot_revision_invalid');
    if (revision < snapshot.consumer_count) {
      throw new Error('browser_brain_cursor_snapshot_revision_invalid');
    }

    const ledger = new BrowserBrainObservationCursorLedger({ capacity: snapshot.capacity });
    for (let offset = 0; offset < snapshot.cursors.length; offset += MAX_BATCH) {
      const results = ledger.checkpointBatch(snapshot.cursors.slice(offset, offset + MAX_BATCH));
      if (results.some((result) => result.disposition !== 'APPLIED')) {
        throw new Error('browser_brain_cursor_snapshot_duplicate_invalid');
      }
    }
    ledger.#revision = revision;
    return ledger;
  }

  checkpoint(input) {
    const result = applyCheckpoint(this.#cursors, this.#capacity, input);
    if (result.disposition === 'APPLIED') this.#revision += 1;
    return result;
  }

  checkpointBatch(inputs = []) {
    if (!Array.isArray(inputs) || inputs.length > MAX_BATCH) {
      throw new TypeError('browser_brain_cursor_batch_invalid');
    }
    const staged = new Map(this.#cursors);
    const results = inputs.map((input) => applyCheckpoint(staged, this.#capacity, input));
    this.#cursors = staged;
    this.#revision += results.filter((result) => result.disposition === 'APPLIED').length;
    return Object.freeze(results);
  }

  get(consumerValue) {
    const consumer = String(consumerValue || '').trim();
    if (!CONSUMER_RE.test(consumer)) throw new TypeError('browser_brain_cursor_consumer_invalid');
    return this.#cursors.get(consumer) || null;
  }

  resumeFrom(consumerValue) {
    const consumer = String(consumerValue || '').trim();
    const cursor = this.get(consumer);
    return toResume(cursor || { consumer, epoch: 0 });
  }

  resumeBatch(consumerValues = []) {
    if (!Array.isArray(consumerValues) || consumerValues.length > MAX_BATCH) {
      throw new TypeError('browser_brain_cursor_resume_batch_invalid');
    }
    return Object.freeze(consumerValues.map((consumer) => this.resumeFrom(consumer)));
  }

  resumeAll() {
    return Object.freeze(
      [...this.#cursors.values()]
        .sort((a, b) => a.consumer.localeCompare(b.consumer))
        .map((cursor) => toResume(cursor)),
    );
  }

  resumeAllIfChanged(knownRevisionValue) {
    const knownRevision = normalizeEpoch(knownRevisionValue, 'browser_brain_cursor_resume_revision_invalid');
    if (knownRevision > this.#revision) {
      throw new Error('browser_brain_cursor_resume_revision_ahead');
    }
    const changed = knownRevision !== this.#revision;
    return Object.freeze({
      schema: 'metaengine.browser-brain.observation-conditional-resume.v1',
      changed,
      revision: this.#revision,
      resumes: changed ? this.resumeAll() : Object.freeze([]),
      payload_persisted: false,
      ...ZERO_AUTHORITY,
    });
  }

  snapshot() {
    const cursors = [...this.#cursors.values()].sort((a, b) => a.consumer.localeCompare(b.consumer));
    return Object.freeze({
      schema: 'metaengine.browser-brain.observation-cursor-ledger.v1',
      capacity: this.#capacity,
      revision: this.#revision,
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
    max_consumers: MAX_CONSUMERS,
    max_batch_checkpoints: MAX_BATCH,
    max_batch_resumes: MAX_BATCH,
    max_full_capacity_resumes: MAX_CONSUMERS,
    max_snapshot_restore_consumers: MAX_CONSUMERS,
    monotonic_epoch: true,
    monotonic_ledger_revision: true,
    duplicate_idempotent: true,
    collision_fail_closed: true,
    transactional_batch_checkpoint: true,
    transactional_snapshot_restore: true,
    chunked_full_capacity_snapshot_restore: true,
    bounded_batch_resume: true,
    bounded_full_capacity_resume: true,
    revision_gated_conditional_resume: true,
    unchanged_conditional_resume_is_empty: true,
    durable_checkpoint_only: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
