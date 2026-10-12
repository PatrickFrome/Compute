// P0 read-only Host/Browser incarnation projection. No native/OS/DB effects.
// Only an in-process, trusted Host adapter may supply these snapshots; an HTTP
// caller cannot select a process, supply evidence, or request a probe.
import { createHash } from 'node:crypto';

export const OPERATOR_HOST_EVIDENCE_SCHEMA = 'metaengine.operator.host-incarnation.evidence.v1';
export const OPERATOR_HOST_SOURCE = 'TRUSTED_HOST_READBACK';
const GUARDIAN_SCHEMA = 'metaengine.browser-guardian.machine-bootstrap-launcher.v1';
const CHANNELS = ['startup', 'liveness', 'readiness', 'progress'];
const FRESH_MS = 10_000;
const SKEW_MS = 5_000;
const identityText = s => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(s);
const pidOk = n => Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff;
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const instant = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)
  && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;

const result = (state, proof = 'NONE', more = {}) => ({
  state, source: OPERATOR_HOST_SOURCE, observed_at: null, proof, fresh: false, ...more,
});
const age = (timestamp, nowMs, limit) => {
  const ms = instant(timestamp);
  if (ms === null) return null;
  const elapsed = nowMs - ms;
  return { elapsed, stale: elapsed > limit || elapsed < -SKEW_MS };
};
const identity = x => record(x) && pidOk(x.pid) && identityText(x.process_incarnation_id)
  && instant(x.created_at) !== null;
const matches = (a,b) => a.pid === b.pid
  && a.process_incarnation_id === b.process_incarnation_id
  && instant(a.created_at) === instant(b.created_at);

// Readback is never readiness: even mutually bound Guardian, OS inventory and
// split heartbeat observations establish only AVAILABLE process evidence.
export function reduceHostProcessObservation(observation, { nowMs, maxAgeMs } = {}) {
  if (!record(observation)) return result('UNKNOWN');
  if (observation.source !== OPERATOR_HOST_SOURCE
      || observation.schema !== OPERATOR_HOST_EVIDENCE_SCHEMA
      || observation.authority_effect !== false) return result('UNVERIFIED');
  const browser = observation.browser;
  const guardian = observation.guardian;
  const probe = observation.runtime_probe;
  const heartbeat = observation.heartbeat_fence;
  // A live PID or a runtime probe alone is not trusted Guardian evidence.
  if (!record(browser) || !record(guardian) || !record(probe) || !record(heartbeat)) return result('UNKNOWN');
  if (!identity(browser) || !identity(probe)
      || !['PRESENT', 'ABSENT', 'UNKNOWN'].includes(probe.state)
      || probe.source !== 'OS_PROCESS_INVENTORY') return result('UNVERIFIED');
  const limit = Math.min(FRESH_MS, maxAgeMs);
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(limit) || limit < 100) return result('UNVERIFIED');
  if (guardian.schema !== GUARDIAN_SCHEMA || guardian.authority_effect !== false
      || guardian.automatic_retry_allowed !== false || guardian.stale !== false) {
    return result('UNVERIFIED');
  }
  const dates = [observation.observed_at, guardian.observed_at, probe.observed_at];
  const ages = dates.map(date => age(date, nowMs, limit));
  if (ages.some(value => value === null)) return result('UNVERIFIED');
  if (ages.some(value => value.stale)) return result('STALE');
  // Binding checks precede process/Guardian state checks, including PID reuse.
  if (!matches(browser, probe) || heartbeat.pid !== browser.pid
      || heartbeat.process_incarnation_id !== browser.process_incarnation_id) {
    return result('AMBIGUOUS');
  }
  if (heartbeat.valid !== true || heartbeat.reason !== 'EXACT_SPLIT_HEARTBEATS_FENCED'
      || !record(heartbeat.channels)) return result('UNVERIFIED');
  for (const channel of CHANNELS) {
    const value = heartbeat.channels[channel];
    if (!record(value) || !Number.isSafeInteger(value.sequence) || value.sequence < 1
        || !Number.isSafeInteger(value.observed_at_ms) || value.observed_at_ms < 0) return result('UNVERIFIED');
    if (value.observed_at_ms > nowMs + SKEW_MS || nowMs - value.observed_at_ms > limit) {
      return result('STALE');
    }
  }
  if (probe.state !== 'PRESENT') return result(probe.state === 'ABSENT' ? 'OFFLINE' : 'UNKNOWN');
  if (guardian.state !== 'READY' || guardian.ready !== true
      || guardian.guardian_service_ready !== true || guardian.owner_binding_proven !== true
      || guardian.device_binding_proven !== true) return result('BLOCKED');
  // Retain only allowlisted metadata: raw paths, command lines, tokens, owner
  // profile, Guardian internals and opaque process-incarnation IDs never leak.
  const fingerprint = createHash('sha256').update(JSON.stringify([
    browser.pid, instant(browser.created_at), browser.process_incarnation_id,
  ])).digest('hex');
  return result('AVAILABLE', 'EXACT_CROSS_BOUND_HOST_READBACK', {
    observed_at: new Date(instant(observation.observed_at)).toISOString(),
    fresh: true,
    age_ms: Math.max(0, ages[0].elapsed),
    details: {
      browser_pid: browser.pid,
      browser_created_at: new Date(instant(browser.created_at)).toISOString(),
      incarnation_sha256: fingerprint,
      guardian_binding: 'EXACT',
      runtime_probe: 'PROCESS_PRESENT',
      heartbeat_channels_fresh: CHANNELS.length,
      product_readiness_proven: false,
    },
  });
}
