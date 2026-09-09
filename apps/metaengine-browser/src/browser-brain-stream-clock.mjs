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
    resync_reason: state.resyncReason,
    resync_minimum_sequence: state.resyncMinimumSequence,
    gap_from: state.gapFrom,
    gap_to: state.gapTo,
  });
}

/**
 * Bounded, observation-only causal clock for Browser Brain realtime streams.
 *
 * It provides one monotonic local epoch across independent process and semantic
 * producer streams while retaining each producer's own sequence. Delivery is
 * never authority: after a source is baselined, a gap or regression latches the
 * source into fail-closed resync state until an explicit canonical non-regressing
 * resync reaches the required high-water. Ordinary delivery can never silently
 * clear that latch. Missing observations are never synthesized or replayed.
 */
export class BrowserBrainStreamClock {
  #sources = new Map();
  #epoch = 0;
  #resyncRequiredCount = 0;
  #maxSources;

  constructor({ maxSources = 64 } = {}) {
    const bounded = Number(maxSources);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 256) {
      throw new TypeError('browser_brain_stream_clock_max_sources_invalid');
    }
    this.#maxSources = bounded;
  }

  #validate(sourceValue, sequenceValue) {
    const source = String(sourceValue || '').trim();
    const sequence = Number(sequenceValue);
    if (!SOURCE_RE.test(source)) throw new TypeError('browser_brain_stream_clock_source_invalid');
    if (!validSequence(sequence)) throw new TypeError('browser_brain_stream_clock_sequence_invalid');
    return { source, sequence };
  }

  #newSource(source, sequence = 0) {
    if (this.#sources.size >= this.#maxSources) {
      throw new Error('browser_brain_stream_clock_source_capacity_exceeded');
    }
    const state = {
      sequence,
      resyncRequired: false,
      resyncReason: null,
      resyncMinimumSequence: null,
      gapFrom: null,
      gapTo: null,
    };
    this.#sources.set(source, state);
    return state;
  }

  #requireResync(state, reason, minimumSequence, gapFrom = null, gapTo = null) {
    if (!state.resyncRequired) this.#resyncRequiredCount += 1;
    state.resyncRequired = true;
    state.resyncReason = reason;
    state.resyncMinimumSequence = Math.max(state.sequence, Number(minimumSequence) || state.sequence);
    state.gapFrom = gapFrom;
    state.gapTo = gapTo;
  }

  observe(sourceValue, sequenceValue) {
    const { source, sequence } = this.#validate(sourceValue, sequenceValue);
    let state = this.#sources.get(source);
    if (!state) {
      state = this.#newSource(source, sequence);
      this.#epoch += 1;
      return Object.freeze({
        accepted: true,
        disposition: 'BASELINED',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        initial_observation: true,
        synthetic_replay: false,
        authority_effect: false,
      });
    }

    if (state.resyncRequired) {
      return Object.freeze({
        accepted: false,
        disposition: 'RESYNC_REQUIRED',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        synthetic_replay: false,
        authority_effect: false,
      });
    }

    if (sequence < state.sequence) {
      this.#requireResync(state, 'REGRESSION', state.sequence);
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
      this.#requireResync(state, 'GAP', sequence, expected, sequence - 1);
      return Object.freeze({
        accepted: false,
        disposition: 'GAP',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        authority_effect: false,
      });
    }

    state.sequence = sequence;
    this.#epoch += 1;
    return Object.freeze({
      accepted: true,
      disposition: 'APPLIED',
      epoch: this.#epoch,
      source: freezeRow(source, state),
      authority_effect: false,
    });
  }

  /** Establish one unseen source from an explicit canonical snapshot. */
  baseline(sourceValue, sequenceValue) {
    const { source, sequence } = this.#validate(sourceValue, sequenceValue);
    if (this.#sources.has(source)) throw new Error('browser_brain_stream_clock_baseline_already_initialized');
    const state = this.#newSource(source, sequence);
    this.#epoch += 1;
    return Object.freeze({
      accepted: true,
      disposition: 'BASELINED',
      epoch: this.#epoch,
      source: freezeRow(source, state),
      initial_observation: false,
      synthetic_replay: false,
      authority_effect: false,
    });
  }

  resync(sourceValue, sequenceValue) {
    const { source, sequence } = this.#validate(sourceValue, sequenceValue);
    const state = this.#sources.get(source);
    if (!state) throw new Error('browser_brain_stream_clock_source_unknown');
    if (!state.resyncRequired) throw new Error('browser_brain_stream_clock_resync_not_required');
    const minimum = Number.isSafeInteger(state.resyncMinimumSequence) ? state.resyncMinimumSequence : state.sequence;
    if (sequence < minimum) {
      return Object.freeze({
        accepted: false,
        disposition: 'RESYNC_BELOW_REQUIRED_FLOOR',
        epoch: this.#epoch,
        source: freezeRow(source, state),
        required_sequence: minimum,
        synthetic_replay: false,
        authority_effect: false,
      });
    }

    state.sequence = sequence;
    state.resyncRequired = false;
    state.resyncReason = null;
    state.resyncMinimumSequence = null;
    state.gapFrom = null;
    state.gapTo = null;
    this.#resyncRequiredCount = Math.max(0, this.#resyncRequiredCount - 1);
    this.#epoch += 1;
    return Object.freeze({
      accepted: true,
      disposition: 'RESYNCED',
      epoch: this.#epoch,
      source: freezeRow(source, state),
      synthetic_replay: false,
      authority_effect: false,
    });
  }

  currentEpoch() {
    return this.#epoch;
  }

  requiresResync() {
    return this.#resyncRequiredCount > 0;
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
      gap_requires_resync: this.#resyncRequiredCount > 0,
      resync_required_source_count: this.#resyncRequiredCount,
      ordinary_delivery_clears_resync: false,
      canonical_resync_must_reach_high_water: true,
      first_observation_establishes_baseline: true,
      canonical_baseline_supported: true,
      producer_regression_fails_closed: true,
      lower_sequence_rebase_allowed: false,
      semantic_stream_incarnation_id_required_for_safe_reset: true,
      synthetic_replay_allowed: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      automatic_retry_allowed: false,
      dedicated_timer: false,
      authority_effect: false,
    });
  }
}
