// W14: pure, source-only diagnostic. Never wire this to page/worker/model claims.
// Native Main must independently authenticate the Owner/source and collect frames.
export const BROWSER_RENDERER_READINESS_PROOF_SCHEMA = 'metaengine.browser-renderer-readiness-proof.v1';
const MAX_AGE_MS = 5_000;
const MAX_EVENTS = 64;
const STATES = Object.freeze(['UNKNOWN', 'FROZEN', 'BLANK', 'NOT_VISIBLE', 'RENDERER_GONE', 'RECOVERING', 'READY']);

const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const boundedText = (v, n = 128) => typeof v === 'string' && v.length > 0 && v.length <= n;
const same = (a, b) => a?.web_contents_id === b?.web_contents_id
  && a?.owner_incarnation === b?.owner_incarnation
  && a?.source_sha === b?.source_sha
  && a?.pid === b?.pid && a?.process_creation_time_ms === b?.process_creation_time_ms
  && a?.navigation_generation === b?.navigation_generation;

function identity(x) {
  return x && integer(x.web_contents_id, 1) && boundedText(x.owner_incarnation)
    && sha(x.source_sha) && integer(x.pid, 1)
    && integer(x.process_creation_time_ms, 1)
    && integer(x.navigation_generation, 1);
}
function fresh(ms, now) {
  return integer(ms, 1) && ms <= now && (now - ms) <= MAX_AGE_MS;
}
function result(state, reason, evidence = null) {
  return Object.freeze({
    schema: BROWSER_RENDERER_READINESS_PROOF_SCHEMA,
    state,
    reason,
    // READY is a bounded renderer-readiness statement, NEVER a system HEALTHY claim.
    system_health: 'UNKNOWN',
    physical_installed_qualification: 'UNKNOWN',
    evidence: evidence ? Object.freeze(evidence) : null,
    authority_effect: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
  });
}

const ADVERSE = new Set(['RENDER_PROCESS_GONE', 'WEB_CONTENTS_DESTROYED', 'WEB_CONTENTS_UNRESPONSIVE']);
const RECOVERY = new Set(['WEB_CONTENTS_RESPONSIVE', 'WEB_CONTENTS_CREATED']);

/**
 * Read-only projection over a bounded *trusted native Main-process* observation.
 * expected: independently verified active Owner+source+WebContents+OS PID/creation-time+
 * navigation generation. sample: same identity, native observation, visibility, event_seq.
 * surface: same identity, native pixel sample, strictly newer than adverse lifecycle edge.
 * This reducer cannot attest its caller; passing fabricated JS objects is NOT native proof.
 */
export function classifyBrowserRendererReadiness({
  expected = null, sample = null, events = [], surface = null, now_ms = Date.now(),
} = {}) {
  if (!integer(now_ms, 1) || !identity(expected)) return result('UNKNOWN', 'EXPECTED_IDENTITY_MISSING');
  if (!sample || !identity(sample) || !fresh(sample.observed_at_ms, now_ms)
      || !integer(sample.event_seq) || sample.events_truncated === true) {
    return result('UNKNOWN', 'NATIVE_SAMPLE_MISSING_STALE_OR_GAPPED');
  }
  if (sample.web_contents_id !== expected.web_contents_id
      || sample.owner_incarnation !== expected.owner_incarnation
      || sample.source_sha !== expected.source_sha) {
    return result('UNKNOWN', 'OWNER_SOURCE_OR_WEBCONTENTS_CONFLICT');
  }
  if (sample.pid !== expected.pid
      || sample.process_creation_time_ms !== expected.process_creation_time_ms
      || sample.navigation_generation !== expected.navigation_generation) {
    return result('RECOVERING', 'PROCESS_OR_DOCUMENT_INCARNTATION_CHANGED');
  }
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return result('UNKNOWN', 'EVENT_WINDOW_INVALID');
  let previousSeq = -1;
  let adverse = null;
  let recovery = null;
  for (const e of events) {
    if (!e || !integer(e.seq, 1) || e.seq <= previousSeq
        || e.seq > sample.event_seq || !fresh(e.observed_at_ms, now_ms)
        || !boundedText(e.type, 96) || !integer(e.web_contents_id, 1)) {
      return result('UNKNOWN', 'EVENT_ORDER_OR_FRESHNESS_INVALID');
    }
    previousSeq = e.seq;
    if (e.web_contents_id !== expected.web_contents_id) continue;
    // Conflicting lifecycle evidence on the same WebContents fails closed.
    if (!same(e, expected)) return result('UNKNOWN', 'EVENT_BINDING_CONFLICT');
    if (ADVERSE.has(e.type)) adverse = e;
    if (RECOVERY.has(e.type)) recovery = e;
  }

  const marker = adverse?.type;
  if (sample.destroyed === true || sample.crashed === true
      || marker === 'RENDER_PROCESS_GONE' || marker === 'WEB_CONTENTS_DESTROYED') {
    return result('RENDERER_GONE', 'NATIVE_RENDERER_LOSS');
  }
  if (marker === 'WEB_CONTENTS_UNRESPONSIVE'
      && (!recovery || recovery.seq <= adverse.seq)) return result('FROZEN', 'NATIVE_UNRESPONSIVE');
  if (sample.visibility !== 'VISIBLE') {
    if (sample.visibility === 'HIDDEN' || sample.visibility === 'BACKGROUND')
      return result('NOT_VISIBLE', 'NATIVE_WEBCONTENTS_NOT_VISIBLE');
    return result('UNKNOWN', 'VISIBILITY_NOT_ATTESTED');
  }

  // Pixel evidence MUST originate in native Main capture/readback, not DOM/page HTML
  // or HTTP. A nonempty URL, completed load, PID, OPEN, or HTTP 200 are irrelevant.
  if (!surface || surface.kind !== 'NATIVE_FRAME_PIXELS' || !same(surface, expected)
      || !fresh(surface.observed_at_ms, now_ms)
      || surface.observed_at_ms < sample.observed_at_ms
      || !integer(surface.after_event_seq) || surface.after_event_seq < previousSeq
      || surface.after_event_seq > sample.event_seq) {
    return result(adverse ? 'RECOVERING' : 'UNKNOWN', 'CURRENT_NATIVE_FRAME_PROOF_MISSING');
  }
  if (adverse && (surface.after_event_seq <= adverse.seq
      || surface.observed_at_ms <= adverse.observed_at_ms)) {
    return result('RECOVERING', 'FRAME_PRECEDES_RENDERER_FAILURE');
  }
  if (surface.pixel_state === 'BLANK') return result('BLANK', 'NATIVE_FRAME_BLANK');
  if (surface.pixel_state !== 'NON_BLANK'
      || !integer(surface.sampled_pixels, 64) || surface.sampled_pixels > 1_000_000
      || !integer(surface.distinct_colors, 2)
      || surface.distinct_colors > surface.sampled_pixels) {
    return result('UNKNOWN', 'NATIVE_FRAME_CONTENT_NOT_PROVEN');
  }
  return result('READY', 'CURRENT_VISIBLE_NATIVE_FRAME', {
    web_contents_id: expected.web_contents_id,
    owner_incarnation: expected.owner_incarnation,
    source_sha: expected.source_sha,
    pid: expected.pid,
    process_creation_time_ms: expected.process_creation_time_ms,
    navigation_generation: expected.navigation_generation,
    event_seq: surface.after_event_seq,
    observed_at_ms: surface.observed_at_ms,
    // Digest/raw pixels/page content deliberately excluded.
  });
}

export function browserRendererReadinessProofContract() {
  return Object.freeze({
    schema: BROWSER_RENDERER_READINESS_PROOF_SCHEMA,
    max_age_ms: MAX_AGE_MS,
    max_events: MAX_EVENTS,
    states: STATES,
    requires_trusted_native_main_pixel_readback: true,
    accepts_http_or_pid_as_readiness: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
