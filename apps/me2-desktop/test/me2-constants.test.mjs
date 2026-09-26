import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUiSpawnMode,
  resolveInstanceAction,
  resolveGatewayRoute,
  parseHandshake,
  GATEWAY,
  CONTRACT,
} from '../src/shared/me2-constants.mjs';

test('ui spawn: bun present → bun server.js', () => {
  const plan = resolveUiSpawnMode({ bunAvailable: true });
  assert.equal(plan.mode, 'bun');
  assert.deepEqual(plan.args, ['server.js']);
  assert.equal(plan.runAsNode, false);
});

test('ui spawn: no bun → electron as node (R77 honest fallback)', () => {
  const plan = resolveUiSpawnMode({ bunAvailable: false });
  assert.equal(plan.mode, 'electron-node');
  assert.equal(plan.runAsNode, true);
});

test('ui spawn: explicit ME2_UI_BIN wins', () => {
  const plan = resolveUiSpawnMode({ bunAvailable: false, explicitBin: '/custom/bun' });
  assert.equal(plan.mode, 'explicit');
});

test('instance guard: primary vs secondary', () => {
  assert.equal(resolveInstanceAction({ lockAcquired: true }), 'primary');
  assert.equal(resolveInstanceAction({ lockAcquired: false, hasResurrectionSignal: true }), 'secondary-resurrect');
  assert.equal(resolveInstanceAction({ lockAcquired: false, hasResurrectionSignal: false }), 'secondary-exit');
});

test('gateway route: allowlist enforced', () => {
  const ok = resolveGatewayRoute({ url: '/agentchat?XTransformPort=3041', allowlist: GATEWAY.ALLOWED_TARGETS });
  assert.equal(ok.allow, true);
  assert.equal(ok.target, 3041);
  const notAllowed = resolveGatewayRoute({ url: '/x?XTransformPort=9999', allowlist: GATEWAY.ALLOWED_TARGETS });
  assert.equal(notAllowed.allow, false);
  assert.equal(notAllowed.reason, 'port_not_allowed');
  const missing = resolveGatewayRoute({ url: '/x', allowlist: GATEWAY.ALLOWED_TARGETS });
  assert.equal(missing.allow, true);
  assert.equal(missing.target, 3000);
  const junk = resolveGatewayRoute({ url: '/x?XTransformPort=abc', allowlist: GATEWAY.ALLOWED_TARGETS });
  assert.equal(junk.allow, false);
});

test('handshake: contract v1 accepted, mismatch rejected', () => {
  const good = parseHandshake(JSON.stringify({ version: '0.57.1', capabilities: { contract: 'me2-daemon-contract.v1', ops: ['agentchat:op'] } }));
  assert.equal(good.ok, true);
  assert.equal(good.version, '0.57.1');
  const bad = parseHandshake(JSON.stringify({ capabilities: { contract: 'something-else' } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'contract_mismatch');
  const junk = parseHandshake('not json');
  assert.equal(junk.ok, false);
});

test('handshake accepts daemon top-level contract shape', () => {
  assert.equal(parseHandshake({ contract: CONTRACT.SCHEMA, version: 'test', capabilities: { ops: [] } }).ok, true);
});
