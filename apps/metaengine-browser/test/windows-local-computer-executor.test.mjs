import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WINDOWS_COMPUTER_BRIDGE_SHA256,
  WindowsLocalComputerExecutor,
} from '../src/windows-local-computer-executor.mjs';

const target = {
  machine_fingerprint_sha256:'a'.repeat(64),
  session_id:1,
  process_id:100,
  process_creation_time_ms:1791122743585,
  window_handle:'0x1234',
  executable_sha256:'b'.repeat(64),
  generation:3,
};

const context = {
  command_id:'2a924f7a-884c-4a10-87b4-1d550561286e',
  effect_binding:{
    schema:'metaengine.native-supervisor.effect-binding.v2',
    authority_effect:false,
    page_data_authority:false,
    automatic_retry_allowed:false,
  },
};

test('executor snapshot exposes fixed bridge identity and no scheduler authority', () => {
  const executor = new WindowsLocalComputerExecutor({ platform:'linux', runner:async () => ({ ok:true }) });
  const snapshot = executor.snapshot();
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.raw_shell_input, false);
  assert.equal(snapshot.arbitrary_eval, false);
  assert.match(WINDOWS_COMPUTER_BRIDGE_SHA256, /^[0-9a-f]{64}$/);
});

test('read-only observation carries no authority effect', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => ({
      ok:true,
      effect_started:false,
      schema:'metaengine.windows-computer-executor.windows.v1',
      action:request.action,
      windows:[],
      authority_effect:false,
    }),
  });
  const result = await executor.observe({ action:'OBSERVE_WINDOWS', args:{ limit:4 } });
  assert.equal(result.request.action, 'OBSERVE_WINDOWS');
  assert.equal(result.authority_effect, false);
  assert.deepEqual(result.result.windows, []);
});

test('proven mutation becomes EFFECT_PROVEN only after positive readback', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => ({
      ok:true,
      effect_started:true,
      readback_proven:true,
      schema:'metaengine.windows-computer-executor.effect.v1',
      authority_effect:true,
    }),
  });
  const result = await executor.act({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target, args:{ text:'hello' } }, context);
  assert.equal(result.outcome, 'EFFECT_PROVEN');
  assert.equal(result.authority_effect, true);
  assert.equal(result.automatic_retry_allowed, false);
});

test('pre-effect executor rejection is NO_EFFECT_PROVEN and still never auto-retries', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => ({
      ok:false,
      effect_started:false,
      error:'computer_target_identity_drift:window_handle',
      authority_effect:false,
    }),
  });
  const result = await executor.act({ action:'POINTER_CLICK', agent_id:'agent_test-12345678', target, args:{ x:10, y:20 } }, context);
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.equal(result.authority_effect, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('runner failure after dispatch boundary is conservatively ambiguous and terminal', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => { throw new Error('transport_lost'); },
  });
  const result = await executor.act({ action:'KEY_PRESS', agent_id:'agent_test-12345678', target, args:{ key:'ENTER' } }, context);
  assert.equal(result.outcome, 'AMBIGUOUS_NO_RETRY');
  assert.equal(result.authority_effect, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('mutating executor path cannot bypass DB lease binding', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => ({ ok:true }),
  });
  await assert.rejects(
    () => executor.act({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target, args:{ text:'x' } }, {}),
    /computer_db_lease_command_id_required/
  );
});
