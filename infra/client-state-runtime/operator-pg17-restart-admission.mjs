// W25: read-only PG17 restart/schema admission for the existing Owner-backed
// fleet projection. This is NOT a new connection, migration, effect, lease,
// task executor or trusted Owner attestation. Caller owns a REPEATABLE READ
// READ ONLY transaction and a separate earlier local DB identity witness.
export const OPERATOR_PG17_RESTART_ADMISSION_SQL = `
SELECT pg_catalog.clock_timestamp() AS observed_at,
  pg_catalog.pg_postmaster_start_time() AS started_at,
  pg_catalog.current_database() AS database_name,
  pg_catalog.current_setting('server_version_num')::int AS server_version_num,
  pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
  pg_catalog.current_setting('transaction_isolation') AS transaction_isolation,
  (SELECT count(*)::int
     FROM (VALUES
       ('destruktion_meta.project_run_h205f22'),
       ('destruktion_meta.project_task_h205f22'),
       ('destruktion_meta.devos_fleet_task_h205f22'),
       ('destruktion_meta.devos_fleet_claim_h205f22'),
       ('destruktion_meta.project_event_h205f22')
     ) AS required(relation_name)
     WHERE pg_catalog.to_regclass(required.relation_name) IS NOT NULL
       AND pg_catalog.has_table_privilege(
         pg_catalog.to_regclass(required.relation_name), 'SELECT')
  ) AS readable_relations
`;

const toMs = value => value instanceof Date ? value.getTime()
  : typeof value === 'string' ? Date.parse(value) : NaN;
const safeDate = value => {
  const ms = toMs(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};
const verdict = (admitted, reason, postmasterSame = false) =>
  Object.freeze({ admitted, reason, postmaster_same: postmasterSame });

// Refuse an inconsistent snapshot before any lease or event SELECT. The initial
// capability read and ledger read may use DIFFERENT pool connections, or PG may
// restart between them. An identical database name is not an incarnation proof.
export async function admitOwnPg17LedgerReadback({
  tx, priorClockRows, nowMs = Date.now(),
} = {}) {
  if (!tx || typeof tx.unsafe !== 'function' || !Number.isSafeInteger(nowMs)
    || !Array.isArray(priorClockRows) || priorClockRows.length !== 1) {
    return verdict(false, 'IDENTITY_UNKNOWN');
  }
  const previous = priorClockRows[0];
  const priorStarted = safeDate(previous?.started_at);
  const priorObserved = safeDate(previous?.observed_at);
  if (!priorStarted || !priorObserved || priorStarted > priorObserved
    || priorObserved > nowMs + 5_000 || nowMs - priorObserved > 30_000
    || typeof previous.database_name !== 'string' || !previous.database_name
    || previous.database_name.length > 128) return verdict(false, 'IDENTITY_UNKNOWN');

  // A SQL failure (including ACL, connection loss, reconnect or missing schema)
  // never invokes an alternate provider or grants provisional availability.
  let rows;
  try { rows = await tx.unsafe(OPERATOR_PG17_RESTART_ADMISSION_SQL); }
  catch { return verdict(false, 'READBACK_UNAVAILABLE'); }
  if (!Array.isArray(rows) || rows.length !== 1) return verdict(false, 'READBACK_UNKNOWN');
  const next = rows[0];
  const started = safeDate(next?.started_at);
  const observed = safeDate(next?.observed_at);
  if (!started || !observed || started > observed ||
    observed > nowMs + 5_000 || nowMs - observed > 30_000 ||
    typeof next.database_name !== 'string' || !next.database_name
    || next.database_name.length > 128) return verdict(false, 'READBACK_UNKNOWN');

  // Source of identity is exclusively the two independent local SQL reads.
  // This does not claim OS process PID/birth or installed Owner correctness.
  if (started !== priorStarted || next.database_name !== previous.database_name) {
    return verdict(false, 'POSTMASTER_CHANGED');
  }
  if (!Number.isSafeInteger(next.server_version_num)
    || next.server_version_num < 170000 || next.server_version_num >= 180000) {
    return verdict(false, 'PG17_REQUIRED', true);
  }
  if (next.transaction_isolation !== 'repeatable read'
    || next.transaction_read_only !== 'on') {
    return verdict(false, 'READ_ONLY_SNAPSHOT_REQUIRED', true);
  }
  if (next.readable_relations !== 5) {
    return verdict(false, 'LEDGER_SCHEMA_OR_GRANTS_INCOMPLETE', true);
  }
  return verdict(true, 'ADMITTED', true);
}
