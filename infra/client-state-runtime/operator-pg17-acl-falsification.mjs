// W12: isolated, read-only conformance probe. Not wired to the live HTTP API.
// A caller MUST supply an independently disposable/self-operated PG17 connection.
// No DDL, migrations, network bootstrap, credential loading or fallback transport.
export const OPERATOR_PG17_REQUIRED_TABLES = Object.freeze([
  'project_run_h205f22', 'project_task_h205f22',
  'devos_fleet_task_h205f22', 'devos_fleet_claim_h205f22',
  'project_event_h205f22',
]);

export const OPERATOR_PG17_ROLE_SQL = `
SELECT current_database() AS database_name,
  current_setting('server_version_num')::int AS server_version,
  current_setting('transaction_isolation') AS isolation,
  current_setting('transaction_read_only') AS read_only,
  session_user::text AS login, current_user::text AS effective_role,
  r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb,
  r.rolcreaterole, r.rolreplication, r.rolbypassrls,
  EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS member_of_any_role,
  pg_catalog.has_schema_privilege(current_user, 'destruktion_meta', 'USAGE') AS schema_usage
FROM pg_catalog.pg_roles r WHERE r.rolname = session_user LIMIT 2`;

// Fixed catalog names only: never interpolate identifiers, role names, or SQL from input.
export const OPERATOR_PG17_TABLE_SQL = `
SELECT v.name,
  pg_catalog.to_regclass('destruktion_meta.' || v.name) IS NOT NULL AS present,
  (SELECT c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
     FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass('destruktion_meta.' || v.name)) AS owns_relation,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'SELECT') AS can_select,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'INSERT') AS can_insert,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'UPDATE') AS can_update,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'DELETE') AS can_delete,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'TRUNCATE') AS can_truncate,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'REFERENCES') AS can_references,
  pg_catalog.has_table_privilege(current_user, 'destruktion_meta.' || v.name, 'TRIGGER') AS can_trigger
FROM (VALUES ('project_run_h205f22'), ('project_task_h205f22'),
  ('devos_fleet_task_h205f22'), ('devos_fleet_claim_h205f22'),
  ('project_event_h205f22')) AS v(name) ORDER BY v.name`;

// Extra privileges anywhere in non-system schemas defeat the bounded reader claim.
// Advisory only: EXECUTE on unreviewed functions and default PUBLIC grants still
// require a separate ACL/security-definer review before production promotion.
export const OPERATOR_PG17_WIDE_WRITE_SQL = `
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND (pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT')
      OR pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE')
      OR pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE')
      OR pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE')
      OR pg_catalog.has_table_privilege(current_user, c.oid, 'TRIGGER'))
) AS can_write_any_table,
EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
    AND NOT (n.nspname = 'destruktion_meta' AND c.relname IN
      ('project_run_h205f22', 'project_task_h205f22', 'devos_fleet_task_h205f22',
       'devos_fleet_claim_h205f22', 'project_event_h205f22'))
) AS can_read_unapproved_table,
EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'S'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND (pg_catalog.has_sequence_privilege(current_user, c.oid, 'USAGE')
      OR pg_catalog.has_sequence_privilege(current_user, c.oid, 'UPDATE'))
) AS can_advance_any_sequence`;

const identifier = s => typeof s === 'string' && /^[a-z][a-z0-9_]{3,62}$/.test(s);
const unknown = () => ({ schema: 'metaengine.operator.pg17-acl-falsification.v1',
  state: 'UNKNOWN', authority_effect: false, physical_pg17: 'UNVERIFIED' });
const denied = () => ({ ...unknown(), state: 'DENIED' });
const qualified = () => ({ ...unknown(), state: 'SOURCE_CONFORMANT' });
const only = rows => Array.isArray(rows) && rows.length === 1 ? rows[0] : null;

// A successful probe is only conformance of a scoped role during this *one*
// transaction, not proof of installed Owner/Guardian/host or production ACLs.
export async function auditOperatorPg17ReadOnlyAcl({ sql, expectedDatabase, expectedLogin } = {}) {
  if (!sql || typeof sql.begin !== 'function' || !identifier(expectedDatabase)
    || !identifier(expectedLogin) || expectedLogin === 'postgres'
    || expectedLogin === 'service_role') return unknown();
  try {
    return await sql.begin(async tx => {
      if (!tx || typeof tx.unsafe !== 'function') return unknown();
      // First command after BEGIN, before any read, pins the only MVCC snapshot.
      await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.unsafe("SET LOCAL statement_timeout = '3s'");
      await tx.unsafe("SET LOCAL lock_timeout = '1s'");
      const role = only(await tx.unsafe(OPERATOR_PG17_ROLE_SQL));
      if (!role) return unknown();
      if (Number(role.server_version) < 170000 || Number(role.server_version) >= 180000
        || role.database_name !== expectedDatabase || role.login !== expectedLogin
        || role.effective_role !== expectedLogin || role.isolation !== 'repeatable read'
        || role.read_only !== 'on') return denied();
      if (role.rolcanlogin !== true || role.rolinherit !== false
        || role.rolsuper !== false || role.rolcreatedb !== false
        || role.rolcreaterole !== false || role.rolreplication !== false
        || role.rolbypassrls !== false || role.member_of_any_role !== false
        || role.schema_usage !== true) return denied();
      const tables = await tx.unsafe(OPERATOR_PG17_TABLE_SQL);
      if (!Array.isArray(tables) || tables.length !== OPERATOR_PG17_REQUIRED_TABLES.length) return unknown();
      const names = new Set();
      for (const row of tables) {
        if (!row || !OPERATOR_PG17_REQUIRED_TABLES.includes(row.name) || names.has(row.name)) return denied();
        names.add(row.name);
        if (row.present !== true || row.can_select !== true || row.owns_relation !== false) return denied();
        if (['can_insert','can_update','can_delete','can_truncate','can_references','can_trigger']
          .some(key => row[key] !== false)) return denied();
      }
      const wide = only(await tx.unsafe(OPERATOR_PG17_WIDE_WRITE_SQL));
      if (!wide) return unknown();
      if (wide.can_write_any_table !== false || wide.can_read_unapproved_table !== false
        || wide.can_advance_any_sequence !== false) return denied();
      return qualified();
    });
  } catch {
    // Database errors, insufficient catalog access, and timeout do not grant trust.
    // Never return raw errors, SQL, DSNs, secrets or a hosted endpoint.
    return unknown();
  }
}
