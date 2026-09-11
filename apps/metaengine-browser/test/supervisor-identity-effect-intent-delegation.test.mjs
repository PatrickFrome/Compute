import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSupervisorIdentityDelegationRequest,
  supervisorIdentityDelegationManifest,
} from '../src/supervisor-identity-delegation.mjs';

const PREFIX = '/a2-browser-native-supervisor-v1/v1/commands';
const COMMAND_ID = '33333333-3333-4333-8333-333333333333';

test('effect-intent is delegated only for an exact UUID command route', () => {
  const request = normalizeSupervisorIdentityDelegationRequest({
    method: 'POST',
    request_path: `${PREFIX}/${COMMAND_ID}/effect-intent`,
    body_text: JSON.stringify({ binding: { authority_effect: false } }),
  });
  assert.equal(request.route, 'COMMAND_EFFECT_INTENT');
  assert.equal(request.method, 'POST');
  assert.equal(request.request_path, `${PREFIX}/${COMMAND_ID}/effect-intent`);

  for (const path of [
    `${PREFIX}/not-a-uuid/effect-intent`,
    `${PREFIX}/${COMMAND_ID}/effect-intent/extra`,
    `${PREFIX}//${COMMAND_ID}/effect-intent`,
    `${PREFIX}/${COMMAND_ID}/effect-intent?x=1`,
  ]) {
    assert.throws(
      () => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: path, body_text: '{}' }),
      /route_denied|path_invalid/,
    );
  }
  assert.throws(
    () => normalizeSupervisorIdentityDelegationRequest({ method: 'GET', request_path: `${PREFIX}/${COMMAND_ID}/effect-intent`, body_text: '' }),
    /route_denied/,
  );
});

test('delegation manifest does not turn effect-intent into enrollment or arbitrary signing authority', () => {
  const manifest = supervisorIdentityDelegationManifest();
  assert.equal(manifest.routes.includes('POST /v1/commands/{uuid}/effect-intent'), true);
  assert.equal(manifest.enrollment_authority, false);
  assert.equal(manifest.arbitrary_origin, false);
  assert.equal(manifest.arbitrary_headers, false);
  assert.equal(manifest.private_key_exported, false);
});
