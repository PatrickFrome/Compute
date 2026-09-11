import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOST_AGENT_PROTOCOL_SCHEMA,
  HostAgentNonceWindow,
  createHostAgentNonce,
  createHostAgentSessionKey,
  hostAgentProtocolManifest,
  signHostAgentFrame,
  verifyHostAgentFrame,
} from '../src/host-agent-protocol.mjs';

function request(overrides = {}) {
  return {
    schema: HOST_AGENT_PROTOCOL_SCHEMA,
    kind: 'REQUEST',
    request_id: 'req:host:0001',
    nonce: createHostAgentNonce(),
    op: 'DEV_QUERY',
    payload: { query: 'bounded navigation' },
    ...overrides,
  };
}

test('host-agent frame authenticates and consumes nonce exactly once', () => {
  const key = createHostAgentSessionKey();
  const window = new HostAgentNonceWindow();
  const signed = signHostAgentFrame(request(), key);
  const verified = verifyHostAgentFrame(signed, key, { consumeNonce: (nonce) => window.consume(nonce) });

  assert.equal(verified.authenticated, true);
  assert.equal(verified.op, 'DEV_QUERY');
  assert.equal(verified.authority_effect, false);
  assert.throws(() => verifyHostAgentFrame(signed, key, { consumeNonce: (nonce) => window.consume(nonce) }), /nonce_replayed/);
});

test('tampered payload fails authentication', () => {
  const key = createHostAgentSessionKey();
  const signed = signHostAgentFrame(request(), key);
  assert.throws(() => verifyHostAgentFrame({ ...signed, payload: { query: 'different' } }, key), /auth_failed/);
});

test('unknown or raw-control operations fail closed', () => {
  const key = createHostAgentSessionKey();
  assert.throws(() => signHostAgentFrame(request({ op: 'RAW_SHELL' }), key), /op_denied/);
  assert.throws(() => signHostAgentFrame(request({ op: 'RAW_CDP' }), key), /op_denied/);
});

test('protocol manifest advertises no eval, shell, or raw CDP surface', () => {
  const manifest = hostAgentProtocolManifest();
  assert.equal(manifest.arbitrary_eval, false);
  assert.equal(manifest.raw_shell, false);
  assert.equal(manifest.raw_cdp_passthrough, false);
  assert.equal(manifest.authentication, 'HMAC_SHA256_SESSION_KEY');
  assert.equal(manifest.replay_protection, 'SEQUENCED_EPOCH_HIGH_WATER_NO_EVICTION');
  assert.equal(manifest.session_key_rotation, 'REQUIRED_ON_SERVER_PROCESS_RESTART');
});
