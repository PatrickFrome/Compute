const SHA40_RE = /^[a-f0-9]{40}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CAPABILITY_RE = /^[a-z][a-z0-9._:-]{2,127}$/;

const TERMINAL_FAILURE = new Set(['FAILED', 'CANCELLED', 'FENCED', 'BLOCKED']);
const ACTIVE = new Set(['READY', 'LEASED', 'RUNNING', 'RESULT_READY']);
const SCHEDULER_OWNED_FIELDS = new Set([
  'agent_id', 'lease_agent_id', 'tab_id', 'lease_tab_id', 'target_id', 'lease_target_id',
  'agent_generation_epoch', 'lease_agent_generation_epoch', 'lease_generation', 'lease_expires_at',
  'claim_id', 'workspace_id',
]);
const FORBIDDEN_ACTIONS = new Set([
  'CLAIM', 'LEASE', 'DISPATCH', 'EXECUTE', 'SELECT_TAB', 'SEMANTIC_TYPE', 'TYPED_CLICK',
  'MARK_RUNNING', 'COMPLETE', 'RETRY_EFFECT', 'RETRY_AMBIGUOUS_EFFECT', 'MERGE_MAIN',
  'PUBLISH_RELEASE', 'PRODUCTION_DDL', 'ARM', 'CONTROL',
]);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`meta_${name}_invalid`);
  return value;
}
function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < min || out > max) throw new Error(`meta_${name}_invalid`);
  return out;
}
function text(value, name, max = 4096) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max) throw new Error(`meta_${name}_invalid`);
  return out;
}
function point(value) {
  const out = text(value, 'point_id', 128).toLowerCase();
  if (!POINT_RE.test(out)) throw new Error('meta_point_id_invalid');
  return out;
}
function role(value) {
  const out = text(value, 'role', 64).toUpperCase();
  if (!ROLE_RE.test(out)) throw new Error('meta_role_invalid');
  return out;
}
function sha(value, name = 'base_sha') {
  const out = text(value, name, 40).toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`meta_${name}_invalid`);
  return out;
}
function uniqueStrings(values, parser, max = 64) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > max) throw new Error('meta_array_invalid');
  return [...new Set(values.map(parser))].sort();
}
function capability(value) {
  const out = text(value, 'capability', 128).toLowerCase();
  if (!CAPABILITY_RE.test(out)) throw new Error('meta_capability_invalid');
  return out;
}
function risk(value) {
  const out = String(value || 'NORMAL').trim().toUpperCase();
  if (!['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(out)) throw new Error('meta_risk_invalid');
  return out;
}
function deepSchedulerFieldScan(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => deepSchedulerFieldScan(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SCHEDULER_OWNED_FIELDS.has(key)) throw new Error(`meta_scheduler_owned_field_forbidden:${path}.${key}`);
    deepSchedulerFieldScan(child, `${path}.${key}`);
  }
}
function authorityEnvelope(extra = {}) {
  return Object.freeze({
    ...extra,
    task_content_authority: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}
function action(type, payload = {}) {
  const upper = String(type || '').trim().toUpperCase();
  if (!upper || FORBIDDEN_ACTIONS.has(upper)) throw new Error(`meta_action_forbidden:${upper || 'EMPTY'}`);
  deepSchedulerFieldScan(payload);
  return authorityEnvelope({ schema: 'metaengine.meta-orchestrator.action.v1', type: upper, ...structuredClone(payload) });
}
function evidenceContract(value) {
  if (value == null) return Object.freeze({ required: [], min_verified: 0 });
  const row = object(value, 'evidence_contract');
  const required = uniqueStrings(row.required || [], (item) => text(item, 'evidence_kind', 128).toLowerCase(), 32);
  const minVerified = integer(row.min_verified ?? required.length, 'evidence_min_verified', { min: 0, max: 32 });
  if (minVerified > required.length) throw new Error('meta_evidence_min_verified_invalid');
  return Object.freeze({ required, min_verified: minVerified });
}
function normalizeNode(raw, baselineSha) {
  const row = object(raw, 'plan_node');
  deepSchedulerFieldScan(row);
  const node = {
    point_id: point(row.point_id),
    role: role(row.role),
    objective: text(row.objective, 'objective', 12000),
    dependencies: uniqueStrings(row.dependencies || [], point, 64),
    required_capabilities: uniqueStrings(row.required_capabilities || [], capability, 64),
    risk: risk(row.risk),
    priority: integer(row.priority ?? 50, 'priority', { min: -100000, max: 100000 }),
    base_sha: row.base_sha == null ? baselineSha : sha(row.base_sha),
    source_branch: row.source_branch == null ? '' : String(row.source_branch).trim().slice(0, 240),
    target_branch: row.target_branch == null ? '' : String(row.target_branch).trim().slice(0, 240),
    deliverable: row.deliverable == null ? '' : String(row.deliverable).trim().slice(0, 4000),
    constraints: uniqueStrings(row.constraints || [], (item) => text(item, 'constraint', 1000), 32),
    evidence_contract: evidenceContract(row.evidence_contract),
  };
  if (node.base_sha !== baselineSha && row.allow_branch_base_override !== true) throw new Error(`meta_node_base_sha_drift:${node.point_id}`);
  if (node.dependencies.includes(node.point_id)) throw new Error(`meta_self_dependency:${node.point_id}`);
  return Object.freeze(node);
}
function assertAcyclic(nodes) {
  const byPoint = new Map(nodes.map((node) => [node.point_id, node]));
  for (const node of nodes) {
    for (const dep of node.dependencies) if (!byPoint.has(dep)) throw new Error(`meta_dependency_missing:${node.point_id}:${dep}`);
  }
  const state = new Map();
  const visit = (id) => {
    const mark = state.get(id) || 0;
    if (mark === 1) throw new Error(`meta_dependency_cycle:${id}`);
    if (mark === 2) return;
    state.set(id, 1);
    for (const dep of byPoint.get(id).dependencies) visit(dep);
    state.set(id, 2);
  };
  for (const node of nodes) visit(node.point_id);
}

export function compileMetaPlan({ authority, plan_generation, nodes = [] } = {}) {
  const a = object(authority, 'roadmap_authority');
  const baselineSha = sha(a.baseline_sha);
  const alignmentEpoch = integer(a.alignment_epoch, 'alignment_epoch', { min: 1 });
  const generation = integer(plan_generation, 'plan_generation', { min: 1 });
  if (!Array.isArray(nodes) || nodes.length > 512) throw new Error('meta_nodes_invalid');
  const normalized = nodes.map((node) => normalizeNode(node, baselineSha));
  const seen = new Set();
  for (const node of normalized) {
    if (seen.has(node.point_id)) throw new Error(`meta_duplicate_point:${node.point_id}`);
    seen.add(node.point_id);
  }
  assertAcyclic(normalized);
  return authorityEnvelope({
    schema: 'metaengine.meta-orchestrator.plan.v1',
    roadmap_id: text(a.roadmap_id || a.authority_key, 'roadmap_id', 160),
    active_milestone_key: text(a.active_milestone_key, 'active_milestone_key', 160),
    integration_line: text(a.integration_line, 'integration_line', 240),
    baseline_sha: baselineSha,
    alignment_epoch: alignmentEpoch,
    plan_generation: generation,
    nodes: normalized,
  });
}

function taskStateForPoint(pointId, tasks) {
  const rows = tasks.filter((task) => String(task?.point_id || '').toLowerCase() === pointId);
  if (!rows.length) return { state: 'UNSCHEDULED', task: null };
  rows.sort((a, b) => {
    const ag = Number(a?.lease_generation || 0); const bg = Number(b?.lease_generation || 0);
    if (bg !== ag) return bg - ag;
    return String(b?.updated_at || '').localeCompare(String(a?.updated_at || ''));
  });
  return { state: String(rows[0]?.state || 'UNKNOWN').toUpperCase(), task: rows[0] };
}
function verifiedKinds(pointId, evidence) {
  const rows = Array.isArray(evidence) ? evidence : [];
  return new Set(rows.filter((row) => String(row?.point_id || '').toLowerCase() === pointId && row?.verified === true && row?.authority_effect === false)
    .map((row) => String(row?.kind || '').trim().toLowerCase()).filter(Boolean));
}
function evidenceSatisfied(node, evidence) {
  const kinds = verifiedKinds(node.point_id, evidence);
  const matched = node.evidence_contract.required.filter((kind) => kinds.has(kind));
  return { satisfied: matched.length >= node.evidence_contract.min_verified, matched, required: node.evidence_contract.required };
}

export function deriveProgressLedger({ plan, tasks = [], evidence = [] } = {}) {
  object(plan, 'plan');
  if (plan.schema !== 'metaengine.meta-orchestrator.plan.v1') throw new Error('meta_plan_schema_invalid');
  if (!Array.isArray(tasks) || !Array.isArray(evidence)) throw new Error('meta_progress_inputs_invalid');
  const rows = [];
  for (const node of plan.nodes) {
    const observed = taskStateForPoint(node.point_id, tasks);
    const ev = evidenceSatisfied(node, evidence);
    let state;
    if (observed.state === 'AMBIGUOUS') state = 'AMBIGUOUS';
    else if (TERMINAL_FAILURE.has(observed.state)) state = 'FAILED';
    else if (observed.state === 'COMPLETED') state = ev.satisfied ? 'VERIFIED' : 'EVIDENCE_PENDING';
    else if (ACTIVE.has(observed.state)) state = observed.state;
    else if (observed.state === 'UNSCHEDULED') state = 'PENDING';
    else state = 'UNKNOWN';
    rows.push(Object.freeze({ point_id: node.point_id, state, observed_task_state: observed.state, evidence: ev }));
  }
  const counts = Object.freeze(rows.reduce((acc, row) => { acc[row.state] = (acc[row.state] || 0) + 1; return acc; }, {}));
  return authorityEnvelope({
    schema: 'metaengine.meta-orchestrator.progress.v1',
    roadmap_id: plan.roadmap_id,
    alignment_epoch: plan.alignment_epoch,
    plan_generation: plan.plan_generation,
    rows: Object.freeze(rows),
    counts,
  });
}

function riskCompanions(node) {
  if (node.risk === 'CRITICAL') return ['CRITIC', 'FALSIFIER'];
  if (node.risk === 'HIGH') return ['CRITIC'];
  return [];
}
function activePointSet(tasks) {
  return new Set(tasks.filter((task) => !['COMPLETED', 'FAILED', 'CANCELLED', 'FENCED', 'AMBIGUOUS'].includes(String(task?.state || '').toUpperCase()))
    .map((task) => String(task?.point_id || '').toLowerCase()).filter(Boolean));
}
function nodeProposal(node, plan, companionRole = null) {
  const roleValue = companionRole || node.role;
  const suffix = companionRole ? `.${companionRole.toLowerCase()}` : '';
  const pointId = companionRole ? `${node.point_id}${suffix}` : node.point_id;
  return action('PROPOSE_TASK', {
    point_id: pointId,
    parent_point_id: companionRole ? node.point_id : null,
    role: roleValue,
    objective: companionRole
      ? `${companionRole} independently evaluate ${node.point_id}: ${node.objective}`
      : node.objective,
    base_sha: node.base_sha,
    source_branch: node.source_branch,
    target_branch: companionRole ? '' : node.target_branch,
    priority: companionRole ? node.priority - 1 : node.priority,
    required_capabilities: node.required_capabilities,
    constraints: [
      ...node.constraints,
      'Use the existing DevOS scheduler; do not allocate leases or choose agent/tab/target identity.',
      'Do not blindly retry ambiguous effects.',
    ],
    deliverable: node.deliverable,
    evidence_contract: node.evidence_contract,
    roadmap_id: plan.roadmap_id,
    alignment_epoch: plan.alignment_epoch,
    plan_generation: plan.plan_generation,
    parent_plan_point: node.point_id,
    automatic_retry_allowed: false,
  });
}

export function reconcileMetaOrchestrator({
  plan,
  observed_alignment_epoch,
  observed_plan_generation,
  leader = {},
  tasks = [],
  evidence = [],
  capacity = {},
  policy = {},
} = {}) {
  object(plan, 'plan');
  const expectedLeaderEpoch = integer(leader.expected_epoch ?? 1, 'leader_expected_epoch', { min: 1 });
  const observedLeaderEpoch = integer(leader.observed_epoch ?? expectedLeaderEpoch, 'leader_observed_epoch', { min: 1 });
  if (observedLeaderEpoch !== expectedLeaderEpoch) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1',
      state: 'FENCED',
      reason: 'LEADER_EPOCH_MISMATCH',
      actions: Object.freeze([action('NOOP', { reason: 'LEADER_EPOCH_MISMATCH' })]),
    });
  }
  if (integer(observed_alignment_epoch, 'observed_alignment_epoch', { min: 1 }) !== plan.alignment_epoch) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'STALE', reason: 'ROADMAP_ALIGNMENT_EPOCH_DRIFT',
      actions: Object.freeze([action('REQUEST_REASONING', { reason: 'ROADMAP_ALIGNMENT_EPOCH_DRIFT', expected_alignment_epoch: plan.alignment_epoch })]),
    });
  }
  if (integer(observed_plan_generation, 'observed_plan_generation', { min: 1 }) !== plan.plan_generation) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'STALE', reason: 'PLAN_GENERATION_DRIFT',
      actions: Object.freeze([action('REQUEST_REASONING', { reason: 'PLAN_GENERATION_DRIFT', expected_plan_generation: plan.plan_generation })]),
    });
  }
  if (!Array.isArray(tasks) || !Array.isArray(evidence)) throw new Error('meta_reconcile_inputs_invalid');
  const progress = deriveProgressLedger({ plan, tasks, evidence });
  const progressByPoint = new Map(progress.rows.map((row) => [row.point_id, row]));
  const actions = [];

  for (const row of progress.rows.filter((item) => item.state === 'AMBIGUOUS')) {
    actions.push(action('REQUEST_RECONCILIATION', {
      point_id: row.point_id,
      reason: 'AMBIGUOUS_EFFECT_REQUIRES_READBACK',
      automatic_retry_allowed: false,
    }));
  }
  for (const row of progress.rows.filter((item) => item.state === 'EVIDENCE_PENDING')) {
    actions.push(action('REQUEST_EVIDENCE', {
      point_id: row.point_id,
      required: row.evidence.required,
      matched: row.evidence.matched,
      reason: 'COMPLETION_NOT_YET_VERIFIED',
    }));
  }
  if (actions.length) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'RECONCILING', reason: 'AMBIGUITY_OR_EVIDENCE_GAP',
      progress, actions: Object.freeze(actions),
    });
  }

  const pending = plan.nodes.filter((node) => progressByPoint.get(node.point_id)?.state === 'PENDING');
  const activePoints = activePointSet(tasks);
  const eligible = pending.filter((node) => node.dependencies.every((dep) => progressByPoint.get(dep)?.state === 'VERIFIED'));
  const blocked = pending.filter((node) => node.dependencies.some((dep) => ['FAILED', 'AMBIGUOUS', 'EVIDENCE_PENDING', 'UNKNOWN'].includes(progressByPoint.get(dep)?.state)));

  if (blocked.length && eligible.length === 0) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'BLOCKED', reason: 'DEPENDENCY_NOT_VERIFIED', progress,
      actions: Object.freeze([action('REQUEST_REASONING', { reason: 'DEPENDENCY_NOT_VERIFIED', blocked_points: blocked.map((node) => node.point_id) })]),
    });
  }

  const availableSlots = integer(capacity.available_slots ?? 0, 'available_slots', { min: 0, max: 4096 });
  const maxParallel = integer(policy.max_parallel_proposals ?? 8, 'max_parallel_proposals', { min: 1, max: 128 });
  const fanout = Math.min(availableSlots, maxParallel, eligible.length);
  if (eligible.length > 0 && fanout === 0) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'CAPACITY_WAIT', reason: 'NO_AVAILABLE_CAPACITY', progress,
      actions: Object.freeze([action('REQUEST_CAPACITY', { required_slots: Math.min(maxParallel, eligible.length), reason: 'READY_FRONTIER' })]),
    });
  }

  const selected = eligible
    .filter((node) => !activePoints.has(node.point_id))
    .sort((a, b) => b.priority - a.priority || a.point_id.localeCompare(b.point_id))
    .slice(0, fanout);
  for (const node of selected) {
    actions.push(nodeProposal(node, plan));
    for (const companion of riskCompanions(node)) {
      const companionPoint = `${node.point_id}.${companion.toLowerCase()}`;
      if (!activePoints.has(companionPoint) && actions.length < maxParallel) actions.push(nodeProposal(node, plan, companion));
    }
  }

  if (actions.length) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'PROPOSING', reason: 'READY_FRONTIER', progress,
      actions: Object.freeze(actions.slice(0, maxParallel)),
    });
  }

  if (progress.rows.length > 0 && progress.rows.every((row) => row.state === 'VERIFIED')) {
    return authorityEnvelope({
      schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'CONVERGED', reason: 'ALL_PLAN_NODES_VERIFIED', progress,
      actions: Object.freeze([action('NOOP', { reason: 'ALL_PLAN_NODES_VERIFIED' })]),
    });
  }

  return authorityEnvelope({
    schema: 'metaengine.meta-orchestrator.reconcile.v1', state: 'OBSERVING', reason: 'NO_DETERMINISTIC_TRANSITION', progress,
    actions: Object.freeze([action('NOOP', { reason: 'NO_DETERMINISTIC_TRANSITION' })]),
  });
}

export function assertZeroAuthorityMetaOutput(value) {
  const row = object(value, 'output');
  const inspect = (item) => {
    if (Array.isArray(item)) return item.forEach(inspect);
    if (!item || typeof item !== 'object') return;
    for (const forbidden of ['authority_effect', 'task_content_authority', 'scheduler_authority', 'browser_authority', 'release_authority']) {
      if (forbidden in item && item[forbidden] !== false) throw new Error(`meta_authority_violation:${forbidden}`);
    }
    if (item.type && FORBIDDEN_ACTIONS.has(String(item.type).toUpperCase())) throw new Error(`meta_action_forbidden:${item.type}`);
    deepSchedulerFieldScan(item);
    Object.values(item).forEach(inspect);
  };
  inspect(row);
  return true;
}

export const META_ORCHESTRATOR_SCHEDULER_OWNED_FIELDS = Object.freeze([...SCHEDULER_OWNED_FIELDS]);
export const META_ORCHESTRATOR_FORBIDDEN_ACTIONS = Object.freeze([...FORBIDDEN_ACTIONS]);
