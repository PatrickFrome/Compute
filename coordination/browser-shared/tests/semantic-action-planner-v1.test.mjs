import assert from 'node:assert/strict';
import test from 'node:test';
import { CachedSemanticPlanner } from '../semantic-action-planner-v1.mjs';

function node({ ref='n1', sem='sem_submit', loc='loc_submit', visibility='VISIBLE', clickable=true } = {}) {
  return {
    ref, parent_ref: null, role: 'button', name: 'Submit', description: null, value_summary: null,
    states: {}, editable: false, clickable, focusable: true, bounds: [10, 20, 100, 30], visibility,
    confidence: 0.99, continuity: null, binding_epoch: null,
    semantic_fingerprint: sem, geometry_bucket: '0:0:96:32', locator_fingerprint: loc
  };
}
function envelope({ surface='EXTENSION', document='doc_1', nodes=[node()] } = {}) {
  return {
    schema: 'metaengine.a2-browser-operator.perception-envelope.v1', source_surface: surface,
    target_id: 'target_1', context_id: 'default', conversation_epoch: 4, document_epoch: document,
    captured_at: '2026-08-28T06:20:00.000Z', source_token: 'src', source_scope: 'SEMANTIC_WORKING_SET',
    tainted_page_data: true, authority_effect: false, actuation_eligible: false,
    evidence: { accessibility: 'COMPLETE', geometry: 'PARTIAL', visibility: 'POSITIVE_ONLY', oopif: 'UNKNOWN' },
    truncation: { applied: false, source_node_count: nodes.length, emitted_node_count: nodes.length }, nodes
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('first request plans, second cross-surface request bypasses planner', async () => {
  let calls = 0;
  const planner = new CachedSemanticPlanner({ planner: async () => {
    calls += 1;
    return { candidate_ref: 'n1', meta: { model: 'test-model', strategy: 'semantic' } };
  }});
  const first = await planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(first.source, 'PLANNER_FRESH');
  assert.equal(calls, 1);
  const second = await planner.resolve({ envelope: envelope({ surface: 'COMPUTE_BROWSER', nodes: [node({ ref: 'fresh_ref', loc: 'loc_shifted' })] }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(second.source, 'CACHE_REVALIDATED');
  assert.equal(second.candidate_ref, 'fresh_ref');
  assert.equal(calls, 1);
  assert.equal(second.must_run_actionability_checks, true);
  assert.equal(second.actuation_eligible, false);
});

test('document epoch change forces fresh planning', async () => {
  let calls = 0;
  const planner = new CachedSemanticPlanner({ planner: async ({ envelope: fresh }) => {
    calls += 1;
    return { candidate_ref: fresh.nodes[0].ref };
  }});
  await planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  const changed = await planner.resolve({ envelope: envelope({ document: 'doc_2', nodes: [node({ ref: 'new_doc_ref' })] }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(changed.source, 'PLANNER_FRESH');
  assert.equal(calls, 2);
});

test('ambiguous cache target falls back to planner instead of guessing', async () => {
  let calls = 0;
  const planner = new CachedSemanticPlanner({ planner: async ({ envelope: fresh }) => {
    calls += 1;
    return { candidate_ref: fresh.nodes.at(-1).ref };
  }});
  await planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  const ambiguous = envelope({ nodes: [node({ ref: 'a', loc: 'loc_a' }), node({ ref: 'b', loc: 'loc_b' })] });
  const result = await planner.resolve({ envelope: ambiguous, intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(result.source, 'PLANNER_FRESH');
  assert.equal(result.candidate_ref, 'b');
  assert.equal(result.cache_reason, 'AMBIGUOUS_TARGET');
  assert.equal(calls, 2);
});

test('planner-selected candidate must still satisfy cache eligibility', async () => {
  const planner = new CachedSemanticPlanner({ planner: async () => ({ candidate_ref: 'n1' }) });
  await assert.rejects(() => planner.resolve({
    envelope: envelope({ nodes: [node({ visibility: 'UNKNOWN' })] }), intentId: 'submit', actionKind: 'CLICK'
  }), /semantic_action_cache_node_not_eligible/);
});

test('planner failure does not promote cache', async () => {
  let calls = 0;
  const planner = new CachedSemanticPlanner({ planner: async () => {
    calls += 1;
    throw new Error('model_unavailable');
  }});
  await assert.rejects(() => planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' }), /model_unavailable/);
  assert.equal(planner.snapshot().cache.entry_count, 0);
  assert.equal(planner.snapshot().metrics.planner_errors, 1);
  assert.equal(calls, 1);
});

test('planner context may contain current request data but cache snapshot never stores it', async () => {
  const secret = 'current-request-only-value';
  let observed = null;
  const planner = new CachedSemanticPlanner({ planner: async (request) => {
    observed = request.planner_context;
    return { candidate_ref: 'n1', meta: { model: 'm', strategy: 'fresh', ignored: secret } };
  }});
  await planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK', plannerContext: { instruction: secret } });
  assert.equal(observed.instruction, secret);
  assert.equal(JSON.stringify(planner.snapshot()).includes(secret), false);
  assert.equal(planner.snapshot().stores_execution_payload, false);
});

test('deterministic repetition avoids all planner calls after warmup', async () => {
  let calls = 0;
  const planner = new CachedSemanticPlanner({ planner: async () => {
    calls += 1;
    return { candidate_ref: 'n1' };
  }});
  for (let i = 0; i < 1000; i += 1) {
    const result = await planner.resolve({ envelope: envelope({ surface: i % 2 ? 'COMPUTE_BROWSER' : 'EXTENSION' }), intentId: 'submit', actionKind: 'CLICK' });
    assert.ok(['PLANNER_FRESH', 'CACHE_REVALIDATED'].includes(result.source));
  }
  const metrics = planner.snapshot().metrics;
  assert.equal(calls, 1);
  assert.equal(metrics.planner_calls, 1);
  assert.equal(metrics.planner_calls_avoided, 999);
  assert.equal(metrics.cache_hits, 999);
  assert.equal(metrics.cache_misses, 1);
});

test('64 concurrent cold misses collapse to one planner call and each follower revalidates its own fresh ref', async () => {
  let calls = 0;
  let release;
  let startedResolve;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const planner = new CachedSemanticPlanner({ planner: async ({ envelope: fresh }) => {
    calls += 1;
    startedResolve();
    await blocked;
    return { candidate_ref: fresh.nodes[0].ref };
  }});

  const requests = Array.from({ length: 64 }, (_, index) => planner.resolve({
    envelope: envelope({
      surface: index % 2 ? 'COMPUTE_BROWSER' : 'EXTENSION',
      nodes: [node({ ref: `fresh_${index}`, loc: `loc_${index}` })]
    }),
    intentId: 'submit',
    actionKind: 'CLICK'
  }));
  await started;
  await tick();
  assert.equal(calls, 1);
  assert.equal(planner.snapshot().in_flight_count, 1);
  release();
  const results = await Promise.all(requests);

  assert.equal(results[0].source, 'PLANNER_FRESH');
  for (let index = 0; index < results.length; index += 1) {
    assert.equal(results[index].candidate_ref, `fresh_${index}`);
    assert.equal(results[index].authority_effect, false);
    assert.equal(results[index].actuation_eligible, false);
  }
  assert.equal(results.filter((row) => row.source === 'CACHE_COALESCED_REVALIDATED').length, 63);
  const metrics = planner.snapshot().metrics;
  assert.equal(calls, 1);
  assert.equal(metrics.planner_calls, 1);
  assert.equal(metrics.singleflight_leaders, 1);
  assert.equal(metrics.singleflight_waiters, 63);
  assert.equal(metrics.singleflight_revalidation_hits, 63);
  assert.equal(metrics.planner_calls_avoided, 63);
  assert.equal(planner.snapshot().in_flight_count, 0);
});

test('singleflight never shares an ephemeral node ref when follower semantic evidence differs', async () => {
  let calls = 0;
  let release;
  let startedResolve;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const planner = new CachedSemanticPlanner({ planner: async ({ envelope: fresh }) => {
    calls += 1;
    if (calls === 1) {
      startedResolve();
      await blocked;
    }
    return { candidate_ref: fresh.nodes[0].ref };
  }});

  const leader = planner.resolve({
    envelope: envelope({ nodes: [node({ ref: 'leader_ref', sem: 'sem_leader' })] }),
    intentId: 'submit', actionKind: 'CLICK'
  });
  await started;
  const follower = planner.resolve({
    envelope: envelope({ surface: 'COMPUTE_BROWSER', nodes: [node({ ref: 'follower_ref', sem: 'sem_follower' })] }),
    intentId: 'submit', actionKind: 'CLICK'
  });
  await tick();
  assert.equal(calls, 1);
  release();
  const [leaderResult, followerResult] = await Promise.all([leader, follower]);
  assert.equal(leaderResult.candidate_ref, 'leader_ref');
  assert.equal(followerResult.candidate_ref, 'follower_ref');
  assert.equal(followerResult.source, 'PLANNER_FRESH');
  assert.equal(calls, 2);
  assert.equal(planner.snapshot().metrics.singleflight_revalidation_misses, 1);
});

test('singleflight key is fenced by document epoch', async () => {
  let calls = 0;
  let releases = [];
  let twoStartedResolve;
  const twoStarted = new Promise((resolve) => { twoStartedResolve = resolve; });
  const planner = new CachedSemanticPlanner({ planner: async ({ envelope: fresh }) => {
    calls += 1;
    if (calls === 2) twoStartedResolve();
    await new Promise((resolve) => releases.push(resolve));
    return { candidate_ref: fresh.nodes[0].ref };
  }});
  const a = planner.resolve({ envelope: envelope({ document: 'doc_a', nodes: [node({ ref: 'a' })] }), intentId: 'submit', actionKind: 'CLICK' });
  const b = planner.resolve({ envelope: envelope({ document: 'doc_b', nodes: [node({ ref: 'b' })] }), intentId: 'submit', actionKind: 'CLICK' });
  await twoStarted;
  assert.equal(calls, 2);
  assert.equal(planner.snapshot().in_flight_count, 2);
  for (const resolve of releases) resolve();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.candidate_ref, 'a');
  assert.equal(rb.candidate_ref, 'b');
});

test('singleflight shares planner failure and prevents failure stampede', async () => {
  let calls = 0;
  let release;
  let startedResolve;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const planner = new CachedSemanticPlanner({ planner: async () => {
    calls += 1;
    startedResolve();
    await blocked;
    throw new Error('planner_down');
  }});
  const requests = Array.from({ length: 32 }, () => planner.resolve({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' }));
  await started;
  await tick();
  assert.equal(calls, 1);
  release();
  const settled = await Promise.allSettled(requests);
  assert.equal(settled.filter((row) => row.status === 'rejected').length, 32);
  assert.ok(settled.every((row) => row.status === 'rejected' && /planner_down/.test(String(row.reason?.message || row.reason))));
  const snapshot = planner.snapshot();
  assert.equal(snapshot.metrics.planner_errors, 1);
  assert.equal(snapshot.metrics.singleflight_shared_errors, 31);
  assert.equal(snapshot.in_flight_count, 0);
});

test('singleflight in-flight cardinality is bounded fail-closed', async () => {
  let calls = 0;
  let releases = [];
  let twoStartedResolve;
  const twoStarted = new Promise((resolve) => { twoStartedResolve = resolve; });
  const planner = new CachedSemanticPlanner({ maxInFlight: 2, planner: async ({ envelope: fresh }) => {
    calls += 1;
    if (calls === 2) twoStartedResolve();
    await new Promise((resolve) => releases.push(resolve));
    return { candidate_ref: fresh.nodes[0].ref };
  }});
  const a = planner.resolve({ envelope: envelope(), intentId: 'intent_a', actionKind: 'CLICK' });
  const b = planner.resolve({ envelope: envelope(), intentId: 'intent_b', actionKind: 'CLICK' });
  await twoStarted;
  await assert.rejects(
    () => planner.resolve({ envelope: envelope(), intentId: 'intent_c', actionKind: 'CLICK' }),
    /semantic_action_planner_inflight_capacity_exceeded/
  );
  assert.equal(planner.snapshot().metrics.singleflight_capacity_rejections, 1);
  for (const resolve of releases) resolve();
  await Promise.all([a, b]);
  assert.equal(planner.snapshot().in_flight_count, 0);
});
