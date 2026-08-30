const IMPLEMENTATION_ROLES = new Set(['ARCHITECT','IMPLEMENTER','TESTER','FIXER']);
const COMPLEMENTARY_ROLES = new Set(['PLANNER','RESEARCHER','CRITIC','FALSIFIER','SYNTHESIZER','REVIEWER','DIAGNOSTIC']);

function integer(value, fallback, min, max, name) {
  const out = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(out) || out < min || out > max) throw new Error(`autonomy_${name}_invalid`);
  return out;
}
function role(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(out)) throw new Error('autonomy_role_invalid');
  return out;
}
function point(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(out)) throw new Error('autonomy_point_id_invalid');
  return out;
}
function sha(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(out)) throw new Error('autonomy_base_sha_invalid');
  return out;
}
function gateSet(value) {
  return new Set((value || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
}
function gateDisabled(disabled, id) { return disabled.has('*') || disabled.has(id); }
function activeClaim(row, nowMs) {
  if (!row || !['ACTIVE','LEASED'].includes(String(row.status || '').toUpperCase())) return false;
  if (!row.expires_at) return true;
  const expiry = Date.parse(row.expires_at);
  return Number.isFinite(expiry) && expiry > nowMs;
}
function isImplementationRole(value) { return IMPLEMENTATION_ROLES.has(role(value)); }

export class AutonomyGovernor {
  #policy;
  #clock;

  constructor({ policy = {}, clock = () => Date.now() } = {}) {
    if (typeof clock !== 'function') throw new Error('autonomy_clock_invalid');
    this.#clock = clock;
    this.#policy = Object.freeze({
      max_parallel_agents: integer(policy.max_parallel_agents, 8, 1, 64, 'max_parallel_agents'),
      max_children_per_agent: integer(policy.max_children_per_agent, 2, 0, 16, 'max_children_per_agent'),
      max_implementation_claims_per_point: integer(policy.max_implementation_claims_per_point, 1, 1, 8, 'max_implementation_claims_per_point'),
      ambiguous_effects_consume_capacity: policy.ambiguous_effects_consume_capacity !== false,
    });
  }

  snapshot({ agents = [], claims = [], disabled_gates = [] } = {}) {
    const nowMs = this.#clock();
    const disabled = gateSet(disabled_gates);
    const activeAgents = agents.filter((row) => !['LOST','RETIRED'].includes(String(row?.lifecycle_state || row?.status || '').toUpperCase()));
    const ambiguousAgents = agents.filter((row) => String(row?.lifecycle_state || row?.status || '').toUpperCase().includes('AMBIGUOUS'));
    const activeClaims = claims.filter((row) => activeClaim(row, nowMs));
    const ambiguousCapacity = this.#policy.ambiguous_effects_consume_capacity && !gateDisabled(disabled, 'autonomy.ambiguous_capacity')
      ? ambiguousAgents.length : 0;
    return Object.freeze({
      schema: 'metaengine.autonomy-governor.snapshot.v1',
      policy: { ...this.#policy },
      active_agents: activeAgents.length,
      ambiguous_agents: ambiguousAgents.length,
      effective_capacity_used: activeAgents.length + ambiguousCapacity,
      active_claims: activeClaims.length,
      disabled_gates: [...disabled],
      task_content_authority: false,
      browser_authority: false,
      authority_effect: false,
    });
  }

  evaluateSpawn({ parent_agent_id = null, agents = [], claims = [], disabled_gates = [] } = {}) {
    const disabled = gateSet(disabled_gates);
    const snap = this.snapshot({ agents, claims, disabled_gates });
    if (!gateDisabled(disabled, 'autonomy.max_fanout') && snap.effective_capacity_used >= this.#policy.max_parallel_agents) {
      return this.#deny('MAX_PARALLEL_AGENTS', { capacity_used: snap.effective_capacity_used });
    }
    if (parent_agent_id && !gateDisabled(disabled, 'autonomy.child_fanout')) {
      const parent = String(parent_agent_id);
      const children = agents.filter((row) => String(row?.parent_agent_id || '') === parent && !['LOST','RETIRED'].includes(String(row?.lifecycle_state || row?.status || '').toUpperCase())).length;
      if (children >= this.#policy.max_children_per_agent) return this.#deny('MAX_CHILDREN_PER_AGENT', { children });
    }
    return this.#allow('SPAWN_ALLOWED');
  }

  evaluateClaim({ candidate, claims = [], disabled_gates = [] } = {}) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('autonomy_candidate_claim_invalid');
    const disabled = gateSet(disabled_gates);
    const pointId = point(candidate.point_id);
    const baseSha = sha(candidate.base_sha);
    const candidateRole = role(candidate.role);
    const agentId = String(candidate.agent_id || '').trim().toLowerCase();
    if (!/^agent_[a-z0-9-]{8,64}$/.test(agentId)) throw new Error('autonomy_agent_id_invalid');
    const nowMs = this.#clock();
    const overlapping = claims.filter((row) => activeClaim(row, nowMs) && String(row.point_id || '').toLowerCase() === pointId);
    const staleBase = overlapping.find((row) => String(row.base_sha || '').toLowerCase() !== baseSha);
    if (staleBase && !gateDisabled(disabled, 'autonomy.base_sha_conflict')) {
      return this.#deny('POINT_BASE_SHA_CONFLICT', { conflicting_claim_id: staleBase.claim_id || null });
    }

    if (isImplementationRole(candidateRole) && !gateDisabled(disabled, 'autonomy.overlapping_implementation_claim')) {
      const competing = overlapping.filter((row) => {
        try { return isImplementationRole(row.role) && String(row.agent_id || '').toLowerCase() !== agentId; }
        catch { return false; }
      });
      if (competing.length >= this.#policy.max_implementation_claims_per_point) {
        return this.#deny('IMPLEMENTATION_POINT_ALREADY_CLAIMED', {
          competing_claim_ids: competing.map((row) => row.claim_id || null).filter(Boolean),
        });
      }
    }

    return this.#allow(COMPLEMENTARY_ROLES.has(candidateRole) ? 'COMPLEMENTARY_PARALLEL_CLAIM' : 'CLAIM_ALLOWED', {
      point_id: pointId,
      base_sha: baseSha,
      role: candidateRole,
    });
  }

  #allow(reason, extra = {}) {
    return Object.freeze({ schema:'metaengine.autonomy-governor.decision.v1', allowed:true, reason, ...extra, task_content_authority:false, authority_effect:false });
  }
  #deny(reason, extra = {}) {
    return Object.freeze({ schema:'metaengine.autonomy-governor.decision.v1', allowed:false, reason, ...extra, task_content_authority:false, authority_effect:false });
  }
}

export const AUTONOMY_GOVERNOR_GATES = Object.freeze([
  'autonomy.max_fanout',
  'autonomy.child_fanout',
  'autonomy.ambiguous_capacity',
  'autonomy.overlapping_implementation_claim',
  'autonomy.base_sha_conflict',
]);
