// W22: native-only, read-only adapter for the EXISTING Owner-backed Operator Gateway.
// Only native main can supply getTrustedBinding. Renderers cannot provide URLs,
// credentials, owner IDs or queries. There is deliberately no default endpoint.
export const OPERATOR_NATIVE_CONTEXT_SCHEMA = 'metaengine.operator.native-context.v1';
const GATEWAY_SCHEMA = 'metaengine.operator.gateway.v1';
const CONTEXT_SCHEMA = 'metaengine.operator.context.v1';
const OWNER_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;
const MAX_BYTES = 32 * 1024;
const MAX_AGE_MS = 30_000;
const MAX_FUTURE_MS = 5_000;
const SOURCES = Object.freeze({
  database: 'LOCAL_POSTGRES', client: 'NATIVE_BROWSER_READBACK',
  supervisor: 'SIGNED_SUPERVISOR_READBACK', fleet: 'LOCAL_TASK_LEDGER',
  host: 'TRUSTED_HOST_READBACK', source: 'EXACT_GIT_READBACK',
  continuity: 'LOCAL_CHECKPOINT_LEDGER',
});
const STATES = new Set(['UNKNOWN', 'UNVERIFIED', 'STALE', 'AMBIGUOUS', 'BLOCKED',
  'OFFLINE', 'DEGRADED', 'AVAILABLE', 'READY']);
const POSITIVE = new Set(['AVAILABLE', 'READY', 'BLOCKED', 'OFFLINE', 'DEGRADED']);
const reasons = new Set(['OWNER_UNBOUND', 'OWNER_NOT_READY', 'GATEWAY_INVALID',
  'GATEWAY_UNAVAILABLE', 'GATEWAY_REJECTED', 'GATEWAY_RESPONSE_INVALID', 'GATEWAY_CONTEXT_STALE']);

export function unknownNativeOperatorContext(reason = 'OWNER_UNBOUND') {
  return Object.freeze({ schema: OPERATOR_NATIVE_CONTEXT_SCHEMA, state: 'UNKNOWN',
    reason: reasons.has(reason) ? reason : 'GATEWAY_UNAVAILABLE',
    storage: 'OWN_POSTGRES_ONLY', scope: 'READ_ONLY',
    context: null, run_id: null, event_seq: null, proof_identity: null,
    scheduler_authority: false, automatic_retry_allowed: false,
    remote_fallback_allowed: false, cloud_database_dependency: false, authority_effect: false });
}

function canonicalGatewayUrl(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' ||
      !/^[1-9][0-9]*$/.test(u.port) || Number(u.port) > 65535 ||
      u.pathname !== '/' || u.search || u.hash || u.username || u.password ||
      value !== u.origin) return null;
    return u.origin;
  } catch { return null; }
}
function ownerBinding(raw, at) {
  // This shape is required in addition to the trusted *in-process* native
  // adapter. A mock callback or a caller-supplied "verified" flag is NOT
  // authentic OS provenance and can never establish installed health.
  if (!raw || raw.provider !== 'LOCAL_POSTGRES' || raw.boot_state !== 'READY' ||
    raw.owner_binding_source !== 'NATIVE_IN_PROCESS_OWNER' ||
    !OWNER_ID.test(raw.owner_id || '') ||
    typeof raw.api_key !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(raw.api_key) ||
    !Number.isSafeInteger(raw.owner_epoch) || raw.owner_epoch < 1 ||
    !Number.isSafeInteger(raw.owner_generation) || raw.owner_generation < 1 ||
    !Number.isSafeInteger(raw.owner_pid) || raw.owner_pid < 1 ||
    !(/^[A-Za-z0-9_.:-]{8,128}$/).test(raw.process_incarnation_id || '') ||
    !/^[a-f0-9]{40}$/i.test(raw.source_sha || '') ||
    !timestamp(raw.owner_created_at) || !timestamp(raw.postgres_started_at) ||
    !fresh(raw.owner_observed_at, at)) return null;
  const base = canonicalGatewayUrl(raw.gateway_base_url);
  return base ? Object.freeze({ base, ownerId: raw.owner_id, apiKey: raw.api_key,
    epoch: raw.owner_epoch, generation: raw.owner_generation, pid: raw.owner_pid,
    birth: timestamp(raw.owner_created_at), incarnation: raw.process_incarnation_id,
    postgresBirth: timestamp(raw.postgres_started_at), sourceSha: raw.source_sha.toLowerCase() }) : null;
}
function sameBinding(a, b) {
  return Boolean(a && b && Object.keys(a).every(key => a[key] === b[key]));
}
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(Date.parse(value)).toISOString() : null;
const fresh = (value, now) => {
  const time = timestamp(value);
  return time !== null && Date.parse(time) >= now - MAX_AGE_MS && Date.parse(time) <= now + MAX_FUTURE_MS;
};
function projectPlane(plane, name, now) {
  const unavailable = { source: SOURCES[name], state: 'UNKNOWN', proof: 'NONE', fresh: false, observed_at: null };
  if (!plane || typeof plane !== 'object' || Array.isArray(plane)) return unavailable;
  if (!STATES.has(plane.state)) return { ...unavailable, state: 'UNVERIFIED' };
  const observed_at = timestamp(plane.observed_at);
  if (plane.state === 'UNKNOWN' && plane.proof === 'NONE' && plane.fresh === false) return unavailable;
  if (!observed_at) return { ...unavailable, state: 'UNVERIFIED' };
  if (!fresh(observed_at, now)) return { ...unavailable, state: 'STALE', observed_at };
  const trusted = plane.proof === 'TRUSTED_READBACK' && plane.fresh === true;
  if (POSITIVE.has(plane.state) && !trusted) return { ...unavailable, state: 'UNVERIFIED', observed_at };
  return { source: SOURCES[name], state: plane.state,
    fresh: trusted, proof: trusted ? 'TRUSTED_READBACK' : 'NONE', observed_at };
}
function projectContext(raw, ownerId, ownerEpoch, now) {
  if (!raw || raw.schema !== GATEWAY_SCHEMA || raw.version !== 1 ||
    raw.operation !== 'context' || raw.storage !== 'OWN_POSTGRES_ONLY' ||
    raw.scope !== 'READ_ONLY' || raw.authority_effect !== false ||
    raw.scheduler_authority !== false || raw.automatic_retry_allowed !== false ||
    !fresh(raw.observed_at, now)) return null;
  const context = raw.context;
  if (!context || context.schema !== CONTEXT_SCHEMA ||
    context.storage !== 'OWN_POSTGRES_ONLY' || context.scope !== 'READ_ONLY' ||
    context.authority_effect !== false || !fresh(context.generated_at, now) ||
    !context.planes || typeof context.planes !== 'object' || Array.isArray(context.planes)) return null;
  const planes = Object.fromEntries(Object.keys(SOURCES).map(name =>
    [name, projectPlane(context.planes[name], name, now)]));
  let run_id = null, event_seq = null;
  // A gateway with no independently proven Owner/run readback MUST NOT
  // manufacture event_seq=0, proof hashes, or run identity.
  if (raw.run?.state === 'AVAILABLE') {
    const run = raw.run;
    if (run.owner_id !== ownerId || run.owner_epoch !== ownerEpoch || !OWNER_ID.test(run.run_id || '') ||
      !OWNER_ID.test(run.project_id || '') ||
      !Number.isSafeInteger(run.owner_epoch) || run.owner_epoch < 0 ||
      typeof run.cursor !== 'string' || !DECIMAL.test(run.cursor) ||
      !Number.isSafeInteger(Number(run.cursor)) || !fresh(run.observed_at, now)) return null;
    run_id = run.run_id;
    event_seq = Number(run.cursor);
  } else if (raw.run?.state !== 'UNKNOWN' || raw.run?.proof !== 'NONE' ||
    raw.run?.run_id !== null || raw.run?.cursor !== null) return null;
  return Object.freeze({ schema: CONTEXT_SCHEMA, scope: 'READ_ONLY',
    storage: 'OWN_POSTGRES_ONLY', authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false, remote_fallback_allowed: false,
    cloud_database_dependency: false, generated_at: timestamp(context.generated_at),
    planes, run_id, event_seq, proof_identity: null });
}
async function boundedJson(response) {
  if (!response?.ok || response.status !== 200 || response.redirected === true) return null;
  if (Number(response.headers?.get?.('content-length')) > MAX_BYTES) return null;
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) return null;
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); }
}

export function createOperatorNativeContextReader({ getTrustedBinding = () => null,
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 1500 } = {}) {
  if (typeof getTrustedBinding !== 'function' || typeof fetchImpl !== 'function' ||
    typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 || timeoutMs > 2000) throw new Error('operator_native_context_reader_config_invalid');
  let inFlight = null;
  const readContext = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let trusted;
      try { trusted = await getTrustedBinding(); }
      catch { return unknownNativeOperatorContext('OWNER_UNBOUND'); }
      if (trusted?.boot_state !== 'READY' || trusted?.provider !== 'LOCAL_POSTGRES')
        return unknownNativeOperatorContext('OWNER_NOT_READY');
      const startedAt = now();
      if (!Number.isSafeInteger(startedAt) || startedAt < 0)
        return unknownNativeOperatorContext('GATEWAY_INVALID');
      const binding = ownerBinding(trusted, startedAt);
      if (!binding) return unknownNativeOperatorContext('GATEWAY_INVALID');
      const target = `${binding.base}/operator/v1/context`;
      try {
        const response = await fetchImpl(target, {
          method: 'GET', headers: { apikey: binding.apiKey },
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.url && response.url !== target) return unknownNativeOperatorContext('GATEWAY_REJECTED');
        if (!response.ok || response.status !== 200) return unknownNativeOperatorContext('GATEWAY_REJECTED');
        const raw = await boundedJson(response);
        const at = now();
        if (!Number.isSafeInteger(at) || at < 0) return unknownNativeOperatorContext('GATEWAY_RESPONSE_INVALID');
        // An Owner/Gateway/PG restart may occur while the authenticated GET
        // is in flight. Re-read the native binding AFTER the network response.
        // Never accept the earlier snapshot on a new epoch, PID/birth, source
        // SHA, PostgreSQL incarnation, endpoint or credential.
        let confirmed;
        try { confirmed = ownerBinding(await getTrustedBinding(), at); }
        catch { return unknownNativeOperatorContext('OWNER_NOT_READY'); }
        if (!sameBinding(binding, confirmed))
          return unknownNativeOperatorContext('OWNER_NOT_READY');
        const context = projectContext(raw, binding.ownerId, binding.epoch, at);
        return context || unknownNativeOperatorContext('GATEWAY_RESPONSE_INVALID');
      } catch { return unknownNativeOperatorContext('GATEWAY_UNAVAILABLE'); }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
  return Object.freeze({ readContext });
}
