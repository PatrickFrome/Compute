import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST, quoteIdentifier } from './db-api-core.mjs';
import { provisionLocalApiLogin } from './db-api-grants.mjs';
import { startDbApi } from './db-api.mjs';
import { inspectAttachedApiAdmission, onboardAttachedPostgres } from './attached-postgres-onboarding.mjs';
import { applyLocalRuntimeMigrations, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';
import { initializeLocalVaultKey } from './local-vault-key.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';

const exec = promisify(execFile);
const pgBinDirectory = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
const attachedBundle = process.env.LOCAL_STATE_TEST_ATTACHED_BUNDLE_DIRECTORY;
const attachedBundleSha256 = process.env.LOCAL_STATE_TEST_ATTACHED_BUNDLE_SHA256;
const source = name => fs.readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('disposable PostgreSQL pinned migration groups and restricted direct API grants', {
  skip: !pgBinDirectory && !attachedBundle && !attachedBundleSha256, timeout: 540000,
}, async t => {
  let bin = pgBinDirectory;
  if (attachedBundle || attachedBundleSha256) {
    assert(attachedBundle && /^[a-f0-9]{64}$/.test(attachedBundleSha256 || ''), 'explicit attached bundle directory and digest required');
    const verified = await verifyOfflineRuntimeBundle({ bundleDirectory: attachedBundle, expectedBundleDigest: attachedBundleSha256 });
    bin = verified.paths.postgresBinDirectory;
    if (pgBinDirectory) assert.equal(await fs.realpath(pgBinDirectory), await fs.realpath(bin), 'fixture must use the verified bundled PostgreSQL');
  }
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-migration-grants-')));
  const data = path.join(root, 'pgdata'), port = await freePort();
  const owner = 'migration_fixture_owner', ownerPassword = randomBytes(32).toString('hex');
  const passwordFile = path.join(root, 'initdb-password.txt');
  let owned;
  let api;
  let runtime;
  let cleanupUnconfirmed = false;
  const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: owner, password: ownerPassword, max: 2, prepare: false, connect_timeout: 2, onnotice: () => {} });
  t.after(async () => {
    await runtime?.close();
    await api?.end({ timeout: 2 });
    await sql.end({ timeout: 2 });
    if (owned) assert.equal((await owned.stop()).cleanup_confirmed, true);
    if (cleanupUnconfirmed) return;
    const relative = path.relative(await fs.realpath(os.tmpdir()), await fs.realpath(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(passwordFile, ownerPassword + '\n', { flag: 'wx', mode: 0o600 });
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '--username=' + owner, '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '-E', 'UTF8'], { windowsHide: true });
  await fs.unlink(passwordFile);
  await initializeLocalVaultKey({ dataDirectory: data });
  if (process.platform === 'win32') {
    try { owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 120000 }); }
    catch (error) { cleanupUnconfirmed = error.code === 'runtime_cleanup_unconfirmed'; throw error; }
  } else {
    await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, 'start', '-w'], { windowsHide: true });
    owned = { stop: async () => { await exec(path.join(bin, 'pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w']); return { cleanup_confirmed: true }; } };
  }
  await sql.unsafe('create role anon; create role authenticated; create role service_role nologin bypassrls; create schema destruktion_meta; create schema extensions; create extension pgcrypto with schema extensions;');
  const baseline = await source('20260929010000_client_v1_fresh_project_bootstrap_v1.sql');
  await sql.unsafe(baseline.slice(baseline.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22'), baseline.indexOf('create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22')));
  const goal = await source('20260929211500_client_v1_goal_progress_reconciliation_v1.sql');
  await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'), goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
  await sql.unsafe(`create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key default gen_random_uuid(),client_id text,active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,admin_granted_at timestamptz);
    create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true,private_secret text);
    create table public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id text primary key,workspace_id uuid,last_seen_at timestamptz,state jsonb,authority_effect boolean default false);
    create table public.compute_fabric_a2_browser_device_enrollment_request_h205f22(request_id uuid default gen_random_uuid(),client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,status text,metadata jsonb,authority_effect boolean default false,requested_at timestamptz default clock_timestamp(),expires_at timestamptz default clock_timestamp()+interval '1 hour',approved_at timestamptz,device_id uuid);
    create function public.meta_orchestrator_frontier_admit_v1(p_workspace uuid,p_roadmap text,p_generation bigint,p_points text[]) returns jsonb language sql as $$select '{}'::jsonb$$;`);
  // Remaining table columns and RPCs are synthetic catalog fixtures, not supervisor behavioral evidence.
  for (const [table, policy] of Object.entries(TABLE_ALLOWLIST)) {
    await sql.unsafe('CREATE TABLE IF NOT EXISTS public.' + quoteIdentifier(table) + '(fixture_marker text)');
    for (const column of new Set([...policy.select, ...policy.filters, ...policy.order, ...(policy.insert || [])])) {
      await sql.unsafe('ALTER TABLE public.' + quoteIdentifier(table) + ' ADD COLUMN IF NOT EXISTS ' + quoteIdentifier(column) + ' text');
    }
    await sql.unsafe('ALTER TABLE public.' + quoteIdentifier(table) + ' ENABLE ROW LEVEL SECURITY');
  }
  const normalization = await source('20260902190500_devos_dispatch_admission_runtime_v2.sql');
  await sql.unsafe(normalization.slice(normalization.indexOf('create or replace function destruktion_meta.devos_normalize_native_supervisor_state_h205f22'), normalization.indexOf('create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22')));
  await sql.unsafe(await source('20260831152000_a2_workspace_binding_registry_v1.sql'));

  const plan = await loadLocalRuntimeMigrationPlan();
  const first = await applyLocalRuntimeMigrations({ sql, expectedMigrationSourcesSha256: plan.source_manifest_sha256 });
  assert.equal(first.source_manifest_sha256, plan.source_manifest_sha256);
  assert(first.migrations.every(row => row.status === 'APPLIED_LOCAL_ONLY'));
  const publicNewRpc = plan.migrations.slice(-2).flatMap(row => row.signatures.filter(value => value.startsWith('public.')));
  assert.equal(publicNewRpc.length, 10);
  for (const signature of publicNewRpc) {
    const [installed] = await sql.unsafe('SELECT pg_catalog.to_regprocedure($1::text) IS NOT NULL AS present', [signature]);
    assert.equal(installed.present, true, signature);
  }
  const second = await applyLocalRuntimeMigrations({ sql });
  assert(second.migrations.every(row => row.status === 'ALREADY_PRESENT_NOT_MODIFIED'));
  await assert.rejects(applyLocalRuntimeMigrations({ sql, expectedMigrationSourcesSha256: '0'.repeat(64) }), /source_pin_mismatch/);
  // A present register RPC cannot hide the loss of another RPC in its group.
  await assert.rejects(sql.begin(async tx => {
    await tx.unsafe('DROP FUNCTION public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)');
    await applyLocalRuntimeMigrations({ sql: { begin: run => run(tx) } });
  }), /migration_partial_install.*h205f22_project_reconcile_v1/);
  assert.equal((await sql.unsafe("SELECT pg_catalog.to_regprocedure('public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)') IS NOT NULL AS restored"))[0].restored, true);
  await assert.rejects(sql.begin(async tx => {
    await tx.unsafe('ALTER TABLE destruktion_meta.devos_fleet_task_h205f22 DISABLE TRIGGER project_task_state_history_h205f22');
    await applyLocalRuntimeMigrations({ sql: { begin: run => run(tx) } });
  }), /migration_partial_install.*project_task_state_history_h205f22/);

  for (const name of RPC_ALLOWLIST) {
    const [installed] = await sql.unsafe('SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=$1) AS present', [name]);
    if (!installed.present) await sql.unsafe('CREATE FUNCTION public.' + quoteIdentifier(name) + "() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT '{\"synthetic\":true}'::jsonb$$");
  }
  const signatures = await sql.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
  for (const signature of signatures) {
    const types = signature.args.map(arg => quoteIdentifier(arg.typeSchema) + '.' + quoteIdentifier(arg.typeName)).join(',');
    await sql.unsafe('REVOKE ALL ON FUNCTION public.' + quoteIdentifier(signature.name) + '(' + types + ') FROM PUBLIC');
  }
  await sql.unsafe(`create function public.service_role_only() returns text language sql as $$select 'private'::text$$; revoke all on function public.service_role_only() from public; grant execute on function public.service_role_only() to service_role;
    insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash,private_secret) values('visible-token','hidden-secret');`);
  const serviceGrants = () => sql.unsafe(`SELECT p.oid::text AS oid, a.privilege_type, a.is_grantable FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role') ORDER BY p.oid,a.privilege_type`);
  const beforeAcl = await serviceGrants();
  const password = randomBytes(32).toString('hex'), login = 'migration_fixture_api';
  const receipt = await provisionLocalApiLogin({ sql, databaseName: 'postgres', login, password, roleMode: 'direct' });
  assert.equal(receipt.can_set_service_role, false);
  assert.equal(receipt.shared_service_role_grants_modified, false);
  assert.deepEqual(await serviceGrants(), beforeAcl, 'no service_role function grants change');
  api = postgres({ host: '127.0.0.1', port, database: 'postgres', username: login, password, max: 1, prepare: false, onnotice: () => {} });
  const [identity] = await api.unsafe('SELECT current_user AS name');
  assert.equal(identity.name, login);
  const admission = await inspectAttachedApiAdmission({ sql: api, apiLogin: login });
  assert.equal(admission.restricted_login, true);
  assert.equal(admission.rpc_names_granted, 50);
  assert.deepEqual([...(await api.unsafe('SELECT token_hash FROM public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22'))], [{ token_hash: 'visible-token' }]);
  await assert.rejects(api.unsafe('SELECT private_secret FROM public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22'), error => error.code === '42501');
  await assert.rejects(api.unsafe('SET ROLE service_role'), error => error.code === '42501');
  await assert.rejects(api.unsafe('SELECT public.service_role_only()'), error => error.code === '42501');
  await assert.rejects(api.unsafe("DELETE FROM public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22"), error => error.code === '42501');
  await assert.rejects(api.unsafe('SELECT destruktion_meta.project_device_grant_h205f22(null,null,null)'), error => error.code === '42501');
  await assert.rejects(api.unsafe('SELECT public.h205f22_project_register_v1(null,null,null,null,null)'), error => /^PROJECT_/.test(error.message));
  const inserted = await api.unsafe("INSERT INTO public.compute_fabric_a2_browser_device_enrollment_request_h205f22(client_id,profile,public_jwk,key_fingerprint_sha256,status,metadata,authority_effect) VALUES('direct-test','fixture','{}','hash','PENDING','{}',false) RETURNING request_id,status");
  assert.equal(inserted[0].status, 'PENDING');
  await assert.rejects(api.unsafe("INSERT INTO public.compute_fabric_a2_browser_device_enrollment_request_h205f22(device_id) VALUES(gen_random_uuid())"), error => error.code === '42501');
  const apiKey = randomBytes(32).toString('hex');
  runtime = await startDbApi({ databaseUrl: `postgres://${login}:${password}@127.0.0.1:${port}/postgres`, apiKey, port: 0, roleMode: 'direct' });
  const request = (url, init = {}) => fetch(runtime.address + url, { ...init, headers: { apikey: apiKey, ...init.headers } });
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const read = await request('/rest/v1/compute_fabric_a2_chat_bridge_remote_pairing_h205f22?token_hash=eq.visible-token&select=token_hash');
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), [{ token_hash: 'visible-token' }]);
  const enroll = await request('/rest/v1/compute_fabric_a2_browser_device_enrollment_request_h205f22?select=request_id,status', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'http-direct-test', profile: 'fixture', public_jwk: {},
      key_fingerprint_sha256: 'hash-http', status: 'PENDING', metadata: {}, authority_effect: false }) });
  assert.equal(enroll.status, 201, await enroll.clone().text());
  await runtime.close();
  runtime = null;
  const expectRejectedDirectStartup = async pattern => {
    let unexpected;
    try {
      await assert.rejects(async () => {
        unexpected = await startDbApi({ databaseUrl: `postgres://${login}:${password}@127.0.0.1:${port}/postgres`, apiKey, port: 0, roleMode: 'direct' });
      }, pattern);
    } finally { await unexpected?.close(); }
  };
  const incompleteGrants = `REVOKE INSERT (metadata) ON public.compute_fabric_a2_browser_device_enrollment_request_h205f22 FROM ${quoteIdentifier(login)}`;
  await sql.unsafe(incompleteGrants);
  try {
    await expectRejectedDirectStartup(/local_state_table_grants_incomplete/);
  } finally {
    await sql.unsafe(`GRANT INSERT (metadata) ON public.compute_fabric_a2_browser_device_enrollment_request_h205f22 TO ${quoteIdentifier(login)}`);
  }
  await sql.unsafe(`CREATE FUNCTION public.devos_environment_state_v1(fixture_overload_marker bytea) RETURNS jsonb
    LANGUAGE sql AS $$SELECT '{}'::jsonb$$`);
  try {
    await expectRejectedDirectStartup(/local_state_rpc_catalog_overloaded/);
  } finally {
    await sql.unsafe('DROP FUNCTION public.devos_environment_state_v1(bytea)');
  }
  runtime = await startDbApi({ databaseUrl: `postgres://${login}:${password}@127.0.0.1:${port}/postgres`, apiKey, port: 0, roleMode: 'direct' });
  // Role DDL, RLS policies and privileges join an outer transaction and all roll back together.
  await assert.rejects(sql.begin(async tx => {
    await provisionLocalApiLogin({ sql: { begin: run => run(tx) }, databaseName: 'postgres', login: 'rollback_fixture_api', password, roleMode: 'direct' });
    throw new Error('fixture_late_failure');
  }), /fixture_late_failure/);
  assert.equal((await sql.unsafe("SELECT count(*)::int AS count FROM pg_catalog.pg_roles WHERE rolname='rollback_fixture_api'"))[0].count, 0);

  if (attachedBundle) {
    const stateDirectory = path.join(root, 'attached-runtime-state');
    const runtimeConfigFile = path.join(stateDirectory, 'attached-runtime.json');
    await fs.mkdir(stateDirectory);
    const [cluster] = await sql.unsafe(`SELECT system_identifier::text AS id,
      to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started
      FROM pg_catalog.pg_control_system()`);
    const pidBefore = await fs.readFile(path.join(data, 'postmaster.pid'));
    const vaultBefore = await fs.readFile(path.join(data, 'client-vault.key'));
    const attachedPassword = randomBytes(32).toString('hex');
    let apiPort;
    do { apiPort = await freePort(); } while (apiPort === port);
    let edgePort;
    do { edgePort = await freePort(); } while (edgePort === apiPort || edgePort === port);
    const onboarding = await onboardAttachedPostgres({ ownerAction: 'ONBOARD_EXISTING_LOCAL_POSTGRES_17',
      bundleDirectory: attachedBundle, expectedBundleDigest: attachedBundleSha256,
      stateDirectory, pgDataDirectory: data, runtimeConfigFile,
      expectedMigrationSourcesSha256: plan.source_manifest_sha256,
      expectedClusterSystemIdentifier: cluster.id, expectedPostmasterStartedAt: cluster.started,
      adminDatabaseUrl: `postgres://${owner}:${ownerPassword}@127.0.0.1:${port}/postgres`,
      apiLogin: 'attached_migration_fixture_api', apiPassword: attachedPassword, apiPort, edgePort,
    });
    assert.equal(onboarding.state, 'CONFIGURED_UNQUALIFIED');
    assert.equal(onboarding.restricted_api_admission.rpc_names_granted, 50);
    assert.equal(onboarding.database_initialized, false);
    assert.equal(onboarding.postgres_started, false);
    assert.equal(onboarding.postgres_stopped, false);
    assert.deepEqual(await fs.readFile(path.join(data, 'postmaster.pid')), pidBefore);
    assert.deepEqual(await fs.readFile(path.join(data, 'client-vault.key')), vaultBefore);
    assert.deepEqual(await serviceGrants(), beforeAcl);
    const config = JSON.parse(await fs.readFile(runtimeConfigFile, 'utf8'));
    assert.equal(config.postgres_mode, 'attached');
    assert.equal(config.api_role_mode, 'direct');
    assert.equal(config.expected_cluster_system_identifier, cluster.id);
    assert.equal(new URL(config.database_url).username, 'attached_migration_fixture_api');
    await assert.rejects(fs.lstat(path.join(stateDirectory, 'runtime-host-lock.json')), { code: 'ENOENT' });
    await runtime.close();
    runtime = await startDbApi({ databaseUrl: config.database_url, apiKey, port: 0, roleMode: config.api_role_mode });
    const attachedHealth = await request('/health');
    assert.equal(attachedHealth.status, 200, await attachedHealth.clone().text());
    assert.equal((await attachedHealth.json()).ok, true);
  }
  console.log(JSON.stringify({ schema: 'compute.local-runtime-migration-grants-evidence.v1', disposable: true,
    exact_new_rpc_count: 10, migration_sources_sha256: plan.source_manifest_sha256, migration_groups: 5,
    repeated_apply_no_changes: true, partial_install_rejected: true, disabled_trigger_rejected: true,
    direct_role_zero_memberships: true, column_grants: true, rls_reads: true, direct_http_health_reads_insert: true, shared_service_role_modified: false,
    role_ddl_rollback: true, scram_api_credentials_exercised: true,
    missing_insert_grant_rejected_at_startup: true, overloaded_rpc_rejected_at_startup: true,
    full_attached_onboarding: Boolean(attachedBundle), bundle_verification_stubbed: false,
    bundle_sha256: attachedBundleSha256 || null, remaining_rpc_bodies_synthetic: true, production_qualification: false }));
});
