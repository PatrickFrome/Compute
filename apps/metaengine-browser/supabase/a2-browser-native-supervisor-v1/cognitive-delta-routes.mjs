export const COGNITIVE_DELTA_ROUTE_PATH = '/v1/cognitive/deltas';
export const COGNITIVE_DELTA_ACCEPTOR_RPC = 'h205f22_a2_browser_cognitive_accept_v1';
export const COGNITIVE_DELTA_BATCH_SCHEMA = 'metaengine.browser.cognitive-delta-batch.v1';
export const COGNITIVE_DELTA_EVENT_SCHEMA = 'metaengine.browser.cognitive-delta.v1';
export const COGNITIVE_DELTA_ACK_SCHEMA = 'metaengine.browser.cognitive-delta-ack.v1';

export const COGNITIVE_DELTA_MAX_EVENTS = 128;
export const COGNITIVE_DELTA_MAX_BODY_BYTES = 256 * 1024;

const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const SOURCES = new Set(['PROCESS', 'SEMANTIC', 'METRICS']);

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function clipped(value, max) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function optionalSafeInt(value, { min = 0 } = {}) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : null;
}

function requiredFalse(value) {
  return value === false;
}

function zeroAuthorityFences(value) {
  return requiredFalse(value?.raw_payload_exposed)
    && requiredFalse(value?.page_text_exposed)
    && requiredFalse(value?.input_values_exposed)
    && requiredFalse(value?.control_authority)
    && requiredFalse(value?.command_leasing)
    && requiredFalse(value?.authority_effect);
}

function batchZeroAuthorityFences(value) {
  return zeroAuthorityFences(value) && requiredFalse(value?.delivery_is_authority);
}

function validTimestamp(value) {
  if (value == null) return true;
  const text = String(value);
  return text.length <= 64 && Number.isFinite(Date.parse(text));
}

export function projectCognitiveDeltaEvent(value, { streamId, sequence } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COGNITIVE_EVENT_OBJECT_REQUIRED');
  if (String(value.schema || '') !== COGNITIVE_DELTA_EVENT_SCHEMA) throw new Error('COGNITIVE_EVENT_SCHEMA_INVALID');
  if (String(value.stream_id || '').toLowerCase() !== streamId) throw new Error('COGNITIVE_EVENT_STREAM_MISMATCH');
  if (Number(value.sequence) !== sequence) throw new Error('COGNITIVE_EVENT_SEQUENCE_GAP');
  if (!PRIORITIES.has(String(value.priority || '').toUpperCase())) throw new Error('COGNITIVE_EVENT_PRIORITY_INVALID');
  if (!SOURCES.has(String(value.source || '').toUpperCase())) throw new Error('COGNITIVE_EVENT_SOURCE_INVALID');
  if (!zeroAuthorityFences(value)) throw new Error('COGNITIVE_EVENT_AUTHORITY_FENCE_INVALID');
  if (!validTimestamp(value.recorded_at) || !validTimestamp(value.observed_at)) throw new Error('COGNITIVE_EVENT_TIMESTAMP_INVALID');

  const webContentsId = optionalSafeInt(value.web_contents_id, { min: 1 });
  if (value.web_contents_id != null && webContentsId == null) throw new Error('COGNITIVE_EVENT_WEBCONTENTS_INVALID');
  const osPid = optionalSafeInt(value.os_pid, { min: 1 });
  if (value.os_pid != null && osPid == null) throw new Error('COGNITIVE_EVENT_PID_INVALID');
  const sourceSequence = optionalSafeInt(value.source_sequence, { min: 0 });
  if (value.source_sequence != null && sourceSequence == null) throw new Error('COGNITIVE_EVENT_SOURCE_SEQUENCE_INVALID');

  const type = String(value.type || '').slice(0, 96);
  if (!type) throw new Error('COGNITIVE_EVENT_TYPE_REQUIRED');

  return Object.freeze({
    schema: COGNITIVE_DELTA_EVENT_SCHEMA,
    stream_id: streamId,
    sequence,
    priority: String(value.priority).toUpperCase(),
    recorded_at: clipped(value.recorded_at, 64),
    source_sequence: sourceSequence,
    source: String(value.source).toUpperCase(),
    type,
    semantic_method: clipped(value.semantic_method, 160),
    observed_at: clipped(value.observed_at, 64),
    tab_id: clipped(value.tab_id, 96),
    target_id: clipped(value.target_id, 160),
    web_contents_id: webContentsId,
    os_pid: osPid,
    process_type: clipped(value.process_type, 80),
    reason: clipped(value.reason, 160),
    service_name: clipped(value.service_name, 160),
    name: clipped(value.name, 160),
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  });
}

export function projectCognitiveDeltaBatch(bodyText, body) {
  if (utf8Bytes(bodyText) > COGNITIVE_DELTA_MAX_BODY_BYTES) {
    const error = new Error('COGNITIVE_BATCH_BODY_TOO_LARGE');
    error.status = 413;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('COGNITIVE_BATCH_OBJECT_REQUIRED');
  if (String(body.schema || '') !== COGNITIVE_DELTA_BATCH_SCHEMA) throw new Error('COGNITIVE_BATCH_SCHEMA_INVALID');
  if (!batchZeroAuthorityFences(body)) throw new Error('COGNITIVE_BATCH_AUTHORITY_FENCE_INVALID');

  const streamId = String(body.stream_id || '').trim().toLowerCase();
  if (!STREAM_ID_RE.test(streamId)) throw new Error('COGNITIVE_BATCH_STREAM_INVALID');
  const afterSequence = optionalSafeInt(body.after_sequence, { min: 0 });
  const throughSequence = optionalSafeInt(body.through_sequence, { min: 1 });
  if (afterSequence == null || throughSequence == null || throughSequence <= afterSequence) throw new Error('COGNITIVE_BATCH_RANGE_INVALID');

  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > COGNITIVE_DELTA_MAX_EVENTS) {
    throw new Error('COGNITIVE_BATCH_EVENT_COUNT_INVALID');
  }
  if (Number(body.event_count) !== body.events.length) throw new Error('COGNITIVE_BATCH_EVENT_COUNT_MISMATCH');
  if (throughSequence - afterSequence !== body.events.length) throw new Error('COGNITIVE_BATCH_SEQUENCE_RANGE_GAP');

  const events = body.events.map((event, index) => projectCognitiveDeltaEvent(event, {
    streamId,
    sequence: afterSequence + index + 1,
  }));

  return Object.freeze({
    schema: COGNITIVE_DELTA_BATCH_SCHEMA,
    stream_id: streamId,
    after_sequence: afterSequence,
    through_sequence: throughSequence,
    event_count: events.length,
    events,
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    delivery_is_authority: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  });
}

function acceptorUnavailable(error) {
  const message = String(error?.message || error || '');
  return /rest_404:|PGRST202|PGRST203|could not find the function|function .* does not exist/i.test(message);
}

function errorStatus(error) {
  return Number(error?.status) === 413 ? 413 : 400;
}

export function createCognitiveDeltaRoutes({ rpc, workspaceId, json }) {
  if (typeof rpc !== 'function') throw new Error('cognitive_delta_rpc_required');
  if (!workspaceId) throw new Error('cognitive_delta_workspace_required');
  if (typeof json !== 'function') throw new Error('cognitive_delta_json_required');

  return async function cognitiveDeltaRoutes({ req, path, body, bodyText, identity } = {}) {
    if (path !== COGNITIVE_DELTA_ROUTE_PATH) return null;
    if (req?.method !== 'POST') return json(405, {
      error: 'cognitive_delta_method_not_allowed',
      authority_effect: false,
    });
    if (!identity?.id || !identity?.device_id) return json(401, {
      error: 'cognitive_delta_device_identity_required',
      authority_effect: false,
    });

    let batch;
    try {
      batch = projectCognitiveDeltaBatch(bodyText, body);
    } catch (error) {
      return json(errorStatus(error), {
        error: String(error?.message || 'cognitive_delta_invalid').toLowerCase(),
        full_state_resync_required: true,
        delivery_is_authority: false,
        control_authority: false,
        command_leasing: false,
        authority_effect: false,
      });
    }

    let accepted;
    try {
      accepted = await rpc(COGNITIVE_DELTA_ACCEPTOR_RPC, {
        p_workspace_id: workspaceId,
        p_client_id: String(identity.id),
        p_device_id: String(identity.device_id),
        p_stream_id: batch.stream_id,
        p_after_sequence: batch.after_sequence,
        p_through_sequence: batch.through_sequence,
        p_events: batch.events,
        p_authority_effect: false,
      });
    } catch (error) {
      if (acceptorUnavailable(error)) return json(501, {
        error: 'cognitive_acceptor_unavailable',
        reason: 'DB_ACCEPTOR_NOT_INSTALLED',
        full_state_resync_required: true,
        delivery_is_authority: false,
        control_authority: false,
        command_leasing: false,
        authority_effect: false,
      });
      throw error;
    }

    const acceptedStreamId = String(accepted?.stream_id || '').toLowerCase();
    const acceptedThrough = Number(accepted?.accepted_through_sequence);
    if (
      accepted?.accepted !== true
      || acceptedStreamId !== batch.stream_id
      || !Number.isSafeInteger(acceptedThrough)
      || acceptedThrough !== batch.through_sequence
    ) return json(503, {
      error: 'cognitive_acceptor_ack_invalid',
      reason: String(accepted?.reason || 'ACCEPTOR_REJECTED').slice(0, 160),
      full_state_resync_required: true,
      delivery_is_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });

    return json(202, {
      schema: COGNITIVE_DELTA_ACK_SCHEMA,
      accepted: true,
      stream_id: batch.stream_id,
      accepted_through_sequence: batch.through_sequence,
      event_count: batch.event_count,
      full_state_resync_required: false,
      delivery_is_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  };
}
