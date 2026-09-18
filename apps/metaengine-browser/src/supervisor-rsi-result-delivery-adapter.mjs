import { createRsiResultDeliveryTransport } from './result-delivery-transport.mjs';

export const RSI_RESULT_DELIVERY_ADAPTER_SCHEMA = 'metaengine.rsi.result-delivery-adapter.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    schema: RSI_RESULT_DELIVERY_ADAPTER_SCHEMA,
    ...extra,
    physical_effect_replay_allowed: false,
    automatic_effect_retry_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    authority_effect: false,
  });
}

function assertPayload(commandId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('rsi_result_adapter_payload_invalid');
  if (typeof payload.ok !== 'boolean') throw new Error('rsi_result_adapter_payload_ok_invalid');
  if (!payload.receipt || typeof payload.receipt !== 'object' || Array.isArray(payload.receipt)) throw new Error('rsi_result_adapter_receipt_invalid');
  if (String(payload.receipt.command_id || '') !== String(commandId)) throw new Error('rsi_result_adapter_receipt_command_mismatch');
  if (payload.receipt.authority_effect === true) throw new Error('rsi_result_adapter_receipt_authority_invalid');
}

function readbackMatchesPayload(readback, payload) {
  if (!readback || typeof readback !== 'object' || Array.isArray(readback) || readback.terminal !== true) return false;
  if (readback.authority_effect === true || readback.receipt?.authority_effect === true) return false;
  const expectedStatus = payload.ok === true ? 'COMPLETED' : 'FAILED';
  if (String(readback.status || '').toUpperCase() !== expectedStatus) return false;
  if (!sameValue(readback.receipt, payload.receipt)) return false;
  const expectedError = payload.ok === true ? null : String(payload.error || 'command_failed').slice(0, 500);
  const observedError = readback.error == null ? null : String(readback.error).slice(0, 500);
  return observedError === expectedError;
}

async function parseReadbackResponse(response) {
  if (!response || response.ok !== true || typeof response.json !== 'function') return null;
  const body = await response.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function createSupervisorRsiResultDeliveryAdapter({
  signedRequest,
  sleep,
  deadlineMs = 8_000,
  attempts = 3,
  backoffMs = [1_000, 3_000],
} = {}) {
  if (typeof signedRequest !== 'function') throw new Error('rsi_result_adapter_signed_request_required');
  if (typeof sleep !== 'function') throw new Error('rsi_result_adapter_sleep_required');

  async function matchingReadback(commandId, payload) {
    const path = `/v1/commands/${encodeURIComponent(commandId)}/receipt`;
    const response = await signedRequest(path, { method: 'GET' });
    const body = await parseReadbackResponse(response);
    if (!body || String(body.command_id || '') !== String(commandId)) return null;
    if (!readbackMatchesPayload(body, payload)) return null;
    return body;
  }

  return Object.freeze({
    schema: RSI_RESULT_DELIVERY_ADAPTER_SCHEMA,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_effect_retry_allowed: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,

    async deliver({ commandId, effectKey = null, payload, readbackBeforeReplay = false } = {}) {
      const normalizedCommandId = String(commandId || '').trim();
      if (!normalizedCommandId) throw new Error('rsi_result_adapter_command_id_required');
      assertPayload(normalizedCommandId, payload);

      if (readbackBeforeReplay === true) {
        const observed = await matchingReadback(normalizedCommandId, payload).catch(() => null);
        if (observed) {
          return zeroAuthority({
            state: 'RECONCILED',
            command_id: normalizedCommandId,
            effect_key: effectKey,
            delivery_attempts: 0,
            receipt_replay_count: 0,
            reconciliation_readbacks: 1,
            terminal_status: String(observed.status || 'TERMINAL').slice(0, 64),
          });
        }
      }

      const transport = createRsiResultDeliveryTransport({
        deadlineMs,
        attempts,
        backoffMs,
        sleep,
        sendReceipt: ({ commandId: id, payload: samePayload, signal }) => signedRequest(
          `/v1/commands/${encodeURIComponent(id)}/result`,
          { method: 'POST', payload: samePayload, signal },
        ),
        readReceipt: ({ commandId: id }) => matchingReadback(id, payload),
      });
      return transport.deliver({ commandId: normalizedCommandId, effectKey, payload });
    },
  });
}
