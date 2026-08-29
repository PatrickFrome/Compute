import test from 'node:test';
import assert from 'node:assert/strict';
import { createMultiGatewayRoutePlan } from '../lib/multi-gateway-router.mjs';

const NOW = '2026-08-29T11:15:00.000Z';

function rail({
  rail_id,
  gateway_plane,
  route_id,
  transport,
  failure_domain,
  models,
  available = true,
  observed_at = '2026-08-29T11:14:00.000Z',
  latency_ms = 1000,
  transport_verified = true,
  quality_verified = true,
  structured_verified = true,
  quorum_eligible = true,
  evidence_trust_state = 'PERSISTED_READBACK_VERIFIED',
  evidence_source = 'SUPABASE_PERSISTED_READBACK',
  tariff_dependency = true,
  evidence = 'a'
}) {
  return {
    rail_id,
    gateway_plane,
    route_id,
    transport,
    failure_domain,
    models,
    available,
    observed_at,
    latency_ms,
    qualification: {
      transport_verified,
      quality_verified,
      structured_verified,
      quorum_eligible,
      evidence_trust_state,
      evidence_source
    },
    evidence_sha256: evidence.repeat(64),
    tariff_dependency,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY'
  };
}

const supabaseStructured = rail({
  rail_id: 'supabase-live-broker-structured',
  gateway_plane: 'SUPABASE_LIVE_PEER_BROKER',
  route_id: 'metaengine/structured-auto',
  transport: 'SUPABASE_EDGE_HTTP',
  failure_domain: 'supabase:hf-public-structured',
  models: ['gemma2', 'llama32'],
  latency_ms: 4200,
  evidence: '1'
});

const supabaseAdvisory = rail({
  rail_id: 'supabase-live-broker-advisory',
  gateway_plane: 'SUPABASE_LIVE_PEER_BROKER',
  route_id: 'metaengine/advisory',
  transport: 'SUPABASE_EDGE_HTTP',
  failure_domain: 'supabase:hf-public-advisory',
  models: ['gemma2', 'nemotron'],
  structured_verified: false,
  latency_ms: 3500,
  evidence: '2'
});

const vercelGatewayBlocked = rail({
  rail_id: 'vercel-ai-gateway-f1',
  gateway_plane: 'VERCEL_AI_GATEWAY',
  route_id: 'committee:free:v1',
  transport: 'OPENAI_COMPAT_HTTP',
  failure_domain: 'vercel:ai-gateway',
  models: ['minimax/minimax-m3-free'],
  available: false,
  transport_verified: false,
  quality_verified: false,
  structured_verified: false,
  quorum_eligible: false,
  evidence_trust_state: 'HASH_BOUND_ADVISORY_UNATTESTED',
  evidence_source: 'F1_GATEWAY_ADVISORY_ENVELOPE',
  latency_ms: null,
  evidence: '3'
});

const vercelDeploymentOnly = rail({
  rail_id: 'vercel-qwen-project',
  gateway_plane: 'VERCEL_LIVE_PEER_PROJECT',
  route_id: 'metaengine-qwen3-zero-peer',
  transport: 'VERCEL_FUNCTION_HTTP',
  failure_domain: 'vercel:qwen-project',
  models: ['qwen3'],
  available: true,
  transport_verified: false,
  quality_verified: false,
  structured_verified: false,
  quorum_eligible: false,
  evidence_trust_state: 'SELF_REPORTED',
  evidence_source: 'VERCEL_DEPLOYMENT_STATE_ONLY',
  evidence: '4'
});

const localQualified = rail({
  rail_id: 'local-qualified-open-model',
  gateway_plane: 'LOCAL_OPEN_MODEL_PROBE',
  route_id: 'local/structured-peer',
  transport: 'LOCAL_PROCESS',
  failure_domain: 'local:host-a',
  models: ['local/model'],
  latency_ms: 8000,
  evidence_trust_state: 'SIGNED_ATTESTED',
  evidence_source: 'LOCAL_EXECUTION_ATTESTATION',
  tariff_dependency: false,
  evidence: '5'
});

test('structured routing uses trusted qualification evidence and excludes deployment-only or blocked rails', () => {
  const plan = createMultiGatewayRoutePlan({
    task_id: 'task-structured-1',
    strategy: 'STRUCTURED',
    now: NOW,
    rails: [vercelGatewayBlocked, vercelDeploymentOnly, supabaseStructured]
  });
  assert.equal(plan.selected[0].rail_id, 'supabase-live-broker-structured');
  assert.equal(plan.selected[0].evidence_trust_state, 'PERSISTED_READBACK_VERIFIED');
  assert.deepEqual(plan.excluded.map((x) => x.reason).sort(), ['TRANSPORT_UNQUALIFIED', 'UNAVAILABLE']);
  assert.equal(plan.semantics.availability_is_not_quality, true);
  assert.equal(plan.semantics.quality_routing_requires_persisted_or_attested_evidence, true);
  assert.equal(plan.policy.direct_action_allowed, false);
  assert.equal(plan.policy.browser_authority, false);
});

test('remote zero-price rail remains tariff-dependent while attested local can rank ahead without gaining authority', () => {
  const plan = createMultiGatewayRoutePlan({
    task_id: 'task-structured-2',
    strategy: 'STRUCTURED',
    now: NOW,
    rails: [supabaseStructured, localQualified]
  });
  assert.equal(plan.selected[0].rail_id, 'local-qualified-open-model');
  assert.equal(plan.selected[0].evidence_trust_state, 'SIGNED_ATTESTED');
  assert.equal(plan.selected[0].tariff_dependency, false);
  assert.equal(plan.selected[1].tariff_dependency, true);
  assert.equal(plan.policy.promotion_authority, false);
  assert.equal(plan.authority_effect, false);
});

test('diverse advisory requires two independently trusted failure domains', () => {
  const otherDomain = rail({
    rail_id: 'vercel-qualified-advisory',
    gateway_plane: 'VERCEL_LIVE_PEER_PROJECT',
    route_id: 'qualified/advisory-peer',
    transport: 'VERCEL_FUNCTION_HTTP',
    failure_domain: 'vercel:qualified-peer',
    models: ['other/model'],
    structured_verified: false,
    evidence_trust_state: 'SIGNED_ATTESTED',
    evidence_source: 'VERCEL_PEER_ATTESTATION',
    latency_ms: 5000,
    evidence: '6'
  });
  const plan = createMultiGatewayRoutePlan({
    task_id: 'task-advisory-1',
    strategy: 'DIVERSE_ADVISORY',
    now: NOW,
    rails: [supabaseAdvisory, otherDomain]
  });
  assert.equal(plan.selected.length, 2);
  assert.notEqual(plan.selected[0].failure_domain, plan.selected[1].failure_domain);
  assert.equal(plan.semantics.quorum_is_not_semantic_truth, true);
  assert.equal(plan.semantics.requires_supervisor_arbitration, true);
});

test('two trusted rails in one failure domain cannot fake diversity quorum', () => {
  const sameDomain = rail({
    rail_id: 'supabase-second-advisory',
    gateway_plane: 'SUPABASE_PEER_DECISION',
    route_id: 'metaengine/tiebreak',
    transport: 'SUPABASE_EDGE_HTTP',
    failure_domain: supabaseAdvisory.failure_domain,
    models: ['llama32'],
    structured_verified: false,
    evidence: '7'
  });
  assert.throws(() => createMultiGatewayRoutePlan({
    task_id: 'task-advisory-2',
    strategy: 'DIVERSE_ADVISORY',
    now: NOW,
    rails: [supabaseAdvisory, sameDomain]
  }), /diversity_quorum_unavailable/);
});

test('tiebreak excludes a previously used failure domain', () => {
  const independent = rail({
    rail_id: 'vercel-independent-tiebreak',
    gateway_plane: 'VERCEL_LIVE_PEER_PROJECT',
    route_id: 'qualified/tiebreak',
    transport: 'VERCEL_FUNCTION_HTTP',
    failure_domain: 'vercel:independent-tiebreak',
    models: ['independent/model'],
    structured_verified: false,
    evidence_trust_state: 'SIGNED_ATTESTED',
    evidence_source: 'VERCEL_TIEBREAK_ATTESTATION',
    evidence: '8'
  });
  const plan = createMultiGatewayRoutePlan({
    task_id: 'task-tiebreak-1',
    strategy: 'TIEBREAK',
    now: NOW,
    rails: [supabaseAdvisory, independent],
    excluded_failure_domains: [supabaseAdvisory.failure_domain]
  });
  assert.equal(plan.selected[0].rail_id, independent.rail_id);
  assert.equal(plan.excluded[0].reason, 'FAILURE_DOMAIN_NOT_INDEPENDENT');
});

test('self-reported or unattested quality claims cannot enter automatic quality routing', () => {
  const selfReported = rail({
    rail_id: 'self-reported-quality',
    gateway_plane: 'VERCEL_LIVE_PEER_PROJECT',
    route_id: 'self/reported',
    transport: 'VERCEL_FUNCTION_HTTP',
    failure_domain: 'vercel:self-report',
    models: ['claimed/model'],
    evidence_trust_state: 'SELF_REPORTED',
    evidence_source: 'CALLER_OBJECT',
    evidence: 'c'
  });
  const unattested = rail({
    rail_id: 'unattested-quality',
    gateway_plane: 'VERCEL_AI_GATEWAY',
    route_id: 'committee:free:v1',
    transport: 'OPENAI_COMPAT_HTTP',
    failure_domain: 'vercel:gateway',
    models: ['claimed/model-2'],
    evidence_trust_state: 'HASH_BOUND_ADVISORY_UNATTESTED',
    evidence_source: 'ADVISORY_ENVELOPE',
    evidence: 'd'
  });
  const plan = createMultiGatewayRoutePlan({
    task_id: 'task-trust-fence',
    strategy: 'STRUCTURED',
    now: NOW,
    rails: [selfReported, unattested, supabaseStructured]
  });
  assert.equal(plan.selected[0].rail_id, supabaseStructured.rail_id);
  assert.deepEqual(
    plan.excluded.filter((row) => row.reason === 'QUALIFICATION_EVIDENCE_UNTRUSTED').map((row) => row.rail_id).sort(),
    ['self-reported-quality', 'unattested-quality']
  );
});

test('stale evidence and availability-only peers cannot enter a quality route, but diagnostic qualification remains advisory', () => {
  const stale = { ...supabaseStructured, rail_id: 'stale', observed_at: '2026-08-29T08:00:00.000Z', evidence_sha256: '9'.repeat(64) };
  const availabilityOnly = rail({
    rail_id: 'tiny-availability',
    gateway_plane: 'SUPABASE_LIVE_PEER_BROKER',
    route_id: 'tinyllama',
    transport: 'SUPABASE_EDGE_HTTP',
    failure_domain: 'supabase:tiny',
    models: ['tinyllama'],
    quality_verified: false,
    structured_verified: false,
    quorum_eligible: false,
    evidence_trust_state: 'HASH_BOUND_ADVISORY_UNATTESTED',
    evidence_source: 'LIVE_TRANSPORT_OBSERVATION',
    evidence: 'b'
  });
  assert.throws(() => createMultiGatewayRoutePlan({
    task_id: 'task-stale-1',
    strategy: 'STRUCTURED',
    now: NOW,
    freshness_seconds: 3600,
    rails: [stale, availabilityOnly]
  }), /no_eligible_rail/);

  const probe = createMultiGatewayRoutePlan({
    task_id: 'task-probe-1',
    strategy: 'QUALIFICATION',
    now: NOW,
    rails: [availabilityOnly]
  });
  assert.equal(probe.selected[0].rail_id, 'tiny-availability');
  assert.equal(probe.selected[0].evidence_trust_state, 'HASH_BOUND_ADVISORY_UNATTESTED');
  assert.equal(probe.semantics.availability_is_not_quality, true);
  assert.equal(probe.policy.direct_action_allowed, false);
});
