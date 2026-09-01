import {
  assertZeroAuthorityMetaOutput,
  reconcileMetaOrchestrator,
} from './meta-orchestrator-core.mjs';

const ACTIVE_TASK_STATES = new Set(['READY', 'LEASED', 'RUNNING', 'RESULT_READY']);
const FAILED_TASK_STATES = new Set(['FAILED', 'CANCELLED', 'FENCED', 'BLOCKED']);
const MAX_ATOMIC_FRONTIER_POINTS = 8;

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function zeroEnvelope(extra = {}) {
  return Object.freeze({
    ...extra,
    task_content_authority: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

function zeroAction(type, payload = {}) {
  return zeroEnvelope({
    schema: 'metaengine.meta-orchestrator.action.v1',
    type,
    ...structuredClone(payload),
  });
}

function companionRoles(node) {
  if (String(node?.risk || '').toUpperCase() === 'CRITICAL') return ['CRITIC', 'FALSIFIER'];
  if (String(node?.risk || '').toUpperCase() === 'HIGH') return ['CRITIC'];
  return [];
}

function companionPoint(node, role) {
  return `${String(node.point_id).toLowerCase()}.${String(role).toLowerCase()}`;
}

function latestTaskForPoint(tasks, pointId) {
  const rows = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => String(task?.point_id || '').toLowerCase() === pointId)
    .sort((a, b) => {
      const generationDelta = Number(b?.lease_generation || 0) - Number(a?.lease_generation || 0);
      if (generationDelta !== 0) return generationDelta;
      return String(b?.updated_at || '').localeCompare(String(a?.updated_at || ''));
    });
  return rows[0] || null;
}

function taskState(tasks, pointId) {
  const task = latestTaskForPoint(tasks, pointId);
  return task ? String(task.state || 'UNKNOWN').toUpperCase() : 'UNSCHEDULED';
}

function proposalFor(node, plan, companionRole = null) {
  const role = companionRole || node.role;
  const pointId = companionRole ? companionPoint(node, companionRole) : node.point_id;
  return zeroAction('PROPOSE_TASK', {
    point_id: pointId,
    parent_point_id: companionRole ? node.point_id : null,
    role,
    objective: companionRole
      ? `${companionRole} independently evaluate ${node.point_id}: ${node.objective}`
      : node.objective,
    base_sha: node.base_sha,
    source_branch: node.source_branch,
    target_branch: companionRole ? '' : node.target_branch,
    priority: companionRole ? node.priority - 1 : node.priority,
    required_capabilities: node.required_capabilities,
    constraints: [
      ...(Array.isArray(node.constraints) ? node.constraints : []),
      'Use the existing DevOS scheduler; do not allocate leases or choose agent/tab/target identity.',
      'Do not blindly retry ambiguous effects.',
    ],
    deliverable: node.deliverable,
    evidence_contract: node.evidence_contract,
    roadmap_id: plan.roadmap_id,
    alignment_epoch: plan.alignment_epoch,
    plan_generation: plan.plan_generation,
    parent_plan_point: node.point_id,
    atomic_frontier_required: companionRoles(node).length > 0,
    automatic_retry_allowed: false,
  });
}

function progressMap(base) {
  return new Map((base?.progress?.rows || []).map((row) => [String(row.point_id || '').toLowerCase(), row]));
}

function dependenciesVerified(node, byPoint) {
  return (node.dependencies || []).every((dependency) => byPoint.get(String(dependency).toLowerCase())?.state === 'VERIFIED');
}

function safetyState(plan, tasks) {
  const missingGroups = [];
  const active = [];
  const ambiguous = [];
  const failed = [];

  for (const node of plan.nodes || []) {
    const roles = companionRoles(node);
    if (!roles.length) continue;
    const parentPoint = String(node.point_id).toLowerCase();
    const parentState = taskState(tasks, parentPoint);
    if (parentState === 'UNSCHEDULED') continue;

    const missing = [];
    for (const role of roles) {
      const pointId = companionPoint(node, role);
      const state = taskState(tasks, pointId);
      if (state === 'UNSCHEDULED') missing.push({ role, point_id: pointId });
      else if (state === 'AMBIGUOUS') ambiguous.push({ parent_point_id: parentPoint, point_id: pointId, state });
      else if (FAILED_TASK_STATES.has(state) || state === 'UNKNOWN') failed.push({ parent_point_id: parentPoint, point_id: pointId, state });
      else if (ACTIVE_TASK_STATES.has(state)) active.push({ parent_point_id: parentPoint, point_id: pointId, state });
    }
    if (missing.length) missingGroups.push({ node, missing, kind: 'SAFETY_REPAIR' });
  }

  return { missingGroups, active, ambiguous, failed };
}

function newFrontierGroups(plan, tasks, byPoint) {
  const groups = [];
  for (const node of plan.nodes || []) {
    const pointId = String(node.point_id).toLowerCase();
    if (byPoint.get(pointId)?.state !== 'PENDING' || !dependenciesVerified(node, byPoint)) continue;
    if (taskState(tasks, pointId) !== 'UNSCHEDULED') continue;
    const proposals = [proposalFor(node, plan)];
    for (const role of companionRoles(node)) {
      const companion = companionPoint(node, role);
      if (taskState(tasks, companion) === 'UNSCHEDULED') proposals.push(proposalFor(node, plan, role));
    }
    groups.push({ node, proposals, kind: 'NEW_FRONTIER' });
  }
  return groups;
}

function repairGroupToProposals(group, plan) {
  return {
    ...group,
    proposals: group.missing.map((item) => proposalFor(group.node, plan, item.role)),
  };
}

function requestCapacity(base, group, availableSlots, proposalBudget, reason) {
  const required = group?.proposals?.length || 1;
  return zeroEnvelope({
    schema: 'metaengine.meta-orchestrator.reconcile.v1',
    state: 'CAPACITY_WAIT',
    reason,
    progress: base.progress,
    atomic_frontier_required: true,
    actions: Object.freeze([zeroAction('REQUEST_CAPACITY', {
      required_slots: required,
      available_slots: availableSlots,
      required_parallel_proposals: required,
      proposal_budget: proposalBudget,
      parent_plan_point: group?.node?.point_id || null,
      reason,
    })]),
  });
}

function selectAtomicGroups(base, groups, capacity, policy) {
  const availableSlots = integer(capacity?.available_slots, 0, { min: 0, max: 4096 });
  const configuredParallel = integer(policy?.max_parallel_proposals, 8, { min: 1, max: 128 });
  const proposalBudget = Math.min(configuredParallel, MAX_ATOMIC_FRONTIER_POINTS);
  const sorted = [...groups].sort((left, right) => {
    const repairDelta = (left.kind === 'SAFETY_REPAIR' ? 0 : 1) - (right.kind === 'SAFETY_REPAIR' ? 0 : 1);
    if (repairDelta !== 0) return repairDelta;
    return Number(right.node?.priority || 0) - Number(left.node?.priority || 0)
      || String(left.node?.point_id || '').localeCompare(String(right.node?.point_id || ''));
  });

  if (!sorted.length) return null;
  const first = sorted[0];
  if (first.proposals.length > proposalBudget) {
    return requestCapacity(base, first, availableSlots, proposalBudget, 'SAFETY_GROUP_EXCEEDS_PROPOSAL_BUDGET');
  }
  if (first.proposals.length > availableSlots) {
    return requestCapacity(base, first, availableSlots, proposalBudget, 'ATOMIC_SAFETY_GROUP_CAPACITY_REQUIRED');
  }

  let slotsLeft = availableSlots;
  let proposalsLeft = proposalBudget;
  const selectedGroups = [];
  for (const group of sorted) {
    const size = group.proposals.length;
    if (size > slotsLeft || size > proposalsLeft) break;
    selectedGroups.push(group);
    slotsLeft -= size;
    proposalsLeft -= size;
  }

  const actions = selectedGroups.flatMap((group) => group.proposals);
  if (!actions.length) return requestCapacity(base, first, availableSlots, proposalBudget, 'ATOMIC_FRONTIER_CAPACITY_REQUIRED');
  return zeroEnvelope({
    schema: 'metaengine.meta-orchestrator.reconcile.v1',
    state: 'PROPOSING',
    reason: 'ATOMIC_SAFETY_FRONTIER',
    progress: base.progress,
    atomic_frontier_required: true,
    frontier_group_count: selectedGroups.length,
    frontier_point_count: actions.length,
    actions: Object.freeze(actions),
  });
}

export function reconcileContinuousMetaOrchestrator(args = {}) {
  const base = reconcileMetaOrchestrator(args);
  assertZeroAuthorityMetaOutput(base);

  // Authority/generation/evidence/ambiguity fences from the base reconcile always win.
  if (['FENCED', 'STALE', 'RECONCILING'].includes(base.state)) return base;

  const plan = args.plan;
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const byPoint = progressMap(base);
  const failedRows = [...byPoint.values()].filter((row) => ['FAILED', 'UNKNOWN'].includes(String(row?.state || '')));
  if (failedRows.length) {
    const result = zeroEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1',
      state: 'BLOCKED',
      reason: 'PLAN_NODE_FAILURE_REQUIRES_REASONING',
      progress: base.progress,
      actions: Object.freeze([zeroAction('REQUEST_REASONING', {
        reason: 'PLAN_NODE_FAILURE_REQUIRES_REASONING',
        blocked_points: failedRows.map((row) => row.point_id),
      })]),
    });
    assertZeroAuthorityMetaOutput(result);
    return result;
  }
  if (base.state === 'BLOCKED') return base;

  const eligibleGroups = newFrontierGroups(plan, tasks, byPoint);
  const safety = safetyState(plan, tasks);

  if (safety.ambiguous.length) {
    const result = zeroEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1',
      state: 'RECONCILING',
      reason: 'SAFETY_COMPANION_AMBIGUOUS',
      progress: base.progress,
      actions: Object.freeze(safety.ambiguous.map((row) => zeroAction('REQUEST_RECONCILIATION', {
        point_id: row.point_id,
        parent_plan_point: row.parent_point_id,
        reason: 'SAFETY_COMPANION_AMBIGUOUS',
        automatic_retry_allowed: false,
      }))),
    });
    assertZeroAuthorityMetaOutput(result);
    return result;
  }

  if (safety.failed.length) {
    const result = zeroEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1',
      state: 'BLOCKED',
      reason: 'SAFETY_COMPANION_FAILED',
      progress: base.progress,
      actions: Object.freeze([zeroAction('REQUEST_REASONING', {
        reason: 'SAFETY_COMPANION_FAILED',
        blocked_points: safety.failed.map((row) => row.point_id),
      })]),
    });
    assertZeroAuthorityMetaOutput(result);
    return result;
  }

  const repairGroups = safety.missingGroups.map((group) => repairGroupToProposals(group, plan));
  const selected = selectAtomicGroups(base, [...repairGroups, ...eligibleGroups], args.capacity || {}, args.policy || {});
  if (selected) {
    assertZeroAuthorityMetaOutput(selected);
    return selected;
  }

  if (safety.active.length && base.state === 'CONVERGED') {
    const result = zeroEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1',
      state: 'SAFETY_WAIT',
      reason: 'SAFETY_COMPANION_NOT_TERMINAL',
      progress: base.progress,
      actions: Object.freeze([zeroAction('NOOP', {
        reason: 'SAFETY_COMPANION_NOT_TERMINAL',
        points: safety.active.map((row) => row.point_id),
      })]),
    });
    assertZeroAuthorityMetaOutput(result);
    return result;
  }

  assertZeroAuthorityMetaOutput(base);
  return base;
}

export const META_ORCHESTRATOR_ATOMIC_FRONTIER_MAX_POINTS = MAX_ATOMIC_FRONTIER_POINTS;
