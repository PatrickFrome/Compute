import { sha256 } from './security.mjs';
import { canonicalJson } from './supervisor-advisory.mjs';

export const MULTI_GATEWAY_ROUTE_PLAN_SCHEMA = 'metaengine.multi-gateway.route-plan.v1';

const STRATEGIES = new Set(['STRUCTURED', 'DIVERSE_ADVISORY', 'TIEBREAK', 'QUALIFICATION']);
const GATEWAY_PLANES = new Set([
  'VERCEL_AI_GATEWAY',
  'VERCEL_LIVE_PEER_PROJECT',
  'SUPABASE_LIVE_PEER_BROKER',
  'SUPABASE_PEER_DECISION',
  'GITHUB_MODELS_PROBE',
  'CLOUDFLARE_WORKERS_AI_PROBE',
  'LOCAL_OPEN_MODEL_PROBE'
]);
const TRANSPORTS = new Set([
  'OPENAI_COMPAT_HTTP',
  'SUPABASE_EDGE_HTTP',
  'VERCEL_FUNCTION_HTTP',
  'PROVIDER_NATIVE_HTTP',
  'LOCAL_PROCESS'
]);
const EVIDENCE_TRUST_STATES = new Set([
  'SELF_REPORTED',
  'HASH_BOUND_ADVISORY_UNATTESTED',
  'PERSISTED_READBACK_VERIFIED',
  'SIGNED_ATTESTED'
]);
const ROUTING_TRUST_STATES = new Set(['PERSISTED_READBACK_VERIFIED', 'SIGNED_ATTESTED']);
const DATA_POLICY = 'PUBLIC_OR_NON_SENSITIVE_ONLY';

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function text(value, code, max = 192) {
  if (typeof value !== 'string') throw new Error(code);
  const out = value.trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) throw new Error(code);
  return out;
}

function enumValue(value, allowed, code) {
  const out = text(value, code, 96).toUpperCase();
  if (!allowed.has(out)) throw new Error(code);
  return out;
}

function iso(value, code) {
  const out = text(value, code, 64);
  const ms = Date.parse(out);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== out) throw new Error(code);
  return { text: out, ms };
}

function digest(value, code) {
  const out = text(value, code, 71).toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(out)) throw new Error(code);
  return out;
}

function normalizeRail(input, nowMs, freshnessMs) {
  object(input, 'multi_gateway_rail_invalid');
  const observed = iso(input.observed_at, 'multi_gateway_rail_observed_at_invalid');
  const ageMs = nowMs - observed.ms;
  if (ageMs < 0) throw new Error('multi_gateway_rail_observation_from_future');
  const latency = input.latency_ms == null ? null : Number(input.latency_ms);
  if (latency !== null && (!Number.isSafeInteger(latency) || latency < 0 || latency > 3_600_000)) throw new Error('multi_gateway_rail_latency_invalid');
  if (input.data_policy !== DATA_POLICY) throw new Error('multi_gateway_rail_data_policy_invalid');
  if (typeof input.tariff_dependency !== 'boolean') throw new Error('multi_gateway_rail_tariff_dependency_invalid');
  const qualification = object(input.qualification, 'multi_gateway_rail_qualification_invalid');
  for (const key of ['transport_verified', 'quality_verified', 'structured_verified', 'quorum_eligible']) {
    if (typeof qualification[key] !== 'boolean') throw new Error(`multi_gateway_rail_${key}_invalid`);
  }
  const trustState = enumValue(qualification.evidence_trust_state, EVIDENCE_TRUST_STATES, 'multi_gateway_rail_evidence_trust_invalid');
  const evidenceSource = text(qualification.evidence_source, 'multi_gateway_rail_evidence_source_invalid', 192);
  if (typeof input.available !== 'boolean') throw new Error('multi_gateway_rail_available_invalid');
  const models = Array.isArray(input.models) ? input.models.map((model) => text(model, 'multi_gateway_rail_model_invalid', 160)) : [];
  if (models.length > 16 || new Set(models).size !== models.length) throw new Error('multi_gateway_rail_models_invalid');
  return {
    rail_id: text(input.rail_id, 'multi_gateway_rail_id_invalid', 160),
    gateway_plane: enumValue(input.gateway_plane, GATEWAY_PLANES, 'multi_gateway_rail_gateway_plane_invalid'),
    route_id: text(input.route_id, 'multi_gateway_rail_route_id_invalid', 256),
    transport: enumValue(input.transport, TRANSPORTS, 'multi_gateway_rail_transport_invalid'),
    failure_domain: text(input.failure_domain, 'multi_gateway_rail_failure_domain_invalid', 160),
    models,
    available: input.available,
    observed_at: observed.text,
    fresh: ageMs <= freshnessMs,
    age_ms: ageMs,
    latency_ms: latency,
    qualification: {
      transport_verified: qualification.transport_verified,
      quality_verified: qualification.quality_verified,
      structured_verified: qualification.structured_verified,
      quorum_eligible: qualification.quorum_eligible,
      evidence_trust_state: trustState,
      evidence_source: evidenceSource
    },
    evidence_sha256: digest(input.evidence_sha256, 'multi_gateway_rail_evidence_hash_invalid'),
    tariff_dependency: input.tariff_dependency,
    data_policy: DATA_POLICY
  };
}

function eligibility(rail, strategy, excludedDomains) {
  if (!rail.fresh) return 'STALE_EVIDENCE';
  if (!rail.available) return 'UNAVAILABLE';
  if (!rail.qualification.transport_verified) return 'TRANSPORT_UNQUALIFIED';
  if (strategy === 'QUALIFICATION') return null;
  if (!ROUTING_TRUST_STATES.has(rail.qualification.evidence_trust_state)) return 'QUALIFICATION_EVIDENCE_UNTRUSTED';
  if (!rail.qualification.quality_verified) return 'QUALITY_UNQUALIFIED';
  if ((strategy === 'DIVERSE_ADVISORY' || strategy === 'TIEBREAK') && !rail.qualification.quorum_eligible) return 'QUORUM_INELIGIBLE';
  if (strategy === 'STRUCTURED' && !rail.qualification.structured_verified) return 'STRUCTURED_UNQUALIFIED';
  if (strategy === 'TIEBREAK' && excludedDomains.has(rail.failure_domain)) return 'FAILURE_DOMAIN_NOT_INDEPENDENT';
  return null;
}

function compareRails(a, b) {
  if (a.tariff_dependency !== b.tariff_dependency) return a.tariff_dependency ? 1 : -1;
  const al = a.latency_ms ?? Number.MAX_SAFE_INTEGER;
  const bl = b.latency_ms ?? Number.MAX_SAFE_INTEGER;
  if (al !== bl) return al - bl;
  return a.rail_id.localeCompare(b.rail_id);
}

function selectedSummary(rail, role) {
  return {
    role,
    rail_id: rail.rail_id,
    gateway_plane: rail.gateway_plane,
    route_id: rail.route_id,
    transport: rail.transport,
    failure_domain: rail.failure_domain,
    models: rail.models,
    evidence_sha256: rail.evidence_sha256,
    evidence_trust_state: rail.qualification.evidence_trust_state,
    evidence_source: rail.qualification.evidence_source,
    tariff_dependency: rail.tariff_dependency,
    observed_at: rail.observed_at,
    latency_ms: rail.latency_ms
  };
}

export function createMultiGatewayRoutePlan({
  task_id,
  strategy,
  now,
  rails,
  freshness_seconds = 3600,
  excluded_failure_domains = []
} = {}) {
  const taskId = text(task_id, 'multi_gateway_task_id_invalid', 160);
  const normalizedStrategy = enumValue(strategy, STRATEGIES, 'multi_gateway_strategy_invalid');
  const nowIso = iso(now, 'multi_gateway_now_invalid');
  const freshness = Number(freshness_seconds);
  if (!Number.isSafeInteger(freshness) || freshness < 30 || freshness > 86400) throw new Error('multi_gateway_freshness_invalid');
  if (!Array.isArray(rails) || rails.length < 1 || rails.length > 32) throw new Error('multi_gateway_rails_invalid');
  if (!Array.isArray(excluded_failure_domains) || excluded_failure_domains.length > 16) throw new Error('multi_gateway_excluded_domains_invalid');
  const excludedDomains = new Set(excluded_failure_domains.map((value) => text(value, 'multi_gateway_excluded_domain_invalid', 160)));
  const normalized = rails.map((rail) => normalizeRail(rail, nowIso.ms, freshness * 1000));
  if (new Set(normalized.map((rail) => rail.rail_id)).size !== normalized.length) throw new Error('multi_gateway_duplicate_rail_id');

  const excluded = [];
  const eligible = [];
  for (const rail of normalized) {
    const reason = eligibility(rail, normalizedStrategy, excludedDomains);
    if (reason) excluded.push({ rail_id: rail.rail_id, reason, evidence_sha256: rail.evidence_sha256, evidence_trust_state: rail.qualification.evidence_trust_state });
    else eligible.push(rail);
  }
  eligible.sort(compareRails);

  const selected = [];
  if (normalizedStrategy === 'DIVERSE_ADVISORY') {
    const used = new Set();
    for (const rail of eligible) {
      if (used.has(rail.failure_domain)) continue;
      selected.push(selectedSummary(rail, selected.length < 2 ? 'PRIMARY' : 'BACKUP'));
      used.add(rail.failure_domain);
      if (selected.length === 3) break;
    }
    if (selected.length < 2) throw new Error('multi_gateway_diversity_quorum_unavailable');
  } else {
    if (eligible.length < 1) throw new Error('multi_gateway_no_eligible_rail');
    selected.push(selectedSummary(eligible[0], 'PRIMARY'));
    for (const rail of eligible.slice(1, 3)) selected.push(selectedSummary(rail, 'BACKUP'));
  }

  const core = {
    schema: MULTI_GATEWAY_ROUTE_PLAN_SCHEMA,
    task_id: taskId,
    strategy: normalizedStrategy,
    planned_at: nowIso.text,
    freshness_seconds: freshness,
    selected,
    excluded,
    semantics: {
      provider_internal_failover_is_nested_below_gateway_plane_routing: true,
      availability_is_not_quality: true,
      self_reported_quality_is_not_routing_authority: true,
      quality_routing_requires_persisted_or_attested_evidence: true,
      quorum_is_not_semantic_truth: true,
      routing_is_advisory_only: true,
      requires_supervisor_arbitration: true
    },
    policy: {
      data_policy: DATA_POLICY,
      confidential_data_supported: false,
      direct_action_allowed: false,
      browser_authority: false,
      development_authority: false,
      sandbox_execution_authority: false,
      promotion_authority: false,
      canonical: false,
      authority_effect: false
    },
    canonical: false,
    authority_effect: false
  };
  const planSha256 = sha256(canonicalJson(core));
  return Object.freeze({ ...core, plan_id: `multi_gateway_route_sha256_${planSha256}`, plan_sha256: planSha256 });
}
