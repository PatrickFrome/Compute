import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainEpisodicMemory } from '../src/browser-brain-episodic-memory.mjs';

const SHA_A = '7'.repeat(40);
const SHA_B = '8'.repeat(40);

test('hybrid retrieval never exceeds the hard token budget, including the first result', () => {
  const memory = new BrowserBrainEpisodicMemory({ clock: () => 1_000 });
  memory.recordEpisode({
    episode_id: 'episode.large-budget',
    context_id: 'ctx.large-budget',
    task_id: 'task.large-budget',
    objective: 'x'.repeat(1024),
    outcome: 'COMPLETED',
    base_sha: SHA_A,
  });

  const result = memory.retrieve({
    query: 'xxx',
    context_id: 'ctx.large-budget',
    base_sha: SHA_A,
    token_budget: 128,
  });

  assert.equal(result.results.length, 0);
  assert.equal(result.estimated_tokens_used, 0);
  assert.ok(result.estimated_tokens_used <= result.token_budget);
});

test('exact base-sha retrieval excludes unversioned and mismatched episodes', () => {
  const memory = new BrowserBrainEpisodicMemory({ clock: () => 2_000 });
  memory.recordEpisode({
    episode_id: 'episode.unversioned',
    context_id: 'ctx.sha-filter',
    task_id: 'task.unversioned',
    objective: 'shared retrieval marker',
    outcome: 'COMPLETED',
  });
  memory.recordEpisode({
    episode_id: 'episode.wrong-sha',
    context_id: 'ctx.sha-filter',
    task_id: 'task.wrong-sha',
    objective: 'shared retrieval marker',
    outcome: 'COMPLETED',
    base_sha: SHA_B,
  });
  memory.recordEpisode({
    episode_id: 'episode.exact-sha',
    context_id: 'ctx.sha-filter',
    task_id: 'task.exact-sha',
    objective: 'shared retrieval marker',
    outcome: 'COMPLETED',
    base_sha: SHA_A,
  });

  const result = memory.retrieve({
    query: 'shared retrieval marker',
    context_id: 'ctx.sha-filter',
    base_sha: SHA_A,
    token_budget: 512,
  });

  assert.deepEqual(result.results.map((row) => row.episode.episode_id), ['episode.exact-sha']);
  assert.equal(result.exact_base_sha_required_when_filtered, true);
  assert.throws(() => memory.retrieve({ query: 'shared', base_sha: 'not-a-sha' }), /retrieval_base_sha_invalid/);
});

test('episode eviction removes stale semantic and procedural support references', () => {
  let now = 3_000;
  const memory = new BrowserBrainEpisodicMemory({ clock: () => now++, maxEpisodes: 64 });
  for (let index = 0; index < 65; index += 1) {
    memory.recordEpisode({
      episode_id: `episode.eviction-${index}`,
      context_id: `ctx.eviction-${index}`,
      task_id: `task.eviction-${index}`,
      objective: 'repeat bounded-memory lesson',
      outcome: 'COMPLETED',
      verified_facts: ['bounded support must reference retained episodes only'],
      next_actions: ['preserve bounded support provenance'],
      base_sha: SHA_A,
    });
  }

  assert.equal(memory.snapshot().episode_count, 64);
  assert.equal(memory.semanticFacts().length, 1);
  assert.equal(memory.semanticFacts()[0].support_count, 64);
  assert.ok(!memory.semanticFacts()[0].supporting_episode_ids.includes('episode.eviction-0'));
  assert.equal(memory.playbooks().length, 1);
  assert.equal(memory.playbooks()[0].support_count, 64);
});

test('reset removes all episodic, semantic and procedural state before replay', () => {
  const memory = new BrowserBrainEpisodicMemory({ clock: () => 4_000 });
  for (const suffix of ['a', 'b']) {
    memory.recordEpisode({
      episode_id: `episode.reset-${suffix}`,
      context_id: `ctx.reset-${suffix}`,
      task_id: `task.reset-${suffix}`,
      objective: 'resettable memory',
      outcome: 'COMPLETED',
      verified_facts: ['reset removes prior support'],
      next_actions: ['rebuild only from restored journal'],
      base_sha: SHA_A,
    });
  }
  assert.equal(memory.semanticFacts().length, 1);

  const snapshot = memory.reset();
  assert.equal(snapshot.episode_count, 0);
  assert.equal(snapshot.semantic_fact_count, 0);
  assert.equal(snapshot.procedural_playbook_count, 0);
  assert.deepEqual(memory.semanticFacts(), []);
  assert.deepEqual(memory.playbooks(), []);
});
