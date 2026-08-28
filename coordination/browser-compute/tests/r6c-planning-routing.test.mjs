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
  return { strings: ['#document','HTML','BUTTON','block','visible','1','auto','type','button','Click me','about:blank','frame-1','UTF-8'], documents: [{ documentURL: 10, title: -1, baseURL: 10, contentLanguage: -1, encodingName: 12, publicId: -1, systemId: -1, frameId: 11, nodes: { parentIndex: [-1,0,1], nodeType: [9,1,1], nodeName: [0,1,2], nodeValue: [-1,-1,-1], backendNodeId: [101,102,103], attributes: [[],[],[7,8]] }, layout: { nodeIndex: [1,2], styles: [[3,4,5,6],[3,4,5,6]], bounds: [[0,0,800,600],[10,20,120,40]], text: [-1,9], paintOrders: [1,2] } }] };
}
function axFixture() {
  return { nodes: [
    { nodeId: 'ax-root', ignored: false, role: { type: 'role', value: 'RootWebArea' }, name: { type: 'computedString', value: '' }, backendDOMNodeId: 101 },
    { nodeId: 'ax-button', parentId: 'ax-root', ignored: false, role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Click me' }, description: { type: 'computedString', value: 'Safe action' }, properties: [{ name: 'focusable', value: { type: 'booleanOrUndefined', value: true } }], backendDOMNodeId: 103 }
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
  const entry = { processRef: { cdp: {}, processIncarnationId: incarnation, isRunning: () => true }, sessionScheduler: scheduler, perceptionNodeKey: nodeKey, bindings: new Map([[targetId, { cdp_target_id: 'engine-target-secret', process_incarnation_id: incarnation, conversation_epoch: conversationEpoch }]]) };
  return { scheduler, runtime: { running: new Map([[profileId, entry]]), listTargets: async () => [{ target_id: targetId, status: 'ACTIVE', bound: true, context_id: contextId, conversation_epoch: conversationEpoch }], listContexts: async () => [{ context_id: contextId, status: 'ACTIVE', bound: true }] } };
}
function currentDocumentEpoch(loaderId = 'loader-a') { return computeDocumentEpoch({ loaderId, targetId, conversationEpoch, nodeKey }); }
function rawTool(index) {
  const named = [
    ['search_flights', 'Search flight schedules by origin and destination.'],
    ['book_flight', 'Book a selected airline itinerary.'],
    ['search_hotels', 'Search hotels by city and date.']
  ][index];
  return { name: named?.[0] || `route_tool_${index}`, description: named?.[1] || `Generic structured page capability ${index}.`, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, annotations: { readOnly: true, consequential: false }, frameId: 'frame-main' };
}
function supportedCatalog({ count = 3, documentEpoch = currentDocumentEpoch() } = {}) {
  return compileWebMcpCatalog(webMcpEnvelopeFromCdpTools(Array.from({ length: count }, (_, index) => rawTool(index)), { targetId, contextId, conversationEpoch, documentEpoch, mainFrameId: 'frame-main', capturedAt: '2026-08-28T15:30:00.000Z' }));
}
function unsupportedCatalog() {
  return compileWebMcpCatalog(unsupportedWebMcpEnvelope({ targetId, contextId, conversationEpoch, documentEpoch: currentDocumentEpoch(), capturedAt: '2026-08-28T15:30:00.000Z', reason: 'CDP_WEBMCP_UNAVAILABLE' }));
}

test('cold leader receives tiny tool-search handle, then exact lease gets bounded fresh top-K matches', async () => {
  const { runtime } = runtimeFixture();
  let catalogCalls = 0;
  const webMcpService = { catalog: async () => { catalogCalls += 1; return supportedCatalog({ count: 8 }); } };
  const service = new ComputePlanningBrokerService(runtime, { webMcpService });
  const leader = await service.lookup({ profileId, targetId, intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(leader.lookup.status, 'MISS_LEADER');
  assert.equal(leader.planner_context_surface, 'WEBMCP_TOOL_SEARCH');
  assert.equal(leader.planning_envelope, null);
  assert.equal(leader.webmcp_search_handle.tool_count, 8);
  assert.equal(leader.webmcp_search_handle.full_tool_list_embedded, false);
  assert.ok(leader.planner_context_bytes < 2048);
  assert.equal(JSON.stringify(leader.webmcp_search_handle).includes('search_flights'), false);

  const searched = await service.searchTools({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, query: 'find flight schedule' });
  assert.equal(searched.status, 'MATCHES');
  assert.equal(searched.query_persisted, false);
  assert.equal(searched.search_result.results[0].name, 'search_flights');
  assert.ok(searched.search_result.result_count <= 5);
  assert.ok(searched.search_result.result_bytes < 12 * 1024);
  const serialized = JSON.stringify(searched.search_result);
  assert.equal(serialized.includes('"input_schema":'), false);
  assert.equal(serialized.includes('"annotations":'), false);
  assert.equal(catalogCalls, 2);
  service.abort({ profileId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('invalid tool-search lease is rejected before fresh WebMCP browser work', async () => {
  const { runtime } = runtimeFixture();
  let catalogCalls = 0;
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => { catalogCalls += 1; return supportedCatalog({ count: 3 }); } } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'search_guard', actionKind: 'CLICK' });
  assert.equal(catalogCalls, 1);
  await assert.rejects(service.searchTools({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: 'lease_wrong_XXXXXXXXXXXXXXXXXXXXXXXX', query: 'flight' }), /semantic_planning_broker_lease_invalid/);
  assert.equal(catalogCalls, 1);
  service.abort({ profileId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('tool search NO_MATCH does not guess and leaves semantic fallback available', async () => {
  const { runtime } = runtimeFixture();
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ count: 3 }) } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'nomatch', actionKind: 'CLICK' });
  const searched = await service.searchTools({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, query: 'quantum compiler optimization' });
  assert.equal(searched.status, 'NO_MATCH');
  assert.equal(searched.search_result.result_count, 0);
  assert.equal(searched.semantic_fallback_available, true);
  service.abort({ profileId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('unsupported, empty, and malformed WebMCP degrade to semantic perception without authority', async () => {
  const cases = [['unsupported', { catalog: async () => unsupportedCatalog() }], ['empty', { catalog: async () => supportedCatalog({ count: 0 }) }], ['invalid', { catalog: async () => { throw new Error('webmcp_catalog_tool_ref_invalid'); } }]];
  for (const [intentSuffix, webMcpService] of cases) {
    const { runtime } = runtimeFixture();
    const service = new ComputePlanningBrokerService(runtime, { webMcpService });
    const result = await service.lookup({ profileId, targetId, intentId: `intent_${intentSuffix}`, actionKind: 'CLICK' });
    assert.equal(result.lookup.status, 'MISS_LEADER');
    assert.equal(result.planner_context_surface, 'SEMANTIC_PERCEPTION');
    assert.ok(result.planning_envelope?.nodes?.length > 0);
    assert.equal(result.webmcp_search_handle, null);
    assert.equal(result.authority_effect, false);
    assert.ok(['WEBMCP_UNSUPPORTED','WEBMCP_NO_TOOLS','WEBMCP_DISCOVERY_INVALID'].includes(result.webmcp_degraded_reason));
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
  assert.equal(waiter.webmcp_search_handle, null);
  const freshContext = await service.context({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION' });
  const candidateRef = freshContext.planning_envelope.nodes.find((node) => node.role === 'button').ref;
  await service.promote({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, candidateRef });
  const hit = await service.lookup({ profileId, targetId, intentId: 'repeat', actionKind: 'CLICK' });
  assert.equal(hit.lookup.status, 'HIT_REVALIDATED');
  assert.equal(hit.lookup.model_call_required, false);
  assert.equal(hit.planner_context_surface, 'NONE');
  assert.equal(hit.planner_context_bytes, 0);
  assert.equal(hit.planning_envelope, null);
  assert.equal(hit.webmcp_search_handle, null);
});

test('invalid context lease is rejected before B4 capture, valid context still has post-capture namespace revalidation', async () => {
  const { runtime, scheduler } = runtimeFixture();
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ count: 2 }) } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'fallback', actionKind: 'CLICK' });
  const callsBeforeInvalid = scheduler.calls.length;
  await assert.rejects(service.context({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: 'lease_wrong_XXXXXXXXXXXXXXXXXXXXXXXX', surface: 'SEMANTIC_PERCEPTION' }), /semantic_planning_broker_lease_invalid/);
  assert.equal(scheduler.calls.length, callsBeforeInvalid);
  const fresh = await service.context({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION' });
  assert.equal(fresh.revalidation.status, 'CONTEXT_REVALIDATED');
  assert.equal(fresh.fresh_capture_used, true);
  assert.equal(fresh.lease_preflight_used, true);
  assert.equal(fresh.lease_bound, true);
  scheduler.loaderId = 'loader-b';
  await assert.rejects(service.context({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, surface: 'SEMANTIC_PERCEPTION' }), /semantic_planning_broker_namespace_changed/);
  scheduler.loaderId = 'loader-a';
  service.abort({ profileId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('fatal document mismatch during initial routing aborts unseen flight so the next caller can lead', async () => {
  const { runtime } = runtimeFixture();
  let mismatched = true;
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ documentEpoch: mismatched ? 'doc_wrong' : currentDocumentEpoch(), count: 2 }) } });
  await assert.rejects(service.lookup({ profileId, targetId, intentId: 'recover', actionKind: 'CLICK' }), /planning_routing_namespace_changed/);
  assert.equal(service.stats({ profileId }).broker.in_flight_count, 0);
  mismatched = false;
  const retry = await service.lookup({ profileId, targetId, intentId: 'recover', actionKind: 'CLICK' });
  assert.equal(retry.lookup.status, 'MISS_LEADER');
  assert.equal(retry.planner_context_surface, 'WEBMCP_TOOL_SEARCH');
  service.abort({ profileId, flightId: retry.lookup.flight_id, leaseToken: retry.lookup.lease_token, reasonCode: 'TEST_DONE' });
});

test('document change during tool search aborts stale flight and requires new leader', async () => {
  const { runtime } = runtimeFixture();
  let changed = false;
  const service = new ComputePlanningBrokerService(runtime, { webMcpService: { catalog: async () => supportedCatalog({ documentEpoch: changed ? 'doc_changed' : currentDocumentEpoch(), count: 3 }) } });
  const leader = await service.lookup({ profileId, targetId, intentId: 'search_drift', actionKind: 'CLICK' });
  changed = true;
  await assert.rejects(service.searchTools({ profileId, targetId, flightId: leader.lookup.flight_id, leaseToken: leader.lookup.lease_token, query: 'flight' }), /planning_tool_search_namespace_changed/);
  assert.equal(service.stats({ profileId }).broker.in_flight_count, 0);
});
