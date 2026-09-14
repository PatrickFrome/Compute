import { createHash } from 'node:crypto';

export const NATIVE_SEMANTIC_REF_SCHEMA = 'metaengine.native-browser.semantic-ref.v1';

const STATE_REVISION_RE = /^rev_[a-f0-9]{64}$/;
const SEMANTIC_REF_RE = /^semref_[a-f0-9]{64}$/;

function requiredString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`native_semantic_ref_${field}_required`);
  return normalized;
}

function optionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function positiveSafeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`native_semantic_ref_${field}_invalid`);
  }
  return normalized;
}

function identityProjection({
  stateRevisionId,
  targetId,
  runtimeTargetId,
  frameId,
  backendNodeId,
  executionContextUniqueId = null,
} = {}) {
  const state_revision_id = requiredString(stateRevisionId, 'state_revision_id');
  if (!STATE_REVISION_RE.test(state_revision_id)) {
    throw new Error('native_semantic_ref_state_revision_id_invalid');
  }
  return Object.freeze({
    state_revision_id,
    target_id: requiredString(targetId, 'target_id'),
    runtime_target_id: requiredString(runtimeTargetId, 'runtime_target_id'),
    frame_id: requiredString(frameId, 'frame_id'),
    backend_node_id: positiveSafeInteger(backendNodeId, 'backend_node_id'),
    execution_context_unique_id: optionalString(executionContextUniqueId),
  });
}

function semanticRefId(identity) {
  const canonical = JSON.stringify([
    NATIVE_SEMANTIC_REF_SCHEMA,
    identity.state_revision_id,
    identity.target_id,
    identity.runtime_target_id,
    identity.frame_id,
    identity.backend_node_id,
    identity.execution_context_unique_id,
  ]);
  return `semref_${createHash('sha256').update(canonical).digest('hex')}`;
}

export function buildNativeSemanticRef({ role = null, name = null, ...identityInput } = {}) {
  const identity = identityProjection(identityInput);
  return Object.freeze({
    schema: NATIVE_SEMANTIC_REF_SCHEMA,
    semantic_ref_id: semanticRefId(identity),
    ...identity,
    evidence: Object.freeze({
      role: optionalString(role),
      name: optionalString(name),
      identity_authority: false,
    }),
    stale_by_default: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertRefShape(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new Error('native_semantic_ref_invalid');
  }
  if (ref.schema !== NATIVE_SEMANTIC_REF_SCHEMA || !SEMANTIC_REF_RE.test(String(ref.semantic_ref_id || ''))) {
    throw new Error('native_semantic_ref_invalid');
  }
  if (ref.automatic_retry_allowed !== false || ref.authority_effect !== false) {
    throw new Error('native_semantic_ref_authority_invalid');
  }
  const identity = identityProjection({
    stateRevisionId: ref.state_revision_id,
    targetId: ref.target_id,
    runtimeTargetId: ref.runtime_target_id,
    frameId: ref.frame_id,
    backendNodeId: ref.backend_node_id,
    executionContextUniqueId: ref.execution_context_unique_id,
  });
  if (semanticRefId(identity) !== ref.semantic_ref_id) {
    throw new Error('native_semantic_ref_integrity_mismatch');
  }
  return identity;
}

export function assertNativeSemanticRefCurrent({ ref, ...currentIdentity } = {}) {
  const bound = assertRefShape(ref);
  let current;
  try {
    current = identityProjection(currentIdentity);
  } catch {
    throw new Error('native_semantic_ref_stale');
  }
  if (semanticRefId(bound) !== semanticRefId(current)) {
    throw new Error('native_semantic_ref_stale');
  }
  return ref;
}
