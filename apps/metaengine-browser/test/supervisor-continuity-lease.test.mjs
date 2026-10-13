import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOwnPostgresSupervisorContinuityLease, qualifySupervisorWakeReceipt,
} from '../src/supervisor-continuity-lease.mjs';

const clockStart = Date.parse('2026-10-13T00:00:00Z');
const wakeA = 'wake_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const wakeB = 'wake_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const receiptHash = 'a'.repeat(64);

function database() {
  let row = null;
  let now = clockStart;
  let fail = false;
  const sql = { begin: async work => {
    if (fail) throw Error('postgres_unavailable');
    return work({ unsafe: async (query, p = []) => {
      if (query.startsWith('SET LOCAL')) return [];
      if (query.includes('INSERT INTO')) {
        if (row && row.process_incarnation_id !== p[2] && Date.parse(row.expires_at) > now) return [];
        if (!row) row = { owner_id:p[0],run_id:p[1],process_incarnation_id:p[2],
          lease_generation:1,event_seq:0, pending_wake_id:null,pending_wake_status:null,
          pending_wake_epoch:null,pending_wake_cycle:null, pending_wake_process_incarnation_id:null,
          pending_wake_lease_generation:null,last_receipt_sha256:null };
        else if (row.process_incarnation_id !== p[2]) {
          row.process_incarnation_id=p[2]; row.lease_generation+=1;
        }
        row.expires_at=new Date(now+p[3]).toISOString();
        return [structuredClone(row)];
      }
      if (!row || row.owner_id !== p[0] || row.run_id !== p[1] ||
        row.process_incarnation_id !== p[2] || row.lease_generation !== p[3] ||
        Date.parse(row.expires_at) <= now) return [];
      if (query.includes('expires_at = clock_timestamp() +')) {
        row.expires_at=new Date(now+p[4]).toISOString();
      } else if (query.includes("pending_wake_status='PREPARED'")) {
        if (row.pending_wake_id != null) return [];
        row.pending_wake_id=p[4]; row.pending_wake_status='PREPARED';
        row.pending_wake_epoch=p[5]; row.pending_wake_cycle=p[6];
        row.pending_wake_process_incarnation_id=p[2]; row.pending_wake_lease_generation=p[3];
        row.event_seq+=1;
      } else if (query.includes("SET\n          pending_wake_status='AMBIGUOUS'")) {
        if (row.pending_wake_id!==p[4] || !['PREPARED','AMBIGUOUS'].includes(row.pending_wake_status)) return [];
        row.pending_wake_status='AMBIGUOUS'; row.event_seq+=1;
      } else if (query.includes('pending_wake_status=$6')) {
        if (row.pending_wake_id!==p[4] || row.pending_wake_status!=='AMBIGUOUS' || row.event_seq>=p[7]) return [];
        row.pending_wake_status=p[5]; row.last_receipt_sha256=p[6]; row.event_seq=p[7];
      } else if (query.includes('pending_wake_id=NULL')) {
        if (row.pending_wake_id!==p[4] || row.last_receipt_sha256!==p[5]
          || !['CONFIRMED_SENT','PROVEN_NOT_SENT'].includes(row.pending_wake_status)) return [];
        row.pending_wake_id=null; row.pending_wake_status=null;
        row.pending_wake_epoch=null; row.pending_wake_cycle=null;
        row.pending_wake_process_incarnation_id=null; row.pending_wake_lease_generation=null;
        row.event_seq+=1;
      } else throw Error('unexpected_sql');
      return [structuredClone(row)];
    } });
  } };
  const make = (processIncarnationId, runId='run_one', verifyNativeReceipt=async receipt=>receipt.receipt_sha256===receiptHash) =>
    createOwnPostgresSupervisorContinuityLease({
      sql, ownerId:'owner_one', runId, processIncarnationId, clock:()=>now, ttlMs:30000, verifyNativeReceipt,
    });
  return { make, advance: ms=>{now+=ms}, offline: v=>{fail=v}, row:()=>structuredClone(row) };
}

test('boot lease is CAS-fenced across two processes without a second executor', async () => {
  const db=database(); const a=db.make('process_a'), b=db.make('process_b');
  const first=await a.acquireBoot();
  assert.equal(first.lease_generation,1);
  assert.equal(first.source,'OWN_POSTGRES');
  assert.equal(first.authority_effect,false);
  assert.equal(await b.acquireBoot(),null);
  db.advance(30_001);
  assert.equal((await b.acquireBoot()).lease_generation,2);
  await assert.rejects(()=>a.renew(), /continuity_boot_lease_not_held/);
});

test('old in-flight wake remains opaque and blocks successor after restart', async () => {
  const db=database(), a=db.make('process_a'), b=db.make('process_b');
  await a.acquireBoot();
  const reserved=await a.reserveWake({wake_id:wakeA, supervisor_epoch:4, cycle_seq:19});
  assert.equal(reserved.event_seq,1);
  assert.equal(await a.reserveWake({wake_id:wakeA, supervisor_epoch:4, cycle_seq:19}),null);
  await a.markAmbiguous(wakeA);
  db.advance(30_001);
  const successor=await b.acquireBoot();
  assert.equal(successor.lease_generation,2);
  assert.equal(successor.reconciliation_required,true);
  assert.equal(successor.pending_wake_id,wakeA);
  assert.equal(await b.reserveWake({wake_id:wakeB, supervisor_epoch:4, cycle_seq:20}),null);
});

test('only exact durable native receipt can reconcile predecessor wake', async () => {
  const db=database(), a=db.make('process_a'), b=db.make('process_b');
  await a.acquireBoot();
  await a.reserveWake({wake_id:wakeA, supervisor_epoch:4, cycle_seq:19});
  await a.markAmbiguous(wakeA);
  db.advance(30_001);
  const lease=await b.acquireBoot();
  const candidate={
    source:'NATIVE_EXECUTOR_RECEIPT', owner_id:'owner_one',run_id:'run_one',
    process_incarnation_id:'process_a',wake_id:wakeA,lease_generation:1,
    supervisor_epoch:4,cycle_seq:19,event_seq:lease.event_seq+1,
    receipt_sha256:receiptHash,trusted_native_readback:true,effect_state:'SENT',
  };
  assert.equal(qualifySupervisorWakeReceipt({...candidate,source:'PAGE_DOM'},lease).state,'UNRESOLVED');
  assert.equal(qualifySupervisorWakeReceipt({...candidate,lease_generation:99},lease).state,'UNRESOLVED');
  assert.equal(qualifySupervisorWakeReceipt({...candidate,event_seq:0},lease).state,'UNRESOLVED');
  assert.equal((await b.reconcile({...candidate,source:'PAGE_DOM'})).state,'UNRESOLVED');
  assert.equal((await b.reconcile(candidate)).state,'CONFIRMED_SENT');
  assert.equal(await b.reserveWake({wake_id:wakeB,supervisor_epoch:4,cycle_seq:20}),null);
  assert.ok(await b.settleWake({wake_id:wakeA,receipt_sha256:receiptHash}));
  assert.equal((await b.reserveWake({wake_id:wakeB,supervisor_epoch:4,cycle_seq:20})).pending_wake_id,wakeB);
});

test('reconciliation accepts proven not-sent but never sets automatic retry', async () => {
  const db=database(), a=db.make('process_a');
  await a.acquireBoot();
  await a.reserveWake({wake_id:wakeA,supervisor_epoch:2,cycle_seq:7});
  await a.markAmbiguous(wakeA);
  const lease=a.snapshot();
  const receipt={source:'NATIVE_EXECUTOR_RECEIPT',owner_id:'owner_one',run_id:'run_one',
    process_incarnation_id:'process_a',wake_id:wakeA,lease_generation:1,supervisor_epoch:2,
    cycle_seq:7,event_seq:lease.event_seq+1,receipt_sha256:receiptHash,
    trusted_native_readback:true,effect_state:'NOT_SENT'};
  const proof=await a.reconcile(receipt);
  assert.equal(proof.state,'PROVEN_NOT_SENT');
  assert.equal(proof.automatic_retry_allowed,false);
});

test('PG errors and missing proof fail closed without remote fallback', async () => {
  const db=database(); const a=db.make('process_a');
  db.offline(true);
  await assert.rejects(()=>a.acquireBoot(),/postgres_unavailable/);
  await assert.rejects(()=>a.renew(),/continuity_boot_lease_not_held/);
  db.offline(false);await a.acquireBoot();
  await assert.rejects(()=>a.settleWake({wake_id:wakeA,receipt_sha256:receiptHash}),/settlement_proof_required/);
  assert.equal((await a.reserveWake({wake_id:wakeA,supervisor_epoch:1,cycle_seq:1})).pending_wake_status,'PREPARED');
  assert.equal((await a.reconcile({effect_state:'NOT_SENT'})).state,'UNRESOLVED');
  assert.equal(db.row().pending_wake_status,'PREPARED');
});

test('rejects invalid callers and refuses wake without a boot lease', async () => {
  const db=database();
  assert.throws(()=>db.make('bad process'),/incarnation_invalid/);
  const a=db.make('process_a');
  await assert.rejects(()=>a.reserveWake({wake_id:wakeA,supervisor_epoch:1,cycle_seq:1}),/not_held/);
  await a.acquireBoot();
  await assert.rejects(()=>a.reserveWake({wake_id:'invalid',supervisor_epoch:1,cycle_seq:1}),/binding_invalid/);
});

test('existing supervisor executor has no actuation when PostgreSQL boot lease is contested', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SupervisorLifecycleRuntime } = await import('../src/supervisor-lifecycle-runtime-core.mjs');
  const root = await mkdtemp(join(tmpdir(),'w4-continuity-fence-'));
  let effects=0, observations=0;
  const fenced = {
    acquireBoot: async()=>null, renew: async()=>null,
    reserveWake: async()=>{throw Error('should not reserve');},
    markAmbiguous: async()=>null, reconcile: async()=>null,
    settleWake: async()=>null, snapshot:()=>null,
  };
  try {
    const runtime=new SupervisorLifecycleRuntime({
      statePath:join(root,'keepalive.json'),continuityLease:fenced,
      getState:async()=>{observations++;return {tabs:[],fleet:{agents:[]}};},
      executeCommand:async()=>{effects++;throw Error('unauthorized_effect');},
    });
    const snapshot=await runtime.start();
    assert.equal(snapshot.continuity_lease.enabled,true);
    assert.equal(snapshot.continuity_lease.ready,false);
    assert.equal(snapshot.actuation_enabled,false);
    assert.equal(snapshot.continuity_lease.reason,'LEASE_LOST_OR_WAKE_RECONCILIATION_REQUIRED');
    assert.equal(effects,0);
    assert.equal(observations,0);
    await runtime.cycle({force:true});
    assert.equal(effects,0);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('forged receipt flags without an independent Owner/native verifier never resolve ambiguity', async () => {
  const db=database();
  const lease=db.make('process_a','run_one',null);
  await lease.acquireBoot();
  await lease.reserveWake({wake_id:wakeA,supervisor_epoch:5,cycle_seq:3});
  await lease.markAmbiguous(wakeA);
  const stored=lease.snapshot();
  const forged={
    source:'NATIVE_EXECUTOR_RECEIPT',owner_id:'owner_one',run_id:'run_one',
    process_incarnation_id:'process_a',wake_id:wakeA,lease_generation:1,
    supervisor_epoch:5,cycle_seq:3,event_seq:stored.event_seq+1,
    receipt_sha256:receiptHash,trusted_native_readback:true,effect_state:'NOT_SENT',
  };
  assert.equal(qualifySupervisorWakeReceipt(forged,stored).state,'PROVEN_NOT_SENT');
  assert.equal((await lease.reconcile(forged)).state,'UNRESOLVED');
  assert.equal(lease.snapshot().pending_wake_status,'AMBIGUOUS');
  assert.equal(lease.snapshot().automatic_retry_allowed,false);
});
