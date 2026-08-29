import { verifyPersistedChallengeReadback, verifyPersistedCommitteeReadback } from './readback-lineage.mjs';

const ENVELOPE_SCHEMA = 'metaengine.model-gateway.lineage-envelope.v1';
const RELATION = 'RESULT_OF';
const DATA_POLICY = 'PUBLIC_OR_NON_SENSITIVE_ONLY';

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function requireSha256(value, code) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
  return value;
}

function validateTraceId(traceId) {
  if (traceId === null || traceId === undefined) return null;
  if (typeof traceId !== 'string' || !/^[0-9a-f]{32}$/.test(traceId)) throw new Error('lineage_trace_id_invalid');
  return traceId;
}

function assertId(value, code) {
  const id = requireString(value, code);
  if (id.length > 256) throw new Error(code);
  return id;
}

function baseMetadata(kind, receipt, verification) {
  return {
    schema: ENVELOPE_SCHEMA,
    receipt_kind: kind,
    storage_contract: 'destruktion_meta.compute_fabric_record_lineage_h205f22',
    persistence_mode: 'APPEND_ONLY_LINEAGE_EVIDENCE',
    receipt,
    verification,
    tariff_dependency: true,
    data_policy: DATA_POLICY,
    confidential_data_supported: false,
    canonical: false,
    authority_effect: false
  };
}

export function buildCommitteeLineageArgs({ committeeReceipt, supervisorAdvisory, traceId = null }) {
  const verification = verifyPersistedCommitteeReadback({
    committeeReceipt,
    supervisorAdvisory,
    expectedTaskId: committeeReceipt?.task_id
  });
  const taskId = assertId(committeeReceipt.task_id, 'committee_lineage_task_id_invalid');
  const requestSha256 = requireSha256(committeeReceipt.request_sha256, 'committee_lineage_request_hash_invalid');
  const objectSha256 = requireSha256(
    supervisorAdvisory.committee_receipt_sha256,
    'committee_lineage_object_hash_invalid'
  );
  return {
    p_relation: RELATION,
    p_subject_kind: 'MODEL_GATEWAY_TASK',
    p_subject_id: taskId,
    p_subject_sha256: requestSha256,
    p_object_kind: 'MODEL_GATEWAY_COMMITTEE_RECEIPT',
    p_object_id: assertId(`committee:${taskId}`, 'committee_lineage_object_id_invalid'),
    p_object_sha256: objectSha256,
    p_trace_id: validateTraceId(traceId),
    p_metadata: baseMetadata('COMMITTEE', {
      committee: committeeReceipt,
      supervisor_advisory: supervisorAdvisory
    }, verification)
  };
}

export function buildChallengeLineageArgs({ challengeReceipt, traceId = null }) {
  const verification = verifyPersistedChallengeReadback(challengeReceipt, {
    expectedTaskId: challengeReceipt?.task_id
  });
  const taskId = assertId(challengeReceipt.task_id, 'challenge_lineage_task_id_invalid');
  const requestSha256 = requireSha256(challengeReceipt.request_sha256, 'challenge_lineage_request_hash_invalid');
  const objectSha256 = requireSha256(challengeReceipt.receipt_sha256, 'challenge_lineage_object_hash_invalid');
  return {
    p_relation: RELATION,
    p_subject_kind: 'MODEL_GATEWAY_TASK',
    p_subject_id: taskId,
    p_subject_sha256: requestSha256,
    p_object_kind: 'MODEL_GATEWAY_CHALLENGE_RECEIPT',
    p_object_id: assertId(`challenge:${taskId}`, 'challenge_lineage_object_id_invalid'),
    p_object_sha256: objectSha256,
    p_trace_id: validateTraceId(traceId),
    p_metadata: baseMetadata('CHALLENGE', challengeReceipt, verification)
  };
}

function verifyRowCommon(row, expected) {
  requireObject(row, 'lineage_readback_row_required');
  if (row.relation !== expected.p_relation) throw new Error('lineage_readback_relation_mismatch');
  if (row.subject_kind !== expected.p_subject_kind || row.subject_id !== expected.p_subject_id) {
    throw new Error('lineage_readback_subject_mismatch');
  }
  if (row.subject_sha256 !== expected.p_subject_sha256) throw new Error('lineage_readback_subject_hash_mismatch');
  if (row.object_kind !== expected.p_object_kind || row.object_id !== expected.p_object_id) {
    throw new Error('lineage_readback_object_mismatch');
  }
  if (row.object_sha256 !== expected.p_object_sha256) throw new Error('lineage_readback_object_hash_mismatch');
  if ((row.trace_id ?? null) !== expected.p_trace_id) throw new Error('lineage_readback_trace_id_mismatch');
  if (row.canonical !== false) throw new Error('lineage_readback_canonical_forbidden');
  if (row.authority_effect !== false) throw new Error('lineage_readback_authority_forbidden');
  requireSha256(row.receipt_sha256, 'lineage_database_receipt_hash_invalid');
  const metadata = requireObject(row.metadata, 'lineage_readback_metadata_required');
  if (metadata.schema !== ENVELOPE_SCHEMA) throw new Error('lineage_readback_metadata_schema_mismatch');
  if (metadata.storage_contract !== 'destruktion_meta.compute_fabric_record_lineage_h205f22') {
    throw new Error('lineage_readback_storage_contract_mismatch');
  }
  if (metadata.persistence_mode !== 'APPEND_ONLY_LINEAGE_EVIDENCE') {
    throw new Error('lineage_readback_persistence_mode_mismatch');
  }
  if (metadata.canonical !== false || metadata.authority_effect !== false) {
    throw new Error('lineage_readback_metadata_authority_forbidden');
  }
  if (metadata.data_policy !== DATA_POLICY || metadata.confidential_data_supported !== false || metadata.tariff_dependency !== true) {
    throw new Error('lineage_readback_policy_mismatch');
  }
  return metadata;
}

export function verifyCommitteeLineageReadback(row) {
  const metadata = requireObject(row?.metadata, 'committee_lineage_metadata_required');
  if (metadata.receipt_kind !== 'COMMITTEE') throw new Error('committee_lineage_receipt_kind_invalid');
  const receipt = requireObject(metadata.receipt, 'committee_lineage_receipt_required');
  const committee = requireObject(receipt.committee, 'committee_lineage_committee_required');
  const advisory = requireObject(receipt.supervisor_advisory, 'committee_lineage_advisory_required');
  const expected = buildCommitteeLineageArgs({
    committeeReceipt: committee,
    supervisorAdvisory: advisory,
    traceId: row.trace_id ?? null
  });
  verifyRowCommon(row, expected);
  return {
    valid: true,
    schema: 'metaengine.model-gateway.lineage-readback-verification.v1',
    receipt_kind: 'COMMITTEE',
    edge_id: row.edge_id ?? null,
    database_receipt_sha256: row.receipt_sha256,
    object_sha256: row.object_sha256,
    task_id: row.subject_id,
    canonical: false,
    authority_effect: false
  };
}

export function verifyChallengeLineageReadback(row) {
  const metadata = requireObject(row?.metadata, 'challenge_lineage_metadata_required');
  if (metadata.receipt_kind !== 'CHALLENGE') throw new Error('challenge_lineage_receipt_kind_invalid');
  const challenge = requireObject(metadata.receipt, 'challenge_lineage_receipt_required');
  const expected = buildChallengeLineageArgs({ challengeReceipt: challenge, traceId: row.trace_id ?? null });
  verifyRowCommon(row, expected);
  return {
    valid: true,
    schema: 'metaengine.model-gateway.lineage-readback-verification.v1',
    receipt_kind: 'CHALLENGE',
    edge_id: row.edge_id ?? null,
    database_receipt_sha256: row.receipt_sha256,
    object_sha256: row.object_sha256,
    task_id: row.subject_id,
    challenge_status: challenge.challenge_status,
    target_coverage_complete: challenge.target_coverage_complete === true,
    canonical: false,
    authority_effect: false
  };
}
