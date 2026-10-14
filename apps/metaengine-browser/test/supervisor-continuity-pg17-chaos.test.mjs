// W4 independent adversarial tests: a SERIALIZED, transactional, own-PG model.
// Deliberately not a physical PostgreSQL 17 qualification. No live connection,
// external service, migration, Browser, Guardian, second executor or scheduler.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOwnPostgresSupervisorContinuityLease,
  qualifySupervisorWakeReceipt,
} from '../src/supervisor-continuity-lease.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';

const WAKE_A = 'wake_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WAKE_B = 'wake_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DIGEST = 'b'.repeat(64);
const T0 = Date.parse('2026-10-14T00:00:00Z');
const TTL = 5_000;

// Independent model: serialize whole transactions, commit before optionally
// dropping ACKs, and preserve SQL operation-specific WHERE/CAS predicates.
// It is NOT a mocked "success" response to every UPDATE.
function serialOwnPgModel() {
  let now = T0;
  let rows = new Map();
  let tail = Promise.resolve();
  let unavailable = false;
  let lostAckFor = null;
  const events = [];
  const operation = q => q.includes('INSERT INTO public.metaengine_supervisor_continuity_lease_v1') ? 'boot'
    : q.includes('expires_at = clock_timestamp() +') ? 'renew'
    : q.includes("pending_wake_status='PREPARED'") ? 'reserve'
    : q.includes('pending_wake_status=$6') ? 'reconcile'
    : q.includes("pending_wake_status='AMBIGUOUS'") ? 'ambiguous'
    : q.includes('pending_wake_id=NULL') ? 'settle' : null;
  const sql = {
    async begin(work) {
      const prior = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await prior;
      let op = null;
      let didWrite = false;
      try {
        if (unavailable) throw new Error('own_postgres_unavailable');
        const txnRows = structuredClone(rows);
        const tx = {
          async unsafe(query, args = []) {
            if (query.startsWith('SET LOCAL')) return [];
            op = operation(query);
            if (!op) throw new Error('unknown_sql_operation');
            const key = args[0] + '/' + args[1];
            let row = txnRows.get(key);
            if (op === 'boot') {
              if (row && row.process_incarnation_id !== args[2] && Date.parse(row.expires_at) > now) return [];
              if (!row) {
                row = {
                  owner_id: args[0], run_id: args[1], process_incarnation_id: args[2],
                  lease_generation: 1, expires_at: null, event_seq: 0,
                  pending_wake_id: null, pending_wake_status: null,
                  pending_wake_epoch: null, pending_wake_cycle: null,
                  pending_wake_process_incarnation_id: null,
                  pending_wake_lease_generation: null, last_receipt_sha256: null,
                };
              } else if (row.process_incarnation_id !== args[2]) {
                row.process_incarnation_id = args[2];
                row.lease_generation++;
                if (row.pending_wake_id !== null) row.pending_wake_status = 'AMBIGUOUS';
              }
              row.expires_at = new Date(now + args[3]).toISOString();
            } else {
              // The SQL predicates are checked against the committed row.
              if (!row || row.process_incarnation_id !== args[2]
                || row.lease_generation !== args[3] || Date.parse(row.expires_at) <= now) return [];
              switch (op) {
                case 'renew':
                  row.expires_at = new Date(now + args[4]).toISOString();
                  break;
                case 'reserve':
                  if (row.pending_wake_id !== null) return [];
                  row.pending_wake_id = args[4];
                  row.pending_wake_status = 'PREPARED';
                  row.pending_wake_epoch = args[5];
                  row.pending_wake_cycle = args[6];
                  row.pending_wake_process_incarnation_id = args[2];
                  row.pending_wake_lease_generation = args[3];
                  row.event_seq++;
                  break;
                case 'ambiguous':
                  if (row.pending_wake_id !== args[4] || !['PREPARED', 'AMBIGUOUS'].includes(row.pending_wake_status)) return [];
                  row.pending_wake_status = 'AMBIGUOUS';
                  row.event_seq++;
                  break;
                case 'reconcile':
                  if (row.pending_wake_id !== args[4] || row.pending_wake_status !== 'AMBIGUOUS'
                    || row.event_seq >= args[7]) return [];
                  row.pending_wake_status = args[5];
                  row.last_receipt_sha256 = args[6];
                  row.event_seq = args[7];
                  break;
                case 'settle':
                  if (row.pending_wake_id !== args[4] || row.last_receipt_sha256 !== args[5]
                    || !['CONFIRMED_SENT', 'PROVEN_NOT_SENT'].includes(row.pending_wake_status)) return [];
                  row.pending_wake_id = null;
                  row.pending_wake_status = null;
                  row.pending_wake_epoch = null;
                  row.pending_wake_cycle = null;
                  row.pending_wake_process_incarnation_id = null;
                  row.pending_wake_lease_generation = null;
                  row.event_seq++;
                  break;
                default: throw new Error('unmodelled_sql');
              }
            }
            txnRows.set(key, row);
            didWrite = true;
            return [structuredClone(row)];
          },
        };
        const result = await work(tx);
        rows = txnRows; // committed durability, even if caller never receives ACK
        events.push({ op, didWrite });
        if (didWrite && lostAckFor === op) {
          lostAckFor = null;
          throw new Error('ack_lost_after_commit_' + op);
        }
        return result;
      } finally {
        unlock();
      }
    },
  };
  const make = (processIncarnationId, options = {}) => createOwnPostgresSupervisorContinuityLease({
    sql,
    ownerId: options.ownerId || 'owner_A',
    runId: options.runId || 'run_A',
    processIncarnationId,
    ttlMs: TTL,
    clock: () => now,
    verifyNativeReceipt: options.verifyNativeReceipt === undefined ? async () => true : options.verifyNativeReceipt,
  });
  const row = (ownerId = 'owner_A', runId = 'run_A') => structuredClone(rows.get(ownerId + '/' + runId) || null);
  return {
    make, row, events,
    advance(ms) { now += ms; },
    setOffline(value) { unavailable = value; },
    dropCommittedAck(op) { lostAckFor = op; },
  };
}

function receipt(lease, overrides = {}) {
  return {
    source: 'NATIVE_EXECUTOR_RECEIPT',
    owner_id: lease.owner_id,
    run_id: lease.run_id,
    process_incarnation_id: lease.pending_wake_process_incarnation_id,
    wake_id: lease.pending_wake_id,
    lease_generation: lease.pending_wake_lease_generation,
    supervisor_epoch: lease.pending_wake_epoch,
    cycle_seq: lease.pending_wake_cycle,
    event_seq: lease.event_seq + 1,
    receipt_sha256: DIGEST,
    effect_state: 'SENT',
    trusted_native_readback: true,
    ...overrides,
  };
}

async function prepare(model, epoch = 3, cycle = 7) {
  const old = model.make('incarnation_old');
  assert.equal((await old.acquireBoot()).lease_generation, 1);
  assert.equal((await old.reserveWake({
    wake_id: WAKE_A, supervisor_epoch: epoch, cycle_seq: cycle,
  })).pending_wake_status, 'PREPARED');
  return old;
}

test('supervisor-continuity-pg17-chaos: concurrent boots permit one CAS winner and no second owner', async () => {
  const pg = serialOwnPgModel();
  const agents = Array.from({ length: 12 }, (_, i) => pg.make('incarnation_' + i));
  const boots = await Promise.all(agents.map(a => a.acquireBoot()));
  assert.equal(boots.filter(Boolean).length, 1);
  assert.equal(pg.row().lease_generation, 1);
  assert.equal(boots.filter(Boolean)[0].process_incarnation_id, pg.row().process_incarnation_id);
  for (const [i, state] of boots.entries()) {
    if (!state) await assert.rejects(agents[i].reserveWake({ wake_id: WAKE_B, supervisor_epoch: 1, cycle_seq: 1 }), /not_held/);
  }
});

test('supervisor-continuity-pg17-chaos: expired PREPARED predecessor becomes AMBIGUOUS; successor cannot send', async () => {
  const pg = serialOwnPgModel();
  const old = await prepare(pg);
  pg.advance(TTL + 1);
  const next = pg.make('incarnation_next');
  const boot = await next.acquireBoot();
  assert.equal(boot.lease_generation, 2);
  assert.equal(boot.pending_wake_status, 'AMBIGUOUS');
  assert.equal(boot.pending_wake_process_incarnation_id, 'incarnation_old');
  assert.equal(boot.pending_wake_lease_generation, 1);
  assert.equal(boot.event_seq, 1);
  assert.equal(boot.reconciliation_required, true);
  assert.equal(await next.reserveWake({ wake_id: WAKE_B, supervisor_epoch: 4, cycle_seq: 1 }), null);
  await assert.rejects(old.renew(), /not_held/);
});

test('supervisor-continuity-pg17-chaos: ACK lost after committed reserve still blocks all recovery sends', async () => {
  const pg = serialOwnPgModel();
  const old = pg.make('incarnation_old');
  await old.acquireBoot();
  pg.dropCommittedAck('reserve');
  await assert.rejects(old.reserveWake({ wake_id: WAKE_A, supervisor_epoch: 2, cycle_seq: 9 }), /ack_lost_after_commit_reserve/);
  assert.equal(pg.row().pending_wake_status, 'PREPARED');
  pg.advance(TTL + 1);
  const rivals = Array.from({ length: 6 }, (_, i) => pg.make('replacement_' + i));
  const results = await Promise.all(rivals.map(r => r.acquireBoot()));
  assert.equal(results.filter(Boolean).length, 1);
  const winner = rivals[results.findIndex(Boolean)];
  assert.equal(winner.snapshot().pending_wake_status, 'AMBIGUOUS');
  assert.equal(await winner.reserveWake({ wake_id: WAKE_B, supervisor_epoch: 3, cycle_seq: 1 }), null);
  assert.equal(pg.row().pending_wake_id, WAKE_A);
  assert.equal(pg.events.filter(e => e.op === 'reserve' && e.didWrite).length, 1);
});

test('supervisor-continuity-pg17-chaos: epoch rollover, wrong run, wrong process and stale cursor fail closed', async () => {
  const pg = serialOwnPgModel();
  const old = await prepare(pg, 42, 103);
  await old.markAmbiguous(WAKE_A);
  pg.advance(TTL + 1);
  const next = pg.make('incarnation_next');
  await next.acquireBoot();
  const exact = receipt(next.snapshot());
  for (const change of [
    { supervisor_epoch: 43 }, { cycle_seq: 104 }, { run_id: 'run_B' },
    { owner_id: 'owner_B' }, { process_incarnation_id: 'incarnation_next' },
    { lease_generation: 2 }, { event_seq: next.snapshot().event_seq },
    { source: 'PAGE_DOM' }, { trusted_native_readback: false },
    { receipt_sha256: 'not_a_digest' },
  ]) {
    const bad = { ...exact, ...change };
    assert.equal(qualifySupervisorWakeReceipt(bad, next.snapshot()).state, 'UNRESOLVED');
    assert.equal((await next.reconcile(bad)).state, 'UNRESOLVED');
  }
  assert.equal(pg.row().pending_wake_status, 'AMBIGUOUS');
});

test('supervisor-continuity-pg17-chaos: forged native flags, failed verifier and no verifier preserve ambiguity', async () => {
  const pg = serialOwnPgModel();
  await prepare(pg, 6, 11);
  pg.advance(TTL + 1);
  let verifierCalls = 0;
  const verifyFalse = pg.make('incarnation_new', {
    verifyNativeReceipt: async () => { verifierCalls++; return false; },
  });
  await verifyFalse.acquireBoot();
  const exact = receipt(verifyFalse.snapshot(), { effect_state: 'NOT_SENT' });
  assert.equal((await verifyFalse.reconcile(exact)).state, 'UNRESOLVED');
  assert.equal(verifierCalls, 1);
  assert.equal(pg.row().pending_wake_status, 'AMBIGUOUS');
  const noVerifier = pg.make('incarnation_new', { verifyNativeReceipt: null });
  await noVerifier.acquireBoot();
  assert.equal((await noVerifier.reconcile(exact)).state, 'UNRESOLVED');
  assert.equal(pg.row().pending_wake_status, 'AMBIGUOUS');
});

test('supervisor-continuity-pg17-chaos: receipt ACK loss cannot authorize replay, replacement or duplicate effect', async () => {
  const pg = serialOwnPgModel();
  const old = await prepare(pg, 3, 5);
  await old.markAmbiguous(WAKE_A);
  pg.advance(TTL + 1);
  const next = pg.make('incarnation_next');
  await next.acquireBoot();
  const exact = receipt(next.snapshot());
  assert.equal(qualifySupervisorWakeReceipt(exact, next.snapshot()).state, 'CONFIRMED_SENT', JSON.stringify({lease:next.snapshot(),exact}));
  pg.dropCommittedAck('reconcile');
  await assert.rejects(next.reconcile(exact), /ack_lost_after_commit_reconcile/);
  assert.equal(pg.row().pending_wake_status, 'CONFIRMED_SENT');
  assert.equal((await next.reconcile(exact)).state, 'UNRESOLVED');
  await assert.rejects(next.reserveWake({ wake_id: WAKE_B, supervisor_epoch: 4, cycle_seq: 6 }), /not_held/);
  assert.equal((await next.acquireBoot()).pending_wake_status, 'CONFIRMED_SENT');
  assert.equal(await next.reserveWake({ wake_id: WAKE_B, supervisor_epoch: 4, cycle_seq: 6 }), null);
  await next.renew();
  assert.equal(pg.row().pending_wake_id, WAKE_A);
  assert.equal(pg.events.filter(e => e.op === 'reconcile' && e.didWrite).length, 1);
});

test('supervisor-continuity-pg17-chaos: independent exact receipt permits one settlement, not automatic retry', async () => {
  const pg = serialOwnPgModel();
  const old = await prepare(pg, 8, 18);
  await old.markAmbiguous(WAKE_A);
  pg.advance(TTL + 1);
  const next = pg.make('incarnation_next');
  await next.acquireBoot();
  const exact = receipt(next.snapshot(), { effect_state: 'NOT_SENT' });
  const outcome = await next.reconcile(exact);
  assert.equal(outcome.state, 'PROVEN_NOT_SENT', JSON.stringify({ row: pg.row(), lease: next.snapshot(), events: pg.events, outcome }));
  await assert.rejects(next.settleWake({ wake_id: WAKE_A, receipt_sha256: 'bad' }), /settlement_proof_required/);
  assert.equal(pg.row().pending_wake_status, 'PROVEN_NOT_SENT');
  const settled = await next.settleWake({ wake_id: WAKE_A, receipt_sha256: DIGEST });
  assert.equal(settled.reconciliation_required, false);
  assert.equal(settled.automatic_retry_allowed, false);
  assert.equal((await next.reserveWake({ wake_id: WAKE_B, supervisor_epoch: 9, cycle_seq: 1 })).pending_wake_id, WAKE_B);
  assert.equal((await next.reconcile(exact)).state, 'UNRESOLVED');
  assert.equal(pg.row().pending_wake_id, WAKE_B);
});

test('supervisor-continuity-pg17-chaos: existing lifecycle executor performs zero effects while another lease owns boot', async () => {
  const pg = serialOwnPgModel();
  const incumbent = pg.make('incarnation_incumbent');
  await incumbent.acquireBoot();
  const root = await mkdtemp(join(tmpdir(), 'supervisor-continuity-pg17-chaos-'));
  let reads = 0;
  let effects = 0;
  const makeExecutor = (processIncarnationId, lease) => new SupervisorLifecycleRuntime({
    statePath: join(root, processIncarnationId + '.json'),
    continuityLease: lease,
    processIncarnationId,
    getState: async () => { reads++; return { tabs: [], fleet: { agents: [] } }; },
    executeCommand: async () => { effects++; throw new Error('FORBIDDEN_EFFECT'); },
  });
  try {
    const rejected = makeExecutor('incarnation_rival', pg.make('incarnation_rival'));
    assert.equal((await rejected.start()).actuation_enabled, false);
    assert.equal(reads, 0);
    assert.equal(effects, 0);
    await rejected.cycle({ force: true });
    assert.equal(reads, 0);
    assert.equal(effects, 0);

    await incumbent.reserveWake({ wake_id: WAKE_A, supervisor_epoch: 1, cycle_seq: 1 });
    pg.advance(TTL + 1);
    const recovery = makeExecutor('incarnation_recovery', pg.make('incarnation_recovery'));
    const started = await recovery.start();
    assert.equal(started.continuity_lease.reconciliation_required, true);
    assert.equal(started.actuation_enabled, false);
    await recovery.cycle({ force: true });
    assert.equal(reads, 0);
    assert.equal(effects, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('supervisor-continuity-pg17-chaos: own-PG schema is CAS-keyed and source is never a live migration', async () => {
  const schemaPath = fileURLToPath(new URL('../../../infra/client-state-runtime/operator-supervisor-continuity-lease-v1.sql', import.meta.url));
  const schema = await readFile(schemaPath, 'utf8');
  assert.match(schema, /PRIMARY KEY \(owner_id, run_id\)/);
  assert.match(schema, /REVOKE ALL ON public\.metaengine_supervisor_continuity_lease_v1 FROM PUBLIC/);
  assert.match(schema, /pending_wake_process_incarnation_id text/);
  assert.match(schema, /pending_wake_lease_generation bigint/);
  assert.doesNotMatch(schema, /\b(?:supabase|https?:\/\/|dblink|postgres_fdw|CREATE EXTENSION)\b/i);
  // Static catalog contract only. No physical PG17 test or implicit connection.
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.metaengine_supervisor_continuity_lease_v1/);
  assert.match(schema, /pending_wake_status IN \('PREPARED','AMBIGUOUS','CONFIRMED_SENT','PROVEN_NOT_SENT'\)/);
});
