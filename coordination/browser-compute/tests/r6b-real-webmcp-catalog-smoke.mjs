import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { startRpcServer } from '../src/rpc-server.mjs';

const executablePath = process.env.A2_CHROME_EXECUTABLE;
if (!executablePath) throw new Error('r6b_smoke_chrome_executable_required');

const stateRoot = process.env.A2_COMPUTE_STATE_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'a2-r6b-webmcp-'));
const runtime = await new ComputeBrowserRuntime({
  stateRoot,
  engineExecutable: executablePath,
  headlessDefault: true,
  allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1'
}).init();

const profileId = `r6b-webmcp-${process.pid}`;
const targetId = 'r6b_webmcp_target';
let rpc = null;

async function rpcCall(endpoint, token, method, params, id = method) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timeout = setTimeout(() => socket.destroy(new Error('r6b_rpc_timeout')), 15_000);
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
  await runtime.startProfile({ profileId });
  const target = await runtime.createTarget({
    profileId,
    targetId,
    contextId: 'default',
    role: 'CI_R6B',
    url: 'about:blank'
  });
  assert.equal(target.status, 'ACTIVE');
  const entry = runtime.running.get(profileId);
  const binding = entry?.bindings?.get(targetId);
  assert.ok(binding?.cdp_target_id);

  rpc = await startRpcServer(runtime);
  const token = (await fs.readFile(rpc.tokenFile, 'utf8')).trim();
  const response = await rpcCall(rpc.endpoint, token, 'webmcp.catalog', { profileId, targetId });
  assert.equal(response.ok, true);
  assert.equal(response.effect_class, 'READ_ONLY');
  assert.equal(response.web_authority_effect, false);
  const catalog = response.result;
  assert.equal(catalog?.status, 'SUPPORTED');
  assert.equal(catalog?.authority_effect, false);
  assert.equal(catalog?.actuation_eligible, false);
  assert.equal(catalog?.tool_invocation_exposed, false);
  assert.equal(catalog?.progressive_disclosure, true);
  assert.equal(catalog?.full_schema_embedded, false);
  assert.equal(catalog?.fresh_hydration_required, true);
  assert.ok(Number.isSafeInteger(Number(catalog?.catalog_bytes)));
  assert.equal(Buffer.byteLength(JSON.stringify(catalog)), catalog.catalog_bytes);
  assert.ok(Array.isArray(catalog?.tools));
  assert.equal(catalog.tool_count, catalog.tools.length);
  assert.equal(catalog.tools.every((tool) => tool.full_schema_embedded === false && !('input_schema' in tool)), true);

  const serialized = JSON.stringify(response);
  for (const forbidden of [
    binding.cdp_target_id,
    entry.processRef.processIncarnationId,
    'backendNodeId',
    'frameId',
    'stackTrace',
    'sessionId',
    'loaderId',
    'Runtime.evaluate',
    'WebMCP.invokeTool'
  ]) assert.equal(serialized.includes(forbidden), false);

  console.log(JSON.stringify({
    schema: 'metaengine.a2-compute-browser.r6b-real-webmcp-catalog-smoke.v1',
    ok: true,
    chrome_webmcp_status: catalog.status,
    registered_tools: catalog.tool_count,
    catalog_bytes: catalog.catalog_bytes,
    progressive_disclosure: true,
    full_schema_embedded: false,
    fresh_hydration_required: true,
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
