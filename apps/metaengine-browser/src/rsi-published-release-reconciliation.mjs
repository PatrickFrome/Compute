import crypto from 'node:crypto';

import {
  evaluateBrowserFabricReleaseAuthorityGate,
  BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
} from './browser-fabric-release-authority-gate.mjs';
import { verifyRsiExternalReleaseHandoffIntent } from './rsi-external-release-handoff-intent.mjs';

export const RSI_PUBLISHED_RELEASE_RECONCILIATION_SCHEMA = 'metaengine.rsi.published-release-reconciliation.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40.test(out)) throw new Error('rsi_release_reconcile_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!HEX64.test(out)) throw new Error('rsi_release_reconcile_' + label + '_digest_invalid');
  return 'sha256:' + out;
}

function boundedText(value, label, max = 256) {
  const out = String(value || '').trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) {
    throw new Error('rsi_release_reconcile_' + label + '_invalid');
  }
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'release_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_release_reconcile_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_release_reconcile_' + label + '_automatic_retry_invalid');
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function createRsiPublishedReleaseReconciliation({
  release_handoff_intent,
  current_authority_sha,
  trusted_release,
  immutable_release_evidence,
  provenance_evidence,
  source_ancestry_evidence,
  now = new Date(),
} = {}) {
  const intent = verifyRsiExternalReleaseHandoffIntent(release_handoff_intent);
  const currentAuthority = exactSha(current_authority_sha, 'current_authority');
  if (currentAuthority === intent.candidate_sha) {
    throw new Error('rsi_release_reconcile_authority_already_exact_requires_readback_path');
  }

  const gate = evaluateBrowserFabricReleaseAuthorityGate({
    candidate_sha: intent.candidate_sha,
    current_authority_sha: currentAuthority,
    trusted_release,
    immutable_release_evidence,
    provenance_evidence,
    source_ancestry_evidence,
    now,
  });
  assertZeroAuthority(gate, 'release_gate');
  if (
    gate.schema !== BROWSER_FABRIC_RELEASE_GATE_SCHEMA
    || gate.action !== 'AUTHORITY_ADVANCE_CANDIDATE'
    || gate.reason !== 'VERIFIED_IMMUTABLE_RELEASE_AND_ANCESTRY_EXACT'
    || gate.authority_advance_candidate !== true
    || gate.requires_separate_journaled_promotion_effect !== true
    || gate.promotion_unit !== 'IMMUTABLE_VERIFIED_RELEASE'
  ) {
    throw new Error('rsi_release_reconcile_gate_blocked:' + String(gate.reason || gate.action || 'unknown'));
  }
  if (exactSha(gate.candidate_sha, 'gate_candidate') !== intent.candidate_sha) {
    throw new Error('rsi_release_reconcile_candidate_identity_mismatch');
  }

  const releaseGitSha = exactSha(trusted_release?.git_sha, 'trusted_release');
  if (releaseGitSha !== intent.candidate_sha) throw new Error('rsi_release_reconcile_release_source_mismatch');
  if (trusted_release?.authority_effect !== false) throw new Error('rsi_release_reconcile_trusted_release_authority_invalid');

  const core = zeroAuthority({
    schema: RSI_PUBLISHED_RELEASE_RECONCILIATION_SCHEMA,
    version: 1,
    state: 'READY_FOR_EXTERNAL_AUTHORITY_ADVANCE_REVIEW',
    release_handoff_intent_digest: intent.handoff_intent_digest,
    episode_promotion_review_digest: intent.episode_promotion_review_digest,
    candidate_id: intent.candidate_id,
    candidate_sha: intent.candidate_sha,
    parent_sha: intent.parent_sha,
    previous_authority_sha: currentAuthority,
    candidate_identity_frozen: true,
    release_source_sha_exact: true,
    release_tag: boundedText(gate.release_tag, 'release_tag'),
    release_version: boundedText(gate.release_version, 'release_version'),
    installer_sha256: exactDigest(gate.installer_sha256, 'installer'),
    installed_executable_sha256: exactDigest(gate.installed_executable_sha256, 'installed_executable'),
    manifest_sha256: exactDigest(gate.manifest_sha256, 'manifest'),
    immutable_evidence_verifier_id: boundedText(gate.immutable_evidence_verifier_id, 'immutable_verifier'),
    provenance_verifier_id: boundedText(gate.provenance_verifier_id, 'provenance_verifier'),
    ancestry_verifier_id: boundedText(gate.ancestry_verifier_id, 'ancestry_verifier'),
    browser_fabric_release_gate_schema: gate.schema,
    browser_fabric_release_gate_digest: digest(gate),
    promotion_unit: gate.promotion_unit,
    immutable_release_verified: true,
    immutable_release_attestation_verified: immutable_release_evidence?.attestation_verified === true,
    slsa_provenance_verified: provenance_evidence?.verified === true,
    source_fast_forward_verified: source_ancestry_evidence?.fast_forward_verified === true,
    installed_executable_binding_verified: true,
    authority_advance_candidate: true,
    authority_advance_authorized: false,
    separate_journaled_promotion_effect_required: true,
    release_authority_mutation_performed: false,
    self_update_handoff_authorized: false,
    direct_install_authorized: false,
    one_attempt_physical_effect_required: true,
    ambiguous_effect_requires_reconciliation: true,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, reconciliation_digest: digest(core) });
}

export function verifyRsiPublishedReleaseReconciliation(row) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_PUBLISHED_RELEASE_RECONCILIATION_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_release_reconcile_schema_invalid');
  }
  assertZeroAuthority(row, 'row');
  if (
    row.state !== 'READY_FOR_EXTERNAL_AUTHORITY_ADVANCE_REVIEW'
    || row.candidate_identity_frozen !== true
    || row.release_source_sha_exact !== true
    || row.browser_fabric_release_gate_schema !== BROWSER_FABRIC_RELEASE_GATE_SCHEMA
    || row.promotion_unit !== 'IMMUTABLE_VERIFIED_RELEASE'
    || row.immutable_release_verified !== true
    || row.immutable_release_attestation_verified !== true
    || row.slsa_provenance_verified !== true
    || row.source_fast_forward_verified !== true
    || row.installed_executable_binding_verified !== true
    || row.authority_advance_candidate !== true
    || row.authority_advance_authorized !== false
    || row.separate_journaled_promotion_effect_required !== true
    || row.release_authority_mutation_performed !== false
    || row.self_update_handoff_authorized !== false
    || row.direct_install_authorized !== false
    || row.one_attempt_physical_effect_required !== true
    || row.ambiguous_effect_requires_reconciliation !== true
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_release_reconcile_policy_invalid');
  }

  exactSha(row.candidate_sha, 'candidate');
  exactSha(row.parent_sha, 'parent');
  exactSha(row.previous_authority_sha, 'previous_authority');
  for (const field of [
    'release_handoff_intent_digest',
    'episode_promotion_review_digest',
    'installer_sha256',
    'installed_executable_sha256',
    'manifest_sha256',
    'browser_fabric_release_gate_digest',
  ]) exactDigest(row[field], field);
  boundedText(row.release_tag, 'release_tag');
  boundedText(row.release_version, 'release_version');
  boundedText(row.immutable_evidence_verifier_id, 'immutable_verifier');
  boundedText(row.provenance_verifier_id, 'provenance_verifier');
  boundedText(row.ancestry_verifier_id, 'ancestry_verifier');

  const clone = structuredClone(row);
  const claimed = exactDigest(clone.reconciliation_digest, 'reconciliation');
  delete clone.reconciliation_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_release_reconcile_digest_mismatch');
  return row;
}

export function rsiPublishedReleaseReconciliationTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.published-release-reconciliation-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-published-release-reconciliation.mjs',
    release_gate_path: 'apps/metaengine-browser/src/browser-fabric-release-authority-gate.mjs',
    trusted_release_resolver_path: 'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
    candidate_identity_frozen: true,
    trusted_release_required: true,
    immutable_release_attestation_required: true,
    slsa_provenance_required: true,
    independent_fast_forward_proof_required: true,
    installed_executable_binding_required: true,
    authority_advance_is_candidate_only: true,
    separate_journaled_promotion_effect_required: true,
    direct_authority_mutation_allowed: false,
    self_update_handoff_authorized: false,
    direct_install_authorized: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, release_reconciliation_root_digest: digest(root) });
}
