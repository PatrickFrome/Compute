import crypto from 'node:crypto';

export const AGENT_SURFACE_PROOF_SCHEMA = 'metaengine.browser.agent-platform-surface-proof.v1';
export const AGENT_SURFACE_PROOF_STAGE = 'AGENT_HOME';

const HASH_RE = /^[a-f0-9]{64}$/;

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

export function agentSurfaceProofMaterial(proof) {
  if (!proof || proof.schema !== AGENT_SURFACE_PROOF_SCHEMA || proof.stage !== AGENT_SURFACE_PROOF_STAGE) {
    throw new Error('agent_origin_surface_proof_invalid');
  }
  if (proof.authority_effect === true || proof.execution_authority === true || proof.page_data_authority === true) {
    throw new Error('agent_origin_surface_proof_authority_invalid');
  }
  const targetId = String(proof.target_id || '').toLowerCase();
  const processIncarnationId = String(proof.process_incarnation_id || '');
  const stateRevisionId = String(proof.state_revision_id || '');
  const templateNames = [...new Set((Array.isArray(proof.template_names) ? proof.template_names : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .sort();
  if (!targetId || !processIncarnationId || !stateRevisionId || templateNames.length < 2) {
    throw new Error('agent_origin_surface_proof_incomplete');
  }
  return Object.freeze({
    schema: AGENT_SURFACE_PROOF_SCHEMA,
    stage: AGENT_SURFACE_PROOF_STAGE,
    target_id: targetId,
    process_incarnation_id: processIncarnationId,
    state_revision_id: stateRevisionId,
    template_names: Object.freeze(templateNames),
  });
}

export function digestAgentSurfaceProof(proof) {
  return sha256(JSON.stringify(agentSurfaceProofMaterial(proof)));
}

export function assertAgentSurfaceProofBinding({
  proof,
  expected_sha256,
  target_id,
  process_incarnation_id,
} = {}) {
  const material = agentSurfaceProofMaterial(proof);
  const expectedSha256 = String(expected_sha256 || '').toLowerCase();
  if (!HASH_RE.test(expectedSha256)) throw new Error('agent_origin_surface_hash_required');
  if (material.target_id !== String(target_id || '').toLowerCase()) {
    throw new Error('agent_origin_surface_target_mismatch');
  }
  if (material.process_incarnation_id !== String(process_incarnation_id || '')) {
    throw new Error('agent_origin_surface_process_incarnation_mismatch');
  }
  const actualSha256 = digestAgentSurfaceProof(proof);
  if (actualSha256 !== expectedSha256) throw new Error('agent_origin_surface_hash_mismatch');
  return Object.freeze({
    schema: 'metaengine.browser.agent-origin-binding.v1',
    state: 'PROVEN',
    agent_surface_sha256: actualSha256,
    target_id: material.target_id,
    process_incarnation_id: material.process_incarnation_id,
    state_revision_id: material.state_revision_id,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
