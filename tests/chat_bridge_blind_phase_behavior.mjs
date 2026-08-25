import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MOCK_PORT = 8890;
const BRIDGE_PORT = 8891;
const INTERNAL_PORT = 8892;
const SECRET = 'behavior-test-pairing-secret-1234567890';
const MAIN_SHA = '3df3eb84b39e32ef4f922a8e7f0067acb7469ed2';
const DUEL_ID = 'fbf48fd3-256a-456b-b3fc-34b6a3241660';
const GPT_DOM_MARKER = 'GPT_PRIVATE_DOM_DO_NOT_LEAK_8f71';
const GLM_DOM_MARKER = 'GLM_OWN_CONTEXT_42aa';
// Isolated per-run state dir: the daemon journal persists idempotency keys and
// would otherwise suppress the deterministic wake key on repeated test runs.
const STATE_DIR = mkdtempSync(join(tmpdir(), 'a2-blind-phase-'));

function json(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${MOCK_PORT}`);
  if (req.method !== 'POST' || !url.pathname.startsWith('/rest/v1/rpc/')) {
    res.writeHead(404); return res.end();
  }
  const rpc = decodeURIComponent(url.pathname.split('/').pop());
  for await (const _ of req) {}

  if (rpc === 'h205f22_a2_interactive_read_v1') {
    return json(res, {
      snapshot: {
        head_message_seq: 100,
        messages: [{
          message_seq: 100,
          agent: 'GPT',
          message_type: 'REQUEST_DUEL',
          semantic_point: 'TEST_BLIND_POINT',
          message_hash: 'a'.repeat(64),
          payload: {
            kind: 'DUEL_LOCATOR_ONLY',
            main_sha: MAIN_SHA,
            duel_id: DUEL_ID,
            note: 'public locator only; hidden proposal absent'
          }
        }]
      }
    });
  }

  if (rpc === 'h205f22_a2_macroblock_read_v1') {
    return json(res, { state: 'EXECUTING', macroblock_id: 'dce58a3b-2f67-47e0-ae0d-9b3825ff53cd' });
  }

  if (rpc === 'h205f22_duel_list_peer_relay_pending_v4') {
    return json(res, {
      items: [{
        registration: { registered_at: '2026-08-25T05:00:00Z' },
        subject: { question: 'Independent GLM proposal required', hidden_payload: false },
        relay: {
          duel_id: DUEL_ID,
          duel_key: 'TEST_BLIND_DUEL',
          base_github_sha: MAIN_SHA,
          relay_state: 'WAITING_PROPOSE_PEER',
          pending_wave: 'PROPOSE',
          pending_actors: ['GPT'],
          pending_payloads_exposed: false,
          current_checkpoint_sha256: 'b'.repeat(64)
        }
      }]
    });
  }

  return json(res, {});
});

await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

const child = spawn(process.execPath, [join(ROOT, 'coordination/chat-control-plane/daemon/secure-entry.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    A2_BRIDGE_SHARED_SECRET: SECRET,
    A2_BRIDGE_PORT: String(BRIDGE_PORT),
    A2_BRIDGE_INTERNAL_PORT: String(INTERNAL_PORT),
    A2_BRIDGE_IDLE_MS: '5000',
    A2_BRIDGE_WAKE_COOLDOWN_MS: '15000',
    A2_BRIDGE_A2_REFRESH_MS: '1500',
    // The daemon persists the command idempotency journal in the state dir;
    // a fixed directory would make the deterministic wake key collide across
    // repeated test runs and silently suppress the expected wake command.
    A2_BRIDGE_STATE_DIR: STATE_DIR
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

const authHeaders = {
  'content-type': 'application/json',
  'x-a2-chat-bridge-secret': SECRET,
  'x-a2-chat-bridge-client': 'behavior-test-client'
};

async function waitReady() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/status`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`bridge_not_ready\n${logs}`);
}

function snapshot(platform, marker) {
  const url = platform === 'CHATGPT'
    ? 'https://chatgpt.com/c/test-gpt-chat'
    : 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db';
  return {
    schema: 'metaengine.chat-bridge.snapshot-envelope.v1',
    platform,
    observed_at: new Date().toISOString(),
    snapshot: {
      schema: 'metaengine.chat-dom-snapshot.v1',
      platform,
      url,
      title: platform,
      captured_at: new Date().toISOString(),
      generating: false,
      composer_present: true,
      composer_text: '',
      message_count: 2,
      messages: [
        { index: 0, role: 'user', text: 'continue', text_hash_local: '11111111' },
        { index: 1, role: 'assistant', text: marker, text_hash_local: '22222222' }
      ]
    }
  };
}

async function postSnapshot(platform, marker) {
  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/snapshots`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify(snapshot(platform, marker))
  });
  assert.equal(response.status, 202, await response.text());
}

try {
  await waitReady();
  await postSnapshot('CHATGPT', GPT_DOM_MARKER);
  await postSnapshot('GLM_ZAI', GLM_DOM_MARKER);
  await new Promise((r) => setTimeout(r, 5200));
  await postSnapshot('CHATGPT', GPT_DOM_MARKER);
  await postSnapshot('GLM_ZAI', GLM_DOM_MARKER);

  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/commands/next`, {
    headers: authHeaders
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.command, `expected GLM wake command; logs=${logs}`);
  assert.equal(body.command.target_platform, 'GLM_ZAI');
  assert.equal(body.command.target_agent, 'GLM');
  assert.equal(body.command.a2_peer_payloads_exposed, false);
  assert.match(body.command.prompt, /OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE/);
  assert.match(body.command.prompt, new RegExp(GLM_DOM_MARKER));
  assert.doesNotMatch(body.command.prompt, new RegExp(GPT_DOM_MARKER));
  assert.match(body.command.prompt, /pending_payloads_exposed/);

  const second = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/commands/next`, { headers: authHeaders });
  const secondBody = await second.json();
  assert.equal(secondBody.command, null, 'blind phase must not queue GPT while GLM is the missing peer');
  console.log('blind-phase behavioral contract PASS');
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 1000))]);
  mock.close();
  try {
    rmSync(STATE_DIR, { recursive: true, force: true });
  } catch (_) {}
}
