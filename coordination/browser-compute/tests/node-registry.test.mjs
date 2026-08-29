import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserNode, NodeRegistry, NODE_CAPABILITIES, NODE_HEALTH } from '../../browser-shared/node-registry.mjs';

test('BrowserNode requires nodeId and endpoint', () => {
  assert.throws(() => new BrowserNode(), /node_id_required/);
  assert.throws(() => new BrowserNode({ nodeId: 'n1' }), /node_endpoint_required/);
  assert.throws(() => new BrowserNode({ nodeId: '', endpoint: 'e' }), /node_id_required/);
  assert.throws(() => new BrowserNode({ nodeId: 'n1', endpoint: '' }), /node_endpoint_required/);
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'http://e' });
  assert.equal(node.nodeId, 'n1');
  assert.equal(node.endpoint, 'http://e');
});

test('BrowserNode toJSON includes all fields', () => {
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'e', capabilities: [NODE_CAPABILITIES.ACTUATION], nodeType: 'local' });
  const json = node.toJSON();
  assert.equal(json.nodeId, 'n1');
  assert.equal(json.endpoint, 'e');
  assert.deepEqual(json.capabilities, ['actuation']);
  assert.equal(json.nodeType, 'local');
  assert.equal(json.health, 'unknown');
  assert.ok(json.registeredAt);
});

test('NodeRegistry register/deregister', () => {
  const registry = new NodeRegistry();
  registry.staleThresholdMs = 50;
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'e' });
  registry.register(node);
  assert.equal(registry.get('n1'), node);
  assert.equal(registry.getAll().length, 1);
  registry.deregister('n1');
  assert.equal(registry.get('n1'), null);
  assert.equal(registry.getAll().length, 0);
});

test('NodeRegistry assign returns null when no healthy nodes', () => {
  const registry = new NodeRegistry();
  registry.staleThresholdMs = 50;
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'e' });
  registry.register(node);
  assert.equal(registry.assign(NODE_CAPABILITIES.ACTUATION), null);
});

test('NodeRegistry assign returns first healthy node', () => {
  const registry = new NodeRegistry();
  registry.staleThresholdMs = 50;
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'e', capabilities: [NODE_CAPABILITIES.ACTUATION] });
  registry.register(node);
  node.updateHealth(NODE_HEALTH.HEALTHY);
  const assigned = registry.assign(NODE_CAPABILITIES.ACTUATION);
  assert.equal(assigned, node);
});

test('NodeRegistry round-robin assignment', () => {
  const registry = new NodeRegistry();
  const n1 = new BrowserNode({ nodeId: 'n1', endpoint: 'e1', capabilities: [NODE_CAPABILITIES.ACTUATION] });
  const n2 = new BrowserNode({ nodeId: 'n2', endpoint: 'e2', capabilities: [NODE_CAPABILITIES.ACTUATION] });
  registry.register(n1);
  registry.register(n2);
  n1.updateHealth(NODE_HEALTH.HEALTHY);
  n2.updateHealth(NODE_HEALTH.HEALTHY);
  const a1 = registry.assign(NODE_CAPABILITIES.ACTUATION);
  const a2 = registry.assign(NODE_CAPABILITIES.ACTUATION);
  const a3 = registry.assign(NODE_CAPABILITIES.ACTUATION);
  assert.notEqual(a1, a2);
  assert.equal(a3, a1);
});

test('NodeRegistry markStale degrades stale healthy nodes', () => {
  const registry = new NodeRegistry();
  registry.staleThresholdMs = 50;
  const node = new BrowserNode({ nodeId: 'n1', endpoint: 'e' });
  registry.register(node);
  node.updateHealth(NODE_HEALTH.HEALTHY);
  node.lastHealthCheck = new Date(Date.now() - 20000).toISOString();
  registry.markStale();
  assert.equal(node.health, NODE_HEALTH.DEGRADED);
});

test('LocalNodeRegistry starts with local node', async () => {
  const runtime = { stateRoot: '/tmp/test', health: async () => ({ ok: true, profiles: [] }) };
  const { LocalNodeRegistry } = await import('../src/node-registry.mjs');
  const registry = new LocalNodeRegistry(runtime);
  const node = await registry.start();
  assert.equal(node.nodeId, 'node-test');
  assert.equal(node.nodeType, 'local');
  assert.deepEqual(node.capabilities, ['actuation', 'perception', 'context_management', 'target_management']);
});

test('LocalNodeRegistry checks health on interval', async () => {
  const healthCalls = [];
  const runtime = {
    stateRoot: '/tmp/test2',
    health: async () => { healthCalls.push(1); return { ok: true, profiles: [] }; }
  };
  const { LocalNodeRegistry } = await import('../src/node-registry.mjs');
  const registry = new LocalNodeRegistry(runtime, { healthCheckIntervalMs: 50 });
  await registry.start();
  assert.equal(healthCalls.length, 1);
  await new Promise((r) => setTimeout(r, 6000));
  assert.ok(healthCalls.length >= 2);
  await registry.stop();
});


