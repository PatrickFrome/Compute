import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { inspectPostgres, normalizeRuntimeHealthFailure } from './launcher.mjs';

const config = { pgBinDir: process.cwd(), inspectDatabase: new URL('postgres://fixture:PRIVATE_SECRET@127.0.0.1:25432/test'), databasePort:25432 };
const identity = { data_directory:'fixture', version:170006, address:'127.0.0.1', port:25432, started_at:'fixture' };
function installSpawn(t, behavior) {
  const previous = childProcess.spawn;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kills = 0;
  child.kill = () => { child.kills++; child.emit('close', null, 'SIGTERM'); return true; };
  childProcess.spawn = () => { queueMicrotask(() => behavior(child)); return child; };
  syncBuiltinESMExports();
  t.after(() => { child.stdout.destroy(); childProcess.spawn = previous; syncBuiltinESMExports(); });
  return child;
}

test('psql exit before final stdout is drained cannot truncate PostgreSQL identity', async t => {
  const child = installSpawn(t, c => {
    c.emit('exit', 0, null);
    setImmediate(() => { c.stdout.end(JSON.stringify(identity)); c.emit('close', 0, null); });
  });
  assert.deepEqual(await inspectPostgres(config), identity);
  assert.equal(child.kills, 0);
});

test('nonzero psql close has a finite query failure even with private stdout', async t => {
  installSpawn(t, c => { c.stdout.end('PRIVATE_SECRET'); c.emit('exit', 1, null); c.emit('close', 1, null); });
  await assert.rejects(inspectPostgres(config), e => e.code === 'postgres_inspection_query_failed' && !e.message.includes('PRIVATE_SECRET'));
});

test('spawn errors never publish private executable paths or credentials', async t => {
  installSpawn(t, c => c.emit('error', new Error('PRIVATE_SECRET')));
  await assert.rejects(inspectPostgres(config), { code:'postgres_inspection_spawn_failed' });
});

test('multibyte PostgreSQL output is bounded in bytes and terminates only its new child', async t => {
  const child=installSpawn(t, c => c.stdout.write('😀'.repeat(17000)));
  await assert.rejects(inspectPostgres(config), { code:'postgres_inspection_output_limit' });
  assert.equal(child.kills, 1);
});

test('an undrained psql pipe reaches the deadline rather than reporting a false successful exit', async t => {
  const child=installSpawn(t, c => c.emit('exit', 0, null));
  await assert.rejects(inspectPostgres(config), { code:'postgres_inspection_timeout' });
  assert.equal(child.kills, 1);
});

test('new inspection categories stay within the redacted host health contract', () => {
  for(const code of ['postgres_inspection_timeout','postgres_inspection_spawn_failed','postgres_inspection_query_failed','postgres_inspection_output_limit']) {
    const value={schema:'metaengine.client-state.health-failure.v1',code,component:'postgres',consecutive_failures:3,http_status:null,authority_effect:false};
    assert.deepEqual(normalizeRuntimeHealthFailure(value),value);
    assert.throws(()=>normalizeRuntimeHealthFailure({...value,stderr:'PRIVATE_SECRET'}),/contract_invalid/);
  }
});
