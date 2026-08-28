import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { startRpcServer } from '../src/rpc-server.mjs';

const executablePath = process.env.A2_CHROME_EXECUTABLE;
if (!executablePath) throw new Error('r6c_smoke_chrome_executable_required');

const stateRoot = process.env.A2_COMPUTE_STATE_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r6c-routing-'));
const runtime = await new ComputeBrowserRuntime({
  stateRoot,
  engineExecutable: executablePath,
  headlessDefault: true,
  allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1'
}).init();

const profileId = `r6c-routing-${process.pid}`;
const targetId = 'r6c_routing_target';
let rpc = null;

async function rpcCall(endpoint, token, method, params, id = method) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timeout = setTimeout(() => socket.destroy(new Error('r6c_rpc_timeout')), 20_000);
    socket.setNoDelay(true);
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, token, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.end();
      try { resolve(JSON.parse(buffer.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
  });
}

try {
  const target = await runtime.startProfile({ profileId }).then(() => runtime.createTarget({
    profileId,
    targetId,
    contextId: 'default',
    role: 'CI_R6C',
    url: 'about:blank'
  }));
  assert.equal(target.status, 'ACTIVE');
  const entry = runtime.running.get(profileId);
  const binding = entry?.bindings?.get(targetId);
  assert.ok(entry?.sessionScheduler);
  assert.ok(binding?.cdp_target_id);

  const identity = {
    targetId,
    cdpTargetId: binding.cdp_target_id,
    conversationEpoch: target.conversation_epoch,
    processIncarnationId: entry.processRef.processIncarnationId
  };
  await entry.sessionScheduler.run(identity, async ({ call }) => {
    const tree = await call('Page.getFrameTree', {});
    const frameId = tree?.frameTree?.frame?.id;
    assert.ok(frameId);
    await call('Page.setDocumentContent', {
      frameId,
      html: '<!doctype html><html><body><main><button id="submit">Submit</button></main></body></html>'
    });
  });

  rpc = await startRpcServer(runtime);
  const token = (await fs.readFile(rpc.tokenFile, 'utf8')).trim();
  assert.match(token, /^[a-f0-9]{64}$/);

  const cold = await Promise.all(Array.from({ length: 8 }, (_, index) => rpcCall(
    rpc.endpoint,
    token,
    'planning.lookup',
    { profileId, targetId, intentId: 'submit', actionKind: 'CLICK' },
    `cold-${index}`
  )));
  assert.ok(cold.every((row) => row?.ok === true && row.effect_class === 'LOCAL_COORDINATION'));
  const leaders = cold.filter((row) => row.result?.lookup?.status === 'MISS_LEADER');
  const waiters = cold.filter((row) => row.result?.lookup?.status === 'WAIT_FOR_PROMOTION');
  assert.equal(leaders.length, 1);
  assert.equal(waiters.length, 7);

  const leader = leaders[0].result;
  assert.equal(leader.planner_context_surface, 'SEMANTIC_PERCEPTION');
  assert.equal(leader.webmcp_degraded_reason, 'WEBMCP_NO_TOOLS');
  assert.ok(leader.planning_envelope);
  assert.equal(leader.webmcp_search_handle, null);
  assert.equal(leader.planner_context_bytes, Buffer.byteLength(JSON.stringify(leader.planning_envelope)));
  assert.ok(waiters.every((row) =>
    row.result?.planner_context_surface === 'NONE'
    && row.result?.planner_context_bytes === 0
    && row.result?.planning_envelope == null
    && row.result?.webmcp_search_handle == null
  ));

  const freshContext = await rpcCall(rpc.endpoint, token, 'planning.context', {
    profileId,
    targetId,
    flightId: leader.lookup.flight_id,
    leaseToken: leader.lookup.lease_token,
    surface: 'SEMANTIC_PERCEPTION'
  }, 'context');
  assert.equal(freshContext.ok, true);
  assert.equal(freshContext.effect_class, 'LOCAL_COORDINATION');
  assert.equal(freshContext.result?.revalidation?.status, 'CONTEXT_REVALIDATED');
  assert.equal(freshContext.result?.fresh_capture_used, true);
  assert.equal(freshContext.result?.lease_preflight_used, true);
  assert.equal(freshContext.result?.lease_bound, true);
  assert.equal(freshContext.result?.planning_envelope?.document_epoch, leader.planning_envelope.document_epoch);
  assert.equal(freshContext.result?.planner_context_bytes, Buffer.byteLength(JSON.stringify(freshContext.result.planning_envelope)));
  assert.equal(freshContext.result?.actuation_eligible, false);

  const candidate = freshContext.result.planning_envelope.nodes.find((node) =>
    node?.role?.toLowerCase() === 'button' && node?.name === 'Submit' && node?.visibility === 'VISIBLE' && node?.clickable === true
  );
  assert.ok(candidate?.ref);

  const promoted = await rpcCall(rpc.endpoint, token, 'planning.promote', {
    profileId,
    targetId,
    flightId: leader.lookup.flight_id,
    leaseToken: leader.lookup.lease_token,
    candidateRef: candidate.ref
  }, 'promote');
  assert.equal(promoted.ok, true);
  assert.equal(promoted.result?.promotion?.status, 'PROMOTED_REVALIDATED');
  assert.equal(promoted.result?.actuation_eligible, false);

  const hot = await rpcCall(rpc.endpoint, token, 'planning.lookup', {
    profileId,
    targetId,
    intentId: 'submit',
    actionKind: 'CLICK'
  }, 'hot');
  assert.equal(hot.ok, true);
  assert.equal(hot.result?.lookup?.status, 'HIT_REVALIDATED');
  assert.equal(hot.result?.lookup?.model_call_required, false);
  assert.equal(hot.result?.planner_context_surface, 'NONE');
  assert.equal(hot.result?.planner_context_bytes, 0);
  assert.equal(hot.result?.planning_envelope, null);
  assert.equal(hot.result?.webmcp_search_handle, null);

  const stats = await rpcCall(rpc.endpoint, token, 'planning.stats', { profileId }, 'stats');
  assert.equal(stats.ok, true);
  assert.equal(stats.effect_class, 'READ_ONLY');
  assert.equal(stats.result?.broker?.metrics?.leader_misses, 1);
  assert.equal(stats.result?.broker?.metrics?.waiters, 7);
  assert.equal(stats.result?.broker?.metrics?.context_revalidations, 1);
  assert.ok(Number(stats.result?.broker?.metrics?.lease_preflights || 0) >= 1);
  assert.equal(stats.result?.broker?.metrics?.promotions, 1);
  assert.ok(Number(stats.result?.broker?.metrics?.cache_hits || 0) >= 1);

  const serialized = JSON.stringify({ cold, freshContext, hot, stats });
  for (const forbidden of [
    binding.cdp_target_id,
    entry.processRef.processIncarnationId,
    'backendDOMNodeId',
    'sessionId',
    'loaderId',
    'Runtime.evaluate',
    'WebMCP.invokeTool',
    'providerApiKey'
  ]) assert.equal(serialized.includes(forbidden), false);

  console.log(JSON.stringify({
    schema: 'metaengine.a2-compute-browser.r6c-real-planning-routing-smoke.v2',
    ok: true,
    chrome_webmcp_status: 'SUPPORTED',
    registered_tools: 0,
    cold_requests: cold.length,
    leader_calls: leaders.length,
    waiters: waiters.length,
    leader_context_surface: leader.planner_context_surface,
    waiter_context_surface: 'NONE',
    waiter_context_bytes: 0,
    semantic_fallback_reason: leader.webmcp_degraded_reason,
    fresh_semantic_fallback: true,
    lease_preflight_used: true,
    lease_bound_context: true,
    cache_hit_context_bytes: hot.result.planner_context_bytes,
    runtime_evaluate_used: false,
    webmcp_invoke_used: false,
    raw_engine_identity_exposed: false,
    remote_navigation_used: false,
    actuation_used: false
  }));
} finally {
  await rpc?.close?.().catch(() => {});
  await runtime.shutdown().catch(() => {});
  if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(stateRoot, { recursive: true, force: true }).catch(() => {});
}
