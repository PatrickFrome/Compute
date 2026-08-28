import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { startRpcServer } from '../src/rpc-server.mjs';

const executablePath = process.env.A2_CHROME_EXECUTABLE;
if (!executablePath) throw new Error('r5d_smoke_chrome_executable_required');

const stateRoot = process.env.A2_COMPUTE_STATE_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r5d-rpc-'));
const runtime = await new ComputeBrowserRuntime({
  stateRoot,
  engineExecutable: executablePath,
  headlessDefault: true,
  allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1'
}).init();

const profileId = `r5d-rpc-${process.pid}`;
const targetId = 'r5d_planning_target';
let rpc = null;

async function rpcCall(endpoint, token, method, params, id) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timeout = setTimeout(() => socket.destroy(new Error('r5d_rpc_timeout')), 15_000);
    socket.setNoDelay(true);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, token, method, params })}\n`);
    });
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
    role: 'CI_R5D',
    url: 'about:blank'
  }));
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
  assert.ok(leaders[0].result.planning_envelope);
  assert.ok(waiters.every((row) => row.result.planning_envelope == null));

  const leader = leaders[0].result;
  const candidate = leader.planning_envelope.nodes.find((node) =>
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
  assert.equal(promoted.effect_class, 'LOCAL_COORDINATION');
  assert.equal(promoted.result?.promotion?.status, 'PROMOTED_REVALIDATED');
  assert.equal(promoted.result?.promotion?.must_run_actionability_checks, true);
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
  assert.equal(hot.result?.planning_envelope, null);

  const stats = await rpcCall(rpc.endpoint, token, 'planning.stats', { profileId }, 'stats');
  assert.equal(stats.ok, true);
  assert.equal(stats.effect_class, 'READ_ONLY');
  assert.equal(stats.result?.provider_credentials_stored, false);
  assert.equal(stats.result?.execution_payload_stored, false);
  assert.equal(stats.result?.broker?.metrics?.leader_misses, 1);
  assert.equal(stats.result?.broker?.metrics?.waiters, 7);
  assert.equal(stats.result?.broker?.metrics?.promotions, 1);
  assert.ok(Number(stats.result?.broker?.metrics?.cache_hits || 0) >= 1);

  const serialized = JSON.stringify({ hot, stats });
  assert.doesNotMatch(serialized, new RegExp(binding.cdp_target_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(entry.processRef.processIncarnationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, /loaderId|backendDOMNodeId|providerApiKey|authorization|cookie/i);

  console.log(JSON.stringify({
    schema: 'metaengine.a2-compute-browser.r5d-real-planning-rpc-smoke.v1',
    ok: true,
    cold_requests: cold.length,
    leader_calls: leaders.length,
    waiters: waiters.length,
    cache_hit: true,
    fresh_promotion: true,
    model_call_on_hot_path_required: false,
    provider_credentials_stored: false,
    raw_engine_identity_exposed: false,
    remote_navigation_used: false,
    runtime_evaluate_used: false,
    actuation_used: false
  }));
} finally {
  await rpc?.close?.().catch(() => {});
  await runtime.shutdown().catch(() => {});
  if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(stateRoot, { recursive: true, force: true }).catch(() => {});
}
