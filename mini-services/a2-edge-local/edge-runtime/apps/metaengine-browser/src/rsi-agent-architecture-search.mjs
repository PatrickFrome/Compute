import crypto from 'node:crypto';

export const RSI_AGENT_ARCHITECTURE_GENOME_SCHEMA = 'metaengine.rsi.agent-architecture-genome.v1';
export const RSI_AGENT_ARCHITECTURE_MUTATION_PLAN_SCHEMA = 'metaengine.rsi.agent-architecture-mutation-plan.v1';
export const RSI_AGENT_ARCHITECTURE_TRIAGE_RECEIPT_SCHEMA = 'metaengine.rsi.agent-architecture-triage-receipt.v1';
export const RSI_AGENT_ARCHITECTURE_SEARCH_DECISION_SCHEMA = 'metaengine.rsi.agent-architecture-search-decision.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_NODES = 24;
const MAX_EDGES = 48;
const MAX_OPERATIONS = 32;
const MAX_EVIDENCE_REFS = 32;
const NODE_TYPES = new Set([
  'INPUT_CONTEXT',
  'RETRIEVE_VERIFIED_MEMORY',
  'PLAN',
  'MODEL_CALL',
  'REFLECT_STRUCTURED',
  'TOOL_POLICY',
  'VERIFY_LOCAL',
  'AGGREGATE',
  'OUTPUT',
]);
const MODEL_ROLES = new Set(['NONE', 'FAST', 'DEEP', 'DIVERSE']);
const CAPABILITY_CLASSES = new Set(['NONE', 'READ_ONLY', 'MUTATION_PROPOSAL']);
const MUTATION_TYPES = new Set(['ADD_NODE', 'REMOVE_NODE', 'MODIFY_NODE', 'ADD_EDGE', 'REMOVE_EDGE']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_arch_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_arch_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_arch_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_arch_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_arch_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_arch_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_arch_${label}_automatic_retry_invalid`);
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_arch_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_arch_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function normalizeNode(row) {
  if (!plainObject(row)) throw new Error('rsi_arch_node_invalid');
  const nodeId = boundedId(row.node_id, 'node_id');
  const type = String(row.type || '').toUpperCase();
  if (!NODE_TYPES.has(type)) throw new Error('rsi_arch_node_type_invalid');
  const modelRole = String(row.model_role || 'NONE').toUpperCase();
  if (!MODEL_ROLES.has(modelRole)) throw new Error('rsi_arch_model_role_invalid');
  const capabilityClass = String(row.capability_class || 'NONE').toUpperCase();
  if (!CAPABILITY_CLASSES.has(capabilityClass)) throw new Error('rsi_arch_capability_class_invalid');
  const promptDigest = row.prompt_digest == null ? null : exactDigest(row.prompt_digest, 'prompt');
  const maxIterations = positiveInt(row.max_iterations ?? 1, 'max_iterations', 8);

  if (type === 'MODEL_CALL' && modelRole === 'NONE') throw new Error('rsi_arch_model_call_role_required');
  if (type !== 'MODEL_CALL' && modelRole !== 'NONE') throw new Error('rsi_arch_model_role_forbidden');
  if (type === 'TOOL_POLICY' && capabilityClass === 'NONE') throw new Error('rsi_arch_tool_capability_required');
  if (type !== 'TOOL_POLICY' && capabilityClass !== 'NONE') throw new Error('rsi_arch_capability_class_forbidden');
  if (capabilityClass === 'MUTATION_PROPOSAL' && row.direct_tool_execution === true) throw new Error('rsi_arch_direct_tool_execution_forbidden');
  if (type === 'INPUT_CONTEXT' || type === 'OUTPUT') {
    if (promptDigest !== null || modelRole !== 'NONE' || capabilityClass !== 'NONE') throw new Error('rsi_arch_terminal_node_payload_forbidden');
  }

  return Object.freeze({
    node_id: nodeId,
    type,
    model_role: modelRole,
    capability_class: capabilityClass,
    prompt_digest: promptDigest,
    max_iterations: maxIterations,
    direct_tool_execution: false,
    arbitrary_eval_allowed: false,
    shell_allowed: false,
    secret_access_allowed: false,
    promotion_access_allowed: false,
    self_update_access_allowed: false,
  });
}

function normalizeEdge(row) {
  if (!plainObject(row)) throw new Error('rsi_arch_edge_invalid');
  return Object.freeze({
    from: boundedId(row.from, 'edge_from'),
    to: boundedId(row.to, 'edge_to'),
  });
}

function assertDag(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.node_id));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw new Error('rsi_arch_edge_binding_invalid');
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (visited !== ids.size) throw new Error('rsi_arch_cycle_forbidden');
}

function normalizeBudget(value) {
  if (!plainObject(value)) throw new Error('rsi_arch_budget_invalid');
  return Object.freeze({
    max_model_calls: positiveInt(value.max_model_calls, 'max_model_calls', 128),
    max_total_tokens: positiveInt(value.max_total_tokens, 'max_total_tokens', 2_000_000),
    max_parallelism: positiveInt(value.max_parallelism, 'max_parallelism', 32),
    max_wall_time_ms: positiveInt(value.max_wall_time_ms, 'max_wall_time_ms', 3_600_000),
  });
}

export function createRsiAgentArchitectureGenome({
  genome_id,
  parent_genome_digest = null,
  nodes,
  edges,
  budget,
  external_builder = false,
  authored_by_candidate = true,
} = {}) {
  if (external_builder !== true || authored_by_candidate !== false) throw new Error('rsi_arch_genome_external_origin_required');
  if (!Array.isArray(nodes) || nodes.length < 3 || nodes.length > MAX_NODES) throw new Error('rsi_arch_nodes_invalid');
  if (!Array.isArray(edges) || edges.length < 2 || edges.length > MAX_EDGES) throw new Error('rsi_arch_edges_invalid');
  const normalizedNodes = nodes.map(normalizeNode);
  const nodeIds = new Set();
  for (const node of normalizedNodes) {
    if (nodeIds.has(node.node_id)) throw new Error('rsi_arch_node_duplicate');
    nodeIds.add(node.node_id);
  }
  const normalizedEdges = edges.map(normalizeEdge);
  const edgeKeys = new Set();
  for (const edge of normalizedEdges) {
    const key = `${edge.from}->${edge.to}`;
    if (edgeKeys.has(key)) throw new Error('rsi_arch_edge_duplicate');
    edgeKeys.add(key);
  }
  assertDag(normalizedNodes, normalizedEdges);
  if (normalizedNodes.filter((node) => node.type === 'INPUT_CONTEXT').length !== 1) throw new Error('rsi_arch_input_count_invalid');
  if (normalizedNodes.filter((node) => node.type === 'OUTPUT').length !== 1) throw new Error('rsi_arch_output_count_invalid');

  const core = {
    schema: RSI_AGENT_ARCHITECTURE_GENOME_SCHEMA,
    version: 1,
    genome_id: boundedId(genome_id, 'genome_id'),
    parent_genome_digest: parent_genome_digest == null ? null : exactDigest(parent_genome_digest, 'parent_genome'),
    nodes: normalizedNodes.sort((a, b) => a.node_id.localeCompare(b.node_id)),
    edges: normalizedEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    budget: normalizeBudget(budget),
    representation: 'TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION',
    architecture_mutation_surface: 'PROMPTS_ROUTING_MEMORY_TOOLS_ORCHESTRATION',
    evaluator_root_mutable: false,
    promotion_root_mutable: false,
    scheduler_authority_mutable: false,
    signing_root_mutable: false,
    self_update_root_mutable: false,
    arbitrary_code_execution_surface: false,
    candidate_can_modify_meta_search_policy: false,
    external_builder: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, genome_digest: digest(core) });
}

export function verifyRsiAgentArchitectureGenome(genome) {
  if (!plainObject(genome) || genome.schema !== RSI_AGENT_ARCHITECTURE_GENOME_SCHEMA || genome.version !== 1) throw new Error('rsi_arch_genome_invalid');
  assertZeroAuthority(genome, 'genome');
  if (
    genome.representation !== 'TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION'
    || genome.architecture_mutation_surface !== 'PROMPTS_ROUTING_MEMORY_TOOLS_ORCHESTRATION'
    || genome.evaluator_root_mutable !== false
    || genome.promotion_root_mutable !== false
    || genome.scheduler_authority_mutable !== false
    || genome.signing_root_mutable !== false
    || genome.self_update_root_mutable !== false
    || genome.arbitrary_code_execution_surface !== false
    || genome.candidate_can_modify_meta_search_policy !== false
    || genome.external_builder !== true
    || genome.authored_by_candidate !== false
  ) throw new Error('rsi_arch_genome_policy_invalid');
  const canonical = createRsiAgentArchitectureGenome({
    genome_id: genome.genome_id,
    parent_genome_digest: genome.parent_genome_digest,
    nodes: genome.nodes,
    edges: genome.edges,
    budget: genome.budget,
    external_builder: true,
    authored_by_candidate: false,
  });
  if (canonical.genome_digest !== exactDigest(genome.genome_digest, 'genome')) throw new Error('rsi_arch_genome_digest_mismatch');
  return canonical;
}

function normalizeMutationOperation(row) {
  if (!plainObject(row)) throw new Error('rsi_arch_mutation_operation_invalid');
  const type = String(row.type || '').toUpperCase();
  if (!MUTATION_TYPES.has(type)) throw new Error('rsi_arch_mutation_type_invalid');
  const targetId = boundedId(row.target_id, 'mutation_target');
  const payloadDigest = row.payload_digest == null ? null : exactDigest(row.payload_digest, 'mutation_payload');
  if (['ADD_NODE','MODIFY_NODE','ADD_EDGE'].includes(type) && payloadDigest == null) throw new Error('rsi_arch_mutation_payload_required');
  if (['REMOVE_NODE','REMOVE_EDGE'].includes(type) && payloadDigest != null) throw new Error('rsi_arch_mutation_payload_forbidden');
  return Object.freeze({
    type,
    target_id: targetId,
    payload_digest: payloadDigest,
  });
}

export function createRsiAgentArchitectureMutationPlan({
  parent_genome,
  generation,
  operations,
  proposal_model_family,
  external_meta_agent = false,
  authored_by_candidate = true,
} = {}) {
  const parent = verifyRsiAgentArchitectureGenome(parent_genome);
  if (external_meta_agent !== true || authored_by_candidate !== false) throw new Error('rsi_arch_mutation_external_origin_required');
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_OPERATIONS) throw new Error('rsi_arch_mutation_operations_invalid');
  const normalizedOperations = operations.map(normalizeMutationOperation);
  const core = {
    schema: RSI_AGENT_ARCHITECTURE_MUTATION_PLAN_SCHEMA,
    version: 1,
    parent_genome_id: parent.genome_id,
    parent_genome_digest: parent.genome_digest,
    generation: positiveInt(generation, 'generation', 1_000_000),
    operations: normalizedOperations,
    proposal_model_family: boundedId(proposal_model_family, 'proposal_model_family'),
    external_meta_agent: true,
    authored_by_candidate: false,
    plan_is_materialization_authority: false,
    plan_is_evaluation_authority: false,
    plan_is_promotion_authority: false,
    evaluator_root_mutation_allowed: false,
    promotion_root_mutation_allowed: false,
    scheduler_authority_mutation_allowed: false,
    signing_root_mutation_allowed: false,
    self_update_root_mutation_allowed: false,
    arbitrary_code_execution_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({
    ...core,
    plan_id: `rsi_arch_mutation_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiAgentArchitectureMutationPlan(plan, parentGenome) {
  const parent = verifyRsiAgentArchitectureGenome(parentGenome);
  if (!plainObject(plan) || plan.schema !== RSI_AGENT_ARCHITECTURE_MUTATION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_arch_mutation_plan_invalid');
  assertZeroAuthority(plan, 'mutation_plan');
  if (
    plan.parent_genome_digest !== parent.genome_digest
    || plan.plan_is_materialization_authority !== false
    || plan.plan_is_evaluation_authority !== false
    || plan.plan_is_promotion_authority !== false
    || plan.evaluator_root_mutation_allowed !== false
    || plan.promotion_root_mutation_allowed !== false
    || plan.scheduler_authority_mutation_allowed !== false
    || plan.signing_root_mutation_allowed !== false
    || plan.self_update_root_mutation_allowed !== false
    || plan.arbitrary_code_execution_allowed !== false
    || plan.external_meta_agent !== true
    || plan.authored_by_candidate !== false
  ) throw new Error('rsi_arch_mutation_plan_policy_invalid');
  if (!Array.isArray(plan.operations) || plan.operations.length < 1 || plan.operations.length > MAX_OPERATIONS) throw new Error('rsi_arch_mutation_plan_operations_invalid');
  plan.operations.forEach(normalizeMutationOperation);
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_arch_mutation_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) throw new Error('rsi_arch_mutation_plan_digest_mismatch');
  return plan;
}

export function createRsiAgentArchitectureTriageReceipt({
  genome,
  structural_novelty_score,
  cheap_judge_score,
  estimated_eval_cost,
  evidence_digest,
  evidence_refs,
  external_triage_judge = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiAgentArchitectureGenome(genome);
  if (external_triage_judge !== true || authored_by_candidate !== false) throw new Error('rsi_arch_triage_external_origin_required');
  const cost = normalizeBudget(estimated_eval_cost);
  const core = {
    schema: RSI_AGENT_ARCHITECTURE_TRIAGE_RECEIPT_SCHEMA,
    version: 1,
    genome_id: checked.genome_id,
    genome_digest: checked.genome_digest,
    structural_novelty_score: unitInterval(structural_novelty_score, 'structural_novelty_score'),
    cheap_judge_score: unitInterval(cheap_judge_score, 'cheap_judge_score'),
    estimated_eval_cost: cost,
    evidence_digest: exactDigest(evidence_digest, 'triage_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_triage_judge: true,
    authored_by_candidate: false,
    llm_judge_is_full_evaluator: false,
    llm_judge_is_promotion_authority: false,
    cheap_signal_only: true,
    full_benchmark_still_required: true,
    exploration_escape_hatch_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, triage_digest: digest(core) });
}

export function verifyRsiAgentArchitectureTriageReceipt(receipt, genome) {
  const checked = verifyRsiAgentArchitectureGenome(genome);
  if (!plainObject(receipt) || receipt.schema !== RSI_AGENT_ARCHITECTURE_TRIAGE_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_arch_triage_invalid');
  assertZeroAuthority(receipt, 'triage');
  if (
    receipt.genome_digest !== checked.genome_digest
    || receipt.external_triage_judge !== true
    || receipt.authored_by_candidate !== false
    || receipt.llm_judge_is_full_evaluator !== false
    || receipt.llm_judge_is_promotion_authority !== false
    || receipt.cheap_signal_only !== true
    || receipt.full_benchmark_still_required !== true
    || receipt.exploration_escape_hatch_required !== true
  ) throw new Error('rsi_arch_triage_policy_invalid');
  const canonical = createRsiAgentArchitectureTriageReceipt({
    genome: checked,
    structural_novelty_score: receipt.structural_novelty_score,
    cheap_judge_score: receipt.cheap_judge_score,
    estimated_eval_cost: receipt.estimated_eval_cost,
    evidence_digest: receipt.evidence_digest,
    evidence_refs: receipt.evidence_refs,
    external_triage_judge: true,
    authored_by_candidate: false,
  });
  if (canonical.triage_digest !== exactDigest(receipt.triage_digest, 'triage')) throw new Error('rsi_arch_triage_digest_mismatch');
  return canonical;
}

function costScalar(cost) {
  return (
    cost.max_model_calls
    + cost.max_total_tokens / 10_000
    + cost.max_parallelism * 2
    + cost.max_wall_time_ms / 10_000
  );
}

function dominates(left, right) {
  const leftCost = costScalar(left.estimated_eval_cost);
  const rightCost = costScalar(right.estimated_eval_cost);
  const noWorse = left.cheap_judge_score >= right.cheap_judge_score && leftCost <= rightCost;
  const strictlyBetter = left.cheap_judge_score > right.cheap_judge_score || leftCost < rightCost;
  return noWorse && strictlyBetter;
}

function paretoFront(receipts) {
  return receipts.filter((row, index) => !receipts.some((other, otherIndex) => otherIndex !== index && dominates(other, row)));
}

function deterministicTie(seed, receipt) {
  return crypto.createHash('sha256').update(`${seed}:${receipt.genome_digest}`, 'utf8').digest('hex');
}

export function selectRsiArchitecturesForFullEvaluation({
  candidates,
  full_eval_slots,
  exploration_slots = 1,
  search_round_id,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 256) throw new Error('rsi_arch_search_candidates_invalid');
  const slots = positiveInt(full_eval_slots, 'full_eval_slots', 64);
  const exploreSlots = nonNegativeInt(exploration_slots, 'exploration_slots', slots);
  if (exploreSlots > slots) throw new Error('rsi_arch_exploration_slots_invalid');
  const roundId = boundedId(search_round_id, 'search_round_id');
  const normalized = candidates.map((row) => {
    if (!plainObject(row)) throw new Error('rsi_arch_search_candidate_invalid');
    const genome = verifyRsiAgentArchitectureGenome(row.genome);
    const triage = verifyRsiAgentArchitectureTriageReceipt(row.triage_receipt, genome);
    return Object.freeze({ genome, triage });
  });

  const unique = new Set();
  for (const row of normalized) {
    if (unique.has(row.genome.genome_digest)) throw new Error('rsi_arch_search_candidate_duplicate');
    unique.add(row.genome.genome_digest);
  }

  const seed = digest({
    search_round_id: roundId,
    candidates: normalized.map((row) => row.genome.genome_digest).sort(),
    full_eval_slots: slots,
    exploration_slots: exploreSlots,
  });
  const front = paretoFront(normalized.map((row) => row.triage));
  const frontDigests = new Set(front.map((row) => row.genome_digest));
  const byDigest = new Map(normalized.map((row) => [row.genome.genome_digest, row]));

  const exploitCount = Math.max(0, slots - exploreSlots);
  const exploit = normalized
    .filter((row) => frontDigests.has(row.genome.genome_digest))
    .sort((a, b) => (
      b.triage.cheap_judge_score - a.triage.cheap_judge_score
      || a.triage.estimated_eval_cost.max_total_tokens - b.triage.estimated_eval_cost.max_total_tokens
      || deterministicTie(seed, a.triage).localeCompare(deterministicTie(seed, b.triage))
    ))
    .slice(0, exploitCount);

  const selectedDigests = new Set(exploit.map((row) => row.genome.genome_digest));
  const exploration = normalized
    .filter((row) => !selectedDigests.has(row.genome.genome_digest))
    .sort((a, b) => (
      b.triage.structural_novelty_score - a.triage.structural_novelty_score
      || a.triage.cheap_judge_score - b.triage.cheap_judge_score
      || deterministicTie(seed, a.triage).localeCompare(deterministicTie(seed, b.triage))
    ))
    .slice(0, exploreSlots);

  for (const row of exploration) selectedDigests.add(row.genome.genome_digest);
  if (selectedDigests.size < Math.min(slots, normalized.length)) {
    const remainder = normalized
      .filter((row) => !selectedDigests.has(row.genome.genome_digest))
      .sort((a, b) => b.triage.cheap_judge_score - a.triage.cheap_judge_score || deterministicTie(seed, a.triage).localeCompare(deterministicTie(seed, b.triage)));
    for (const row of remainder) {
      if (selectedDigests.size >= Math.min(slots, normalized.length)) break;
      selectedDigests.add(row.genome.genome_digest);
    }
  }

  const decisions = normalized.map((row) => {
    const selected = selectedDigests.has(row.genome.genome_digest);
    const isExploration = exploration.some((candidate) => candidate.genome.genome_digest === row.genome.genome_digest);
    const isPareto = frontDigests.has(row.genome.genome_digest);
    return Object.freeze({
      genome_id: row.genome.genome_id,
      genome_digest: row.genome.genome_digest,
      triage_digest: row.triage.triage_digest,
      pareto_front: isPareto,
      exploration_slot: isExploration,
      state: selected ? 'ADMIT_FULL_EXTERNAL_EVALUATION' : 'DEFER_FULL_EVALUATION',
      eligible_for_full_external_evaluation: selected,
      cheap_judge_final_verdict: false,
      full_benchmark_required_before_archive_admission: true,
      full_benchmark_required_before_promotion_review: true,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  });

  const core = {
    schema: RSI_AGENT_ARCHITECTURE_SEARCH_DECISION_SCHEMA,
    version: 1,
    search_round_id: roundId,
    seed_digest: seed,
    candidate_count: normalized.length,
    full_eval_slots: slots,
    exploration_slots: exploreSlots,
    decisions,
    pareto_cost_quality_search: true,
    cheap_judge_triage_only: true,
    exploration_escape_hatch_active: exploreSlots > 0,
    full_benchmark_required: true,
    evaluator_root_external_and_immutable: true,
    meta_search_policy_mutable_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, decision_digest: digest(core) });
}

export function verifyRsiArchitectureSearchDecision(decision) {
  if (!plainObject(decision) || decision.schema !== RSI_AGENT_ARCHITECTURE_SEARCH_DECISION_SCHEMA || decision.version !== 1) throw new Error('rsi_arch_search_decision_invalid');
  assertZeroAuthority(decision, 'search_decision');
  if (
    decision.pareto_cost_quality_search !== true
    || decision.cheap_judge_triage_only !== true
    || decision.full_benchmark_required !== true
    || decision.evaluator_root_external_and_immutable !== true
    || decision.meta_search_policy_mutable_by_candidate !== false
  ) throw new Error('rsi_arch_search_decision_policy_invalid');
  if (!Array.isArray(decision.decisions) || decision.decisions.length !== decision.candidate_count) throw new Error('rsi_arch_search_decision_count_invalid');
  for (const row of decision.decisions) {
    assertZeroAuthority(row, 'search_decision_row');
    if (
      row.cheap_judge_final_verdict !== false
      || row.full_benchmark_required_before_archive_admission !== true
      || row.full_benchmark_required_before_promotion_review !== true
      || row.eligible_for_full_external_evaluation !== (row.state === 'ADMIT_FULL_EXTERNAL_EVALUATION')
    ) throw new Error('rsi_arch_search_decision_row_policy_invalid');
  }
  const clone = structuredClone(decision);
  delete clone.decision_digest;
  if (exactDigest(decision.decision_digest, 'search_decision') !== digest(clone)) throw new Error('rsi_arch_search_decision_digest_mismatch');
  return decision;
}

export function rsiAgentArchitectureSearchTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.agent-architecture-search-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-agent-architecture-search.mjs',
    node_types: [...NODE_TYPES].sort(),
    model_roles: [...MODEL_ROLES].sort(),
    capability_classes: [...CAPABILITY_CLASSES].sort(),
    mutation_types: [...MUTATION_TYPES].sort(),
    representation: 'TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION',
    search_space: 'PROMPTS_ROUTING_MEMORY_TOOLS_ORCHESTRATION',
    pareto_cost_quality_search: true,
    cheap_judge_triage_only: true,
    exploration_escape_hatch_required: true,
    full_external_evaluation_required: true,
    evaluator_root_mutable: false,
    promotion_root_mutable: false,
    scheduler_authority_mutable: false,
    signing_root_mutable: false,
    self_update_root_mutable: false,
    meta_search_policy_mutable_by_candidate: false,
    arbitrary_code_execution_surface: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, architecture_root_digest: digest(root) });
}
