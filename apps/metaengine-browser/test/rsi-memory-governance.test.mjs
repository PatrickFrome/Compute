import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  createRsiExperienceGraphQuery,
} from '../src/rsi-experience-graph.mjs';
import {
  createRsiMemorySecurityAudit,
  verifyRsiMemorySecurityAudit,
  createRsiMemoryRepairReceipt,
  verifyRsiMemoryRepairReceipt,
  createRsiMemoryGovernedView,
  verifyRsiMemoryGovernedView,
  retrieveRsiGovernedExperience,
  rsiMemoryGovernanceTrustRootSnapshot,
} from '../src/rsi-memory-governance.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;
const candidateId = (char) => `candidate_sha256_${char.repeat(64)}`;

function anchor() {
  return {
    task_id: 'task.memory.security',
    task_signature_digest: d('1'),
    challenge_family: 'MEMORY_SECURITY',
    hidden_manifest_digest: d('2'),
    external_writer: true,
    authored_by_candidate: false,
  };
}

function experienceCase(id, attempt, candidate, outcome = 'SUCCESS', {
  failures = [],
  mechanisms = ['VERIFIED_MEMORY'],
  evidence = '3',
} = {}) {
  return createRsiExperienceCase({
    case_id: id,
    task_id: 'task.memory.security',
    task_signature_digest: d('1'),
    attempt_index: attempt,
    candidate_id: candidateId(candidate),
    candidate_sha: sha(candidate),
    outcome,
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    execution_signature_digest: d(candidate),
    failure_codes: outcome === 'FAILURE' ? failures : [],
    mechanism_tags: mechanisms,
    lesson_digests: [],
    attribution_digests: [],
    transfer_receipt_digests: [],
    evidence_digest: d(evidence),
    evidence_refs: [`RUN_${id}`],
    external_writer: true,
    authored_by_candidate: false,
  });
}

function graph() {
  const poisoned = experienceCase('case.poisoned.1', 1, '1', 'FAILURE', {
    failures: ['MEMORY_RETRIEVAL_INJECTION'],
    mechanisms: ['UNTRUSTED_MEMORY'],
    evidence: '4',
  });
  const repaired = experienceCase('case.repaired.2', 2, '2', 'SUCCESS', {
    mechanisms: ['VERIFIED_MEMORY', 'SELECTIVE_REPAIR'],
    evidence: '5',
  });
  const safe = experienceCase('case.safe.3', 3, '3', 'SUCCESS', {
    mechanisms: ['VERIFIED_MEMORY'],
    evidence: '6',
  });
  return createRsiExperienceGraphSnapshot({
    graph_id: 'rsi.memory.security.graph',
    epoch: 1,
    task_anchors: [anchor()],
    cases: [poisoned, repaired, safe],
    similarity_edges: [
      {
        left_case_id: poisoned.case_id,
        right_case_id: safe.case_id,
        similarity_score: 0.96,
        embedding_model_digest: d('7'),
        external_indexer: true,
        authored_by_candidate: false,
      },
      {
        left_case_id: repaired.case_id,
        right_case_id: safe.case_id,
        similarity_score: 0.90,
        embedding_model_digest: d('7'),
        external_indexer: true,
        authored_by_candidate: false,
      },
    ],
    correction_edges: [{
      from_case_id: poisoned.case_id,
      to_case_id: repaired.case_id,
      evidence_digest: d('8'),
      external_verifier: true,
      authored_by_candidate: false,
    }],
    utility_receipts: [],
  });
}

function audit(snapshot, caseId, seq, decision, {
  risks = [],
  semantic = 0.05,
  radius = 0.05,
  access = 0.05,
  revalidate = snapshot.epoch + 4,
  evidence = '9',
} = {}) {
  const row = snapshot.cases.find((item) => item.case_id === caseId);
  return createRsiMemorySecurityAudit({
    audit_id: `audit.${caseId}.${seq}`,
    graph_id: snapshot.graph_id,
    observed_snapshot_digest: snapshot.snapshot_digest,
    observed_graph_epoch: snapshot.epoch,
    case_id: row.case_id,
    case_digest: row.case_digest,
    audit_seq: seq,
    decision,
    risk_codes: risks,
    semantic_risk_score: semantic,
    attack_radius_score: radius,
    access_risk_score: access,
    provenance_attestation_digest: d('a'),
    revalidate_after_epoch: revalidate,
    evidence_digest: d(evidence),
    evidence_refs: [`SECURITY_AUDIT_${caseId}_${seq}`],
    external_security_auditor: true,
    authored_by_candidate: false,
  });
}

function acceptedAudits(snapshot) {
  return [
    audit(snapshot, 'case.repaired.2', 1, 'ACCEPT'),
    audit(snapshot, 'case.safe.3', 1, 'ACCEPT'),
  ];
}

test('new memory is review-required by default and cannot enter retrieval before explicit security audit', () => {
  const snapshot = graph();
  const view = createRsiMemoryGovernedView({
    snapshot,
    audit_receipts: [audit(snapshot, 'case.safe.3', 1, 'ACCEPT')],
  });
  verifyRsiMemoryGovernedView(view, {
    snapshot,
    audit_receipts: [audit(snapshot, 'case.safe.3', 1, 'ACCEPT')],
  });
  assert.equal(view.state_counts.ACTIVE, 1);
  assert.equal(view.state_counts.REVIEW_REQUIRED, 2);
  assert.deepEqual(view.eligible_case_ids, ['case.safe.3']);
  assert.equal(view.unaudited_memory_default, 'REVIEW_REQUIRED');
  assert.equal(view.candidate_can_write_audit, false);
  assert.equal(view.authority_effect, false);
});

test('ACCEPT fails closed when any risk code or risk score exceeds fixed policy threshold', () => {
  const snapshot = graph();
  assert.throws(() => audit(snapshot, 'case.safe.3', 1, 'ACCEPT', {
    risks: ['PERSISTENT_POISONING'],
  }), /accept_risk_policy_violation/);
  assert.throws(() => audit(snapshot, 'case.safe.3', 1, 'ACCEPT', {
    semantic: 0.26,
  }), /accept_risk_policy_violation/);
  assert.throws(() => audit(snapshot, 'case.safe.3', 1, 'ACCEPT', {
    radius: 0.26,
  }), /accept_risk_policy_violation/);
  assert.throws(() => audit(snapshot, 'case.safe.3', 1, 'ACCEPT', {
    access: 0.26,
  }), /accept_risk_policy_violation/);
});

test('candidate-authored memory audit cannot clear itself and unknown fields fail closed', () => {
  const snapshot = graph();
  const safe = snapshot.cases.find((row) => row.case_id === 'case.safe.3');
  assert.throws(() => createRsiMemorySecurityAudit({
    audit_id: 'audit.self.clear',
    graph_id: snapshot.graph_id,
    observed_snapshot_digest: snapshot.snapshot_digest,
    observed_graph_epoch: snapshot.epoch,
    case_id: safe.case_id,
    case_digest: safe.case_digest,
    audit_seq: 1,
    decision: 'ACCEPT',
    risk_codes: [],
    semantic_risk_score: 0,
    attack_radius_score: 0,
    access_risk_score: 0,
    provenance_attestation_digest: d('a'),
    revalidate_after_epoch: 4,
    evidence_digest: d('b'),
    evidence_refs: ['MODEL_SELF_CLEAR'],
    external_security_auditor: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  const valid = audit(snapshot, 'case.safe.3', 1, 'ACCEPT');
  assert.throws(() => verifyRsiMemorySecurityAudit({
    ...valid,
    model_rationale: 'trust me',
  }), /audit_fields_invalid/);
});

test('quarantined memory is removed before graph diffusion so it cannot act as a retrieval bridge', () => {
  const snapshot = graph();
  const audits = [
    audit(snapshot, 'case.poisoned.1', 1, 'QUARANTINE', {
      risks: ['RETRIEVAL_INJECTION', 'PERSISTENT_POISONING'],
      semantic: 0.95,
      radius: 0.90,
      access: 0.80,
    }),
    ...acceptedAudits(snapshot),
  ];
  const view = createRsiMemoryGovernedView({ snapshot, audit_receipts: audits });
  assert.equal(view.state_counts.QUARANTINED, 1);
  assert.equal(view.blocked_nodes_removed_before_graph_diffusion, true);
  assert.equal(view.blocked_edges_removed_before_graph_diffusion, true);
  assert.equal(view.governed_snapshot.case_count, 2);
  assert.equal(view.governed_snapshot.cases.some((row) => row.case_id === 'case.poisoned.1'), false);
  assert.equal(
    view.governed_snapshot.similarity_edges.some((row) => row.left_case_id === 'case.poisoned.1' || row.right_case_id === 'case.poisoned.1'),
    false,
  );
  assert.equal(view.governed_snapshot.correction_edges.length, 0);

  const query = createRsiExperienceGraphQuery({
    query_id: 'query.governed.safe',
    target_context_digest: d('c'),
    task_signature_digest: d('1'),
    challenge_family: 'MEMORY_SECURITY',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    failure_codes: [],
    mechanism_tags: ['VERIFIED_MEMORY'],
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiGovernedExperience({ snapshot, audit_receipts: audits, query });
  assert.equal(result.state, 'GOVERNED_RETRIEVAL');
  assert.equal(result.items.some((row) => row.case_id === 'case.poisoned.1'), false);
  assert.equal(result.blocked_memory_cannot_influence_graph_diffusion, true);
  assert.equal(result.candidate_can_bypass_governance, false);
});

test('query cannot explicitly bridge through quarantined memory', () => {
  const snapshot = graph();
  const audits = [
    audit(snapshot, 'case.poisoned.1', 1, 'QUARANTINE', {
      risks: ['RETRIEVAL_INJECTION'],
      semantic: 0.9,
      radius: 0.8,
      access: 0.8,
    }),
    ...acceptedAudits(snapshot),
  ];
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.governed.poisoned-bridge',
    target_context_digest: d('c'),
    task_signature_digest: d('1'),
    challenge_family: 'MEMORY_SECURITY',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    bridge_case_ids: ['case.poisoned.1'],
    external_query_context: true,
    authored_by_candidate: false,
  });
  assert.throws(() => retrieveRsiGovernedExperience({ snapshot, audit_receipts: audits, query }), /bridge_case_not_eligible/);
});

test('audit expires by graph epoch and stale memory becomes fail-closed review-required without deleting history', () => {
  const first = graph();
  const audits = [
    audit(first, 'case.safe.3', 1, 'ACCEPT', { revalidate: 2 }),
  ];
  const firstView = createRsiMemoryGovernedView({ snapshot: first, audit_receipts: audits });
  assert.deepEqual(firstView.eligible_case_ids, ['case.safe.3']);

  const extra = experienceCase('case.new.4', 4, '4', 'SUCCESS', {
    mechanisms: ['VERIFIED_MEMORY'],
    evidence: 'b',
  });
  const second = extendRsiExperienceGraphSnapshot({
    previous_snapshot: first,
    cases: [extra],
  });
  const secondView = createRsiMemoryGovernedView({ snapshot: second, audit_receipts: audits });
  const stale = secondView.case_states.find((row) => row.case_id === 'case.safe.3');
  assert.equal(stale.state, 'STALE_REVIEW_REQUIRED');
  assert.equal(stale.eligible_for_retrieval, false);
  assert.equal(second.cases.some((row) => row.case_id === 'case.safe.3'), true, 'source history stays intact');
  assert.equal(secondView.stale_memory_default, 'STALE_REVIEW_REQUIRED');
});

test('selective repair supersedes poisoned source only after independent replacement ACCEPT and preserves source history', () => {
  const snapshot = graph();
  const sourceAudit = audit(snapshot, 'case.poisoned.1', 1, 'REVOKE', {
    risks: ['PERSISTENT_POISONING', 'RETRIEVAL_INJECTION'],
    semantic: 1,
    radius: 0.9,
    access: 0.9,
  });
  const replacementAudit = audit(snapshot, 'case.repaired.2', 1, 'ACCEPT');
  const safeAudit = audit(snapshot, 'case.safe.3', 1, 'ACCEPT');
  const repair = createRsiMemoryRepairReceipt({
    repair_id: 'repair.poisoned.1',
    graph_id: snapshot.graph_id,
    observed_snapshot_digest: snapshot.snapshot_digest,
    source_case_id: 'case.poisoned.1',
    source_case_digest: snapshot.cases.find((row) => row.case_id === 'case.poisoned.1').case_digest,
    source_audit_digest: sourceAudit.audit_digest,
    replacement_case_id: 'case.repaired.2',
    replacement_case_digest: snapshot.cases.find((row) => row.case_id === 'case.repaired.2').case_digest,
    replacement_audit_digest: replacementAudit.audit_digest,
    evidence_digest: d('d'),
    evidence_refs: ['SELECTIVE_REPAIR_1'],
    external_repair_verifier: true,
    authored_by_candidate: false,
  });
  verifyRsiMemoryRepairReceipt(repair);

  const view = createRsiMemoryGovernedView({
    snapshot,
    audit_receipts: [sourceAudit, replacementAudit, safeAudit],
    repair_receipts: [repair],
  });
  const sourceState = view.case_states.find((row) => row.case_id === 'case.poisoned.1');
  assert.equal(sourceState.state, 'SUPERSEDED_BY_VERIFIED_REPAIR');
  assert.equal(sourceState.replacement_case_id, 'case.repaired.2');
  assert.equal(sourceState.eligible_for_retrieval, false);
  assert.equal(view.source_history_preserved, true);
  assert.equal(view.destructive_delete_authorized, false);
  assert.equal(snapshot.cases.some((row) => row.case_id === 'case.poisoned.1'), true);
  assert.equal(view.eligible_case_ids.includes('case.repaired.2'), true);
});

test('repair cannot use unaccepted replacement or cross-task/older attempt and candidate cannot self-repair', () => {
  const snapshot = graph();
  const sourceAudit = audit(snapshot, 'case.poisoned.1', 1, 'QUARANTINE', {
    risks: ['PERSISTENT_POISONING'],
    semantic: 0.8,
    radius: 0.8,
    access: 0.8,
  });
  const reviewAudit = audit(snapshot, 'case.repaired.2', 1, 'REVIEW', {
    risks: ['PROVENANCE_LOSS'],
    semantic: 0.4,
    radius: 0.3,
    access: 0.3,
  });
  const repair = createRsiMemoryRepairReceipt({
    repair_id: 'repair.invalid.unaccepted',
    graph_id: snapshot.graph_id,
    observed_snapshot_digest: snapshot.snapshot_digest,
    source_case_id: 'case.poisoned.1',
    source_case_digest: snapshot.cases[0].case_digest,
    source_audit_digest: sourceAudit.audit_digest,
    replacement_case_id: 'case.repaired.2',
    replacement_case_digest: snapshot.cases[1].case_digest,
    replacement_audit_digest: reviewAudit.audit_digest,
    evidence_digest: d('e'),
    evidence_refs: ['REPAIR_REVIEW_ONLY'],
    external_repair_verifier: true,
    authored_by_candidate: false,
  });
  assert.throws(() => createRsiMemoryGovernedView({
    snapshot,
    audit_receipts: [sourceAudit, reviewAudit],
    repair_receipts: [repair],
  }), /replacement_not_active/);

  assert.throws(() => createRsiMemoryRepairReceipt({
    repair_id: 'repair.self',
    graph_id: snapshot.graph_id,
    observed_snapshot_digest: snapshot.snapshot_digest,
    source_case_id: 'case.poisoned.1',
    source_case_digest: snapshot.cases[0].case_digest,
    source_audit_digest: sourceAudit.audit_digest,
    replacement_case_id: 'case.repaired.2',
    replacement_case_digest: snapshot.cases[1].case_digest,
    replacement_audit_digest: reviewAudit.audit_digest,
    evidence_digest: d('f'),
    evidence_refs: ['MODEL_SELF_REPAIR'],
    external_repair_verifier: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('when no memory is accepted, governed retrieval returns an empty fail-closed result rather than raw graph fallback', () => {
  const snapshot = graph();
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.no-memory',
    target_context_digest: d('c'),
    task_signature_digest: d('1'),
    challenge_family: 'MEMORY_SECURITY',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiGovernedExperience({ snapshot, audit_receipts: [], query });
  assert.equal(result.state, 'BLOCKED_NO_ELIGIBLE_MEMORY');
  assert.equal(result.item_count, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.retrieval_digest, null);
  assert.equal(result.execution_authority, false);
});

test('governance view is tamper-evident and cannot be loosened after derivation', () => {
  const snapshot = graph();
  const audits = acceptedAudits(snapshot);
  const view = createRsiMemoryGovernedView({ snapshot, audit_receipts: audits });
  verifyRsiMemoryGovernedView(view, { snapshot, audit_receipts: audits });
  assert.throws(() => verifyRsiMemoryGovernedView({
    ...view,
    candidate_can_clear_quarantine: true,
  }, { snapshot, audit_receipts: audits }), /view_policy_invalid/);
  assert.throws(() => verifyRsiMemoryGovernedView({
    ...view,
    excluded_case_ids: [],
  }, { snapshot, audit_receipts: audits }), /view_digest_mismatch/);
});

test('memory governance trust root freezes Write-Audit-Retrieve-Repair lifecycle and fixed thresholds', () => {
  const root = rsiMemoryGovernanceTrustRootSnapshot();
  assert.equal(root.accept_max_semantic_risk, 0.25);
  assert.equal(root.accept_max_attack_radius, 0.25);
  assert.equal(root.accept_max_access_risk, 0.25);
  assert.equal(root.unaudited_memory_default, 'REVIEW_REQUIRED');
  assert.equal(root.stale_memory_default, 'STALE_REVIEW_REQUIRED');
  assert.equal(root.quarantine_fail_closed, true);
  assert.equal(root.revocation_fail_closed, true);
  assert.equal(root.selective_repair_preserves_history, true);
  assert.equal(root.blocked_nodes_removed_before_graph_diffusion, true);
  assert.equal(root.candidate_can_choose_thresholds, false);
  assert.equal(root.candidate_can_clear_quarantine, false);
  assert.equal(root.candidate_can_write_audit, false);
  assert.equal(root.candidate_can_write_repair, false);
  assert.equal(root.raw_memory_payload_is_authority, false);
  assert.equal(root.retrieval_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.governance_root_digest, /^sha256:[0-9a-f]{64}$/);
});
