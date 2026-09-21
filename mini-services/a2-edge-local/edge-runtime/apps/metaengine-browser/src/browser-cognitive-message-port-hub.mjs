export const BROWSER_COGNITIVE_PORT_HUB_SCHEMA = 'metaengine.browser.cognitive-message-port-hub.v1';
export const BROWSER_COGNITIVE_PORT_HELLO_SCHEMA = 'metaengine.browser.cognitive-port-hello.v1';
export const BROWSER_COGNITIVE_PORT_READY_SCHEMA = 'metaengine.browser.cognitive-port-ready.v1';
export const BROWSER_COGNITIVE_PORT_BATCH_SCHEMA = 'metaengine.browser.cognitive-port-batch.v1';
export const BROWSER_COGNITIVE_PORT_ACK_SCHEMA = 'metaengine.browser.cognitive-port-ack.v1';
export const BROWSER_COGNITIVE_PORT_RESYNC_SCHEMA = 'metaengine.browser.cognitive-port-resync.v1';
export const BROWSER_COGNITIVE_PORT_RESYNC_ACK_SCHEMA = 'metaengine.browser.cognitive-port-resync-ack.v1';

const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sequence(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function publicConsumer(row) {
  return Object.freeze({
    consumer_id: row.id,
    stream_id: row.streamId,
    ready: row.ready,
    acknowledged_through_sequence: row.cursor,
    hello_sequence: row.helloSequence,
    in_flight: row.inFlight != null,
    in_flight_kind: row.inFlight?.kind || null,
    in_flight_through_sequence: row.inFlight?.through || null,
    pending: row.pending,
    sent_batches: row.sentBatches,
    sent_events: row.sentEvents,
    resync_count: row.resyncCount,
    invalid_message_count: row.invalidMessages,
    attached_at: row.attachedAt,
    last_ack_at: row.lastAckAt,
    last_error: row.lastError,
    control_authority: false,
    command_leasing: false,
    execution_authority: false,
    authority_effect: false,
  });
}

/**
 * One-way, observation-only local delta fan-out over long-lived MessagePorts.
 *
 * Every consumer has at most one bounded batch in flight. Further edges collapse
 * into one pending bit and are reread from the existing bounded cognitive bus
 * after ACK. A slow renderer can therefore never create a second unbounded queue.
 */
export class BrowserCognitiveMessagePortHub {
  #readDeltas;
  #clock;
  #batchSize;
  #maxConsumers;
  #consumers = new Map();
  #nextConsumerId = 0;
  #publishedEdges = 0;
  #sentBatches = 0;
  #sentEvents = 0;
  #resyncCount = 0;
  #detachedCount = 0;

  constructor({ readDeltas, clock = () => Date.now(), batchSize = 64, maxConsumers = 16 } = {}) {
    if (typeof readDeltas !== 'function') throw new Error('browser_cognitive_port_reader_required');
    if (typeof clock !== 'function') throw new Error('browser_cognitive_port_clock_required');
    this.#readDeltas = readDeltas;
    this.#clock = clock;
    this.#batchSize = boundedInt(batchSize, 64, 1, 128);
    this.#maxConsumers = boundedInt(maxConsumers, 16, 1, 64);
  }

  #now() { return new Date(this.#clock()).toISOString(); }

  #read(after) {
    const result = this.#readDeltas(after, this.#batchSize);
    if (!result || !STREAM_ID_RE.test(String(result.stream_id || ''))) {
      throw new Error('browser_cognitive_port_read_invalid');
    }
    return result;
  }

  #post(row, value) {
    try {
      row.port.postMessage(Object.freeze(value));
      row.lastError = null;
      return true;
    } catch (error) {
      row.lastError = String(error?.message || error).slice(0, 240);
      this.detach(row.id);
      return false;
    }
  }

  #pump(row) {
    if (!row || !row.ready || row.inFlight || row.closed) return false;
    let read;
    try {
      read = this.#read(row.cursor);
    } catch (error) {
      row.lastError = String(error?.message || error).slice(0, 240);
      return false;
    }
    row.pending = false;
    if (read.stream_id !== row.streamId || read.resync_required === true || read.gap === true) {
      const through = sequence(read.latest_sequence) ?? row.cursor;
      row.inFlight = { kind: 'RESYNC', through, streamId: read.stream_id };
      row.resyncCount += 1;
      this.#resyncCount += 1;
      return this.#post(row, {
        schema: BROWSER_COGNITIVE_PORT_RESYNC_SCHEMA,
        stream_id: read.stream_id,
        acknowledged_through_sequence: row.cursor,
        latest_sequence: through,
        reason: read.stream_id !== row.streamId ? 'STREAM_REINCARNATED' : 'DELTA_GAP',
        full_snapshot_required: true,
        delta_is_execution_authority: false,
        control_authority: false,
        command_leasing: false,
        authority_effect: false,
      });
    }
    const events = Array.isArray(read.events) ? read.events : [];
    if (events.length === 0) return true;
    const through = sequence(read.returned_through_sequence);
    if (through == null || through <= row.cursor || events.length > this.#batchSize) {
      row.lastError = 'browser_cognitive_port_batch_invalid';
      return false;
    }
    row.inFlight = { kind: 'BATCH', through };
    row.sentBatches += 1;
    row.sentEvents += events.length;
    this.#sentBatches += 1;
    this.#sentEvents += events.length;
    if (read.has_more === true) row.pending = true;
    return this.#post(row, {
      schema: BROWSER_COGNITIVE_PORT_BATCH_SCHEMA,
      stream_id: read.stream_id,
      after_sequence: row.cursor,
      through_sequence: through,
      event_count: events.length,
      events: events.map((event) => ({ ...event })),
      has_more: read.has_more === true,
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      delta_is_execution_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  #handleMessage(row, data = {}) {
    if (!row || row.closed || !data || typeof data !== 'object') return;
    const schema = String(data.schema || '');
    const streamId = String(data.stream_id || '');
    const through = sequence(data.through_sequence);
    if (schema === BROWSER_COGNITIVE_PORT_READY_SCHEMA) {
      if (row.ready || streamId !== row.streamId || through !== row.helloSequence || data.baseline_confirmed !== true) {
        row.invalidMessages += 1;
        return;
      }
      row.ready = true;
      row.cursor = through;
      row.lastAckAt = this.#now();
      this.#pump(row);
      return;
    }
    if (schema === BROWSER_COGNITIVE_PORT_ACK_SCHEMA) {
      if (!row.ready || row.inFlight?.kind !== 'BATCH' || streamId !== row.streamId || through !== row.inFlight.through) {
        row.invalidMessages += 1;
        return;
      }
      row.cursor = through;
      row.inFlight = null;
      row.lastAckAt = this.#now();
      this.#pump(row);
      return;
    }
    if (schema === BROWSER_COGNITIVE_PORT_RESYNC_ACK_SCHEMA) {
      if (
        row.inFlight?.kind !== 'RESYNC'
        || streamId !== row.inFlight.streamId
        || through !== row.inFlight.through
        || data.baseline_confirmed !== true
      ) {
        row.invalidMessages += 1;
        return;
      }
      row.streamId = streamId;
      row.cursor = through;
      row.inFlight = null;
      row.lastAckAt = this.#now();
      this.#pump(row);
      return;
    }
    row.invalidMessages += 1;
  }

  attach(port) {
    if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function' || typeof port.start !== 'function') {
      throw new Error('browser_cognitive_port_invalid');
    }
    if (this.#consumers.size >= this.#maxConsumers) throw new Error('browser_cognitive_port_capacity_exceeded');
    const read = this.#read(Number.MAX_SAFE_INTEGER);
    const latest = sequence(read.latest_sequence) ?? 0;
    this.#nextConsumerId += 1;
    const row = {
      id: `brain-port-${this.#nextConsumerId}`,
      port,
      streamId: read.stream_id,
      cursor: latest,
      helloSequence: latest,
      ready: false,
      inFlight: null,
      pending: false,
      closed: false,
      sentBatches: 0,
      sentEvents: 0,
      resyncCount: 0,
      invalidMessages: 0,
      attachedAt: this.#now(),
      lastAckAt: null,
      lastError: null,
      onMessage: null,
      onClose: null,
    };
    row.onMessage = (event) => this.#handleMessage(row, event?.data);
    row.onClose = () => this.detach(row.id, { closePort: false });
    port.on('message', row.onMessage);
    port.on('close', row.onClose);
    port.start();
    this.#consumers.set(row.id, row);
    if (!this.#post(row, {
      schema: BROWSER_COGNITIVE_PORT_HELLO_SCHEMA,
      stream_id: row.streamId,
      latest_sequence: latest,
      baseline_required: true,
      snapshot_channel: 'metaengine:shell:snapshot',
      ack_window: 1,
      max_batch_size: this.#batchSize,
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      delta_is_execution_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    })) throw new Error('browser_cognitive_port_hello_failed');
    return publicConsumer(row);
  }

  notify() {
    this.#publishedEdges += 1;
    for (const row of this.#consumers.values()) {
      row.pending = true;
      this.#pump(row);
    }
    return this.#consumers.size;
  }

  detach(consumerId, { closePort = true } = {}) {
    const row = this.#consumers.get(String(consumerId || ''));
    if (!row) return false;
    this.#consumers.delete(row.id);
    row.closed = true;
    try { row.port.off?.('message', row.onMessage); } catch {}
    try { row.port.off?.('close', row.onClose); } catch {}
    if (closePort) {
      try { row.port.close?.(); } catch {}
    }
    this.#detachedCount += 1;
    return true;
  }

  closeAll() {
    for (const id of [...this.#consumers.keys()]) this.detach(id);
  }

  snapshot() {
    const consumers = [...this.#consumers.values()].map(publicConsumer);
    return Object.freeze({
      schema: BROWSER_COGNITIVE_PORT_HUB_SCHEMA,
      consumer_count: consumers.length,
      max_consumers: this.#maxConsumers,
      batch_size: this.#batchSize,
      published_edges: this.#publishedEdges,
      sent_batches: this.#sentBatches,
      sent_events: this.#sentEvents,
      resync_count: this.#resyncCount,
      detached_count: this.#detachedCount,
      consumers,
      long_lived_ports: true,
      per_consumer_ack_window: 1,
      pending_state_bounded_to_boolean: true,
      full_snapshot_only_on_attach_or_gap: true,
      dedicated_timer: false,
      second_scheduler: false,
      hidden_command_queue: false,
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      control_authority: false,
      command_leasing: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
