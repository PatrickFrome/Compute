import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureNativeSemanticRuntime,
  invalidateNativeSemanticRuntime,
  nativeSemanticRuntimeSnapshot,
  resolveNativeSemanticRuntime,
} from '../src/browser-native-semantic-runtime.mjs';

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

function debuggerStub({ webContentsId = 501, targetId = 'target-501', backendNodeId = 71 } = {}) {
  let full = 0;
  let partial = 0;
  const nodes = [node('button', 'Send', backendNodeId)];
  return {
    bindingIdentity() {
      return {
        web_contents_id: webContentsId,
        target_id: targetId,
        attachment_generation: 2,
        document_generation: 4,
        binding_generation: 6,
      };
    },
    async sendCommand(method, params) {
      if (method === 'Accessibility.getFullAXTree') {
        full += 1;
        return { nodes };
      }
      if (method === 'Accessibility.getPartialAXTree') {
        partial += 1;
        assert.equal(params.backendNodeId, backendNodeId);
        assert.equal(params.fetchRelatives, false);
        return { nodes };
      }
      throw new Error(`unexpected:${method}`);
    },
    counts() { return { full, partial }; },
  };
}

test('capture and later resolution share one generation-fenced runtime cache', async () => {
  const dbg = debuggerStub();
  await captureNativeSemanticRuntime({ dbg, projectTargets });
  const resolved = await resolveNativeSemanticRuntime({
    dbg,
    role: 'button',
    name: 'Send',
    projectTargets,
  });
  assert.equal(resolved.target.backend_node_id, 71);
  assert.equal(resolved.revalidated, true);
  assert.deepEqual(dbg.counts(), { full: 1, partial: 1 });
});

test('explicit WebContents invalidation prevents stale partial reuse', async () => {
  const dbg = debuggerStub({ webContentsId: 777, targetId: 'target-777', backendNodeId: 91 });
  await captureNativeSemanticRuntime({ dbg, projectTargets });
  invalidateNativeSemanticRuntime(777);
  const resolved = await resolveNativeSemanticRuntime({
    dbg,
    role: 'button',
    name: 'Send',
    projectTargets,
  });
  assert.equal(resolved.target.backend_node_id, 91);
  assert.equal(resolved.revalidated, false);
  assert.deepEqual(dbg.counts(), { full: 2, partial: 0 });
});

test('semantic runtime remains observation-only and requires final effect fencing', () => {
  const snapshot = nativeSemanticRuntimeSnapshot();
  assert.equal(snapshot.shared_capture_resolution_cache, true);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.effect_execution_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.final_effect_fence_required, true);
});
