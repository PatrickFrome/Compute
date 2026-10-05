import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComputerAction,
  normalizeComputerTargetIdentity,
  computerTargetIdentityDigest,
  normalizeComputerRequest,
  planComputerToolRoute,
  computerAuthorityPlaneSnapshot,
  projectComputerEffectReceipt,
} from '../src/computer-authority-plane.mjs';

const target = () => ({
  machine_fingerprint_sha256: 'a'.repeat(64),
  session_id: 2,
  process_id: 4242,
  process_creation_time_ms: 1791122743585,
  window_handle: '0x10af',
  executable_sha256: 'b'.repeat(64),
  generation: 7,
});

const lease = (computerAction = 'TYPE_TEXT', exactTarget = target(), agentId = 'agent_test-12345678') => {
  const commandId = '7fa7dca5-8fb5-4c79-bfca-a2ab323542f9';
  const normalizedTarget = normalizeComputerTargetIdentity(exactTarget);
  return {
    command_id: commandId,
    effect_binding: {
      schema:'metaengine.native-supervisor.computer-effect-binding.v1',
      command_id:commandId,
      action:'COMPUTER_ACTION',
      computer_action:computerAction,
      agent_id:agentId,
      target_identity_sha256:computerTargetIdentityDigest(normalizedTarget),
      target:normalizedTarget,
      automatic_retry_allowed:false,
      page_data_authority:false,
      authority_effect:false,
    },
  };
};

test('computer authority plane exposes one DB lease authority and no second scheduler', () => {
  const snapshot = computerAuthorityPlaneSnapshot();
  assert.equal(snapshot.command_authority, 'DB_LEASE_ONLY');
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.arbitrary_eval, false);
  assert.equal(snapshot.arbitrary_shell, false);
  assert.equal(snapshot.raw_powershell_command_input, false);
  assert.equal(snapshot.version, '2.0.0');
  assert.deepEqual(snapshot.router_order, ['BROWSER_SEMANTIC','WINDOWS_UIA','COMPUTER_VISUAL']);
  assert.deepEqual(snapshot.direct_uia_patterns, ['VALUE','INVOKE','TOGGLE','SELECTION_ITEM','EXPAND_COLLAPSE','SCROLL']);
  assert.equal(snapshot.multi_monitor_observation, true);
  assert.equal(snapshot.visual_pointer_requires_target_bound_window_capture, true);
  assert.equal(snapshot.visual_pointer_requires_unchanged_window_geometry, true);
  assert.equal(snapshot.dispatch_only_mutations_never_claim_effect_proven, true);
  assert.equal(snapshot.type_text_requires_value_readback_for_effect_proof, true);
});

test('read-only and mutating computer actions are explicitly classified', () => {
  assert.deepEqual(classifyComputerAction('status'), { action:'STATUS', lane:'READ_ONLY', mutating:false });
  assert.deepEqual(classifyComputerAction('pointer_click'), { action:'POINTER_CLICK', lane:'GLOBAL_MUTATION', mutating:true });
  assert.deepEqual(classifyComputerAction('observe_displays'), { action:'OBSERVE_DISPLAYS', lane:'READ_ONLY', mutating:false });
  assert.deepEqual(classifyComputerAction('capture_window'), { action:'CAPTURE_WINDOW', lane:'READ_ONLY', mutating:false });
  assert.deepEqual(classifyComputerAction('uia_set_value'), { action:'UIA_SET_VALUE', lane:'GLOBAL_MUTATION', mutating:true });
  assert.throws(() => classifyComputerAction('EXEC_SHELL'), /computer_action_not_allowlisted/);
});

test('computer target identity is exact and digest-bound', () => {
  const normalized = normalizeComputerTargetIdentity(target());
  assert.equal(normalized.process_id, 4242);
  assert.equal(normalized.window_handle, '0x10af');
  assert.match(computerTargetIdentityDigest(normalized), /^[0-9a-f]{64}$/);
  assert.throws(() => normalizeComputerTargetIdentity({ ...target(), executable_sha256:'nope' }), /computer_executable_sha256_invalid/);
});

test('mutating computer requests require DB lease and effect binding', () => {
  assert.throws(
    () => normalizeComputerRequest({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target:target(), args:{ text:'hello', runtime_id:[1,2,3] } }),
    /computer_db_lease_command_id_required/
  );
  const request = normalizeComputerRequest({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target:target(), args:{ text:'hello', runtime_id:[1,2,3] } }, lease());
  assert.equal(request.mutating, true);
  assert.equal(request.lease.authority_source, 'DB_LEASE_ONLY');
  assert.equal(request.automatic_retry_allowed, false);
  assert.equal(request.args.text, 'hello');
  assert.equal(request.args.replace, true);
  assert.throws(
    () => normalizeComputerRequest({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target:target(), args:{ text:'hello', runtime_id:[1,2,3], replace:false } }, lease()),
    /computer_type_append_mode_unproven/
  );
});

test('pointer and key payloads are bounded and allowlisted', () => {
  const click = normalizeComputerRequest({ action:'POINTER_CLICK', agent_id:'agent_test-12345678', target:target(), args:{ x:14.8, y:22.2, visual_fence:{ frame_sha256:'c'.repeat(64) } } }, lease('POINTER_CLICK'));
  assert.deepEqual(click.args, { x:14, y:22, button:'LEFT', visual_fence:{ frame_sha256:'c'.repeat(64), max_age_ms:3000 } });
  const key = normalizeComputerRequest({ action:'KEY_PRESS', agent_id:'agent_test-12345678', target:target(), args:{ key:'Ctrl+A' } }, lease('KEY_PRESS'));
  assert.equal(key.args.key, 'CTRL+A');
  assert.throws(
    () => normalizeComputerRequest({ action:'KEY_PRESS', agent_id:'agent_test-12345678', target:target(), args:{ key:'WIN+R' } }, lease('KEY_PRESS')),
    /computer_key_not_allowlisted/
  );
});

test('V2 direct UIA requests are exact-target and DB-effect-bound', () => {
  const setValue = normalizeComputerRequest({
    action:'UIA_SET_VALUE',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ runtime_id:[7,8,9], value:'fast-path' },
  }, lease('UIA_SET_VALUE'));
  assert.deepEqual(setValue.args, { runtime_id:[7,8,9], value:'fast-path' });

  const expand = normalizeComputerRequest({
    action:'UIA_EXPAND_COLLAPSE',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ runtime_id:[1,2], state:'expand' },
  }, lease('UIA_EXPAND_COLLAPSE'));
  assert.deepEqual(expand.args, { runtime_id:[1,2], state:'EXPAND' });

  const scroll = normalizeComputerRequest({
    action:'UIA_SCROLL',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ runtime_id:[3,4], vertical:'small_increment' },
  }, lease('UIA_SCROLL'));
  assert.equal(scroll.args.vertical, 'SMALL_INCREMENT');
  assert.equal(scroll.args.horizontal, 'NO_AMOUNT');

  assert.throws(() => normalizeComputerRequest({
    action:'UIA_SET_VALUE',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ runtime_id:[7], value:'x' },
  }, lease('UIA_TOGGLE')), /computer_effect_binding_subaction_mismatch/);
});

test('V2 computer observations cover displays, foreground and exact window capture', () => {
  assert.equal(normalizeComputerRequest({ action:'OBSERVE_DISPLAYS' }).mutating, false);
  assert.equal(normalizeComputerRequest({ action:'FOREGROUND_STATUS' }).mutating, false);
  const capture = normalizeComputerRequest({ action:'CAPTURE_WINDOW', target:target() });
  assert.equal(capture.target.window_handle, '0x10af');
  const monitor = normalizeComputerRequest({ action:'CAPTURE_DESKTOP', args:{ monitor:3 } });
  assert.equal(monitor.args.monitor, 3);
});

test('tool router prefers exact browser semantic, then UIA, then fresh visual fallback', () => {
  assert.equal(planComputerToolRoute({
    browser_semantic:{ exact_target:true, semantic_ref_current:true, target_incarnation_current:true },
    windows_uia:{ exact_target_count:1, target_identity_current:true, runtime_id_current:true },
    visual:{ fresh_frame:true, exact_window_identity:true, coordinate_inside_window:true },
  }).route, 'BROWSER_SEMANTIC');

  assert.equal(planComputerToolRoute({
    windows_uia:{ exact_target_count:1, target_identity_current:true, runtime_id_current:true },
    visual:{ fresh_frame:true, exact_window_identity:true, coordinate_inside_window:true },
  }).route, 'WINDOWS_UIA');

  assert.equal(planComputerToolRoute({
    visual:{ fresh_frame:true, exact_window_identity:true, coordinate_inside_window:true },
  }).route, 'COMPUTER_VISUAL');

  assert.equal(planComputerToolRoute({}).route, 'BLOCKED');
});

test('unknown or ambiguous effect receipts never authorize automatic retry', () => {
  const request = normalizeComputerRequest({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target:target(), args:{ text:'x', runtime_id:[1,2,3] } }, lease());
  const ambiguous = projectComputerEffectReceipt({ request, outcome:'AMBIGUOUS_NO_RETRY', error:'readback missing' });
  assert.equal(ambiguous.authority_effect, false);
  assert.equal(ambiguous.automatic_retry_allowed, false);
  const proven = projectComputerEffectReceipt({ request, outcome:'EFFECT_PROVEN', result:{ readback:true } });
  assert.equal(proven.authority_effect, true);
});
