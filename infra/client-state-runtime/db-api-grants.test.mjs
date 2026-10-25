import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY } from './db-api-core.mjs';
import { localApiRolePolicyName, provisionLocalApiLogin, refreshLocalApiRpcGrants } from './db-api-grants.mjs';

const credentials = { databaseName: 'postgres', login: 'fixture_api', password: 'a'.repeat(64), roleMode: 'direct' };

test('operator CLIs report a missing DB driver without raw dependency paths or credentials',()=>{
  for(const [name,event] of [['db-api-grants','local_state_api_grants_failed'],['local-runtime-migrations','local_runtime_migration_failed']]){
    const moduleUrl=new URL('./'+name+'.mjs',import.meta.url);
    const code=[
      'import {registerHooks} from "node:module";',
      'registerHooks({resolve(specifier,context,nextResolve){if(specifier==="postgres")throw Object.assign(Error("private_dependency_path_and_password"),{code:"ERR_MODULE_NOT_FOUND"});return nextResolve(specifier,context);}});',
      'process.argv=[process.execPath,'+JSON.stringify(fileURLToPath(moduleUrl))+'];',
      'process.env.LOCAL_STATE_ADMIN_DATABASE_URL="postgres://private_api:private_url_password@127.0.0.1:35432/metaengine";',
      'await import('+JSON.stringify(moduleUrl.href)+');',
    ].join('\n');
    const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(result.status,1);
    assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{event,code:'dependency_unavailable'});
  }
});

test('direct policy names are bounded deterministic role identities', () => {
  assert.match(localApiRolePolicyName('fixture_api', 'select'), /^compute_api_[a-f0-9]{24}_select$/);
  assert.notEqual(localApiRolePolicyName('fixture_api', 'select'), localApiRolePolicyName('other_api', 'select'));
});

test('role provisioning rejects incomplete or overloaded catalog before role DDL', async () => {
  for (const signatures of [[], RPC_ALLOWLIST.map(name => ({ name })).concat({ name: RPC_ALLOWLIST[0] })]) {
    const calls = [];
    const tx = { unsafe: async query => {
      calls.push(query);
      if (query === RPC_CATALOG_QUERY) return signatures;
      if (query.includes('current_database()')) return [{ name: 'postgres' }];
      return [];
    } };
    await assert.rejects(provisionLocalApiLogin({ ...credentials, sql: { begin: run => run(tx) } }), /local_api_rpc_catalog_(incomplete|overloaded)/);
    assert(!calls.some(query => query.includes('CREATE ROLE') || query.startsWith('GRANT')));
  }
});

test('role mode and target database validation reject before any grants', async () => {
  let opened = 0;
  await assert.rejects(provisionLocalApiLogin({ ...credentials, roleMode: 'admin', sql: { begin: () => { opened++; } } }), /role_mode_invalid/);
  assert.equal(opened, 0);
  const tx = { unsafe: async query => query.includes('current_database()') ? [{ name: 'other_database' }] : [] };
  await assert.rejects(provisionLocalApiLogin({ ...credentials, sql: { begin: run => run(tx) } }), /database_name_mismatch/);
});

function refreshFixture({ unsafeRole = false, overloaded = false, grantable = false, omitReadback = false } = {}) {
  const statements = [];
  const signatures = RPC_ALLOWLIST.map((name, index) => ({ oid: String(index + 100), name, args: [{ typeSchema: 'pg_catalog', typeName: 'uuid' }] }));
  const missing = new Set(['native_coding_admission_context_v1', 'native_coding_execution_context_v1']);
  const tx = { unsafe: async (query, values) => {
    statements.push({ query, values });
    if (query === 'SELECT current_database() AS name') return [{ name: 'postgres' }];
    if (query.includes('r.oid::text AS oid')) return [{ oid: '42', rolcanlogin: true, rolinherit: false, rolsuper: unsafeRole,
      rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: 0, connect: true, database_create: false }];
    if (query === RPC_CATALOG_QUERY) return overloaded ? signatures.concat(signatures[0]) : signatures;
    if (query.includes('AS direct_grant')) return signatures.map(row => ({ oid: row.oid, name: row.name, direct_grant: !missing.has(row.name), grantable }));
    if (query.startsWith('GRANT EXECUTE')) {
      const row = signatures.find(value => query.includes('"' + value.name + '"'));
      assert(row); if (!omitReadback) missing.delete(row.name);
    }
    return [];
  } };
  return { statements, run: () => refreshLocalApiRpcGrants({ ...credentials, sql: { begin: run => run(tx) } }) };
}

test('direct API upgrade adds only missing allowlisted RPC EXECUTE, leaves credentials/role/table policies untouched and is idempotent', async () => {
  const f = refreshFixture(), receipt = await f.run();
  assert.equal(receipt.functions_granted, 2);
  assert.equal(receipt.credentials_modified, false); assert.equal(receipt.memberships_modified, false);
  const grants = f.statements.filter(row => row.query.startsWith('GRANT'));
  assert.equal(grants.length, 2);
  assert(grants.every(row => /^GRANT EXECUTE ON FUNCTION "public"\."native_coding_(admission|execution)_context_v1"\("pg_catalog"\."uuid"\) TO "fixture_api"$/.test(row.query)));
  assert(!f.statements.some(row => /CREATE ROLE|ALTER ROLE|CREATE POLICY|ON TABLE|GRANT service_role|PASSWORD/.test(row.query)));
  assert(!f.statements.some(row => row.values?.includes(credentials.password)));
  const next = await f.run(); assert.equal(next.functions_granted, 0);
  assert.equal(f.statements.filter(row => row.query.startsWith('GRANT')).length, 2);
});

test('existing API refresh rejects elevated role, overload, grant option and lost grant readback', async () => {
  for (const options of [{ unsafeRole: true }, { overloaded: true }, { grantable: true }, { omitReadback: true }]) {
    const f = refreshFixture(options);
    await assert.rejects(f.run(), /restricted_role_required|catalog_incomplete_or_overloaded|grants_require_review|grants_readback_failed/);
    if (!options.omitReadback) assert(!f.statements.some(row => row.query.startsWith('GRANT')));
  }
  let opened = false;
  await assert.rejects(refreshLocalApiRpcGrants({ ...credentials, roleMode: 'service_role', sql: { begin: () => { opened = true; } } }), /refresh_direct_role_required/);
  assert.equal(opened, false);
});
