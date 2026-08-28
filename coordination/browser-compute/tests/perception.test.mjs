import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureSemanticSnapshot, compileSemanticSnapshot, PERCEPTION_COMPUTED_STYLES } from '../src/perception.mjs';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { atomicJsonWrite } from '../src/security.mjs';

const IDENTITY = {
  targetId: 'semantic-target',
  cdpTargetId: 'engine-target-secret',
  conversationEpoch: 3,
  processIncarnationId: '99999999-9999-4999-8999-999999999999'
};
const NODE_KEY = Buffer.alloc(32, 7);

function domFixture() {
  return {
    strings: [
      '#document', 'HTML', 'BUTTON', 'block', 'visible', '1', 'auto',
      'type', 'button', 'Click me', 'about:blank', 'frame-1', 'UTF-8'
    ],
    documents: [{
      documentURL: 10,
      title: -1,
      baseURL: 10,
      contentLanguage: -1,
      encodingName: 12,
      publicId: -1,
      systemId: -1,
      frameId: 11,
      nodes: {
        parentIndex: [-1, 0, 1],
        nodeType: [9, 1, 1],
        nodeName: [0, 1, 2],
        nodeValue: [-1, -1, -1],
        backendNodeId: [101, 102, 103],
        attributes: [[], [], [7, 8]]
      },
      layout: {
        nodeIndex: [1, 2],
        styles: [[3, 4, 5, 6], [3, 4, 5, 6]],
        bounds: [[0, 0, 800, 600], [10, 20, 120, 40]],
        text: [-1, 9],
        paintOrders: [1, 2]
      }
    }]
  };
}

function axFixture() {
  return {
    nodes: [
      {
        nodeId: 'ax-root-secret',
        ignored: false,
        role: { type: 'role', value: 'RootWebArea' },
        name: { type: 'computedString', value: '' },
        backendDOMNodeId: 101
      },
      {
        nodeId: 'ax-button-secret',
        parentId: 'ax-root-secret',
        ignored: false,
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'Click me' },
        description: { type: 'computedString', value: 'Safe action' },
        properties: [
          { name: 'focusable', value: { type: 'booleanOrUndefined', value: true } },
          { name: 'url', value: { type: 'string', value: 'https://secret.invalid' } }
        ],
        backendDOMNodeId: 103
      },
      {
        nodeId: 'ax-virtual-secret',
        parentId: 'ax-root-secret',
        ignored: false,
        role: { type: 'role', value: 'StaticText' },
        name: { type: 'computedString', value: 'unbound virtual node' }
      }
    ]
  };
}

test('compiler joins AX semantics to DOM layout and redacts every engine identity', () => {
  const compiled = compileSemanticSnapshot({
    domSnapshot: domFixture(),
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 4,
    nodeKey: NODE_KEY
  });
  assert.equal(compiled.snapshot.scope, 'MAIN_TARGET');
  assert.equal(compiled.snapshot.oopif_complete, false);
  assert.equal(compiled.snapshot.consistency, 'SEQUENTIAL_READ_ONLY');
  assert.equal(compiled.snapshot.actuation_eligible, false);
  assert.equal(compiled.snapshot.nodes.length, 2);
  assert.equal(compiled.snapshot.nodes[1].role, 'button');
  assert.equal(compiled.snapshot.nodes[1].name, 'Click me');
  assert.deepEqual(compiled.snapshot.nodes[1].bounds, [10, 20, 120, 40]);
  assert.equal(compiled.snapshot.nodes[1].visible, true);
  assert.deepEqual(compiled.snapshot.nodes[1].state, { focusable: 'true' });
  assert.equal(compiled.snapshot.nodes[1].parent_node_id, compiled.snapshot.nodes[0].node_id);
  assert.match(compiled.snapshot.nodes[1].node_id, /^node_[a-f0-9]{32}$/);
  assert.match(compiled.snapshot.snapshot_id, /^snapshot_[a-f0-9]{64}$/);
  const serialized = JSON.stringify(compiled.snapshot);
  assert.doesNotMatch(serialized, /engine-target-secret|ax-root-secret|ax-button-secret|backend|sessionId|backendDOMNodeId|103/);
  assert.doesNotMatch(serialized, /secret\.invalid/);
  assert.equal(compiled.nodeBindings.get(compiled.snapshot.nodes[1].node_id).backendNodeId, 103);
});

test('snapshot hash and opaque node ids are deterministic only under the exact causal identity', () => {
  const args = { domSnapshot: domFixture(), axTree: axFixture(), identity: IDENTITY, sessionGeneration: 4, nodeKey: NODE_KEY };
  const first = compileSemanticSnapshot(args).snapshot;
  const second = compileSemanticSnapshot(args).snapshot;
  assert.equal(first.snapshot_id, second.snapshot_id);
  assert.deepEqual(first.nodes, second.nodes);
  const rotated = compileSemanticSnapshot({ ...args, sessionGeneration: 5 }).snapshot;
  assert.notEqual(first.snapshot_id, rotated.snapshot_id);
  assert.notEqual(first.nodes[0].node_id, rotated.nodes[0].node_id);
  const rekeyed = compileSemanticSnapshot({ ...args, nodeKey: crypto.randomBytes(32) }).snapshot;
  assert.notEqual(first.nodes[0].node_id, rekeyed.nodes[0].node_id);
});

test('compiler rejects sparse tables, invalid joins, and daemon-owned limit overflow', () => {
  const sparse = domFixture();
  delete sparse.documents[0].nodes.nodeType[1];
  assert.throws(() => compileSemanticSnapshot({ domSnapshot: sparse, axTree: axFixture(), identity: IDENTITY, sessionGeneration: 1, nodeKey: NODE_KEY }), /snapshot_node_types_invalid_sparse/);

  const badLayout = domFixture();
  badLayout.documents[0].layout.nodeIndex[0] = 99;
  assert.throws(() => compileSemanticSnapshot({ domSnapshot: badLayout, axTree: axFixture(), identity: IDENTITY, sessionGeneration: 1, nodeKey: NODE_KEY }), /snapshot_layout_node_index_invalid/);

  assert.throws(() => compileSemanticSnapshot({
    domSnapshot: domFixture(),
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY,
    limits: { maxDomNodes: 2 }
  }), /snapshot_dom_nodes_too_many/);
});

test('compiler accepts Chromium empty-string sentinel only in producer-defined fields', () => {
  const emptyAttribute = domFixture();
  emptyAttribute.documents[0].nodes.attributes[2][1] = -1;
  assert.doesNotThrow(() => compileSemanticSnapshot({
    domSnapshot: emptyAttribute,
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY
  }));

  const invalidNodeValue = domFixture();
  invalidNodeValue.documents[0].nodes.nodeValue[0] = -2;
  assert.throws(() => compileSemanticSnapshot({
    domSnapshot: invalidNodeValue,
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY
  }), /snapshot_node_value_index_invalid/);

  const sentinelNodeName = domFixture();
  sentinelNodeName.documents[0].nodes.nodeName[0] = -1;
  assert.throws(() => compileSemanticSnapshot({
    domSnapshot: sentinelNodeName,
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY
  }), /snapshot_node_name_index_invalid/);

  const sentinelAttributeName = domFixture();
  sentinelAttributeName.documents[0].nodes.attributes[2][0] = -1;
  assert.throws(() => compileSemanticSnapshot({
    domSnapshot: sentinelAttributeName,
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY
  }), /snapshot_attribute_name_index_invalid/);

  const sentinelStyle = domFixture();
  sentinelStyle.documents[0].layout.styles[0][0] = -1;
  assert.throws(() => compileSemanticSnapshot({
    domSnapshot: sentinelStyle,
    axTree: axFixture(),
    identity: IDENTITY,
    sessionGeneration: 1,
    nodeKey: NODE_KEY
  }), /snapshot_layout_style_index_invalid/);
});

test('capture uses exactly two read-only CDP methods with daemon-owned parameters', async () => {
  const calls = [];
  const scheduler = {
    async run(identity, operation, options) {
      assert.deepEqual(identity, IDENTITY);
      assert.equal(options.deadlineMs, 10000);
      return operation({
        sessionGeneration: 4,
        async call(method, params) {
          calls.push({ method, params });
          if (method === 'DOMSnapshot.captureSnapshot') return domFixture();
          if (method === 'Accessibility.getFullAXTree') return axFixture();
          throw new Error('unexpected_method');
        }
      });
    }
  };
  const result = await captureSemanticSnapshot({ scheduler, identity: IDENTITY, nodeKey: NODE_KEY, capturedAt: '2026-08-28T00:00:00.000Z' });
  assert.deepEqual(calls, [
    {
      method: 'DOMSnapshot.captureSnapshot',
      params: { computedStyles: [...PERCEPTION_COMPUTED_STYLES], includePaintOrder: true, includeDOMRects: false }
    },
    { method: 'Accessibility.getFullAXTree', params: {} }
  ]);
  assert.equal(result.snapshot.captured_at, '2026-08-28T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(calls), /Runtime\.evaluate|script|javascript/i);
});

test('detach or identity loss between DOM and AX yields no partial snapshot', async () => {
  const scheduler = {
    async run(_identity, operation) {
      let calls = 0;
      return operation({
        sessionGeneration: 1,
        async call() {
          calls += 1;
          if (calls === 1) return domFixture();
          throw new Error('snapshot_stale');
        }
      });
    }
  };
  await assert.rejects(captureSemanticSnapshot({ scheduler, identity: IDENTITY, nodeKey: NODE_KEY }), /snapshot_stale/);
});

test('runtime snapshot path enforces registry epoch and returns only the typed redacted view', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-perception-runtime-'));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = 'perception-profile';
  try {
    await runtime.init();
    await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
    await atomicJsonWrite(path.join(runtime.profileDir(profileId), 'targets.json'), {
      schema: 'metaengine.a2-compute-browser.targets.v1',
      revision: 1,
      updated_at: '2026-08-28T00:00:00.000Z',
      targets: [{ target_id: 'semantic-target', status: 'ACTIVE', conversation_epoch: 3 }]
    });
    const scheduler = {
      async run(identity, operation) {
        assert.deepEqual(identity, IDENTITY);
        return operation({
          sessionGeneration: 4,
          async call(method) {
            if (method === 'DOMSnapshot.captureSnapshot') return domFixture();
            if (method === 'Accessibility.getFullAXTree') return axFixture();
            throw new Error('unexpected_method');
          }
        });
      },
      dispose() {}
    };
    runtime.running.set(profileId, {
      processRef: {
        processIncarnationId: IDENTITY.processIncarnationId,
        isRunning: () => true,
        stop: async () => {},
        cdp: {}
      },
      bindings: new Map([['semantic-target', {
        cdp_target_id: IDENTITY.cdpTargetId,
        process_incarnation_id: IDENTITY.processIncarnationId,
        conversation_epoch: 3
      }]]),
      contextBindings: new Map(),
      sessionScheduler: scheduler,
      perceptionNodeKey: NODE_KEY,
      perceptionBindings: new Map(),
      meta: {},
      lockFile: null
    });
    const snapshot = await runtime.snapshotTarget({ profileId, targetId: 'semantic-target' });
    assert.equal(snapshot.target_id, 'semantic-target');
    assert.equal(snapshot.nodes.length, 2);
    assert.doesNotMatch(JSON.stringify(snapshot), /engine-target-secret|backendDOMNodeId|sessionId/);
    assert.equal(runtime.running.get(profileId).perceptionBindings.get('semantic-target').nodes.size, 2);

    runtime.running.get(profileId).bindings.get('semantic-target').conversation_epoch = 2;
    await assert.rejects(runtime.snapshotTarget({ profileId, targetId: 'semantic-target' }), /target_binding_stale/);
  } finally {
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
