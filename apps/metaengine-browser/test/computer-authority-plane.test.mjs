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
  assert.deepEqual(snapshot.router_order, ['BROWSER_SEMANTIC','WINDOWS_UIA','COMPUTER_VISUAL']);
  assert.equal(snapshot.version, '2.0.0');
  assert.equal(snapshot.multi_monitor_observation, true);
  assert.equal(snapshot.window_management, true);
  assert.equal(snapshot.rich_pointer_primitives, true);
  assert.equal(snapshot.key_combinations, true);
});

test('read-only and mutating computer actions are explicitly classified', () => {
  assert.deepEqual(classifyComputerAction('status'), { action:'STATUS', lane:'READ_ONLY', mutating:false });
  assert.deepEqual(classifyComputerAction('pointer_click'), { action:'POINTER_CLICK', lane:'GLOBAL_MUTATION', mutating:true });
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

test('Computer V2 normalizes direct UIA, window, combo and multi-monitor requests', () => {
  const combo = normalizeComputerRequest({
    action:'KEY_COMBO',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ keys:['CTRL','SHIFT','P'] },
  }, lease('KEY_COMBO'));
  assert.deepEqual(combo.args.keys, ['CTRL','SHIFT','P']);

  const value = normalizeComputerRequest({
    action:'UIA_SET_VALUE',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ runtime_id:[4,5,6], value:'direct value' },
  }, lease('UIA_SET_VALUE'));
  assert.equal(value.args.value, 'direct value');
  assert.deepEqual(value.args.runtime_id, [4,5,6]);

  const windowMove = normalizeComputerRequest({
    action:'WINDOW_MOVE_RESIZE',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ x:-1200, y:80, width:1280, height:720 },
  }, lease('WINDOW_MOVE_RESIZE'));
  assert.deepEqual(windowMove.args, { x:-1200, y:80, width:1280, height:720 });

  const drag = normalizeComputerRequest({
    action:'POINTER_DRAG',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{
      from_x:10, from_y:20, to_x:300, to_y:400, duration_ms:25,
      visual_fence:{ frame_sha256:'d'.repeat(64) },
    },
  }, lease('POINTER_DRAG'));
  assert.equal(drag.args.duration_ms, 25);
  assert.equal(drag.args.visual_fence.max_age_ms, 3000);

  const capture = normalizeComputerRequest({ action:'CAPTURE_DESKTOP', args:{ monitor:3 } });
  assert.equal(capture.args.monitor, 3);
  assert.equal(normalizeComputerRequest({ action:'OBSERVE_DISPLAYS' }).action, 'OBSERVE_DISPLAYS');

  assert.throws(() => normalizeComputerRequest({
    action:'KEY_COMBO',
    agent_id:'agent_test-12345678',
    target:target(),
    args:{ keys:['CTRL','CTRL'] },
  }, lease('KEY_COMBO')), /computer_key_combo_duplicate/);
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
