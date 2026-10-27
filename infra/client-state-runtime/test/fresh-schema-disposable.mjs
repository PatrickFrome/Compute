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
import { loadFreshSchemaApplicationPlan, verifyFreshSchemaCatalogue } from '../fresh-schema-application-plan.mjs';
import { EMPTY_SCHEMA_MAX_ARCHIVE_BYTES, emptySchemaSha256, emptySchemaProcessEnvironment,
  runEmptySchemaCommand, inspectCanonicalEmptySchema, assertEmptySchemaRoundtrip,
  validateEmptySchemaToc, runEmptySchemaStage, combineEmptySchemaCleanupFailure } from '../canonical-empty-schema-contract.mjs';
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


async function qualifyAtomicFreshSchema({sql,engine,beforeApiProvision = null,stage = async (_name,action) => action()}) {
  const plan=await stage('SCHEMA_LOAD',() => loadFreshSchemaApplicationPlan());
  const [version]=await sql.unsafe("select current_setting('server_version_num')::int as value");
  assert.equal(Math.floor(Number(version.value)/10000),engine==='NATIVE_PG17'?17:18);
  const stages=['BASELINE','UPGRADES','ACL'];
  const apply=async(tx,stop)=>{
    assertEmptyApplicationSchema(await tx.unsafe(FRESH_SCHEMA_OCCUPANCY_QUERY));
    const [start]=await tx.unsafe('select txid_current()::text as id');
    await stage('BASELINE',async () => {
      await tx.unsafe(plan.prerequisite_sql);
      for(const statement of plan.statements)await tx.unsafe(statement.sql);
    });
    if(stop==='BASELINE')throw Error('intentional_atomic_rollback');
    const nested={unsafe:(...args)=>tx.unsafe(...args),begin:fn=>fn(tx)};
    await stage('UPGRADES',() => applyLocalRuntimeMigrations({sql:nested,expectedMigrationSourcesSha256:plan.upgrade_sources_sha256}));
    if(stop==='UPGRADES')throw Error('intentional_atomic_rollback');
    await stage('ACL',() => tx.unsafe(plan.post_upgrade_acl_sql));
    if(stop==='ACL')throw Error('intentional_atomic_rollback');
    const catalog=await stage('CATALOGUE_VERIFY',() => verifyFreshSchemaCatalogue({sql:tx,plan}));
    const [finish]=await tx.unsafe('select txid_current()::text as id');
    assert.equal(finish.id,start.id,'no included source may commit the owner transaction');
    return catalog;
  };
  for(const boundary of stages) {
    await stage('ROLLBACK_CHECK',async () => {
      await assert.rejects(sql.begin(tx=>apply(tx,boundary)),/intentional_atomic_rollback/);
      assertEmptyApplicationSchema(await sql.unsafe(FRESH_SCHEMA_OCCUPANCY_QUERY));
      const roles=await sql.unsafe("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");
      assert.equal(roles.length,0,'failed baseline must not leave cluster roles');
    });
  }
  const catalog=await stage('COMMIT',() => sql.begin(tx=>apply(tx)));
  await assert.rejects(sql.begin(tx=>apply(tx)),/refuse partial/);
  const repeat=await stage('REPEAT_UPGRADES',() => applyLocalRuntimeMigrations({sql,expectedMigrationSourcesSha256:plan.upgrade_sources_sha256}));
  assert(repeat.migrations.every(row=>row.status==='ALREADY_PRESENT_NOT_MODIFIED'));
  // Internal export hook: the canonical owner transaction is committed, repeat
  // upgrades are attested, and no temporary direct API role/ACL exists yet.
  if (beforeApiProvision) await beforeApiProvision({sql,plan,catalog});
  return stage('API_PROBES',async () => {
  const [identity]=await sql.unsafe('select current_database() as database,session_user::text as login');
  await provisionLocalApiLogin({sql,databaseName:identity.database,login:'atomic_fresh_api',password:randomBytes(32).toString('hex'),roleMode:'direct'});
  const admission=await sql.begin(async tx=>{
    await tx.unsafe('set local role atomic_fresh_api');
    return inspectAttachedApiAdmission({sql:tx,apiLogin:'atomic_fresh_api',expectedSessionLogin:identity.login});
  });
  for(const query of [
    'select public.h205f22_a2_supervisor_mesh_heartbeat_v1(null,null,null)',
    'select public.h205f22_a2_browser_device_enrollment_approve_v1(null)',
    "select public.h205f22_a2_browser_device_enroll_v1(null,null,null,null,null)",
  ])await assert.rejects(sql.begin(async tx=>{await tx.unsafe('set local role atomic_fresh_api');await tx.unsafe(query);}),e=>e.code==='42501');
  // PostgreSQL's global default PUBLIC EXECUTE must stay revoked for functions
  // created AFTER this baseline, not merely for functions already present.
  for (const schema of ['public','destruktion_meta']) {
    const name = schema + '.fresh_default_acl_probe';
    await sql.unsafe(`create function ${name}() returns integer language sql as $$select 1$$`);
    const [rights] = await sql.unsafe("select has_function_privilege('atomic_fresh_api',$1,'EXECUTE') as api, has_function_privilege('anon',$1,'EXECUTE') as anonymous", [name+'()']);
    assert.equal(rights.api,false,'new functions must not regain default PUBLIC execution');
    assert.equal(rights.anonymous,false,'anonymous role must not regain default PUBLIC execution');
    await assert.rejects(sql.begin(async tx=>{await tx.unsafe('set local role atomic_fresh_api');await tx.unsafe(`select ${name}()`);}),e=>e.code==='42501');
    await sql.unsafe(`drop function ${name}()`);
  }
  const extra=await sql.unsafe(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','destruktion_meta') and has_schema_privilege('atomic_fresh_api',n.oid,'USAGE')
    and has_function_privilege('atomic_fresh_api',p.oid,'EXECUTE')
    and not (n.nspname='public' and p.proname::text in (select jsonb_array_elements_text($1::jsonb)))`,[JSON.stringify(RPC_ALLOWLIST)]);
  assert.equal(extra.length,0,'no effective application function execution outside exact API list');
  const functions=await sql.unsafe("select n.nspname,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','destruktion_meta')");
  const available=new Set(functions.map(row=>row.nspname+'.'+row.proname));
  const optional=[];
  for(const fn of functions) {
    for(const call of fn.prosrc.matchAll(/\b((?:public|destruktion_meta|vault|realtime)\.[a-zA-Z_][a-zA-Z_0-9]*)\s*\(/g)) {
      if(available.has(call[1]))continue;
      const [relation]=await sql.unsafe('select to_regclass($1) is not null as present',[call[1]]);
      if(relation.present)continue; // INSERT relation(columns) is not a function call.
      assert.equal(fn.proname,'h205f22_a2_browser_cognitive_accept_v1','unexpected deferred function dependency');
      assert.equal(call[1],'realtime.send');optional.push(call[1]);
    }
    for(const ref of fn.prosrc.matchAll(/\b(from|join|using|update|insert\s+into|delete\s+from|references)\s+((?:public|destruktion_meta|vault|realtime)\.[a-zA-Z_][a-zA-Z_0-9]*)/gi)) {
      if(/^(from|join)$/i.test(ref[1])&&fn.prosrc.slice(ref.index+ref[0].length).trimStart().startsWith('('))continue;
      const [found]=await sql.unsafe('select to_regclass($1) is not null as present',[ref[2]]);
      if(found.present)continue;
      assert.equal(fn.proname,'h205f22_a2_browser_cognitive_accept_v1','unexpected deferred relation dependency');
      assert.equal(ref[2],'realtime.messages');optional.push(ref[2]);
    }
  }
  const tables=await sql.unsafe("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','destruktion_meta')");
  for(const table of tables){const q=s=>'"'+s.replaceAll('"','""')+'"';const [count]=await sql.unsafe(`select count(*)::int as n from ${q(table.nspname)}.${q(table.relname)}`);assert.equal(count.n,0);}
  return {classification:engine,status:'ATOMIC_SCHEMA_SLICE_CHECKS_PASSED',production_qualified:false,
    source_manifest_sha256:plan.source_manifest_sha256,postgres_version_num:version.value,catalog,direct_api_admission:admission,
    rollback_boundaries:stages,atomic_transaction:true,effective_extra_api_functions:extra.length,future_function_execute_denied:true,
    static_deferred_dependencies:[...new Set(optional)],
    empty_application_tables:tables.length,application_rows_seeded:false,automatic_population_required:true,
    native_owner_enrollment_qualified:false};
  });
}

// No raw SQL handle or connection URI is accepted by either public factory.
export async function qualifyFreshSchemaWasm({ moduleUrl, pgcryptoModuleUrl, applicationMode = 'HISTORICAL_CANDIDATE' } = {}) {
  if (!['HISTORICAL_CANDIDATE','ATOMIC_SLICE'].includes(applicationMode)) throw Error('fresh_test_mode_invalid');
  const { PGlite } = await import(moduleUrl);
  const { pgcrypto } = await import(pgcryptoModuleUrl);
  const db = new PGlite({ extensions: { pgcrypto } });
  const wrap = conn => ({ unsafe: async (query, args) => args?.length
    ? (await conn.query(query, args)).rows : (await conn.exec(query)).at(-1)?.rows ?? [],
    begin: callback => db.transaction(tx => callback(wrap(tx))) });
  try {
    if(applicationMode==='ATOMIC_SLICE'){
      await db.exec('create role state_owner superuser;set session authorization state_owner');
      return await qualifyAtomicFreshSchema({sql:wrap(db),engine:'WASM_SQL18_ONLY'});
    }
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

// exercise is trusted in-process TEST CODE only. It receives no connection
// factory/URI and can use only this newly owned, identity-checked cluster.
// A second independently reserved backend is opt-in for native concurrency tests.
export async function qualifyFreshSchemaNative({ bin, driver, base = os.tmpdir(), applicationMode = 'HISTORICAL_CANDIDATE', exercise = null, exerciseBackends = 1 } = {}) {
  return runFreshSchemaNative({bin,driver,base,applicationMode,exercise,exerciseBackends});
}

// archiveOperation is private to the paired factory below. The public qualifier
// cannot inject it, an existing archive, credentials or an attached database.
async function runFreshSchemaNative({ bin, driver, base = os.tmpdir(), applicationMode = 'HISTORICAL_CANDIDATE', exercise = null, exerciseBackends = 1, archiveOperation = null } = {}) {
  if(exercise!==null && typeof exercise!=='function')throw Error('fresh_test_exercise_invalid');
  if(![1,2].includes(exerciseBackends)||(exerciseBackends!==1&&!exercise))throw Error('fresh_test_backend_count_invalid');
  if (!['HISTORICAL_CANDIDATE','ATOMIC_SLICE'].includes(applicationMode)) throw Error('fresh_test_mode_invalid');
  if (!bin || !driver) throw new Error('fresh_disposable_binaries_required');
  const phase = archiveOperation?.kind === 'RESTORE' ? 'RESTORE' : 'SOURCE';
  const stage = (name,action) => archiveOperation ? runEmptySchemaStage(phase + '_' + name,action) : action();
  const directory = await stage('DIRECTORY_CREATE',async () => fs.mkdtemp(path.join(await fs.realpath(base), 'fresh-schema-pg17-')));
  const data = path.join(directory, 'data');
  const password = randomBytes(32).toString('hex');
  const passwordFile = path.join(directory, 'private-owner-password');
  const defaultCommand = (name,args) => new Promise((resolve,reject) => {
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
      {windowsHide:true,stdio:['ignore','pipe','ignore'],shell:false,env:{...process.env,LC_ALL:'C'}});
    let output=''; child.stdout.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(Error('fresh_pg_command_timeout'));},90000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error('fresh_pg_command_failed:'+name));});
  });
  const command = archiveOperation
    ? async (name,args,extraEnv={}) => stage(name === 'pg_ctl' ? (args.includes('stop') ? 'STOP' : 'START')
      : name === 'pg_restore' ? (args.includes('--list') ? 'TOC_READ' : 'RESTORE')
      : {initdb:'INITDB',pg_controldata:'CONTROL_READ',pg_dump:'DUMP'}[name],async () =>
      (await runEmptySchemaCommand(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
        {env:emptySchemaProcessEnvironment(extraEnv)})).toString('utf8'))
    : defaultCommand;
  let started=false,sql,reserved,archiveEvidence,primaryFailure=null;
  const reservedConnections=[];
  try {
    const port=await stage('PORT_RESERVE',async () => {
      const listener=net.createServer();
      await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
      const selected=listener.address().port; await new Promise(resolve=>listener.close(resolve));
      assert(![55432,55433,55434].includes(selected));
      return selected;
    });
    await stage('PASSWORD_FILE',() => fs.writeFile(passwordFile,password+'\n',{flag:'wx',mode:0o600}));
    await command('initdb',['-D',data,'--username=state_owner','--auth=scram-sha-256','--pwfile='+passwordFile,'--no-locale','--encoding=UTF8','--no-sync']);
    const control=await command('pg_controldata',['-D',data]);
    const identifier=/Database system identifier:\s*(\d+)/.exec(control)?.[1];
    if(!identifier)throw Error('fresh_disposable_control_identity_missing');
    const expectedDirectory=await stage('IDENTITY_CHECK',() => fs.realpath(data));
    started=true;
    await command('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`,'-w','start']);
    await stage('DRIVER_CONNECT',async () => {
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',password,database:'postgres',max:exerciseBackends,onnotice:()=>{},connect_timeout:5,
      // Shared SQL fixtures pass serialized JSON text, just as PGlite.query
      // accepts. postgres.js otherwise JSON.stringify's it a second time when
      // PostgreSQL infers a json/jsonb parameter, silently changing its shape.
      // Keep this adapter test-only; production callers use sql.json(value).
      types:{fixtureJson:{to:114,from:[114,3802],
        serialize:value=>typeof value==='string'?value:JSON.stringify(value),parse:JSON.parse}}});
    reserved=await sql.reserve();reservedConnections.push(reserved);
    });
    const identityQuery="select current_setting('data_directory') as directory, system_identifier::text, pg_backend_pid() as pid from pg_control_system()";
    const [first]=await stage('IDENTITY_CHECK',() => reserved.unsafe(identityQuery));
    const expected={directory:expectedDirectory,system_identifier:identifier,pid:first.pid};
    const check=async(connection,identity=expected)=>stage('IDENTITY_CHECK',async () => {
      const [actual]=await connection.unsafe(identityQuery);
      actual.directory=await fs.realpath(actual.directory);
      assertDisposableIdentity(actual,identity);
    });
    await check(reserved); // reject port races/misbinding BEFORE any mutation
    if (archiveOperation?.kind === 'RESTORE') {
      assert.notEqual(expected.system_identifier,archiveOperation.sourceIdentity.system_identifier,'restore requires a second new cluster');
      assert.notEqual(expected.directory,archiveOperation.sourceIdentity.directory,'restore must not reuse the source directory');
    }
    const wrap=(connection,pid=expected.pid)=>({unsafe:async(...args)=>{await assertReservedBackend(connection,pid);return connection.unsafe(...args);},
      begin:async callback=>{
        await assertReservedBackend(connection,pid); await connection.unsafe('BEGIN');
        try { const value=await callback(wrap(connection,pid)); await connection.unsafe('COMMIT'); return value; }
        catch(error) { await connection.unsafe('ROLLBACK'); throw error; }
      }});
    const privateConnectionArgs = ['--host=127.0.0.1','--port='+port,'--username=state_owner','--dbname=postgres','--no-password'];
    const privateConnectionEnv = {PGPASSWORD:password,PGCONNECT_TIMEOUT:'5',PGSSLMODE:'disable',
      PGOPTIONS:'-c statement_timeout=120000 -c lock_timeout=5000',PGAPPNAME:'canonical-empty-schema'};
    const inspect = async plan => stage('INSPECTION',async () => {
      await check(reserved);
      const evidence = await inspectCanonicalEmptySchema({sql:wrap(reserved),plan,verifyCatalogue:verifyFreshSchemaCatalogue,phase});
      await check(reserved);
      return evidence;
    });
    let receipt;
    if (archiveOperation?.kind === 'RESTORE') {
      const plan = await stage('SCHEMA_LOAD',() => loadFreshSchemaApplicationPlan());
      await stage('EMPTY_CHECK',async () => {
        const [version] = await reserved.unsafe("select current_setting('server_version_num')::int as value");
        assert.equal(Math.floor(Number(version.value)/10000),17);
        assertEmptyApplicationSchema(await reserved.unsafe(FRESH_SCHEMA_OCCUPANCY_QUERY));
      });
      // pg_dump deliberately excludes cluster roles. Restore only the canonical
      // NOLOGIN compatibility names; no API user, fixture RPC or owner identity.
      await stage('COMPAT_ROLES',() => wrap(reserved).unsafe('create role anon nologin; create role authenticated nologin; create role service_role nologin'));
      await stage('ARCHIVE_CHECK',() => archiveOperation.assertArchive());
      await check(reserved);
      await command('pg_restore',[...privateConnectionArgs,'--single-transaction','--exit-on-error','--no-owner',archiveOperation.archive],privateConnectionEnv);
      await check(reserved);
      await stage('ARCHIVE_CHECK',() => archiveOperation.assertArchive());
      archiveEvidence = await inspect(plan);
      await runEmptySchemaStage('ROUNDTRIP_COMPARE',() => assertEmptySchemaRoundtrip(archiveOperation.sourceEvidence,archiveEvidence));
      receipt = {classification:'NATIVE_PG17',status:'CANONICAL_EMPTY_SCHEMA_RESTORE_CHECKS_PASSED',production_qualified:false};
    } else {
      const beforeApiProvision = archiveOperation ? async ({sql:ownedSql,plan}) => {
        const before = await inspect(plan);
        await stage('ARCHIVE_CHECK',() => archiveOperation.assertArchive(false));
        await check(reserved);
        await command('pg_dump',[...privateConnectionArgs,'--format=custom','--schema-only','--no-owner','--file='+archiveOperation.archive],privateConnectionEnv);
        await check(reserved);
        const archive = await stage('ARCHIVE_CHECK',() => archiveOperation.assertArchive());
        const tocText = await command('pg_restore',['--list',archiveOperation.archive]);
        const toc = await stage('TOC_VALIDATE',() => validateEmptySchemaToc(tocText,before));
        await stage('ARCHIVE_CHECK',() => archiveOperation.assertArchive());
        const after = await stage('INSPECTION',() => inspectCanonicalEmptySchema({sql:ownedSql,plan,verifyCatalogue:verifyFreshSchemaCatalogue,phase}));
        await runEmptySchemaStage('ROUNDTRIP_COMPARE',() => assertEmptySchemaRoundtrip(before,after));
        archiveEvidence = {...before,toc,archive_sha256:archive.sha256,archive_bytes:archive.bytes,
          source_manifest_sha256:plan.source_manifest_sha256,selection_sha256:plan.selection_sha256,
          upgrade_sources_sha256:plan.upgrade_sources_sha256,prerequisite_sha256:plan.prerequisite_sha256,
          post_upgrade_acl_sha256:plan.post_upgrade_acl_sha256};
      } : null;
      receipt=await (applicationMode==='ATOMIC_SLICE'?qualifyAtomicFreshSchema:qualifyDisposableFreshSchema)({
        sql:wrap(reserved),engine:'NATIVE_PG17',beforeApiProvision,stage});
    }
    let exerciseResult=null;
    if(exercise) {
      let active=true;
      const scoped=connection=>Object.freeze({
        unsafe:async(...args)=>{if(!active)throw Error('fresh_test_exercise_closed');return connection.unsafe(...args);},
        begin:async callback=>{if(!active)throw Error('fresh_test_exercise_closed');return connection.begin(tx=>callback(scoped(tx)));},
      });
      try {
        const identities=[expected];
        if(exerciseBackends===2){
          const second=await sql.reserve();reservedConnections.push(second);
          const [actual]=await second.unsafe(identityQuery);
          assert.notEqual(Number(actual.pid),Number(expected.pid),'concurrency requires independent PostgreSQL backends');
          const identity={...expected,pid:actual.pid};
          await check(second,identity);identities.push(identity);
        }
        const backends=reservedConnections.map((connection,index)=>Object.freeze({
          sql:scoped(wrap(connection,identities[index].pid)),pid:Number(identities[index].pid)}));
        exerciseResult=await exercise(Object.freeze({sql:backends[0].sql,backends:Object.freeze(backends),
          engine:'NATIVE_PG17',parallel_backends:backends.length}));
        for(let index=0;index<reservedConnections.length;index++)await check(reservedConnections[index],identities[index]);
      } finally { active=false; }
    }
    return {...receipt, native_identity_verified:true,...(exercise?{test_exercise:exerciseResult}:{} ),
      ...(archiveOperation?{empty_schema_archive:archiveEvidence,disposable_identity:expected}:{} )};
  } catch (error) {
    primaryFailure=error;
    throw error;
  } finally {
    if (archiveOperation) {
      let failure=primaryFailure;
      const cleanup=async (name,action) => {
        try { await stage(name,action); return true; }
        catch (error) { failure=combineEmptySchemaCleanupFailure(failure,error); return false; }
      };
      await cleanup('RELEASE_CONNECTIONS',() => Promise.all(reservedConnections.map(connection=>connection.release())));
      await cleanup('END_CONNECTIONS',async () => { if(sql)await sql.end({timeout:5}); });
      // A failed stop retains cluster data. Outer nonrecursive workspace cleanup
      // will refuse, while both failures remain distinct from the original one.
      const stopped=!started || await cleanup('STOP',() => command('pg_ctl',['-D',data,'-m','immediate','-w','stop']));
      if(stopped)await cleanup('DIRECTORY_CLEANUP',() => fs.rm(directory,{recursive:true,force:true}));
      if(failure)throw failure;
    } else {
    try { await Promise.all(reservedConnections.map(connection=>connection.release())); }
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
}

// This is the only export/restore entry point. It accepts tools, never a database,
// PGDATA, URI, password, SQL callback or existing archive. Both database factories
// own their independently created clusters and must complete cleanup before this
// function releases archive bytes to the publishing CLI.
export async function roundtripCanonicalEmptySchemaNative(options = {}) {
  if (Object.keys(options).some(key => !['bin','driver','applicationMode'].includes(key))
    || options.applicationMode !== 'ATOMIC_SLICE') throw Error('empty_schema_atomic_slice_required');
  const {bin,driver} = options;
  if (!bin || !driver || !path.isAbsolute(bin) || !path.isAbsolute(driver))
    throw Error('empty_schema_disposable_tools_required');
  const work = await runEmptySchemaStage('WORKSPACE_CREATE',async () => fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canonical-empty-schema-')));
  const archive = path.join(work,'canonical-empty-schema.dump');
  let fingerprint = null, primaryFailure = null;
  try {
    const original = await runEmptySchemaStage('ARCHIVE_CLAIM',async () => {
      await fs.writeFile(archive,Buffer.alloc(0),{flag:'wx',mode:0o600});
      return fs.lstat(archive,{bigint:true});
    });
    const assertArchive = async (requireContent = true) => {
      const stat = await fs.lstat(archive,{bigint:true});
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.dev !== original.dev || stat.ino !== original.ino
        || stat.size > BigInt(EMPTY_SCHEMA_MAX_ARCHIVE_BYTES) || requireContent && stat.size < 5n)
        throw Error('empty_schema_archive_file_invalid');
      const bytes = await fs.readFile(archive);
      if (BigInt(bytes.length) !== stat.size || requireContent && bytes.subarray(0,5).toString('ascii') !== 'PGDMP')
        throw Error('empty_schema_archive_format_invalid');
      const current = {sha256:emptySchemaSha256(bytes),bytes:bytes.length};
      if (fingerprint && (current.sha256 !== fingerprint.sha256 || current.bytes !== fingerprint.bytes))
        throw Error('empty_schema_archive_changed');
      if (requireContent) fingerprint = current;
      return current;
    };
    const tools = [];
    let toolVersion = null;
    for (const name of ['initdb','pg_ctl','pg_controldata','postgres','pg_dump','pg_restore']) {
      await runEmptySchemaStage('PG_TOOL_PIN',async () => {
      const file = path.join(bin,name+(process.platform==='win32'?'.exe':''));
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024)
        throw Error('empty_schema_pg17_binary_invalid');
      const version = (await runEmptySchemaStage('PG_TOOL_VERSION',() => runEmptySchemaCommand(file,['--version']))).toString('utf8').trim();
      const match = /\(PostgreSQL\) (17\.\d+)(?:\s|$)/.exec(version);
      if (!match || toolVersion && match[1] !== toolVersion) throw Error('empty_schema_pg17_binary_version_mismatch');
      toolVersion = match[1];
      tools.push({name:path.basename(file),bytes:stat.size,sha256:emptySchemaSha256(await fs.readFile(file)),version:match[1]});
      });
    }
    const source = await runEmptySchemaStage('SOURCE_FACTORY',() => runFreshSchemaNative({bin,driver,base:work,applicationMode:'ATOMIC_SLICE',
      archiveOperation:{kind:'EXPORT',archive,assertArchive}}));
    const restored = await runEmptySchemaStage('RESTORE_FACTORY',() => runFreshSchemaNative({bin,driver,base:work,applicationMode:'ATOMIC_SLICE',
      archiveOperation:{kind:'RESTORE',archive,assertArchive,sourceIdentity:source.disposable_identity,sourceEvidence:source.empty_schema_archive}}));
    await runEmptySchemaStage('ROUNDTRIP_COMPARE',() => {
    assertEmptySchemaRoundtrip(source.empty_schema_archive,restored.empty_schema_archive);
    const expectedVersion = 170000 + Number(toolVersion.split('.')[1]);
    assert.equal(source.empty_schema_archive.postgres_version_num,expectedVersion);
    assert.equal(restored.empty_schema_archive.postgres_version_num,expectedVersion);
    assert.equal(source.empty_schema_archive.toc.pg_dump_version,toolVersion);
    });
    const bytes = await runEmptySchemaStage('ARCHIVE_READBACK',async () => {
      await assertArchive();
      const value = await fs.readFile(archive);
      if (emptySchemaSha256(value) !== fingerprint.sha256) throw Error('empty_schema_archive_changed');
      return value;
    });
    const {functionIdentities,relationIdentities,...evidence} = source.empty_schema_archive;
    return {archive:bytes,evidence:{...evidence,classification:'NATIVE_PG17',
      status:'CANONICAL_EMPTY_SCHEMA_ROUNDTRIP_PASSED',production_qualified:false,runtime_ready:false,
      owner_enrollment_qualified:false,application_rows_seeded:false,
      independent_disposable_clusters:2,independent_identities_verified:true,
      source_identity_sha256:emptySchemaSha256(source.disposable_identity.system_identifier),
      restore_identity_sha256:emptySchemaSha256(restored.disposable_identity.system_identifier),
      cleanup_complete:true,pg_tools:tools,pg_tool_version:toolVersion,
      binary_pin_scope:'LISTED_PG_EXECUTABLES_ONLY_NOT_A_RUNTIME_BUNDLE',
      restored_catalogue_sha256:restored.empty_schema_archive.catalogue_sha256,
      restored_acl_sha256:restored.empty_schema_archive.acl_sha256}};
  } catch (error) {
    primaryFailure=error;
    throw error;
  } finally {
    // Factories may deliberately retain their directory if stopping PostgreSQL
    // failed. Never recursively remove that retained server data. In that case
    // rmdir fails and no successful result/artifact can escape this function.
    let failure=primaryFailure;
    for (const [stage,action] of [
      ['ARCHIVE_CLEANUP',() => fs.rm(archive,{force:true})],
      ['WORKSPACE_CLEANUP',() => fs.rmdir(work)],
    ]) {
      try { await runEmptySchemaStage(stage,action); }
      catch (error) { failure=combineEmptySchemaCleanupFailure(failure,error); }
    }
    if(failure)throw failure;
  }
}
