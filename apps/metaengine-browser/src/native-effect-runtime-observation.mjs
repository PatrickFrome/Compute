export const NATIVE_EFFECT_RUNTIME_OBSERVATION_SCHEMA = 'metaengine.native-supervisor.effect-runtime-observation.v1';

const PROCESS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const RUNTIME_TARGET_RE = /^[A-Za-z0-9._:-]{1,192}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_OBSERVATIONS = 128;
const MAX_AGE_MS = 120000;
const observations = new Map();

const clean = (value) => String(value ?? '').trim();
const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

function keyOf(processIncarnationId, targetId, observedAt) {
  return `${clean(processIncarnationId).toLowerCase()}\u0000${clean(targetId).toLowerCase()}\u0000${clean(observedAt)}`;
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

function prune(now = Date.now()) {
  for (const [key, row] of observations) {
    const observedMs = Date.parse(row.observed_at);
    if (!Number.isFinite(observedMs) || now - observedMs > MAX_AGE_MS) observations.delete(key);
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
  const processId = clean(process_incarnation_id).toLowerCase();
  const targetId = clean(target_id).toLowerCase();
  const observed = new Date(observed_at);
  const urlHash = clean(document_url_sha256).toLowerCase();
  if (!PROCESS_ID_RE.test(processId)) throw new Error('native_effect_runtime_process_incarnation_invalid');
  if (!TARGET_RE.test(targetId)) throw new Error('native_effect_runtime_target_invalid');
  if (!Number.isFinite(observed.getTime())) throw new Error('native_effect_runtime_observed_at_invalid');
  if (!SHA256_RE.test(urlHash)) throw new Error('native_effect_runtime_document_url_hash_invalid');
  const binding = normalizeRuntimeBinding(runtime_binding);
  if (targetId !== `webcontents:${binding.web_contents_id}`) throw new Error('native_effect_runtime_webcontents_target_mismatch');

  const row = Object.freeze({
    schema: NATIVE_EFFECT_RUNTIME_OBSERVATION_SCHEMA,
    process_incarnation_id: processId,
    target_id: targetId,
    observed_at: observed.toISOString(),
    document_url_sha256: urlHash,
    runtime_binding: binding,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
  prune();
  observations.set(keyOf(processId, targetId, row.observed_at), row);
  prune();
  return row;
}

export function lookupNativeEffectRuntimeObservation({ process_incarnation_id, target_id, observed_at, now = Date.now() } = {}) {
  prune(Number(now));
  const row = observations.get(keyOf(process_incarnation_id, target_id, observed_at)) || null;
  if (!row) return null;
  const observedMs = Date.parse(row.observed_at);
  if (!Number.isFinite(observedMs) || Number(now) - observedMs > MAX_AGE_MS) return null;
  return row;
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
  return true;
}

export function clearNativeEffectRuntimeObservationsForTest() {
  observations.clear();
}
