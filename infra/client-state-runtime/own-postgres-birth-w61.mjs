// W61: read-only PostgreSQL postmaster birth from the EXISTING own DB pool.
// Instantiated only inside the trusted local DB service. Never exposed as an
// HTTP/renderer/SQL selector or a producer of installed Owner authority.
export const OWN_PG_BIRTH_SQL_W61 = `SELECT
  pg_catalog.clock_timestamp() AS observed_at,
  pg_catalog.pg_postmaster_start_time() AS postgres_started_at,
  pg_catalog.current_database() AS database_name,
  pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
  pg_catalog.to_regnamespace('destruktion_meta') IS NOT NULL AS schema_present,
  pg_catalog.to_regclass('destruktion_meta.project_run_h205f22') IS NOT NULL AS project_table_present`;

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA = /^[a-f0-9]{40}$/i;
const time = x => x instanceof Date ? x.getTime() : typeof x === 'string' ? Date.parse(x) : NaN;
const fresh = (x, now) => Number.isFinite(time(x)) && time(x) >= now - 30000 && time(x) <= now + 5000;
const fixture = x => x?.fixture_classification != null || x?.synthetic === true ||
  x?.staging === true || x?.untrusted === true;
function ownerValid(o, ownerId, epoch, now) {
  return !!o && typeof o === 'object' && !fixture(o) &&
    o.schema === 'metaengine.host.owner-incarnation.v1' &&
    o.source === 'LOCAL_HOST_OWNER' && o.authority_effect === false &&
    o.owner_id === ownerId && o.epoch === epoch &&
    ID.test(o.owner_id || '') && ID.test(o.device_id || '') &&
    ID.test(o.project_id || '') && ID.test(o.process_incarnation_id || '') &&
    SHA.test(o.source_sha || '') &&
    Number.isSafeInteger(o.pid) && o.pid > 0 &&
    Number.isSafeInteger(o.generation) && o.generation > 0 &&
    Number.isSafeInteger(o.epoch) && o.epoch > 0 &&
    Number.isFinite(time(o.created_at)) && fresh(o.observed_at, now);
}
function sameOwner(a, b) {
  return ['owner_id','device_id','project_id','pid','created_at','generation',
    'epoch','process_incarnation_id','source_sha'].every(k => a[k] === b[k]);
}
function validRow(row, now) {
  return row && Number.isFinite(time(row.observed_at)) &&
    Number.isFinite(time(row.postgres_started_at)) &&
    time(row.postgres_started_at) > 0 && time(row.postgres_started_at) <= time(row.observed_at) &&
    fresh(row.observed_at, now) && row.schema_present === true &&
    row.project_table_present === true && Number.isSafeInteger(row.server_version_num) &&
    row.server_version_num >= 170000 && row.server_version_num < 180000 &&
    typeof row.database_name === 'string' && /^[A-Za-z0-9_]{1,63}$/.test(row.database_name);
}
function samePostmaster(a, b) {
  return time(a.postgres_started_at) === time(b.postgres_started_at) &&
    a.database_name === b.database_name && a.server_version_num === b.server_version_num &&
    a.schema_present === b.schema_present && a.project_table_present === b.project_table_present;
}

// `transaction` is the EXISTING db-api private transaction wrapper over its
// trusted own-PG connection. `trustedOwnerReadback` is a Host-only in-process
// readback installed by W60. A public caller supplies only ownerId/epoch
// *selectors*, never evidence, credentials, connection strings or SQL.
export function bindOwnPostgresBirthProviderW61({ transaction, trustedOwnerReadback,
  now = Date.now } = {}) {
  if (typeof transaction !== 'function' || typeof trustedOwnerReadback !== 'function' ||
      typeof now !== 'function') return null;
  return async function readOwnPostgresBirth(ownerId, epoch) {
    if (!ID.test(ownerId || '') || !Number.isSafeInteger(epoch) || epoch < 1) return null;
    try {
      const before = await trustedOwnerReadback();
      if (!ownerValid(before, ownerId, epoch, now())) return null;
      const firstRows = await transaction(tx => tx.unsafe(OWN_PG_BIRTH_SQL_W61), { readOnly: true });
      const between = await trustedOwnerReadback();
      if (!ownerValid(between, ownerId, epoch, now()) || !sameOwner(before, between) ||
          !Array.isArray(firstRows) || firstRows.length !== 1 || !validRow(firstRows[0], now())) return null;
      // Separate transaction: a restart or Owner handoff between reads is
      // observable, not silently hidden in a single repeatable-read snapshot.
      const lastRows = await transaction(tx => tx.unsafe(OWN_PG_BIRTH_SQL_W61), { readOnly: true });
      const after = await trustedOwnerReadback();
      if (!ownerValid(after, ownerId, epoch, now()) || !sameOwner(before, after) ||
          !Array.isArray(lastRows) || lastRows.length !== 1 ||
          !validRow(lastRows[0], now()) || !samePostmaster(firstRows[0], lastRows[0])) return null;
      return Object.freeze({
        schema: 'metaengine.own-pg.birth-w61.v1', source: 'OWN_PG_POSTMASTER_READBACK',
        owner_id: ownerId, owner_epoch: epoch, owner_generation: before.generation,
        owner_process_incarnation_id: before.process_incarnation_id,
        owner_device_id: before.device_id, owner_project_id: before.project_id,
        source_sha: before.source_sha.toLowerCase(),
        postgres_started_at: new Date(time(lastRows[0].postgres_started_at)).toISOString(),
        observed_at: new Date(time(lastRows[0].observed_at)).toISOString(),
        database_name: lastRows[0].database_name,
        server_version_num: lastRows[0].server_version_num,
        schema_present: true, project_table_present: true,
        installed_owner_proven: false, upgrade_authorized: false,
        automatic_retry_allowed: false, authority_effect: false,
      });
    } catch { return null; } // SQL privilege/timeout/Owner death is UNKNOWN.
  };
}
