export const DEVOS_PTY_PROTOCOL_VERSION = 1;
export const DEVOS_PTY_PROTOCOL_SCHEMA = 'metaengine.devos.pty.protocol.v1';

export const DEVOS_PTY_BOUNDS = Object.freeze({
  output_frame_bytes: 32 * 1024,
  input_frame_bytes: 64 * 1024,
  output_high_water_bytes: 1024 * 1024,
  output_low_water_bytes: 256 * 1024,
  output_ring_bytes: 4 * 1024 * 1024,
  max_sessions_per_workspace: 4,
  max_sessions_per_host: 16,
  min_cols: 2,
  max_cols: 1000,
  min_rows: 1,
  max_rows: 500,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESS_INCARNATION_RE = /^process_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_RE = /^[A-Za-z0-9._-]{1,80}$/;

const TERMINATE_REASONS = new Set([
  'USER_REQUEST',
  'WORKSPACE_CLOSED',
  'WORKSPACE_REBOUND',
  'HOST_SHUTDOWN',
]);

const EXIT_REASONS = new Set([
  'PROCESS_EXIT',
  'USER_TERMINATE',
  'WORKSPACE_CLOSED',
  'WORKSPACE_REBOUND',
  'SPAWN_FAILED',
  'BACKPRESSURE_FAULT',
  'PTY_HOST_LOST',
]);

const CLEANUP_STATES = new Set(['VERIFIED', 'PARTIAL_UNVERIFIED', 'NOT_APPLICABLE']);

function exactObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function exactKeys(value, required, optional = [], code = 'devos_pty_fields_invalid') {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(code);
  }
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(code);
  }
}

function positiveInt(value, code, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(code);
  return number;
}

function nullableInt(value, code) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(code);
  return number;
}

function boundedString(value, code, max = 160) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(code);
  return text;
}

function exactProfile(value, code) {
  const text = String(value ?? '');
  if (!PROFILE_RE.test(text)) throw new Error(code);
  return text;
}

function exactBytes(value, max, code) {
  if (!(value instanceof Uint8Array)) throw new Error(code);
  if (value.byteLength < 1 || value.byteLength > max) throw new Error(code);
  return value;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    renderer_process_authority: false,
    arbitrary_process_authority: false,
    production_promotion_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function validateDevOSPtyWorkspaceRef(value) {
  const row = exactObject(value, 'devos_pty_workspace_ref_invalid');
  exactKeys(row, ['workspace_id', 'workspace_generation'], [], 'devos_pty_workspace_ref_fields_invalid');
  const workspaceId = String(row.workspace_id || '').toLowerCase();
  if (!UUID_RE.test(workspaceId)) throw new Error('devos_pty_workspace_id_invalid');
  return Object.freeze({
    workspace_id: workspaceId,
    workspace_generation: positiveInt(row.workspace_generation, 'devos_pty_workspace_generation_invalid'),
  });
}

export function validateDevOSPtySessionRef(value) {
  const row = exactObject(value, 'devos_pty_session_ref_invalid');
  exactKeys(row, [
    'workspace_id',
    'workspace_generation',
    'pty_host_generation',
    'session_id',
    'session_generation',
    'process_incarnation_id',
  ], [], 'devos_pty_session_ref_fields_invalid');
  const workspace = validateDevOSPtyWorkspaceRef({
    workspace_id: row.workspace_id,
    workspace_generation: row.workspace_generation,
  });
  const sessionId = String(row.session_id || '').toLowerCase();
  if (!UUID_RE.test(sessionId)) throw new Error('devos_pty_session_id_invalid');
  const processIncarnationId = String(row.process_incarnation_id || '').toLowerCase();
  if (!PROCESS_INCARNATION_RE.test(processIncarnationId)) throw new Error('devos_pty_process_incarnation_invalid');
  return Object.freeze({
    ...workspace,
    pty_host_generation: positiveInt(row.pty_host_generation, 'devos_pty_host_generation_invalid'),
    session_id: sessionId,
    session_generation: positiveInt(row.session_generation, 'devos_pty_session_generation_invalid'),
    process_incarnation_id: processIncarnationId,
  });
}

export function sameDevOSPtySessionRef(a, b) {
  const left = validateDevOSPtySessionRef(a);
  const right = validateDevOSPtySessionRef(b);
  return left.workspace_id === right.workspace_id
    && left.workspace_generation === right.workspace_generation
    && left.pty_host_generation === right.pty_host_generation
    && left.session_id === right.session_id
    && left.session_generation === right.session_generation
    && left.process_incarnation_id === right.process_incarnation_id;
}

export function assertCurrentDevOSPtySessionRef(expected, actual) {
  if (!sameDevOSPtySessionRef(expected, actual)) throw new Error('devos_pty_session_fence_stale');
  return validateDevOSPtySessionRef(actual);
}

export function validateDevOSPtyCreateRequest(value) {
  const row = exactObject(value, 'devos_pty_create_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'request_id', 'workspace', 'profile_id', 'cols', 'rows'], ['env_profile_id'], 'devos_pty_create_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.create.v1') throw new Error('devos_pty_create_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    request_id: boundedString(row.request_id, 'devos_pty_request_id_invalid', 128),
    workspace: validateDevOSPtyWorkspaceRef(row.workspace),
    profile_id: exactProfile(row.profile_id, 'devos_pty_profile_invalid'),
    env_profile_id: row.env_profile_id == null ? null : exactProfile(row.env_profile_id, 'devos_pty_env_profile_invalid'),
    cols: positiveInt(row.cols, 'devos_pty_cols_invalid', { min: DEVOS_PTY_BOUNDS.min_cols, max: DEVOS_PTY_BOUNDS.max_cols }),
    rows: positiveInt(row.rows, 'devos_pty_rows_invalid', { min: DEVOS_PTY_BOUNDS.min_rows, max: DEVOS_PTY_BOUNDS.max_rows }),
    renderer_supplied_executable_allowed: false,
    renderer_supplied_argv_allowed: false,
    renderer_supplied_cwd_allowed: false,
    renderer_supplied_env_allowed: false,
  });
}

export function validateDevOSPtyInputRequest(value) {
  const row = exactObject(value, 'devos_pty_input_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'request_id', 'ref', 'transport_epoch', 'input_seq', 'data', 'source'], [], 'devos_pty_input_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.input.v1') throw new Error('devos_pty_input_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  if (row.source !== 'LOCAL_TERMINAL_UI') throw new Error('devos_pty_input_source_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    request_id: boundedString(row.request_id, 'devos_pty_request_id_invalid', 128),
    ref: validateDevOSPtySessionRef(row.ref),
    transport_epoch: positiveInt(row.transport_epoch, 'devos_pty_transport_epoch_invalid'),
    input_seq: positiveInt(row.input_seq, 'devos_pty_input_seq_invalid'),
    data: exactBytes(row.data, DEVOS_PTY_BOUNDS.input_frame_bytes, 'devos_pty_input_bytes_invalid'),
    source: 'LOCAL_TERMINAL_UI',
    input_is_non_idempotent_effect: true,
    blind_replay_allowed: false,
  });
}

export function validateDevOSPtyOutputFrame(value) {
  const row = exactObject(value, 'devos_pty_output_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'ref', 'transport_epoch', 'output_seq', 'byte_offset', 'data'], [], 'devos_pty_output_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.output.v1') throw new Error('devos_pty_output_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  const byteOffset = Number(row.byte_offset);
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) throw new Error('devos_pty_output_offset_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    ref: validateDevOSPtySessionRef(row.ref),
    transport_epoch: positiveInt(row.transport_epoch, 'devos_pty_transport_epoch_invalid'),
    output_seq: positiveInt(row.output_seq, 'devos_pty_output_seq_invalid'),
    byte_offset: byteOffset,
    data: exactBytes(row.data, DEVOS_PTY_BOUNDS.output_frame_bytes, 'devos_pty_output_bytes_invalid'),
    byte_preserving: true,
  });
}

export function validateDevOSPtyOutputAck(value) {
  const row = exactObject(value, 'devos_pty_output_ack_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'request_id', 'ref', 'transport_epoch', 'ack_output_seq', 'ack_byte_offset'], [], 'devos_pty_output_ack_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.output-ack.v1') throw new Error('devos_pty_output_ack_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  const byteOffset = Number(row.ack_byte_offset);
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) throw new Error('devos_pty_output_ack_offset_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    request_id: boundedString(row.request_id, 'devos_pty_request_id_invalid', 128),
    ref: validateDevOSPtySessionRef(row.ref),
    transport_epoch: positiveInt(row.transport_epoch, 'devos_pty_transport_epoch_invalid'),
    ack_output_seq: positiveInt(row.ack_output_seq, 'devos_pty_output_ack_seq_invalid'),
    ack_byte_offset: byteOffset,
    renderer_parse_completion_required: true,
  });
}

export function validateDevOSPtyResizeRequest(value) {
  const row = exactObject(value, 'devos_pty_resize_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'request_id', 'ref', 'transport_epoch', 'resize_seq', 'cols', 'rows'], ['pixel_width', 'pixel_height'], 'devos_pty_resize_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.resize.v1') throw new Error('devos_pty_resize_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    request_id: boundedString(row.request_id, 'devos_pty_request_id_invalid', 128),
    ref: validateDevOSPtySessionRef(row.ref),
    transport_epoch: positiveInt(row.transport_epoch, 'devos_pty_transport_epoch_invalid'),
    resize_seq: positiveInt(row.resize_seq, 'devos_pty_resize_seq_invalid'),
    cols: positiveInt(row.cols, 'devos_pty_cols_invalid', { min: DEVOS_PTY_BOUNDS.min_cols, max: DEVOS_PTY_BOUNDS.max_cols }),
    rows: positiveInt(row.rows, 'devos_pty_rows_invalid', { min: DEVOS_PTY_BOUNDS.min_rows, max: DEVOS_PTY_BOUNDS.max_rows }),
    pixel_width: row.pixel_width == null ? null : positiveInt(row.pixel_width, 'devos_pty_pixel_width_invalid', { max: 100000 }),
    pixel_height: row.pixel_height == null ? null : positiveInt(row.pixel_height, 'devos_pty_pixel_height_invalid', { max: 100000 }),
    latest_state_control: true,
    blind_replay_allowed: false,
  });
}

export function validateDevOSPtyTerminateRequest(value) {
  const row = exactObject(value, 'devos_pty_terminate_invalid');
  exactKeys(row, ['schema', 'protocol_version', 'request_id', 'ref', 'reason'], [], 'devos_pty_terminate_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.terminate.v1') throw new Error('devos_pty_terminate_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  const reason = String(row.reason || '').toUpperCase();
  if (!TERMINATE_REASONS.has(reason)) throw new Error('devos_pty_terminate_reason_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    request_id: boundedString(row.request_id, 'devos_pty_request_id_invalid', 128),
    ref: validateDevOSPtySessionRef(row.ref),
    reason,
    renderer_supplied_signal_allowed: false,
    renderer_supplied_pid_allowed: false,
  });
}

export function validateDevOSPtyExitReceipt(value) {
  const row = exactObject(value, 'devos_pty_exit_invalid');
  exactKeys(row, [
    'schema',
    'protocol_version',
    'ref',
    'exit_code',
    'signal',
    'reason',
    'final_output_seq',
    'final_byte_offset',
    'tree_cleanup',
    'observed_at',
  ], [], 'devos_pty_exit_fields_invalid');
  if (row.schema !== 'metaengine.devos.pty.exited.v1') throw new Error('devos_pty_exit_schema_invalid');
  if (Number(row.protocol_version) !== DEVOS_PTY_PROTOCOL_VERSION) throw new Error('devos_pty_protocol_version_invalid');
  const reason = String(row.reason || '').toUpperCase();
  const cleanup = String(row.tree_cleanup || '').toUpperCase();
  if (!EXIT_REASONS.has(reason)) throw new Error('devos_pty_exit_reason_invalid');
  if (!CLEANUP_STATES.has(cleanup)) throw new Error('devos_pty_tree_cleanup_invalid');
  const outputSeq = Number(row.final_output_seq);
  const byteOffset = Number(row.final_byte_offset);
  if (!Number.isSafeInteger(outputSeq) || outputSeq < 0) throw new Error('devos_pty_final_output_seq_invalid');
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) throw new Error('devos_pty_final_byte_offset_invalid');
  const observedAt = String(row.observed_at || '');
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) throw new Error('devos_pty_exit_observed_at_invalid');
  return zeroAuthority({
    schema: row.schema,
    protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
    ref: validateDevOSPtySessionRef(row.ref),
    exit_code: nullableInt(row.exit_code, 'devos_pty_exit_code_invalid'),
    signal: nullableInt(row.signal, 'devos_pty_exit_signal_invalid'),
    reason,
    final_output_seq: outputSeq,
    final_byte_offset: byteOffset,
    tree_cleanup: cleanup,
    observed_at: observedAt,
    pid_is_identity: false,
  });
}

export function classifyDevOSPtyInputSequence({ last_input_seq = 0, input_seq } = {}) {
  const last = Number(last_input_seq);
  const next = Number(input_seq);
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(next) || next < 1) throw new Error('devos_pty_input_sequence_invalid');
  if (next <= last) return zeroAuthority({ state: 'DUPLICATE_NO_EFFECT', accepted: false, last_input_seq: last, input_seq: next });
  if (next !== last + 1) return zeroAuthority({ state: 'GAP_REATTACH_REQUIRED', accepted: false, last_input_seq: last, input_seq: next });
  return zeroAuthority({ state: 'ACCEPT', accepted: true, last_input_seq: last, input_seq: next });
}

export function classifyDevOSPtyResizeSequence({ last_resize_seq = 0, resize_seq } = {}) {
  const last = Number(last_resize_seq);
  const next = Number(resize_seq);
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(next) || next < 1) throw new Error('devos_pty_resize_sequence_invalid');
  if (next <= last) return zeroAuthority({ state: 'STALE_NO_EFFECT', accepted: false, last_resize_seq: last, resize_seq: next });
  return zeroAuthority({ state: 'APPLY_LATEST', accepted: true, last_resize_seq: last, resize_seq: next });
}

export const DEVOS_PTY_PROTOCOL_CONTRACT = Object.freeze({
  schema: DEVOS_PTY_PROTOCOL_SCHEMA,
  protocol_version: DEVOS_PTY_PROTOCOL_VERSION,
  workspace_identity: 'workspace_id+workspace_generation',
  process_identity: 'pty_host_generation+session_id+session_generation+process_incarnation_id',
  transport_epoch_is_process_identity: false,
  pid_is_identity: false,
  input_is_non_idempotent_effect: true,
  input_blind_replay_allowed: false,
  resize_is_latest_state_control: true,
  arbitrary_executable_allowed: false,
  arbitrary_argv_allowed: false,
  arbitrary_cwd_allowed: false,
  arbitrary_env_allowed: false,
  arbitrary_signal_allowed: false,
  arbitrary_pid_selector_allowed: false,
  renderer_node_authority: false,
  second_scheduler_allowed: false,
  production_promotion_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});
