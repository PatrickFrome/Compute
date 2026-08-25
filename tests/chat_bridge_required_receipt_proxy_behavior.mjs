import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const SECRET = 'abcdefghijklmnopqrstuvwxyz123456';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function waitFor(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout_waiting_for:${url}`);
}

async function requestJson(url, { method = 'GET', body = null, auth = true, client = 'ci-required' } = {}) {
  const headers = {};
  if (body !== null) headers['content-type'] = 'application/json';
  if (auth) headers['x-a2-chat-bridge-secret'] = SECRET;
  headers['x-a2-chat-bridge-client'] = client;
  const response = await fetch(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

const receiptCalls = [];
let failReceipt = false;
let receiptNo = 0;

const supabase = http.createServer(async (req, res) => {
  const body = await bodyJson(req);
  if (req.url?.endsWith('/h205f22_a2_interactive_read_v1')) {
    return sendJson(res, 200, { messages: [], head_message_seq: 108 });
  }
  if (req.url?.endsWith('/h205f22_a2_macroblock_read_v1')) {
    return sendJson(res, 200, { state: 'CI' });
  }
  if (req.url?.endsWith('/h205f22_duel_list_peer_relay_pending_v4')) {
    return sendJson(res, 200, { items: [] });
  }
  if (req.url?.endsWith('/h205f22_a2_chat_bridge_receipt_ingest_v1')) {
    receiptCalls.push(body);
    if (failReceipt) return sendJson(res, 503, { error: 'receipt-store-down' });
    receiptNo += 1;
    return sendJson(res, 200, {
      schema: 'metaengine.compute.a2-chat-bridge-receipt.h205f22.v1',
      receipt_id: `ci-${receiptNo}`,
      receipt_sha256: `${receiptNo}`.padStart(64, '0'),
      replayed: false,
      canonical: false,
      authority_effect: false
    });
  }
  return sendJson(res, 404, { error: 'mock_not_found', path: req.url, body });
});

const mockPort = await listen(supabase);
const publicPort = await freePort();
const internalPort = await freePort();
const stateDir = await mkdtemp(join(tmpdir(), 'a2-required-receipt-'));

const child = spawn(process.execPath, ['coordination/chat-control-plane/daemon/secure-entry.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
    A2_BRIDGE_SHARED_SECRET: SECRET,
    A2_BRIDGE_PORT: String(publicPort),
    A2_BRIDGE_INTERNAL_PORT: String(internalPort),
    A2_BRIDGE_RECEIPTS_MODE: 'REQUIRED',
    A2_BRIDGE_INSTANCE_ID: 'ci-required-proxy',
    A2_BRIDGE_STATE_DIR: stateDir,
    A2_BRIDGE_IDLE_MS: '9999999',
    A2_BRIDGE_WAKE_COOLDOWN_MS: '9999999',
    A2_BRIDGE_RECEIPT_RETRY_TTL_MS: '30000'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let childLogs = '';
child.stdout.on('data', (chunk) => { childLogs += chunk.toString(); });
child.stderr.on('data', (chunk) => { childLogs += chunk.toString(); });

try {
  const base = `http://127.0.0.1:${publicPort}`;
  await waitFor(`${base}/v1/status`);

  const snapshotEnvelope = {
    schema: 'metaengine.chat-bridge.snapshot-envelope.v1',
    tab_id: 1,
    platform: 'GLM_ZAI',
    observed_at: new Date().toISOString(),
    snapshot: {
      platform: 'GLM_ZAI',
      url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db?must=not-persist#secret',
      generating: false,
      composer_present: true,
      composer_text: '',
      message_count: 1,
      messages: []
    }
  };
  const snapshotPost = await requestJson(`${base}/v1/snapshots`, { method: 'POST', body: snapshotEnvelope });
  assert.equal(snapshotPost.response.status, 202);

  const wake = await requestJson(`${base}/v1/control/wake`, {
    method: 'POST',
    body: { target_platform: 'GLM_ZAI' }
  });
  assert.equal(wake.response.status, 202);

  failReceipt = true;
  const blockedNext = await requestJson(`${base}/v1/commands/next`);
  assert.equal(blockedNext.response.status, 503);
  assert.equal(blockedNext.body?.error, 'receipt_persistence_required');
  assert.equal(receiptCalls.length, 1);
  assert.equal(receiptCalls[0].p_event_kind, 'COMMAND_LEASED');

  let status = (await requestJson(`${base}/v1/status`, { auth: false })).body;
  const internallyLeased = status.queue.find((item) => item.status === 'LEASED');
  assert.ok(internallyLeased?.command_id);
  assert.equal(status.results.length, 0);

  // The blocked command is scoped to the client that acquired the internal
  // lease. A second extension identity sees no command and cannot steal it.
  const otherClient = await requestJson(`${base}/v1/commands/next`, { client: 'ci-required-other' });
  assert.equal(otherClient.response.status, 200);
  assert.equal(otherClient.body?.command, null);

  failReceipt = false;
  const next = await requestJson(`${base}/v1/commands/next`);
  assert.equal(next.response.status, 200);
  assert.equal(next.body?.receipt_retry, true);
  const command = next.body?.command;
  assert.ok(command?.command_id);
  assert.equal(command.command_id, internallyLeased.command_id);
  assert.equal(receiptCalls.length, 2, 'failed lease persistence plus immediate retry expected');
  assert.equal(receiptCalls[1].p_event_kind, 'COMMAND_LEASED');
  assert.equal(receiptCalls[1].p_command_id, command.command_id);
  assert.equal(JSON.stringify(receiptCalls[1]).includes(command.prompt), false);
  assert.equal(JSON.stringify(receiptCalls[1]).includes('must=not-persist'), false);

  failReceipt = true;
  const strongResult = {
    status: 'SENT_AND_DOM_VERIFIED',
    target_platform: 'GLM_ZAI',
    target_url: snapshotEnvelope.snapshot.url,
    clicked_send_button: true,
    verification: { verified: true, exact_user_turn_seen: true },
    authority_effect: false,
    captured_at: new Date().toISOString()
  };
  const failedAck = await requestJson(`${base}/v1/commands/${command.command_id}/result`, {
    method: 'POST', body: strongResult
  });
  assert.equal(failedAck.response.status, 503);
  assert.equal(failedAck.body?.error, 'receipt_persistence_required');

  status = (await requestJson(`${base}/v1/status`, { auth: false })).body;
  const queued = status.queue.find((item) => item.command_id === command.command_id);
  assert.equal(queued?.status, 'LEASED');
  assert.equal(status.results.some((item) => item.command_id === command.command_id), false);

  failReceipt = false;
  const acceptedAck = await requestJson(`${base}/v1/commands/${command.command_id}/result`, {
    method: 'POST', body: strongResult
  });
  assert.equal(acceptedAck.response.status, 200);
  assert.equal(acceptedAck.body?.accepted, true);

  status = (await requestJson(`${base}/v1/status`, { auth: false })).body;
  assert.equal(status.results.some((item) => item.command_id === command.command_id && item.status === 'SENT_AND_DOM_VERIFIED'), true);

  const resultReceipts = receiptCalls.filter((body) => body.p_event_kind === 'SEND_RESULT');
  assert.equal(resultReceipts.length, 2, 'one failed storage attempt plus one successful retry expected');
  assert.equal(resultReceipts.at(-1).p_dom_send_verified, true);
  assert.equal(resultReceipts.at(-1).p_clicked_send_button, true);
  assert.equal(JSON.stringify(resultReceipts.at(-1)).includes(command.prompt), false);
  assert.equal(JSON.stringify(resultReceipts.at(-1)).includes('must=not-persist'), false);

  assert.match(childLogs, /receipt persistence mode=REQUIRED/);
  console.log('chat bridge REQUIRED receipt proxy ordering + client-scoped lease retry: PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await new Promise((resolve) => supabase.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
