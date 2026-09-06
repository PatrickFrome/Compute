export const BROWSER_BRAIN_STREAM_CLOCK_SCHEMA = 'metaengine.browser-brain.stream-clock.v1';

const SOURCE_RE = /^[a-z][a-z0-9_.:-]{0,63}$/i;

function validSequence(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function freezeRow(source, state) {
  return Object.freeze({
    source,
    sequence: state.sequence,
    resync_required: state.resyncRequired,
    gap_from: state.gapFrom,
    gap_to: state.gapTo,
  });
}

/**
 * Bounded, observation-only causal clock for Browser Brain realtime streams.
 *
 * It provides one monotonic local epoch across independent process, semantic,
 * CDP and command-wake streams while retaining each producer's own sequence.
 * Delivery is never authority: a gap marks that source for canonical resync and
 * does not synthesize or replay missing observations.
 */
export class BrowserBrainStreamClock {
  #sources = new Map();
  #epoch = 0;
  #maxSources;

  constructor({ maxSources = 64 } = {}) {
    const bounded = Number(maxSources);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 256) {
      throw new TypeError('browser_brain_stream_clock_max_sources_invalid');
    }
    this.#maxSources = bounded;
  }

  observe(sourceValue, sequenceValue) {
    const source = String(sourceValue || '').trim();
    const sequence = Number(sequenceValue);
    if (!SOURCE_RE.test(source)) throw new TypeError('browser_brain_stream_clock_source_invalid');
    if (!validSequence(sequence)) throw new TypeError('browser_brain_stream_clock_sequence_invalid');

    let state = this.#sources.get(source);
    if (!state) {
      if (this.#sources.size >= this.#maxSources) {
        throw new Error('browser_brain_stream_clock_source_capacity_exceeded');
      }
      state = { sequence: 0, resyncRequired: false, gapFrom: null, gapTo: null };
      this.#sources.set(source, state);
    }

    if (sequence < state.sequence) {
      return Object.freeze({
        accepted: false,
        disposition: 'REGRESSION',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        authority_effect: false,
      });
    }
    if (sequence === state.sequence) {
      return Object.freeze({
        accepted: true,
        disposition: 'DUPLICATE',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        authority_effect: false,
      });
    }

    const expected = state.sequence + 1;
    if (sequence !== expected) {
      state.resyncRequired = true;
      state.gapFrom = expected;
      state.gapTo = sequence - 1;
      return Object.freeze({
        accepted: false,
        disposition: 'GAP',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        authority_effect: false,
      });
    }

    state.sequence = sequence;
    state.resyncRequired = false;
    state.gapFrom = null;
    state.gapTo = null;
    this.#epoch += 1;
    return Object.freeze({
      accepted: true,
      disposition: 'APPLIED',
      epoch: this.#epoch,
      source: freezeRow(source, state),
      authority_effect: false,
    });
  }

  resync(sourceValue, sequenceValue) {
    const source = String(sourceValue || '').trim();
    const sequence = Number(sequenceValue);
    if (!SOURCE_RE.test(source)) throw new TypeError('browser_brain_stream_clock_source_invalid');
    if (!validSequence(sequence)) throw new TypeError('browser_brain_stream_clock_sequence_invalid');
    const state = this.#sources.get(source);
    if (!state) throw new Error('browser_brain_stream_clock_source_unknown');
    if (!state.resyncRequired) throw new Error('browser_brain_stream_clock_resync_not_required');
    if (sequence < state.sequence) throw new Error('browser_brain_stream_clock_resync_regression');

    state.sequence = sequence;
    state.resyncRequired = false;
    state.gapFrom = null;
    state.gapTo = null;
    this.#epoch += 1;
    return Object.freeze({
      accepted: true,
      disposition: 'RESYNCED',
      epoch: this.#epoch,
      source: freezeRow(source, state),
      authority_effect: false,
    });
  }

  snapshot() {
    const sources = [...this.#sources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, state]) => freezeRow(source, state));
    return Object.freeze({
      schema: BROWSER_BRAIN_STREAM_CLOCK_SCHEMA,
      epoch: this.#epoch,
      source_count: sources.length,
      max_sources: this.#maxSources,
      sources: Object.freeze(sources),
      gap_requires_resync: sources.some((row) => row.resync_required),
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      automatic_retry_allowed: false,
      dedicated_timer: false,
      authority_effect: false,
    });
  }
}
