export const BROWSER_COGNITIVE_DELTA_TRANSPORT_SCHEMA = 'metaengine.browser.cognitive-delta-transport.v1';
export const BROWSER_COGNITIVE_BATCH_SCHEMA = 'metaengine.browser.cognitive-delta-batch.v1';
export const BROWSER_COGNITIVE_ACK_SCHEMA = 'metaengine.browser.cognitive-delta-ack.v1';

const UNSUPPORTED_HTTP = new Set([404, 405, 501]);
const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function normalizeSendResult(result) {
  const status = Number(result?.status || 0);
  return Object.freeze({
    status: Number.isInteger(status) ? status : 0,
    body: result?.body && typeof result.body === 'object' ? result.body : null,
  });
}

export class BrowserCognitiveDeltaTransport {
  #readDeltas;
  #sendBatch;
  #resync;
  #batchSize;
  #state = 'UNKNOWN';
  #streamId = null;
  #cursor = 0;
  #scheduled = false;
  #inFlight = null;
  #pending = false;
  #lastAttemptAt = null;
  #lastSuccessAt = null;
  #lastError = null;
  #sentBatches = 0;
  #sentEvents = 0;
  #duplicateSafeRetries = 0;
  #resyncCount = 0;

  constructor({ readDeltas, sendBatch, resync, batchSize = 128 } = {}) {
    if (typeof readDeltas !== 'function') throw new Error('cognitive_transport_reader_required');
    if (typeof sendBatch !== 'function') throw new Error('cognitive_transport_sender_required');
    if (typeof resync !== 'function') throw new Error('cognitive_transport_resync_required');
    this.#readDeltas = readDeltas;
    this.#sendBatch = sendBatch;
    this.#resync = resync;
    this.#batchSize = boundedInt(batchSize, 128, 1, 256);
  }

  #scheduleContinuation() {
    if (this.#scheduled || this.#state === 'UNAVAILABLE') return false;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.flush();
    });
    return true;
  }

  notify() {
    if (this.#inFlight) {
      this.#pending = true;
      return true;
    }
    return this.#scheduleContinuation();
  }

  async #recoverGap(read) {
    this.#state = 'RESYNC_REQUIRED';
    const recovered = await this.#resync(Object.freeze({
      schema: 'metaengine.browser.cognitive-resync-request.v1',
      stream_id: read.stream_id,
      latest_sequence: read.latest_sequence,
      dropped_through_sequence: read.dropped_through_sequence,
      reason: 'DELTA_GAP',
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    }));
    if (recovered !== true) throw new Error('cognitive_transport_resync_not_confirmed');
    this.#streamId = read.stream_id;
    this.#cursor = read.latest_sequence;
    this.#resyncCount += 1;
    this.#state = 'SUPPORTED';
    this.#lastSuccessAt = new Date().toISOString();
    this.#lastError = null;
    return true;
  }

  async #sendRead(read) {
    if (!STREAM_ID_RE.test(String(read?.stream_id || ''))) throw new Error('cognitive_transport_stream_id_invalid');
    if (this.#streamId && this.#streamId !== read.stream_id) {
      // A Browser process incarnation changed under a reused transport object.
      // Never carry the old cursor into the new stream.
      this.#streamId = read.stream_id;
      this.#cursor = 0;
      read = this.#readDeltas(0, this.#batchSize);
    }
    if (read?.resync_required === true || read?.gap === true) return this.#recoverGap(read);
    const events = Array.isArray(read?.events) ? read.events : [];
    if (events.length === 0) {
      if (!this.#streamId) this.#streamId = read.stream_id;
      return true;
    }

    const through = Number(read.returned_through_sequence || 0);
    if (!Number.isSafeInteger(through) || through <= this.#cursor) throw new Error('cognitive_transport_batch_sequence_invalid');
    const envelope = Object.freeze({
      schema: BROWSER_COGNITIVE_BATCH_SCHEMA,
      stream_id: read.stream_id,
      after_sequence: this.#cursor,
      through_sequence: through,
      event_count: events.length,
      events: events.map((event) => ({ ...event })),
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      delivery_is_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });

    this.#lastAttemptAt = new Date().toISOString();
    const result = normalizeSendResult(await this.#sendBatch(envelope));
    if (UNSUPPORTED_HTTP.has(result.status)) {
      this.#state = 'UNAVAILABLE';
      this.#lastError = `COGNITIVE_ROUTE_HTTP_${result.status}`;
      return false;
    }
    if (result.status !== 202) throw new Error(`cognitive_transport_http_${result.status || 'unknown'}`);
    const ack = result.body;
    if (
      ack?.schema !== BROWSER_COGNITIVE_ACK_SCHEMA
      || ack?.accepted !== true
      || String(ack?.stream_id || '') !== read.stream_id
      || Number(ack?.accepted_through_sequence) !== through
    ) throw new Error('cognitive_transport_ack_invalid');

    this.#streamId = read.stream_id;
    this.#cursor = through;
    this.#state = 'SUPPORTED';
    this.#lastSuccessAt = new Date().toISOString();
    this.#lastError = null;
    this.#sentBatches += 1;
    this.#sentEvents += events.length;
    if (read.has_more === true) this.#pending = true;
    return true;
  }

  async flush() {
    if (this.#state === 'UNAVAILABLE') return false;
    if (this.#inFlight) {
      this.#pending = true;
      return this.#inFlight;
    }
    this.#inFlight = (async () => {
      try {
        const read = this.#readDeltas(this.#cursor, this.#batchSize);
        const priorCursor = this.#cursor;
        const ok = await this.#sendRead(read);
        if (ok !== true && this.#state !== 'UNAVAILABLE' && this.#cursor === priorCursor) this.#duplicateSafeRetries += 1;
        return ok;
      } catch (error) {
        // Observation delivery is non-authoritative. Do not advance the cursor on
        // an unknown network outcome. A later event may resend the same
        // stream_id+sequence batch and consumers can deterministically dedupe it.
        this.#state = 'DEGRADED';
        this.#lastError = clip(error?.message || error, 240);
        this.#duplicateSafeRetries += 1;
        return false;
      } finally {
        this.#inFlight = null;
        if (this.#pending && this.#state !== 'UNAVAILABLE') {
          this.#pending = false;
          this.#scheduleContinuation();
        }
      }
    })();
    return this.#inFlight;
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_COGNITIVE_DELTA_TRANSPORT_SCHEMA,
      state: this.#state,
      stream_id: this.#streamId,
      acknowledged_through_sequence: this.#cursor,
      batch_size: this.#batchSize,
      in_flight: this.#inFlight != null,
      scheduled: this.#scheduled,
      pending: this.#pending,
      last_attempt_at: this.#lastAttemptAt,
      last_success_at: this.#lastSuccessAt,
      last_error: this.#lastError,
      sent_batches: this.#sentBatches,
      sent_events: this.#sentEvents,
      duplicate_safe_retries: this.#duplicateSafeRetries,
      resync_count: this.#resyncCount,
      dedupe_key: 'stream_id+sequence',
      timer_delay_ms: 0,
      event_driven: true,
      full_state_fallback_required: this.#state !== 'SUPPORTED',
      delivery_is_authority: false,
      second_command_scheduler: false,
      automatic_effect_retry_allowed: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }
}
