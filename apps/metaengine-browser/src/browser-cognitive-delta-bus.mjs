export const BROWSER_COGNITIVE_DELTA_BUS_SCHEMA = 'metaengine.browser.cognitive-delta-bus.v1';
export const BROWSER_COGNITIVE_DELTA_SCHEMA = 'metaengine.browser.cognitive-delta.v1';

const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const DEFAULT_MAX_EVENTS = 4096;
const HARD_MAX_EVENTS = 16384;
const DEFAULT_READ_LIMIT = 256;
const HARD_READ_LIMIT = 1024;

const clip = (value, max = 240) => value == null ? null : String(value).slice(0, max);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function semanticPriority(methodRaw) {
  const method = String(methodRaw || '');
  if (
    method === 'METAENGINE.TargetAttached'
    || method === 'METAENGINE.TargetDetached'
    || method === 'METAENGINE.DebuggerDetached'
    || method === 'Page.frameNavigated'
    || method === 'Page.navigatedWithinDocument'
  ) return 'P0';
  if (
    method.startsWith('Accessibility.')
    || method.startsWith('DOM.')
    || method === 'Page.lifecycleEvent'
  ) return 'P1';
  if (method.startsWith('Network.') || method.startsWith('Runtime.')) return 'P2';
  return 'P2';
}

export function classifyCognitiveDeltaPriority(input = {}) {
  const type = String(input?.type || '').toUpperCase();
  if (type === 'METRICS_SAMPLE') return 'P3';
  if (type === 'SEMANTIC_EVENT') return semanticPriority(input?.semantic_method);
  if (
    type === 'RENDER_PROCESS_GONE'
    || type === 'CHILD_PROCESS_GONE'
    || type === 'WEB_CONTENTS_DESTROYED'
    || type === 'WEB_CONTENTS_CREATED'
    || type === 'WEB_CONTENTS_UNRESPONSIVE'
  ) return 'P0';
  if (type === 'WEB_CONTENTS_RESPONSIVE' || type === 'PROCESS_CENSUS_REFRESHED') return 'P1';
  return 'P2';
}

function safeDeltaProjection(input = {}) {
  const semanticMethod = clip(input?.semantic_method, 160);
  const type = clip(input?.type, 96) || 'UNKNOWN';
  return Object.freeze({
    source_sequence: Number.isSafeInteger(Number(input?.seq)) ? Number(input.seq) : null,
    source: type === 'SEMANTIC_EVENT' ? 'SEMANTIC' : (type === 'METRICS_SAMPLE' ? 'METRICS' : 'PROCESS'),
    type,
    semantic_method: semanticMethod,
    observed_at: clip(input?.observed_at, 64),
    tab_id: clip(input?.tab_id, 96),
    target_id: clip(input?.target_id, 160),
    web_contents_id: Number.isSafeInteger(Number(input?.web_contents_id)) ? Number(input.web_contents_id) : null,
    os_pid: Number.isSafeInteger(Number(input?.os_pid)) && Number(input.os_pid) > 0 ? Number(input.os_pid) : null,
    process_type: clip(input?.process_type, 80),
    reason: clip(input?.reason, 160),
    service_name: clip(input?.service_name, 160),
    name: clip(input?.name, 160),
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  });
}

function victimIndex(events, incomingPriority) {
  const incomingRank = PRIORITY_RANK[incomingPriority];
  // Preserve critical causal edges under telemetry pressure. An incoming event may
  // evict only an equally or less important retained event, preferring the least
  // important oldest candidate. P3 can therefore never evict P0/P1/P2.
  for (let candidateRank = 3; candidateRank >= incomingRank; candidateRank -= 1) {
    const index = events.findIndex((event) => PRIORITY_RANK[event.priority] === candidateRank);
    if (index >= 0) return index;
  }
  return -1;
}

export class BrowserCognitiveDeltaBus {
  #clock;
  #maxEvents;
  #onDelta;
  #events = [];
  #sequence = 0;
  #droppedTotal = 0;
  #droppedIncoming = 0;
  #droppedRetained = 0;
  #droppedThroughSequence = 0;

  constructor({
    clock = () => Date.now(),
    maxEvents = DEFAULT_MAX_EVENTS,
    onDelta = null,
  } = {}) {
    if (typeof clock !== 'function') throw new Error('cognitive_delta_clock_required');
    if (onDelta != null && typeof onDelta !== 'function') throw new Error('cognitive_delta_onchange_invalid');
    this.#clock = clock;
    this.#maxEvents = boundedInt(maxEvents, DEFAULT_MAX_EVENTS, 8, HARD_MAX_EVENTS);
    this.#onDelta = onDelta;
  }

  publish(input = {}) {
    this.#sequence += 1;
    const priority = classifyCognitiveDeltaPriority(input);
    const projected = safeDeltaProjection(input);
    const event = Object.freeze({
      schema: BROWSER_COGNITIVE_DELTA_SCHEMA,
      sequence: this.#sequence,
      priority,
      recorded_at: new Date(this.#clock()).toISOString(),
      ...projected,
    });

    if (this.#events.length >= this.#maxEvents) {
      const index = victimIndex(this.#events, priority);
      if (index < 0) {
        this.#droppedTotal += 1;
        this.#droppedIncoming += 1;
        this.#droppedThroughSequence = Math.max(this.#droppedThroughSequence, event.sequence);
        return Object.freeze({
          accepted: false,
          sequence: event.sequence,
          priority,
          reason: 'LOWER_PRIORITY_DROPPED_UNDER_PRESSURE',
          authority_effect: false,
        });
      }
      const [removed] = this.#events.splice(index, 1);
      this.#droppedTotal += 1;
      this.#droppedRetained += 1;
      this.#droppedThroughSequence = Math.max(this.#droppedThroughSequence, Number(removed?.sequence || 0));
    }

    this.#events.push(event);
    try { this.#onDelta?.(event); } catch {}
    return Object.freeze({ accepted: true, event, authority_effect: false });
  }

  readSince(sequence = 0, limit = DEFAULT_READ_LIMIT) {
    const after = boundedInt(sequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const bounded = boundedInt(limit, DEFAULT_READ_LIMIT, 1, HARD_READ_LIMIT);
    const unread = this.#events.filter((event) => event.sequence > after);
    const events = unread.slice(0, bounded).map((event) => ({ ...event }));
    const earliest = this.#events.length ? this.#events[0].sequence : this.#sequence + 1;
    const gap = (after < this.#droppedThroughSequence) || (after + 1 < earliest && after < this.#sequence);
    const lastReturned = events.length ? events[events.length - 1].sequence : after;
    return Object.freeze({
      schema: 'metaengine.browser.cognitive-delta-read.v1',
      after_sequence: after,
      earliest_sequence: earliest,
      latest_sequence: this.#sequence,
      returned_through_sequence: lastReturned,
      has_more: unread.length > events.length,
      gap,
      resync_required: gap,
      events,
      dropped_total: this.#droppedTotal,
      dropped_through_sequence: this.#droppedThroughSequence,
      snapshot_is_recovery_authority: true,
      delta_is_execution_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  snapshot() {
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const event of this.#events) counts[event.priority] += 1;
    return Object.freeze({
      schema: BROWSER_COGNITIVE_DELTA_BUS_SCHEMA,
      sequence: this.#sequence,
      earliest_sequence: this.#events.length ? this.#events[0].sequence : this.#sequence + 1,
      retained_events: this.#events.length,
      max_events: this.#maxEvents,
      priority_counts: Object.freeze({ ...counts }),
      dropped_total: this.#droppedTotal,
      dropped_incoming: this.#droppedIncoming,
      dropped_retained: this.#droppedRetained,
      dropped_through_sequence: this.#droppedThroughSequence,
      gap_recovery: 'FULL_PROCESS_AND_SEMANTIC_SNAPSHOT',
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      second_scheduler: false,
      automatic_retry_allowed: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }
}
