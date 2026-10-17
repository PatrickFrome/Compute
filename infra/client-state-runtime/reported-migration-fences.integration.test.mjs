import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';

const exec = promisify(execFile);
const bin = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
const python = process.env.LOCAL_STATE_TEST_PYTHON;
const pythonAvailable = Boolean(python && spawnSync(python, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0);

test('disposable PG17 refuses missing migration fences', { skip: !bin, timeout: 180000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-report-fences-')));
  const data = path.join(root, 'pgdata');
  const password = randomBytes(32).toString('hex');
  const passwordFile = path.join(root, 'initdb-password');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  let owned, sql;
  t.after(async () => {
    await sql?.end({ timeout: 2 });
    if (owned) assert.equal((await owned.stop()).cleanup_confirmed, true);
    const rel = path.relative(await fs.realpath(os.tmpdir()), await fs.realpath(root));
    assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(passwordFile, password + '\n', { flag: 'wx', mode: 0o600 });
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '--username=report_fixture_owner', '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '-E', 'UTF8'], { windowsHide: true, timeout: 60000 });
  await fs.unlink(passwordFile);
  if (process.platform === 'win32') owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 120000 });
  else {
    await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, 'start', '-w']);
    owned = { stop: async () => { await exec(path.join(bin, 'pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w']); return { cleanup_confirmed: true }; } };
  }
  sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: 'report_fixture_owner', password, max: 1, prepare: false, onnotice: () => {} });
  assert.match((await sql`SELECT version()`)[0].version, /PostgreSQL 17\./);
  await sql.unsafe('CREATE SCHEMA destruktion_meta; CREATE SCHEMA "quoted""schema"; CREATE TABLE "quoted""schema"."quoted""table"(n integer); INSERT INTO "quoted""schema"."quoted""table" SELECT generate_series(1,7);');
  if (pythonAvailable) {
    const environment = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5' };
    const queryFixture = new URL('../pigsty/bootstrap/tests/query_fixture.py', import.meta.url);
    const query = await exec(python, [fileURLToPath(queryFixture), `host=127.0.0.1 port=${port} dbname=postgres user=report_fixture_owner`], { env: environment, windowsHide: true, timeout: 40000 });
    assert.equal(query.stdout.trim(), 'quoted_identifier_count=7');
  }

  const readGuard = async filename => {
    const text = await fs.readFile(new URL('../../supabase/migrations/' + filename, import.meta.url), 'utf8');
    const match = /do \$guard\$[\s\S]*?\$guard\$;/i.exec(text);
    assert(match, 'migration dependency guard missing');
    return match[0];
  };
  const transport = await readGuard('20260831184500_devos_fleet_transport_admission_v1.sql');
  const drift = await readGuard('20260902182000_devos_ready_base_drift_fence_v1.sql');
  await assert.rejects(sql.unsafe(transport), error => error.code === '55000' && /devos_transport_admission_dependency_required/.test(error.message));
  await assert.rejects(sql.unsafe(drift), error => error.code === '55000' && /devos_base_drift_dependency_required/.test(error.message));
  await sql.unsafe(`
    CREATE TABLE destruktion_meta.devos_fleet_claim_h205f22(n integer);
    CREATE FUNCTION destruktion_meta.devos_fleet_claim_transport_admission_h205f22() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TABLE destruktion_meta.metaengine_devos_roadmap_authority_h205f22(baseline_sha text, alignment_epoch bigint, authority_key text, integration_line text);
    CREATE FUNCTION destruktion_meta.devos_fence_ready_base_drift_h205f22() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  `);
  await sql.unsafe(transport);
  await assert.rejects(sql.unsafe(drift), error => error.code === '55000' && /devos_fleet_task_h205f22/.test(error.message));
  await sql.unsafe('CREATE TABLE destruktion_meta.devos_fleet_task_h205f22(workspace_id uuid, task_id uuid, point_id text, role text, lease_generation bigint, base_sha text, idempotency_key text, state text, error_code text, updated_at timestamptz);');
  await sql.unsafe(drift);
  const attached = await sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('devos_fleet_claim_transport_admission_trg','devos_fence_ready_base_drift_h205f22') ORDER BY tgname`;
  assert.deepEqual(attached.map(row => row.tgname), ['devos_fence_ready_base_drift_h205f22', 'devos_fleet_claim_transport_admission_trg']);
});
