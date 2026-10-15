// W64: lifecycle ONLY for newly generated, Owner-free disposable PG17 fixtures.
// pg_ctl's -l is essential: an otherwise healthy postmaster inherits the stdout
// pipe of execFileSync(pg_ctl), leaving Node waiting for EOF until ETIMEDOUT.
// No installed PGDATA, caller-specified root, network service or LIVE authority.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export function createW64DisposablePgLifecycle({ run, root, data, port, pgUser }) {
  assert.equal(path.dirname(data), root, 'fixture PGDATA must be directly inside its unique root');
  assert.ok(Number.isSafeInteger(port) && port > 1024 && port < 65536);
  assert.match(pgUser, /^w(?:48|56)_temp(?:orary)?$/);
  const log = path.join(root, 'postmaster-w64.log');
  const pidFile = path.join(data, 'postmaster.pid');
  const ctl = ['-D', data, '-w'];
  const stopArgs = [...ctl, '-m', 'immediate', 'stop'];

  async function ownedPid() {
    const parts = (await readFile(pidFile, 'utf8')).split(/\r?\n/);
    const pid = Number(parts[0]), birthSec = Number(parts[2]);
    assert.ok(Number.isSafeInteger(pid) && pid > 1, 'missing real postmaster PID');
    assert.ok(Number.isSafeInteger(birthSec) && birthSec > 0, 'missing postmaster birth');
    assert.equal(await realpath(parts[1]), await realpath(data), 'postmaster.pid belongs to foreign data root');
    assert.equal(Number(parts[3]), port, 'postmaster port changed');
    return { pid, birthSec };
  }
  async function readback() {
    const birth = await ownedPid();
    // pg_isready alone could see an unrelated server on a stolen ephemeral
    // port; independent SQL data_directory and start-time bind the socket.
    run('pg_isready', ['-q', '-h', '127.0.0.1', '-p', String(port), '-U', pgUser, '-d', 'postgres']);
    const sql = "SELECT current_setting('data_directory') || '|' || floor(extract(epoch from pg_postmaster_start_time()))::bigint || '|' || extract(epoch from pg_postmaster_start_time()) || '|' || inet_server_port()";
    const fields = run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', sql]).split('|');
    assert.equal(fields.length, 4, 'unbound PG identity result');
    assert.equal(await realpath(fields[0]), await realpath(data), 'SQL connected to foreign PGDATA');
    assert.equal(Number(fields[1]), birth.birthSec, 'postmaster birth changed during read');
    assert.equal(Number(fields[3]), port, 'connected to wrong PostgreSQL port');
    const birthMs = Number(fields[2]) * 1000;
    assert.ok(Number.isFinite(birthMs) && birthMs > 0);
    assert.deepEqual(await ownedPid(), birth, 'PID/birth changed after independent readback');
    return Object.freeze({ ...birth, birthMs, port, log });
  }
  async function start(opts) {
    // The postmaster's inherited pipe caused both real CI tests to TIMEOUT
    // despite "database system is ready" and "server started" in stdout.
    run('pg_ctl', [...ctl, '-l', log, '-o', opts, 'start']);
    return readback();
  }
  async function stop() {
    const before = await readback();
    run('pg_ctl', stopArgs);
    await assert.rejects(readFile(pidFile, 'utf8'), { code: 'ENOENT' });
    return before;
  }
  async function cleanup() {
    // Even if pg_ctl start throws/ETIMEDOUT before a started flag is set,
    // a generated cluster may still be alive. Refuse foreign PID evidence.
    let exists = false;
    try { await ownedPid(); exists = true; }
    catch (e) {
      if (e?.code !== 'ENOENT') return false;
    }
    if (exists) {
      try { run('pg_ctl', stopArgs); }
      catch { return false; }
    }
    try { await readFile(pidFile, 'utf8'); return false; }
    catch (e) { return e?.code === 'ENOENT'; }
  }
  async function logTail() {
    // Purely generated fixture log; no production credentials / SQL values.
    try { return (await readFile(log, 'utf8')).slice(-6000); }
    catch (e) { return 'No generated PG17 server log: ' + (e?.code || 'unavailable'); }
  }
  return Object.freeze({ start, stop, readback, cleanup, logTail, log });
}
