const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const NATIVE_SUPERVISOR_RESULT_BATCH_MAX_JSON_CHARS = 480_000;
export const NATIVE_SUPERVISOR_RESULT_BATCH_MAX_ITEMS = 64;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function commandId(value) {
  const id = String(value || '').toLowerCase();
  if (!COMMAND_ID_RE.test(id)) throw new Error('native_supervisor_batch_result_command_id_invalid');
  return id;
}

function jsonChars(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error('native_supervisor_batch_result_not_serializable');
  return text.length;
}

/**
 * Partitions already-executed command receipts for bounded transport delivery.
 * This function has no execution or retry authority: callers must execute the
 * Browser batch once, then deliver these immutable chunks without re-running it.
 */
export function partitionNativeSupervisorBatchResults(results, {
  maxJsonChars = NATIVE_SUPERVISOR_RESULT_BATCH_MAX_JSON_CHARS,
  maxItems = NATIVE_SUPERVISOR_RESULT_BATCH_MAX_ITEMS,
} = {}) {
  if (!Array.isArray(results) || results.length < 1 || results.length > NATIVE_SUPERVISOR_RESULT_BATCH_MAX_ITEMS) {
    throw new Error('native_supervisor_batch_results_invalid');
  }
  const boundedChars = Number(maxJsonChars);
  const boundedItems = Number(maxItems);
  if (!Number.isSafeInteger(boundedChars) || boundedChars < 1024 || boundedChars > 524_288) {
    throw new Error('native_supervisor_batch_result_limit_invalid');
  }
  if (!Number.isSafeInteger(boundedItems) || boundedItems < 1 || boundedItems > NATIVE_SUPERVISOR_RESULT_BATCH_MAX_ITEMS) {
    throw new Error('native_supervisor_batch_result_item_limit_invalid');
  }

  const chunks = [];
  let current = [];
  const seen = new Set();

  for (const result of results) {
    if (!plainObject(result) || result.authority_effect !== false) {
      throw new Error('native_supervisor_batch_result_invalid');
    }
    const id = commandId(result.command_id);
    if (seen.has(id)) throw new Error('native_supervisor_batch_result_duplicate_command');
    seen.add(id);

    const single = [result];
    if (jsonChars(single) > boundedChars) {
      throw new Error(`native_supervisor_batch_result_item_too_large:${id}`);
    }

    const candidate = [...current, result];
    if (current.length > 0 && (candidate.length > boundedItems || jsonChars(candidate) > boundedChars)) {
      chunks.push(Object.freeze(current));
      current = [result];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) chunks.push(Object.freeze(current));
  return Object.freeze(chunks);
}

/**
 * Validates the DB completion acknowledgement for one transport chunk. HTTP 200
 * is insufficient: every exact command must be present once and accepted.
 */
export function assertNativeSupervisorBatchCompletion(body, expectedResults) {
  if (!plainObject(body) || body.authority_effect !== false || !Array.isArray(body.results)) {
    throw new Error('native_supervisor_batch_completion_invalid');
  }
  if (!Array.isArray(expectedResults) || expectedResults.length < 1 || body.results.length !== expectedResults.length) {
    throw new Error('native_supervisor_batch_completion_cardinality_mismatch');
  }

  const expected = new Set(expectedResults.map((row) => commandId(row?.command_id)));
  const acknowledged = new Set();
  const normalized = [];

  for (const row of body.results) {
    if (!plainObject(row)) throw new Error('native_supervisor_batch_completion_row_invalid');
    const id = commandId(row.command_id);
    if (!expected.has(id) || acknowledged.has(id)) {
      throw new Error('native_supervisor_batch_completion_identity_mismatch');
    }
    acknowledged.add(id);
    if (row.accepted !== true) {
      throw new Error(`native_supervisor_batch_completion_not_accepted:${id}`);
    }
    const status = String(row.status || '').toUpperCase();
    if (!['COMPLETED', 'FAILED'].includes(status)) {
      throw new Error(`native_supervisor_batch_completion_status_invalid:${id}:${status || 'MISSING'}`);
    }
    normalized.push(Object.freeze({ command_id: id, accepted: true, status }));
  }

  if (acknowledged.size !== expected.size) {
    throw new Error('native_supervisor_batch_completion_identity_mismatch');
  }
  return Object.freeze(normalized);
}
