// W4/P2: durable lease readback on the EXISTING supervisor executor.
// This is not a scheduler, task queue or permission to replay ambiguous sends.
// The caller supplies an authenticated connection to METAENGINE-owned PostgreSQL.
export const SUPERVISOR_CONTINUITY_SCHEMA = 'metaengine.supervisor-continuity-lease.v1';
const IDENTIFIER = /^[A-Za-z0-9:_-]{1,160}$/;
const WAKE = /^wake_[a-z0-9-]{8,100}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PROJECTION = 'owner_id, run_id, process_incarnation_id, lease_generation, expires_at, pending_wake_id, pending_wake_status, pending_wake_epoch, pending_wake_cycle, pending_wake_process_incarnation_id, pending_wake_lease_generation, event_seq, last_receipt_sha256';

function binding(value, label) {
  if (!IDENTIFIER.test(String(value || ''))) throw new Error('continuity_' + label + '_invalid');
  return String(value);
}
function validNumber(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
function safeRow(row, expected, nowMs) {
  if (!row || row.owner_id !== expected.ownerId || row.run_id !== expected.runId
    || row.process_incarnation_id !== expected.processIncarnationId
    || !validNumber(Number(row.lease_generation), 1) || !validNumber(Number(row.event_seq))
    || !Number.isFinite(Date.parse(row.expires_at))
    || Date.parse(row.expires_at) <= nowMs) return null;
  if (row.pending_wake_id && (!WAKE.test(row.pending_wake_id)
    || !['PREPARED','AMBIGUOUS','CONFIRMED_SENT','PROVEN_NOT_SENT'].includes(row.pending_wake_status)
    || !validNumber(Number(row.pending_wake_epoch), 1)
    || !validNumber(Number(row.pending_wake_cycle), 1)
    || !IDENTIFIER.test(String(row.pending_wake_process_incarnation_id || ''))
    || !validNumber(Number(row.pending_wake_lease_generation), 1))) return null;
  return Object.freeze({
    schema: SUPERVISOR_CONTINUITY_SCHEMA,
    source: 'OWN_POSTGRES',
    owner_id: expected.ownerId, run_id: expected.runId,
    process_incarnation_id: expected.processIncarnationId,
    lease_generation: Number(row.lease_generation), event_seq: Number(row.event_seq),
    expires_at: new Date(row.expires_at).toISOString(),
    pending_wake_id: row.pending_wake_id || null,
    pending_wake_status: row.pending_wake_status || null,
    pending_wake_epoch: row.pending_wake_epoch == null ? null : Number(row.pending_wake_epoch),
    pending_wake_cycle: row.pending_wake_cycle == null ? null : Number(row.pending_wake_cycle),
    pending_wake_process_incarnation_id: row.pending_wake_process_incarnation_id || null,
    pending_wake_lease_generation: row.pending_wake_lease_generation == null ? null : Number(row.pending_wake_lease_generation),
    pending_wake_process_incarnation_id: row.pending_wake_process_incarnation_id || null,
    pending_wake_lease_generation: row.pending_wake_lease_generation == null ? null : Number(row.pending_wake_lease_generation),
    pending_wake_process_incarnation_id: row.pending_wake_process_incarnation_id || null,
    pending_wake_lease_generation: row.pending_wake_lease_generation == null ? null : Number(row.pending_wake_lease_generation),
    pending_wake_process_incarnation_id: row.pending_wake_process_incarnation_id || null,
    pending_wake_lease_generation: row.pending_wake_lease_generation == null ? null : Number(row.pending_wake_lease_generation),
    reconciliation_required: Boolean(row.pending_wake_id),
    authority_effect: false, automatic_retry_allowed: false,
  });
}

// Never infer that an ambiguous page Send was absent from timeout, DOM content,
// process restart, expired lease, or a model claim. Only a durable, exact native
// executor receipt with the same lease generation can close it.
export function qualifySupervisorWakeReceipt(receipt, lease) {
  if (!lease || lease.schema !== SUPERVISOR_CONTINUITY_SCHEMA
    || receipt?.source !== 'NATIVE_EXECUTOR_RECEIPT'
    || receipt?.owner_id !== lease.owner_id || receipt?.run_id !== lease.run_id
    || receipt?.process_incarnation_id !== lease.pending_wake_process_incarnation_id
    || receipt?.wake_id !== lease.pending_wake_id
    || receipt?.lease_generation !== lease.pending_wake_lease_generation
    || receipt?.supervisor_epoch !== lease.pending_wake_epoch
    || receipt?.cycle_seq !== lease.pending_wake_cycle
    || !validNumber(receipt?.event_seq, lease.event_seq + 1)
    || !SHA256.test(String(receipt?.receipt_sha256 || ''))
    || receipt?.trusted_native_readback !== true
    || !['SENT','NOT_SENT'].includes(receipt?.effect_state)) {
    return Object.freeze({ state: 'UNRESOLVED', automatic_retry_allowed: false, authority_effect: false });
  }
  return Object.freeze({
    state: receipt.effect_state === 'SENT' ? 'CONFIRMED_SENT' : 'PROVEN_NOT_SENT',
    receipt_sha256: receipt.receipt_sha256, event_seq: receipt.event_seq,
    automatic_retry_allowed: false, authority_effect: false,
  });
}

export function createOwnPostgresSupervisorContinuityLease({
  sql, ownerId, runId, processIncarnationId, ttlMs = 30_000, clock = () => Date.now(), verifyNativeReceipt = null,
} = {}) {
  if (typeof sql?.begin !== 'function') throw new Error('continuity_own_postgres_transaction_required');
  if (verifyNativeReceipt !== null && typeof verifyNativeReceipt !== 'function') throw new Error('continuity_native_receipt_verifier_invalid');
  const expected = Object.freeze({
    ownerId: binding(ownerId, 'owner'), runId: binding(runId, 'run'),
    processIncarnationId: binding(processIncarnationId, 'process_incarnation'),
  });
  if (!validNumber(ttlMs, 5_000) || ttlMs > 120_000) throw new Error('continuity_lease_ttl_invalid');
  let lease = null;
  async function transaction(work) {
    return sql.begin(async tx => {
      await tx.unsafe("SET LOCAL statement_timeout = '3s'");
      await tx.unsafe("SET LOCAL lock_timeout = '1s'");
      return work(tx);
    });
  }
  function accept(rows) {
    const next = Array.isArray(rows) && rows.length === 1 ? safeRow(rows[0], expected, clock()) : null;
    lease = next;
    return next;
  }
  function held() {
    if (!lease || Date.parse(lease.expires_at) <= clock()) throw new Error('continuity_boot_lease_not_held');
    return lease;
  }
  return Object.freeze({
    snapshot: () => lease,
    // Atomic CAS: a different live incarnation owns the row until expiry.
    // Expiry can transfer the boot lease, but NEVER clears a pending wake.
    async acquireBoot() {
      const rows = await transaction(tx => tx.unsafe(`
        INSERT INTO public.metaengine_supervisor_continuity_lease_v1 AS prior
          (owner_id, run_id, process_incarnation_id, lease_generation, expires_at, event_seq)
        VALUES ($1,$2,$3,1,clock_timestamp() + ($4::integer * interval '1 millisecond'),0)
        ON CONFLICT (owner_id, run_id) DO UPDATE SET
          process_incarnation_id = EXCLUDED.process_incarnation_id,
          lease_generation = CASE WHEN prior.process_incarnation_id = EXCLUDED.process_incarnation_id
            THEN prior.lease_generation ELSE prior.lease_generation + 1 END,
          pending_wake_status = CASE WHEN prior.process_incarnation_id <> EXCLUDED.process_incarnation_id
            AND prior.pending_wake_id IS NOT NULL THEN 'AMBIGUOUS' ELSE prior.pending_wake_status END,
          expires_at = EXCLUDED.expires_at
        WHERE prior.process_incarnation_id = EXCLUDED.process_incarnation_id
          OR prior.expires_at <= clock_timestamp()
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, ttlMs]));
      return accept(rows);
    },
    async renew() {
      const current = held();
      const rows = await transaction(tx => tx.unsafe(`
        UPDATE public.metaengine_supervisor_continuity_lease_v1 SET
          expires_at = clock_timestamp() + ($5::integer * interval '1 millisecond')
        WHERE owner_id=$1 AND run_id=$2 AND process_incarnation_id=$3
          AND lease_generation=$4 AND expires_at > clock_timestamp()
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, current.lease_generation, ttlMs]));
      return accept(rows);
    },
    async reserveWake({ wake_id, supervisor_epoch, cycle_seq } = {}) {
      const current = held();
      if (!WAKE.test(String(wake_id || '')) || !validNumber(supervisor_epoch, 1)
        || !validNumber(cycle_seq, 1)) throw new Error('continuity_wake_binding_invalid');
      // An already pending wake (even from a predecessor incarnation) blocks
      // every new reservation until independently reconciled.
      if (current.pending_wake_id) return null;
      const rows = await transaction(tx => tx.unsafe(`
        UPDATE public.metaengine_supervisor_continuity_lease_v1 SET
          pending_wake_id=$5, pending_wake_status='PREPARED',
          pending_wake_epoch=$6, pending_wake_cycle=$7,
          pending_wake_process_incarnation_id=$3, pending_wake_lease_generation=$4, event_seq=event_seq+1
        WHERE owner_id=$1 AND run_id=$2 AND process_incarnation_id=$3
          AND lease_generation=$4 AND expires_at > clock_timestamp()
          AND pending_wake_id IS NULL
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, current.lease_generation,
        wake_id, supervisor_epoch, cycle_seq]));
      return accept(rows);
    },
    async markAmbiguous(wakeId) {
      const current = held();
      if (current.pending_wake_id !== wakeId) throw new Error('continuity_wake_binding_mismatch');
      const rows = await transaction(tx => tx.unsafe(`
        UPDATE public.metaengine_supervisor_continuity_lease_v1 SET
          pending_wake_status='AMBIGUOUS', event_seq=event_seq+1
        WHERE owner_id=$1 AND run_id=$2 AND process_incarnation_id=$3
          AND lease_generation=$4 AND pending_wake_id=$5
          AND pending_wake_status IN ('PREPARED','AMBIGUOUS')
          AND expires_at > clock_timestamp()
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, current.lease_generation, wakeId]));
      return accept(rows);
    },
    // No page or model content can resolve the ambiguity. Caller provides an
    // independently trusted native receipt, then must settle local keepalive.
    async reconcile(receipt) {
      const current = held();
      const qualified = qualifySupervisorWakeReceipt(receipt, current);
      if (qualified.state === 'UNRESOLVED' || !verifyNativeReceipt) {
        return { state: 'UNRESOLVED', automatic_retry_allowed: false, authority_effect: false };
      }
      // Source strings and the trusted_native_readback flag are NOT evidence.
      // Only a separately wired Owner/native receipt reader can attest an
      // immutable effect record. No verifier = permanent safe ambiguity.
      let attested = false;
      try { attested = await verifyNativeReceipt(structuredClone(receipt)) === true; } catch {}
      if (!attested) return { state: 'UNRESOLVED', automatic_retry_allowed: false, authority_effect: false };
      const rows = await transaction(tx => tx.unsafe(`
        UPDATE public.metaengine_supervisor_continuity_lease_v1 SET
          pending_wake_status=$6, last_receipt_sha256=$7, event_seq=$8
        WHERE owner_id=$1 AND run_id=$2 AND process_incarnation_id=$3
          AND lease_generation=$4 AND pending_wake_id=$5
          AND pending_wake_status='AMBIGUOUS' AND event_seq < $8
          AND expires_at > clock_timestamp()
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, current.lease_generation,
        receipt.wake_id, qualified.state, qualified.receipt_sha256, qualified.event_seq]));
      const observed = accept(rows);
      if (!observed || observed.pending_wake_status !== qualified.state
        || observed.event_seq !== qualified.event_seq) {
        return { state: 'UNRESOLVED', automatic_retry_allowed: false, authority_effect: false };
      }
      return qualified;
    },
    // Called only after the EXISTING keepalive has durably settled the exact
    // wake according to independently verified receipt. No new Send here.
    async settleWake({ wake_id, receipt_sha256 } = {}) {
      const current = held();
      if (current.pending_wake_id !== wake_id
        || !['CONFIRMED_SENT','PROVEN_NOT_SENT'].includes(current.pending_wake_status)
        || !SHA256.test(String(receipt_sha256 || ''))) {
        throw new Error('continuity_settlement_proof_required');
      }
      const rows = await transaction(tx => tx.unsafe(`
        UPDATE public.metaengine_supervisor_continuity_lease_v1 SET
          pending_wake_id=NULL, pending_wake_status=NULL, pending_wake_epoch=NULL,
          pending_wake_cycle=NULL, pending_wake_process_incarnation_id=NULL,
          pending_wake_lease_generation=NULL, event_seq=event_seq+1
        WHERE owner_id=$1 AND run_id=$2 AND process_incarnation_id=$3
          AND lease_generation=$4 AND pending_wake_id=$5
          AND pending_wake_status IN ('CONFIRMED_SENT','PROVEN_NOT_SENT')
          AND last_receipt_sha256=$6 AND expires_at > clock_timestamp()
        RETURNING ${PROJECTION}`,
      [expected.ownerId, expected.runId, expected.processIncarnationId, current.lease_generation,
        wake_id, receipt_sha256]));
      return accept(rows);
    },
  });
}
