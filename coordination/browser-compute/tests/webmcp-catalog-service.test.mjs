import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { ComputeWebMcpService } from '../src/webmcp-service.mjs';

const profileId = 'profile-r6b';
const targetId = 'target-r6b';
const incarnation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class FakeWebMcpScheduler {
  constructor() {
    this.loaderId = 'loader-a';
    this.runCount = 0;
    this.calls = [];
  }

  async run(_identity, operation) {
    this.runCount += 1;
    const handlers = new Map();
    const onEvent = (method, listener) => {
      const list = handlers.get(method) || [];
      list.push(listener);
      handlers.set(method, list);
      return () => handlers.set(method, (handlers.get(method) || []).filter((fn) => fn !== listener));
    };
    const emit = (method, params) => {
      for (const listener of handlers.get(method) || []) listener(params);
    };
    const call = async (method, params = {}) => {
      this.calls.push({ method, params, run: this.runCount });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-main', loaderId: this.loaderId } } };
      if (method === 'WebMCP.enable') {
        emit('WebMCP.toolsAdded', {
          tools: [{
            name: 'searchFlights',
            description: 'Search available flights with structured parameters.',
            inputSchema: {
              type: 'object',
              properties: {
                origin: { type: 'string', description: 'Origin airport' },
                destination: { type: 'string', description: 'Destination airport' }
              },
              required: ['origin', 'destination'],
              additionalProperties: false
            },
            annotations: { readOnly: true, consequential: false },
            frameId: 'frame-main',
            backendNodeId: 991,
            stackTrace: { callFrames: [{ url: 'https://untrusted.example/app.js' }] }
          }]
        });
        return {};
      }
      if (method === 'WebMCP.disable') return {};
      throw new Error(`unexpected_method:${method}`);
    };
    return operation({ call, onEvent, sessionGeneration: this.runCount });
  }
}

function fixture() {
  const scheduler = new FakeWebMcpScheduler();
  const runtime = {
    running: new Map(),
    listTargets: async () => [{
      target_id: targetId,
      context_id: 'default',
      status: 'ACTIVE',
      bound: true,
      conversation_epoch: 3
    }],
    listContexts: async () => [{ context_id: 'default', status: 'ACTIVE', bound: true }]
  };
  runtime.running.set(profileId, {
    processRef: {
      processIncarnationId: incarnation,
      isRunning: () => true,
      cdp: {}
    },
    sessionScheduler: scheduler,
    perceptionNodeKey: crypto.randomBytes(32),
    bindings: new Map([[targetId, {
      cdp_target_id: 'engine-target-r6b',
      process_incarnation_id: incarnation,
      conversation_epoch: 3
    }]])
  });
  return { scheduler, service: new ComputeWebMcpService(runtime) };
}

test('catalog then describe performs fresh discovery and returns only the selected full schema', async () => {
  const { scheduler, service } = fixture();
  const catalog = await service.catalog({ profileId, targetId });
  assert.equal(catalog.status, 'SUPPORTED');
  assert.equal(catalog.tool_count, 1);
  assert.equal(catalog.tools[0].full_schema_embedded, false);
  assert.equal('input_schema' in catalog.tools[0], false);
  const described = await service.describe({ profileId, targetId, toolRef: catalog.tools[0].tool_ref });
  assert.equal(described.status, 'DESCRIBED');
  assert.equal(described.tool.name, 'searchFlights');
  assert.equal(described.tool.input_schema.type, 'object');
  assert.equal(described.tool_invocation_exposed, false);
  assert.equal(described.authority_effect, false);
  assert.equal(described.actuation_eligible, false);
  assert.equal(scheduler.runCount, 2);
});

test('document rotation invalidates a previously catalogued tool ref on fresh describe', async () => {
  const { scheduler, service } = fixture();
  const catalog = await service.catalog({ profileId, targetId });
  const oldRef = catalog.tools[0].tool_ref;
  scheduler.loaderId = 'loader-b';
  await assert.rejects(
    service.describe({ profileId, targetId, toolRef: oldRef }),
    /webmcp_catalog_tool_not_found/
  );
  assert.equal(scheduler.runCount, 2);
});

test('catalog and describe surfaces never expose raw WebMCP engine metadata', async () => {
  const { service } = fixture();
  const catalog = await service.catalog({ profileId, targetId });
  const described = await service.describe({ profileId, targetId, toolRef: catalog.tools[0].tool_ref });
  for (const serialized of [JSON.stringify(catalog), JSON.stringify(described)]) {
    assert.equal(serialized.includes('frame-main'), false);
    assert.equal(serialized.includes('backendNodeId'), false);
    assert.equal(serialized.includes('untrusted.example'), false);
    assert.equal(serialized.includes('sessionId'), false);
    assert.equal(serialized.includes('loader-a'), false);
  }
});
