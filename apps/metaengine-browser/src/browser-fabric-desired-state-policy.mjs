import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';

export const BROWSER_FABRIC_DESIRED_STATE_POLICY_SCHEMA = 'metaengine.browser-fabric.desired-state-policy.v1';
export const BROWSER_FABRIC_DESIRED_STATE_DECISION_SCHEMA = 'metaengine.browser-fabric.desired-state-decision.v1';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_CHANNEL = /^[a-z][a-z0-9._-]{1,31}$/;

function hold(reason, extra = {}) {
  return Object.freeze({
    schema: BROWSER_FABRIC_DESIRED_STATE_DECISION_SCHEMA,
    action: 'HOLD_DESIRED_STATE',
    reason,
    desired_state_authority_candidate: false,
    queue_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function exactPolicyKeys(policy) {
  const expected = new Set([
    'schema', 'policy_version', 'generation', 'desired_integration_sha', 'release_channel',
    'required_release_tag', 'required_release_manifest_sha256', 'required_installed_executable_sha256',
    'minimum_guardian_protocol_generation', 'new_effect_domains_frozen', 'policy_effective_at',
  ]);
  return policy && typeof policy === 'object' && !Array.isArray(policy)
    && Object.keys(policy).length === expected.size
    && Object.keys(policy).every((key) => expected.has(key));
}

function normalizedPolicy(policy) {
  if (!exactPolicyKeys(policy) || policy.schema !== BROWSER_FABRIC_DESIRED_STATE_POLICY_SCHEMA) return null;
  const out = {
    schema: policy.schema,
    policy_version: String(policy.policy_version || ''),
    generation: Number(policy.generation),
    desired_integration_sha: String(policy.desired_integration_sha || '').toLowerCase(),
    release_channel: String(policy.release_channel || '').toLowerCase(),
    required_release_tag: String(policy.required_release_tag || ''),
    required_release_manifest_sha256: String(policy.required_release_manifest_sha256 || '').toLowerCase(),
    required_installed_executable_sha256: String(policy.required_installed_executable_sha256 || '').toLowerCase(),
    minimum_guardian_protocol_generation: Number(policy.minimum_guardian_protocol_generation),
    new_effect_domains_frozen: policy.new_effect_domains_frozen,
    policy_effective_at: String(policy.policy_effective_at || ''),
  };
  if (!/^\d+\.\d+\.\d+$/.test(out.policy_version)) return null;
  if (!Number.isSafeInteger(out.generation) || out.generation <= 0) return null;
  if (!GIT_SHA.test(out.desired_integration_sha) || !SAFE_CHANNEL.test(out.release_channel)) return null;
  if (!out.required_release_tag || !SHA256.test(out.required_release_manifest_sha256)
      || !SHA256.test(out.required_installed_executable_sha256)) return null;
  if (!Number.isSafeInteger(out.minimum_guardian_protocol_generation) || out.minimum_guardian_protocol_generation <= 0) return null;
  if (out.new_effect_domains_frozen !== true) return null;
  const at = Date.parse(out.policy_effective_at);
  if (!Number.isFinite(at)) return null;
  return Object.freeze(out);
}

export function browserFabricDesiredStatePolicyDigest(policy) {
  const normalized = normalizedPolicy(policy);
  return normalized ? fabricSha256(canonicalFabricJson(normalized)) : null;
}

/**
 * Versioned desired-state admission. A raw integration SHA is not desired-state
 * authority. The exact verified immutable release gate must agree with the
 * desired source, tag and artifact identities before this module can emit a
 * candidate for the separately journaled authority publisher.
 */
export function evaluateBrowserFabricDesiredStatePolicy({
  policy,
  current_policy_generation = 0,
  release_gate,
  observed_guardian_protocol_generation,
} = {}) {
  const normalized = normalizedPolicy(policy);
  if (!normalized) return hold('DESIRED_STATE_POLICY_INVALID');
  if (!Number.isSafeInteger(current_policy_generation) || current_policy_generation < 0) {
    return hold('CURRENT_POLICY_GENERATION_INVALID');
  }
  if (normalized.generation <= current_policy_generation) {
    return hold('DESIRED_STATE_POLICY_STALE_GENERATION', { policy_generation: normalized.generation });
  }

  if (!release_gate
      || release_gate.action !== 'AUTHORITY_ADVANCE_CANDIDATE'
      || release_gate.authority_advance_candidate !== true
      || release_gate.release_authority !== false
      || release_gate.authority_effect !== false) {
    return hold('VERIFIED_RELEASE_GATE_REQUIRED');
  }
  if (String(release_gate.candidate_sha || '').toLowerCase() !== normalized.desired_integration_sha) {
    return hold('DESIRED_STATE_RELEASE_SHA_MISMATCH');
  }
  if (String(release_gate.release_tag || '') !== normalized.required_release_tag) {
    return hold('DESIRED_STATE_RELEASE_TAG_MISMATCH');
  }
  if (String(release_gate.manifest_sha256 || '').toLowerCase() !== normalized.required_release_manifest_sha256) {
    return hold('DESIRED_STATE_MANIFEST_MISMATCH');
  }
  if (String(release_gate.installed_executable_sha256 || '').toLowerCase() !== normalized.required_installed_executable_sha256) {
    return hold('DESIRED_STATE_INSTALLED_EXE_MISMATCH');
  }

  const guardianProtocol = Number(observed_guardian_protocol_generation);
  if (!Number.isSafeInteger(guardianProtocol)
      || guardianProtocol < normalized.minimum_guardian_protocol_generation) {
    return hold('GUARDIAN_PROTOCOL_TOO_OLD_FOR_DESIRED_STATE');
  }

  const policyHash = fabricSha256(canonicalFabricJson(normalized));
  return Object.freeze({
    schema: BROWSER_FABRIC_DESIRED_STATE_DECISION_SCHEMA,
    action: 'DESIRED_STATE_AUTHORITY_CANDIDATE',
    reason: 'VERSIONED_POLICY_AND_VERIFIED_RELEASE_EXACT',
    policy_version: normalized.policy_version,
    policy_generation: normalized.generation,
    policy_hash: policyHash,
    desired_integration_sha: normalized.desired_integration_sha,
    release_channel: normalized.release_channel,
    release_tag: normalized.required_release_tag,
    minimum_guardian_protocol_generation: normalized.minimum_guardian_protocol_generation,
    new_effect_domains_frozen: true,
    desired_state_authority_candidate: true,
    requires_separate_journaled_authority_effect: true,
    queue_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function browserFabricDesiredStatePolicyContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_DESIRED_STATE_POLICY_SCHEMA,
    versioned_policy_required: true,
    monotonic_generation_required: true,
    git_sha_alone_is_authority: false,
    verified_immutable_release_gate_required: true,
    installed_executable_binding_required: true,
    guardian_protocol_floor_required: true,
    new_effect_domains_frozen: true,
    direct_authority_mutation_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
