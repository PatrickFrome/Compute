import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOST_AGENT_PROTOCOL_SCHEMA,
  HostAgentNonceSequence,
  HostAgentNonceWindow,
  createHostAgentSessionKey,
  hostAgentProtocolManifest,
  signHostAgentFrame,
  verifyHostAgentFrame,
} from '../src/host-agent-protocol.mjs';

function sequence(fill) {
  return new HostAgentNonceSequence({ epoch: Buffer.alloc(16, fill) });
}

function request(nonce, overrides = {}) {
  return {
    schema: HOST_AGENT_PROTOCOL_SCHEMA,
    kind: 'REQUEST',
    request_id: 'req:replay:fence:v2',
    nonce,
    op: 'BROWSER_PLAN_EXECUTE',
    payload: { plan_id: 'plan-replay-fence-v2' },
    ...overrides,
  };
}

test('captured authenticated frame never becomes valid again after more than the legacy 4096-frame window', () => {
  const key = createHostAgentSessionKey();
  const sender = sequence(1);
  const window = new HostAgentNonceWindow();
  const first = signHostAgentFrame(request(sender.next()), key);

  assert.equal(verifyHostAgentFrame(first, key, { consumeNonce: (nonce) => window.consume(nonce) }).authenticated, true);
  for (let i = 0; i < 5000; i += 1) {
    const signed = signHostAgentFrame(request(sender.next(), { request_id: `req:replay:${String(i).padStart(5, '0')}` }), key);
    assert.equal(verifyHostAgentFrame(signed, key, { consumeNonce: (nonce) => window.consume(nonce) }).authenticated, true);
  }
  assert.throws(
    () => verifyHostAgentFrame(first, key, { consumeNonce: (nonce) => window.consume(nonce) }),
    /nonce_replayed/,
  );
  const snapshot = window.snapshot();
  assert.equal(snapshot.retained, 1);
  assert.equal(snapshot.mode, 'SEQUENCED_EPOCH_HIGH_WATER');
  assert.equal(snapshot.evicts_authenticated_epochs, false);
});

test('bounded reordering is accepted once but duplicate and stale sequence values fail closed', () => {
  const sender = sequence(2);
  const window = new HostAgentNonceWindow();
  const n1 = sender.next();
  const n2 = sender.next();
  const n3 = sender.next();

  assert.equal(window.consume(n1), true);
  assert.equal(window.consume(n3), true);
  assert.equal(window.consume(n2), true);
  assert.equal(window.consume(n2), false);
  assert.equal(window.consume(n1), false);

  let stale = null;
  for (let i = 0; i < 300; i += 1) {
    const nonce = sender.next();
    if (i === 0) stale = nonce;
    assert.equal(window.consume(nonce), true);
  }
  assert.equal(window.consume(stale), false);
});

test('authenticated sender epochs are never evicted; epoch-capacity exhaustion rejects new epochs', () => {
  const window = new HostAgentNonceWindow({ max: 32 });
  const firstSender = sequence(10);
  const first = firstSender.next();
  assert.equal(window.consume(first), true);

  for (let i = 1; i < 32; i += 1) {
    const sender = sequence(10 + i);
    assert.equal(window.consume(sender.next()), true);
  }
  const overflowSender = sequence(250);
  assert.equal(window.consume(overflowSender.next()), false);
  assert.equal(window.consume(first), false);
  assert.equal(window.snapshot().retained, 32);
});

test('protocol advertises non-evicting replay fence and mandatory key rotation on server restart', () => {
  const manifest = hostAgentProtocolManifest();
  assert.equal(manifest.replay_protection, 'SEQUENCED_EPOCH_HIGH_WATER_NO_EVICTION');
  assert.equal(manifest.session_key_rotation, 'REQUIRED_ON_SERVER_PROCESS_RESTART');
  assert.equal(manifest.raw_shell, false);
  assert.equal(manifest.raw_cdp_passthrough, false);
});
