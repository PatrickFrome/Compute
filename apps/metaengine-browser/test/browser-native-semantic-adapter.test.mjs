import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserNativeSemanticAdapter } from '../src/browser-native-semantic-adapter.mjs';

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

function debuggerHarness({ documentGeneration = 9 } = {}) {
  const calls = [];
  return {
    calls,
    bindingIdentity() {
      return {
        web_contents_id: 17,
        target_id: 'target-17',
        attachment_generation: 4,
        document_generation: documentGeneration,
        binding_generation: 12,
      };
    },
    async sendCommand(method, params) {
      calls.push([method, params]);
      if (method === 'Accessibility.getFullAXTree') return { nodes: nodes() };
      if (method === 'Accessibility.getPartialAXTree') return { nodes: nodes() };
      throw new Error(`unexpected:${method}`);
    },
  };
}

test('canonical native capture seeds one generation-scoped fast path', async () => {
  const adapter = new BrowserNativeSemanticAdapter();
  const dbg = debuggerHarness();
  const capture = await adapter.capture({ dbg, projectTargets });
  const target = await adapter.resolve({
    dbg,
    role: 'textbox',
    name: 'Message ChatGPT',
    projectTargets,
  });
  assert.equal(capture.cache_seeded, true);
  assert.equal(target.resolution, 'CACHE_REVALIDATED');
  assert.deepEqual(dbg.calls.map(([method]) => method), [
    'Accessibility.getFullAXTree',
    'Accessibility.getPartialAXTree',
  ]);
});

test('native document generation drift never reuses stale backend node', async () => {
  const adapter = new BrowserNativeSemanticAdapter();
  const first = debuggerHarness({ documentGeneration: 9 });
  await adapter.capture({ dbg: first, projectTargets });
  const second = debuggerHarness({ documentGeneration: 10 });
  const target = await adapter.resolve({
    dbg: second,
    role: 'textbox',
    name: 'Message ChatGPT',
    projectTargets,
  });
  assert.equal(target.resolution, 'FULL_TREE');
  assert.deepEqual(second.calls.map(([method]) => method), ['Accessibility.getFullAXTree']);
});

test('missing persistent debugger runtime identity fails closed before semantic observation', async () => {
  const adapter = new BrowserNativeSemanticAdapter();
  let observations = 0;
  const dbg = {
    async sendCommand() {
      observations += 1;
      return { nodes: nodes() };
    },
  };
  await assert.rejects(
    adapter.resolve({ dbg, role: 'textbox', name: 'Message ChatGPT', projectTargets }),
    /native_semantic_adapter_runtime_identity_required/,
  );
  assert.equal(observations, 0);
});

test('adapter remains observation-only and requires existing final physical effect fence', () => {
  const snapshot = new BrowserNativeSemanticAdapter().snapshot();
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.final_effect_fence_required, true);
  assert.equal(snapshot.semantic_fast_path.authority_effect, false);
});
