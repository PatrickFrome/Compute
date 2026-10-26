// TEST SUPPORT ONLY. Factories own and destroy each new disposable cluster.
// Exact historical sources contain COMMIT: whole-baseline rollback is NOT possible.
// Not an installer or an activation producer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { loadFreshSchemaCandidatePlan, FRESH_SCHEMA_OCCUPANCY_QUERY } from '../fresh-schema-plan.mjs';
import { applyLocalRuntimeMigrations } from '../local-runtime-migrations.mjs';
import { RPC_ALLOWLIST, TABLE_ALLOWLIST, RPC_CATALOG_QUERY } from '../db-api-core.mjs';
import { provisionLocalApiLogin } from '../db-api-grants.mjs';
import { inspectAttachedApiAdmission } from '../attached-postgres-onboarding.mjs';
const root = new URL('../../../', import.meta.url);
const heartbeat = 'public.h205f22_a2_supervisor_mesh_heartbeat_v1(text,text,text)';

export function assertEmptyApplicationSchema(rows) {
  // postgres.js returns Result extends Array, whereas PGlite returns Array.
  // Freshness is determined by rows, never by a driver's result prototype.
  assert.ok(Array.isArray(rows), 'invalid application schema result');
  assert.equal(rows.length, 0, 'refuse partial/nonempty application schema');
}

async function qualifyDisposableFreshSchema({ sql, engine } = {}) {
  if (!['NATIVE_PG17', 'WASM_SQL18_ONLY'].includes(engine)) throw new Error('qualification_engine_required');
  const plan = await loadFreshSchemaCandidatePlan();
  // Session lock survives explicit historical COMMIT; connection is factory-owned.
  await sql.unsafe("SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0))");
  let version;
  await sql.begin(async tx => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '60s'");
    await tx.unsafe("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0))");
    [version] = await tx.unsafe("select current_setting('server_version_num')::int as value");
    assert.equal(Math.floor(Number(version.value) / 10000), engine === 'NATIVE_PG17' ? 17 : 18);
    assertEmptyApplicationSchema(await tx.unsafe(FRESH_SCHEMA_OCCUPANCY_QUERY));
  });
  const tx = sql;
  // Caller provides a newly allocated disposable cluster, never an attached DB.
  await tx.unsafe('create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema extensions; create extension pgcrypto with schema extensions; create schema destruktion_meta');
  for (const entry of plan.baseline) {
    const bytes = await readFile(new URL(entry.path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    await tx.unsafe(bytes.toString('utf8'));
  }
  const connection = sql;
  await applyLocalRuntimeMigrations({ sql: connection, expectedMigrationSourcesSha256: plan.upgrade_sources_sha256 });
  const repeat = await applyLocalRuntimeMigrations({ sql: connection, expectedMigrationSourcesSha256: plan.upgrade_sources_sha256 });
  assert(repeat.migrations.every(m => m.status === 'ALREADY_PRESENT_NOT_MODIFIED'));
  const catalog = await tx.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
  assert.equal(plan.rpc_signatures.length, RPC_ALLOWLIST.length);
  for (const signature of plan.rpc_signatures) {
    const name = signature.slice(7, signature.indexOf('('));
    const matches = catalog.filter(r => r.name === name);
    const [row] = await tx.unsafe('select to_regprocedure($1)::oid::text as oid', [signature]);
    assert.equal(matches.length, 1, signature);
    assert.equal(String(matches[0].oid), row.oid, signature);
  }
  let columns = 0;
  for (const [table, policy] of Object.entries(TABLE_ALLOWLIST)) {
    const found = await tx.unsafe("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table]);
    for (const column of new Set(Object.values(policy).flat())) {
      assert(found.some(r => r.column_name === column), `${table}.${column}`); columns++;
    }
  }
  // Narrow proposed FRESH-ONLY ACL correction; never applied to attached DBs.
  // PUBLIC includes direct API logins; no arbitrary historical function removal.
  await tx.unsafe(`revoke execute on function ${heartbeat} from public`);
  await tx.unsafe('create role fresh_candidate_probe nologin');
  const [acl] = await tx.unsafe('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', ['fresh_candidate_probe', heartbeat]);
  assert.equal(acl.allowed, false);
  const [identity] = await tx.unsafe('select current_database() as database, session_user::text as login');
  await provisionLocalApiLogin({sql,databaseName:identity.database,login:'fresh_candidate_api',password:randomBytes(32).toString('hex'),roleMode:'direct'});
  const admission = await sql.begin(async connection => {
    await connection.unsafe('set local role fresh_candidate_api');
    return inspectAttachedApiAdmission({sql:connection,apiLogin:'fresh_candidate_api',expectedSessionLogin:identity.login});
  });
  const [effective] = await tx.unsafe('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', ['fresh_candidate_api',heartbeat]);
  assert.equal(effective.allowed,false,'direct API must not inherit heartbeat EXECUTE');
  await assert.rejects(sql.begin(async connection => {
    await connection.unsafe('set local role fresh_candidate_api');
    await connection.unsafe('select public.h205f22_a2_supervisor_mesh_heartbeat_v1(null,null,null)');
  }), error => error.code === '42501');
  const [state] = await tx.unsafe("select public.devos_environment_state_v1('11111111-1111-4111-8111-111111111111'::uuid) as value");
  assert.equal(state.value.refill_enabled, false); assert.equal(state.value.supervisor_admission_enabled, false);
  const tables = await tx.unsafe("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','destruktion_meta')");
  for (const table of tables) {
    const quote = s => '"' + s.replaceAll('"', '""') + '"';
    const [count] = await tx.unsafe(`select count(*)::int as value from ${quote(table.nspname)}.${quote(table.relname)}`);
    assert.equal(count.value, 0);
  }
  return { classification: engine, status: 'SCHEMA_CANDIDATE_CHECKS_PASSED', production_qualified: false,
    candidate_sha256: plan.candidate_sha256, postgres_version_num: version.value,
    ordered_applications: plan.baseline.length, exact_rpc_signatures: plan.rpc_signatures.length,
    direct_api_admission: admission, rest_tables: Object.keys(TABLE_ALLOWLIST).length, rest_column_map_checks: columns,
    empty_application_tables: tables.length, heartbeat_public_execute_revoked: true,
    application_rows_seeded: false, automatic_population_required: true,
    unresolved_dependencies: plan.unresolved_dependencies, atomic_baseline: false,
    cleanup_required: 'DESTROY_FACTORY_OWNED_DISPOSABLE_CLUSTER' };
}

// No raw SQL handle or connection URI is accepted by either public factory.
export async function qualifyFreshSchemaWasm({ moduleUrl, pgcryptoModuleUrl } = {}) {
  const { PGlite } = await import(moduleUrl);
  const { pgcrypto } = await import(pgcryptoModuleUrl);
  const db = new PGlite({ extensions: { pgcrypto } });
  const wrap = conn => ({ unsafe: async (query, args) => args?.length
    ? (await conn.query(query, args)).rows : (await conn.exec(query)).at(-1)?.rows ?? [],
    begin: callback => db.transaction(tx => callback(wrap(tx))) });
  try {
    const receipt = await qualifyDisposableFreshSchema({sql:wrap(db),engine:'WASM_SQL18_ONLY'});
    await assert.rejects(qualifyDisposableFreshSchema({sql:wrap(db),engine:'WASM_SQL18_ONLY'}), /refuse partial/);
    return receipt;
  } finally { await db.close(); }
}

// Exported pure check supports refusal tests; it confers no mutation capability.
export function assertDisposableIdentity(actual, expected) {
  if (actual.directory !== expected.directory || String(actual.system_identifier) !== String(expected.system_identifier)
    || Number(actual.pid) !== Number(expected.pid)) throw new Error('fresh_disposable_cluster_identity_mismatch');
}

// Read-only guard also works after SET LOCAL ROLE to the restricted API login.
// The initial privileged identity check plus reserved backend binds the server.
export async function assertReservedBackend(connection, expectedPid) {
  const [actual] = await connection.unsafe('select pg_backend_pid() as pid');
  if (Number(actual.pid) !== Number(expectedPid)) throw new Error('fresh_disposable_backend_changed');
}

export async function qualifyFreshSchemaNative({ bin, driver, base = os.tmpdir() } = {}) {
  if (!bin || !driver) throw new Error('fresh_disposable_binaries_required');
  const directory = await fs.mkdtemp(path.join(await fs.realpath(base), 'fresh-schema-pg17-'));
  const data = path.join(directory, 'data');
  const command = (name,args) => new Promise((resolve,reject) => {
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
      {windowsHide:true,stdio:['ignore','pipe','ignore'],shell:false,env:{...process.env,LC_ALL:'C'}});
    let output=''; child.stdout.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(Error('fresh_pg_command_timeout'));},90000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error('fresh_pg_command_failed:'+name));});
  });
  let started=false,sql,reserved;
  try {
    const listener=net.createServer();
    await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
    const port=listener.address().port; await new Promise(resolve=>listener.close(resolve));
    assert(![55432,55433,55434].includes(port));
    await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    const control=await command('pg_controldata',['-D',data]);
    const identifier=/Database system identifier:\s*(\d+)/.exec(control)?.[1];
    if(!identifier)throw Error('fresh_disposable_control_identity_missing');
    const expectedDirectory=await fs.realpath(data);
    started=true;
    await command('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:1,onnotice:()=>{},connect_timeout:5});
    reserved=await sql.reserve();
    const identityQuery="select current_setting('data_directory') as directory, system_identifier::text, pg_backend_pid() as pid from pg_control_system()";
    const [first]=await reserved.unsafe(identityQuery);
    const expected={directory:expectedDirectory,system_identifier:identifier,pid:first.pid};
    const check=async connection=>{
      const [actual]=await connection.unsafe(identityQuery);
      actual.directory=await fs.realpath(actual.directory);
      assertDisposableIdentity(actual,expected);
    };
    await check(reserved); // reject port races/misbinding BEFORE any mutation
    const wrap=connection=>({unsafe:async(...args)=>{await assertReservedBackend(connection,expected.pid);return connection.unsafe(...args);},
      begin:async callback=>{
        await assertReservedBackend(connection,expected.pid); await connection.unsafe('BEGIN');
        try { const value=await callback(wrap(connection)); await connection.unsafe('COMMIT'); return value; }
        catch(error) { await connection.unsafe('ROLLBACK'); throw error; }
      }});
    const receipt=await qualifyDisposableFreshSchema({sql:wrap(reserved),engine:'NATIVE_PG17'});
    return {...receipt, native_identity_verified:true};
  } finally {
    try { if(reserved)await reserved.release(); }
    finally {
      try { if(sql)await sql.end({timeout:5}); }
      finally {
        // Never remove a directory if stopping its cluster failed; surface that
        // failure rather than claiming cleanup or deleting running server files.
        if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
        await fs.rm(directory,{recursive:true,force:true});
      }
    }
  }
}
