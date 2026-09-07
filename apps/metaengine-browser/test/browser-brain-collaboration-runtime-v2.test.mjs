import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainCollaborationRuntimeV2 } from '../src/browser-brain-collaboration-runtime-v2.mjs';
import { BrowserBrainCollaborationJournal } from '../src/browser-brain-collaboration-journal.mjs';
import { BrowserBrainEpisodicMemory } from '../src/browser-brain-episodic-memory.mjs';
import { BrowserBrainRoutingV2, planAdaptiveSparseFanout } from '../src/browser-brain-routing-v2.mjs';
import { BrowserBrainA2AAdapter } from '../src/browser-brain-a2a-adapter.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const SHA = '7'.repeat(40);

test('durable collaboration checkpoint restores causal work state without user confirmation or effect authority', async () => {
  let now = 10_000;
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => now });
  runtime.recordTask({ context_id: 'ctx.durable', task_id: 'task.durable', objective: 'continue after restart', required_capabilities: ['memory'] });
  runtime.recordArtifact({ artifact_id: 'artifact.durable', context_id: 'ctx.durable', task_id: 'task.durable', kind: 'proof', content_digest: DIGEST, base_sha: SHA, branch: 'work/durable' });
  runtime.recordHandoff({ handoff_id: 'handoff.durable', context_id: 'ctx.durable', task_id: 'task.durable', from_agent_id: 'agent_alpha', objective: 'resume exactly', verified_facts: ['checkpoint is hash verified'], next_actions: ['continue implementation'], base_sha: SHA, branch: 'work/durable' });
  runtime.claimWork({ claim_id: 'claim.durable', context_id: 'ctx.durable', task_id: 'task.durable', agent_id: 'agent_alpha', scope: 'durable-memory', ttl_ms: 60_000 });
  const checkpoint = runtime.checkpoint();

  now += 5_000;
  const restored = new BrowserBrainCollaborationRuntimeV2({ clock: () => now });
  const replay = restored.restore(checkpoint);
  assert.equal(replay.checkpoint_restored, true);
  assert.equal(restored.taskLedger('ctx.durable').tasks.length, 1);
  assert.equal(restored.progressLedger('ctx.durable').active, 1);
  assert.equal(restored.snapshot().external_confirmation_gate, false);
  assert.equal(restored.snapshot().work_cycle_limit, null);
  assert.equal(restored.snapshot().scheduler_authority, false);

  const tampered = structuredClone(checkpoint);
  tampered.entries[0].payload.objective = 'tampered';
  assert.throws(() => restored.restore(tampered), /checkpoint_hash_mismatch/);
});

test('durable persistence coalesces a synchronous mutation burst and flush preserves the latest journal state', async () => {
  const saves = [];
  const runtime = new BrowserBrainCollaborationRuntimeV2({
    clock: () => 15_000,
    saveState: async (checkpoint) => { saves.push(checkpoint); },
  });

  runtime.recordTask({ context_id: 'ctx.coalesce', task_id: 'task.coalesce', objective: 'persist latest burst state', required_capabilities: ['memory'] });
  runtime.recordArtifact({ artifact_id: 'artifact.coalesce', context_id: 'ctx.coalesce', task_id: 'task.coalesce', kind: 'proof', content_digest: DIGEST, base_sha: SHA, branch: 'work/coalesce' });
  runtime.recordHandoff({ handoff_id: 'handoff.coalesce', context_id: 'ctx.coalesce', task_id: 'task.coalesce', from_agent_id: 'agent_alpha', objective: 'preserve causal burst', verified_facts: ['latest checkpoint contains the whole burst'], next_actions: ['restore latest checkpoint'], base_sha: SHA, branch: 'work/coalesce' });
  runtime.claimWork({ claim_id: 'claim.coalesce', context_id: 'ctx.coalesce', task_id: 'task.coalesce', agent_id: 'agent_alpha', scope: 'coalesced-persistence', ttl_ms: 60_000 });

  const flushed = await runtime.flush();
  assert.equal(flushed.ok, true);
  assert.equal(saves.length, 1);
  assert.equal(runtime.snapshot().persistence_coalescing, 'LATEST_CHECKPOINT_BURST_V1');

  const restored = new BrowserBrainCollaborationRuntimeV2({ clock: () => 16_000 });
  restored.restore(saves[0]);
  assert.equal(restored.taskLedger('ctx.coalesce').tasks.length, 1);
  assert.equal(restored.progressLedger('ctx.coalesce').active, 1);
  assert.deepEqual(restored.taskLedger('ctx.coalesce').artifact_refs, ['artifact.coalesce']);
  const kinds = restored.checkpoint().entries.map((row) => row.kind);
  assert.ok(kinds.includes('HANDOFF_RECORDED'));
  assert.ok(kinds.includes('CLAIM_RECORDED'));
});

test('terminal tasks become compact immutable episodes and retrieval stays under token budget', () => {
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => 20_000 });
  runtime.recordTask({ context_id: 'ctx.memory', task_id: 'task.memory', objective: 'implement hybrid episodic memory', required_capabilities: ['memory', 'research'] });
  runtime.recordHandoff({ handoff_id: 'handoff.memory', context_id: 'ctx.memory', task_id: 'task.memory', from_agent_id: 'agent_alpha', objective: 'finish memory', verified_facts: ['hybrid retrieval uses metadata first'], rejected_paths: ['full transcript broadcast'], next_actions: ['reuse provenance-gated retrieval'], base_sha: SHA, branch: 'work/memory' });
  runtime.recordArtifact({ artifact_id: 'artifact.memory', context_id: 'ctx.memory', task_id: 'task.memory', kind: 'test', content_digest: DIGEST, base_sha: SHA, branch: 'work/memory' });
  runtime.advanceTask({ task_id: 'task.memory', progress_revision: 2, status: 'COMPLETED' });

  const memory = runtime.snapshot().episodic_memory;
  assert.equal(memory.episode_count, 1);
  const retrieved = runtime.retrieveMemory({ query: 'hybrid memory provenance retrieval', context_id: 'ctx.memory', base_sha: SHA, token_budget: 256 });
  assert.equal(retrieved.results.length, 1);
  assert.ok(retrieved.estimated_tokens_used <= 256);
  assert.equal(retrieved.results[0].episode.artifact_refs[0], 'artifact.memory');
  assert.equal(retrieved.execution_authority, false);
});

test('repeated successful episodes consolidate semantic facts and procedural playbooks off the semantic hot path', () => {
  const memory = new BrowserBrainEpisodicMemory({ clock: () => 30_000 });
  for (const suffix of ['a', 'b']) memory.recordEpisode({
    episode_id: `episode.repeat-${suffix}`,
    context_id: `ctx.repeat-${suffix}`,
    task_id: `task.repeat-${suffix}`,
    objective: 'repeat exact head verification',
    outcome: 'COMPLETED',
    verified_facts: ['repeat physical soak before promotion'],
    next_actions: ['rerun exact-head installed soak'],
    base_sha: SHA,
  });
  assert.equal(memory.semanticFacts().length, 1);
  assert.equal(memory.semanticFacts()[0].support_count, 2);
  assert.equal(memory.playbooks().length, 1);
  assert.equal(memory.snapshot().semantic_hot_path_writes, false);
});

test('routing v2 ranks capability context load success and novelty but creates no assignment', () => {
  const routing = new BrowserBrainRoutingV2();
  routing.observeAgent({ agent_id: 'agent_alpha', status: 'READY', provider: 'openai', capabilities: ['memory', 'research'], contexts: ['ctx.routing'], load: 0.1, success_rate: 0.9, novelty: 0.8 });
  routing.observeAgent({ agent_id: 'agent_beta', status: 'READY', provider: 'openai', capabilities: ['memory', 'research'], contexts: [], load: 0.8, success_rate: 0.55, novelty: 0.3 });
  const route = routing.route({ required_capabilities: ['memory', 'research'], context_id: 'ctx.routing', task_key: 'hybrid-memory' });
  assert.equal(route.candidates[0].agent_id, 'agent_alpha');
  assert.ok(route.candidates[0].why_selected.includes('CONTEXT_LOCALITY'));
  assert.equal(route.candidates[0].assignment_created, false);
  assert.equal(route.current_scheduler_remains_authority, true);
  assert.equal(route.scheduler_authority, false);
});

test('stall detector turns repeated no-progress cycles into autonomous replan, never effect retry', () => {
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => 40_000 });
  runtime.recordTask({ context_id: 'ctx.stall', task_id: 'task.stall', objective: 'work that stopped making progress' });
  runtime.claimWork({ claim_id: 'claim.stall', context_id: 'ctx.stall', task_id: 'task.stall', agent_id: 'agent_alpha', scope: 'stall-scope' });
  let decision;
  for (let i = 0; i < 5; i += 1) decision = runtime.decideAutonomousContinuation({ context_id: 'ctx.stall', agent_id: 'agent_alpha' });
  assert.equal(decision.action, 'REPLAN_STALLED_CONTEXT');
  assert.equal(decision.continue_autonomously, true);
  assert.equal(decision.user_confirmation_required, false);
  assert.equal(decision.automatic_destructive_retry_allowed, false);
});

test('adaptive sparse fanout stays within 1-5 and respects parallelizability and cost budget', () => {
  assert.equal(planAdaptiveSparseFanout({ parallelizability: 0.1, cost_budget_units: 10 }).fanout, 1);
  assert.equal(planAdaptiveSparseFanout({ parallelizability: 0.5, cost_budget_units: 10 }).fanout, 2);
  assert.equal(planAdaptiveSparseFanout({ parallelizability: 0.95, cost_budget_units: 10 }).fanout, 5);
  assert.equal(planAdaptiveSparseFanout({ parallelizability: 0.95, cost_budget_units: 2 }).fanout, 2);
  assert.equal(planAdaptiveSparseFanout({ parallelizability: 0.7, cost_budget_units: 10, risk: 0.9 }).fanout, 2);
});

test('A2A adapter is a zero-authority v1 object-model boundary and never replaces internal runtime', () => {
  const adapter = new BrowserBrainA2AAdapter();
  const task = adapter.toA2ATask({ task: { context_id: 'ctx.a2a', task_id: 'task.a2a', status: 'COMPLETED', progress_revision: 2 }, messages: [], artifacts: [] });
  assert.equal(task.contextId, 'ctx.a2a');
  assert.equal(task.status.state, 'completed');
  const ingress = adapter.fromA2AMessage({ messageId: 'external-1', contextId: 'ctx.a2a', role: 'agent', parts: [{ text: 'untrusted result' }] }, { source_agent_id: 'agent_external' });
  assert.equal(ingress.external_data_untrusted, true);
  assert.match(ingress.body_digest, /^sha256:/);
  assert.equal(adapter.snapshot().internal_runtime_replaced, false);
  assert.equal(adapter.snapshot().current_scheduler_remains_only_scheduler, true);
});

test('journal compaction remains replayable and keeps active task creation before latest progress', () => {
  const journal = new BrowserBrainCollaborationJournal({ clock: () => 50_000, maxEntries: 64 });
  journal.append('TASK_RECORDED', { context_id: 'ctx.compact', task_id: 'task.compact', objective: 'keep me' });
  for (let i = 0; i < 100; i += 1) journal.append('MESSAGE_RECORDED', { message_id: `msg.${i}`, context_id: 'ctx.compact', source_agent_id: 'agent_alpha', target: 'topic:compact', kind: 'FACT', body_digest: DIGEST });
  journal.append('TASK_ADVANCED', { task_id: 'task.compact', progress_revision: 2, status: 'COMPLETED' });
  const kinds = journal.entries({ task_id: 'task.compact' }).map((row) => row.kind);
  assert.ok(kinds.includes('TASK_RECORDED'));
  assert.ok(kinds.includes('TASK_ADVANCED'));
  assert.ok(journal.snapshot().entry_count <= 64);
});
