import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const INCARNATION = /^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/;
const fail = reason => { throw new Error(`native_coding_ledger_${reason}`); };
function binding(value) {
  if (!value || !UUID.test(value.workspace_id) || !UUID.test(value.task_id)
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1
      || !/^agent_[a-z0-9-]{8,64}$/.test(value.agent_id || '')
      || !/^codex-cli:[0-9a-f-]{36}$/.test(value.target_id || '')
      || !Number.isSafeInteger(value.agent_generation_epoch) || value.agent_generation_epoch < 1
      || !INCARNATION.test(value.host_incarnation || '') || !HASH.test(value.scope_sha256 || '')) fail('binding_invalid');
  return Object.freeze(Object.fromEntries(['workspace_id','task_id','lease_generation','agent_id','target_id',
    'agent_generation_epoch','host_incarnation','scope_sha256'].map(key => [key,value[key]])));
}
const SAME = ['workspace_id','task_id','lease_generation','agent_id','target_id',
  'agent_generation_epoch','host_incarnation','scope_sha256','reservation_id'];
function rowMatches(row, expected) {
  // PostgreSQL int8 may be returned as text by the private connection.
  return row && SAME.every(key => ['lease_generation','agent_generation_epoch'].includes(key)
    ? Number(row[key]) === expected[key] : row[key] === expected[key])
    && row.automatic_retry_allowed === false && row.authority_effect === false;
}

// A private own-PG transaction capability, not a DSN / renderer-supplied RPC.
// This consumes W30 claims; it never acquires leases or starts another poller.
export class NativeCodingPgLedger {
  #transaction;
  constructor({ transaction } = {}) {
    if (typeof transaction !== 'function') fail('private_transaction_required');
    this.#transaction = transaction;
  }
  async #write(sql,args) {
    try {
      return await this.#transaction(async tx => {
        // A successful write is the barrier before a suspended worker resumes.
        await tx.unsafe('set local synchronous_commit = on');
        const rows = await tx.unsafe(sql,args);
        if (!Array.isArray(rows) || rows.length !== 1) fail('write_readback_invalid');
        return rows[0].value;
      }, { isolation: 'serializable' });
    } catch (cause) {
      // Neither transport errors nor a serialization failure authorize a retry.
      const error = new Error('native_coding_ledger_write_unconfirmed_readback_required', { cause });
      error.effect_outcome = 'UNKNOWN';
      error.automatic_retry_allowed = false;
      throw error;
    }
  }
  async reserve(scope) {
    const b = binding(scope), reservation = randomUUID();
    const value = await this.#write(`select destruktion_meta.native_coding_reserve_v1(
      $1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::bigint,$7::uuid,$8::text,$9::text) as value`,
    [b.workspace_id,b.task_id,b.lease_generation,b.agent_id,b.target_id,b.agent_generation_epoch,
      reservation,b.host_incarnation,b.scope_sha256]);
    if (value?.inserted !== true) {
      // Includes RESERVED left by an earlier process: readback only, no spawn.
      return Object.freeze({ state:'READBACK_ONLY', execution:structuredClone(value?.execution || null),
        automatic_retry_allowed:false, authority_effect:false });
    }
    const expected = {...b,reservation_id:reservation};
    if (value.execution?.state !== 'RESERVED' || !rowMatches(value.execution,expected)) fail('reservation_readback_mismatch');
    return Object.freeze({ state:'RESERVED', scope:Object.freeze(expected), execution:Object.freeze(structuredClone(value.execution)),
      automatic_retry_allowed:false, authority_effect:false });
  }
  async advance(scope,{from,to,evidence_sha256,critic_proof_sha256=null,checkpoint_sha256=null}={}) {
    const b = binding(scope);
    if (!UUID.test(scope.reservation_id || '') || !HASH.test(evidence_sha256 || '')) fail('transition_invalid');
    const transitions = {RESERVED:['ATTEMPTED','AMBIGUOUS'],ATTEMPTED:['RESULT_READY','FAILED','AMBIGUOUS'],RESULT_READY:['CHECKPOINTED']};
    if (!transitions[from]?.includes(to)) fail('transition_invalid');
    if (to === 'CHECKPOINTED' && (!HASH.test(critic_proof_sha256 || '') || !HASH.test(checkpoint_sha256 || ''))) fail('checkpoint_proof_missing');
    const row = await this.#write(`select destruktion_meta.native_coding_advance_v1(
      $1::uuid,$2::bigint,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text) as value`,
    [b.task_id,b.lease_generation,scope.reservation_id,b.scope_sha256,b.host_incarnation,from,to,
      evidence_sha256,critic_proof_sha256,checkpoint_sha256]);
    if (row?.state !== to || !rowMatches(row,{...b,reservation_id:scope.reservation_id})) fail('transition_readback_mismatch');
    return Object.freeze(structuredClone(row));
  }
  async read(scope) {
    const b = binding(scope);
    return this.#transaction(async tx => {
      const rows = await tx.unsafe('select destruktion_meta.native_coding_read_v1($1::uuid,$2::uuid,$3::bigint) as value',
        [b.workspace_id,b.task_id,b.lease_generation]);
      if (!Array.isArray(rows) || rows.length !== 1) fail('readback_invalid');
      return rows[0].value == null ? null : Object.freeze(structuredClone(rows[0].value));
    },{ readOnly:true });
  }
}
