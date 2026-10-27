import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createW64DisposablePgLifecycle, formatW64PostmasterBirthDiagnostic,
  isW64PostmasterBirthWithinStartupEnvelope } from './client-serial-loop-pg17-lifecycle-w64.mjs';

// postmaster.pid's truncated MyStartTimestamp can precede PgStartTime across
// a second boundary. No arbitrary birth drift, negative skew or foreign PID
// may substitute for the independent PID/PGDATA/port/SQL readbacks.
test('W64 PG17 start-time fence accepts only same or immediately next second', () => {
  const birth=1792029805;
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029805000),true);
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029805500),true);
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029806001),true);
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029806999.999),true);
  for (const sql of [1792029804999,1792029807000,1792029810000,0,-1,
    Number.NaN,Number.POSITIVE_INFINITY,'1792029806001']) {
    assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,sql),false);
  }
  for (const bad of [0,-1,1.5,'1792029805',NaN,Infinity]) {
    assert.equal(isW64PostmasterBirthWithinStartupEnvelope(bad,1792029806000),false);
  }
});

const diagnosticInput = {
  pidBirthSeconds: 1793013680, sqlBirthSecond: 1793013682,
  sqlBirthEpoch: '1793013682.125001', serverVersionNum: '170011',
};

test('W64 birth failure diagnostic preserves exact SQL decimal and both failed predicates', () => {
  const detail = JSON.parse(formatW64PostmasterBirthDiagnostic(diagnosticInput));
  assert.deepEqual(detail, {
    schema: 'metaengine.w64.pg17-birth-diagnostic.v1',
    pid_birth_seconds: diagnosticInput.pidBirthSeconds,
    sql_floor_seconds: diagnosticInput.sqlBirthSecond,
    sql_epoch_seconds: diagnosticInput.sqlBirthEpoch,
    sql_birth_ms: Number(diagnosticInput.sqlBirthEpoch) * 1000,
    delta_ms: Number(diagnosticInput.sqlBirthEpoch) * 1000 - diagnosticInput.pidBirthSeconds * 1000,
    sql_floor_matches: true, within_startup_envelope: false,
    server_version_num: 170011,
    platform: process.platform, arch: process.arch, node: process.versions.node,
  });
  const floorMismatch = JSON.parse(formatW64PostmasterBirthDiagnostic({
    ...diagnosticInput, sqlBirthSecond: 1793013681, sqlBirthEpoch: '1793013680.125001',
  }));
  assert.equal(floorMismatch.sql_floor_matches, false);
  assert.equal(floorMismatch.within_startup_envelope, true);
});

test('W64 birth diagnostic is bounded and excludes raw paths, errors, environment and invalid fields', () => {
  const secret = '/private/PGDATA secret=password\n' + 'x'.repeat(10000);
  for (const bad of [secret, '', 'NaN', 'Infinity', '1e9', '1793013680.1234567']) {
    const serialized = formatW64PostmasterBirthDiagnostic({
      pidBirthSeconds: Infinity, sqlBirthSecond: NaN, sqlBirthEpoch: bad,
      serverVersionNum: bad, root: secret, env: secret, error: secret,
    });
    const detail = JSON.parse(serialized);
    assert.ok(serialized.length < 768);
    assert.doesNotMatch(serialized, /private|password|PGDATA|secret|NaN|Infinity/);
    for (const key of ['pid_birth_seconds', 'sql_floor_seconds', 'sql_epoch_seconds',
      'sql_birth_ms', 'delta_ms', 'server_version_num']) assert.equal(detail[key], null);
    assert.equal(detail.sql_floor_matches, false);
    assert.equal(detail.within_startup_envelope, false);
  }
});

async function mockLifecycle(t, { epoch = '1793013680.125001', floor = '1793013680',
  port = 55432, mutatePid, sqlData, extraField = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w64-lifecycle-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  await mkdir(data);
  const pidFile = path.join(data, 'postmaster.pid');
  const pidText = (pid = 12345, birth = 1793013680) => `${pid}\n${data}\n${birth}\n55432\n`;
  await writeFile(pidFile, pidText());
  const calls = [];
  const lifecycle = createW64DisposablePgLifecycle({ root, data, port: 55432, pgUser: 'w48_temp',
    run(name, args) {
      calls.push({ name, args });
      if (name === 'psql') {
        assert.match(args.at(-1), /floor\(extract\(epoch from pg_postmaster_start_time\(\)\)\)::bigint/);
        assert.match(args.at(-1), /current_setting\('server_version_num'\)/);
        if (mutatePid) writeFileSync(pidFile, pidText(...mutatePid));
        return `${sqlData || data}|${floor}|${epoch}|${port}|170011${extraField ? '|extra' : ''}`;
      }
      assert.ok(['pg_ctl', 'pg_isready'].includes(name));
      return '';
    },
  });
  return { lifecycle, calls, root, data };
}

test('W64 successful lifecycle start retains exact identity checks and performs no diagnostic query', async t => {
  const { lifecycle, calls } = await mockLifecycle(t);
  const birth = await lifecycle.start('-h 127.0.0.1');
  assert.equal(birth.pid, 12345);
  assert.equal(birth.birthSec, 1793013680);
  assert.equal(birth.birthMs, Number('1793013680.125001') * 1000);
  assert.deepEqual(calls.map(call => call.name), ['pg_ctl', 'pg_isready', 'psql']);
});

test('W64 lifecycle rejects negative skew, upper boundary and floor mismatch with safe diagnostics', async t => {
  for (const scenario of [
    { epoch: '1793013679.999999', floor: '1793013679', within: false, floorMatches: true },
    { epoch: '1793013682.000000', floor: '1793013682', within: false, floorMatches: true },
    { epoch: '1793013680.125001', floor: '1793013681', within: true, floorMatches: false },
    { epoch: 'invalid', floor: '1793013680', within: false, floorMatches: false },
  ]) {
    const { lifecycle, root, calls } = await mockLifecycle(t, scenario);
    await assert.rejects(lifecycle.start('-h 127.0.0.1'), error => {
      assert.equal(error.code, 'ERR_ASSERTION');
      const prefix = 'postmaster birth changed beyond bounded startup envelope: ';
      assert.ok(error.message.startsWith(prefix));
      assert.ok(error.message.length < 850);
      assert.ok(!error.message.includes(root));
      const detail = JSON.parse(error.message.slice(prefix.length));
      assert.equal(detail.within_startup_envelope, scenario.within);
      assert.equal(detail.sql_floor_matches, scenario.floorMatches);
      assert.equal(detail.server_version_num, 170011);
      return true;
    });
    assert.deepEqual(calls.map(call => call.name), ['pg_ctl', 'pg_isready', 'psql']);
  }
});

test('W64 diagnostics do not bypass exact incarnation, PGDATA, port or row-shape checks', async t => {
  for (const [scenario, reason] of [
    [{ mutatePid: [12346, 1793013680] }, /PID\/birth changed after independent readback/],
    [{ mutatePid: [12345, 1793013681] }, /PID\/birth changed after independent readback/],
    [{ sqlData: os.tmpdir() }, /SQL connected to foreign PGDATA/],
    [{ port: 55433 }, /connected to wrong PostgreSQL port/],
    [{ extraField: true }, /unbound PG identity result/],
  ]) {
    const { lifecycle } = await mockLifecycle(t, scenario);
    await assert.rejects(lifecycle.readback(), reason);
  }
});
