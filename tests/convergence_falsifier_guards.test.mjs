import test from 'node:test';
import assert from 'node:assert/strict';

import { routeAdaptiveV1, AdaptiveRouterError } from '../coordination/browser-shared/adaptive-router-v1.mjs';
import { createTrustTaintGraph, TrustTaintGraphError } from '../coordination/browser-shared/trust-taint-graph-v1.mjs';

const executor = (extra = {}) => ({
  executor_id: 'exec.safe',
  executor_incarnation_id: 'inc.exec.safe.001',
  surface: 'COMPUTE_BROWSER_PRIMARY',
  health: 'HEALTHY',
  trust_class: 'TRUSTED_LOCAL',
  session_class: 'A2_DEDICATED',
  capabilities: ['CLICK'],
  raw_engine_exposed: false,
  locality: 'LOCAL',
  region: 'us-east-2',
  active_leases: 0,
  max_leases: 1,
  observed_latency_ms: 10,
  ...extra,
});

const request = (extra = {}) => ({
  action_id: 'action.falsifier.001',
  resource_id: 'resource.falsifier.001',
  effect_state: 'PRE_EFFECT',
  required_capabilities: ['CLICK'],
  allowed_surfaces: ['COMPUTE_BROWSER_PRIMARY'],
  allowed_trust_classes: ['TRUSTED_LOCAL'],
  allowed_session_classes: ['A2_DEDICATED'],
  local_required: true,
  prefer_local: true,
  preferred_region: 'us-east-2',
  sticky_executor_id: null,
  ...extra,
});

const policy = { policy_id: 'policy.falsifier.001', surface_preference: ['COMPUTE_BROWSER_PRIMARY'] };

function routerCode(fn, code) {
  assert.throws(fn, (error) => error instanceof AdaptiveRouterError && error.code === code);
}

test('R16 refuses post-effect and ambiguous-effect rerouting', () => {
  for (const effect_state of ['IN_FLIGHT', 'POST_EFFECT', 'POST_EFFECT_AMBIGUOUS']) {
    routerCode(
      () => routeAdaptiveV1({ request: request({ effect_state }), executors: [executor()], policy }),
      'router_post_effect_routing_forbidden',
    );
  }
});

test('R16 rejects authority/retry/taint metadata smuggling instead of silently laundering it', () => {
  for (const extra of [
    { authority_effect: true },
    { actuation_eligible: true },
    { automatic_retry_allowed: true },
    { taint_receipt: { integrity: 'TRUSTED' } },
  ]) {
    routerCode(
      () => routeAdaptiveV1({ request: request(extra), executors: [executor()], policy }),
      'router_request_fields_invalid',
    );
  }
});

test('R16 decision remains non-authoritative and binds exact executor incarnation', () => {
  const routed = routeAdaptiveV1({ request: request(), executors: [executor()], policy });
  assert.equal(routed.executor_incarnation_id, 'inc.exec.safe.001');
  assert.equal(routed.fresh_authority_required, true);
  assert.equal(routed.lease_required, true);
  assert.equal(routed.automatic_retry_allowed, false);
  assert.equal(routed.authority_effect, false);
  assert.equal(routed.actuation_eligible, false);
});

test('tainted page data cannot become browser authority merely by deriving it with trusted policy', () => {
  const graph = createTrustTaintGraph();
  graph.addSource({
    node_id: 'policy.source.001',
    source_class: 'LOCAL_POLICY',
    content_digest: `sha256:${'a'.repeat(64)}`,
    authority_capabilities: ['BROWSER_ACTUATION'],
  });
  graph.addSource({
    node_id: 'page.source.001',
    source_class: 'PAGE_DATA',
    content_digest: `sha256:${'b'.repeat(64)}`,
    authority_capabilities: [],
  });
  const derived = graph.derive({
    node_id: 'derived.page.policy.001',
    parent_ids: ['policy.source.001', 'page.source.001'],
    transform_kind: 'SUMMARIZE',
    content_digest: `sha256:${'c'.repeat(64)}`,
  });
  assert.equal(derived.integrity, 'UNTRUSTED');
  assert.equal(derived.authority_eligible, false);
  assert.deepEqual(derived.authority_capabilities, []);
  assert.throws(
    () => graph.assessPrivilegedSink({ authority_node_id: derived.node_id, sink_kind: 'BROWSER_ACTUATION' }),
    (error) => error instanceof TrustTaintGraphError && error.code === 'taint_authority_node_not_eligible',
  );
});
