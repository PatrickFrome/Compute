import crypto from 'node:crypto';

export const RECEIPT_STATUS = Object.freeze(['EFFECTED', 'FAILED_NO_EFFECT', 'AMBIGUOUS']);


export function validateReceipt(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, reason: 'receipt_required' };
  const { receipt_id, action_id, lease_id, resource_id, profile_id, context_id, process_incarnation_id, kind, status, effect_evidence, authority_effect, created_at, receipt_sha256 } = record;

  if (!receipt_id || typeof receipt_id !== 'string') return { ok: false, reason: 'receipt_id_required' };
  if (!action_id || typeof action_id !== 'string') return { ok: false, reason: 'receipt_action_id_required' };
  if (!lease_id || typeof lease_id !== 'string') return { ok: false, reason: 'receipt_lease_id_required' };
  if (!resource_id || typeof resource_id !== 'string') return { ok: false, reason: 'receipt_resource_id_required' };
  if (!profile_id || typeof profile_id !== 'string') return { ok: false, reason: 'receipt_profile_id_required' };
  if (!context_id || typeof context_id !== 'string') return { ok: false, reason: 'receipt_context_id_required' };
  if (!process_incarnation_id || typeof process_incarnation_id !== 'string') return { ok: false, reason: 'receipt_process_incarnation_id_required' };
  if (!kind || typeof kind !== 'string') return { ok: false, reason: 'receipt_kind_required' };
  if (!status || !RECEIPT_STATUS.includes(status)) return { ok: false, reason: 'receipt_status_invalid' };
  if (!effect_evidence || typeof effect_evidence !== 'object') return { ok: false, reason: 'receipt_effect_evidence_required' };
  if (authority_effect !== true) return { ok: false, reason: 'receipt_authority_effect_required' };
  if (!created_at || typeof created_at !== 'string') return { ok: false, reason: 'receipt_created_at_required' };
  if (!receipt_sha256 || typeof receipt_sha256 !== 'string') return { ok: false, reason: 'receipt_sha256_required' };

  const computed = receiptSha256(record);
  if (computed !== receipt_sha256) return { ok: false, reason: 'receipt_sha256_mismatch' };

  return { ok: true, record };
}

export function canonicalReceiptBytes(record) {
  const { receipt_id, action_id, lease_id, resource_id, profile_id, context_id, process_incarnation_id, kind, status, effect_evidence, authority_effect, created_at } = record;
  const canonical = {
    receipt_id,
    action_id,
    lease_id,
    resource_id,
    profile_id,
    context_id,
    process_incarnation_id,
    kind,
    status,
    effect_evidence,
    authority_effect,
    created_at
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

export function receiptSha256(record) {
  const bytes = canonicalReceiptBytes(record);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function isEffectEvidence(record) {
  return record && record.status === 'EFFECTED';
}
