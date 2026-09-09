import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureNativeSemanticRuntime,
  invalidateNativeSemanticRuntime,
  nativeSemanticRuntimeSnapshot,
  resolveNativeSemanticRuntime,
} from '../src/browser-native-semantic-runtime.mjs';

const projectTargets = (nodes = []) => nodes
  .map(({ role, name, backendDOMNodeId }) => ({
    role: String(role?.value || '').toLowerCase(),
    name: String(name?.value || ''),
    backend_node_id: Number(backendDOMNodeId || 0),
  }))
  .filter(({ role, name, backend_node_id: backendNodeId }) => role && name && backendNodeId > 0);

function debuggerStub({ webContentsId = 501, targetId = 'target-501', backendNodeId = 71 } = {}) {
  const counters = { full: 0, partial: 0 };
  const nodes = [{ role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: backendNodeId }];
  const handlers = {
    'Accessibility.getFullAXTree': () => {
      counters.full += 1;
      return { nodes };
    },
    'Accessibility.getPartialAXTree': (params) => {
      counters.partial += 1;
      assert.deepEqual(
        { backendNodeId: params.backendNodeId, fetchRelatives: params.fetchRelatives },
        { backendNodeId, fetchRelatives: false },
      );
      return { nodes };
    },
  };
  return {
    bindingIdentity: () => ({
      web_contents_id: webContentsId,
      target_id: targetId,
      attachment_generation: 2,
      document_generation: 4,
      binding_generation: 6,
    }),
    async sendCommand(method, params) {
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected:${method}`);
      return handler(params);
    },
    counts: () => ({ ...counters }),
  };
}

async function resolveSend(dbg) {
  return resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
}

test('capture and later resolution share one generation-fenced runtime cache', async () => {
  const dbg = debuggerStub();
  await captureNativeSemanticRuntime({ dbg, projectTargets });
  const resolved = await resolveSend(dbg);
  assert.equal(resolved.target.backend_node_id, 71);
  assert.equal(resolved.revalidated, true);
  assert.deepEqual(dbg.counts(), { full: 1, partial: 1 });
});

test('explicit WebContents invalidation prevents stale partial reuse', async () => {
  const dbg = debuggerStub({ webContentsId: 777, targetId: 'target-777', backendNodeId: 91 });
  await captureNativeSemanticRuntime({ dbg, projectTargets });
  invalidateNativeSemanticRuntime(777);
  const resolved = await resolveSend(dbg);
  assert.equal(resolved.target.backend_node_id, 91);
  assert.equal(resolved.revalidated, false);
  assert.deepEqual(dbg.counts(), { full: 2, partial: 0 });
});

test('semantic runtime remains observation-only and requires final effect fencing', () => {
  const snapshot = nativeSemanticRuntimeSnapshot();
  assert.equal(snapshot.shared_capture_resolution_cache, true);
  assert.deepEqual(
    {
      authority_effect: snapshot.authority_effect,
      scheduler_authority: snapshot.scheduler_authority,
      lease_authority: snapshot.lease_authority,
      effect_execution_authority: snapshot.effect_execution_authority,
      automatic_retry_allowed: snapshot.automatic_retry_allowed,
      final_effect_fence_required: snapshot.final_effect_fence_required,
    },
    {
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
      final_effect_fence_required: true,
    },
  );
});
