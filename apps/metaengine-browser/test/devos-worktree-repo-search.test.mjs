import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worktreeModule from '../src/devos-worktree-repo-search.cjs';

const { WorktreeAwareDevOSRepoSearchIndex } = worktreeModule;
const source = () => ({
  repository: 'PatrickFrome/Compute',
  head: 'a'.repeat(40),
  ref: 'refs/heads/work/browser-host-agent-p0',
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-worktree-search-'));
  await mkdir(path.join(root, 'apps/metaengine-browser/src'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/test'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/supabase'), { recursive: true });
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await writeFile(path.join(root, 'apps/metaengine-browser/src/example.mjs'), 'export const oldNeedle = true;\n', 'utf8');
  return root;
}

test('same HEAD edit becomes searchable after worktree event invalidation', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root });

  const first = await index.query(source(), { query: 'oldNeedle' });
  assert.equal(first.total_hits, 1);
  assert.equal(first.worktree_epoch, 0);
  assert.equal(first.search_strategy, 'HEAD_PLUS_WORKTREE_EVENT_INDEX');

  await writeFile(path.join(root, 'apps/metaengine-browser/src/example.mjs'), 'export const commandScopedAbortReplacement = true;\n', 'utf8');
  index.invalidate({ event_type: 'change', relative_path: 'apps/metaengine-browser/src/example.mjs' });

  const second = await index.query(source(), { query: 'commandScopedAbortReplacement' });
  assert.equal(second.total_hits, 1);
  assert.equal(second.hits[0].path, 'apps/metaengine-browser/src/example.mjs');
  assert.equal(second.worktree_epoch, 1);
  assert.equal(second.index_rebuilt, true);
  assert.notEqual(second.index_revision, first.index_revision);
  assert.notEqual(second.source_revision, first.source_revision);
});

test('warm same-head query after rebuild reuses postings without a new worktree epoch', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root });

  await index.query(source(), { query: 'oldNeedle' });
  index.invalidate({ event_type: 'change', relative_path: 'apps/metaengine-browser/src/example.mjs' });
  const rebuilt = await index.query(source(), { query: 'oldNeedle' });
  const warm = await index.query(source(), { query: 'oldNeedle' });

  assert.equal(rebuilt.index_rebuilt, true);
  assert.equal(warm.index_rebuilt, false);
  assert.equal(warm.worktree_epoch, rebuilt.worktree_epoch);
  assert.equal(warm.index_revision, rebuilt.index_revision);
  assert.equal(index.snapshot().warm_query_filesystem_reads, 0);
});

test('watcher callback is advisory and only invalidates source evidence', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  let callback = null;
  const fakeWatcher = { on() { return this; }, close() {} };
  const watcherFactory = (_root, _options, cb) => { callback ??= cb; return fakeWatcher; };
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root, watch: true, watcherFactory });
  t.after(() => index.close());

  const before = index.snapshot();
  callback('change', 'example.mjs');
  const after = index.snapshot();

  assert.equal(after.worktree_epoch, before.worktree_epoch + 1);
  assert.equal(after.dirty_pending_rebuild, true);
  assert.equal(after.watcher_is_authority, false);
  assert.equal(after.authority_effect, false);
});
