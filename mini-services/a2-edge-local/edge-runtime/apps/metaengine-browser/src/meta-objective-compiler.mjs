// Meta Objective Compiler — T2-⑤ (Unified Work Graph), item 2.
//
// The meta orchestrator heartbeat superstep deliberately DISABLES autonomous
// plan activation (its activatePlan stub throws meta_superstep_plan_
// activation_disabled): a plan is authority-bearing content (it defines what
// the fleet will be asked to do), so activation must be operator-initiated.
// This module compiles an operator objective into a zero-authority
// `metaengine.meta-orchestrator.plan.v1` against the CURRENT roadmap
// authority row, ready for `meta_orchestrator_plan_activate_v1` (SQL CAS on
// plan_generation, activation is generation-fenced).
//
// Invariants (mirrored from the SQL contracts, enforced BEFORE the RPC):
// - The plan binds EXACTLY the authoritative roadmap row (roadmap_id,
//   active_milestone_key, integration_line, baseline_sha, alignment_epoch).
// - Every node's base_sha is the authority baseline (meta_admit_plan_node_
//   invalid otherwise).
// - No scheduler-owned identity key (agent/tab/target/lease/claim/workspace)
//   may appear ANYWHERE in the plan at any nesting depth — the SQL jsonb_
//   path_exists guards reject them; we reject them first with a clearer error.
// - All authority flags are false; plan_generation = current + 1.
// - Companion points (.critic / .falsifier) are DB-derived derivatives — they
//   are rejected as primary point_ids to prevent aliasing a safety companion
//   onto an operator node.

export const META_OBJECTIVE_SCHEMA = 'metaengine.meta-orchestrator.plan.v1';
export const META_OBJECTIVE_MAX_NODES = 32;
export const META_OBJECTIVE_ROLES = Object.freeze(['PLANNER', 'RESEARCHER', 'IMPLEMENTER', 'CRITIC', 'FALSIFIER']);
export const META_OBJECTIVE_RISKS = Object.freeze(['NORMAL', 'HIGH', 'CRITICAL']);

const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;
const SLUG_POINT_RE = /^[a-z0-9][a-z0-9._-]{2,60}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const ROADMAP_RE = /^[a-z0-9][a-z0-9._:-]{2,159}$/;

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'agent_id', 'lease_agent_id', 'tab_id', 'lease_tab_id', 'target_id', 'lease_target_id',
  'agent_generation_epoch', 'lease_agent_generation_epoch', 'lease_generation',
  'lease_expires_at', 'claim_id', 'workspace_id',
]);

function fail(code) { throw new Error(`meta_objective_${code}`); }

function boundedString(value, label, max) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max) fail(`${label}_invalid`);
  return out;
}

function slugifyObjective(objective) {
  const slug = String(objective || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  const point = `obj.${slug || 'objective'}.v1`;
  if (!SLUG_POINT_RE.test(point)) fail('point_slug_invalid');
  return point;
}

// Recursive scheduler-identity scan — mirrors the SQL jsonb_path_exists guards
// ($.**.agent_id etc). Rejects the key at ANY depth in ANY value type.
function scanForbiddenKeys(value, trail = 'plan') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) fail(`scheduler_identity_forbidden:${trail}.${key}`);
    scanForbiddenKeys(child, `${trail}.${key}`);
  }
}

function boundedJsonSize(value, maxBytes, label) {
  let size;
  try { size = JSON.stringify(value).length; } catch { fail(`${label}_invalid`); }
  if (!Number.isSafeInteger(size) || size > maxBytes) fail(`${label}_too_large`);
}

function normalizeAuthority(authority) {
  const row = authority && typeof authority === 'object' && !Array.isArray(authority) ? authority : null;
  if (!row) fail('authority_invalid');
  const roadmap_id = String(row.roadmap_id || '').trim().toLowerCase();
  const active_milestone_key = String(row.active_milestone_key || '').trim();
  const integration_line = String(row.integration_line || '').trim();
  const baseline_sha = String(row.baseline_sha || '').trim().toLowerCase();
  const alignment_epoch = Number(row.alignment_epoch);
  if (!ROADMAP_RE.test(roadmap_id)) fail('authority_roadmap_invalid');
  if (!active_milestone_key || active_milestone_key.length > 160) fail('authority_milestone_invalid');
  if (!integration_line || integration_line.length > 240) fail('authority_integration_line_invalid');
  if (!SHA40_RE.test(baseline_sha)) fail('authority_baseline_invalid');
  if (!Number.isSafeInteger(alignment_epoch) || alignment_epoch < 1) fail('authority_alignment_epoch_invalid');
  return { roadmap_id, active_milestone_key, integration_line, baseline_sha, alignment_epoch };
}

function currentGeneration(planState) {
  const row = planState && typeof planState === 'object' && !Array.isArray(planState) ? planState : null;
  if (!row) fail('plan_state_invalid');
  const found = row.found === true;
  const generation = found ? Number(row.plan_generation) : 0;
  if (!Number.isSafeInteger(generation) || generation < 0) fail('plan_state_generation_invalid');
  return generation;
}

function normalizeNodeInput(raw, index, authority, knownPoints) {
  const node = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : fail(`node_${index}_invalid`);
  const pointId = boundedString(node.point_id, `node_${index}_point_id`, 192).toLowerCase();
  if (!POINT_RE.test(pointId)) fail(`node_${index}_point_id_invalid`);
  if (pointId.endsWith('.critic') || pointId.endsWith('.falsifier')) fail(`node_${index}_companion_suffix_forbidden`);
  if (knownPoints.has(pointId)) fail(`node_${index}_point_duplicate`);
  const role = boundedString(node.role, `node_${index}_role`, 64).toUpperCase();
  if (!ROLE_RE.test(role) || !META_OBJECTIVE_ROLES.includes(role)) fail(`node_${index}_role_invalid`);
  const objective = boundedString(node.objective, `node_${index}_objective`, 480);
  const riskRaw = node.risk == null ? 'NORMAL' : String(node.risk).trim().toUpperCase();
  if (!META_OBJECTIVE_RISKS.includes(riskRaw)) fail(`node_${index}_risk_invalid`);
  const priority = node.priority == null ? 50 : Number(node.priority);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1000) fail(`node_${index}_priority_invalid`);
  const sourceBranch = node.source_branch == null ? authority.integration_line : String(node.source_branch).slice(0, 240);
  if (sourceBranch.length > 240) fail(`node_${index}_source_branch_invalid`);
  const targetBranch = node.target_branch == null ? '' : String(node.target_branch).slice(0, 240);
  if (targetBranch.length > 240) fail(`node_${index}_target_branch_invalid`);
  const deliverable = node.deliverable == null ? objective : String(node.deliverable).slice(0, 4000);
  if (deliverable.length > 4000) fail(`node_${index}_deliverable_invalid`);
  const dependencies = Array.isArray(node.dependencies) ? node.dependencies : [];
  if (dependencies.length > 32) fail(`node_${index}_dependencies_invalid`);
  const deps = dependencies.map((dep, depIndex) => {
    const out = boundedString(dep, `node_${index}_dependency_${depIndex}`, 192).toLowerCase();
    if (!POINT_RE.test(out)) fail(`node_${index}_dependency_invalid`);
    return out;
  });
  if (new Set(deps).size !== deps.length) fail(`node_${index}_dependency_duplicate`);
  if (deps.includes(pointId)) fail(`node_${index}_dependency_self`);
  const capabilities = Array.isArray(node.required_capabilities) ? node.required_capabilities : [];
  if (capabilities.length > 16) fail(`node_${index}_capabilities_invalid`);
  const requiredCapabilities = capabilities.map((item, capIndex) => {
    if (typeof item !== 'string') fail(`node_${index}_capability_${capIndex}_invalid`);
    return boundedString(item, `node_${index}_capability`, 120);
  });
  const constraintsInput = Array.isArray(node.constraints) ? node.constraints : [];
  if (constraintsInput.length > 32) fail(`node_${index}_constraints_invalid`);
  const constraints = constraintsInput.map((item, constraintIndex) => {
    // String-only: an object item would be silently coerced by String() and
    // could smuggle structure past the scheduler-identity scan.
    if (typeof item !== 'string') fail(`node_${index}_constraint_${constraintIndex}_invalid`);
    return boundedString(item, `node_${index}_constraint`, 240);
  });
  let evidenceContract = null;
  if (node.evidence_contract != null) {
    if (typeof node.evidence_contract !== 'object' || Array.isArray(node.evidence_contract)) fail(`node_${index}_evidence_contract_invalid`);
    boundedJsonSize(node.evidence_contract, 4096, `node_${index}_evidence_contract`);
    evidenceContract = node.evidence_contract;
  }
  return {
    point_id: pointId,
    role,
    objective,
    base_sha: authority.baseline_sha,
    source_branch: sourceBranch,
    target_branch: targetBranch,
    priority,
    risk: riskRaw,
    dependencies: deps,
    required_capabilities: requiredCapabilities,
    constraints,
    deliverable,
    ...(evidenceContract ? { evidence_contract: evidenceContract } : {}),
  };
}

// Kahn topological check — a cyclic plan would strand every node in
// dependenciesVerified() == false and the frontier would be forever empty;
// rejecting cycles at compile time keeps operator mistakes loud.
function assertAcyclic(nodes) {
  const byPoint = new Map(nodes.map((node) => [node.point_id, node]));
  const pending = new Map(nodes.map((node) => [node.point_id, node.dependencies.filter((dep) => byPoint.has(dep))]));
  const queue = nodes.filter((node) => (pending.get(node.point_id) || []).length === 0).map((node) => node.point_id);
  const ordered = [];
  while (queue.length) {
    const point = queue.shift();
    ordered.push(point);
    for (const [candidate, deps] of pending.entries()) {
      if (deps.includes(point)) {
        const next = deps.filter((dep) => dep !== point);
        pending.set(candidate, next);
        if (next.length === 0) queue.push(candidate);
      }
    }
  }
  if (ordered.length !== nodes.length) fail('dependencies_cyclic');
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!byPoint.has(dep)) fail(`dependency_unknown:${dep}`);
    }
  }
}

export function compileMetaObjectivePlan({ authority, planState, objective, nodes = null } = {}) {
  const auth = normalizeAuthority(authority);
  const current = currentGeneration(planState);
  const objectiveText = boundedString(objective, 'objective', 480);
  let compiledNodes;
  if (nodes == null) {
    const point = slugifyObjective(objectiveText);
    compiledNodes = [{
      point_id: point,
      role: 'IMPLEMENTER',
      objective: objectiveText,
      base_sha: auth.baseline_sha,
      source_branch: auth.integration_line,
      target_branch: '',
      priority: 50,
      risk: 'NORMAL',
      dependencies: [],
      required_capabilities: [],
      constraints: [],
      deliverable: objectiveText,
    }];
  } else {
    if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > META_OBJECTIVE_MAX_NODES) fail('nodes_invalid');
    compiledNodes = [];
    const known = new Set();
    for (let index = 0; index < nodes.length; index += 1) {
      const node = normalizeNodeInput(nodes[index], index, auth, known);
      known.add(node.point_id);
      compiledNodes.push(node);
    }
    assertAcyclic(compiledNodes);
  }
  const plan = {
    schema: META_OBJECTIVE_SCHEMA,
    plan_generation: current + 1,
    roadmap_id: auth.roadmap_id,
    active_milestone_key: auth.active_milestone_key,
    integration_line: auth.integration_line,
    baseline_sha: auth.baseline_sha,
    alignment_epoch: auth.alignment_epoch,
    objective: objectiveText,
    nodes: compiledNodes,
    task_content_authority: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    automatic_retry_allowed: false,
  };
  scanForbiddenKeys(plan);
  return Object.freeze({
    plan: Object.freeze(plan),
    expected_current_generation: current,
    point_ids: Object.freeze(compiledNodes.map((node) => node.point_id)),
  });
}
