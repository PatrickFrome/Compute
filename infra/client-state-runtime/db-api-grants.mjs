import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST, quoteIdentifier } from './db-api-core.mjs';

export function localApiRolePolicyName(login, operation) {
  return 'compute_api_' + createHash('sha256').update(login).digest('hex').slice(0, 24) + '_' + operation;
}

export async function provisionLocalApiLogin({ sql, databaseName, login, password, roleMode = 'service_role' }) {
  if (!/^[a-z][a-z0-9_]{3,62}$/.test(login) || typeof password !== 'string' || password.length < 32) throw new Error('local_api_credentials_invalid');
  if (typeof databaseName !== 'string' || !databaseName || databaseName.includes('\0')) throw new Error('local_api_database_name_required');
  if (!['service_role', 'direct'].includes(roleMode)) throw new Error('local_api_role_mode_invalid');
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    const [database] = await tx.unsafe('SELECT current_database() AS name');
    if (database?.name !== databaseName) throw new Error('local_api_database_name_mismatch');
    const signatures = await tx.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
    const missing = RPC_ALLOWLIST.filter((name) => !signatures.some((signature) => signature.name === name));
    if (missing.length) throw new Error('local_api_rpc_catalog_incomplete:' + missing.join(','));
    if (signatures.length !== RPC_ALLOWLIST.length) throw new Error('local_api_rpc_catalog_overloaded');
    const exists = await tx.unsafe('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [login]);
    if (exists.length) throw new Error('local_api_role_already_exists');
    // Server-side format quotes the password as a SQL literal. The onboarding
    // transaction separately disables credential-bearing statement/parameter logs.
    const rows = await tx.unsafe("SELECT pg_catalog.format('CREATE ROLE %I LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS command", [login, password]);
    await tx.unsafe(rows[0].command);
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(login)}`);
    const authority = roleMode === 'direct' ? quoteIdentifier(login) : 'service_role';
    if (roleMode === 'service_role') await tx.unsafe(`GRANT service_role TO ${quoteIdentifier(login)} WITH INHERIT FALSE, SET TRUE`);
    await tx.unsafe(`GRANT USAGE ON SCHEMA public, extensions TO ${authority}`);
    for (const [table, policy] of Object.entries(TABLE_ALLOWLIST)) {
      const qualified = '"public".' + quoteIdentifier(table);
      const columns = [...new Set([...policy.select, ...policy.filters, ...policy.order])];
      await tx.unsafe(`GRANT SELECT ${roleMode === 'direct' ? '(' + columns.map(quoteIdentifier).join(', ') + ') ' : ''}ON TABLE ${qualified} TO ${authority}`);
      if (policy.insert) await tx.unsafe(`GRANT INSERT (${policy.insert.map(quoteIdentifier).join(', ')}) ON TABLE ${qualified} TO ${authority}`);
      if (roleMode === 'direct') {
        const [relation] = await tx.unsafe('SELECT relrowsecurity AS enabled FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass($1::text)', ['public.' + table]);
        if (relation?.enabled) {
          // Role-scoped policies give only the exposed relation operations; the login still cannot bypass RLS.
          await tx.unsafe(`CREATE POLICY ${quoteIdentifier(localApiRolePolicyName(login, 'select'))} ON ${qualified} FOR SELECT TO ${authority} USING (true)`);
          if (policy.insert) await tx.unsafe(`CREATE POLICY ${quoteIdentifier(localApiRolePolicyName(login, 'insert'))} ON ${qualified} FOR INSERT TO ${authority} WITH CHECK (true)`);
        }
      }
    }
    for (const signature of signatures) {
      const types = signature.args.map((arg) => quoteIdentifier(arg.typeSchema) + '.' + quoteIdentifier(arg.typeName)).join(', ');
      await tx.unsafe(`GRANT EXECUTE ON FUNCTION "public".${quoteIdentifier(signature.name)}(${types}) TO ${authority}`);
    }
    await tx.unsafe(`ALTER ROLE ${quoteIdentifier(login)} IN DATABASE ${quoteIdentifier(databaseName)} SET search_path = pg_catalog, public, extensions`);
    const [role] = await tx.unsafe(`SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS memberships
      FROM pg_catalog.pg_roles r WHERE rolname=$1`, [login]);
    if (!role?.rolcanlogin || role.rolinherit || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls
      || role.memberships !== (roleMode === 'direct' ? 0 : 1)) throw new Error('local_api_restricted_role_readback_failed');
    return { login, database: databaseName, tables: Object.keys(TABLE_ALLOWLIST).length, functions: signatures.length,
      role_mode: roleMode, inherits_service_role: false, can_set_service_role: roleMode === 'service_role',
      shared_service_role_grants_modified: roleMode === 'service_role', column_scoped_grants: roleMode === 'direct' };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.LOCAL_STATE_ADMIN_DATABASE_URL;
  if (!databaseUrl) throw new Error('local_state_admin_database_url_required');
  const parsed = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('local_state_loopback_database_required');
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const result = await provisionLocalApiLogin({ sql, databaseName: decodeURIComponent(parsed.pathname.slice(1)), login: process.env.LOCAL_STATE_API_DB_LOGIN || 'local_state_api', password: process.env.LOCAL_STATE_API_DB_PASSWORD });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: 'local_state_api_grants_failed', code: error?.code || 'provisioning_failed' }));
    process.exitCode = 1;
  } finally { await sql.end({ timeout: 5 }); }
}
