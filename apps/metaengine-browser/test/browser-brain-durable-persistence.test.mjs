import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BrowserBrainDurablePersistence } from '../src/browser-brain-durable-persistence.mjs';

test('durable checkpoint store atomically persists and reloads collaboration state', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-brain-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'brain.json');
  const store = new BrowserBrainDurablePersistence({ filePath });
  assert.equal(store.loadSync(), null);
  const checkpoint = { schema: 'metaengine.browser-brain.collaboration-checkpoint.v1', version: 1, entries: [], checkpoint_sha256: 'a'.repeat(64) };
  const saved = await store.save(checkpoint);
  assert.equal(saved.ok, true);
  assert.deepEqual(store.loadSync(), checkpoint);
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true);
  assert.equal(store.snapshot().atomic_temp_rename, true);
  assert.equal(store.snapshot().checkpoint_body_authority, false);
});

test('malformed persistence is ignored as unavailable data instead of granting authority', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-brain-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'brain.json');
  await fs.writeFile(filePath, '{broken', { mode: 0o600 });
  const store = new BrowserBrainDurablePersistence({ filePath });
  assert.equal(store.loadSync(), null);
  assert.equal(store.snapshot().load_error_count, 1);
  assert.equal(store.snapshot().execution_authority, false);
});
