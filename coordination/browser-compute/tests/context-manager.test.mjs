import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONTEXT_KIND, DEFAULT_CONTEXT_ID, ProfileContextManager } from '../src/context-manager.mjs';

class FakeCdp {
  constructor() { this.next = 1; this.disposed = []; }
  async call(method, params = {}) {
    if (method === 'Target.createBrowserContext') return { browserContextId: `physical-${this.next++}` };
    if (method === 'Target.disposeBrowserContext') { this.disposed.push(params.browserContextId); return {}; }
    throw new Error(`unexpected_method:${method}`);
  }
}

test('B2 contexts keep logical identity separate from physical CDP bindings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-context-'));
  const cdp = new FakeCdp();
  const bindings = new Map();
  const manager = new ProfileContextManager({ profileDir: root, cdp, bindings });
  try {
    await manager.ensure();
    const initial = await manager.list();
    assert.deepEqual(initial.map((row) => row.context_id), [DEFAULT_CONTEXT_ID]);
    assert.equal(initial[0].context_kind, CONTEXT_KIND.PERSISTENT_DEFAULT);

    const alpha = await manager.create({ contextId: 'context_alpha' });
    const beta = await manager.create({ contextId: 'context_beta' });
    assert.equal(alpha.context_kind, CONTEXT_KIND.EPHEMERAL_ISOLATED);
    assert.equal(beta.context_kind, CONTEXT_KIND.EPHEMERAL_ISOLATED);
    assert.notEqual(manager.resolvePhysical(alpha.context_id), manager.resolvePhysical(beta.context_id));

    const durable = await fs.readFile(path.join(root, 'contexts.json'), 'utf8');
    assert.doesNotMatch(durable, /physical-/);
    assert.doesNotMatch(durable, /cookie|storage_state|authorization|secret/i);

    await assert.rejects(manager.close(DEFAULT_CONTEXT_ID), /default_context_close_forbidden/);
    const physicalAlpha = manager.resolvePhysical(alpha.context_id);
    const closed = await manager.close(alpha.context_id);
    assert.equal(closed.physical_disposed, true);
    assert.deepEqual(cdp.disposed, [physicalAlpha]);
    assert.throws(() => manager.resolvePhysical(alpha.context_id), /context_not_bound/);

    const rows = await manager.list({ includeRetired: true });
    assert.equal(rows.find((row) => row.context_id === 'context_alpha')?.status, 'RETIRED');
    assert.equal(rows.find((row) => row.context_id === 'context_beta')?.status, 'ACTIVE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an unbound logical context may be safely reincarnated with a higher epoch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-context-epoch-'));
  try {
    const firstBindings = new Map();
    const first = new ProfileContextManager({ profileDir: root, cdp: new FakeCdp(), bindings: firstBindings });
    const original = await first.create({ contextId: 'context_worker' });
    assert.equal(original.context_epoch, 1);

    const secondBindings = new Map();
    const second = new ProfileContextManager({ profileDir: root, cdp: new FakeCdp(), bindings: secondBindings });
    const rebound = await second.create({ contextId: 'context_worker' });
    assert.equal(rebound.context_epoch, 2);
    assert.equal(rebound.context_id, original.context_id);
    assert.ok(secondBindings.has('context_worker'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
