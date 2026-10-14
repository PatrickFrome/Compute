// W45: Real, disposable PG17 falsifier. No ambient PGDATA, owner file, port or credential.
// This fixture never connects to installed PostgreSQL. SYNTHETIC/STAGING only.
// W26/W39 code is resolved from exact, read-only upstream worktrees by the CI runner.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';

const exec = promisify(execFile);
const required = process.env.W45_REQUIRE_REAL_PG17 === '1';
const enabled = process.env.W45_PG17_DOCKER === '1';
const IMAGE = 'postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const W26_SHA = '6498c1596432ea9d9987f343c92505b273d1ac11';
const W39_SHA = 'ee39b256e2b54f5dfddf4bff021977c0185fb744';
const W37_SHA = '2557acd2ee11464c6f3f63b2e3b22bba74df142f';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = async (...args) => (await exec('docker', args, { windowsHide: true, timeout: 90000 })).stdout.trim();
const isCode = (error, code) => error?.code === code;
const unique = () => randomBytes(5).toString('hex');
const refuseAmbient = () => {
  for (const key of ['PGDATA', 'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGPASSWORD',
    'LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR', 'METAENGINE_OWNER_FILE',
    'METAENGINE_STATE_DATABASE_URL', 'LOCAL_STATE_DATABASE_URL']) {
    assert.equal(process.env[key], undefined, 'REFUSE_AMBIENT_' + key);
  }
};
const projectSqlPath = new URL('./operator-supervisor-continuity-lease-v1.sql', import.meta.url);
const claimSqlPath = new URL('./fleet-coordination-claim-guard-v1.sql', import.meta.url);
const W26_FILE = 'apps/metaengine-browser/src/supervisor-continuity-lease.mjs';
const W39_FILE = 'infra/client-state-runtime/operator-agent-completion-bound-w39.mjs';
function fromPinnedRoot(root, relative) {
  assert(root && path.isAbsolute(root), 'exact upstream worktree required');
  return pathToFileURL(path.join(root, ...relative.split('/'))).href;
}
async function launch() {
  refuseAmbient();
  assert.equal(os.platform(), 'linux', 'real image runner must be Linux');
  const id = 'w45-pg17-' + unique();
  const password = 'synthetic_' + randomBytes(24).toString('hex');
  const args = ['run', '--detach', '--rm', '--name', id,
    '--publish', '127.0.0.1::5432',
    '--mount', 'type=volume,target=/var/lib/postgresql/data',
    '--env', 'POSTGRES_USER=w45_test_owner', '--env', 'POSTGRES_PASSWORD=' + password,
    '--env', 'POSTGRES_DB=w45_test_db', '--label', 'metaengine.w45.disposable=true', IMAGE];
  const cid = await docker(...args);
  assert(/^[a-f0-9]{64}$/.test(cid), 'no new container receipt');
  const endpoint = await docker('port', id, '5432/tcp');
  const found = endpoint.match(/127\.0\.0\.1:(\d+)/);
  assert(found, 'refuse non-loopback/implicit port');
  const port = Number(found[1]);
  const open = () => postgres({ host: '127.0.0.1', port, username: 'w45_test_owner',
    password, database: 'w45_test_db', max: 16, connect_timeout: 1,
    prepare: false, onnotice: () => {}, idle_timeout: 2 });
  const ready = async db => {
    for (let n = 0; n < 100; n++) {
      try {
        const [row] = await db.unsafe('SHOW server_version_num');
        if (Number(row.server_version_num) >= 170000 &&
            Number(row.server_version_num) < 180000) return;
        throw Error('UNPINNED_PG_MAJOR');
      } catch (error) {
        if (error.message === 'UNPINNED_PG_MAJOR') throw error;
        await sleep(100);
      }
    }
    throw Error('DISPOSABLE_PG17_READY_UNKNOWN');
  };
  return { id, password, port, open, ready };
}
test('client-pg17-qualification-w45: real isolated source/ACL/CAS/restart (SYNTHETIC_STAGING)',
  { skip: !enabled && !required ? 'PG17_DOCKER_UNAVAILABLE: UNKNOWN (not PASS)' : false,
    timeout: 240000 }, async t => {
  assert(enabled, 'REAL_PG17_REQUIRED_BUT_DOCKER_DISABLED');
  const { createOwnPostgresSupervisorContinuityLease } =
    await import(fromPinnedRoot(process.env.W45_W26_ROOT, W26_FILE));
  const { W39_PROJECT_SQL } = await import(fromPinnedRoot(process.env.W45_W39_ROOT, W39_FILE));
  assert.match(W39_PROJECT_SQL, /public\.h205f22_project_snapshot_v1/);
  const schema = await readFile(projectSqlPath, 'utf8');
  const claimSource = await readFile(claimSqlPath, 'utf8');
  const c = await launch();
  let admin = c.open();
  let reader;
  const owner = 'synthetic_owner_' + unique();
  const run = 'synthetic_run_' + unique();
  const role = 'w45_reader_' + unique();
  const writer = 'w45_writer_' + unique();
  const readerPassword = 'synthetic_' + unique();
  const writerPassword = 'synthetic_' + unique();
  const login = (username, password) => postgres({ host: '127.0.0.1', port: c.port,
    username, password, database: 'w45_test_db', max: 2, prepare: false, connect_timeout: 2 });
  try {
    await c.ready(admin);
    await t.test('PG17 source DDL grants, deny by default and READ ONLY FOR SHARE falsification', async () => {
      await admin.unsafe(schema);
      await admin.unsafe('CREATE ROLE ' + role + " LOGIN PASSWORD '" + readerPassword + "'");
      await admin.unsafe('CREATE ROLE ' + writer + " LOGIN PASSWORD '" + writerPassword + "'");
      await admin.unsafe('GRANT SELECT ON public.metaengine_supervisor_continuity_lease_v1 TO ' + role);
      await admin.unsafe('GRANT SELECT, INSERT, UPDATE ON public.metaengine_supervisor_continuity_lease_v1 TO ' + writer);
      reader = login(role, readerPassword);
      const w = login(writer, writerPassword);
      try {
        assert.deepEqual(await reader.unsafe('SELECT owner_id FROM public.metaengine_supervisor_continuity_lease_v1'), []);
        await assert.rejects(reader.unsafe("INSERT INTO public.metaengine_supervisor_continuity_lease_v1(owner_id,run_id,process_incarnation_id,lease_generation,expires_at) VALUES('x','y','z',1,now())"), e => isCode(e, '42501'));
        // W39's fixed project snapshot calls SELECT FOR SHARE in its grant helper.
        // This is real PG17 behavior, not a claim that an Owner READ ONLY transaction works.
        await admin.unsafe('CREATE TABLE public.w45_share_probe(id int primary key)');
        await admin.unsafe('INSERT INTO public.w45_share_probe VALUES (1)');
        await admin.unsafe('REVOKE ALL ON public.w45_share_probe FROM PUBLIC');
        await admin.unsafe('GRANT SELECT ON public.w45_share_probe TO ' + role);
        await assert.rejects(reader.begin(async tx => {
          await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          await tx.unsafe('SELECT id FROM public.w45_share_probe FOR SHARE');
        }), e => isCode(e, '25006'));
        await reader.begin(async tx => {
          await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          assert.deepEqual(await tx.unsafe('SELECT id FROM public.w45_share_probe FOR SHARE'), [{ id: 1 }]);
        });
        // Synthetic RLS fixture: verify engine enforcement, not live Owner policy.
        await admin.unsafe("CREATE TABLE public.w45_rls_probe(owner_id text, value int)");
        await admin.unsafe("INSERT INTO public.w45_rls_probe VALUES ('owner_A',1),('owner_B',2)");
        await admin.unsafe('ALTER TABLE public.w45_rls_probe ENABLE ROW LEVEL SECURITY');
        await admin.unsafe('CREATE POLICY w45_only_a ON public.w45_rls_probe FOR SELECT TO ' + role + " USING (owner_id='owner_A')");
        await admin.unsafe('GRANT SELECT ON public.w45_rls_probe TO ' + role);
        assert.deepEqual(await reader.unsafe('SELECT value FROM public.w45_rls_probe'), [{ value: 1 }]);
        await assert.rejects(reader.unsafe('DELETE FROM public.w45_rls_probe'), e => isCode(e, '42501'));
        await admin.unsafe("CREATE FUNCTION public.w45_exec_probe() RETURNS text LANGUAGE sql AS 'SELECT ''synthetic''::text'");
        await admin.unsafe('REVOKE ALL ON FUNCTION public.w45_exec_probe() FROM PUBLIC');
        await assert.rejects(reader.unsafe('SELECT public.w45_exec_probe()'), e => isCode(e, '42501'));
        await admin.unsafe('GRANT EXECUTE ON FUNCTION public.w45_exec_probe() TO ' + role);
        assert.equal((await reader.unsafe('SELECT public.w45_exec_probe()'))[0].w45_exec_probe, 'synthetic');
      } finally { await w.end({ timeout: 2 }); }
    });
    await t.test('actual W26 lease CAS, lost commit ACK, event order and no automatic retry', async () => {
      const maker = (incarnation, opts = {}) => createOwnPostgresSupervisorContinuityLease({
        sql: opts.sql || admin, ownerId: owner, runId: run,
        processIncarnationId: incarnation, ttlMs: 5000,
        verifyNativeReceipt: opts.verifyNativeReceipt ?? null,
      });
      const contenders = Array.from({ length: 8 }, (_, n) => maker('concurrent_' + n));
      const attempts = await Promise.allSettled(contenders.map(x => x.acquireBoot()));
      const winners = attempts.flatMap((x, n) => x.status === 'fulfilled' && x.value ? [n] : []);
      assert.equal(winners.length, 1, 'single owner CAS; lock timeout may only fail closed');
      const first = contenders[winners[0]];
      let drop = false;
      const ackLoss = { begin: async callback => {
        const result = await admin.begin(callback);
        if (drop) { drop = false; throw Error('synthetic_ack_lost_after_commit'); }
        return result;
      } };
      const old = maker(first.snapshot().process_incarnation_id, { sql: ackLoss });
      assert(old.snapshot() === null);
      assert.equal((await old.acquireBoot()).lease_generation, 1);
      drop = true;
      await assert.rejects(old.reserveWake({ wake_id: 'wake_' + unique() + unique(),
        supervisor_epoch: 7, cycle_seq: 8 }), /synthetic_ack_lost_after_commit/);
      const [committed] = await admin.unsafe('SELECT pending_wake_status,event_seq FROM public.metaengine_supervisor_continuity_lease_v1 WHERE owner_id=$1 AND run_id=$2', [owner, run]);
      assert.equal(committed.pending_wake_status, 'PREPARED');
      assert.equal(Number(committed.event_seq), 1);
      await sleep(5300);
      const next = maker('new_incarnation');
      const boot = await next.acquireBoot();
      assert.equal(boot.lease_generation, 2);
      assert.equal(boot.pending_wake_status, 'AMBIGUOUS');
      assert.equal(await next.reserveWake({ wake_id: 'wake_' + unique() + unique(),
        supervisor_epoch: 8, cycle_seq: 1 }), null);
      const fake = {
        source: 'NATIVE_EXECUTOR_RECEIPT', owner_id: owner, run_id: run,
        process_incarnation_id: boot.pending_wake_process_incarnation_id,
        wake_id: boot.pending_wake_id, lease_generation: boot.pending_wake_lease_generation,
        supervisor_epoch: boot.pending_wake_epoch, cycle_seq: boot.pending_wake_cycle,
        event_seq: boot.event_seq + 1, receipt_sha256: 'a'.repeat(64),
        effect_state: 'SENT', trusted_native_readback: true,
      };
      assert.equal((await next.reconcile(fake)).state, 'UNRESOLVED');
      assert.equal((await admin.unsafe('SELECT pending_wake_status FROM public.metaengine_supervisor_continuity_lease_v1 WHERE owner_id=$1 AND run_id=$2', [owner, run]))[0].pending_wake_status, 'AMBIGUOUS');
      const [before] = await admin.unsafe('SELECT event_seq FROM public.metaengine_supervisor_continuity_lease_v1 WHERE owner_id=$1 AND run_id=$2', [owner, run]);
      assert.equal(Number(before.event_seq), 1);
    });
    await t.test('real postmaster restart preserves pending ambiguity and epoch fencing', async () => {
      const prior = (await admin.unsafe('SELECT * FROM public.metaengine_supervisor_continuity_lease_v1 WHERE owner_id=$1 AND run_id=$2', [owner, run]))[0];
      assert(prior && prior.pending_wake_status === 'AMBIGUOUS');
      await reader?.end({ timeout: 2 }); reader = null;
      await admin.end({ timeout: 2 });
      await docker('restart', c.id);
      admin = c.open();
      await c.ready(admin);
      const [after] = await admin.unsafe('SELECT * FROM public.metaengine_supervisor_continuity_lease_v1 WHERE owner_id=$1 AND run_id=$2', [owner, run]);
      assert.equal(after.pending_wake_status, 'AMBIGUOUS');
      assert.equal(after.process_incarnation_id, prior.process_incarnation_id);
      assert.equal(Number(after.lease_generation), Number(prior.lease_generation));
      assert.equal(Number(after.event_seq), Number(prior.event_seq));
      assert.equal(after.pending_wake_id, prior.pending_wake_id);
    });
    await t.test('real claim SQL advisory CAS, slot return and stop boundary (fixture graph)', async () => {
      await admin.unsafe('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN');
      await admin.unsafe('CREATE SCHEMA destruktion_meta');
      await admin.unsafe('CREATE TABLE destruktion_meta.devos_fleet_task_h205f22(task_id uuid primary key,workspace_id uuid,role text,task_spec jsonb,state text,lease_generation bigint,lease_agent_id text,authority_effect boolean DEFAULT false,result_sha256 text)');
      await admin.unsafe('CREATE TABLE destruktion_meta.project_task_h205f22(task_id uuid primary key,project_id uuid)');
      await admin.unsafe("CREATE TABLE destruktion_meta.devos_fleet_claim_h205f22(claim_id bigint generated always as identity primary key,task_id uuid,workspace_id uuid,authority_effect boolean DEFAULT false,lease_generation bigint,agent_id text,state text default 'ACTIVE',expires_at timestamptz)");
      // Dependency-ready function is a synthetic stub; this test only exercises
      // exact SQL source resource/claim locking, not completed-project acceptance.
      await admin.unsafe('CREATE FUNCTION destruktion_meta.project_completion_ready_h205f22(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$');
      await admin.unsafe(claimSource);
      const ws = randomUUID(), project = randomUUID();
      const tasks = Array.from({ length: 3 }, () => randomUUID());
      for (let n = 0; n < tasks.length; n++) {
        await admin.unsafe('INSERT INTO destruktion_meta.project_task_h205f22 VALUES($1,$2)', [tasks[n], project]);
        await admin.unsafe("INSERT INTO destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,role,task_spec,state,lease_generation,lease_agent_id) VALUES($1,$2,'IMPLEMENTER',$3::jsonb,'LEASED',1,$4)", [
          tasks[n], ws, JSON.stringify({ fleet_coordination_v1: {
            version: 1, role: 'IMPLEMENTER', resource: 'HOST', slots: 2, dependencies: [] } }), 'agent_' + n]);
      }
      const insert = n => admin.unsafe("INSERT INTO destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,lease_generation,agent_id,expires_at) VALUES($1,$2,1,$3,clock_timestamp()+interval '30 seconds') RETURNING claim_id", [tasks[n], ws, 'agent_' + n]);
      const attempts = await Promise.allSettled([insert(0), insert(1), insert(2)]);
      assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1, 'HOST 2-slot capacity is strict under concurrent claims');
      assert(attempts.filter(a => a.status === 'rejected').every(a => isCode(a.reason, '55000')));
      const [active] = await admin.unsafe("SELECT count(*)::int AS count FROM destruktion_meta.devos_fleet_claim_h205f22 WHERE state='ACTIVE'");
      assert.equal(active.count, 1);
      // A stop signal must be enforced by existing executor admission, not by
      // this W5 trigger; source alone does not establish emergency-stop authority.
      await admin.unsafe("UPDATE destruktion_meta.devos_fleet_claim_h205f22 SET state='RETURNED' WHERE state='ACTIVE'");
      assert.equal((await insert(2)).length, 1, 'slot returns when committed claim leaves ACTIVE');
      assert.equal((await admin.unsafe("SELECT count(*)::int AS count FROM destruktion_meta.devos_fleet_claim_h205f22 WHERE state='ACTIVE'"))[0].count, 1);
    });
    console.log(JSON.stringify({
      schema: 'metaengine.client-pg17-qualification-w45.v1',
      classification: 'SYNTHETIC_STAGING', postgres_major: 17,
      image: IMAGE, w37: W37_SHA, w26: W26_SHA, w39: W39_SHA,
      installed_owner_verified: false, live_effect_authority: false,
      completion_project_seeded: false, emergency_stop_executor_attested: false,
      result: 'SOURCE_BEHAVIOR_ONLY_REVIEW_REQUIRED',
    }));
  } finally {
    await reader?.end({ timeout: 2 }).catch(() => {});
    await admin.end({ timeout: 2 }).catch(() => {});
    // Delete only the named test-created container and its anonymous volume.
    await docker('rm', '--force', '--volumes', c.id).catch(() => {});
  }
});
