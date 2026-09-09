import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNativeEffectBinding,
  NATIVE_EFFECT_BINDING_SCHEMA,
} from '../src/native-effect-binding.mjs';
import { clearNativeEffectRuntimeObservationsForTest } from '../src/native-effect-runtime-observation.mjs';

const TAB = 'tab_00000000-0000-4000-8000-0000000000bb';
const CLIENT = '00000000-0000-4000-8000-0000000000cc';
const PROCESS = '00000000-0000-4000-8000-0000000000ee';
const COMMAND = {
  command_id: '00000000-0000-4000-8000-0000000000dd',
  idempotency_key: 'idem-1234567890123456',
  action: 'SCROLL',
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  payload: { tab_id: TAB, delta_y: 120 },
};

function build(overrides = {}) {
  return buildNativeEffectBinding({
    command: COMMAND,
    clientId: CLIENT,
    processIncarnationId: PROCESS,
    tabId: TAB,
    targetId: 'webcontents:77',
    observedAt: new Date().toISOString(),
    ...overrides,
  });
}

test('explicit runtime observation id can never silently downgrade to v1 when missing', () => {
  clearNativeEffectRuntimeObservationsForTest();
  assert.throws(
    () => build({ runtimeObservationId: `obs_${'a'.repeat(32)}` }),
    /native_effect_binding_runtime_observation_missing/,
  );
});

test('v1 compatibility remains only for callers that provide no runtime observation id', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const binding = build();
  assert.equal(binding.schema, NATIVE_EFFECT_BINDING_SCHEMA);
  assert.equal('runtime_observation_id' in binding, false);
});
