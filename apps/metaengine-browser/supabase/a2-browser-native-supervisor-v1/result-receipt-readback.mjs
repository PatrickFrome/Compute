export const RSI_RESULT_RECEIPT_READBACK_SCHEMA = 'metaengine.rsi.result-receipt-readback.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);
const MAX_RECEIPT_BYTES = 32_768;

function zeroAuthority(extra = {}) {
  return Object.freeze({
    schema: RSI_RESULT_RECEIPT_READBACK_SCHEMA,
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalizeId(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`rsi_result_receipt_${label}_invalid`);
  return normalized;
}

function boundedReceipt(value, commandId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.authority_effect === true) throw new Error('rsi_result_receipt_authority_invalid');
  const observedCommandId = String(value.command_id || '').trim().toLowerCase();
  if (observedCommandId !== commandId) throw new Error('rsi_result_receipt_command_mismatch');
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > MAX_RECEIPT_BYTES) throw new Error('rsi_result_receipt_oversized');
  return JSON.parse(text);
}

export function projectRsiResultReceiptReadback({ row, commandId, clientId } = {}) {
  const normalizedCommandId = normalizeId(commandId, 'command_id');
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) throw new Error('rsi_result_receipt_client_id_required');

  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return zeroAuthority({ command_id: normalizedCommandId, found: false, terminal: false, status: 'NOT_FOUND', receipt: null, error: null });
  }

  const rowCommandId = normalizeId(row.command_id, 'row_command_id');
  const leasedBy = String(row.leased_by || '').trim();
  if (rowCommandId !== normalizedCommandId || leasedBy !== normalizedClientId) {
    return zeroAuthority({ command_id: normalizedCommandId, found: false, terminal: false, status: 'NOT_FOUND', receipt: null, error: null });
  }

  const status = String(row.status || '').trim().toUpperCase();
  if (!TERMINAL_STATUSES.has(status)) {
    return zeroAuthority({ command_id: normalizedCommandId, found: true, terminal: false, status: status || 'UNKNOWN', receipt: null, error: null });
  }

  const receipt = boundedReceipt(row.receipt, normalizedCommandId);
  if (!receipt) {
    return zeroAuthority({ command_id: normalizedCommandId, found: true, terminal: false, status, receipt: null, error: null });
  }

  const error = row.error == null ? null : String(row.error).slice(0, 500);
  return zeroAuthority({ command_id: normalizedCommandId, found: true, terminal: true, status, receipt, error });
}

export function createRsiResultReceiptReadback({ lookupCommand } = {}) {
  if (typeof lookupCommand !== 'function') throw new Error('rsi_result_receipt_lookup_required');
  return Object.freeze({
    schema: RSI_RESULT_RECEIPT_READBACK_SCHEMA,
    async read({ workspaceId, commandId, clientId } = {}) {
      const normalizedCommandId = normalizeId(commandId, 'command_id');
      const normalizedClientId = String(clientId || '').trim();
      if (!normalizedClientId) throw new Error('rsi_result_receipt_client_id_required');
      const row = await lookupCommand({
        workspaceId: String(workspaceId || '').trim(),
        commandId: normalizedCommandId,
        clientId: normalizedClientId,
      });
      return projectRsiResultReceiptReadback({ row, commandId: normalizedCommandId, clientId: normalizedClientId });
    },
  });
}
