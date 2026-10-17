import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';

const exec = promisify(execFile);
const bin = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
test('disposable PG17 evidence RPC preserves JSON, deduplicates and denies public roles', { skip: !bin, timeout: 180000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-evidence-sql-')));
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
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '--username=evidence_fixture_owner', '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '-E', 'UTF8'], { windowsHide: true, timeout: 60000 });
  await fs.unlink(passwordFile);
  if (process.platform === 'win32') owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 120000 });
  else {
    await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, 'start', '-w']);
    owned = { stop: async () => { await exec(path.join(bin, 'pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w']); return { cleanup_confirmed: true }; } };
  }
  sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: 'evidence_fixture_owner', password, max: 1, prepare: false, onnotice: () => {} });
  assert.match((await sql`SELECT version()`)[0].version, /PostgreSQL 17\./);
  await sql.unsafe('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE untrusted_probe;');
  const canonical = await fs.readFile(new URL('../../supabase/migrations/20261018010000_me2_evidence_plane_v1.sql', import.meta.url), 'utf8');
  const selfHeal = await fs.readFile(new URL('../../apps/me2-daemon/supabase-migration-me2-evidence.sql', import.meta.url), 'utf8');
  await sql.unsafe(canonical);
  const event = { seq: 1, ts: '2026-10-17T00:00:00Z', type: 'PROOF', data: JSON.stringify({ quoted: '"данные"', nested: [1, true] }) };
  const ingest = async (role, events) => sql.begin(async tx => {
    assert(['anon','authenticated','service_role','untrusted_probe'].includes(role));
    await tx.unsafe('SET LOCAL ROLE ' + role);
    // Keep the bind as text: postgres.js otherwise JSON-encodes a string again
    // when the described parameter type is jsonb, producing a scalar fixture.
    return (await tx.unsafe('SELECT public.me2_ingest_evidence_v1($1::text::jsonb) AS count', [JSON.stringify(events)]))[0].count;
  });
  assert.equal(await ingest('service_role', [event]), 1);
  assert.equal(await ingest('service_role', [event]), 0);
  assert.deepEqual((await sql`SELECT data FROM public.me2_evidence WHERE seq=1`)[0].data, JSON.parse(event.data));
  await assert.rejects(
    ingest('service_role', [{ ...event, data: JSON.stringify({ conflicting: true }) }]),
    error => error.code === '23505',
  );
  for (const role of ['anon','authenticated','untrusted_probe']) await assert.rejects(ingest(role, [{ ...event, seq: 2 }]), error => error.code === '42501');
  await sql.unsafe(canonical);
  await sql.unsafe(selfHeal);
  assert.equal(await ingest('service_role', [{ ...event, seq: 2, data: null }]), 1);
  // The forward repair must also replace an existing elevated function and
  // remove inherited PUBLIC execution, not merely create a fresh schema.
  await sql.unsafe('ALTER FUNCTION public.me2_ingest_evidence_v1(jsonb) SECURITY DEFINER; GRANT EXECUTE ON FUNCTION public.me2_ingest_evidence_v1(jsonb) TO PUBLIC;');
  const repair = await fs.readFile(new URL('../../supabase/migrations/20261017211756_me2_evidence_ingest_privilege_and_json_v1.sql', import.meta.url), 'utf8');
  await sql.unsafe(repair);
  assert.equal(await ingest('service_role', [{ ...event, seq: 3 }]), 1);
  const roleProof = await sql`SELECT r.rolname, has_function_privilege(r.oid, 'public.me2_ingest_evidence_v1(jsonb)', 'EXECUTE') AS allowed FROM pg_roles r WHERE rolname IN ('anon','authenticated','service_role','untrusted_probe') ORDER BY rolname`;
  assert.deepEqual(roleProof.map(r => [r.rolname, r.allowed]), [['anon',false],['authenticated',false],['service_role',true],['untrusted_probe',false]]);
  const [functionProof] = await sql`SELECT prosecdef FROM pg_proc WHERE oid='public.me2_ingest_evidence_v1(jsonb)'::regprocedure`;
  assert.equal(functionProof.prosecdef, false);
});
