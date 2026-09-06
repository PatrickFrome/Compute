import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainCognitionFabric } from '../src/browser-brain-cognition-fabric.mjs';

const tab = (n = 1) => `tab_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function semantic(seq, processSeq, overrides = {}) {
  return {
    type: 'SEMANTIC_EVENT',
    seq: processSeq,
    semantic_sequence: seq,
    semantic_method: 'Accessibility.nodesUpdated',
    tab_id: tab(1),
    observed_at: new Date(1_700_000_000_000 + seq).toISOString(),
    ...overrides,
  };
}

test('merges real process-plane and semantic producer sequences without creating a scheduler', () => {
  const fabric = new BrowserBrainCognitionFabric();
  const first = fabric.observeEdge({ type: 'WEB_CONTENTS_CREATED', seq: 1, tab_id: tab(1) });
  assert.equal(first.causal_epoch, 1);
  const second = fabric.observeEdge(semantic(1, 2));
  assert.equal(second.causal_epoch, 3);
  const third = fabric.observeEdge({ type: 'WEB_CONTENTS_LOADING_STARTED', seq: 3, tab_id: tab(1) });
  assert.equal(third.causal_epoch, 4);
  const snapshot = fabric.snapshot();
  assert.equal(snapshot.causal_clock.source_count, 2);
  assert.equal(snapshot.causal_clock.gap_requires_resync, false);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.authority_effect, false);
});

test('metrics duplicate process sequence does not manufacture a causal epoch', () => {
  const fabric = new BrowserBrainCognitionFabric();
  fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1 });
  const before = fabric.snapshot().causal_epoch;
  const result = fabric.observeEdge({ type: 'METRICS_SAMPLE', seq: 1 });
  assert.equal(result.causal_epoch, before);
  assert.equal(fabric.snapshot().cell_fact_count, 0);
});

test('producer gap disables semantic cache until canonical sequence resync', () => {
  let now = 1_000;
  const fabric = new BrowserBrainCognitionFabric({ clock: () => now });
  fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1 });
  fabric.observeEdge(semantic(1, 2));
  fabric.rememberPlan({
    tab_id: tab(1), intent_id: 'intent.click.send', action: 'TYPED_CLICK', candidate_ref: 'node.send',
    semantic_fingerprint: 'fp.semantic.send', locator_fingerprint: 'fp.locator.send',
    binding_generation: 7, document_generation: 3, semantic_revision: 11,
  });
  fabric.observeEdge(semantic(4, 3));
  const blocked = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.click.send', action: 'TYPED_CLICK',
    binding_generation: 7, document_generation: 3, semantic_revision: 11,
    revalidate: () => true,
  });
  assert.equal(blocked.hit, false);
  assert.equal(blocked.reason, 'CAUSAL_RESYNC_REQUIRED');
  fabric.reconcileProducerSequences({ process_sequence: 3, semantic_sequence: 4 });
  const recovered = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.click.send', action: 'TYPED_CLICK',
    binding_generation: 7, document_generation: 3, semantic_revision: 11,
    revalidate: () => true,
  });
  assert.equal(recovered.hit, true);
  assert.equal(recovered.actuation_eligible, false);
});

test('semantic plans require exact generation tuple and fresh revalidation', () => {
  let now = 10_000;
  const fabric = new BrowserBrainCognitionFabric({ clock: () => now, planMaxAgeMs: 5_000 });
  fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1 });
  fabric.rememberPlan({
    tab_id: tab(1), intent_id: 'intent.focus.prompt', action: 'SEMANTIC_FOCUS', candidate_ref: 'node.prompt',
    semantic_fingerprint: 'fp.prompt.semantic', locator_fingerprint: 'fp.prompt.locator',
    binding_generation: 5, document_generation: 8, semantic_revision: 13,
  });
  const stale = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.focus.prompt', action: 'SEMANTIC_FOCUS',
    binding_generation: 6, document_generation: 8, semantic_revision: 13,
    revalidate: () => true,
  });
  assert.equal(stale.hit, false);
  assert.equal(stale.reason, 'GENERATION_CHANGED');

  fabric.rememberPlan({
    tab_id: tab(1), intent_id: 'intent.focus.prompt', action: 'SEMANTIC_FOCUS', candidate_ref: 'node.prompt',
    semantic_fingerprint: 'fp.prompt.semantic', locator_fingerprint: 'fp.prompt.locator',
    binding_generation: 6, document_generation: 8, semantic_revision: 14,
  });
  const denied = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.focus.prompt', action: 'SEMANTIC_FOCUS',
    binding_generation: 6, document_generation: 8, semantic_revision: 14,
    revalidate: () => false,
  });
  assert.equal(denied.hit, false);
  assert.equal(denied.reason, 'FRESH_REVALIDATION_FAILED');

  const hit = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.focus.prompt', action: 'SEMANTIC_FOCUS',
    binding_generation: 6, document_generation: 8, semantic_revision: 14,
    revalidate: (plan) => plan.candidate_ref === 'node.prompt',
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.plan.execution_payload_stored, false);
  assert.equal(hit.revalidation_required_before_effect, true);
});

test('navigation and debugger lifecycle invalidate advisory plans immediately', () => {
  const fabric = new BrowserBrainCognitionFabric({ clock: () => 10_000 });
  fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1 });
  fabric.rememberPlan({
    tab_id: tab(1), intent_id: 'intent.click', action: 'TYPED_CLICK', candidate_ref: 'node.button',
    semantic_fingerprint: 'fp.button.semantic', locator_fingerprint: 'fp.button.locator',
    binding_generation: 1, document_generation: 1, semantic_revision: 1,
  });
  fabric.observeEdge(semantic(1, 2, { semantic_method: 'DOM.documentUpdated' }));
  const out = fabric.resolvePlan({
    tab_id: tab(1), intent_id: 'intent.click', action: 'TYPED_CLICK',
    binding_generation: 1, document_generation: 1, semantic_revision: 1,
    revalidate: () => true,
  });
  assert.equal(out.hit, false);
  assert.equal(out.reason, 'NO_RECORD');
  assert.equal(fabric.snapshot().advisory_plan_invalidations, 1);
});

test('agent routing is bounded, capability-aware and creates no assignment authority', () => {
  const fabric = new BrowserBrainCognitionFabric({ maxAgents: 3 });
  fabric.observeAgent({ agent_id: 'agent.alpha', role: 'RESEARCHER', provider: 'openai', capabilities: ['observe', 'reason'], generation: 1, status: 'READY' });
  fabric.observeAgent({ agent_id: 'agent.beta', role: 'CRITIC', provider: 'other', capabilities: ['observe', 'reason'], generation: 1, status: 'READY', target_tab_id: tab(1) });
  fabric.observeAgent({ agent_id: 'agent.gamma', role: 'WORKER', provider: 'openai', capabilities: ['observe'], generation: 2, status: 'BUSY' });
  const route = fabric.routeAgents({ required_capabilities: ['observe', 'reason'], preferred_provider: 'openai', target_tab_id: tab(1) });
  assert.deepEqual(route.candidates.map((row) => row.agent_id), ['agent.alpha', 'agent.beta']);
  assert.equal(route.selection_is_advisory, true);
  assert.equal(route.assignment_created, false);
  assert.equal(route.scheduler_authority, false);
  assert.equal(route.execution_authority, false);
});

test('evidence ledger stores only bounded digests and evicts oldest rows', () => {
  let now = 1_000;
  const fabric = new BrowserBrainCognitionFabric({ clock: () => now, maxEvidence: 2 });
  const digest = (n) => `sha256:${String(n).padStart(64, '0')}`;
  fabric.recordEvidence({ evidence_id: 'evidence.one', kind: 'OBSERVATION', content_digest: digest(1), tainted: true });
  now += 1;
  fabric.recordEvidence({ evidence_id: 'evidence.two', kind: 'TEST', content_digest: digest(2), tainted: false, refs: ['evidence.one'] });
  now += 1;
  fabric.recordEvidence({ evidence_id: 'evidence.three', kind: 'CRITIQUE', content_digest: digest(3), tainted: true, refs: ['evidence.two'] });
  const snapshot = fabric.snapshot();
  assert.equal(snapshot.evidence_count, 2);
  assert.equal(snapshot.evidence_evictions, 1);
  assert.equal(snapshot.page_model_data_grants_authority, false);
  assert.equal(snapshot.raw_dom_stored, false);
});

test('fact retention is bounded per BrowserCell under semantic burst', () => {
  const fabric = new BrowserBrainCognitionFabric({ factsPerCell: 3 });
  for (let i = 1; i <= 10; i += 1) fabric.observeEdge(semantic(i, i));
  const facts = fabric.facts(tab(1));
  assert.equal(facts.length, 3);
  assert.deepEqual(facts.map((row) => row.semantic_sequence), [8, 9, 10]);
  assert.equal(fabric.snapshot().bounded_memory, true);
});
