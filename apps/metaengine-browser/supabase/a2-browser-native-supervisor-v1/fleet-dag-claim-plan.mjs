// W30: fail-closed claim *proposal* for the existing sole DevOS leased executor.
// Source-only: no timers, database writes, leases, retries, cancellation or effects.
// A role-only lease RPC cannot select an exact task. If even one READY task in
// that role is DAG-blocked, suppress the whole role instead of guessing which
// task PostgreSQL will select. The existing own-PG claim transaction is final.
import { FLEET_DAG_LIMITS, planFleetDagAdmission } from './fleet-coordination-dag.mjs';
import { falsifyFleetDagCancellationProof } from './fleet-dag-cancellation-proof.mjs';

const upper = v => String(v ?? '').toUpperCase();
const taskId = v => String(v ?? '').toLowerCase();

export function planFleetDagClaims({ snapshot, runtimeControl } = {}) {
  const dag = planFleetDagAdmission(snapshot);
  if (dag === null) return null; // preserve the existing untagged lease path
  const proof = falsifyFleetDagCancellationProof({ snapshot, runtimeControl });
  const blocked = { ...dag.blocked };
  const fence = reason => Object.freeze({
    schema: 'metaengine.fleet-dag-claim-plan.v1',
    state: 'FENCED', ready: 0, by_role: Object.freeze({}),
    remaining_slots: 0, blocked: Object.freeze({ ...blocked, '*': reason }),
    proof_state: proof.state, proof_reasons: Object.freeze([...proof.reasons]),
    unsafe_roles: Object.freeze([]),
    lease_authority: 'EXISTING_DEVOS_FLEET_LEASE_V1',
    scheduler_authority: false, authority_effect: false,
    automatic_retry_allowed: false, second_scheduler_loop: false,
  });
  // Proof is independent and never grants authority. Absence/contradiction
  // of the owner runtime, claim generations, budget or slot-return receipts
  // forbids an optimistic role-only lease.
  if (proof.state !== 'CONSISTENT_NOT_AUTHORITY')
    return fence('OWNER_CLAIM_OR_STOP_READBACK_UNKNOWN');
  if (dag.state === 'FENCED') return fence('DAG_INVALID');
  const remaining = Math.min(dag.remaining_slots,
    Math.max(0, FLEET_DAG_LIMITS.global - proof.active_slots));
  if (!Number.isSafeInteger(remaining) || remaining < 0)
    return fence('CAPACITY_READBACK_UNKNOWN');

  const roles = { ...dag.by_role };
  const unsafeRoles = new Set();
  for (const task of snapshot.active_tasks) {
    if (upper(task?.state) !== 'READY') continue;
    if (Object.hasOwn(blocked, taskId(task?.task_id)))
      unsafeRoles.add(upper(task?.role));
  }
  // The existing lease RPC accepts only a role, not a chosen task_id.
  // It would be unsound to send it for a role containing a blocked task
  // (even if another task of that role is ready).
  for (const role of unsafeRoles) {
    if (Object.hasOwn(roles, role)) {
      delete roles[role];
      blocked['role:' + role] = 'ROLE_ONLY_TASK_SELECTION_UNVERIFIED';
    }
  }
  const ready = Object.values(roles).reduce((sum, value) =>
    sum + (Number.isSafeInteger(value) && value >= 0 ? value : FLEET_DAG_LIMITS.tasks + 1), 0);
  if (ready > remaining || ready > FLEET_DAG_LIMITS.global ||
      Object.entries(roles).some(([role, count]) =>
        !Object.hasOwn(FLEET_DAG_LIMITS.roles, role) ||
        count > FLEET_DAG_LIMITS.roles[role] - (proof.budget?.roles?.[role] ?? 0)))
    return fence('BOUNDED_ROLE_OR_GLOBAL_CAPACITY_UNKNOWN');
  return Object.freeze({
    schema: 'metaengine.fleet-dag-claim-plan.v1',
    state: unsafeRoles.size || dag.state !== 'OPEN' ? 'DEGRADED' : 'OPEN',
    ready, by_role: Object.freeze(roles), blocked: Object.freeze(blocked),
    remaining_slots: remaining, proof_state: proof.state,
    proof_reasons: Object.freeze([...proof.reasons]),
    unsafe_roles: Object.freeze([...unsafeRoles].sort()),
    lease_authority: 'EXISTING_DEVOS_FLEET_LEASE_V1',
    scheduler_authority: false, authority_effect: false,
    automatic_retry_allowed: false, second_scheduler_loop: false,
  });
}
