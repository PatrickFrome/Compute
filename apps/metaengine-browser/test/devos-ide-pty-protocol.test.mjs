import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEVOS_PTY_BOUNDS,
  DEVOS_PTY_PROTOCOL_CONTRACT,
  assertCurrentDevOSPtySessionRef,
  classifyDevOSPtyInputSequence,
  classifyDevOSPtyResizeSequence,
  sameDevOSPtySessionRef,
  validateDevOSPtyCreateRequest,
  validateDevOSPtyExitReceipt,
  validateDevOSPtyInputRequest,
  validateDevOSPtyOutputAck,
  validateDevOSPtyOutputFrame,
  validateDevOSPtyResizeRequest,
  validateDevOSPtySessionRef,
  validateDevOSPtyTerminateRequest,
  validateDevOSPtyWorkspaceRef,
} from '../src/devos-pty-protocol.mjs';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const PROCESS_ID = 'process_33333333-3333-4333-8333-333333333333';

const workspace = (generation = 7) => ({
  workspace_id: WORKSPACE_ID,
  workspace_generation: generation,
});

const ref = (overrides = {}) => ({
  workspace_id: WORKSPACE_ID,
  workspace_generation: 7,
  pty_host_generation: 3,
  session_id: SESSION_ID,
  session_generation: 1,
  process_incarnation_id: PROCESS_ID,
  ...overrides,
});

test('S1 inherits existing DevOS workspace_id/workspace_generation identity and fences full PTY process incarnation', () => {
  assert.deepEqual(validateDevOSPtyWorkspaceRef(workspace()), workspace());
  assert.deepEqual(validateDevOSPtySessionRef(ref()), ref());
  assert.equal(sameDevOSPtySessionRef(ref(), ref()), true);

  for (const stale of [
    ref({ workspace_generation: 8 }),
    ref({ pty_host_generation: 4 }),
    ref({ session_generation: 2 }),
    ref({ session_id: '44444444-4444-4444-8444-444444444444' }),
    ref({ process_incarnation_id: 'process_55555555-5555-4555-8555-555555555555' }),
  ]) {
    assert.equal(sameDevOSPtySessionRef(ref(), stale), false);
    assert.throws(() => assertCurrentDevOSPtySessionRef(ref(), stale), /session_fence_stale/);
  }
});

test('create request is profile-based and structurally cannot accept executable argv cwd env or shell text', () => {
  const valid = validateDevOSPtyCreateRequest({
    schema: 'metaengine.devos.pty.create.v1',
    protocol_version: 1,
    request_id: 'create-1',
    workspace: workspace(),
    profile_id: 'workspace-shell',
    env_profile_id: 'minimal-dev',
    cols: 120,
    rows: 40,
  });
  assert.equal(valid.profile_id, 'workspace-shell');
  assert.equal(valid.renderer_supplied_executable_allowed, false);
  assert.equal(valid.renderer_supplied_argv_allowed, false);
  assert.equal(valid.renderer_supplied_cwd_allowed, false);
  assert.equal(valid.renderer_supplied_env_allowed, false);
  assert.equal(valid.authority_effect, false);

  for (const [field, value] of [
    ['executable', 'cmd.exe'],
    ['argv', ['/c', 'whoami']],
    ['cwd', 'C:\\'],
    ['env', { TOKEN: 'secret' }],
    ['command', 'echo hi'],
    ['shell', true],
    ['pid', 1234],
  ]) {
    assert.throws(() => validateDevOSPtyCreateRequest({
      schema: 'metaengine.devos.pty.create.v1',
      protocol_version: 1,
      request_id: 'create-bad',
      workspace: workspace(),
      profile_id: 'workspace-shell',
      cols: 80,
      rows: 24,
      [field]: value,
    }), /create_fields_invalid/);
  }
});

test('input is byte-bounded, local-UI-only, and explicitly non-idempotent', () => {
  const receipt = validateDevOSPtyInputRequest({
    schema: 'metaengine.devos.pty.input.v1',
    protocol_version: 1,
    request_id: 'input-1',
    ref: ref(),
    transport_epoch: 2,
    input_seq: 9,
    data: new Uint8Array([0x65, 0x63, 0x68, 0x6f]),
    source: 'LOCAL_TERMINAL_UI',
  });
  assert.equal(receipt.input_is_non_idempotent_effect, true);
  assert.equal(receipt.blind_replay_allowed, false);
  assert.equal(receipt.automatic_retry_allowed, false);

  assert.throws(() => validateDevOSPtyInputRequest({
    ...receipt,
    request_id: 'input-oversize',
    data: new Uint8Array(DEVOS_PTY_BOUNDS.input_frame_bytes + 1),
  }), /input_bytes_invalid/);
  assert.throws(() => validateDevOSPtyInputRequest({
    schema: 'metaengine.devos.pty.input.v1',
    protocol_version: 1,
    request_id: 'input-model',
    ref: ref(),
    transport_epoch: 2,
    input_seq: 10,
    data: new Uint8Array([1]),
    source: 'MODEL_OUTPUT',
  }), /input_source_invalid/);
});

test('input sequence never blind-replays duplicate/reordered/gapped frames', () => {
  assert.deepEqual(
    classifyDevOSPtyInputSequence({ last_input_seq: 8, input_seq: 9 }).state,
    'ACCEPT',
  );
  for (const value of [8, 7]) {
    const result = classifyDevOSPtyInputSequence({ last_input_seq: 8, input_seq: value });
    assert.equal(result.state, 'DUPLICATE_NO_EFFECT');
    assert.equal(result.accepted, false);
    assert.equal(result.authority_effect, false);
  }
  const gap = classifyDevOSPtyInputSequence({ last_input_seq: 8, input_seq: 10 });
  assert.equal(gap.state, 'GAP_REATTACH_REQUIRED');
  assert.equal(gap.accepted, false);
  assert.equal(gap.automatic_retry_allowed, false);
});

test('output is byte-preserving and output ACK represents renderer parse completion only', () => {
  const out = validateDevOSPtyOutputFrame({
    schema: 'metaengine.devos.pty.output.v1',
    protocol_version: 1,
    ref: ref(),
    transport_epoch: 2,
    output_seq: 4,
    byte_offset: 4096,
    data: new Uint8Array([0xf0, 0x9f, 0x9a, 0x80]),
  });
  assert.equal(out.byte_preserving, true);
  assert.equal(out.data.byteLength, 4);

  const ack = validateDevOSPtyOutputAck({
    schema: 'metaengine.devos.pty.output-ack.v1',
    protocol_version: 1,
    request_id: 'ack-4',
    ref: ref(),
    transport_epoch: 2,
    ack_output_seq: 4,
    ack_byte_offset: 4100,
  });
  assert.equal(ack.renderer_parse_completion_required, true);
  assert.equal(ack.authority_effect, false);

  assert.throws(() => validateDevOSPtyOutputFrame({
    ...out,
    data: new Uint8Array(DEVOS_PTY_BOUNDS.output_frame_bytes + 1),
  }), /output_bytes_invalid/);
});

test('resize is latest-state control and stale resize has zero effect', () => {
  const resize = validateDevOSPtyResizeRequest({
    schema: 'metaengine.devos.pty.resize.v1',
    protocol_version: 1,
    request_id: 'resize-1',
    ref: ref(),
    transport_epoch: 2,
    resize_seq: 12,
    cols: 160,
    rows: 48,
  });
  assert.equal(resize.latest_state_control, true);
  assert.equal(resize.blind_replay_allowed, false);

  const stale = classifyDevOSPtyResizeSequence({ last_resize_seq: 12, resize_seq: 11 });
  assert.equal(stale.state, 'STALE_NO_EFFECT');
  assert.equal(stale.accepted, false);
  const latest = classifyDevOSPtyResizeSequence({ last_resize_seq: 12, resize_seq: 15 });
  assert.equal(latest.state, 'APPLY_LATEST');
  assert.equal(latest.accepted, true);

  for (const [cols, rows] of [[1, 24], [1001, 24], [80, 0], [80, 501]]) {
    assert.throws(() => validateDevOSPtyResizeRequest({
      schema: 'metaengine.devos.pty.resize.v1',
      protocol_version: 1,
      request_id: 'resize-bad',
      ref: ref(),
      transport_epoch: 2,
      resize_seq: 13,
      cols,
      rows,
    }), /cols_invalid|rows_invalid/);
  }
});

test('terminate has fixed reasons and cannot accept renderer signal or pid selectors', () => {
  const terminate = validateDevOSPtyTerminateRequest({
    schema: 'metaengine.devos.pty.terminate.v1',
    protocol_version: 1,
    request_id: 'terminate-1',
    ref: ref(),
    reason: 'WORKSPACE_REBOUND',
  });
  assert.equal(terminate.renderer_supplied_signal_allowed, false);
  assert.equal(terminate.renderer_supplied_pid_allowed, false);

  assert.throws(() => validateDevOSPtyTerminateRequest({
    schema: 'metaengine.devos.pty.terminate.v1',
    protocol_version: 1,
    request_id: 'terminate-signal',
    ref: ref(),
    reason: 'USER_REQUEST',
    signal: 9,
  }), /terminate_fields_invalid/);
});

test('exit receipt preserves exact ref, final output boundary and explicit cleanup certainty', () => {
  const receipt = validateDevOSPtyExitReceipt({
    schema: 'metaengine.devos.pty.exited.v1',
    protocol_version: 1,
    ref: ref(),
    exit_code: 0,
    signal: null,
    reason: 'PROCESS_EXIT',
    final_output_seq: 33,
    final_byte_offset: 65536,
    tree_cleanup: 'VERIFIED',
    observed_at: '2026-09-18T00:00:00.000Z',
  });
  assert.equal(receipt.tree_cleanup, 'VERIFIED');
  assert.equal(receipt.pid_is_identity, false);
  assert.equal(receipt.authority_effect, false);

  assert.throws(() => validateDevOSPtyExitReceipt({
    ...receipt,
    tree_cleanup: 'ASSUMED',
  }), /tree_cleanup_invalid/);
});

test('all protocol limits are centralized and contract forbids second scheduler or privilege surfaces', () => {
  assert.equal(DEVOS_PTY_BOUNDS.output_frame_bytes, 32 * 1024);
  assert.equal(DEVOS_PTY_BOUNDS.input_frame_bytes, 64 * 1024);
  assert.equal(DEVOS_PTY_BOUNDS.output_high_water_bytes, 1024 * 1024);
  assert.equal(DEVOS_PTY_BOUNDS.output_low_water_bytes, 256 * 1024);
  assert.equal(DEVOS_PTY_BOUNDS.output_ring_bytes, 4 * 1024 * 1024);
  assert.equal(DEVOS_PTY_BOUNDS.max_sessions_per_workspace, 4);
  assert.equal(DEVOS_PTY_BOUNDS.max_sessions_per_host, 16);

  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.pid_is_identity, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.input_blind_replay_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.arbitrary_executable_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.arbitrary_argv_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.arbitrary_cwd_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.arbitrary_env_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.arbitrary_signal_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.renderer_node_authority, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.second_scheduler_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.production_promotion_authority, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.automatic_retry_allowed, false);
  assert.equal(DEVOS_PTY_PROTOCOL_CONTRACT.authority_effect, false);
});
