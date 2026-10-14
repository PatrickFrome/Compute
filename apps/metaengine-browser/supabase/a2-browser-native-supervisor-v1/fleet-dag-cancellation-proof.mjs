// W5 wave 2: independent, read-only falsifier of the EXISTING leased executor.
// No mutation, scheduler, cancellation effect, expiry decision, retry, or queue.
// In particular, expiry timestamps supplied by a worker never return slots.
// Only reconciled task AND claim projections from the owner DB can do so.
import { FLEET_DAG_LIMITS, planFleetDagAdmission } from './fleet-coordination-dag.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40 = /^[a-f0-9]{40}$/i;
const ROLE_NAMES = Object.keys(FLEET_DAG_LIMITS.roles);
const RESOURCE_NAMES = Object.keys(FLEET_DAG_LIMITS.resources);
const INFLIGHT = new Set(['LEASED', 'RUNNING']);
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'CANCELED', 'FAILED', 'FENCED', 'AMBIGUOUS', 'BLOCKED']);
const RELEASED = new Set(['EXPIRED', 'COMPLETED', 'FENCED', 'CANCELED', 'CANCELLED', 'RELEASED']);
const upper = value => String(value ?? '').toUpperCase();
const uid = value => String(value ?? '').toLowerCase();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const graph = task => task?.task_spec?.fleet_coordination_v1 ?? task?.fleet_coordination_v1;
const positive = value => Number.isSafeInteger(value) && value > 0;

function exactTask(row) {
  return isObject(row) && UUID.test(row.task_id ?? '') && typeof row.state === 'string'
    && typeof row.role === 'string';
}
function costFor(task) {
  const item = graph(task);
  // Unknown/wrong allocation cannot become a smaller observed footprint.
  if (item === undefined) return { role: upper(task.role), resource: 'BROWSER', slots: 1 };
  if (!isObject(item) || item.version !== 1 || !RESOURCE_NAMES.includes(upper(item.resource))
      || !ROLE_NAMES.includes(upper(item.role)) || upper(item.role) !== upper(task.role)
      || ![1, 2].includes(item.slots)) return null;
  return { role: upper(task.role), resource: upper(item.resource), slots: item.slots };
}
const fixed = (obj) => Object.freeze(obj);

export function falsifyFleetDagCancellationProof({ snapshot, runtimeControl, leaseBatch = [] } = {}) {
  const reasons = new Set();
  const fail = reason => { reasons.add(reason); };
  const result = (state, active, returned, budgets = null) => fixed({
    schema: 'metaengine.fleet-dag-cancellation-proof.v1',
    state, reasons: fixed([...reasons].sort()), active_slots: active,
    returned_slots: returned, budget: budgets,
    // This is an adversarial checker, never an admission or a cancellation API.
    admission_authorized: false, scheduler_authority: false,
    cancellation_effect: false, effect_authority: false, authority_effect: false,
    automatic_retry_allowed: false, second_scheduler_loop: false,
    owner_executor: 'EXISTING_DEVOS_FLEET_LEASE_V1',
  });

  if (!isObject(snapshot) || !Array.isArray(snapshot.active_tasks)
      || !Array.isArray(snapshot.active_claims) || !Array.isArray(leaseBatch)
      || snapshot.authority_effect !== false
      || snapshot.active_tasks.length > FLEET_DAG_LIMITS.tasks
      || snapshot.active_claims.length > FLEET_DAG_LIMITS.tasks
      || leaseBatch.length > FLEET_DAG_LIMITS.global
      || (snapshot.completed_tasks !== undefined &&
          (!Array.isArray(snapshot.completed_tasks) || snapshot.completed_tasks.length > FLEET_DAG_LIMITS.tasks))) {
    fail('SOURCE_SNAPSHOT_UNKNOWN');
    return result('UNKNOWN', null, 0);
  }
  // A stop is a pre-admission fence, not a signal to terminate a worker or
  // to mark a task completed. Missing owner runtime-control evidence is UNKNOWN.
  if (!isObject(runtimeControl) || runtimeControl.authoritative !== true
      || runtimeControl.authority_effect !== false || runtimeControl.continuous_service_allowed !== true
      || runtimeControl.state !== 'OPEN') {
    fail(runtimeControl?.continuous_service_allowed === false ? 'EMERGENCY_STOP_OR_ADMISSION_CLOSED' : 'RUNTIME_CONTROL_UNKNOWN');
  }
  const records = [...snapshot.active_tasks, ...(snapshot.completed_tasks || [])];
  const indexed = new Map();
  for (const task of records) {
    if (!exactTask(task)) { fail('TASK_IDENTITY_UNKNOWN'); continue; }
    const key = uid(task.task_id);
    if (indexed.has(key)) fail('DUPLICATE_TASK_READBACK');
    else indexed.set(key, task);
    if (graph(task) !== undefined && !costFor(task)) fail('RESOURCE_POLICY_INVALID');
  }
  const activeClaims = snapshot.active_claims.filter(c => upper(c?.state) === 'ACTIVE');
  const activeTaskIds = new Set(), activeAgentIds = new Set();
  const coveredTasks = new Set();
  const usage = { global: 0, roles: Object.fromEntries(ROLE_NAMES.map(role => [role, 0])),
    resources: Object.fromEntries(RESOURCE_NAMES.map(resource => [resource, 0])) };
  for (const claim of activeClaims) {
    const key = uid(claim?.task_id);
    const task = indexed.get(key);
    if (!UUID.test(key) || !task) { fail('ORPHAN_ACTIVE_CLAIM'); continue; }
    if (activeTaskIds.has(key)) fail('DUPLICATE_ACTIVE_CLAIM');
    activeTaskIds.add(key);
    if (claim.agent_id) {
      if (activeAgentIds.has(uid(claim.agent_id))) fail('AGENT_DOUBLE_CLAIM');
      activeAgentIds.add(uid(claim.agent_id));
    } else fail('CLAIM_AGENT_UNKNOWN');
    if (!INFLIGHT.has(upper(task.state))
        || !positive(task.lease_generation) || task.lease_generation !== claim.lease_generation
        || (task.lease_agent_id && uid(task.lease_agent_id) !== uid(claim.agent_id))) {
      fail('LEASE_BINDING_OR_STATE_CONFLICT');
    }
    const cost = costFor(task);
    if (!cost) { fail('RESOURCE_POLICY_INVALID'); continue; }
    usage.global++;
    if (!Object.hasOwn(usage.roles, cost.role)) fail('ROLE_POLICY_UNKNOWN');
    else usage.roles[cost.role]++;
    usage.resources[cost.resource] += cost.slots;
    coveredTasks.add(key);
  }
  for (const task of snapshot.active_tasks) {
    if (INFLIGHT.has(upper(task?.state)) && !coveredTasks.has(uid(task.task_id))) {
      // A missing claim in the same owner snapshot is not a free slot.
      fail('INFLIGHT_WITHOUT_ACTIVE_CLAIM');
    }
  }
  if (usage.global > FLEET_DAG_LIMITS.global) fail('GLOBAL_CAPACITY_EXCEEDED');
  for (const [role, count] of Object.entries(usage.roles))
    if (count > FLEET_DAG_LIMITS.roles[role]) fail('ROLE_CAPACITY_EXCEEDED');
  for (const [resource, count] of Object.entries(usage.resources))
    if (count > FLEET_DAG_LIMITS.resources[resource]) fail('RESOURCE_CAPACITY_EXCEEDED');

  let returned = 0;
  for (const claim of snapshot.active_claims) {
    if (upper(claim?.state) === 'ACTIVE') continue; // timestamps do not release
    if (!RELEASED.has(upper(claim?.state))) continue;
    const task = indexed.get(uid(claim?.task_id));
    if (!task || !TERMINAL.has(upper(task.state))) {
      fail('RELEASE_WITHOUT_TERMINAL_TASK');
      continue;
    }
    if (!positive(claim.lease_generation) || task.lease_generation !== claim.lease_generation
        || activeTaskIds.has(uid(claim.task_id))) {
      fail('RELEASE_GENERATION_CONFLICT');
      continue;
    }
    if (!isObject(claim.reconciliation) || claim.reconciliation.source !== 'OWN_POSTGRES'
        || claim.reconciliation.verified !== true || claim.reconciliation.authority_effect !== false
        || claim.reconciliation.task_id !== claim.task_id
        || claim.reconciliation.lease_generation !== claim.lease_generation
        || claim.reconciliation.effect_state !== 'NO_UNKNOWN_EFFECT') {
      // Reconciled terminal metadata is mandatory for claiming a returned slot.
      // Merely setting state=EXPIRED/FAILED is not enough.
      fail('SLOT_RETURN_PROOF_UNKNOWN');
      continue;
    }
    returned += 1;
  }

  const dag = planFleetDagAdmission(snapshot);
  if (dag?.state === 'FENCED') fail('DAG_ALREADY_FENCED');
  // An advisory OPEN cannot override contradiction or grant a cancellation.
  if (dag && dag.ready > FLEET_DAG_LIMITS.global - usage.global) fail('DAG_OVERADMITS_GLOBAL_SLOTS');

  const seenLeases = new Set(), seenAgents = new Set();
  for (const lease of leaseBatch) {
    const taskId = uid(lease?.task_id), agentId = uid(lease?.agent_id);
    const task = indexed.get(taskId);
    if (lease?.leased !== true || !UUID.test(taskId) || !agentId
        || !positive(lease.lease_generation) || lease.automatic_retry_allowed !== false
        || lease.authority_effect !== false || !SHA40.test(lease.base_sha ?? '')
        || seenLeases.has(taskId) || seenAgents.has(agentId)) {
      fail('DUPLICATE_OR_UNBOUND_LEASE_RECEIPT');
      continue;
    }
    seenLeases.add(taskId); seenAgents.add(agentId);
    if (task && (upper(task.state) !== 'READY' || upper(task.role) !== upper(lease.role)))
      fail('LEASE_SNAPSHOT_TASK_CONFLICT');
    if (activeTaskIds.has(taskId) || activeAgentIds.has(agentId))
      fail('LEASE_REPLAYS_ACTIVE_CLAIM');
  }
  if (leaseBatch.length > FLEET_DAG_LIMITS.global - usage.global)
    fail('LEASE_BATCH_EXCEEDS_RETURNED_SLOTS');

  return result(reasons.size ? 'FENCED' : 'CONSISTENT_NOT_AUTHORITY', usage.global, returned,
    fixed({global: FLEET_DAG_LIMITS.global, roles: fixed({...usage.roles}),
      resources: fixed({...usage.resources})}));
}
