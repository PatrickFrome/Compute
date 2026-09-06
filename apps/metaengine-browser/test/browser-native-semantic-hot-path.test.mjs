import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserNativeSemanticHotPath } from '../src/browser-native-semantic-hot-path.mjs';

function node(role, name, backendDOMNodeId) {
  return { role: { value: role }, name: { value: name }, backendDOMNodeId };
}

function projectTargets(nodes = []) {
  return nodes.map((row) => ({
    role: String(row?.role?.value || '').toLowerCase(),
    name: String(row?.name?.value || ''),
    backend_node_id: Number(row?.backendDOMNodeId || 0),
  })).filter((row) => row.role && row.name && row.backend_node_id > 0);
}

function debuggerStub() {
  let full = 0;
  let partial = 0;
  const nodes = [node('button', 'Send', 7)];
  return {
    bindingIdentity() {
      return { web_contents_id: 42, target_id: 'target-42', attachment_generation: 1, document_generation: 3, binding_generation: 5 };
    },
    async sendCommand(method, params) {
      if (method === 'Accessibility.getFullAXTree') {
        full += 1;
        return { nodes };
      }
      if (method === 'Accessibility.getPartialAXTree') {
        partial += 1;
        assert.equal(params.backendNodeId, 7);
        assert.equal(params.fetchRelatives, false);
        return { nodes: [node('button', 'Send', 7)] };
      }
      throw new Error(`unexpected:${method}`);
    },
    counts() { return { full, partial }; },
  };
}

test('capture seeds cache and resolve uses narrow revalidation', async () => {
  const dbg = debuggerStub();
  const hotPath = new BrowserNativeSemanticHotPath();
  const captured = await hotPath.capture({ dbg, projectTargets });
  assert.equal(captured.cache_seeded, true);
  const resolved = await hotPath.resolve({ dbg, role: 'button', name: 'Send', projectTargets });
  assert.equal(resolved.target.backend_node_id, 7);
  assert.equal(resolved.revalidated, true);
  assert.deepEqual(dbg.counts(), { full: 1, partial: 1 });
});

test('native error vocabulary is preserved for callers', async () => {
  const dbg = debuggerStub();
  const hotPath = new BrowserNativeSemanticHotPath();
  await assert.rejects(
    hotPath.resolve({ dbg, role: 'button', name: 'Missing', projectTargets }),
    /native_semantic_target_not_found/,
  );
});

test('hot path exposes no scheduler lease effect or retry authority', () => {
  const snapshot = new BrowserNativeSemanticHotPath().snapshot();
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.effect_execution_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.final_effect_fence_required, true);
  assert.equal(snapshot.canonical_stop_generation_full_tree_required, true);
  assert.equal(snapshot.canonical_submit_outcome_full_tree_required, true);
});
