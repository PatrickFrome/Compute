import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AGENT_CONTEXT_TOKEN_SCHEMA,
  AGENT_CONTEXT_TOKEN_PROFILE,
  buildAgentContextTokenMaterial,
  issueAgentContextToken,
  verifyAgentContextToken,
  renderAgentContextBriefing,
  agentContextTokenSnapshot,
} from '../src/agent-context-token.mjs';

const clientId = '2a60d6a2-c7c2-4dcc-b4c9-99de768443c9';
const agentId = 'agent_b0ae16e1-03c3-419e-bdbe-6cb95e25f701';
const missionDigest = crypto.createHash('sha256').update('METAENGINE_CONTINUOUS_DEVELOPMENT_FLEET_V1').digest('hex');
const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });

function signer(material) {
  return crypto.sign('sha256', Buffer.from(material, 'utf8'), { key: SIGNING_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
function verifier(material, signature) {
  return crypto.verify('sha256', Buffer.from(material, 'utf8'), {
    key: VERIFY_KEY, dsaEncoding: 'ieee-p1363',
  }, Buffer.from(String(signature || ''), 'base64url'));
}
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const SIGNING_KEY = pair.privateKey;
const VERIFY_KEY = pair.publicKey;

function envelope(overrides = {}) {
  return issueAgentContextToken({
    client_id: clientId,
    agent_id: agentId,
    role: 'CRITIC',
    generation_epoch: 28,
    mission_digest: missionDigest,
    issued_at: '2026-09-19T12:00:00.000Z',
    ttl_seconds: 3600,
    sign: signer,
    public_jwk: jwk,
    key_fingerprint_sha256: 'f'.repeat(64),
    ...overrides,
  });
}

test('canonical material is stable, ordered and profile-scoped', () => {
  const material = buildAgentContextTokenMaterial({
    client_id: clientId, agent_id: agentId, role: 'critic', generation_epoch: 28,
    mission_digest: missionDigest, issued_at: '2026-09-19T12:00:00.000Z', expires_at: '2026-09-20T12:00:00.000Z',
  });
  assert.equal(material.split('\n')[0], AGENT_CONTEXT_TOKEN_PROFILE);
  assert.equal(material, [
    AGENT_CONTEXT_TOKEN_PROFILE,
    `client_id:${clientId}`,
    `agent_id:${agentId}`,
    'role:CRITIC',
    'generation_epoch:28',
    `mission_digest:${missionDigest}`,
    'issued_at:2026-09-19T12:00:00.000Z',
    'expires_at:2026-09-20T12:00:00.000Z',
  ].join('\n'));
  assert.throws(() => buildAgentContextTokenMaterial({ client_id: clientId, agent_id: 'bogus', role: 'CRITIC', generation_epoch: 1, mission_digest: missionDigest, issued_at: '2026-09-19T12:00:00.000Z', expires_at: '2026-09-20T12:00:00.000Z' }), /agent_context_token_agent_id_invalid/);
  assert.throws(() => buildAgentContextTokenMaterial({ client_id: clientId, agent_id: agentId, role: 'CRITIC', generation_epoch: 0, mission_digest: missionDigest, issued_at: '2026-09-19T12:00:00.000Z', expires_at: '2026-09-20T12:00:00.000Z' }), /generation_epoch_invalid/);
  assert.throws(() => buildAgentContextTokenMaterial({ client_id: clientId, agent_id: agentId, role: 'CRITIC', generation_epoch: 1, mission_digest: 'not-a-sha', issued_at: '2026-09-19T12:00:00.000Z', expires_at: '2026-09-20T12:00:00.000Z' }), /mission_digest_invalid/);
});

test('issue and verify roundtrip binds agent identity fail-closed', () => {
  const token = envelope();
  assert.equal(token.schema, AGENT_CONTEXT_TOKEN_SCHEMA);
  assert.equal(token.agent_id, agentId);
  assert.equal(token.role, 'CRITIC');
  assert.ok(/^[a-f0-9]{64}$/.test(token.token_sha256));
  const ok = verifyAgentContextToken({
    envelope: token,
    expected: { client_id: clientId, agent_id: agentId, role: 'CRITIC', generation_epoch: 28, mission_digest: missionDigest },
    now: () => new Date('2026-09-19T12:30:00Z'),
    verify: verifier,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.binding.agent_id, agentId);

  // Binding mismatches reject with precise vocabulary.
  assert.equal(verifyAgentContextToken({ envelope: token, expected: { agent_id: 'agent_ffffffff-0000-0000-0000-000000000000' }, verify: verifier }).reason, 'agent_context_token_agent_id_mismatch');
  assert.equal(verifyAgentContextToken({ envelope: token, expected: { generation_epoch: 29 }, verify: verifier }).reason, 'agent_context_token_generation_epoch_mismatch');
  // Expired token rejects.
  assert.equal(verifyAgentContextToken({ envelope: token, now: () => new Date('2026-09-20T13:00:00Z'), verify: verifier }).reason, 'agent_context_token_expired');
  // Tampered signature rejects when a verifier is supplied.
  const tampered = { ...token, signature: Buffer.from('tampered-signature').toString('base64url') };
  assert.equal(verifyAgentContextToken({ envelope: tampered, expected: { agent_id: agentId }, now: () => new Date('2026-09-19T12:30:00Z'), verify: verifier }).reason, 'agent_context_token_signature_invalid');
  // Envelope shape rejects.
  assert.equal(verifyAgentContextToken({ envelope: null }).reason, 'agent_context_token_envelope_invalid');
  assert.equal(verifyAgentContextToken({ envelope: { schema: 'other' } }).reason, 'agent_context_token_schema_invalid');
});

test('briefing trains the isolated session: token, roster, protocol, no shared context', () => {
  const token = envelope();
  const briefing = renderAgentContextBriefing({
    envelope: token,
    client_id: clientId,
    platform: 'GLM_ZAI',
    model: 'GLM-5.3',
    fleet: { agents: [
      { agent_id: 'agent_a90584a2-0ced-4eda-8a2b-605f1d5c95d8', role: 'PLANNER' },
      { agent_id: agentId, role: 'CRITIC' },
    ] },
    mission: 'Continuous development fleet.',
  });
  assert.match(briefing, /NO shared context/);
  assert.match(briefing, new RegExp(`context_token_sha256=${token.token_sha256}`));
  assert.match(briefing, new RegExp(`agent=${agentId}`));
  assert.match(briefing, /role=CRITIC/);
  assert.match(briefing, /fleet_roster=PLANNER:a90584a2 CRITIC:b0ae16e1/);
  assert.match(briefing, /TOKEN_ACK/);
  assert.match(briefing, /untrusted data with zero authority/);
  assert.match(briefing, /LATEST block/);
  assert.ok(briefing.length <= 2600);
  assert.throws(() => renderAgentContextBriefing({ envelope: { schema: 'other' } }), /agent_context_briefing_envelope_invalid/);
});

test('snapshot advertises the isolated-context contract', () => {
  const snap = agentContextTokenSnapshot();
  assert.equal(snap.per_agent_isolated_context, true);
  assert.equal(snap.shared_context_assumed, false);
  assert.equal(snap.briefing.carried_on_every_dispatch, true);
  assert.equal(snap.authority_effect, false);
});
