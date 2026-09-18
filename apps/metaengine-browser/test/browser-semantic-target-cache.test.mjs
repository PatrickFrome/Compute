import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserSemanticTargetCache,
  resolveSemanticTargetFast,
} from '../src/browser-semantic-target-cache.mjs';

const runtime = (overrides = {}) => ({
  web_contents_id: 17,
  target_id: 'target-17',
  attachment_generation: 4,
  document_generation: 9,
  binding_generation: 12,
  ...overrides,
});

const target = (overrides = {}) => ({
  role: 'textbox',
  name: 'Message ChatGPT',
  backend_node_id: 4401,
  ...overrides,
});

const partialNode = (overrides = {}) => ({
  ignored: false,
  role: { value: 'textbox' },
  name: { value: 'Message ChatGPT' },
  backendDOMNodeId: 4401,
  ...overrides,
});

test('cache hit uses one narrow partial AXTree revalidation and skips full tree', async () => {
  const cache = new BrowserSemanticTargetCache();
  assert.equal(cache.remember(runtime(), [target()]).accepted, true);
  const calls = [];
  const dbg = {
    async sendCommand(method, params) {
      calls.push([method, params]);
      return { nodes: [partialNode()] };
    },
  };
  let fullTreeCalls = 0;
  const resolved = await resolveSemanticTargetFast({
    dbg,
    cache,
    runtime: runtime(),
    role: 'textbox',
    name: 'Message ChatGPT',
    fullTreeResolver: async () => {
      fullTreeCalls += 1;
      return target();
    },
  });
  assert.equal(resolved.resolution, 'CACHE_REVALIDATED');
  assert.equal(resolved.backend_node_id, 4401);
  assert.equal(fullTreeCalls, 0);
  assert.deepEqual(calls, [[
    'Accessibility.getPartialAXTree',
    { backendNodeId: 4401, fetchRelatives: false },
  ]]);
});

test('document generation change invalidates cache identity before any partial lookup', async () => {
  const cache = new BrowserSemanticTargetCache();
  cache.remember(runtime(), [target()]);
  let partialCalls = 0;
  let fullTreeCalls = 0;
  const resolved = await resolveSemanticTargetFast({
    dbg: { async sendCommand() { partialCalls += 1; throw new Error('must_not_call'); } },
    cache,
    runtime: runtime({ document_generation: 10 }),
    role: 'textbox',
    name: 'Message ChatGPT',
    fullTreeResolver: async () => {
      fullTreeCalls += 1;
      return target({ backend_node_id: 5502 });
    },
  });
  assert.equal(partialCalls, 0);
  assert.equal(fullTreeCalls, 1);
  assert.equal(resolved.backend_node_id, 5502);
  assert.equal(resolved.resolution, 'FULL_TREE');
});

test('attachment and binding generation changes also fence cached backend node authority', async () => {
  for (const changed of [
    { attachment_generation: 5 },
    { binding_generation: 13 },
    { target_id: 'target-18' },
  ]) {
    const cache = new BrowserSemanticTargetCache();
    cache.remember(runtime(), [target()]);
    let partialCalls = 0;
    await resolveSemanticTargetFast({
      dbg: { async sendCommand() { partialCalls += 1; return { nodes: [partialNode()] }; } },
      cache,
      runtime: runtime(changed),
      role: 'textbox',
      name: 'Message ChatGPT',
      fullTreeResolver: async () => target(),
    });
    assert.equal(partialCalls, 0);
  }
});

test('partial AXTree mismatch is fail-soft to fresh full-tree resolution, never accepted as authority', async () => {
  const cache = new BrowserSemanticTargetCache();
  cache.remember(runtime(), [target()]);
  let fullTreeCalls = 0;
  const resolved = await resolveSemanticTargetFast({
    dbg: {
      async sendCommand(method) {
        assert.equal(method, 'Accessibility.getPartialAXTree');
        return { nodes: [partialNode({ name: { value: 'Different control' } })] };
      },
    },
    cache,
    runtime: runtime(),
    role: 'textbox',
    name: 'Message ChatGPT',
    fullTreeResolver: async () => {
      fullTreeCalls += 1;
      return target({ backend_node_id: 7703 });
    },
  });
  assert.equal(fullTreeCalls, 1);
  assert.equal(resolved.backend_node_id, 7703);
  assert.equal(resolved.resolution, 'FULL_TREE');
  assert.equal(cache.lookup(runtime(), 'textbox', 'Message ChatGPT'), null);
});

test('partial AXTree transport failure falls back once without retrying the narrow physical observation', async () => {
  const cache = new BrowserSemanticTargetCache();
  cache.remember(runtime(), [target()]);
  let partialCalls = 0;
  let fullTreeCalls = 0;
  const resolved = await resolveSemanticTargetFast({
    dbg: { async sendCommand() { partialCalls += 1; throw new Error('cdp_detached'); } },
    cache,
    runtime: runtime(),
    role: 'textbox',
    name: 'Message ChatGPT',
    fullTreeResolver: async () => {
      fullTreeCalls += 1;
      return target();
    },
  });
  assert.equal(partialCalls, 1);
  assert.equal(fullTreeCalls, 1);
  assert.equal(resolved.resolution, 'FULL_TREE');
});

test('duplicate semantic names are not cached and cache stays bounded', () => {
  const cache = new BrowserSemanticTargetCache({ maxCells: 2, maxTargetsPerCell: 2 });
  cache.remember(runtime(), [target(), target({ backend_node_id: 4402 })]);
  assert.equal(cache.lookup(runtime(), 'textbox', 'Message ChatGPT'), null);

  cache.remember(runtime({ web_contents_id: 18, target_id: 'target-18' }), [target({ name: 'A' }), target({ name: 'B' }), target({ name: 'C' })]);
  cache.remember(runtime({ web_contents_id: 19, target_id: 'target-19' }), [target({ name: 'D' })]);
  const snapshot = cache.snapshot();
  assert.equal(snapshot.cell_count, 2);
  assert.equal(snapshot.max_cells, 2);
  assert.equal(snapshot.max_targets_per_cell, 2);
});

test('cache exposes no scheduler, lease, execution or retry authority', () => {
  const snapshot = new BrowserSemanticTargetCache().snapshot();
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
});
