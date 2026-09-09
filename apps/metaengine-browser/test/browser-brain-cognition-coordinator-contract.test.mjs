import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000201';

function snapshot(sequence = 1, semanticSequence = 0) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: '2026-09-06T12:20:00.000Z',
    event_driven_lifecycle: true,
    processes: [
      { pid: 1, process_key: '1:1000', creation_time_ms: 1000, type: 'Browser', cpu_percent: 1, memory_working_set_kb: 200000 },
      { pid: 201, process_key: '201:2000', creation_time_ms: 2000, type: 'Tab', cpu_percent: 2, memory_working_set_kb: 100000 },
    ],
    web_contents: [
      { web_contents_id: 201, os_pid: 201, process_key: '201:2000', tab_id: TAB, destroyed: false },
    ],
    semantic_plane: {
      sequence: semanticSequence,
      target_count: 1,
      targets: [
        { tab_id: TAB, target_id: 'target-201', document_generation: 3, semantic_revision: semanticSequence },
      ],
    },
    events: [],
  };
}

test('continuous coordinator feeds semantic edges into bounded causal cognition before pressure reuse', () => {
  const coordinator = new BrowserBrainContinuousCoordinator();
  coordinator.reconcile(snapshot(1, 0));
  const event = {
    seq: 2,
    type: 'SEMANTIC_EVENT',
    tab_id: TAB,
    web_contents_id: 201,
    target_id: 'target-201',
    semantic_method: 'Accessibility.nodesUpdated',
    semantic_sequence: 1,
    observed_at: '2026-09-06T12:20:00.010Z',
  };
  const edge = coordinator.observeEdge(event, { process_snapshot: snapshot(2, 1) });
  const state = coordinator.snapshot();

  assert.equal(edge.cognition.resync_required, false);
  assert.equal(edge.pressure_evaluated, false);
  assert.equal(state.cognition_fabric.semantic_edge_count, 1);
  assert.equal(state.cognition_fabric.cell_count, 1);
  assert.equal(state.cognition_fabric.causal_clock.source_count, 2);
  assert.equal(state.cognition_fabric.second_scheduler, false);
  assert.equal(state.cognition_fabric.command_leasing, false);
  assert.equal(state.cognition_fabric.execution_authority, false);
});

test('coordinator exposes provider-neutral advisory agent routing without assigning or executing work', () => {
  const coordinator = new BrowserBrainContinuousCoordinator();
  coordinator.reconcile(snapshot());
  coordinator.observeAgent({
    agent_id: 'agent.openai.reasoner', role: 'REASONER', provider: 'openai',
    capabilities: ['observe', 'reason'], generation: 2, status: 'READY', target_tab_id: TAB,
  });
  coordinator.observeAgent({
    agent_id: 'agent.other.critic', role: 'CRITIC', provider: 'other',
    capabilities: ['observe', 'reason'], generation: 4, status: 'READY', target_tab_id: TAB,
  });

  const route = coordinator.routeAgents({
    required_capabilities: ['observe', 'reason'],
    preferred_provider: 'openai',
    target_tab_id: TAB,
  });

  assert.deepEqual(route.candidates.map((row) => row.agent_id), [
    'agent.openai.reasoner',
    'agent.other.critic',
  ]);
  assert.equal(route.assignment_created, false);
  assert.equal(route.scheduler_authority, false);
  assert.equal(route.execution_authority, false);
  assert.equal(route.authority_effect, false);
});

test('causal gap visible through coordinator blocks advisory semantic reuse until canonical resync', () => {
  let now = 1000;
  const coordinator = new BrowserBrainContinuousCoordinator({ clock: () => now });
  coordinator.reconcile(snapshot(1, 0));
  coordinator.observeEdge({
    seq: 2, type: 'SEMANTIC_EVENT', tab_id: TAB, web_contents_id: 201,
    semantic_method: 'Accessibility.nodesUpdated', semantic_sequence: 1,
    observed_at: '2026-09-06T12:20:00.010Z',
  }, { process_snapshot: snapshot(2, 1) });
  coordinator.rememberAdvisoryPlan({
    tab_id: TAB,
    intent_id: 'intent.send',
    action: 'TYPED_CLICK',
    candidate_ref: 'node.send',
    semantic_fingerprint: 'fp.semantic.send',
    locator_fingerprint: 'fp.locator.send',
    binding_generation: 5,
    document_generation: 3,
    semantic_revision: 1,
  });

  coordinator.observeEdge({
    seq: 3, type: 'SEMANTIC_EVENT', tab_id: TAB, web_contents_id: 201,
    semantic_method: 'Accessibility.nodesUpdated', semantic_sequence: 4,
    observed_at: '2026-09-06T12:20:00.020Z',
  }, { process_snapshot: snapshot(3, 4) });

  const blocked = coordinator.resolveAdvisoryPlan({
    tab_id: TAB, intent_id: 'intent.send', action: 'TYPED_CLICK',
    binding_generation: 5, document_generation: 3, semantic_revision: 1,
    revalidate: () => true,
  });
  assert.equal(blocked.hit, false);
  assert.equal(blocked.reason, 'CAUSAL_RESYNC_REQUIRED');

  now += 1;
  coordinator.observeEdge({
    seq: 4, type: 'PROCESS_CENSUS_REFRESHED', reason: 'CANONICAL_REFRESH',
    observed_at: '2026-09-06T12:20:00.030Z',
  }, { process_snapshot: snapshot(4, 4) });
  assert.equal(coordinator.cognitionSnapshot().causal_clock.gap_requires_resync, false);
});
