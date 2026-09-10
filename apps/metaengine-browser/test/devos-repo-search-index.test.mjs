import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import repoSearchModule from '../src/devos-repo-search-index.cjs';

const {
  DevOSRepoSearchIndex,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MAX_FILE_TOKENS,
} = repoSearchModule;

const source = (head = 'a'.repeat(40)) => ({
  repository: 'PatrickFrome/Compute',
  head,
  ref: 'refs/heads/work/browser-command-fabric-v2-p0',
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-repo-search-'));
  await mkdir(path.join(root, 'apps/metaengine-browser/src'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/test'), { recursive: true });
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  const lateTokens = Array.from({ length: 700 }, (_, i) => `uniqueToken${String(i).padStart(4, '0')}`).join(' ');
  await writeFile(path.join(root, 'apps/metaengine-browser/src/main.mjs'), `${lateTokens}\nconst emergencyAbortSignalNeedle = true;\n`, 'utf8');
  await writeFile(path.join(root, 'apps/metaengine-browser/test/example.test.mjs'), `test('boundedNavigation emergency path', () => {});\n`, 'utf8');
  await writeFile(path.join(root, '.github/workflows/browser.yml'), 'name: Browser Critical Audit\n', 'utf8');
  return root;
}

test('repo search indexes host-fixed roots once per exact HEAD and reuses cached postings', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });

  const first = await index.query(source(), { query: 'boundedNavigation emergency', limit: 8 });
  assert.equal(first.status, 'OK');
  assert.equal(first.index_rebuilt, true);
  assert.equal(first.search_strategy, 'HEAD_PLUS_WORKTREE_EVENT_INDEX');
  assert.equal(first.hits[0].path, 'apps/metaengine-browser/test/example.test.mjs');
  assert.equal(first.arbitrary_path_selection, false);
  assert.equal(first.process_spawn_used, false);
  assert.equal(first.authority_effect, false);

  const second = await index.query(source(), { query: 'boundedNavigation emergency', limit: 8 });
  assert.equal(second.index_rebuilt, false);
  assert.equal(second.worktree_refreshed, false);
  assert.equal(second.index_revision, first.index_revision);
  assert.equal(second.query_revision, first.query_revision);
});

test('file token coverage reaches symbols well beyond the old 256-token frontier', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const result = await index.query(source(), { query: 'emergencyAbortSignalNeedle' });
  assert.equal(result.total_hits, 1);
  assert.equal(result.hits[0].path, 'apps/metaengine-browser/src/main.mjs');
  assert.match(result.hits[0].snippet, /emergencyAbortSignalNeedle/);
  assert.ok(MAX_FILE_TOKENS > 256);
});

test('dirty working-tree event refreshes changed file without a HEAD change', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const first = await index.query(source(), { query: 'boundedNavigation' });
  await writeFile(path.join(root, 'apps/metaengine-browser/test/example.test.mjs'), `test('dirtyWorktreeNeedle commandScopedAbort replacement', () => {});\n`, 'utf8');
  index.notifyPathChanged('apps/metaengine-browser/test/example.test.mjs');
  const second = await index.query(source(), { query: 'dirtyWorktreeNeedle' });
  assert.equal(second.index_rebuilt, false);
  assert.equal(second.worktree_refreshed, true);
  assert.equal(second.worktree_epoch, 1);
  assert.notEqual(second.index_revision, first.index_revision);
  assert.equal(second.hits[0].path, 'apps/metaengine-browser/test/example.test.mjs');
});

test('exact HEAD change invalidates the cache and rebuilds source evidence', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const first = await index.query(source('a'.repeat(40)), { query: 'boundedNavigation' });
  await writeFile(path.join(root, 'apps/metaengine-browser/test/example.test.mjs'), `test('commandScopedAbort replacement', () => {});\n`, 'utf8');
  const second = await index.query(source('b'.repeat(40)), { query: 'commandScopedAbort' });
  assert.equal(second.index_rebuilt, true);
  assert.notEqual(second.index_revision, first.index_revision);
  assert.equal(second.hits[0].path, 'apps/metaengine-browser/test/example.test.mjs');
});

test('query revision returns a tiny unchanged envelope', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const first = await index.query(source(), { query: 'boundedNavigation' });
  const second = await index.query(source(), { query: 'boundedNavigation', if_none_match: first.query_revision });
  assert.equal(second.status, 'NOT_MODIFIED');
  assert.equal(second.index_rebuilt, false);
  assert.ok(second.bytes < 1024);
});

test('repo search is globally bounded and caller cannot select arbitrary paths or authority', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new DevOSRepoSearchIndex({ repoRoot: root });
  const snapshot = (await index.ensure(source())).snapshot;
  assert.ok(snapshot.indexed_file_count <= MAX_FILES);
  assert.ok(snapshot.indexed_bytes <= MAX_TOTAL_BYTES);
  assert.deepEqual(snapshot.allowed_roots, [
    'apps/metaengine-browser/src',
    'apps/metaengine-browser/test',
    'apps/metaengine-browser/supabase',
    '.github/workflows',
  ]);
  assert.equal(snapshot.arbitrary_path_selection, false);
  await assert.rejects(() => index.query(source(), { query: 'x', path: '/etc/passwd' }), /field_unknown/);
  await assert.rejects(() => index.query(source(), { query: 'x', authority_effect: true }), /authority_forbidden/);
});
