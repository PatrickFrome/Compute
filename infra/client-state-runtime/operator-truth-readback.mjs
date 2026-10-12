// P0 Truth Plane: typed readback from the existing local PostgreSQL connection.
// This module does not open a connection, schedule work, query another provider,
// or grant an effect. Only the authenticated local API calls this fixed SELECT.
export const OPERATOR_DB_IDENTITY_SQL = `SELECT pg_catalog.clock_timestamp() AS observed_at,
  pg_catalog.pg_postmaster_start_time() AS started_at,
  pg_catalog.current_database() AS database_name`;

const safeTime = (value) => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

export function qualifyLocalPostgresEvidence({
  clockRows, capabilityRows, rpcAvailable, rpcExpected, tablesAvailable, tablesExpected,
  nowMs = Date.now(),
} = {}) {
  const raw = clockRows?.length === 1 ? clockRows[0] : null;
  const observedAt = safeTime(raw?.observed_at);
  const startedAt = safeTime(raw?.started_at);
  const databaseName = raw?.database_name;
  const schema = capabilityRows?.length === 1 ? capabilityRows[0]?.value?.schema : null;
  const validSchema = typeof schema === 'string' && /^[-.a-zA-Z0-9]{1,100}$/.test(schema);
  const validCatalog = [rpcAvailable, rpcExpected, tablesAvailable, tablesExpected]
    .every(Number.isSafeInteger)
    && rpcExpected > 0 && tablesExpected > 0
    && rpcAvailable >= 0 && rpcAvailable <= rpcExpected
    && tablesAvailable >= 0 && tablesAvailable <= tablesExpected;
  const sameServer = observedAt !== null && startedAt !== null
    && startedAt <= observedAt && typeof databaseName === 'string'
    && databaseName.length > 0 && databaseName.length <= 128;
  // A monotonic local arrival bound rejects a database clock that is implausibly
  // in the future. Any bigger skew is handled as STALE by the shared reducer.
  const attested = sameServer && validSchema && validCatalog && Number.isSafeInteger(nowMs);
  const complete = attested && rpcAvailable === rpcExpected && tablesAvailable === tablesExpected;
  return {
    source: 'LOCAL_POSTGRES',
    // A SQL response only proves this DB session/catalog, never Owner/Client/Host.
    proven: Boolean(attested),
    state: complete ? 'AVAILABLE' : 'DEGRADED',
    observed_at: observedAt === null ? null : new Date(observedAt).toISOString(),
    rpc_available: validCatalog ? rpcAvailable : null,
    rpc_expected: validCatalog ? rpcExpected : null,
    tables_available: validCatalog ? tablesAvailable : null,
    tables_expected: validCatalog ? tablesExpected : null,
    capability_schema: validSchema ? schema : null,
  };
}
