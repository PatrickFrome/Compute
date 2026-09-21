export const RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA = 'metaengine.rsi.result-delivery-transport.v1';

const DEFAULT_DEADLINE_MS = 8_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = Object.freeze([1_000, 3_000]);

function boundedPositiveInt(value, fallback, min, max, label) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`result_delivery_${label}_invalid`);
  }
  return normalized;
}

function normalizeBackoff(value) {
  const input = value == null ? DEFAULT_BACKOFF_MS : value;
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) throw new Error('result_delivery_backoff_invalid');
  return Object.freeze(input.map((entry) => boundedPositiveInt(entry, 0, 0, 60_000, 'backoff')));
}

function zeroAuthority(state, extra = {}) {
  return Object.freeze({
    schema: RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA,
    state,
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

function boundedPromise(factory, deadlineMs, label, { abort = true } = {}) {
  const controller = abort ? new AbortController() : null;
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`result_delivery_${label}_deadline`);
      error.name = 'TimeoutError';
      controller?.abort(error);
      reject(error);
    }, deadlineMs);
  });
  let operation;
  try {
    operation = Promise.resolve(factory(controller?.signal || null));
  } catch (error) {
    operation = Promise.reject(error);
  }
  return Promise.race([operation, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function terminalReadback(value, commandId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.terminal !== true) return null;
  const observedCommand = value.command_id ?? value.receipt?.command_id ?? null;
  if (observedCommand != null && String(observedCommand) !== String(commandId)) throw new Error('result_delivery_readback_command_mismatch');
  if (value.authority_effect === true || value.receipt?.authority_effect === true) throw new Error('result_delivery_readback_authority_invalid');
  return value;
}

export function createRsiResultDeliveryTransport({
  sendReceipt,
  readReceipt,
  sleep,
  deadlineMs = DEFAULT_DEADLINE_MS,
  attempts = DEFAULT_ATTEMPTS,
  backoffMs = DEFAULT_BACKOFF_MS,
} = {}) {
  if (typeof sendReceipt !== 'function') throw new Error('result_delivery_send_receipt_required');
  if (typeof readReceipt !== 'function') throw new Error('result_delivery_read_receipt_required');
  if (typeof sleep !== 'function') throw new Error('result_delivery_sleep_required');
  const deadline = boundedPositiveInt(deadlineMs, DEFAULT_DEADLINE_MS, 10, 60_000, 'deadline');
  const maxAttempts = boundedPositiveInt(attempts, DEFAULT_ATTEMPTS, 1, 6, 'attempts');
  const backoff = normalizeBackoff(backoffMs);

  return Object.freeze({
    schema: RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA,
    async deliver({ commandId, effectKey = null, payload } = {}) {
      const normalizedCommandId = String(commandId || '').trim();
      if (!normalizedCommandId) throw new Error('result_delivery_command_id_required');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('result_delivery_payload_required');
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await boundedPromise(
            (signal) => sendReceipt({ commandId: normalizedCommandId, effectKey, payload, signal, attempt }),
            deadline,
            'send',
            { abort: true },
          );
          if (response?.ok === true) {
            return zeroAuthority('DELIVERED', {
              command_id: normalizedCommandId,
              effect_key: effectKey,
              delivery_attempts: attempt,
              receipt_replay_count: attempt - 1,
              reconciliation_readbacks: attempt - 1,
            });
          }
          const status = Number(response?.status);
          if (Number.isFinite(status) && status >= 400 && status < 500) {
            return zeroAuthority('REJECTED', {
              command_id: normalizedCommandId,
              effect_key: effectKey,
              delivery_attempts: attempt,
              receipt_replay_count: attempt - 1,
              reconciliation_readbacks: attempt - 1,
              error: `result_delivery_http_${status}`,
            });
          }
          lastError = new Error(Number.isFinite(status) ? `result_delivery_http_${status}` : 'result_delivery_response_invalid');
        } catch (error) {
          lastError = error;
        }

        let observed = null;
        try {
          observed = await boundedPromise(
            () => readReceipt({ commandId: normalizedCommandId, effectKey }),
            deadline,
            'readback',
            { abort: false },
          );
        } catch (error) {
          lastError = error;
        }
        const terminal = terminalReadback(observed, normalizedCommandId);
        if (terminal) {
          return zeroAuthority('RECONCILED', {
            command_id: normalizedCommandId,
            effect_key: effectKey,
            delivery_attempts: attempt,
            receipt_replay_count: attempt - 1,
            reconciliation_readbacks: attempt,
            terminal_status: String(terminal.status || 'TERMINAL').slice(0, 64),
          });
        }

        if (attempt < maxAttempts) {
          const delay = backoff[Math.min(attempt - 1, backoff.length - 1)] || 0;
          if (delay > 0) await sleep(delay);
        }
      }

      return zeroAuthority('AMBIGUOUS', {
        command_id: normalizedCommandId,
        effect_key: effectKey,
        delivery_attempts: maxAttempts,
        receipt_replay_count: Math.max(0, maxAttempts - 1),
        reconciliation_readbacks: maxAttempts,
        error: String(lastError?.message || lastError || 'result_delivery_unresolved').slice(0, 240),
      });
    },
  });
}
