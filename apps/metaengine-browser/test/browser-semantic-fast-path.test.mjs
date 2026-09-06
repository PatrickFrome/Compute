import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSemanticFastPath } from '../src/browser-semantic-fast-path.mjs';

const runtime = (overrides = {}) => ({
  web_contents_id: 17,
  target_id: 'target-17',
  attachment_generation: 4,
  document_generation: 9,
  binding_generation: 12,
  ...overrides,
});

const nodes = () => ([{
  ignored: false,
  role: { value: 'textbox' },
  name: { value: 'Message ChatGPT' },
  backendDOMNodeId: 4401,
}]);

const projectTargets = (rows) => rows.map((node) => ({
  role: node.role.value,
  name: node.name.value,
  backend_node_id: node.backendDOMNodeId,
}));

test('capture seeds cache so next exact target resolution uses only narrow partial AXTree', async () => {
  const calls = [];
  const dbg = {
    async sendCommand(method, params) {
      calls.push([method, params]);
      if (method === 'Accessibility.getFullAXTree') return { nodes: nodes() };
      if (method === 'Accessibility.getPartialAXTree') return { nodes: nodes() };
      throw new Error(`unexpected:${method}`);
    },
  };
  const fastPath = new BrowserSemanticFastPath();
  const captured = await fastPath.capture({ dbg, runtime: runtime(), projectTargets });
  const resolved = await fastPath.resolve({
    dbg,
    runtime: runtime(),
    role: 'textbox',
    name: 'Message ChatGPT',
    projectTargets,
  });
  assert.equal(captured.cache_seeded, true);
  assert.equal(resolved.resolution, 'CACHE_REVALIDATED');
  assert.deepEqual(calls.map(([method]) => method), [
    'Accessibility.getFullAXTree',
    'Accessibility.getPartialAXTree',
  ]);
});

test('cold lookup performs one full-tree fallback, seeds cache, then becomes narrow', async () => {
  let fullCalls = 0;
  let partialCalls = 0;
  const dbg = {
    async sendCommand(method) {
      if (method === 'Accessibility.getFullAXTree') {
        fullCalls += 1;
        return { nodes: nodes() };
      }
      if (method === 'Accessibility.getPartialAXTree') {
        partialCalls += 1;
        return { nodes: nodes() };
      }
      throw new Error(`unexpected:${method}`);
    },
  };
  const fastPath = new BrowserSemanticFastPath();
  const first = await fastPath.resolve({ dbg, runtime: runtime(), role: 'textbox', name: 'Message ChatGPT', projectTargets });
  const second = await fastPath.resolve({ dbg, runtime: runtime(), role: 'textbox', name: 'Message ChatGPT', projectTargets });
  assert.equal(first.resolution, 'FULL_TREE');
  assert.equal(second.resolution, 'CACHE_REVALIDATED');
  assert.equal(fullCalls, 1);
  assert.equal(partialCalls, 1);
});

test('runtime generation drift bypasses cached backend node and requires fresh canonical tree', async () => {
  const fastPath = new BrowserSemanticFastPath();
  let fullCalls = 0;
  let partialCalls = 0;
  const dbg = {
    async sendCommand(method) {
      if (method === 'Accessibility.getFullAXTree') {
        fullCalls += 1;
        return { nodes: nodes() };
      }
      if (method === 'Accessibility.getPartialAXTree') {
        partialCalls += 1;
        return { nodes: nodes() };
      }
      throw new Error(`unexpected:${method}`);
    },
  };
  await fastPath.capture({ dbg, runtime: runtime(), projectTargets });
  await fastPath.resolve({
    dbg,
    runtime: runtime({ document_generation: 10 }),
    role: 'textbox',
    name: 'Message ChatGPT',
    projectTargets,
  });
  assert.equal(fullCalls, 2);
  assert.equal(partialCalls, 0);
});

test('ambiguous full-tree fallback fails closed and never manufactures target authority', async () => {
  const dbg = {
    async sendCommand(method) {
      assert.equal(method, 'Accessibility.getFullAXTree');
      return { nodes: [...nodes(), ...nodes().map((node) => ({ ...node, backendDOMNodeId: 4402 }))] };
    },
  };
  const fastPath = new BrowserSemanticFastPath();
  await assert.rejects(
    fastPath.resolve({ dbg, runtime: runtime(), role: 'textbox', name: 'Message ChatGPT', projectTargets }),
    /semantic_fast_path_target_ambiguous:2/,
  );
});

test('fast path exposes no scheduler, lease, execution or retry authority', () => {
  const snapshot = new BrowserSemanticFastPath().snapshot();
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.cache.authority_effect, false);
});
