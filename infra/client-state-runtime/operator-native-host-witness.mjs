// METAENGINE W1: hermetic, read-only native Host witness codec.
// Only a Host-owned in-process installer may provide these callbacks. This
// module does NOT establish that such an installer exists in a packaged build.
import { createHash } from 'node:crypto';
import { evaluateGuardianHeartbeatFence } from '../../apps/metaengine-browser/src/browser-guardian-heartbeat-fence.mjs';

export const OPERATOR_NATIVE_HOST_WITNESS_SCHEMA = 'metaengine.operator.native-host-witness.v1';
export const OPERATOR_NATIVE_HOST_SOURCE_SCHEMA = 'metaengine.operator.native-host-source.v1';
const OWNER_SCHEMA = 'metaengine.host.owner-incarnation.v1';
const GUARDIAN_SCHEMA = 'metaengine.browser-guardian.machine-bootstrap-launcher.v1';
const HEALTH_SCHEMA = 'metaengine.guardian.host-health.v1';
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-zA-Z0-9_.:-]{8,128}$/;
const CHANNELS = ['startup', 'liveness', 'readiness', 'progress'];
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const pid = v => Number.isSafeInteger(v) && v > 0 && v <= 0x7fffffff;
const instant = v => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const identity = v => record(v) && pid(v.pid) && ID.test(v.process_incarnation_id || '')
  && instant(v.created_at) !== null;
const birth = (a, b) => record(a) && record(b) && pid(a.pid) && pid(b.pid)
  && a.pid === b.pid && instant(a.created_at) !== null
  && instant(a.created_at) === instant(b.created_at);
const ownerBinding = (v, o) => record(v)
  && v.owner_id === o.owner_id && v.device_id === o.device_id
  && v.owner_generation === o.generation;
const unknown = (reason = 'NATIVE_PROVENANCE_ABSENT') => Object.freeze({
  schema: OPERATOR_NATIVE_HOST_WITNESS_SCHEMA, state: 'UNKNOWN', reason,
  source: 'NATIVE_HOST_IN_PROCESS', observed_at: null, source_sha: null,
  fresh: false, proof: 'NONE', authority_effect: false, automatic_retry_allowed: false,
});
const rejected = (state, reason) => Object.freeze({
  ...unknown(reason), state, reason,
});
const bounded = (date, now, maxAge, skew) => {
  const ms = instant(date);
  if (ms === null) return 'INVALID';
  if (ms > now + skew || now - ms > maxAge) return 'STALE';
  return 'FRESH';
};
const safeFingerprint = (...ids) => createHash('sha256').update(JSON.stringify(ids)).digest('hex');

export function createOperatorNativeHostWitnessCodec({
  expectedSourceSha, readSource, readOwner, readGuardian, readGuardianHealth, readOsProcess,
  now = () => Date.now(), maxAgeMs = 10_000, maxReadMs = 750,
} = {}) {
  if (!SHA.test(expectedSourceSha || '')) throw new TypeError('native_host_exact_source_sha_required');
  if (typeof now !== 'function' || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100
      || maxAgeMs > 10_000 || !Number.isSafeInteger(maxReadMs)
      || maxReadMs < 1 || maxReadMs > 1500) throw new TypeError('native_host_policy_invalid');
  // The WeakMap is a local process-capability boundary: serialised/forged
  // positive fields have no power to validate as a native witness.
  const issued = new WeakMap();
  let latest = null;
  let sequence = 0;
  const readers = [readSource, readOwner, readGuardian, readGuardianHealth, readOsProcess];
  const present = readers.every(f => typeof f === 'function');

  async function sampleProcess(claimed, currentNow) {
    const v = await readOsProcess(claimed.pid);
    if (!record(v) || v.source !== 'OS_PROCESS_INVENTORY' || v.authority_effect !== false
        || !pid(v.pid) || instant(v.created_at) === null
        || !['PRESENT', 'ABSENT', 'UNKNOWN'].includes(v.state)
        || bounded(v.observed_at, currentNow, maxAgeMs, 5_000) !== 'FRESH'
        || instant(v.created_at) > instant(v.observed_at)) return null;
    return { pid: v.pid, created_at: v.created_at, state: v.state, observed_at: v.observed_at };
  }
  async function inspect() {
    if (!present) return unknown();
    const t = now();
    if (!Number.isSafeInteger(t) || t < 0) return rejected('UNVERIFIED', 'CLOCK_INVALID');
    const source = await readSource();
    // A claimed SHA or the word "verified" is never sufficient without a
    // separately supplied trusted native in-process source binding.
    if (!record(source)) return unknown();
    if (source.schema !== OPERATOR_NATIVE_HOST_SOURCE_SCHEMA
        || source.authority_effect !== false || source.origin !== 'NATIVE_IN_PROCESS'
        || !ID.test(source.owner_process_incarnation_id || '')
        || !ID.test(source.owner_id || '') || !ID.test(source.device_id || '')
        || !Number.isSafeInteger(source.owner_generation) || source.owner_generation < 1
        || bounded(source.observed_at, t, maxAgeMs, 5_000) !== 'FRESH') return unknown('SOURCE_BINDING_UNPROVEN');
    if (!SHA.test(source.source_sha || '')) return unknown('SOURCE_SHA_ABSENT');
    if (source.source_sha !== expectedSourceSha)
      return rejected('AMBIGUOUS', 'SOURCE_SHA_MISMATCH');

    const owner = await readOwner();
    const guardian = await readGuardian();
    const health = await readGuardianHealth();
    if (!record(owner) || !record(guardian) || !record(health)) return unknown();
    if (owner.schema !== OWNER_SCHEMA || owner.source !== 'LOCAL_HOST_OWNER'
        || owner.authority_effect !== false || !identity(owner)
        || !ID.test(owner.owner_id || '') || !ID.test(owner.device_id || '')
        || !Number.isSafeInteger(owner.generation) || owner.generation < 1
        || !identity(health.child) || health.child.pid === owner.pid
        || guardian.schema !== GUARDIAN_SCHEMA || guardian.authority_effect !== false
        || guardian.automatic_retry_allowed !== false
        || health.schema !== HEALTH_SCHEMA || health.source !== 'GUARDIAN_NATIVE_READBACK'
        || health.authority_effect !== false) return unknown('NATIVE_SHAPE_UNPROVEN');

    if (source.owner_id !== owner.owner_id || source.device_id !== owner.device_id
        || source.owner_generation !== owner.generation
        || source.owner_process_incarnation_id !== owner.process_incarnation_id
        || !ownerBinding(guardian, owner) || !ownerBinding(health, owner)
        || guardian.owner_pid !== owner.pid
        || guardian.owner_process_incarnation_id !== owner.process_incarnation_id
        || instant(guardian.owner_created_at) !== instant(owner.created_at)
        || guardian.browser_pid !== health.child.pid
        || guardian.browser_process_incarnation_id !== health.child.process_incarnation_id
        || instant(guardian.browser_created_at) !== instant(health.child.created_at))
      return rejected('AMBIGUOUS', 'OWNER_GUARDIAN_BINDING_CONFLICT');

    if ([owner, guardian, health, health.child].some(v => !SHA.test(v.source_sha || '')))
      return unknown('NATIVE_SOURCE_SHA_ABSENT');
    if ([owner, guardian, health, health.child].some(v => v.source_sha !== expectedSourceSha))
      return rejected('AMBIGUOUS', 'SOURCE_SHA_MISMATCH');
    for (const v of [owner, guardian, health, health.child]) {
      const age = bounded(v.observed_at, t, maxAgeMs, 5_000);
      if (age === 'INVALID') return unknown('NATIVE_TIMESTAMP_UNPROVEN');
      if (age === 'STALE') return rejected('STALE', 'NATIVE_OBSERVATION_STALE');
    }
    if (instant(owner.created_at) > t || instant(health.child.created_at) > t)
      return rejected('UNVERIFIED', 'FUTURE_PROCESS_BIRTH');
    if (!record(health.sequence_fence) || CHANNELS.some(k =>
        !Number.isSafeInteger(health.sequence_fence[k]) || health.sequence_fence[k] < 0))
      return unknown('HEARTBEAT_FLOOR_UNPROVEN');
    if (!record(health.heartbeats) || CHANNELS.some(k => {
      const signal = health.heartbeats[k];
      return !record(signal) || !Number.isSafeInteger(signal.sequence)
        || !Number.isSafeInteger(signal.observed_at_ms);
    })) return unknown('HEARTBEAT_CHANNEL_UNPROVEN');
    const fence = evaluateGuardianHeartbeatFence({
      child: health.child, release: health.release,
      heartbeats: health.heartbeats, sequence_fence: health.sequence_fence, now_ms: t,
    });
    if (fence.valid !== true || fence.authority_effect !== false)
      return unknown('HEARTBEAT_PROVENANCE_UNPROVEN');
    for (const k of CHANNELS) {
      if (t - fence.channels[k].observed_at_ms > maxAgeMs)
        return rejected('STALE', 'HEARTBEAT_STALE');
    }

    const a = await sampleProcess(owner, t), b = await sampleProcess(health.child, t);
    const c = await sampleProcess(owner, t), d = await sampleProcess(health.child, t);
    if (!a || !b || !c || !d) return unknown('OS_INVENTORY_UNPROVEN');
    if (!birth(a, owner) || !birth(c, owner) || !birth(a, c)
        || !birth(b, health.child) || !birth(d, health.child) || !birth(b, d))
      return rejected('AMBIGUOUS', 'PROCESS_BIRTH_CONFLICT');
    if ([a, b, c, d].some(v => v.state === 'ABSENT'))
      return rejected('OFFLINE', 'PROCESS_ABSENT');
    if ([a, b, c, d].some(v => v.state !== 'PRESENT')) return unknown('PROCESS_UNOBSERVED');
    if (guardian.state !== 'READY' || guardian.ready !== true
        || guardian.guardian_service_ready !== true
        || guardian.owner_binding_proven !== true || guardian.device_binding_proven !== true
        || guardian.stale !== false) return rejected('BLOCKED', 'GUARDIAN_NOT_BOUND');

    return Object.freeze({
      schema: OPERATOR_NATIVE_HOST_WITNESS_SCHEMA,
      source: 'NATIVE_HOST_IN_PROCESS', state: 'AVAILABLE',
      observed_at: new Date(t).toISOString(), source_sha: expectedSourceSha,
      proof: 'EXACT_OWNER_GUARDIAN_OS_AND_HEARTBEAT_READBACK',
      fresh: true, authority_effect: false, automatic_retry_allowed: false,
      details: Object.freeze({
        owner_pid: owner.pid, owner_created_at: new Date(instant(owner.created_at)).toISOString(),
        browser_pid: health.child.pid,
        browser_created_at: new Date(instant(health.child.created_at)).toISOString(),
        owner_generation: owner.generation,
        incarnation_sha256: safeFingerprint(owner.pid, instant(owner.created_at),
          owner.process_incarnation_id, health.child.pid, instant(health.child.created_at),
          health.child.process_incarnation_id),
        heartbeat_channels_fresh: CHANNELS.length,
        product_readiness_proven: false,
      }),
    });
  }

  // A returned handle contains ZERO witness fields or secrets, and is valid
  // only in this exact codec instance. No wire JSON can impersonate it.
  async function capture() {
    const token = Object.freeze(Object.create(null));
    if (sequence >= Number.MAX_SAFE_INTEGER) return token;
    const position = ++sequence;
    latest = token; // Invalidate previously captured handles on every request.
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(
      () => resolve(unknown('NATIVE_READBACK_TIMEOUT')), maxReadMs);
    });
    let answer;
    try {
      answer = await Promise.race([Promise.resolve().then(inspect), timeout]);
    } catch {
      answer = unknown('NATIVE_READBACK_FAILED');
    } finally { clearTimeout(timer); }
    issued.set(token, { answer, position, capturedAt: now() });
    return token;
  }
  function decode(token) {
    if (!record(token) || !issued.has(token)) return unknown('IN_PROCESS_SOURCE_BINDING_REQUIRED');
    const evidence = issued.get(token);
    if (token !== latest || evidence.position !== sequence)
      return rejected('STALE', 'SUPERSEDED_NATIVE_WITNESS');
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock < evidence.capturedAt
        || clock - evidence.capturedAt > maxAgeMs)
      return rejected('STALE', 'NATIVE_WITNESS_EXPIRED');
    return evidence.answer;
  }
  return Object.freeze({ capture, decode });
}
