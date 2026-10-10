import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';
import { compileRpcRequest, RPC_CATALOG_QUERY, RPC_ALLOWLIST } from './db-api-core.mjs';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';
import { createManagedProjectRoutes } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/managed-project-routes.mjs';
import { createManagedTaskProjectAuthorityResolver, createManagedTaskProjectBindingTransport, managedProjectEffectKey } from '../../apps/metaengine-browser/src/managed-task-project-authority-resolver.mjs';
import { createManagedTaskProjectHost } from '../../apps/metaengine-browser/src/managed-task-project-host.mjs';
import { createManagedTaskProjectSqliteJournal } from '../../apps/metaengine-browser/src/managed-task-project-sqlite-journal.mjs';
import { createShellFreeGitExecutor } from '../../apps/metaengine-browser/src/managed-task-project-runtime.mjs';
import { SupervisorLoopbackRpcServer } from '../../apps/metaengine-browser/src/supervisor-loopback-rpc-server.mjs';
import { managedProjectCommand, callManagedProject } from '../../apps/metaengine-browser/scripts/run-managed-project.mjs';

const exec = promisify(execFile);
const bin = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
const migrationUrl = new URL('../../supabase/migrations/20261009194157_managed_project_admission_v1.sql', import.meta.url);
const bindingUrl = new URL('../../supabase/migrations/20260831152000_a2_workspace_binding_registry_v1.sql', import.meta.url);
const baselineUrl = new URL('../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql', import.meta.url);
const normalizationUrl = new URL('../../supabase/migrations/20260902190500_devos_dispatch_admission_runtime_v2.sql', import.meta.url);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('physical disposable PostgreSQL enforces project fences through loopback CLI, real Git and durable restart', { skip: !bin, timeout: 240000 }, async t => {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-project-authority-')));
  const data = path.join(root, 'pgdata');
  const port = await freePort();
  const { stdout: version } = await exec(path.join(bin, 'postgres' + suffix), ['--version'], { windowsHide: true });
  assert.match(version, /PostgreSQL\) 17\./);
  const executableSha = crypto.createHash('sha256').update(await fs.readFile(path.join(bin, 'postgres' + suffix))).digest('hex');
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'], { windowsHide: true });
  // pg_ctl starts an owner-bound, restricted-token postmaster even when the
  // hosted Windows CI runner has administrator membership. Direct postgres.exe
  // refuses that token and must not be used as a CI/production workaround.
  let owned = null;
  let child = null;
  let output = '';
  let closed = Promise.resolve();
  if (process.platform !== 'win32') {
    child = spawn(path.join(bin, 'postgres' + suffix), ['-D', data, '-h', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-8192); });
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-8192); });
    closed = new Promise(resolve => child.once('close', resolve));
  }
  const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: process.env.USERNAME || process.env.USER || 'postgres', max: 2, prepare: false, connect_timeout: 1 });
  t.after(async () => {
    await sql.end({ timeout: 2 });
    if (process.platform === 'win32') {
      if (owned) assert.equal((await owned.stop()).cleanup_confirmed, true);
    } else {
      await exec(path.join(bin, 'pg_ctl' + suffix), ['-D', data, 'stop', '-m', 'fast', '-w'], { windowsHide: true });
      await closed;
    }
    const relative = path.relative(os.tmpdir(), await fs.realpath(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  if (process.platform === 'win32') {
    owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 60000 });
    assert.equal((await owned.verify()).pid, owned.pid);
  }
  for (let attempt = 0; ; attempt++) {
    try { await sql`select 1`; break; }
    catch (error) { if (attempt >= 40 || (child && child.exitCode !== null)) throw new Error('disposable_pg_start_failed:' + output); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await sql.unsafe("create role anon; create role authenticated; create role service_role; create schema destruktion_meta;");
  const baseline = await fs.readFile(baselineUrl, 'utf8');
  // Use exact checked-in task/claim table definitions without applying the
  // unrelated full fresh-bootstrap control plane to this isolated SQL fixture.
  const taskTables = baseline.slice(baseline.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22'), baseline.indexOf('create table if not exists destruktion_meta.devos_fleet_event_h205f22'));
  assert(taskTables.includes('claim_id bigint generated always as identity'));
  await sql.unsafe(taskTables);
  await sql.unsafe(`create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text not null,active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text,profile text default 'A2_DEVICE_HTTP_SIGNATURE_V1',key_fingerprint_sha256 text);
    create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);
    create table public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id text primary key,workspace_id uuid,last_seen_at timestamptz,state jsonb,authority_effect boolean default false);
    create table destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id uuid primary key,generation_floor bigint default 0,refill_enabled boolean default true,supervisor_admission_enabled boolean default true);
    create function public.devos_environment_state_v1(p_workspace uuid) returns jsonb language sql as $$select jsonb_build_object('schema','metaengine.devos.environment-state.v1','generation_floor',coalesce(generation_floor,0),'refill_enabled',coalesce(refill_enabled,true),'supervisor_admission_enabled',coalesce(supervisor_admission_enabled,true),'authority_effect',false) from (select 1) one left join destruktion_meta.devos_fleet_runtime_control_h205f22 c on c.workspace_id=p_workspace$$;`);
  const normalization = await fs.readFile(normalizationUrl, 'utf8');
  const normalizeFunction = normalization.slice(normalization.indexOf('create or replace function destruktion_meta.devos_normalize_native_supervisor_state_h205f22'), normalization.indexOf('create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22'));
  assert(normalizeFunction.includes('returns jsonb'));
  await sql.unsafe(normalizeFunction);
  await sql.unsafe(await fs.readFile(bindingUrl, 'utf8'));
  await sql.unsafe(await fs.readFile(migrationUrl, 'utf8'));

  const coord = crypto.randomUUID(), task = crypto.randomUUID(), device = crypto.randomUUID(), workspace = crypto.randomUUID();
  const client = 'project-physical-test', agent = 'agent_project-physical-001', tab = 'tab_project-physical-001', target = 'webcontents:5';
  const repo = path.join(root, 'repo'), managed = path.join(root, 'projects'), userDataPath = path.join(root, 'user-data');
  await Promise.all([fs.mkdir(repo), fs.mkdir(managed), fs.mkdir(userDataPath)]);
  const git = args => exec('git', args, { cwd: repo, shell: false, windowsHide: true });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Authority fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout: headOutput } = await git(['rev-parse', 'HEAD']);
  const head = headOutput.trim(), fingerprint = 'd'.repeat(64);
  const expiry = new Date(Date.now() + 300000).toISOString();
  const fleetAgent = { agent_id: agent, ownership: 'FLEET_OWNED', lifecycle_state: 'ACTIVE', authority_effect: false, automatic_retry_allowed: false, role: 'CODER', tab_id: tab, target_id: target, generation_epoch: 4, transport_proof: { schema: 'metaengine.browser.fleet-transport-proof.v1', authority_effect: false, tab_id: tab, target_id: target, generation_epoch: 4, conversation_url_sha256: 'b'.repeat(64), proven_at: new Date().toISOString() } };
  const state = { schema: 'metaengine.native-browser-supervisor.state.v1', client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE', transport_identity: { profile: 'A2_DEVICE_HTTP_SIGNATURE_V1', device_id: device, key_fingerprint_sha256: fingerprint, access_tier: 'ADMIN', admin_grant_epoch: 1, admin_ready: true }, fleet: { schema: 'metaengine.browser.fleet-snapshot.v1', readiness_contract: 'TRANSPORT_PROOF_REQUIRED', agents: [fleetAgent] } };
  await sql.unsafe("insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values('grant');");
  await sql.unsafe('insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,enrollment_pairing_token_hash,key_fingerprint_sha256) values($1,$2,$3,$4)', [device, client, 'grant', fingerprint]);
  await sql.unsafe("insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,branch_name,task_spec_sha256,idempotency_key,state,lease_generation,lease_agent_id,lease_tab_id,lease_target_id,lease_agent_generation_epoch,lease_expires_at) values($1,$2,'project.physical','CODER',$3,'work/physical-project',$4,'physical-task','LEASED',1,$5,$6,$7,4,$8)", [task, coord, head, 'c'.repeat(64), agent, tab, target, expiry]);
  const [claim] = await sql.unsafe("insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at) values($1,$2,'project.physical',$3,'CODER','MUTATING',$4,$5,$6,4,1,$7) returning claim_id", [task, coord, head, agent, tab, target, expiry]);
  await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state,authority_effect) values($1,$2,clock_timestamp(),$3::jsonb,true)', [client, coord, sql.json(state)]);
  const [snapshot] = await sql.unsafe("select jsonb_typeof(state) as state_type from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id=$1", [client]);
  assert.equal(snapshot.state_type, 'object');
  const identity = [coord, task, agent, Number(claim.claim_id), 1, workspace, 1, device, client, 1];
  let readNumber = 0;
  const read = () => { readNumber++; return sql.unsafe('select public.h205f22_a2_managed_project_admission_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', identity).then(rows => rows[0].value).catch(error => { throw new Error(error.message + ':read_' + readNumber); }); };
  const provision = (roots = [path.join(root, 'repo'), path.join(root, 'projects')]) => sql.unsafe('select public.h205f22_a2_managed_project_repository_provision_v1($1,$2,$3,$4,$5,$6,$7) as value', [coord, device, client, 1, 'github:test/physical', ...roots]).then(rows => rows[0].value);
  const effect = (operation, effectState = null, sha = null, locked = false, verified = false, ambiguity = null) => sql.unsafe('select public.h205f22_a2_managed_project_binding_effect_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as value', [...identity, operation, effectState, sha, locked, verified, ambiguity]).then(rows => rows[0].value).catch(error => { throw new Error(error.message + ':effect_' + operation); });
  await assert.rejects(read(), /MANAGED_PROJECT_REPOSITORY_NOT_PROVISIONED/);
  assert.equal((await provision()).replayed, false);
  assert.equal((await provision()).replayed, true);
  await assert.rejects(provision([path.join(root, 'foreign'), path.join(root, 'projects')]), /CONFIG_CONFLICT/);
  const first = await read();
  assert.equal(first.authoritative, true);
  assert.equal(first.workspace_binding.worktree_path, path.join(root, 'projects', `${agent.replaceAll('_', '-')}--${task}--l1`));
  assert.equal((await read()).workspace_binding.worktree_id, first.workspace_binding.worktree_id);
  assert.equal((await effect('reserve')).binding.state, 'RESERVED');
  await assert.rejects(effect('readback', 'PROVEN', 'f'.repeat(40), true, true), /RECEIPT_INVALID/);

  // Compose the real route/SQL boundary with the durable host, real Git, the
  // authenticated loopback server and CLI. The remote signed-device identity
  // is a synthetic post-authentication fixture; no signature proof is claimed.
  const signatures = await sql.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
  const routes = createManagedProjectRoutes({ workspaceId: coord, rpc: async (name, args) => {
    const plan = compileRpcRequest(name, args, signatures);
    const rows = await sql.unsafe(plan.text, plan.values.map(({ value }) => value));
    return rows[0].value;
  } });
  const grant = { ok: true, id: client, device_id: device, access_tier: 'ADMIN', admin_ready: true, admin_grant_epoch: 1 };
  const request = async wire => {
    // A live Browser supplies these heartbeats; this synthetic fixture keeps
    // its signed-client snapshot current across expensive Windows ACL probes.
    await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where client_id=$1', [client]);
    const response = await routes({ req: { method: wire.method }, path: wire.path, body: wire.body, identity: grant });
    const value = await response.json();
    if (response.status !== 200) throw new Error(value.error || 'project_fixture_route_failed');
    return value;
  };
  const transport = createManagedTaskProjectBindingTransport({ request });
  const resolveProjectBinding = createManagedTaskProjectAuthorityResolver({ request });
  const projectRequest = { idempotency_key: 'physical:cli:create', coordination_workspace_id: coord, task_id: task,
    agent_id: agent, claim_id: Number(claim.claim_id), lease_generation: 1, workspace_id: workspace, workspace_generation: 1 };
  const executor = createShellFreeGitExecutor();
  let gitAdds = 0, opens = 0;
  const hostOptions = { userDataPath, executeCommand: async () => { throw new Error('project_fixture_unrelated_command'); },
    resolveProjectBinding, ...transport,
    gitExecutor: { execute: plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') gitAdds++; return executor.execute(plan); } },
    openProject: async ({ path: projectPath }) => { assert.equal(projectPath, await fs.realpath(projectPath)); opens++; },
  };
  let host, server;
  const startHost = async () => {
    host = await createManagedTaskProjectHost(hostOptions);
    server = new SupervisorLoopbackRpcServer({ executeCommand: host.executeCommand,
      token: crypto.randomBytes(32).toString('hex'), manifestPath: path.join(root, 'loopback.json') });
    await server.start();
    return JSON.parse(await fs.readFile(path.join(root, 'loopback.json'), 'utf8'));
  };
  try {
    let manifest = await startHost();
    const unauthorized = await fetch(manifest.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'supervisor.command', params: { command: managedProjectCommand('create', projectRequest) } }) });
    assert.equal(unauthorized.status, 401); assert.equal(gitAdds, 0);
    const created = await callManagedProject(manifest, managedProjectCommand('create', projectRequest));
    assert.equal(created.state, 'PROVEN'); assert.equal(created.head_sha, head); assert.equal(created.replayed, false);
    assert.equal(gitAdds, 1); assert.equal((await read()).workspace_binding.state, 'READY');
    assert.equal(host.snapshot().private_storage_verified, true); assert.equal(host.snapshot().durable_journal, true);
    await server.stop(); await host.close();
    manifest = await startHost();
    const opened = await callManagedProject(manifest, managedProjectCommand('open', { ...projectRequest, idempotency_key: 'physical:ui:other-key' }));
    assert.equal(opened.state, 'PROVEN'); assert.equal(opened.opened, true); assert.equal(opened.replayed, true);
    assert.equal(gitAdds, 1); assert.equal(opens, 1); assert.equal((await read()).workspace_binding.state, 'READY');
    await server.stop(); await host.close();
    const journal = createManagedTaskProjectSqliteJournal({ filePath: path.join(userDataPath, 'managed-task-projects-v1', 'effects.sqlite') });
    try { assert.equal((await journal.find(managedProjectEffectKey(projectRequest))).state, 'PROVEN'); }
    finally { await journal.close(); }
  } finally { await server?.stop(); await host?.close(); }

  const ready = await effect('readback', 'PROVEN', head, true, true);
  assert.equal(ready.binding.state, 'READY');
  assert.equal(ready.binding.worktree_realpath, first.workspace_binding.worktree_path);
  assert.equal((await effect('readback', 'PROVEN', head, true, true)).binding.state, 'READY');
  await assert.rejects(effect('readback', 'AMBIGUOUS', null, false, false, 'UNKNOWN'), /RECEIPT_INVALID/);

  const deny = async (update, undo, code) => {
    await sql.unsafe(update);
    await assert.rejects(read(), new RegExp(code));
    await assert.rejects(effect('readback', 'PROVEN', head, true, true), new RegExp(code));
    await sql.unsafe(undo);
  };
  await deny('update public.compute_fabric_a2_browser_device_h205f22 set active=false', 'update public.compute_fabric_a2_browser_device_h205f22 set active=true', 'DEVICE_GRANT_REVOKED');
  await deny("update destruktion_meta.devos_fleet_claim_h205f22 set state='FENCED'", "update destruktion_meta.devos_fleet_claim_h205f22 set state='ACTIVE'", 'CLAIM_NOT_CURRENT');
  await deny('update destruktion_meta.devos_fleet_task_h205f22 set lease_agent_generation_epoch=5', 'update destruktion_meta.devos_fleet_task_h205f22 set lease_agent_generation_epoch=4', 'TASK_NOT_CURRENT');
  await deny("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '1 minute'", 'update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()', 'SNAPSHOT_STALE');
  await deny("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set client_id='foreign'", `update public.compute_fabric_a2_browser_supervisor_state_h205f22 set client_id='${client}'`, 'SNAPSHOT_STALE');
  await deny("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,device_id}',to_jsonb('00000000-0000-4000-8000-000000000001'::text))", `update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,device_id}',to_jsonb('${device}'::text))`, 'SNAPSHOT_IDENTITY_DRIFT');
  await deny("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,key_fingerprint_sha256}',to_jsonb(repeat('e',64)))", `update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,key_fingerprint_sha256}',to_jsonb('${fingerprint}'::text))`, 'SNAPSHOT_IDENTITY_DRIFT');
  await deny("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,admin_grant_epoch}','2'::jsonb)", "update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{transport_identity,admin_grant_epoch}','1'::jsonb)", 'SNAPSHOT_IDENTITY_DRIFT');
  await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=$1::jsonb', [sql.json({ ...state, fleet: { ...state.fleet, agents: [fleetAgent, fleetAgent] } })]);
  await assert.rejects(read(), /AGENT_AMBIGUOUS/);
  await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=$1::jsonb', [sql.json(state)]);
  await sql.unsafe('insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,supervisor_admission_enabled) values($1,false)', [coord]);
  await assert.rejects(read(), /ENVIRONMENT_FENCED/);
  await sql.unsafe('delete from destruktion_meta.devos_fleet_runtime_control_h205f22');
  await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(read(), /CLAIM_NOT_CURRENT/);
  await sql.unsafe('update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=$1', [expiry]);
  const renewed = new Date(Date.now() + 600000).toISOString();
  await sql.unsafe('update destruktion_meta.devos_fleet_task_h205f22 set lease_expires_at=$1', [renewed]);
  await sql.unsafe('update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=$1', [renewed]);
  assert(Date.parse((await read()).claim.lease_expires_at) === Date.parse(renewed));
  assert(Date.parse((await effect('readback', 'PROVEN', head, true, true)).binding.lease_expires_at) === Date.parse(renewed));
  const [grants] = await sql.unsafe(`select has_function_privilege('anon','public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)','EXECUTE') as anon,
    has_function_privilege('authenticated','public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)','EXECUTE') as authenticated,
    has_function_privilege('service_role','public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)','EXECUTE') as service`);
  assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
  const [rls] = await sql.unsafe("select relrowsecurity from pg_class where oid='public.compute_fabric_a2_managed_project_repository_h205f22'::regclass");
  assert.equal(rls.relrowsecurity, true);
  console.log(JSON.stringify({ evidence: 'DISPOSABLE_PG_PROJECT_AUTHORITY', postgres_version: version.trim(), executable_sha256: executableSha,
    migration_sha256: crypto.createHash('sha256').update(await fs.readFile(migrationUrl)).digest('hex'), real_git_adds: gitAdds,
    durable_host_restart: true, loopback_bearer_enforced: true, real_owner_storage_verified: true,
    signed_remote_http_authentication_proven: false, production_database_modified: false }));
});
