import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';

const SHA = '8'.repeat(40);
const DIGEST = `sha256:${'c'.repeat(64)}`;

test('continuous coordinator defaults to collaboration runtime v2 with durable memory, routing v2 and sparse fanout', () => {
  const coordinator = new BrowserBrainContinuousCoordinator({ clock: () => 60_000 });
  coordinator.recordCollaborationTask({ context_id: 'ctx.v2', task_id: 'task.v2', objective: 'finish autonomous collaboration stack', required_capabilities: ['memory'] });
  coordinator.recordHandoffCapsule({ handoff_id: 'handoff.v2', context_id: 'ctx.v2', task_id: 'task.v2', from_agent_id: 'agent_alpha', objective: 'finish v2', verified_facts: ['current scheduler remains the only scheduler'], next_actions: ['continue autonomously'], base_sha: SHA });
  coordinator.recordCollaborationArtifact({ artifact_id: 'artifact.v2', context_id: 'ctx.v2', task_id: 'task.v2', kind: 'proof', content_digest: DIGEST, base_sha: SHA });
  coordinator.advanceCollaborationTask({ task_id: 'task.v2', progress_revision: 2, status: 'COMPLETED' });

  const memory = coordinator.retrieveCollaborationMemory({ query: 'autonomous collaboration memory', context_id: 'ctx.v2', base_sha: SHA, token_budget: 256 });
  assert.equal(memory.results.length, 1);
  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.durable_collaboration_memory, true);
  assert.equal(snapshot.episodic_collaboration_memory, true);
  assert.equal(snapshot.routing_v2, true);
  assert.equal(snapshot.adaptive_sparse_fanout, true);
  assert.equal(snapshot.a2a_boundary_only, true);
  assert.equal(snapshot.work_cycle_limit, null);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.scheduler_authority, false);
});

test('coordinator routing v2 receives agent observations but remains advisory', () => {
  const coordinator = new BrowserBrainContinuousCoordinator({ clock: () => 61_000 });
  coordinator.observeAgent({ agent_id: 'agent_alpha', role: 'RESEARCHER', provider: 'openai', capabilities: ['memory'], generation: 1, status: 'READY', contexts: ['ctx.route'], load: 0.1, success_rate: 0.9, novelty: 0.8 });
  const route = coordinator.routeAgentsV2({ required_capabilities: ['memory'], context_id: 'ctx.route' });
  assert.equal(route.candidates[0].agent_id, 'agent_alpha');
  assert.equal(route.candidates[0].assignment_created, false);
  assert.equal(route.scheduler_authority, false);
});

test('collaboration checkpoint can be restored into a fresh coordinator without waiting for external confirmation', () => {
  const first = new BrowserBrainContinuousCoordinator({ clock: () => 62_000 });
  first.recordCollaborationTask({ context_id: 'ctx.restart', task_id: 'task.restart', objective: 'survive restart' });
  const checkpoint = first.collaborationCheckpoint();
  const second = new BrowserBrainContinuousCoordinator({ clock: () => 63_000, collaborationCheckpoint: checkpoint });
  const decision = second.autonomousContinuation({ context_id: 'ctx.restart', agent_id: 'agent_beta' });
  assert.equal(decision.action, 'CLAIM_READY_TASK');
  assert.equal(decision.user_confirmation_required, false);
  assert.equal(decision.external_prompt_required, false);
  assert.equal(decision.continue_autonomously, true);
});
