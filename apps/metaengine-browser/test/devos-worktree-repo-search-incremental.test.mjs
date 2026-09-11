import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-worktree-incremental-'));
  await mkdir(path.join(root, 'apps/metaengine-browser/src'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/test'), { recursive: true });
  await mkdir(path.join(root, 'apps/metaengine-browser/supabase'), { recursive: true });
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await writeFile(path.join(root, 'apps/metaengine-browser/src/example.mjs'), 'export const oldNeedle = true;\n', 'utf8');
  await writeFile(path.join(root, 'apps/metaengine-browser/src/other.mjs'), 'export const stableNeedle = true;\n', 'utf8');
  return root;
}

test('same-head content change refreshes exactly one indexed file without full rebuild', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root });
  const first = await index.query(source(), { query: 'oldNeedle' });
  await writeFile(path.join(root, 'apps/metaengine-browser/src/example.mjs'), 'export const replacementNeedle = true;\n', 'utf8');
  index.invalidate({ event_type: 'change', relative_path: 'apps/metaengine-browser/src/example.mjs' });
  const second = await index.query(source(), { query: 'replacementNeedle' });
  assert.equal(first.total_hits, 1);
  assert.equal(second.total_hits, 1);
  assert.equal(second.incremental_refresh, true);
  assert.equal(second.full_index_rebuild, false);
  assert.equal(second.incremental_files_refreshed, 1);
  assert.equal(second.index_rebuilt, true);
  assert.notEqual(second.index_revision, first.index_revision);
  const snap = index.snapshot();
  assert.equal(snap.incremental_refresh_count, 1);
  assert.equal(snap.incremental_file_reads, 1);
  assert.equal(snap.full_rebuild_count, 0);
  assert.equal(snap.last_refresh_mode, 'INCREMENTAL_FILE_REFRESH');
});

test('coalesced duplicate change events read one file once', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root });
  await index.query(source(), { query: 'oldNeedle' });
  await writeFile(path.join(root, 'apps/metaengine-browser/src/example.mjs'), 'export const coalescedNeedle = true;\n', 'utf8');
  index.invalidate({ event_type: 'change', relative_path: 'apps/metaengine-browser/src/example.mjs' });
  index.invalidate({ event_type: 'change', relative_path: 'apps/metaengine-browser/src/example.mjs' });
  const result = await index.query(source(), { query: 'coalescedNeedle' });
  assert.equal(result.incremental_refresh, true);
  assert.equal(result.incremental_files_refreshed, 1);
  assert.equal(index.snapshot().incremental_file_reads, 1);
});

test('structural rename remains fail-safe full rebuild', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = new WorktreeAwareDevOSRepoSearchIndex({ repoRoot: root });
  await index.query(source(), { query: 'oldNeedle' });
  await rename(
    path.join(root, 'apps/metaengine-browser/src/example.mjs'),
    path.join(root, 'apps/metaengine-browser/src/renamed.mjs'),
  );
  index.invalidate({ event_type: 'rename', relative_path: 'apps/metaengine-browser/src/example.mjs' });
  const result = await index.query(source(), { query: 'oldNeedle' });
  assert.equal(result.incremental_refresh, false);
  assert.equal(result.full_index_rebuild, true);
  assert.equal(result.total_hits, 1);
  assert.equal(result.hits[0].path, 'apps/metaengine-browser/src/renamed.mjs');
  assert.equal(index.snapshot().full_rebuild_count, 1);
});
