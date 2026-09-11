import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearNativeEffectRuntimeObservationsForTest,
  lookupNativeEffectRuntimeObservation,
  recordNativeEffectRuntimeObservation,
} from '../src/native-effect-runtime-observation.mjs';

const PROCESS = '00000000-0000-4000-8000-0000000000ee';
const TARGET = 'webcontents:77';
const HASH = 'a'.repeat(64);
const RUNTIME = {
  web_contents_id: 77,
  renderer_pid: 9001,
  runtime_target_id: 'target-77',
  attachment_generation: 1,
  document_generation: 1,
  binding_generation: 1,
};

function record(observedAt) {
  return recordNativeEffectRuntimeObservation({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: observedAt,
    runtime_binding: RUNTIME,
    document_url_sha256: HASH,
  });
}

test('far-future runtime observations fail closed at record time', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.throws(() => record(future), /native_effect_runtime_observed_at_future/);
});

test('lookup also rejects an observation when caller clock makes it implausibly future-dated', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const observed = Date.now();
  const row = record(new Date(observed).toISOString());
  const result = lookupNativeEffectRuntimeObservation({
    observation_id: row.observation_id,
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: row.observed_at,
    now: observed - 60_000,
  });
  assert.equal(result, null);
});

test('small clock skew remains tolerated while exact identity constraints still apply', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const observed = Date.now();
  const row = record(new Date(observed).toISOString());
  const result = lookupNativeEffectRuntimeObservation({
    observation_id: row.observation_id,
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: row.observed_at,
    now: observed - 1_000,
  });
  assert.equal(result?.observation_id, row.observation_id);
  assert.equal(result?.authority_effect, false);
});
