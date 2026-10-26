import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildBackupEffectIntent,readBackupEffectFence}
  from './pg17-backup-effect-barrier.mjs';
import {executeDisposableOneShotPg17Dump}
  from './pg17-one-shot-disposable-dump-executor.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-safe-dump-exec-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const source=path.join(root,'data');
  await fs.mkdir(source);
  const intent=buildBackupEffectIntent({
    ownerPid:111,keeperPid:222,
    sourceHead:'a'.repeat(40),ownerSha256:'b'.repeat(64),
    postmasterSha256:'c'.repeat(64),
    archivePath:path.join(root,'postgresql-17-snapshot.dump'),
  });
  const params={intent,journalDirectory:root,sourceDataDirectory:source,
    pgBinDir:process.env.LOCAL_STATE_TEST_PG_BIN_DIR||root,
    expectedPgDumpSha256:'0'.repeat(64),
    sourcePort:55555,
    connectionEnv:{PGHOST:'127.0.0.1',PGPORT:'55555',
      PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:'secret-123456789012345',
      PGSSLMODE:'disable'}};
  return {root,intent,params};
}
test('installed Keeper 55432 is forbidden without an effect intent or connection',async t=>{
  const {root,intent,params}=await fixture(t);
  await assert.rejects(executeDisposableOneShotPg17Dump({...params,sourcePort:55432}),
    /pg17_disposable_authority_invalid/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
test('non-Windows execution refuses before resolving paths or publishing an intent',{
  skip:process.platform==='win32',
},async t=>{
  const {root,intent,params}=await fixture(t);
  const absent=path.join(root,'never-created-pgdata');
  await assert.rejects(executeDisposableOneShotPg17Dump({...params,sourceDataDirectory:absent}),
    /pg17_disposable_authority_invalid/);
  await assert.rejects(fs.stat(absent),{code:'ENOENT'});
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
test('production PGDATA path is forbidden even when a matching fake intent exists',{
  skip:process.platform!=='win32',
},async t=>{
  const {root,intent,params}=await fixture(t);
  await assert.rejects(executeDisposableOneShotPg17Dump({...params,
    sourceDataDirectory:process.cwd()}),/pg17_disposable_scope_invalid/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
test('invalid digest never crosses backup barrier',{skip:process.platform!=='win32'},async t=>{
  const {root,intent,params}=await fixture(t);
  if(!process.env.LOCAL_STATE_TEST_PG_BIN_DIR){
    t.skip('physical PostgreSQL binary path unavailable');return;
  }
  await assert.rejects(executeDisposableOneShotPg17Dump(params),
    /pg17_disposable_binary_digest_mismatch/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
test('connection must not be silently retargeted',{skip:process.platform!=='win32'},async t=>{
  const {root,intent,params}=await fixture(t);
  if(!process.env.LOCAL_STATE_TEST_PG_BIN_DIR){
    t.skip('physical PostgreSQL binary path unavailable');return;
  }
  // Passing binary trust first is necessary to reach the connection gate.
  const {createHash}=await import('node:crypto');
  const {createReadStream}=await import('node:fs');
  const h=createHash('sha256');
  for await(const b of createReadStream(path.join(params.pgBinDir,'pg_dump.exe')))h.update(b);
  await assert.rejects(executeDisposableOneShotPg17Dump({...params,
    expectedPgDumpSha256:h.digest('hex'),
    connectionEnv:{...params.connectionEnv,PGHOST:'example.com'}}),
    /pg17_disposable_connection_invalid/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
