// METAENGINE Hybrid Compute Fabric: read-only placement suggestions.
// This is NOT a scheduler, lease issuer, executor, remote transport or trust root.
const SCHEMA = 'metaengine.hybrid.placement.v1';
const HASH = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/;
const CAPABILITIES = new Set(['GIT_READ', 'TEST_RUN', 'DEV_BUILD', 'BROWSER_OBSERVE', 'GPU_COMPUTE', 'POSTGRES_READ']);
const DOMAINS = new Set(['LOCAL', 'CLOUD']);
const DATA_ZONES = new Set(['LOCAL_PRIVATE', 'PORTABLE', 'CLOUD_ONLY']);
const MAX_AGE_MS = 30_000;

function validInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function hold(reason, diagnostics = {}) {
  return Object.freeze({ schema: SCHEMA, state: 'HOLD', reason, authority_effect: false,
    dispatch_allowed: false, automatic_retry_allowed: false, ...diagnostics });
}
function nodeResult(reason) {
  return Object.freeze({ eligible: reason === null, reason });
}
function validCapabilities(value) {
  return Array.isArray(value) && value.length <= 16 &&
    new Set(value).size === value.length && value.every(item => CAPABILITIES.has(item));
}
export function classifyHybridNode(node, task, nowMs) {
  if (!node || typeof node !== 'object' || !ID.test(String(node.node_id || '')) ||
      !DOMAINS.has(node.domain) || !ID.test(String(node.incarnation_id || '')) ||
      !validInt(node.generation, 1) || !validInt(node.registry_generation, 1) ||
      !validInt(node.heartbeat_seq, 1) || !validInt(node.registry_min_seq, 0) ||
      !validInt(node.observed_at_ms) || !validInt(nowMs) || node.state !== 'READY' ||
      !HASH.test(String(node.source_sha || '')) || !validCapabilities(node.capabilities) ||
      !validInt(node.total_slots, 1, 4096) || !validInt(node.in_use_slots, 0, 4096) ||
      !validInt(node.cost_units, 0, 1_000_000) ||
      !validInt(node.latency_ms, 0, 600_000)) return nodeResult('NODE_INVALID');
  if (node.generation !== node.registry_generation ||
      node.heartbeat_seq < node.registry_min_seq) return nodeResult('NODE_GENERATION_OR_SEQUENCE_FENCED');
  if (node.observed_at_ms > nowMs || nowMs - node.observed_at_ms > MAX_AGE_MS) return nodeResult('NODE_STALE');
  if (node.source_sha !== task.source_sha) return nodeResult('SOURCE_SHA_MISMATCH');
  if (node.in_use_slots >= node.total_slots) return nodeResult('NO_FREE_SLOTS');
  if (task.data_zone === 'LOCAL_PRIVATE' && node.domain !== 'LOCAL') return nodeResult('PRIVATE_DATA_LOCAL_ONLY');
  if (task.data_zone === 'CLOUD_ONLY' && node.domain !== 'CLOUD') return nodeResult('CLOUD_ONLY_TASK');
  if (node.domain === 'CLOUD' && task.allow_cloud !== true) return nodeResult('CLOUD_NOT_AUTHORIZED');
  if (node.cost_units > task.max_cost_units) return nodeResult('COST_BUDGET_EXCEEDED');
  if (node.latency_ms > task.max_latency_ms) return nodeResult('LATENCY_BUDGET_EXCEEDED');
  if (!task.required_capabilities.every(cap => node.capabilities.includes(cap))) return nodeResult('CAPABILITY_MISSING');
  return nodeResult(null);
}
function validTask(task) {
  return task && task.schema === 'metaengine.hybrid.task-placement-intent.v1' &&
    ID.test(String(task.task_id || '')) && ID.test(String(task.workspace_id || '')) &&
    HASH.test(String(task.source_sha || '')) && DATA_ZONES.has(task.data_zone) &&
    ['READ_ONLY', 'MUTATING'].includes(task.effect_class) &&
    validCapabilities(task.required_capabilities) &&
    typeof task.allow_cloud === 'boolean' &&
    validInt(task.max_cost_units, 0, 1_000_000) &&
    validInt(task.max_latency_ms, 0, 600_000);
}
// The supplied snapshot must already be authenticated by the existing control plane;
// this pure module cannot establish whether its caller or observation is trusted.
// Even with a valid snapshot, placement cannot grant execution or lease authority.
export function proposeHybridPlacement({ task, snapshot, now_ms } = {}) {
  if (!validTask(task)) return hold('INVALID_TASK_INTENT');
  if (!snapshot || snapshot.schema !== 'metaengine.hybrid.registry-snapshot.v1' ||
      snapshot.workspace_id !== task.workspace_id ||
      snapshot.source_sha !== task.source_sha || snapshot.readback_source !== 'EXISTING_CONTROL_PLANE' ||
      !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 4096 || !validInt(now_ms)) {
    return hold('REGISTRY_SNAPSHOT_NOT_ADMITTED');
  }
  // An active mutation must first be admitted through the existing DB lease,
  // VEF and effect journal. This module never acquires or infers that lease.
  if (task.effect_class === 'MUTATING') return hold('MUTATION_REQUIRES_EXISTING_LEASE_AND_VEF');
  const seen = new Set();
  const eligible = [];
  const reasons = {};
  for (const node of snapshot.nodes) {
    const key = node && typeof node.node_id === 'string' ? node.node_id : null;
    if (key && seen.has(key)) return hold('DUPLICATE_NODE_ID');
    if (key) seen.add(key);
    const result = classifyHybridNode(node, task, now_ms);
    if (!result.eligible) reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    else eligible.push(node);
  }
  if (eligible.length === 0) return hold('NO_ELIGIBLE_NODE', { excluded: Object.freeze(reasons) });
  // Stable order reduces placement thrashing and ensures reproducible review.
  eligible.sort((a, b) => a.cost_units - b.cost_units ||
    a.latency_ms - b.latency_ms || (a.domain === 'LOCAL' ? -1 : 1) -
    (b.domain === 'LOCAL' ? -1 : 1) ||
    a.node_id.localeCompare(b.node_id, 'en'));
  const winner = eligible[0];
  return Object.freeze({
    schema: SCHEMA, state: 'PROPOSAL_ONLY', task_id: task.task_id,
    workspace_id: task.workspace_id, source_sha: task.source_sha,
    node_id: winner.node_id, node_domain: winner.domain,
    node_incarnation_id: winner.incarnation_id, node_generation: winner.generation,
    evidence_heartbeat_seq: winner.heartbeat_seq, considered_nodes: snapshot.nodes.length,
    excluded: Object.freeze(reasons), authority_effect: false,
    dispatch_allowed: false, automatic_retry_allowed: false,
  });
}
