import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatDevelopmentQueryProvider } from '../src/chat-development-query-provider.mjs';
import { ChatFastControlRuntime } from '../src/chat-fast-control-runtime.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';
import { FastControlGatewayCore } from '../src/fast-control-gateway-core.mjs';
import { createFastControlMcpAdapter } from '../src/fast-control-mcp-adapter.mjs';

function gatewayAdapter() {
  const gateway = new FastControlGatewayCore({
    contextGet: async () => ({ revision: 'ctx:1', authority_effect: false }),
    devQuery: async () => Object.freeze({
      status: 'OK',
      query_revision: 'dq:one',
      hits: Object.freeze([]),
      authority_effect: false,
    }),
    issueBatch: async () => ({ accepted: true, authority_effect: false }),
    resultDelta: async () => ({ next_seq: 0, results: [], authority_effect: false }),
    issueEmergency: async () => ({ accepted: true, authority_effect: false }),
  });
  return createFastControlMcpAdapter(gateway);
}

test('MCP tool catalog is one deeply immutable cache object and guides one-call dev reads', () => {
  const mcp = gatewayAdapter();
  const first = mcp.listTools();
  const second = mcp.listTools();
  assert.equal(first, second, 'hot tools/list must not clone a deterministic catalog');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.tools));
  assert.ok(Object.isFrozen(first.tools[0].inputSchema.properties));
  assert.ok(Object.isFrozen(first.tools[0].inputSchema.properties.fields));
  assert.throws(() => { first.tools[0].inputSchema.properties.fields.maxItems = 999; }, TypeError);
  assert.match(first.tools.find((row) => row.name === 'dev_query').description, /Do not call context_get first/i);
});

function runtimeHarness() {
  const calls = { repo: 0, browser: 0 };
  const developmentPlane = {
    async request(_capability, input) {
      calls.repo += 1;
      return {
        status: 'OK',
        query_revision: `rq:${String(input.query).toLowerCase()}`,
        total_hits: 1,
        hits: [{
          path: 'apps/metaengine-browser/src/main.mjs',
          line: 1,
          snippet: 'boundedNavigation AbortSignal',
          sha256: `sha256:${'a'.repeat(64)}`,
          score: 80,
          matched_terms: 2,
          authority_effect: false,
        }],
        authority_effect: false,
      };
    },
  };
  const runtime = new ChatFastControlRuntime({
    developmentPlane,
    getBrowserState: async () => { calls.browser += 1; return { tabs: [] }; },
    issueBatch: async () => ({ accepted: true, authority_effect: false }),
    resultDelta: async () => ({ results: [], next_seq: 0, authority_effect: false }),
    issueEmergency: async () => ({ accepted: true, authority_effect: false }),
  });
  runtime.setSource({
    repository: 'PatrickFrome/Compute',
    branch: 'work/browser-host-agent-p0',
    head_sha: 'a'.repeat(40),
    dirty: false,
    authority_effect: false,
  }, '2026-09-10T20:00:00.000Z');
  runtime.setCapabilityRevision(CONTROL_ACTION_MANIFEST_REVISION, '2026-09-10T20:00:00.001Z');
  return { runtime, calls };
}

test('repeated dev_query uses zero-snapshot orientation cache and reuses immutable result by reference', async () => {
  const { runtime, calls } = runtimeHarness();
  const input = { query: 'bounded navigation abort signal', kinds: ['SOURCE'], limit: 4, max_bytes: 2048 };
  const first = await runtime.callTool('dev_query', input);
  const second = await runtime.callTool('dev_query', input);
  assert.equal(calls.repo, 1);
  assert.equal(calls.browser, 0);
  assert.equal(second.structuredContent.result, first.structuredContent.result);
  assert.ok(Object.isFrozen(first.structuredContent.result));
  assert.ok(Object.isFrozen(first.structuredContent.result.hits));
  const snap = runtime.snapshot();
  assert.equal(snap.dev_query_hot_state.snapshot_reads_per_query, 0);
  assert.equal(snap.dev_query_hot_state.orientation_builds, 1);
  assert.equal(snap.dev_query_hot_state.orientation_cache_hits, 1);
  assert.equal(snap.dev_query_warm_cache.zero_copy_result_reuse, true);
  assert.equal(snap.development_cursor.captures, 1);
  assert.equal(snap.development_cursor.capture_skips, 1);
});

test('provider byte fitting stays bounded and freezes the selected hit array', async () => {
  const developmentPlane = {
    async request() {
      return {
        status: 'OK',
        query_revision: 'rq:large',
        total_hits: 12,
        hits: Array.from({ length: 12 }, (_, i) => ({
          path: `src/file-${i}.mjs`,
          line: i + 1,
          snippet: 'x'.repeat(600),
          sha256: `sha256:${String(i).padStart(64, '0')}`,
          score: 100 - i,
          matched_terms: 1,
          authority_effect: false,
        })),
        authority_effect: false,
      };
    },
  };
  const provider = new ChatDevelopmentQueryProvider({
    developmentPlane,
    evidenceIndex: { query() { throw new Error('evidence_should_not_run'); } },
  });
  const out = await provider.query({ query: 'large', kinds: ['SOURCE'], limit: 12, max_bytes: 1024 });
  assert.equal(out.status, 'OK');
  assert.ok(out.bytes <= 1024);
  assert.ok(out.hits.length < 12);
  assert.equal(out.truncated, true);
  assert.ok(Object.isFrozen(out.hits));
  assert.equal(provider.snapshot().result_fit_strategy, 'BOUNDED_BINARY_SEARCH');
});
