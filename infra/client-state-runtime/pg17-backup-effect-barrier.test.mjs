import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildBackupEffectIntent,publishBackupEffectIntent,
  crossBackupEffectBarrier,readBackupEffectFence} from './pg17-backup-effect-barrier.mjs';
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-one-shot-backup-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const intent=buildBackupEffectIntent({
    intentId:randomUUID(),ownerPid:111,keeperPid:222,
    sourceHead:'a'.repeat(40),ownerSha256:'b'.repeat(64),
    postmasterSha256:'c'.repeat(64),
    archivePath:path.join(root,'brand-new-pg17-snapshot.dump'),
  });
  return {root,intent};
}
test('journal starts with no intent and never grants retry',async t=>{
  const {root,intent}=await fixture(t);
  const status=await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id});
  assert.equal(status.state,'NO_INTENT');assert.equal(status.automatic_retry_allowed,false);
  assert.equal(status.upgrade_authorized,false);
});
test('one-shot publication -> durable barrier -> restart readback fences replay',async t=>{
  const {root,intent}=await fixture(t);
  assert.equal((await publishBackupEffectIntent({journalDirectory:root,intent})).state,'PREPARED');
  assert.equal((await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id})).state,'PRE_EFFECT_FENCED');
  assert.equal((await crossBackupEffectBarrier({journalDirectory:root,intent})).state,'EFFECT_MAY_HAVE_STARTED');
  const readback=await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id});
  assert.equal(readback.state,'EFFECT_UNKNOWN');assert.equal(readback.barrier_found,true);
  assert.equal(readback.automatic_retry_allowed,false);
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent}),/backup_effect_write_ambiguous/);
  await assert.rejects(publishBackupEffectIntent({journalDirectory:root,intent}),/backup_effect_write_ambiguous/);
});
test('concurrent starts permit at most one barrier and one effect permission',async t=>{
  const {root,intent}=await fixture(t);
  await publishBackupEffectIntent({journalDirectory:root,intent});
  const settled=await Promise.allSettled(Array.from({length:12},()=>crossBackupEffectBarrier({journalDirectory:root,intent})));
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected').length,11);
});
test('journal rejects archive reuse even for a newly generated intent',async t=>{
  const {root,intent}=await fixture(t);
  await fs.writeFile(intent.archive_path,'');
  await assert.rejects(publishBackupEffectIntent({journalDirectory:root,intent}),/archive_existing/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id})).state,'NO_INTENT');
});
test('cross refuses a changed existing archive and an altered intent payload',async t=>{
  const {root,intent}=await fixture(t);
  await publishBackupEffectIntent({journalDirectory:root,intent});
  const altered=buildBackupEffectIntent({
    intentId:intent.intent_id,ownerPid:intent.owner_pid,
    keeperPid:intent.keeper_pid,sourceHead:intent.source_head,
    ownerSha256:'f'.repeat(64),postmasterSha256:intent.keeper_postmaster_sha256,
    archivePath:intent.archive_path,
  });
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent:altered}),/intent_drift/);
  await fs.writeFile(intent.archive_path,'');
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent}),/archive_existing/);
});
test('bad source identity and journal alias fail closed',async t=>{
  const {root,intent}=await fixture(t);
  assert.throws(()=>buildBackupEffectIntent({
    intentId:intent.intent_id,ownerPid:111,keeperPid:111,
    sourceHead:intent.source_head,ownerSha256:intent.owner_sha256,
    postmasterSha256:intent.keeper_postmaster_sha256,archivePath:intent.archive_path,
  }),/backup_effect_intent_invalid/);
  const alias=path.join(path.dirname(root),'alias-'+randomUUID());
  try{await fs.symlink(root,alias,'junction');}
  catch(error){if(process.platform==='win32'){t.diagnostic('symlink privilege unavailable');return;}throw error;}
  t.after(()=>fs.rm(alias,{force:true}));
  await assert.rejects(publishBackupEffectIntent({journalDirectory:alias,intent}),/journal_invalid/);
});

test('different UUIDs cannot reserve same new archive destination',async t=>{
  const {root,intent}=await fixture(t);
  await publishBackupEffectIntent({journalDirectory:root,intent});
  const competing=buildBackupEffectIntent({
    intentId:randomUUID(),ownerPid:intent.owner_pid,keeperPid:intent.keeper_pid,
    sourceHead:intent.source_head,ownerSha256:intent.owner_sha256,
    postmasterSha256:intent.keeper_postmaster_sha256,archivePath:intent.archive_path,
  });
  await assert.rejects(publishBackupEffectIntent({journalDirectory:root,intent:competing}),
    /backup_effect_write_ambiguous/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:competing.intent_id})).state,'PRE_EFFECT_FENCED');
  assert.equal((await crossBackupEffectBarrier({journalDirectory:root,intent})).state,
    'EFFECT_MAY_HAVE_STARTED');
});
test('archive outside the exact private journal is refused before intent write',async t=>{
  const {root,intent}=await fixture(t);
  const unsafe=buildBackupEffectIntent({
    intentId:intent.intent_id,ownerPid:intent.owner_pid,keeperPid:intent.keeper_pid,
    sourceHead:intent.source_head,ownerSha256:intent.owner_sha256,
    postmasterSha256:intent.keeper_postmaster_sha256,
    archivePath:path.join(path.dirname(root),'should-not-write.dump'),
  });
  await assert.rejects(publishBackupEffectIntent({journalDirectory:root,intent:unsafe}),
    /backup_effect_archive_outside_journal/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'NO_INTENT');
});
test('corrupted archive reservation cannot be promoted to an effect crossing',async t=>{
  const {root,intent}=await fixture(t);
  await publishBackupEffectIntent({journalDirectory:root,intent});
  await fs.writeFile(path.join(root,'archive-reservation.json'),'{}');
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent}),
    /backup_effect_reservation_mismatch/);
  assert.equal((await readBackupEffectFence({journalDirectory:root,
    intentId:intent.intent_id})).state,'PRE_EFFECT_FENCED');
});
