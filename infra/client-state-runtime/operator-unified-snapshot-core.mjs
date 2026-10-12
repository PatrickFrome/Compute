// Unified Command & Continuity Plane P0 — pure read-only projection.
// Raw observations are never execution authority and are not allowed to carry secrets.
export const OPERATOR_CONTEXT_SCHEMA = 'metaengine.operator.context.v1';
export const OPERATOR_PLANES = Object.freeze(['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity']);
const SOURCES = Object.freeze({
  database: 'LOCAL_POSTGRES',
  client: 'NATIVE_BROWSER_READBACK',
  supervisor: 'SIGNED_SUPERVISOR_READBACK',
  fleet: 'LOCAL_TASK_LEDGER',
  host: 'TRUSTED_HOST_READBACK',
  source: 'EXACT_GIT_READBACK',
  continuity: 'LOCAL_CHECKPOINT_LEDGER',
});
const STATES = new Set(['AVAILABLE', 'READY', 'DEGRADED', 'BLOCKED', 'OFFLINE', 'AMBIGUOUS']);
const DEFAULT_MAX_AGE_MS = 30_000;
const MAX_SKEW_MS = 5_000;
const nonNegativeInt = x => Number.isSafeInteger(x) && x >= 0 ? x : null;

function reducePlane(name, value, nowMs, maxAgeMs) {
  const unknown = { state: 'UNKNOWN', source: SOURCES[name], observed_at: null, proof: 'NONE', fresh: false };
  if (Array.isArray(value)) return value.length === 0 ? unknown : { ...unknown, state: value.length > 1 ? 'AMBIGUOUS' : 'UNVERIFIED' };
  if (!value || typeof value !== 'object') return unknown;
  // A caller cannot relabel facts from another plane: fail closed on provenance mismatch.
  if (value.source !== SOURCES[name]) return { ...unknown, state: 'UNVERIFIED' };
  const observed = Date.parse(value.observed_at);
  if (!Number.isFinite(observed)) return { ...unknown, state: 'UNVERIFIED' };
  const age = nowMs - observed;
  if (age < -MAX_SKEW_MS || age > maxAgeMs) return {
    ...unknown, state: 'STALE', observed_at: new Date(observed).toISOString(), age_ms: Math.max(0, age),
  };
  if (value.proven !== true || !STATES.has(value.state)) return {
    ...unknown, state: 'UNVERIFIED', observed_at: new Date(observed).toISOString(),
  };
  if (name !== 'database') {
    // The trusted adapter (not the caller/model) must independently validate
    // the underlying receipt. Owner and heartbeat are mandatory even then.
    const ownerOk = typeof value.owner_id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.owner_id);
    const heartbeat = typeof value.heartbeat_at === 'string' ? Date.parse(value.heartbeat_at) : NaN;
    if (!ownerOk || !Number.isFinite(heartbeat)) return { ...unknown, state: 'UNVERIFIED' };
    if (nowMs - heartbeat > maxAgeMs || heartbeat - nowMs > MAX_SKEW_MS || heartbeat > observed + MAX_SKEW_MS)
      return { ...unknown, state: 'STALE', observed_at: new Date(heartbeat).toISOString() };
    if ((name === 'client' || name === 'host') &&
        !(typeof value.process_incarnation === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.process_incarnation)))
      return { ...unknown, state: 'UNVERIFIED' };
    if (name === 'supervisor' && (value.signature_verified !== true ||
        !Number.isSafeInteger(value.supervisor_epoch) || value.supervisor_epoch < 0))
      return { ...unknown, state: 'UNVERIFIED' };
    if (name === 'fleet' && (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 0))
      return { ...unknown, state: 'UNVERIFIED' };
    if (name === 'source' && !/^[a-fA-F0-9]{40}$/.test(value.source_sha || ''))
      return { ...unknown, state: 'UNVERIFIED' };
    if (name === 'continuity' && (!Number.isSafeInteger(value.event_seq) || value.event_seq < 0))
      return { ...unknown, state: 'UNVERIFIED' };
  }
  const output = {
    state: value.state, source: SOURCES[name], observed_at: new Date(observed).toISOString(),
    age_ms: Math.max(0, age), proof: 'TRUSTED_READBACK', fresh: true,
  };
  if (name === 'database') {
    output.details = {
      catalog_rpc_available: nonNegativeInt(value.rpc_available),
      catalog_rpc_expected: nonNegativeInt(value.rpc_expected),
      catalog_tables_available: nonNegativeInt(value.tables_available),
      catalog_tables_expected: nonNegativeInt(value.tables_expected),
      // This is a schema identifier only, not an arbitrary capabilities blob.
      capability_schema: typeof value.capability_schema === 'string' && /^[-.a-zA-Z0-9]{1,100}$/.test(value.capability_schema) ? value.capability_schema : null,
    };
  }
  return output;
}

export function buildUnifiedOperatorContext({ observations = {}, nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('operator_context_clock_invalid');
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100 || maxAgeMs > 300_000) throw new Error('operator_context_freshness_policy_invalid');
  const planes = {};
  for (const name of OPERATOR_PLANES) planes[name] = reducePlane(name, observations?.[name], nowMs, maxAgeMs);
  // Individually fresh but mutually inconsistent Owners are not a healthy world.
  const ownerIds = new Set(OPERATOR_PLANES.filter(name => name !== 'database' && planes[name].fresh)
    .map(name => observations[name].owner_id));
  if (ownerIds.size > 1) for (const name of OPERATOR_PLANES) {
    if (name !== 'database' && planes[name].fresh)
      planes[name] = { state: 'AMBIGUOUS', source: SOURCES[name], observed_at: null, proof: 'NONE', fresh: false };
  }
  const missing = OPERATOR_PLANES.filter(name => planes[name].state !== 'READY');
  // A functioning database alone is NEVER evidence of Browser/Fleet/Host readiness.
  return Object.freeze({
    schema: OPERATOR_CONTEXT_SCHEMA,
    version: 1,
    generated_at: new Date(nowMs).toISOString(),
    storage: 'OWN_POSTGRES_ONLY',
    cloud_database_dependency: false,
    remote_fallback_allowed: false,
    scope: 'READ_ONLY',
    planes,
    operational_state: missing.length === 0 ? 'ALL_PLANES_REPORTED_READY' : 'NOT_PROVEN',
    not_ready_planes: missing,
    authority_effect: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
  });
}
