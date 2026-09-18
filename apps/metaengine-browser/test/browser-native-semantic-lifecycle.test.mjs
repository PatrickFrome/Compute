import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  captureNativeSemanticRuntime,
  resolveNativeSemanticRuntime,
} from '../src/browser-native-semantic-runtime.mjs';
import {
  bindNativeSemanticRuntimeLifecycle,
  nativeSemanticLifecycleSnapshot,
} from '../src/browser-native-semantic-lifecycle.mjs';

const projectTargets = (nodes = []) => nodes.map((node) => ({
  role: String(node?.role?.value || '').toLowerCase(),
  name: String(node?.name?.value || ''),
  backend_node_id: Number(node?.backendDOMNodeId || 0),
})).filter((row) => row.role && row.name && row.backend_node_id > 0);

function debuggerStub(webContentsId) {
  const counts = { full: 0, partial: 0 };
  const nodes = [{ role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 73 }];
  return {
    bindingIdentity: () => ({
      web_contents_id: webContentsId,
      target_id: `target-${webContentsId}`,
      attachment_generation: 1,
      document_generation: 1,
      binding_generation: 1,
    }),
    async sendCommand(method) {
      if (method === 'Accessibility.getFullAXTree') {
        counts.full += 1;
        return { nodes };
      }
      if (method === 'Accessibility.getPartialAXTree') {
        counts.partial += 1;
        return { nodes };
      }
      throw new Error(`unexpected:${method}`);
    },
    counts: () => ({ ...counts }),
  };
}

class WebContentsStub extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
  }
}

async function seedAndResolve(dbg) {
  await captureNativeSemanticRuntime({ dbg, projectTargets });
  return resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
}

test('main-frame navigation invalidates shared semantic cache before later resolution', async () => {
  const webContents = new WebContentsStub(901);
  const dbg = debuggerStub(901);
  assert.equal(bindNativeSemanticRuntimeLifecycle(webContents), true);
  assert.equal(bindNativeSemanticRuntimeLifecycle(webContents), false);

  const first = await seedAndResolve(dbg);
  assert.equal(first.revalidated, true);
  assert.deepEqual(dbg.counts(), { full: 1, partial: 1 });

  webContents.emit('did-start-navigation', {}, 'https://example.test/next', false, true);
  const second = await resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
  assert.equal(second.revalidated, false);
  assert.deepEqual(dbg.counts(), { full: 2, partial: 1 });
});

test('subframe navigation does not evict the main-frame semantic cache', async () => {
  const webContents = new WebContentsStub(902);
  const dbg = debuggerStub(902);
  bindNativeSemanticRuntimeLifecycle(webContents);
  await captureNativeSemanticRuntime({ dbg, projectTargets });

  webContents.emit('did-start-navigation', {}, 'https://example.test/frame', false, false);
  const resolved = await resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
  assert.equal(resolved.revalidated, true);
  assert.deepEqual(dbg.counts(), { full: 1, partial: 1 });
});

test('renderer loss and destruction invalidate cache and lifecycle remains zero-authority', async () => {
  const webContents = new WebContentsStub(903);
  const dbg = debuggerStub(903);
  bindNativeSemanticRuntimeLifecycle(webContents);
  await captureNativeSemanticRuntime({ dbg, projectTargets });

  webContents.emit('render-process-gone');
  let resolved = await resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
  assert.equal(resolved.revalidated, false);

  await captureNativeSemanticRuntime({ dbg, projectTargets });
  webContents.emit('destroyed');
  resolved = await resolveNativeSemanticRuntime({ dbg, role: 'button', name: 'Send', projectTargets });
  assert.equal(resolved.revalidated, false);

  assert.equal(webContents.listenerCount('did-start-navigation'), 0);
  assert.equal(webContents.listenerCount('render-process-gone'), 0);
  const snapshot = nativeSemanticLifecycleSnapshot();
  assert.deepEqual(
    {
      authority_effect: snapshot.authority_effect,
      scheduler_authority: snapshot.scheduler_authority,
      lease_authority: snapshot.lease_authority,
      effect_execution_authority: snapshot.effect_execution_authority,
      automatic_retry_allowed: snapshot.automatic_retry_allowed,
    },
    {
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
    },
  );
});
