import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sourceModule from '../src/repo-source-tracker.cjs';

const { RepoSourceTracker } = sourceModule;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-source-tracker-'));
  await mkdir(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/work\n', 'utf8');
  await writeFile(path.join(root, '.git', 'refs', 'heads', 'work'), `${'a'.repeat(40)}\n`, 'utf8');
  return root;
}

test('warm get returns cached source without a second refresh', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const noopWatcher = { on() { return this; }, close() {} };
  const tracker = new RepoSourceTracker({ repoRoot: root, repository: 'PatrickFrome/Compute', watcherFactory: () => noopWatcher });
  t.after(() => tracker.close());

  const first = await tracker.get();
  const second = await tracker.get();

  assert.equal(first.head, 'a'.repeat(40));
  assert.equal(second.head, first.head);
  assert.equal(tracker.snapshot().refresh_count, 1);
  assert.equal(tracker.snapshot().warm_get_filesystem_reads, 0);
});

test('git event invalidates cached source and resolves new same-ref HEAD', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  let callback = null;
  const watcherFactory = (_target, _options, cb) => {
    callback ??= cb;
    return { on() { return this; }, close() {} };
  };
  const tracker = new RepoSourceTracker({ repoRoot: root, repository: 'PatrickFrome/Compute', watcherFactory });
  t.after(() => tracker.close());

  await tracker.get();
  await writeFile(path.join(root, '.git', 'refs', 'heads', 'work'), `${'b'.repeat(40)}\n`, 'utf8');
  callback('change', 'work');
  const next = await tracker.get();

  assert.equal(next.head, 'b'.repeat(40));
  assert.equal(tracker.snapshot().refresh_count, 2);
  assert.equal(tracker.snapshot().source_epoch, 1);
});

test('packed-refs resolves branch when loose ref is absent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-source-packed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/packed-work\n', 'utf8');
  await writeFile(path.join(root, '.git', 'packed-refs'), `${'c'.repeat(40)} refs/heads/packed-work\n`, 'utf8');
  const tracker = new RepoSourceTracker({ repoRoot: root, repository: 'PatrickFrome/Compute', watcherFactory: () => ({ on() { return this; }, close() {} }) });
  t.after(() => tracker.close());

  const source = await tracker.get();
  assert.equal(source.head, 'c'.repeat(40));
  assert.equal(source.ref, 'refs/heads/packed-work');
});

test('packaged source snapshot is used when .git is absent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-source-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, '.metaengine-source-provenance.json'), JSON.stringify({
    schema: 'metaengine.devos.packaged-source-snapshot.v1',
    repository: 'PatrickFrome/Compute',
    head: 'd'.repeat(40),
    ref: 'refs/heads/release',
  }), 'utf8');
  const tracker = new RepoSourceTracker({ repoRoot: root, repository: 'PatrickFrome/Compute' });
  const source = await tracker.get();
  assert.equal(source.packaged_source_snapshot, true);
  assert.equal(source.head, 'd'.repeat(40));
});
