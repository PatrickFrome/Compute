const STREAM_KINDS = new Set(['BROWSERCELL', 'PROCESS', 'SEMANTIC', 'CDP', 'FANOUT']);
const SOURCE_RE = /^[a-z][a-z0-9_.:-]{0,95}$/i;

function compactObservation(input) {
  if (!input || typeof input !== 'object') throw new TypeError('browser_brain_observation_invalid');
  const epoch = Number(input.brain_epoch ?? input.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError('browser_brain_observation_epoch_invalid');
  const source = String(input.source || '').trim();
  if (!SOURCE_RE.test(source)) throw new TypeError('browser_brain_observation_source_invalid');
  const kind = String(input.kind || '').trim().toUpperCase();
  if (!STREAM_KINDS.has(kind)) throw new TypeError('browser_brain_observation_kind_invalid');
  const digest = String(input.digest || input.action_digest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('browser_brain_observation_digest_invalid');
  return Object.freeze({ epoch, source, kind, digest, disposition: String(input.disposition || 'APPLIED') });
}

export class BrowserBrainRealtimeObservationWindow {
  #capacity;
  #events = [];
  #latest = new Map();
  #maxEpoch = 0;

  constructor({ capacity = 256 } = {}) {
    const bounded = Number(capacity);
    if (!Number.isSafeInteger(bounded) || bounded < 8 || bounded > 1024) {
      throw new TypeError('browser_brain_observation_capacity_invalid');
    }
    this.#capacity = bounded;
  }

  observe(input) {
    const row = compactObservation(input);
    const latest = this.#latest.get(row.source);
    if (latest && row.epoch < latest.epoch) {
      return Object.freeze({ accepted: false, disposition: 'REGRESSION', max_epoch: this.#maxEpoch, authority_effect: false });
    }
    if (latest && row.epoch === latest.epoch) {
      if (latest.digest !== row.digest || latest.kind !== row.kind) {
        throw new Error('browser_brain_observation_epoch_collision');
      }
      return Object.freeze({ accepted: true, disposition: 'DUPLICATE', max_epoch: this.#maxEpoch, authority_effect: false });
    }
    if (row.epoch < this.#maxEpoch) {
      return Object.freeze({ accepted: false, disposition: 'STALE_GLOBAL_EPOCH', max_epoch: this.#maxEpoch, authority_effect: false });
    }

    this.#latest.set(row.source, row);
    this.#events.push(row);
    if (this.#events.length > this.#capacity) this.#events.shift();
    this.#maxEpoch = Math.max(this.#maxEpoch, row.epoch);
    return Object.freeze({ accepted: true, disposition: 'APPLIED', max_epoch: this.#maxEpoch, authority_effect: false });
  }

  changesSince(epochValue) {
    const epoch = Number(epochValue);
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError('browser_brain_observation_since_epoch_invalid');
    const earliest = this.#events[0]?.epoch ?? this.#maxEpoch;
    const truncated = this.#events.length === this.#capacity && epoch < earliest - 1;
    const events = this.#events.filter((row) => row.epoch > epoch);
    return Object.freeze({
      schema: 'metaengine.browser-brain.realtime-observation-delta.v1',
      from_epoch: epoch,
      to_epoch: this.#maxEpoch,
      truncated,
      resync_required: truncated,
      events: Object.freeze([...events]),
      payload_persisted: false,
      scheduler_authority: false,
      dispatch_authority: false,
      lease_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  snapshot() {
    const latest = [...this.#latest.values()].sort((a, b) => a.source.localeCompare(b.source));
    return Object.freeze({
      schema: 'metaengine.browser-brain.realtime-observation-window.v1',
      max_epoch: this.#maxEpoch,
      capacity: this.#capacity,
      retained_events: this.#events.length,
      source_count: latest.length,
      latest: Object.freeze(latest),
      payload_persisted: false,
      dedicated_timer: false,
      authority_effect: false,
    });
  }
}

export function browserBrainRealtimeObservationWindowContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.realtime-observation-window-contract.v1',
    stream_kinds: Object.freeze([...STREAM_KINDS]),
    max_capacity: 1024,
    bounded_retention: true,
    incremental_delta_read: true,
    canonical_resync_on_truncation: true,
    payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    dedicated_timer: false,
    authority_effect: false,
  });
}
