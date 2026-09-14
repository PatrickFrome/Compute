import crypto from 'node:crypto';

export const NATIVE_EFFECT_RUNTIME_OBSERVATION_SCHEMA = 'metaengine.native-supervisor.effect-runtime-observation.v1';
export const NATIVE_RUNTIME_STATE_REVISION_SCHEMA = 'metaengine.native-browser.state-revision.v1';

const PROCESS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const RUNTIME_TARGET_RE = /^[A-Za-z0-9._:-]{1,192}$/;
const OBSERVATION_ID_RE = /^obs_[a-f0-9]{32}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const STATE_REVISION_ID_RE = /^rev_[a-f0-9]{64}$/;
const MAX_OBSERVATIONS = 128;
const MAX_AGE_MS = 180000;
const MAX_FUTURE_SKEW_MS = 5000;
const observations = new Map();

const clean = (value) => String(value ?? '').trim();
const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

function newObservationId() {
  return `obs_${crypto.randomUUID().replaceAll('-', '').toLowerCase()}`;
}

function normalizeRuntimeBinding(value = {}) {
  const webContentsId = positiveInt(value?.web_contents_id);
  const rendererPid = positiveInt(value?.renderer_pid ?? value?.os_pid);
  const attachmentGeneration = positiveInt(value?.attachment_generation);
  const documentGeneration = positiveInt(value?.document_generation);
  const bindingGeneration = positiveInt(value?.binding_generation);
  const runtimeTargetId = clean(value?.runtime_target_id ?? value?.target_id);
  if (!webContentsId || !rendererPid || !attachmentGeneration || !documentGeneration || !bindingGeneration) {
    throw new Error('native_effect_runtime_binding_generation_invalid');
  }
  if (!RUNTIME_TARGET_RE.test(runtimeTargetId)) throw new Error('native_effect_runtime_target_id_invalid');
  return Object.freeze({
    web_contents_id: webContentsId,
    renderer_pid: rendererPid,
    runtime_target_id: runtimeTargetId,
    attachment_generation: attachmentGeneration,
    document_generation: documentGeneration,
    binding_generation: bindingGeneration,
  });
}

function normalizeRevisionEnvelope({ process_incarnation_id, target_id, runtime_binding, document_url_sha256 } = {}) {
  const processId = clean(process_incarnation_id).toLowerCase();
  const targetId = clean(target_id).toLowerCase();
  const urlHash = clean(document_url_sha256).toLowerCase();
  if (!PROCESS_ID_RE.test(processId)) throw new Error('native_effect_runtime_process_incarnation_invalid');
  if (!TARGET_RE.test(targetId)) throw new Error('native_effect_runtime_target_invalid');
  if (!SHA256_RE.test(urlHash)) throw new Error('native_effect_runtime_document_url_hash_invalid');
  const binding = normalizeRuntimeBinding(runtime_binding);
  if (targetId !== `webcontents:${binding.web_contents_id}`) throw new Error('native_effect_runtime_webcontents_target_mismatch');
  return { processId, targetId, urlHash, binding };
}

export function projectNativeRuntimeStateRevision({
  process_incarnation_id,
  target_id,
  runtime_binding,
  document_url_sha256,
} = {}) {
  const { processId, targetId, urlHash, binding } = normalizeRevisionEnvelope({
    process_incarnation_id,
    target_id,
    runtime_binding,
    document_url_sha256,
  });
  const material = JSON.stringify([
    NATIVE_RUNTIME_STATE_REVISION_SCHEMA,
    processId,
    targetId,
    binding.web_contents_id,
    binding.renderer_pid,
    binding.runtime_target_id,
    binding.attachment_generation,
    binding.document_generation,
    binding.binding_generation,
    urlHash,
  ]);
  const revisionId = `rev_${crypto.createHash('sha256').update(material, 'utf8').digest('hex')}`;
  return Object.freeze({
    schema: NATIVE_RUNTIME_STATE_REVISION_SCHEMA,
    revision_id: revisionId,
    process_incarnation_id: processId,
    target_id: targetId,
    web_contents_id: binding.web_contents_id,
    renderer_pid: binding.renderer_pid,
    runtime_target_id: binding.runtime_target_id,
    attachment_generation: binding.attachment_generation,
    document_generation: binding.document_generation,
    binding_generation: binding.binding_generation,
    document_url_sha256: urlHash,
    page_data_authority: false,
    execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function prune(now = Date.now()) {
  const current = Number(now);
  for (const [key, row] of observations) {
    const observedMs = Date.parse(row.observed_at);
    if (!Number.isFinite(observedMs)
      || current - observedMs > MAX_AGE_MS
      || observedMs - current > MAX_FUTURE_SKEW_MS) observations.delete(key);
  }
  while (observations.size > MAX_OBSERVATIONS) observations.delete(observations.keys().next().value);
}

export function recordNativeEffectRuntimeObservation({
  process_incarnation_id,
  target_id,
  observed_at,
  runtime_binding,
  document_url_sha256,
} = {}) {
  const observed = new Date(observed_at);
  if (!Number.isFinite(observed.getTime())) throw new Error('native_effect_runtime_observed_at_invalid');
  if (observed.getTime() - Date.now() > MAX_FUTURE_SKEW_MS) throw new Error('native_effect_runtime_observed_at_future');
  const stateRevision = projectNativeRuntimeStateRevision({
    process_incarnation_id,
    target_id,
    runtime_binding,
    document_url_sha256,
  });
  const binding = Object.freeze({
    web_contents_id: stateRevision.web_contents_id,
    renderer_pid: stateRevision.renderer_pid,
    runtime_target_id: stateRevision.runtime_target_id,
    attachment_generation: stateRevision.attachment_generation,
    document_generation: stateRevision.document_generation,
    binding_generation: stateRevision.binding_generation,
  });

  const observationId = newObservationId();
  const row = Object.freeze({
    schema: NATIVE_EFFECT_RUNTIME_OBSERVATION_SCHEMA,
    observation_id: observationId,
    process_incarnation_id: stateRevision.process_incarnation_id,
    target_id: stateRevision.target_id,
    observed_at: observed.toISOString(),
    document_url_sha256: stateRevision.document_url_sha256,
    runtime_binding: binding,
    state_revision_id: stateRevision.revision_id,
    state_revision: stateRevision,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
  prune();
  observations.set(observationId, row);
  prune();
  return row;
}

export function lookupNativeEffectRuntimeObservation({
  observation_id,
  process_incarnation_id = null,
  target_id = null,
  observed_at = null,
  now = Date.now(),
} = {}) {
  const current = Number(now);
  if (!Number.isFinite(current)) return null;
  prune(current);
  const observationId = clean(observation_id).toLowerCase();
  if (!OBSERVATION_ID_RE.test(observationId)) return null;
  const row = observations.get(observationId) || null;
  if (!row) return null;
  const observedMs = Date.parse(row.observed_at);
  if (!Number.isFinite(observedMs)
    || current - observedMs > MAX_AGE_MS
    || observedMs - current > MAX_FUTURE_SKEW_MS) return null;
  if (process_incarnation_id != null && row.process_incarnation_id !== clean(process_incarnation_id).toLowerCase()) return null;
  if (target_id != null && row.target_id !== clean(target_id).toLowerCase()) return null;
  if (observed_at != null) {
    const exactObserved = new Date(observed_at);
    if (!Number.isFinite(exactObserved.getTime()) || row.observed_at !== exactObserved.toISOString()) return null;
  }
  return row;
}

export function latestNativeEffectRuntimeObservationForTarget({ target_id, now = Date.now() } = {}) {
  const current = Number(now);
  if (!Number.isFinite(current)) return null;
  prune(current);
  const targetId = clean(target_id).toLowerCase();
  if (!TARGET_RE.test(targetId)) return null;
  const rows = [...observations.values()];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.target_id === targetId) return row;
  }
  return null;
}

export function assertNativeEffectRuntimeBindingCurrent({ binding, runtime_binding, document_url_sha256 } = {}) {
  if (String(binding?.schema || '') !== 'metaengine.native-supervisor.effect-binding.v2') return true;
  const current = normalizeRuntimeBinding(runtime_binding);
  const hash = clean(document_url_sha256).toLowerCase();
  if (!SHA256_RE.test(hash)) throw new Error('native_effect_runtime_document_url_hash_invalid');
  for (const key of ['web_contents_id','renderer_pid','runtime_target_id','attachment_generation','document_generation','binding_generation']) {
    if (binding[key] !== current[key]) throw new Error(`native_effect_runtime_${key}_mismatch`);
  }
  if (binding.document_url_sha256 !== hash) throw new Error('native_effect_runtime_document_url_mismatch');
  if (binding.state_revision_id != null) {
    const revisionId = clean(binding.state_revision_id).toLowerCase();
    if (!STATE_REVISION_ID_RE.test(revisionId)) throw new Error('native_effect_runtime_state_revision_invalid');
    if (binding.state_revision_schema != null && binding.state_revision_schema !== NATIVE_RUNTIME_STATE_REVISION_SCHEMA) {
      throw new Error('native_effect_runtime_state_revision_schema_mismatch');
    }
    const currentRevision = projectNativeRuntimeStateRevision({
      process_incarnation_id: binding.process_incarnation_id,
      target_id: binding.target_id,
      runtime_binding: current,
      document_url_sha256: hash,
    });
    if (revisionId !== currentRevision.revision_id) throw new Error('native_effect_runtime_state_revision_mismatch');
  }
  return true;
}

export function clearNativeEffectRuntimeObservationsForTest() {
  observations.clear();
}