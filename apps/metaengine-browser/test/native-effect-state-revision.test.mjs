import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  clearNativeEffectRuntimeObservationsForTest,
  NATIVE_RUNTIME_STATE_REVISION_SCHEMA,
  projectNativeRuntimeStateRevision,
  recordNativeEffectRuntimeObservation,
} from '../src/native-effect-runtime-observation.mjs';
import {
  assertNativeEffectBindingMatches,
  buildNativeEffectBinding,
  NATIVE_EFFECT_BINDING_SCHEMA_V2,
} from '../src/native-effect-binding.mjs';

const PROCESS = '00000000-0000-4000-8000-0000000000aa';
const CLIENT = '00000000-0000-4000-8000-0000000000bb';
const COMMAND = '00000000-0000-4000-8000-0000000000cc';
const TAB = 'tab_00000000-0000-4000-8000-0000000000dd';
const TARGET = 'webcontents:77';
const URL_HASH = createHash('sha256').update('https://chatgpt.com/c/revision-test').digest('hex');

const runtimeBinding = (overrides = {}) => ({
  web_contents_id: 77,
  renderer_pid: 9001,
  runtime_target_id: 'target-77',
  attachment_generation: 2,
  document_generation: 4,
  binding_generation: 6,
  ...overrides,
});

function leasedCommand() {
  return {
    command_id: COMMAND,
    idempotency_key: 'idem-state-revision-0001',
    action: 'SCROLL',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    payload: { tab_id: TAB, delta_y: 180 },
  };
}

test('StateRevision is stable across observation samples for the same trusted runtime identity', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const observedAt = new Date().toISOString();
  const first = recordNativeEffectRuntimeObservation({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: observedAt,
    runtime_binding: runtimeBinding(),
    document_url_sha256: URL_HASH,
  });
  const second = recordNativeEffectRuntimeObservation({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: observedAt,
    runtime_binding: runtimeBinding(),
    document_url_sha256: URL_HASH,
  });

  assert.notEqual(first.observation_id, second.observation_id);
  assert.equal(first.state_revision_id, second.state_revision_id);
  assert.equal(first.state_revision.schema, NATIVE_RUNTIME_STATE_REVISION_SCHEMA);
  assert.equal(first.state_revision.authority_effect, false);
  assert.equal(first.state_revision.automatic_retry_allowed, false);
});

test('StateRevision changes on document, binding, process/target, or URL identity changes', () => {
  const base = projectNativeRuntimeStateRevision({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    runtime_binding: runtimeBinding(),
    document_url_sha256: URL_HASH,
  });
  const nextDocument = projectNativeRuntimeStateRevision({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    runtime_binding: runtimeBinding({ document_generation: 5, binding_generation: 7 }),
    document_url_sha256: URL_HASH,
  });
  const nextBinding = projectNativeRuntimeStateRevision({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    runtime_binding: runtimeBinding({ binding_generation: 7 }),
    document_url_sha256: URL_HASH,
  });
  const nextUrl = projectNativeRuntimeStateRevision({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    runtime_binding: runtimeBinding(),
    document_url_sha256: createHash('sha256').update('https://chatgpt.com/c/other').digest('hex'),
  });

  assert.match(base.revision_id, /^rev_[a-f0-9]{64}$/);
  assert.notEqual(base.revision_id, nextDocument.revision_id);
  assert.notEqual(base.revision_id, nextBinding.revision_id);
  assert.notEqual(base.revision_id, nextUrl.revision_id);
});

test('new v2 effect bindings carry deterministic StateRevision evidence and reject tampering', () => {
  clearNativeEffectRuntimeObservationsForTest();
  const observedAt = new Date().toISOString();
  const observation = recordNativeEffectRuntimeObservation({
    process_incarnation_id: PROCESS,
    target_id: TARGET,
    observed_at: observedAt,
    runtime_binding: runtimeBinding(),
    document_url_sha256: URL_HASH,
  });
  const command = leasedCommand();
  const binding = buildNativeEffectBinding({
    command,
    clientId: CLIENT,
    processIncarnationId: PROCESS,
    tabId: TAB,
    targetId: TARGET,
    observedAt,
    runtimeObservationId: observation.observation_id,
  });

  assert.equal(binding.schema, NATIVE_EFFECT_BINDING_SCHEMA_V2);
  assert.equal(binding.state_revision_id, observation.state_revision_id);
  assert.equal(binding.state_revision_schema, NATIVE_RUNTIME_STATE_REVISION_SCHEMA);

  assert.doesNotThrow(() => assertNativeEffectBindingMatches({
    command,
    binding,
    clientId: CLIENT,
    processIncarnationId: PROCESS,
    tabId: TAB,
    targetId: TARGET,
  }));

  assert.throws(
    () => assertNativeEffectBindingMatches({
      command,
      binding: { ...binding, state_revision_id: `rev_${'0'.repeat(64)}` },
      clientId: CLIENT,
      processIncarnationId: PROCESS,
      tabId: TAB,
      targetId: TARGET,
    }),
    /native_effect_binding_state_revision_id_mismatch/,
  );
});
