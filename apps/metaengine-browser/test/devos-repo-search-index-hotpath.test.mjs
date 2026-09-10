import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import repoSearchModule from '../src/devos-repo-search-index.cjs';

const { DevOSRepoSearchIndex } = repoSearchModule;
const source = () => ({
  repository: 'PatrickFrome/Compute',
  head: 'a'.repeat(40),
  ref: 'refs/heads/work/browser-host-agent-p0',
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-repo-search-hotpath-'));
  await mkdir(path.join(root, 'apps/metaengine-browser/src'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/test'), { recursive: true });
  await writeFile(path.join(root, 'apps/metaengine-browser/src/partial.mjs'), 'const boundedNavigation = true;\n', 'utf8');
  await writeFile(path.join(root, 'apps/metaengine-browser/test/exact.test.mjs'), "test('boundedNavigation emergency path', () => {});\n", 'utf8');
  return root;
}

test('warm repo search moves path/evidence normalization to build time', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const snapshot = (await index.ensure(source())).snapshot;
  assert.equal(snapshot.warm_query_path_tokenization, 'BUILD_TIME');
  assert.equal(snapshot.warm_query_evidence_normalization, 'BUILD_TIME');
  assert.equal(snapshot.warm_query_candidate_strategy, 'EXACT_INTERSECTION_THEN_BOUNDED_TOP_K');
  assert.equal(snapshot.authority_effect, false);
});

test('exact posting intersection excludes partial rows when a full match exists', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const result = await index.query(source(), { query: 'boundedNavigation emergency', limit: 8 });
  assert.equal(result.match_mode, 'ALL_TERMS');
  assert.equal(result.total_hits, 1);
  assert.equal(result.hits[0].path, 'apps/metaengine-browser/test/exact.test.mjs');
});

test('bounded top-k preserves deterministic ranking and total hit count', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['zeta.mjs', 'alpha.mjs', 'middle.mjs']) {
    await writeFile(path.join(root, 'apps/metaengine-browser/src', name), 'const sharedNeedle = true;\n', 'utf8');
  }
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const result = await index.query(source(), { query: 'sharedNeedle', limit: 2 });
  assert.equal(result.total_hits, 3);
  assert.deepEqual(result.hits.map((hit) => hit.path), [
    'apps/metaengine-browser/src/alpha.mjs',
    'apps/metaengine-browser/src/middle.mjs',
  ]);
  assert.equal(result.truncated, true);
});
