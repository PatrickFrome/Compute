import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import durableJson from '../src/durable-json-file.cjs';
import { createClientGoalJournalFileStore } from '../src/client-goal-journal-file-store.mjs';
import { ClientGoalJournal } from '../src/client-goal-journal.mjs';

const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const intent = id => ({ request_id: id, goal: 'Run coordinated agent research' });
const { durableWriteJson } = durableJson;

async function fixture(t, options={}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'metaengine-goal-durability-'+randomUUID()+'-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return { ...createClientGoalJournalFileStore(dir, options), dir };
}

test('real durable file writer persists SUBMITTING before any execution and restores exact ID after restart', async t => {
  const f=await fixture(t);
  await f.journal.load();
  const started=await f.journal.begin(intent(id1));
  assert.equal(started.state, 'SUBMITTING');
  assert.equal(started.automatic_retry_allowed,false);
  assert.equal(f.journal.persistenceStatus().fenced,false);
  const bytes=await readFile(f.target,'utf8');
  const value=JSON.parse(bytes);
  assert.equal(value.entries[0].request_id,id1);
  assert.equal(value.entries[0].state,'SUBMITTING');
  assert.deepEqual(await readdir(f.dir),[path.basename(f.target)],'unique temporary files must not remain');
  const restart=createClientGoalJournalFileStore(f.dir).journal;
  await restart.load();
  assert.equal(restart.latest().request_id,id1);
  assert.equal(restart.latest().state,'SUBMITTING');
  const same=await restart.begin(intent(id1));
  assert.equal(same.request_id,id1);
  assert.equal(await readFile(f.target,'utf8'),bytes,'exact replay cannot rewrite intent');
});

test('post-rename filesystem error fences writer although disk contains new request', async t => {
  let commits=0;
  const f=await fixture(t,{writeDurable:async (target, snapshot)=>{
    await durableWriteJson(target,snapshot);
    commits++;
    throw new Error('synthetic_commit_ack_lost');
  }});
  await f.journal.load();
  await assert.rejects(f.journal.begin(intent(id1)),/synthetic_commit_ack_lost/);
  assert.equal(commits,1);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(f.journal.persistenceStatus().automatic_retry_allowed,false);
  assert.equal(f.journal.latest(),null,'memory never claims uncertain commit');
  assert.equal(JSON.parse(await readFile(f.target,'utf8')).entries[0].request_id,id1);
  await assert.rejects(f.journal.begin(intent(id2)),/persistence_reconciliation_required/);
  await assert.rejects(f.journal.begin(intent(id1)),/persistence_reconciliation_required/);
  assert.equal(commits,1,'no new write after unknown filesystem effect');
  const restart=createClientGoalJournalFileStore(f.dir).journal;
  await restart.load();
  assert.equal(restart.latest().request_id,id1,'new incarnation recovers durable intent');
  assert.equal((await restart.begin(intent(id1))).state,'SUBMITTING');
  assert.equal(restart.persistenceStatus().fenced,false);
});

test('missing durable receipt after possible write never advances in-memory state', async t => {
  const f=await fixture(t,{writeDurable:async (target,snapshot)=>{
    await writeFile(target,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
    return { contract:'METAENGINE_DURABLE_JSON_V1',file_synced:false,rename_committed:true };
  }});
  await f.journal.load();
  await assert.rejects(f.journal.begin(intent(id1)),/durable_receipt_missing/);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(f.journal.latest(),null);
  await assert.rejects(f.journal.begin(intent(id2)),/persistence_reconciliation_required/);
});

test('readback drift after nominal durable commit fences all subsequent submissions', async t => {
  let reads=0;
  const f=await fixture(t,{readFile:async(file,encoding)=>{
    reads++;
    if(reads===1) {
      const error=new Error('missing');error.code='ENOENT';throw error;
    }
    return 'stale_or_tampered_bytes';
  }});
  await f.journal.load();
  await assert.rejects(f.journal.begin(intent(id1)),/durable_readback_mismatch/);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(JSON.parse(await readFile(f.target,'utf8')).entries[0].request_id,id1);
  await assert.rejects(f.journal.begin(intent(id2)),/persistence_reconciliation_required/);
});

test('concurrently queued intents do not continue after first ambiguous persistence error', async t => {
  let committed=0;
  const f=await fixture(t,{writeDurable:async(target,snapshot)=>{
    committed++;
    await durableWriteJson(target,snapshot);
    throw new Error('synthetic_io_ack_missing');
  }});
  await f.journal.load();
  const first=f.journal.begin(intent(id1));
  const second=f.journal.begin(intent(id2));
  const settled=await Promise.allSettled([first,second]);
  assert.deepEqual(settled.map(row=>row.status),['rejected','rejected']);
  assert.match(String(settled[0].reason?.message),/synthetic_io_ack_missing/);
  assert.match(String(settled[1].reason?.message),/persistence_reconciliation_required/);
  assert.equal(committed,1);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(JSON.parse(await readFile(f.target,'utf8')).entries.length,1);
});

test('pure journal contract also fences after ambiguous external saveState failure', async () => {
  let count=0;
  const journal=new ClientGoalJournal({
    loadState:async()=>{const e=new Error('missing');e.code='ENOENT';throw e;},
    saveState:async()=>{count++;throw new Error('synthetic_save_unknown');},
  });
  await journal.load();
  await assert.rejects(journal.begin(intent(id1)),/synthetic_save_unknown/);
  await assert.rejects(journal.begin(intent(id2)),/persistence_reconciliation_required/);
  assert.equal(count,1);
  assert.equal(journal.latest(),null);
  assert.equal(journal.persistenceStatus().fenced,true);
});
