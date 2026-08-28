import assert from 'node:assert/strict';
import test from 'node:test';
import { webMcpEnvelopeFromCdpTools, unsupportedWebMcpEnvelope } from '../../browser-shared/webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../../browser-shared/webmcp-catalog-v1.mjs';
import { computeDocumentEpoch } from '../src/perception-envelope.mjs';
import { ComputePlanningBrokerService } from '../src/planning-broker-service.mjs';

const profileId = 'route_profile';
const targetId = 'route_target';
const contextId = 'default';
const conversationEpoch = 3;
const incarnation = '99999999-9999-4999-8999-999999999999';
const nodeKey = Buffer.alloc(32, 7);

function domFixture() {
  return {
    strings: ['#document', 'HTML', 'BUTTON', 'block', 'visible', '1', 'auto', 'type', 'button', 'Click me', 'about:blank', 'frame-1', 'UTF-8'],
    documents: [{
      documentURL: 10, title: -1, baseURL: 10, contentLanguage: -1, encodingName: 12, publicId: -1, systemId: -1, frameId: 11,
      nodes: {
        parentIndex: [-1, 0, 1], nodeType: [9, 1, 1], nodeName: [0, 1, 2], nodeValue: [-1, -1, -1],
        backendNodeId: [101, 102, 103], attributes: [[], [], [7, 8]]
      },
      layout: {
        nodeIndex: [1, 2], styles: [[3, 4, 5, 6], [3, 4, 5, 6]],
        bounds: [[0, 0, 800, 600], [10, 20, 120, 40]], text: [-1, 9], paintOrders: [1, 2]
      }
    }]
  };
}

function axFixture() {
  return { nodes: [
    { nodeId: 'ax-root', ignored: false, role: { type: 'role', value: 'RootWebArea' }, name: { type: 'computedString', value: '' }, backendDOMNodeId: 101 },
    {
      nodeId: 'ax-button', parentId: 'ax-root', ignored: false,
      role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Click me' },
      description: { type: 'computedString', value: 'Safe action' },
      properties: [{ name: 'focusable', value: { type: 'booleanOrUndefined', value: true } }], backendDOMNodeId: 103
    }
  ] };
}

class PerceptionScheduler {
  constructor(loaderId = 'loader-a') { this.loaderId = loaderId; this.calls = []; }
  async run(_identity, operation) {
    const call = async (method, params = {}) => {
      this.calls.push({ method, params });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-main', loaderId: this.loaderId } } };
      if (method === 'DOMSnapshot.captureSnapshot') return domFixture();
      if (method === 'Accessibility.getFullAXTree') return axFixture();
      throw new Error(`unexpected_method:${method}`);
    };
    return operation({ call, sessionGeneration: 1 });
  }
}

function runtimeFixture() {
  const scheduler = new PerceptionScheduler();
  const entry = {
    processRef: {
      cdp: {}, processIncarnationId: incarnation,
      isRunning: () => true
    },
    sessionScheduler: scheduler,
    perceptionNodeKey: nodeKey,
    bindings: new Map([[targetId, {
      cdp_target_id: 'engine-target-secret', process_incarnation_id: incarnation, conversation_epoch: conversationEpoch
    }]])
  };
  return {
    scheduler,
    runtime: {
      running: new Map([[profileId, entry]]),
      listTargets: async () => [{
        target_id: targetId, status: 'ACTIVE', bound: true, context_id: contextId, conversation_epoch: conversationEpoch
      }],
      listContexts: async () => [{ context_id: contextId, status: 'ACTIVE', bound: true }]
    }
  };
}

function currentDocumentEpoch(loaderId = 'loader-a') {
  return computeDocumentEpoch({ loaderId, targetId, conversationEpoch, nodeKey });
}

function rawTool(index) {
  return {
    name: `route_tool_${index}`,
    description: `Use route tool ${index} to perform a structured page operation.`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    annotations: { readOnly: true, consequential: false },
    frameId: 'frame-main'
  };
}

function supportedCatalog({ count = 3, documentEpoch = currentDocumentEpoch() } = {}) {
  return compileWebMcpCatalog(webMcpEnvelopeFromCdpTools(
    Array.from({ length: count }, (_, index) => rawTool(index)),
    {
      targetId, contextId, conversationEpoch, documentEpoch,
      mainFrameId: 'frame-main', capturedAt: '2026-08-28T15:30:00.000Z'
    }
  ));
}

function unsupportedCatalog() {
  return compileWebMcpCatalog(unsupportedWebMcpEnvelope({
    targetId, contextId, conversationEpoch, documentEpoch: currentDocumentEpoch(),
    capturedAt: '2026-08-28T15:30:00.000Z', reason: 'CDP_WEBMCP_UNAVAILABLE'
  }));
}

test('cold leader with WebMCP tools receives routing index and no semantic envelope', async () => {
  const { runtime } = runtimeFixture();
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ count: 8 }) } });
  const result = await service.lookup({ profileId, targetId, intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(result.lookup.status, 'MISS_LEADER');
  assert.equal(result.planner_context_surface, 'WEBMCP_ROUTING_INDEX');
  assert.equal(result.planning_envelope, null);
  assert.equal(result.webmcp_routing_index.tool_count, 8);
  assert.equal(result.planner_context_bytes, Buffer.byteLength(JSON.stringify(result.webmcp_routing_index)));
  const serialized = JSON.stringify(result.webmcp_routing_index);
  assert.equal(serialized.includes('input_schema'), false);
  assert.equal(serialized.includes('annotations'), false);
  assert.equal(result.authority_effect, false);
  service.abort({ profileId, flightId: result.lookup.flight_id, leaseToken: result.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('unsupported, empty, and malformed WebMCP degrade to semantic perception without authority', async () => {
  const cases = [
    ['unsupported', { catalog: async () => unsupportedCatalog() }],
    ['empty', { catalog: async () => supportedCatalog({ count: 0 }) }],
    ['invalid', { catalog: async () => { throw new Error('webmcp_catalog_tool_ref_invalid'); } }]
  ];
  for (const [intentSuffix, webMcpService] of cases) {
    const { runtime } = runtimeFixture();
    const service = new ComputePlanningBrokerService(runtime, { webMcpService });
    const result = await service.lookup({ profileId, targetId, intentId: `intent_${intentSuffix}`, actionKind: 'CLICK' });
    assert.equal(result.lookup.status, 'MISS_LEADER');
    assert.equal(result.planner_context_surface, 'SEMANTIC_PERCEPTION');
    assert.ok(result.planning_envelope?.nodes?.length > 0);
    assert.equal(result.webmcp_routing_index, null);
    assert.equal(result.authority_effect, false);
    assert.ok(['WEBMCP_UNSUPPORTED', 'WEBMCP_NO_TOOLS', 'WEBMCP_DISCOVERY_INVALID'].includes(result.webmcp_degraded_reason));
    service.abort({ profileId, flightId: result.lookup.flight_id, leaseToken: result.lookup.lease_token, reasonCode: 'TEST_DONE' });
  }
});

test('waiters receive no planner context and promoted cache hits continue to skip model context', async () => {
  const { runtime } = runtimeFixture();
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ count: 2 }) } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'repeat', actionKind: 'CLICK' });
  const waiter = await service.lookup({ profileId, targetId, intentId: 'repeat', actionKind: 'CLICK' });
  assert.equal(waiter.lookup.status, 'WAIT_FOR_PROMOTION');
  assert.equal(waiter.planner_context_surface, 'NONE');
  assert.equal(waiter.planner_context_bytes, 0);
  assert.equal(waiter.planning_envelope, null);
  assert.equal(waiter.webmcp_routing_index, null);

  const freshContext = await service.context({
    profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION'
  });
  const candidateRef = freshContext.planning_envelope.nodes.find((node) => node.role === 'button').ref;
  await service.promote({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, candidateRef });

  const hit = await service.lookup({ profileId, targetId, intentId: 'repeat', actionKind: 'CLICK' });
  assert.equal(hit.lookup.status, 'HIT_REVALIDATED');
  assert.equal(hit.lookup.model_call_required, false);
  assert.equal(hit.planner_context_surface, 'NONE');
  assert.equal(hit.planner_context_bytes, 0);
  assert.equal(hit.planning_envelope, null);
  assert.equal(hit.webmcp_routing_index, null);
});

test('lease-bound semantic fallback uses a fresh same-document capture and rejects wrong or stale leases', async () => {
  const { runtime, scheduler } = runtimeFixture();
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ count: 2 }) } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'fallback', actionKind: 'CLICK' });
  await assert.rejects(service.context({
    profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: 'lease_wrong_XXXXXXXXXXXXXXXXXXXXXXXX', surface: 'SEMANTIC_PERCEPTION'
  }), /semantic_planning_broker_lease_invalid/);

  const fresh = await service.context({
    profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION'
  });
  assert.equal(fresh.revalidation.status, 'CONTEXT_REVALIDATED');
  assert.equal(fresh.fresh_capture_used, true);
  assert.equal(fresh.lease_bound, true);
  assert.equal(fresh.planner_context_bytes, Buffer.byteLength(JSON.stringify(fresh.planning_envelope)));

  scheduler.loaderId = 'loader-b';
  await assert.rejects(service.context({
    profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION'
  }), /semantic_planning_broker_namespace_changed/);
  scheduler.loaderId = 'loader-a';
  service.abort({ profileId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('fatal document mismatch during WebMCP routing aborts the unseen flight so the next caller can lead', async () => {
  const { runtime } = runtimeFixture();
  let mismatched = true;
  const service = new ComputePlanningBrokerService(runtime, {
    webMcpService: {
      catalog: async () => supportedCatalog({ documentEpoch: mismatched ? 'doc_wrong' : currentDocumentEpoch(), count: 2 })
    }
  });
  await assert.rejects(
    service.lookup({ profileId, targetId, intentId: 'recover', actionKind: 'CLICK' }),
    /planning_routing_namespace_changed/
  );
  assert.equal(service.stats({ profileId }).broker.in_flight_count, 0);
  mismatched = false;
  const retry = await service.lookup({ profileId, targetId, intentId: 'recover', actionKind: 'CLICK' });
  assert.equal(retry.lookup.status, 'MISS_LEADER');
  assert.equal(retry.planner_context_surface, 'WEBMCP_ROUTING_INDEX');
  service.abort({ profileId, flightId: retry.lookup.flight_id, leaseToken: retry.lookup.lease_token, reasonCode: 'TEST_DONE' });
});
