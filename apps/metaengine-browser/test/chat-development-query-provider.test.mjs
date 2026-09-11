import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatDevelopmentQueryProvider } from '../src/chat-development-query-provider.mjs';

function harness() {
  const calls = { repo: [], evidence: [] };
  let repoVersion = 1;
  let evidenceVersion = 1;
  const developmentPlane = {
    async request(capability, input) {
      calls.repo.push({ capability, input: structuredClone(input) });
      assert.equal(capability, 'DEVOS_REPO_SEARCH');
      const revision = `rq:repo:${repoVersion}`;
      if (input.if_none_match === revision) return { status: 'NOT_MODIFIED', query_revision: revision, authority_effect: false };
      return {
        status: 'OK',
        query_revision: revision,
        total_hits: 1,
        hits: [{ path: `src/repo-${repoVersion}.mjs`, line: 10, snippet: 'boundedNavigation commandScopedAbort', sha256: `sha256:${'a'.repeat(64)}`, score: 80, matched_terms: 2, authority_effect: false }],
        authority_effect: false,
      };
    },
  };
  const evidenceIndex = {
    query(input) {
      calls.evidence.push(structuredClone(input));
      const revision = `q:evidence:${evidenceVersion}`;
      if (input.if_none_match === revision) return { status: 'NOT_MODIFIED', query_revision: revision, authority_effect: false };
      return {
        status: 'OK',
        query_revision: revision,
        total_hits: 1,
        hits: [{ id: `ci:${evidenceVersion}`, kind: 'CI', title: 'Shell contract', text: 'stale assertion', ref: 'run:1', path: 'test/x.mjs', severity: 'HIGH', score: 50, matched_terms: 1, authority_effect: false }],
        authority_effect: false,
      };
    },
  };
  return {
    provider: new ChatDevelopmentQueryProvider({ developmentPlane, evidenceIndex }),
    calls,
    setRepoVersion(value) { repoVersion = value; },
    setEvidenceVersion(value) { evidenceVersion = value; },
  };
}

test('one dev query fans out repo and project evidence in parallel and returns one bounded response', async () => {
  const h = harness();
  const out = await h.provider.query({ query: 'boundedNavigation abort', limit: 8, max_bytes: 4096 });
  assert.equal(out.status, 'OK');
  assert.equal(out.parallel_fanout, 2);
  assert.equal(out.source_search, true);
  assert.equal(out.evidence_search, true);
  assert.equal(h.calls.repo.length, 1);
  assert.equal(h.calls.evidence.length, 1);
  assert.equal(out.hits.length, 2);
  assert.equal(out.hits[0].source, 'REPO');
  assert.ok(out.bytes <= 4096);
  assert.equal(out.network_reads_owned, 0);
  assert.equal(out.command_leasing_authority, false);
  assert.equal(out.authority_effect, false);
});

test('partial component change preserves unchanged cached evidence instead of dropping hits', async () => {
  const h = harness();
  const first = await h.provider.query({ query: 'boundedNavigation', limit: 8 });
  h.setRepoVersion(2);
  const second = await h.provider.query({ query: 'boundedNavigation', limit: 8, if_none_match: first.query_revision });
  assert.equal(second.status, 'OK');
  assert.notEqual(second.query_revision, first.query_revision);
  assert.equal(second.hits.some((hit) => hit.id === 'ci:1'), true);
  assert.equal(second.hits.some((hit) => hit.path === 'src/repo-2.mjs'), true);
  assert.equal(h.calls.evidence.at(-1).if_none_match, 'q:evidence:1');
});

test('unchanged repo and evidence collapse to a tiny not-modified chat turn', async () => {
  const h = harness();
  const first = await h.provider.query({ query: 'boundedNavigation', limit: 8 });
  const second = await h.provider.query({ query: 'boundedNavigation', limit: 8, if_none_match: first.query_revision });
  assert.equal(second.status, 'NOT_MODIFIED');
  assert.equal(second.query_revision, first.query_revision);
  assert.ok(second.bytes < 512);
});

test('SOURCE-only query skips project evidence and CI-only query skips repo utility process', async () => {
  const h = harness();
  const sourceOnly = await h.provider.query({ query: 'navigation', kinds: ['SOURCE'], limit: 4 });
  assert.equal(sourceOnly.parallel_fanout, 1);
  assert.equal(h.calls.repo.length, 1);
  assert.equal(h.calls.evidence.length, 0);

  const ciOnly = await h.provider.query({ query: 'contract', kinds: ['CI'], limit: 4 });
  assert.equal(ciOnly.parallel_fanout, 1);
  assert.equal(h.calls.repo.length, 1);
  assert.equal(h.calls.evidence.length, 1);
});

test('provider cache is bounded and mismatched etag request cannot reuse another query payload', async () => {
  const h = harness();
  const first = await h.provider.query({ query: 'alpha', limit: 4 });
  await h.provider.query({ query: 'beta', limit: 4, if_none_match: first.query_revision });
  assert.equal(h.calls.repo.at(-1).input.if_none_match, null);
  assert.equal(h.calls.evidence.at(-1).if_none_match, null);

  for (let i = 0; i < 80; i += 1) await h.provider.query({ query: `query-${i}`, kinds: ['CI'], limit: 2 });
  assert.ok(h.provider.snapshot().etag_cache_entries <= 64);
});
