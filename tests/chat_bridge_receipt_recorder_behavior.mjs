import assert from 'node:assert/strict';
import { BridgeReceiptRecorder, sha256 } from '../coordination/chat-control-plane/daemon/receipt-recorder.mjs';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function command(overrides = {}) {
  const prompt = 'PRIVATE PROMPT MUST NEVER BE PERSISTED';
  return {
    command_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: sha256('wake-key'),
    prompt,
    prompt_sha256: sha256(prompt),
    target_platform: 'GLM_ZAI',
    target_agent: 'GLM',
    a2_head_message_seq: 108,
    a2_peer_payloads_exposed: false,
    ...overrides
  };
}

const snapshot = {
  url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db?secret=query#fragment',
  message_count: 42,
  generating: false
};

// OFF: no RPC, no configuration burden beyond constructor data.
{
  let calls = 0;
  const recorder = new BridgeReceiptRecorder({
    mode: 'OFF', workspaceId: '', supabaseUrl: '', serviceRoleKey: '',
    fetchImpl: async () => { calls += 1; return response(200, {}); }
  });
  recorder.noteSnapshot('GLM_ZAI', snapshot);
  const result = await recorder.recordLease(command());
  assert.equal(result.persisted, false);
  assert.equal(result.mode, 'OFF');
  assert.equal(calls, 0);
}

// BEST_EFFORT: storage failure degrades observability without throwing.
{
  const recorder = new BridgeReceiptRecorder({
    mode: 'BEST_EFFORT',
    bridgeInstanceId: 'ci-best-effort',
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    supabaseUrl: 'https://example.invalid',
    serviceRoleKey: 'test-only',
    fetchImpl: async () => response(503, { error: 'down' }),
    logger: { error() {} }
  });
  recorder.noteSnapshot('GLM_ZAI', snapshot);
  const result = await recorder.recordLease(command());
  assert.equal(result.persisted, false);
  assert.match(result.error, /receipt_rpc_503/);
}

// REQUIRED: identical storage failure is a hard error.
{
  const recorder = new BridgeReceiptRecorder({
    mode: 'REQUIRED',
    bridgeInstanceId: 'ci-required-fail',
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    supabaseUrl: 'https://example.invalid',
    serviceRoleKey: 'test-only',
    fetchImpl: async () => response(503, { error: 'down' }),
    logger: { error() {} }
  });
  recorder.noteSnapshot('GLM_ZAI', snapshot);
  await assert.rejects(recorder.recordLease(command()), /receipt_rpc_503/);
  assert.equal(recorder.hasLease(command().command_id), false);
}

// REQUIRED happy path: only hashes/metadata cross the RPC boundary.
{
  const calls = [];
  const recorder = new BridgeReceiptRecorder({
    mode: 'REQUIRED',
    bridgeInstanceId: 'ci-required-pass',
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    supabaseUrl: 'https://example.invalid',
    serviceRoleKey: 'test-only',
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return response(200, {
        receipt_id: `${calls.length}`,
        receipt_sha256: sha256(`receipt-${calls.length}`),
        canonical: false,
        authority_effect: false
      });
    },
    logger: { error() {} }
  });
  recorder.noteSnapshot('GLM_ZAI', snapshot);
  const cmd = command();
  const lease = await recorder.recordLease(cmd);
  assert.equal(lease.persisted, true);
  assert.equal(recorder.hasLease(cmd.command_id), true);
  assert.equal(calls[0].p_event_kind, 'COMMAND_LEASED');
  assert.equal(calls[0].p_target_agent, 'GLM');
  assert.equal(calls[0].p_target_platform, 'GLM_ZAI');
  assert.equal(calls[0].p_prompt_sha256, cmd.prompt_sha256);
  assert.equal(calls[0].p_idempotency_key_sha256, cmd.idempotency_key);
  assert.equal(calls[0].p_target_url_sha256, sha256('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'));
  const serializedLease = JSON.stringify(calls[0]);
  assert.equal(serializedLease.includes(cmd.prompt), false);
  assert.equal(serializedLease.includes('secret=query'), false);

  await recorder.recordResult(cmd.command_id, {
    status: 'SENT_AND_DOM_VERIFIED',
    clicked_send_button: true,
    verification: { verified: true, exact_user_turn_seen: true }
  });
  assert.equal(calls[1].p_event_kind, 'SEND_RESULT');
  assert.equal(calls[1].p_dom_send_verified, true);
  assert.equal(calls[1].p_clicked_send_button, true);

  await recorder.recordResult(cmd.command_id, {
    status: 'SENT_WEAK_DOM_VERIFIED',
    clicked_send_button: true,
    verification: { verified: true, exact_user_turn_seen: false }
  });
  assert.equal(calls[2].p_dom_send_verified, false);

  await recorder.recordResult(cmd.command_id, {
    status: 'SENT_ALREADY_DURABLE',
    clicked_send_button: true,
    verification: { verified: true, durable_replay: true }
  });
  assert.equal(calls[3].p_dom_send_verified, true);
}

// Binding rejects malformed hashes and target-agent/platform mismatch.
{
  const recorder = new BridgeReceiptRecorder({
    mode: 'REQUIRED',
    bridgeInstanceId: 'ci-bindings',
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    supabaseUrl: 'https://example.invalid',
    serviceRoleKey: 'test-only',
    fetchImpl: async () => response(200, {})
  });
  recorder.noteSnapshot('GLM_ZAI', snapshot);
  await assert.rejects(recorder.recordLease(command({ idempotency_key: 'not-a-hash' })), /receipt_invalid_idempotency_key/);
  await assert.rejects(recorder.recordLease(command({ target_agent: 'GPT' })), /receipt_target_pair_invalid/);
}

console.log('chat bridge receipt recorder behavioral contract: PASS');
