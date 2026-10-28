import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import durableJson from '../src/durable-json-file.cjs';
import { createClientAdmissionRecoveryJournalFileStore } from '../src/client-admission-recovery-journal-file-store.mjs';
import { ClientAdmissionRecoveryJournal } from '../src/client-admission-recovery-journal.mjs';

const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const request=id=>({attempt_id:id,expected_generation_floor:28});
const { durableWriteJson }=durableJson;

async function fixture(t,options={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'metaengine-admission-durability-'+randomUUID()+'-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return {...createClientAdmissionRecoveryJournalFileStore(dir,options),dir};
}

test('admission PREPARED and SEND_INTENT_DURABLE both survive disk restart',async t=>{
  const f=await fixture(t);
  await f.journal.load();
  await f.journal.begin(request(id1));
  let disk=JSON.parse(await readFile(f.target,'utf8'));
  assert.equal(disk.latest.state,'PREPARED');
  assert.equal(disk.latest.effect_intent_durable,false);
  await f.journal.markSendIntent();
  disk=JSON.parse(await readFile(f.target,'utf8'));
  assert.equal(disk.latest.state,'SEND_INTENT_DURABLE');
  assert.equal(disk.latest.effect_intent_durable,true);
  assert.equal(disk.latest.automatic_retry_allowed,false);
  assert.deepEqual(await readdir(f.dir),[path.basename(f.target)]);
  const restart=createClientAdmissionRecoveryJournalFileStore(f.dir).journal;
  await restart.load();
  assert.equal(restart.hasPending(),true);
  assert.equal(restart.latest().attempt_id,id1);
  await assert.rejects(restart.begin(request(id2)),/pending_reconcile_required/);
});

test('failed ack after actual durable admission write freezes old incarnation; disk restart retains intent',async t=>{
  let writes=0;
  const f=await fixture(t,{writeDurable:async(target,snapshot)=>{
    writes++;await durableWriteJson(target,snapshot);
    throw new Error('synthetic_after_rename_ack_lost');
  }});
  await f.journal.load();
  await assert.rejects(f.journal.begin(request(id1)),/synthetic_after_rename_ack_lost/);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(f.journal.hasPending(),true);
  assert.equal(f.journal.latest(),null,'unconfirmed write cannot advance in-memory admission');
  await assert.rejects(f.journal.begin(request(id2)),/pending_reconcile_required/);
  await assert.rejects(f.journal.markSendIntent(),/persistence_reconciliation_required/);
  await assert.rejects(f.journal.reconcile({}),/persistence_reconciliation_required/);
  assert.equal(writes,1);
  const disk=JSON.parse(await readFile(f.target,'utf8'));
  assert.equal(disk.latest.attempt_id,id1);
  assert.equal(disk.latest.state,'PREPARED');
  const restart=createClientAdmissionRecoveryJournalFileStore(f.dir).journal;
  await restart.load();
  assert.equal(restart.hasPending(),true);
  assert.equal(restart.latest().attempt_id,id1);
});

test('concurrently submitted admission begins must reserve exactly one durable intent',async t=>{
  const f=await fixture(t);
  await f.journal.load();
  const results=await Promise.allSettled([f.journal.begin(request(id1)),f.journal.begin(request(id2))]);
  assert.deepEqual(results.map(row=>row.status),['fulfilled','rejected']);
  assert.match(String(results[1].reason?.message),/pending_reconcile_required/);
  assert.equal(f.journal.hasPending(),true);
  assert.equal(JSON.parse(await readFile(f.target,'utf8')).latest.attempt_id,id1);
});

test('readback mismatch forbids reopening admission even when durable rename succeeded',async t=>{
  let read=0;
  const f=await fixture(t,{readFile:async()=>{
    if(++read===1){const e=new Error('missing');e.code='ENOENT';throw e;}
    return 'inconsistent bytes';
  }});
  await f.journal.load();
  await assert.rejects(f.journal.begin(request(id1)),/durable_readback_mismatch/);
  assert.equal(f.journal.persistenceStatus().fenced,true);
  assert.equal(f.journal.hasPending(),true);
  assert.equal(JSON.parse(await readFile(f.target,'utf8')).latest.state,'PREPARED');
  await assert.rejects(f.journal.markSendIntent(),/persistence_reconciliation_required/);
});

test('concurrent writes queued behind a failed admission persistence are rejected without a second save',async()=>{
  let saves=0;
  const journal=new ClientAdmissionRecoveryJournal({
    loadState:async()=>{const e=new Error('missing');e.code='ENOENT';throw e;},
    saveState:async()=>{saves++;throw new Error('synthetic_durable_ack_unknown');},
  });
  await journal.load();
  const outcomes=await Promise.allSettled([journal.begin(request(id1)),journal.begin(request(id2))]);
  assert.equal(outcomes.every(row=>row.status==='rejected'),true);
  assert.match(outcomes[0].reason.message,/synthetic_durable_ack_unknown/);
  assert.match(outcomes[1].reason.message,/persistence_reconciliation_required/);
  assert.equal(saves,1);
  assert.equal(journal.hasPending(),true);
});

function observedAdmission({ open = false } = {}) {
  return {
    schema: 'metaengine.devos.environment-state.v1',
    authoritative: true, authority_effect: false,
    read_request_id: randomUUID(),
    observation_source: 'AUTHENTICATED_POST_RESPONSE',
    observed_at: new Date(Date.now()+60_000).toISOString(),
    generation_floor: 28, state: open ? 'OPEN' : 'CLOSED',
    refill_enabled: open, supervisor_admission_enabled: open,
    continuous_service_allowed: open,
  };
}

test('stale reconciliation queued behind newer ambiguous intent cannot finalize admission',async()=>{
  let current=null,saves=0,release,signal;
  const entered=new Promise(resolve=>{signal=resolve;});
  const barrier=new Promise(resolve=>{release=resolve;});
  const journal=new ClientAdmissionRecoveryJournal({
    loadState:async()=>{const e=new Error('missing');e.code='ENOENT';throw e;},
    saveState:async value=>{
      saves++;
      if(saves===3){signal();await barrier;}
      current=structuredClone(value);
    },
  });
  await journal.load();
  await journal.begin(request(id1));
  await journal.markSendIntent();
  const advancing=journal.markAmbiguous('lost_reply_after_send');
  await entered;
  const staleReconcile=journal.reconcile(observedAdmission({open:true}));
  release();
  await advancing;
  await assert.rejects(staleReconcile,/reconcile_snapshot_changed/);
  assert.equal(journal.latest().state,'AMBIGUOUS');
  assert.equal(current.latest.state,'AMBIGUOUS');
  assert.equal(journal.hasPending(),true);
  assert.equal(saves,3,'no stale write may replace newer ambiguity');
});

test('second concurrent readback cannot overwrite a committed first terminal decision',async()=>{
  let saves=0,release,signal;
  const entered=new Promise(resolve=>{signal=resolve;});
  const barrier=new Promise(resolve=>{release=resolve;});
  const journal=new ClientAdmissionRecoveryJournal({
    loadState:async()=>{const e=new Error('missing');e.code='ENOENT';throw e;},
    saveState:async()=>{
      saves++;
      if(saves===3){signal();await barrier;}
    },
  });
  await journal.load();
  await journal.begin(request(id1));
  await journal.markSendIntent();
  const first=journal.reconcile(observedAdmission({open:false}));
  await entered;
  const second=journal.reconcile(observedAdmission({open:true}));
  release();
  await first;
  await assert.rejects(second,/reconcile_snapshot_changed/);
  assert.equal(journal.latest().state,'ABSENCE_CONFIRMED');
  assert.equal(journal.hasPending(),false);
  assert.equal(saves,3);
});

test('concurrent startup loads cannot overwrite a newly durable pending admission with stale disk state', async () => {
  const reads = [];
  const empty = { schema: 'metaengine.client.admission-recovery-journal.v1', latest: null,
    automatic_retry_allowed: false, authority_effect: false };
  let saved;
  const journal = new ClientAdmissionRecoveryJournal({
    loadState: () => new Promise(resolve => reads.push(resolve)),
    saveState: async value => { saved = structuredClone(value); },
  });
  const first = journal.load();
  const concurrent = journal.load();
  await Promise.resolve();
  reads[0](structuredClone(empty));
  await first;
  await journal.begin(request(id1));
  // A second physical read may already have captured the old empty file.
  // Completing it after the write must not erase the in-memory admission.
  for (const resolve of reads.slice(1)) resolve(structuredClone(empty));
  await concurrent;
  assert.equal(journal.latest()?.attempt_id, id1);
  assert.equal(journal.hasPending(), true);
  await assert.rejects(journal.begin(request(id2)), /pending_reconcile_required/);
  assert.equal(saved.latest.attempt_id, id1);
  assert.equal(reads.length, 1, 'startup must share one load operation');
});

test('failed shared startup read rejects all callers and permits a later verified read', async () => {
  let reads = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const journal = new ClientAdmissionRecoveryJournal({
    loadState: async () => {
      reads++;
      if (reads === 1) { await barrier; throw new Error('synthetic_initial_read_failure'); }
      return { schema: 'metaengine.client.admission-recovery-journal.v1', latest: null,
        automatic_retry_allowed: false, authority_effect: false };
    },
    saveState: async () => {},
  });
  const results = Promise.allSettled([journal.load(), journal.load()]);
  release();
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /synthetic_initial_read_failure/);
  }
  assert.equal(reads, 1);
  await journal.load();
  assert.equal(reads, 2);
  await journal.begin(request(id1));
  assert.equal(journal.latest().attempt_id, id1);
});

for (const malformed of [null, { schema: 'metaengine.client.admission-recovery-journal.v1', automatic_retry_allowed: false, authority_effect: false }]) {
  test(`existing malformed admission journal cannot be treated as a fresh profile: ${JSON.stringify(malformed)}`, async t => {
    const f = await fixture(t);
    const bytes = JSON.stringify(malformed);
    await writeFile(f.target, bytes);
    await assert.rejects(f.journal.load(), /client_admission_recovery_snapshot_invalid/);
    await assert.rejects(f.journal.begin(request(id1)), /client_admission_recovery_snapshot_invalid/);
    assert.equal(await readFile(f.target, 'utf8'), bytes, 'unknown durable history must not be overwritten');
  });
}

test('admission journal refuses an unsupported nested attempt schema without rewriting it', async t => {
  const f = await fixture(t);
  await f.journal.begin(request(id1));
  const snapshot = JSON.parse(await readFile(f.target, 'utf8'));
  snapshot.latest.schema = 'metaengine.client.admission-recovery-attempt.v99';
  const bytes = JSON.stringify(snapshot);
  await writeFile(f.target, bytes);
  const restart = createClientAdmissionRecoveryJournalFileStore(f.dir).journal;
  await assert.rejects(restart.load(), /client_admission_recovery_attempt_invalid/);
  assert.equal(await readFile(f.target, 'utf8'), bytes);
});
