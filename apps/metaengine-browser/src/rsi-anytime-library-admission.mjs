import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiExactConsumerOwnerReviewBundle,
  verifyRsiExactSkillPrecommitCertificate,
} from './rsi-exact-existing-consumer-owner-review.mjs';
import {
  createRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import {
  verifyRsiSkillLibraryGovernance,
} from './rsi-skill-library-governance.mjs';

export const RSI_PHASE33_SOURCE_QUALIFICATION_SCHEMA =
  'metaengine.rsi.phase33-source-qualification.v1';
export const RSI_ANYTIME_LIBRARY_ADMISSION_PROPOSAL_SCHEMA =
  'metaengine.rsi.anytime-library-admission-proposal.v1';
export const RSI_ANYTIME_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA =
  'metaengine.rsi.anytime-library-admission-certificate.v1';
export const RSI_ANYTIME_LIBRARY_ADMISSION_ARCHIVE_SCHEMA =
  'metaengine.rsi.anytime-library-admission-archive.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS = 2048;
const REQUIRED_SOURCE_WORKFLOWS = Object.freeze([
  'Browser Windows Package Smoke',
  'Browser Windows Installed Chat Qualification',
  'METAENGINE Browser Final Runtime Activation V1',
  'METAENGINE Browser Shell V1',
  'METAENGINE Browser Self Update E2E',
  'METAENGINE Browser Critical Audit V1',
  'METAENGINE Browser Windows Autonomous Soak V1',
]);
const TERMINAL_CONCLUSIONS = new Set(['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMED_OUT']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_phase34_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_phase34_${label}_sha_invalid`);
  return out;
}

function id(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_phase34_${label}_invalid`);
  return out;
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`rsi_phase34_${label}_invalid`);
  return out;
}

function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZero(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_phase34_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_phase34_${label}_automatic_retry_invalid`);
  }
}

export function createRsiPhase33SourceQualification({
  qualification_id,
  phase33_policy_source_sha,
  ci_checks,
  external_ci_observer = false,
  authored_by_candidate = true,
} = {}) {
  if (external_ci_observer !== true || authored_by_candidate !== false) {
    throw new Error('rsi_phase34_source_qualification_external_observer_required');
  }
  const sourceSha = exactSha(phase33_policy_source_sha, 'phase33_policy_source');
  if (!Array.isArray(ci_checks) || ci_checks.length !== REQUIRED_SOURCE_WORKFLOWS.length) {
    throw new Error('rsi_phase34_source_qualification_checks_invalid');
  }
  const byName = new Map();
  for (const raw of ci_checks) {
    const workflow = String(raw?.workflow || '').trim();
    if (!REQUIRED_SOURCE_WORKFLOWS.includes(workflow)) {
      throw new Error('rsi_phase34_source_qualification_unexpected_workflow');
    }
    if (byName.has(workflow)) throw new Error('rsi_phase34_source_qualification_duplicate_workflow');
    const conclusion = String(raw?.conclusion || '').trim().toUpperCase();
    if (!TERMINAL_CONCLUSIONS.has(conclusion)) {
      throw new Error('rsi_phase34_source_qualification_terminal_conclusion_required');
    }
    const headSha = exactSha(raw?.head_sha, 'source_qualification_check_head');
    if (headSha !== sourceSha) throw new Error('rsi_phase34_source_qualification_head_mismatch');
    byName.set(workflow, Object.freeze({
      workflow,
      run_id: positiveInt(raw?.run_id, 'source_qualification_run_id'),
      head_sha: headSha,
      conclusion,
      evidence_ref: id(raw?.evidence_ref, 'source_qualification_evidence_ref'),
    }));
  }
  for (const workflow of REQUIRED_SOURCE_WORKFLOWS) {
    if (!byName.has(workflow)) throw new Error('rsi_phase34_source_qualification_required_workflow_missing');
  }
  const ordered = Object.freeze(REQUIRED_SOURCE_WORKFLOWS.map((workflow) => byName.get(workflow)));
  const allGreen = ordered.every((row) => row.conclusion === 'SUCCESS');
  const core = zero({
    schema: RSI_PHASE33_SOURCE_QUALIFICATION_SCHEMA,
    version: 1,
    qualification_id: id(qualification_id, 'source_qualification_id'),
    phase33_policy_source_sha: sourceSha,
    ci_checks: ordered,
    required_workflows: REQUIRED_SOURCE_WORKFLOWS,
    all_required_workflows_present: true,
    all_required_workflows_terminal: true,
    all_required_workflows_green: allGreen,
    external_ci_observer: true,
    authored_by_candidate: false,
    source_qualification_is_runtime_authority: false,
    source_qualification_can_append_library: false,
    source_qualification_can_activate_skill: false,
  });
  return Object.freeze({ ...core, qualification_digest: digest(core) });
}

export function verifyRsiPhase33SourceQualification(row) {
  if (
    !row
    || row.schema !== RSI_PHASE33_SOURCE_QUALIFICATION_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_phase34_source_qualification_invalid');
  }
  assertZero(row, 'source_qualification');
  if (
    row.all_required_workflows_present !== true
    || row.all_required_workflows_terminal !== true
    || row.external_ci_observer !== true
    || row.authored_by_candidate !== false
    || row.source_qualification_is_runtime_authority !== false
    || row.source_qualification_can_append_library !== false
    || row.source_qualification_can_activate_skill !== false
  ) {
    throw new Error('rsi_phase34_source_qualification_policy_invalid');
  }
  const canonical = createRsiPhase33SourceQualification({
    qualification_id: row.qualification_id,
    phase33_policy_source_sha: row.phase33_policy_source_sha,
    ci_checks: row.ci_checks,
    external_ci_observer: true,
    authored_by_candidate: false,
  });
  if (canonical.qualification_digest !== exactDigest(row.qualification_digest, 'source_qualification')) {
    throw new Error('rsi_phase34_source_qualification_digest_mismatch');
  }
  return canonical;
}

function verifyPhase33({ bundle, certificate, phase32_evidence, phase33_certificate_args } = {}) {
  const checkedBundle = verifyRsiExactConsumerOwnerReviewBundle(bundle, phase32_evidence || {});
  const checkedCertificate = verifyRsiExactSkillPrecommitCertificate(
    certificate,
    phase33_certificate_args || {},
  );
  if (checkedCertificate.bundle_digest !== checkedBundle.bundle_digest) {
    throw new Error('rsi_phase34_phase33_bundle_certificate_mismatch');
  }
  if (checkedCertificate.state !== 'ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW') {
    throw new Error('rsi_phase34_phase33_precommit_not_eligible');
  }
  if (
    checkedCertificate.library_append_performed !== false
    || checkedCertificate.skill_activation_performed !== false
    || checkedCertificate.retrieval_exposure_changed !== false
  ) {
    throw new Error('rsi_phase34_phase33_precommit_authority_invalid');
  }
  return Object.freeze({ bundle: checkedBundle, certificate: checkedCertificate });
}

function proposedLibrary(currentLibrary, skill, evidence) {
  return createRsiVerifiedSkillLibrary({
    library_id: currentLibrary.library_id,
    entries: [
      ...currentLibrary.entries.map((row) => ({
        capsule: row.capsule,
        evidence: row.evidence,
      })),
      { capsule: skill, evidence },
    ],
    external_library_owner: true,
    authored_by_candidate: false,
  });
}

function parentContext(currentLibrary, currentGovernance, skill) {
  if (skill.parent_skill_digest == null) {
    if (skill.skill_version !== 1) throw new Error('rsi_phase34_new_skill_must_start_at_version_one');
    const conflict = currentLibrary.entries.find((row) => row.skill_id === skill.skill_id);
    if (conflict) throw new Error('rsi_phase34_new_skill_lineage_conflict');
    return Object.freeze({
      parent_skill_digest: null,
      parent_skill_version: null,
      parent_governance_state: null,
      parent_proven_positive: false,
      maturity_class: 'NEW_SKILL',
      required_change_envelope_class: 'STANDARD_NEW_SKILL',
    });
  }

  const parent = currentLibrary.entries.find((row) => row.skill_digest === skill.parent_skill_digest);
  if (!parent) throw new Error('rsi_phase34_parent_skill_missing');
  if (parent.skill_id !== skill.skill_id) throw new Error('rsi_phase34_parent_skill_id_mismatch');
  if (skill.skill_version !== parent.skill_version + 1) {
    throw new Error('rsi_phase34_parent_version_not_adjacent');
  }
  if (
    parent.role !== skill.role
    || parent.input_schema_digest !== skill.input_schema_digest
    || parent.output_schema_digest !== skill.output_schema_digest
  ) {
    throw new Error('rsi_phase34_parent_interface_drift');
  }
  if (JSON.stringify(parent.capabilities) !== JSON.stringify(skill.capabilities)) {
    throw new Error('rsi_phase34_parent_capability_drift');
  }

  const row = currentGovernance.entries.find((entry) => entry.skill_digest === parent.skill_digest);
  if (!row) throw new Error('rsi_phase34_parent_governance_missing');

  let maturityClass = 'STANDARD_PARENT';
  let requiredChangeEnvelope = 'STANDARD_REVISION';
  if (row.state === 'ACTIVE' && row.proven_positive === true) {
    maturityClass = 'MATURE_ACTIVE_PARENT';
    requiredChangeEnvelope = 'STRICT_MATURE_REVISION';
  } else if (row.state === 'QUARANTINED' || row.state === 'RETIRED') {
    maturityClass = 'REMEDIATION_PARENT';
    requiredChangeEnvelope = 'REMEDIATION_ONLY';
  } else if (row.state === 'EXPLORATION_ACTIVE' || row.state === 'DORMANT_CAP') {
    maturityClass = 'IMMATURE_OR_SHADOW_PARENT';
  }

  return Object.freeze({
    parent_skill_digest: parent.skill_digest,
    parent_skill_version: parent.skill_version,
    parent_governance_state: row.state,
    parent_proven_positive: row.proven_positive === true,
    maturity_class: maturityClass,
    required_change_envelope_class: requiredChangeEnvelope,
  });
}

export function createRsiAnytimeLibraryAdmissionProposal({
  proposal_id,
  bundle,
  certificate,
  phase32_evidence,
  phase33_certificate_args,
  current_library,
  current_governance,
  skill_capsule,
  skill_evidence,
  least_privilege_policy_digest,
  scope_replay_receipt_digest,
  maturity_policy_digest,
  parent_behavior_preservation_receipt_digest,
  change_envelope_class,
  least_privilege_pass = false,
  scope_replay_pass = false,
  parent_behavior_preservation_pass = false,
  maturity_change_envelope_pass = false,
  external_library_owner = false,
  external_scope_owner = false,
  external_maturity_reviewer = false,
  authored_by_candidate = true,
} = {}) {
  const p33 = verifyPhase33({ bundle, certificate, phase32_evidence, phase33_certificate_args });
  const library = verifyRsiVerifiedSkillLibrary(current_library);
  const governance = verifyRsiSkillLibraryGovernance(current_governance, library);
  const skill = verifyRsiSkillCapsule(skill_capsule);
  const evidence = verifyRsiSkillEvidence(skill_evidence, skill);

  if (
    external_library_owner !== true
    || external_scope_owner !== true
    || external_maturity_reviewer !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_phase34_external_owners_required');
  }
  if (library.library_digest !== p33.certificate.current_library_digest) {
    throw new Error('rsi_phase34_current_library_drift');
  }
  if (governance.library_digest !== library.library_digest) {
    throw new Error('rsi_phase34_current_governance_library_drift');
  }
  if (skill.skill_digest !== p33.certificate.proposed_skill_digest) {
    throw new Error('rsi_phase34_skill_digest_mismatch');
  }
  if (evidence.evidence_digest !== p33.certificate.standard_skill_evidence_digest) {
    throw new Error('rsi_phase34_skill_evidence_digest_mismatch');
  }
  if (evidence.verified_for_library !== true || evidence.hard_invariants_pass !== true) {
    throw new Error('rsi_phase34_verified_skill_evidence_required');
  }
  if (
    library.entries.some((row) => row.skill_digest === skill.skill_digest)
    || library.entries.some((row) => row.skill_id === skill.skill_id && row.skill_version === skill.skill_version)
  ) {
    throw new Error('rsi_phase34_skill_already_present');
  }

  const parent = parentContext(library, governance, skill);
  const normalizedEnvelope = String(change_envelope_class || '').trim().toUpperCase();
  if (normalizedEnvelope !== parent.required_change_envelope_class) {
    throw new Error('rsi_phase34_change_envelope_class_mismatch');
  }

  const roots = [
    exactDigest(least_privilege_policy_digest, 'least_privilege_policy'),
    exactDigest(scope_replay_receipt_digest, 'scope_replay_receipt'),
    exactDigest(maturity_policy_digest, 'maturity_policy'),
    exactDigest(parent_behavior_preservation_receipt_digest, 'parent_behavior_preservation_receipt'),
    p33.certificate.certificate_digest,
    p33.certificate.anytime_valid_certificate_digest,
    p33.certificate.false_admission_error_budget_policy_digest,
    p33.certificate.paired_instance_manifest_digest,
    p33.certificate.stopping_policy_digest,
    library.library_digest,
    governance.governance_digest,
    skill.skill_digest,
    evidence.evidence_digest,
  ];
  if (new Set(roots).size !== roots.length) {
    throw new Error('rsi_phase34_independent_admission_roots_required');
  }

  const blockers = [];
  if (least_privilege_pass !== true) blockers.push('LEAST_PRIVILEGE_REVIEW_FAILED');
  if (scope_replay_pass !== true) blockers.push('SCOPE_REPLAY_FAILED');
  if (parent_behavior_preservation_pass !== true) blockers.push('PARENT_BEHAVIOR_PRESERVATION_FAILED');
  if (maturity_change_envelope_pass !== true) blockers.push('MATURITY_CHANGE_ENVELOPE_FAILED');

  const successor = proposedLibrary(library, skill, evidence);
  const passed = blockers.length === 0;
  const core = zero({
    schema: RSI_ANYTIME_LIBRARY_ADMISSION_PROPOSAL_SCHEMA,
    version: 1,
    proposal_id: id(proposal_id, 'proposal_id'),
    source_sha: p33.certificate.source_sha,
    phase33_bundle_digest: p33.bundle.bundle_digest,
    phase33_certificate_digest: p33.certificate.certificate_digest,
    phase32_handoff_digest: p33.certificate.phase32_handoff_digest,
    phase32_receipt_digest: p33.certificate.phase32_receipt_digest,
    consumer_evaluation_contract_digest: p33.certificate.consumer_evaluation_contract_digest,
    current_library_id: library.library_id,
    current_library_digest: library.library_digest,
    current_governance_id: governance.governance_id,
    current_governance_digest: governance.governance_digest,
    proposed_skill_id: skill.skill_id,
    proposed_skill_version: skill.skill_version,
    proposed_skill_digest: skill.skill_digest,
    proposed_skill_evidence_digest: evidence.evidence_digest,
    proposed_successor_library_digest: successor.library_digest,
    proposed_successor_library_entry_count: successor.entry_count,
    parent_skill_digest: parent.parent_skill_digest,
    parent_skill_version: parent.parent_skill_version,
    parent_governance_state: parent.parent_governance_state,
    parent_proven_positive: parent.parent_proven_positive,
    maturity_class: parent.maturity_class,
    required_change_envelope_class: parent.required_change_envelope_class,
    change_envelope_class: normalizedEnvelope,
    least_privilege_policy_digest: roots[0],
    scope_replay_receipt_digest: roots[1],
    maturity_policy_digest: roots[2],
    parent_behavior_preservation_receipt_digest: roots[3],
    phase33_anytime_valid_certificate_digest: p33.certificate.anytime_valid_certificate_digest,
    phase33_false_admission_error_budget_policy_digest:
      p33.certificate.false_admission_error_budget_policy_digest,
    phase33_paired_instance_manifest_digest: p33.certificate.paired_instance_manifest_digest,
    phase33_stopping_policy_digest: p33.certificate.stopping_policy_digest,
    least_privilege_pass: least_privilege_pass === true,
    scope_replay_pass: scope_replay_pass === true,
    parent_behavior_preservation_pass: parent_behavior_preservation_pass === true,
    maturity_change_envelope_pass: maturity_change_envelope_pass === true,
    blockers: Object.freeze(blockers.sort()),
    state: passed
      ? 'READY_FOR_EXTERNAL_ANYTIME_LIBRARY_ADMISSION_CERTIFICATION'
      : 'HELD_LIBRARY_ADMISSION_PROPOSAL',
    existing_verified_skill_library_reused: true,
    existing_skill_library_governance_reused: true,
    second_skill_library_created: false,
    second_lifecycle_created: false,
    library_snapshot_exact_binding_required: true,
    governance_snapshot_exact_binding_required: true,
    least_privilege_required: true,
    scope_replay_required: true,
    maturity_sensitive_change_envelope_required: true,
    phase33_anytime_valid_certificate_reused: true,
    proposed_successor_is_append_only: true,
    proposed_successor_preserves_current_entries: true,
    proposed_successor_is_not_active_runtime_state: true,
    library_append_performed: false,
    retrieval_exposure_changed: false,
    skill_activation_performed: false,
    skill_lifecycle_mutated: false,
    meta_skill_profile_mutated: false,
    proposal_can_schedule_work: false,
    library_append_token: null,
  });
  return Object.freeze({
    ...core,
    proposed_successor_library: successor,
    admission_proposal_digest: digest(core),
  });
}

export function verifyRsiAnytimeLibraryAdmissionProposal(row, args = {}) {
  if (
    !row
    || row.schema !== RSI_ANYTIME_LIBRARY_ADMISSION_PROPOSAL_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_phase34_admission_proposal_invalid');
  }
  assertZero(row, 'admission_proposal');
  if (
    row.existing_verified_skill_library_reused !== true
    || row.existing_skill_library_governance_reused !== true
    || row.second_skill_library_created !== false
    || row.second_lifecycle_created !== false
    || row.library_snapshot_exact_binding_required !== true
    || row.governance_snapshot_exact_binding_required !== true
    || row.least_privilege_required !== true
    || row.scope_replay_required !== true
    || row.maturity_sensitive_change_envelope_required !== true
    || row.phase33_anytime_valid_certificate_reused !== true
    || row.proposed_successor_is_append_only !== true
    || row.proposed_successor_preserves_current_entries !== true
    || row.proposed_successor_is_not_active_runtime_state !== true
    || row.library_append_performed !== false
    || row.retrieval_exposure_changed !== false
    || row.skill_activation_performed !== false
    || row.skill_lifecycle_mutated !== false
    || row.meta_skill_profile_mutated !== false
    || row.proposal_can_schedule_work !== false
    || row.library_append_token !== null
  ) {
    throw new Error('rsi_phase34_admission_proposal_policy_invalid');
  }
  const canonical = createRsiAnytimeLibraryAdmissionProposal({
    ...args,
    proposal_id: row.proposal_id,
    least_privilege_policy_digest: row.least_privilege_policy_digest,
    scope_replay_receipt_digest: row.scope_replay_receipt_digest,
    maturity_policy_digest: row.maturity_policy_digest,
    parent_behavior_preservation_receipt_digest: row.parent_behavior_preservation_receipt_digest,
    change_envelope_class: row.change_envelope_class,
    least_privilege_pass: row.least_privilege_pass,
    scope_replay_pass: row.scope_replay_pass,
    parent_behavior_preservation_pass: row.parent_behavior_preservation_pass,
    maturity_change_envelope_pass: row.maturity_change_envelope_pass,
    external_library_owner: true,
    external_scope_owner: true,
    external_maturity_reviewer: true,
    authored_by_candidate: false,
  });
  if (canonical.admission_proposal_digest !== exactDigest(row.admission_proposal_digest, 'admission_proposal')) {
    throw new Error('rsi_phase34_admission_proposal_digest_mismatch');
  }
  if (
    canonical.proposed_successor_library.library_digest
    !== row.proposed_successor_library?.library_digest
  ) {
    throw new Error('rsi_phase34_successor_library_digest_mismatch');
  }
  return canonical;
}

export function createRsiAnytimeLibraryAdmissionCertificate({
  certificate_id,
  admission_proposal,
  admission_proposal_args,
  predecessor_source_qualification,
  admission_epoch_digest,
  library_owner_identity_digest,
  statistical_acceptor_identity_digest,
  source_qualification_owner_identity_digest,
  least_privilege_reviewer_identity_digest,
  governance_reviewer_identity_digest,
  anytime_valid_admission_pass = false,
  error_budget_available = false,
  paired_instance_replay_pass = false,
  least_privilege_recheck_pass = false,
  current_library_still_exact = false,
  current_governance_still_exact = false,
  no_new_negative_transfer = false,
  external_library_owner = false,
  external_statistical_acceptor = false,
  external_source_qualification_owner = false,
  external_least_privilege_reviewer = false,
  external_governance_reviewer = false,
  authored_by_candidate = true,
} = {}) {
  const proposal = verifyRsiAnytimeLibraryAdmissionProposal(
    admission_proposal,
    admission_proposal_args || {},
  );
  if (proposal.state !== 'READY_FOR_EXTERNAL_ANYTIME_LIBRARY_ADMISSION_CERTIFICATION') {
    throw new Error('rsi_phase34_admission_proposal_not_ready');
  }
  if (
    external_library_owner !== true
    || external_statistical_acceptor !== true
    || external_source_qualification_owner !== true
    || external_least_privilege_reviewer !== true
    || external_governance_reviewer !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_phase34_external_certificate_owners_required');
  }

  const principalIds = [
    exactDigest(library_owner_identity_digest, 'library_owner_identity'),
    exactDigest(statistical_acceptor_identity_digest, 'statistical_acceptor_identity'),
    exactDigest(source_qualification_owner_identity_digest, 'source_qualification_owner_identity'),
    exactDigest(least_privilege_reviewer_identity_digest, 'least_privilege_reviewer_identity'),
    exactDigest(governance_reviewer_identity_digest, 'governance_reviewer_identity'),
  ];
  if (new Set(principalIds).size !== principalIds.length) {
    throw new Error('rsi_phase34_certificate_separation_of_duties_required');
  }

  const sourceQualification = verifyRsiPhase33SourceQualification(predecessor_source_qualification);
  const policySource = sourceQualification.phase33_policy_source_sha;
  const roots = [
    sourceQualification.qualification_digest,
    exactDigest(admission_epoch_digest, 'admission_epoch'),
    ...principalIds,
    proposal.admission_proposal_digest,
    proposal.phase33_anytime_valid_certificate_digest,
    proposal.phase33_false_admission_error_budget_policy_digest,
    proposal.phase33_paired_instance_manifest_digest,
    proposal.phase33_stopping_policy_digest,
    proposal.current_library_digest,
    proposal.current_governance_digest,
    proposal.proposed_successor_library_digest,
  ];
  if (new Set(roots).size !== roots.length) {
    throw new Error('rsi_phase34_certificate_independent_roots_required');
  }

  const blockers = [];
  if (sourceQualification.all_required_workflows_green !== true) blockers.push('PREDECESSOR_SOURCE_QUALIFICATION_NOT_GREEN');
  if (anytime_valid_admission_pass !== true) blockers.push('ANYTIME_VALID_ADMISSION_NOT_PASS');
  if (error_budget_available !== true) blockers.push('FALSE_ADMISSION_ERROR_BUDGET_EXHAUSTED');
  if (paired_instance_replay_pass !== true) blockers.push('PAIRED_INSTANCE_REPLAY_NOT_PASS');
  if (least_privilege_recheck_pass !== true) blockers.push('LEAST_PRIVILEGE_RECHECK_NOT_PASS');
  if (current_library_still_exact !== true) blockers.push('CURRENT_LIBRARY_DRIFT');
  if (current_governance_still_exact !== true) blockers.push('CURRENT_GOVERNANCE_DRIFT');
  if (no_new_negative_transfer !== true) blockers.push('NEW_NEGATIVE_TRANSFER_DETECTED');

  const hardReject = blockers.some((code) => [
    'PREDECESSOR_SOURCE_QUALIFICATION_NOT_GREEN',
    'LEAST_PRIVILEGE_RECHECK_NOT_PASS',
    'CURRENT_LIBRARY_DRIFT',
    'CURRENT_GOVERNANCE_DRIFT',
    'NEW_NEGATIVE_TRANSFER_DETECTED',
  ].includes(code));
  const passed = blockers.length === 0;
  const state = passed
    ? 'ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'
    : (hardReject ? 'REJECTED_LIBRARY_ADMISSION' : 'ABSTAINED_LIBRARY_ADMISSION');

  const core = zero({
    schema: RSI_ANYTIME_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA,
    version: 1,
    certificate_id: id(certificate_id, 'certificate_id'),
    source_sha: proposal.source_sha,
    phase33_policy_source_sha: policySource,
    admission_proposal_digest: proposal.admission_proposal_digest,
    current_library_digest: proposal.current_library_digest,
    current_governance_digest: proposal.current_governance_digest,
    proposed_skill_digest: proposal.proposed_skill_digest,
    proposed_skill_evidence_digest: proposal.proposed_skill_evidence_digest,
    proposed_successor_library_digest: proposal.proposed_successor_library_digest,
    phase33_anytime_valid_certificate_digest: proposal.phase33_anytime_valid_certificate_digest,
    phase33_false_admission_error_budget_policy_digest:
      proposal.phase33_false_admission_error_budget_policy_digest,
    phase33_paired_instance_manifest_digest: proposal.phase33_paired_instance_manifest_digest,
    phase33_stopping_policy_digest: proposal.phase33_stopping_policy_digest,
    predecessor_source_qualification_digest: roots[0],
    predecessor_source_qualification: sourceQualification,
    admission_epoch_digest: roots[1],
    library_owner_identity_digest: principalIds[0],
    statistical_acceptor_identity_digest: principalIds[1],
    source_qualification_owner_identity_digest: principalIds[2],
    least_privilege_reviewer_identity_digest: principalIds[3],
    governance_reviewer_identity_digest: principalIds[4],
    predecessor_source_qualification_pass: sourceQualification.all_required_workflows_green === true,
    anytime_valid_admission_pass: anytime_valid_admission_pass === true,
    error_budget_available: error_budget_available === true,
    paired_instance_replay_pass: paired_instance_replay_pass === true,
    least_privilege_recheck_pass: least_privilege_recheck_pass === true,
    current_library_still_exact: current_library_still_exact === true,
    current_governance_still_exact: current_governance_still_exact === true,
    no_new_negative_transfer: no_new_negative_transfer === true,
    blockers: Object.freeze(blockers.sort()),
    state,
    paired_anytime_valid_admission_required: true,
    fixed_false_admission_error_budget_required: true,
    predecessor_source_qualification_required: true,
    exact_library_and_governance_readback_required: true,
    reviewer_separation_of_duties_required: true,
    append_handoff_one_attempt_only: true,
    ambiguous_append_retry_allowed: false,
    append_effect_performed: false,
    library_append_token: null,
    retrieval_exposure_change_authorized: false,
    skill_activation_authorized: false,
    lifecycle_mutation_authorized: false,
    rollback_or_quarantine_effect_authorized: false,
    certificate_can_schedule_work: false,
  });
  return Object.freeze({ ...core, admission_certificate_digest: digest(core) });
}

export function verifyRsiAnytimeLibraryAdmissionCertificate(row, args = {}) {
  if (
    !row
    || row.schema !== RSI_ANYTIME_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_phase34_admission_certificate_invalid');
  }
  assertZero(row, 'admission_certificate');
  if (
    row.paired_anytime_valid_admission_required !== true
    || row.fixed_false_admission_error_budget_required !== true
    || row.predecessor_source_qualification_required !== true
    || row.exact_library_and_governance_readback_required !== true
    || row.reviewer_separation_of_duties_required !== true
    || row.append_handoff_one_attempt_only !== true
    || row.ambiguous_append_retry_allowed !== false
    || row.append_effect_performed !== false
    || row.library_append_token !== null
    || row.retrieval_exposure_change_authorized !== false
    || row.skill_activation_authorized !== false
    || row.lifecycle_mutation_authorized !== false
    || row.rollback_or_quarantine_effect_authorized !== false
    || row.certificate_can_schedule_work !== false
  ) {
    throw new Error('rsi_phase34_admission_certificate_policy_invalid');
  }
  const canonical = createRsiAnytimeLibraryAdmissionCertificate({
    ...args,
    certificate_id: row.certificate_id,
    predecessor_source_qualification: row.predecessor_source_qualification,
    admission_epoch_digest: row.admission_epoch_digest,
    library_owner_identity_digest: row.library_owner_identity_digest,
    statistical_acceptor_identity_digest: row.statistical_acceptor_identity_digest,
    source_qualification_owner_identity_digest: row.source_qualification_owner_identity_digest,
    least_privilege_reviewer_identity_digest: row.least_privilege_reviewer_identity_digest,
    governance_reviewer_identity_digest: row.governance_reviewer_identity_digest,
    anytime_valid_admission_pass: row.anytime_valid_admission_pass,
    error_budget_available: row.error_budget_available,
    paired_instance_replay_pass: row.paired_instance_replay_pass,
    least_privilege_recheck_pass: row.least_privilege_recheck_pass,
    current_library_still_exact: row.current_library_still_exact,
    current_governance_still_exact: row.current_governance_still_exact,
    no_new_negative_transfer: row.no_new_negative_transfer,
    external_library_owner: true,
    external_statistical_acceptor: true,
    external_source_qualification_owner: true,
    external_least_privilege_reviewer: true,
    external_governance_reviewer: true,
    authored_by_candidate: false,
  });
  if (
    canonical.admission_certificate_digest
    !== exactDigest(row.admission_certificate_digest, 'admission_certificate')
  ) {
    throw new Error('rsi_phase34_admission_certificate_digest_mismatch');
  }
  return canonical;
}

function archiveState(sourceSha, rows) {
  const counts = {};
  for (const row of rows) {
    const state = row.certificate?.state || row.proposal.state;
    counts[state] = (counts[state] || 0) + 1;
  }
  const core = zero({
    schema: RSI_ANYTIME_LIBRARY_ADMISSION_ARCHIVE_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    rows,
    row_count: rows.length,
    state_counts: Object.freeze(counts),
    append_only: true,
    durable_before_visible: true,
    rejected_and_abstained_evidence_retained: true,
    proposed_successor_snapshots_are_not_active_state: true,
    archive_can_write_skill_library: false,
    archive_can_change_retrieval_exposure: false,
    archive_can_activate_skill: false,
    archive_can_change_lifecycle: false,
    archive_can_schedule_work: false,
  });
  return { ...core, state_digest: digest(core) };
}

export class RsiAnytimeLibraryAdmissionArchive {
  #path;
  #sourceSha;
  #resolver;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha, evidenceResolver } = {}) {
    if (!statePath) throw new Error('rsi_phase34_archive_path_required');
    if (typeof evidenceResolver !== 'function') throw new Error('rsi_phase34_archive_resolver_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'archive_source');
    this.#resolver = evidenceResolver;
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZero(parsed, 'archive');
      if (
        parsed.schema !== RSI_ANYTIME_LIBRARY_ADMISSION_ARCHIVE_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.append_only !== true
        || parsed.durable_before_visible !== true
        || parsed.rejected_and_abstained_evidence_retained !== true
        || parsed.proposed_successor_snapshots_are_not_active_state !== true
        || parsed.archive_can_write_skill_library !== false
        || parsed.archive_can_change_retrieval_exposure !== false
        || parsed.archive_can_activate_skill !== false
        || parsed.archive_can_change_lifecycle !== false
        || parsed.archive_can_schedule_work !== false
      ) {
        throw new Error('rsi_phase34_archive_policy_invalid');
      }
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(parsed.state_digest, 'archive')) {
        throw new Error('rsi_phase34_archive_digest_mismatch');
      }
      if (!Array.isArray(parsed.rows) || parsed.rows.length > MAX_ROWS) {
        throw new Error('rsi_phase34_archive_rows_invalid');
      }
      const seen = new Set();
      const checked = [];
      for (const row of parsed.rows) {
        const evidence = await this.#resolver({
          admission_proposal_digest: row.proposal.admission_proposal_digest,
          admission_certificate_digest: row.certificate?.admission_certificate_digest ?? null,
        });
        const proposal = verifyRsiAnytimeLibraryAdmissionProposal(
          row.proposal,
          evidence?.proposal_args || {},
        );
        const certificate = row.certificate
          ? verifyRsiAnytimeLibraryAdmissionCertificate(
            row.certificate,
            evidence?.certificate_args || {},
          )
          : null;
        if (proposal.source_sha !== this.#sourceSha) throw new Error('rsi_phase34_archive_source_mismatch');
        if (
          certificate
          && certificate.admission_proposal_digest !== proposal.admission_proposal_digest
        ) {
          throw new Error('rsi_phase34_archive_certificate_binding_mismatch');
        }
        if (seen.has(proposal.proposal_id)) throw new Error('rsi_phase34_archive_duplicate');
        seen.add(proposal.proposal_id);
        checked.push(Object.freeze({ proposal, certificate }));
      }
      this.#rows = checked;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist(rows) {
    const state = archiveState(this.#sourceSha, rows);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, this.#path);
  }

  async add({ proposal, certificate = null, proposal_args = {}, certificate_args = {} } = {}) {
    if (!this.#initialized) throw new Error('rsi_phase34_archive_not_initialized');
    const checkedProposal = verifyRsiAnytimeLibraryAdmissionProposal(proposal, proposal_args);
    const checkedCertificate = certificate
      ? verifyRsiAnytimeLibraryAdmissionCertificate(certificate, certificate_args)
      : null;
    if (checkedProposal.source_sha !== this.#sourceSha) throw new Error('rsi_phase34_archive_source_mismatch');
    if (
      checkedCertificate
      && checkedCertificate.admission_proposal_digest !== checkedProposal.admission_proposal_digest
    ) {
      throw new Error('rsi_phase34_archive_certificate_binding_mismatch');
    }

    const existing = this.#rows.find((row) => row.proposal.proposal_id === checkedProposal.proposal_id);
    if (existing) {
      if (
        existing.proposal.admission_proposal_digest !== checkedProposal.admission_proposal_digest
        || existing.certificate?.admission_certificate_digest
          !== (checkedCertificate?.admission_certificate_digest ?? null)
      ) {
        throw new Error('rsi_phase34_archive_identity_conflict');
      }
      return zero({
        state: 'IDEMPOTENT',
        admission_proposal_digest: checkedProposal.admission_proposal_digest,
      });
    }
    if (this.#rows.length >= MAX_ROWS) throw new Error('rsi_phase34_archive_capacity_exceeded');

    const next = [
      ...this.#rows,
      Object.freeze({ proposal: checkedProposal, certificate: checkedCertificate }),
    ];
    await this.#persist(next);
    this.#rows = next;
    return zero({
      state: checkedCertificate?.state ?? checkedProposal.state,
      admission_proposal_digest: checkedProposal.admission_proposal_digest,
      admission_certificate_digest: checkedCertificate?.admission_certificate_digest ?? null,
    });
  }

  snapshot() {
    const state = archiveState(this.#sourceSha, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      row_count: state.row_count,
      state_counts: state.state_counts,
      append_only: true,
      durable_before_visible: true,
      rejected_and_abstained_evidence_retained: true,
      proposed_successor_snapshots_are_not_active_state: true,
      archive_can_write_skill_library: false,
      archive_can_change_retrieval_exposure: false,
      archive_can_activate_skill: false,
      archive_can_change_lifecycle: false,
      archive_can_schedule_work: false,
      authority_effect: false,
    });
  }
}

export function rsiAnytimeLibraryAdmissionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.anytime-library-admission-root.v1',
    version: 1,
    phase33_exact_owner_precommit_required: true,
    exact_terminal_phase33_source_qualification_required: true,
    required_source_workflows: REQUIRED_SOURCE_WORKFLOWS,
    existing_verified_skill_library_reused: true,
    existing_skill_library_governance_reused: true,
    second_skill_library_allowed: false,
    second_lifecycle_allowed: false,
    exact_library_snapshot_binding_required: true,
    exact_governance_snapshot_binding_required: true,
    least_privilege_recheck_required: true,
    scope_replay_required: true,
    maturity_sensitive_change_envelope_required: true,
    mature_active_parent_requires_strict_change_envelope: true,
    paired_anytime_valid_admission_required: true,
    fixed_false_admission_error_budget_required: true,
    predecessor_source_qualification_required: true,
    reviewer_separation_of_duties_required: true,
    append_handoff_one_attempt_only: true,
    ambiguous_append_retry_allowed: false,
    append_does_not_imply_retrieval_exposure: true,
    rejected_and_abstained_evidence_retained: true,
    direct_library_append: false,
    direct_retrieval_exposure_change: false,
    direct_skill_activation: false,
    direct_lifecycle_mutation: false,
    direct_scheduler_action: false,
    direct_rollback_or_quarantine_effect: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, phase34_root_digest: digest(root) });
}
