import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const sourceSha = 'a'.repeat(40);
const candidateId = \`candidate_sha256_\${'c'.repeat(64)}\`;

test('runtime persists episode transitions before applying them and replays them after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-episode-runtime-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const first = new RsiRuntimeService({ source_sha: sourceSha, ledgerPath });
    await first.start();
    const trustRootSetDigest = first.snapshot().episodes.trust_root_set_digest;

    await first.openEpisode({
      episode_id: 'episode:runtime:1',
      observation_digest: '1'.repeat(64),
      opportunity_id: 'opportunity:runtime:1',
      hypothesis_digest: '2'.repeat(64),
      mutation_surface: 'BROWSER_RUNTIME',
      search_context_digest: '3'.repeat(64),
      max_candidates: 4,
    });
    await first.registerEpisodeCandidate({
      episode_id: 'episode:runtime:1',
      candidate_id: candidateId,
      candidate_sha: 'c'.repeat(40),
      parent_sha: sourceSha,
      build_plan_digest: '4'.repeat(64),
      mutation_surface: 'BROWSER_RUNTIME',
    });
    await first.recordEpisodeEvidence({
      episode_id: 'episode:runtime:1',
      candidate_id: candidateId,
      evidence_id: 'evidence:runtime:hard-invariants',
      evidence_kind: 'HARD_INVARIANTS',
      evidence_digest: '5'.repeat(64),
      result: 'PASS',
      source_sha: sourceSha,
      trust_root_set_digest: trustRootSetDigest,
    });

    assert.equal(first.snapshot().episodes.episode_count, 1);
    assert.equal(first.snapshot().episodes.candidate_count, 1);
    assert.equal(first.episodeNominationReadiness({
      episode_id: 'episode:runtime:1',
      candidate_id: candidateId,
    }).ready, false);

    const second = new RsiRuntimeService({ source_sha: sourceSha, ledgerPath });
    await second.start();
    assert.deepEqual(second.snapshot().episodes, first.snapshot().episodes);
    const readiness = second.episodeNominationReadiness({
      episode_id: 'episode:runtime:1',
      candidate_id: candidateId,
    });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.missing_evidence_kinds.includes('HOLDOUT'));
    assert.equal(readiness.execution_authority, false);
    assert.equal(readiness.promotion_authority, false);
    assert.equal(readiness.self_update_authority, false);
    assert.equal(readiness.automatic_retry_allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime ledger replay cursor is bounded and monotonic', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-episode-replay-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: sourceSha, ledgerPath });
    await runtime.start();
    await runtime.openEpisode({
      episode_id: 'episode:runtime:cursor',
      observation_digest: '6'.repeat(64),
      opportunity_id: 'opportunity:runtime:cursor',
      hypothesis_digest: '7'.repeat(64),
      mutation_surface: 'RSI_IMPROVER',
      search_context_digest: '8'.repeat(64),
      max_candidates: 2,
    });
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.episodes.episode_count, 1);
    assert.equal(snapshot.episodes.authority_effect, false);
    assert.equal(snapshot.episodes.scheduler_authority, false);
    assert.equal(snapshot.episodes.browser_authority, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
