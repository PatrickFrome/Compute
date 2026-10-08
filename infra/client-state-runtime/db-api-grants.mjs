import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST, quoteIdentifier } from './db-api-core.mjs';

export async function provisionLocalApiLogin({ sql, databaseName, login, password }) {
  if (!/^[a-z][a-z0-9_]{3,62}$/.test(login) || typeof password !== 'string' || password.length < 32) throw new Error('local_api_credentials_invalid');
  if (!databaseName) throw new Error('local_api_database_name_required');
  return sql.begin(async (tx) => {
    const signatures = await tx.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
    const missing = RPC_ALLOWLIST.filter((name) => !signatures.some((signature) => signature.name === name));
    if (missing.length) throw new Error('local_api_rpc_catalog_incomplete:' + missing.join(','));
    const exists = await tx.unsafe('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [login]);
    if (exists.length) throw new Error('local_api_role_already_exists');
    // Server-side format quotes the password as a SQL literal without logging it.
    const rows = await tx.unsafe("SELECT pg_catalog.format('CREATE ROLE %I LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS command", [login, password]);
    await tx.unsafe(rows[0].command);
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(login)}`);
    await tx.unsafe(`GRANT service_role TO ${quoteIdentifier(login)} WITH INHERIT FALSE, SET TRUE`);
    await tx.unsafe('GRANT USAGE ON SCHEMA public, extensions TO service_role');
    for (const [table, policy] of Object.entries(TABLE_ALLOWLIST)) {
      await tx.unsafe(`GRANT SELECT ON TABLE "public".${quoteIdentifier(table)} TO service_role`);
      if (policy.insert) await tx.unsafe(`GRANT INSERT (${policy.insert.map(quoteIdentifier).join(', ')}) ON TABLE "public".${quoteIdentifier(table)} TO service_role`);
    }
    for (const signature of signatures) {
      const types = signature.args.map((arg) => quoteIdentifier(arg.typeSchema) + '.' + quoteIdentifier(arg.typeName)).join(', ');
      await tx.unsafe(`GRANT EXECUTE ON FUNCTION "public".${quoteIdentifier(signature.name)}(${types}) TO service_role`);
    }
    await tx.unsafe(`ALTER ROLE ${quoteIdentifier(login)} IN DATABASE ${quoteIdentifier(databaseName)} SET search_path = pg_catalog, public, extensions`);
    return { login, database: databaseName, tables: Object.keys(TABLE_ALLOWLIST).length, functions: signatures.length, inherits_service_role: false };
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
