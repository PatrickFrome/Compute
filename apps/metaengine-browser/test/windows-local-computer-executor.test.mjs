import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  WINDOWS_COMPUTER_BRIDGE_SHA256,
  PersistentWindowsPowerShellBridge,
  WindowsLocalComputerExecutor,
} from '../src/windows-local-computer-executor.mjs';
import { computerTargetIdentityDigest, normalizeComputerTargetIdentity } from '../src/computer-authority-plane.mjs';

const target = {
  machine_fingerprint_sha256:'a'.repeat(64),
  session_id:1,
  process_id:100,
  process_creation_time_ms:1791122743585,
  window_handle:'0x1234',
  executable_sha256:'b'.repeat(64),
  generation:3,
};

const contextFor = (computerAction, exactTarget = target, agentId = 'agent_test-12345678') => {
  const commandId = '2a924f7a-884c-4a10-87b4-1d550561286e';
  const normalized = normalizeComputerTargetIdentity(exactTarget);
  return {
    command_id:commandId,
    effect_binding:{
      schema:'metaengine.native-supervisor.computer-effect-binding.v1',
      command_id:commandId,
      action:'COMPUTER_ACTION',
      computer_action:computerAction,
      agent_id:agentId,
      target_identity_sha256:computerTargetIdentityDigest(normalized),
      target:normalized,
      authority_effect:false,
      page_data_authority:false,
      automatic_retry_allowed:false,
    },
  };
};
test('persistent Windows bridge reuses one hot process and serializes concurrent requests', async () => {
  let spawnCalls = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;

  const spawnImpl = (file, args, options) => {
    spawnCalls += 1;
    assert.equal(file, 'powershell.exe');
    assert.ok(args.includes('-File'));
    assert.equal(options.env.METAENGINE_COMPUTER_PERSISTENT, '1');

    const child = new EventEmitter();
    child.pid = 9000 + spawnCalls;
    child.killed = false;
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let exited = false;

    const emitExit = (code) => {
      if (exited) return;
      exited = true;
      child.exitCode = code;
      queueMicrotask(() => child.emit('exit', code));
    };

    child.kill = () => {
      child.killed = true;
      emitExit(1);
      return true;
    };

    child.stdin = {
      write(data) {
        const line = String(data || '').trim();
        if (line === '__METAENGINE_STOP__') {
          emitExit(0);
          return true;
        }
        if (!line.startsWith('{')) return true;
        const request = JSON.parse(line);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        setTimeout(() => {
          activeRequests -= 1;
          child.stdout.write(JSON.stringify({
            ok:true,
            effect_started:false,
            action:request.action,
            authority_effect:false,
          }) + '\n');
        }, 5);
        return true;
      },
      end() {
        emitExit(0);
      },
    };
    return child;
  };

  const bridge = new PersistentWindowsPowerShellBridge({
    platform:'win32',
    spawn_impl:spawnImpl,
    timeout_ms:2000,
  });

  const [a, b] = await Promise.all([
    bridge.run({ action:'STATUS' }),
    bridge.run({ action:'OBSERVE_WINDOWS', args:{ offset:0, limit:1 } }),
  ]);

  assert.equal(a.action, 'STATUS');
  assert.equal(b.action, 'OBSERVE_WINDOWS');
  assert.equal(spawnCalls, 1);
  assert.equal(maxActiveRequests, 1);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.spawn_count, 1);
  assert.equal(snapshot.request_count, 2);
  assert.equal(snapshot.restart_count, 0);
  assert.equal(snapshot.process_alive, true);

  await bridge.stop();
  assert.equal(bridge.snapshot().process_alive, false);
});

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
  const result = await executor.act({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target, args:{ text:'hello', runtime_id:[1,2,3] } }, contextFor('TYPE_TEXT'));
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
  const result = await executor.act({ action:'POINTER_CLICK', agent_id:'agent_test-12345678', target, args:{ x:10, y:20, visual_fence:{ frame_sha256:'c'.repeat(64) } } }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.equal(result.authority_effect, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('visual pointer fallback consumes one fresh capture and then fails closed', async () => {
  let now = 1000;
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    clock:() => now,
    runner:async (request) => {
      if (request.action === 'CAPTURE_DESKTOP') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'c'.repeat(64),
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return {
        ok:true,
        effect_started:true,
        readback_proven:true,
        schema:'metaengine.windows-computer-executor.effect.v1',
        authority_effect:true,
      };
    },
  });
  await executor.observe({ action:'CAPTURE_DESKTOP', args:{} });
  const payload = {
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'c'.repeat(64) } },
  };
  const first = await executor.act(payload, contextFor('POINTER_CLICK'));
  assert.equal(first.outcome, 'EFFECT_PROVEN');
  assert.equal(physicalCalls, 1);

  const second = await executor.act(payload, contextFor('POINTER_CLICK'));
  assert.equal(second.outcome, 'NO_EFFECT_PROVEN');
  assert.match(second.error, /computer_visual_frame_not_observed/);
  assert.equal(physicalCalls, 1);
});

test('stale visual capture is rejected before physical execution', async () => {
  let now = 1000;
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    clock:() => now,
    runner:async (request) => {
      if (request.action === 'CAPTURE_DESKTOP') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'d'.repeat(64),
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:true, authority_effect:true };
    },
  });
  await executor.observe({ action:'CAPTURE_DESKTOP', args:{} });
  now += 3001;
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'d'.repeat(64) } },
  }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_stale/);
  assert.equal(physicalCalls, 0);
});

test('runner failure after dispatch boundary is conservatively ambiguous and terminal', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => { throw new Error('transport_lost'); },
  });
  const result = await executor.act({ action:'KEY_PRESS', agent_id:'agent_test-12345678', target, args:{ key:'ENTER' } }, contextFor('KEY_PRESS'));
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
    () => executor.act({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target, args:{ text:'x', runtime_id:[1,2,3] } }, {}),
    /computer_db_lease_command_id_required/
  );
});
