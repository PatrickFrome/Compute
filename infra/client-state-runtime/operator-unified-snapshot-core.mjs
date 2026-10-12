import { reduceHostProcessObservation } from './operator-host-incarnation-core.mjs';

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
  if (name === 'host') return reduceHostProcessObservation(value, { nowMs, maxAgeMs });
  const unknown = { state: 'UNKNOWN', source: SOURCES[name], observed_at: null, proof: 'NONE', fresh: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown;
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
