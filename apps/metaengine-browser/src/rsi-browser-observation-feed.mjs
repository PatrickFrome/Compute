export const RSI_BROWSER_OBSERVATION_FEED_SCHEMA = 'metaengine.rsi.browser-observation-feed.v1';
export const RSI_BROWSER_OBSERVATION_SCHEMA = 'metaengine.browser-brain.working-memory.v1';

const MAX_CELLS = 256;

function boundedNonNegativeInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function projectLastCommand(value = {}) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    status: String(value.status || '').toUpperCase().slice(0, 48) || null,
    effect_outcome: String(value.effect_outcome || '').toUpperCase().slice(0, 48) || null,
  });
}

export function projectRsiBrainObservation(snapshot = {}) {
  if (snapshot?.schema !== RSI_BROWSER_OBSERVATION_SCHEMA) {
    throw new Error('rsi_browser_observation_schema_invalid');
  }
  if (snapshot?.execution_authority !== false || snapshot?.authority_effect !== false) {
    throw new Error('rsi_browser_observation_authority_invalid');
  }
  if (
    snapshot?.raw_dom_stored !== false
    || snapshot?.page_text_stored !== false
    || snapshot?.input_values_stored !== false
  ) {
    throw new Error('rsi_browser_observation_privacy_invalid');
  }

  const cells = (Array.isArray(snapshot.cells) ? snapshot.cells : [])
    .slice(0, MAX_CELLS)
    .map((cell) => Object.freeze({
      status: String(cell?.status || 'UNKNOWN').toUpperCase().slice(0, 48),
      last_command: projectLastCommand(cell?.last_command),
    }));

  return Object.freeze({
    schema: RSI_BROWSER_OBSERVATION_SCHEMA,
    cells: Object.freeze(cells),
    global: Object.freeze({
      process_revision: boundedNonNegativeInt(snapshot?.global?.process_revision),
      cognitive_sequence: boundedNonNegativeInt(snapshot?.global?.cognitive_sequence),
      dropped_events: boundedNonNegativeInt(snapshot?.global?.dropped_events),
    }),
    raw_dom_stored: false,
    raw_network_stored: false,
    page_text_stored: false,
    input_values_stored: false,
    command_payload_stored: false,
    execution_authority: false,
    authority_effect: false,
  });
}

/**
 * Bounded zero-timer sidecar from the existing Browser Brain event stream into RSI.
 *
 * The feed owns no scheduler, DB lease, Browser effect path, retry loop, or durable
 * queue. At most one observation is in-flight and one latest observation is pending.
 * When the producer outruns the RSI ledger, intermediate observational states are
 * coalesced rather than building an unbounded queue.
 */
export class RsiBrowserObservationFeed {
  #observe;
  #pending = null;
  #drainPromise = null;
  #accepting = true;
  #offered = 0;
  #delivered = 0;
  #coalesced = 0;
  #rejected = 0;
  #errors = 0;
  #lastError = null;

  constructor({ observe } = {}) {
    if (typeof observe !== 'function') throw new Error('rsi_browser_observation_observer_required');
    this.#observe = observe;
  }

  offer(snapshot) {
    this.#offered += 1;
    if (!this.#accepting) {
      this.#rejected += 1;
      return Object.freeze({ accepted: false, reason: 'STOPPED', authority_effect: false });
    }

    let projected;
    try {
      projected = projectRsiBrainObservation(snapshot);
    } catch (error) {
      this.#rejected += 1;
      this.#lastError = String(error?.message || error).slice(0, 240);
      return Object.freeze({ accepted: false, reason: this.#lastError, authority_effect: false });
    }

    if (this.#pending != null) this.#coalesced += 1;
    this.#pending = projected;
    if (!this.#drainPromise) {
      const pending = this.#drain();
      this.#drainPromise = pending;
      void pending.finally(() => {
        if (this.#drainPromise === pending) this.#drainPromise = null;
        if (this.#accepting && this.#pending != null && !this.#drainPromise) this.offer(this.#pending);
      }).catch(() => {});
    }

    return Object.freeze({
      accepted: true,
      coalesced: this.#pending !== projected,
      in_flight: this.#drainPromise != null,
      authority_effect: false,
    });
  }

  async #drain() {
    while (this.#pending != null) {
      const next = this.#pending;
      this.#pending = null;
      try {
        await this.#observe(next);
        this.#delivered += 1;
        this.#lastError = null;
      } catch (error) {
        this.#errors += 1;
        this.#lastError = String(error?.message || error).slice(0, 240);
      }
    }
  }

  async flush() {
    while (this.#drainPromise || this.#pending != null) {
      if (!this.#drainPromise && this.#pending != null) {
        const pending = this.#drain();
        this.#drainPromise = pending;
        void pending.finally(() => {
          if (this.#drainPromise === pending) this.#drainPromise = null;
        }).catch(() => {});
      }
      if (this.#drainPromise) await this.#drainPromise;
    }
    return this.snapshot();
  }

  stop() {
    this.#accepting = false;
    this.#pending = null;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: RSI_BROWSER_OBSERVATION_FEED_SCHEMA,
      accepting: this.#accepting,
      offered_count: this.#offered,
      delivered_count: this.#delivered,
      coalesced_count: this.#coalesced,
      rejected_count: this.#rejected,
      error_count: this.#errors,
      in_flight: this.#drainPromise != null,
      pending_latest: this.#pending != null,
      max_pending_observations: 1,
      producer: 'EXISTING_BROWSER_BRAIN_EVENT_STREAM',
      zero_timer: true,
      second_scheduler: false,
      hidden_queue: false,
      browser_authority: false,
      command_leasing: false,
      execution_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      last_error: this.#lastError,
      authority_effect: false,
    });
  }
}
