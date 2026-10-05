import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  WINDOWS_COMPUTER_BRIDGE_SHA256,
  WindowsLocalComputerExecutor,
  runFixedWindowsPowerShell,
} from '../src/windows-local-computer-executor.mjs';
import {
  computerTargetIdentityDigest,
  normalizeComputerRequest,
  normalizeComputerTargetIdentity,
} from '../src/computer-authority-plane.mjs';

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
test('executor snapshot exposes fixed bridge identity and no scheduler authority', () => {
  const executor = new WindowsLocalComputerExecutor({ platform:'linux', runner:async () => ({ ok:true }) });
  const snapshot = executor.snapshot();
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.version, '2.0.0');
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.bridge_transport, 'HASH_VERIFIED_TEMP_SCRIPT');
  assert.equal(snapshot.raw_shell_input, false);
  assert.equal(snapshot.arbitrary_eval, false);
  assert.match(WINDOWS_COMPUTER_BRIDGE_SHA256, /^[0-9a-f]{64}$/);
});

test('fixed Windows PowerShell bridge physically parses and serves STATUS', { skip: process.platform !== 'win32' }, async () => {
  const result = await runFixedWindowsPowerShell(normalizeComputerRequest({ action:'STATUS' }), { timeout_ms:20000 });
  assert.equal(result.ok, true);
  assert.equal(result.effect_started, false);
  assert.equal(result.schema, 'metaengine.windows-computer-executor.status.v1');
  assert.equal(result.typed_actions_only, true);
  assert.equal(result.arbitrary_shell, false);
  assert.equal(result.raw_powershell_command_input, false);
  assert.equal(result.authority_effect, false);
});

test('fixed Windows bridge physically captures an exact window with raw pixel digest', { skip: process.platform !== 'win32', timeout:30000 }, async () => {
  const fixtureScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$form = [System.Windows.Forms.Form]::new()",
    "$form.Text = 'METAENGINE Computer Capture Fixture'",
    "$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual",
    "$form.Location = [System.Drawing.Point]::new(80,80)",
    "$form.Size = [System.Drawing.Size]::new(360,240)",
    "$label = [System.Windows.Forms.Label]::new()",
    "$label.Text = 'stable-pixel-fixture'",
    "$label.AutoSize = $true",
    "$label.Location = [System.Drawing.Point]::new(24,24)",
    "$form.Controls.Add($label)",
    "$form.Show()",
    "[System.Windows.Forms.Application]::DoEvents()",
    "[Console]::Out.WriteLine('READY')",
    "[Console]::Out.Flush()",
    "while ($true) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }",
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',fixtureScript], {
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');

  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('computer_fixture_ready_timeout:' + stderr.slice(-300))), 10000);
      const onData = chunk => {
        if (String(chunk).includes('READY')) {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const executor = new WindowsLocalComputerExecutor({ platform:'win32' });
    let identity = null;
    for (let attempt=0; attempt<30 && !identity; attempt += 1) {
      const observed = await executor.observe({ action:'OBSERVE_WINDOWS', args:{ limit:256 } });
      identity = observed.result.windows.find(row => Number(row?.identity?.process_id) === child.pid)?.identity || null;
      if (!identity) await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.ok(identity, 'fixture window identity');

    const capture = await executor.observe({ action:'CAPTURE_WINDOW', target:identity });
    assert.equal(capture.result.effect_started, false);
    assert.match(capture.result.png_sha256, /^[0-9a-f]{64}$/);
    assert.match(capture.result.pixel_sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof capture.result.foreground, 'boolean');
    assert.equal(capture.result.geometry_stable, true);
    assert.ok(capture.result.rect.width > 0);
    assert.ok(capture.result.rect.height > 0);
  } finally {
    child.kill();
  }
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

test('V2 read-only computer observations include display and exact-window surfaces', async () => {
  const seen = [];
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      seen.push(request.action);
      if (request.action === 'OBSERVE_DISPLAYS') {
        return { ok:true, effect_started:false, displays:[{ index:0, primary:true }], authority_effect:false };
      }
      if (request.action === 'FOREGROUND_STATUS') {
        return { ok:true, effect_started:false, target, authority_effect:false };
      }
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          target,
          png_sha256:'e'.repeat(64),
          pixel_sha256:'1'.repeat(64),
          foreground:true,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      throw new Error('unexpected');
    },
  });

  const displays = await executor.observe({ action:'OBSERVE_DISPLAYS' });
  assert.equal(displays.result.displays[0].primary, true);

  const foreground = await executor.observe({ action:'FOREGROUND_STATUS' });
  assert.match(foreground.result.target_identity_sha256, /^[0-9a-f]{64}$/);

  const capture = await executor.observe({ action:'CAPTURE_WINDOW', target });
  assert.equal(capture.result.png_sha256, 'e'.repeat(64));
  assert.match(capture.result.target_identity_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(seen, ['OBSERVE_DISPLAYS','FOREGROUND_STATUS','CAPTURE_WINDOW']);
});

test('V2 direct UIA fast actions preserve lease and typed positive-readback semantics', async () => {
  const readbackKinds = {
    UIA_SET_VALUE:'UIA_VALUE_EXACT',
    UIA_TOGGLE:'UIA_TOGGLE_STATE_CHANGED',
    UIA_SELECT:'UIA_SELECTION_EXACT',
    UIA_EXPAND_COLLAPSE:'UIA_EXPAND_STATE_EXACT',
    UIA_SCROLL:'UIA_SCROLL_PERCENT_CHANGED',
  };
  const actions = Object.keys(readbackKinds);
  for (const action of actions) {
    const executor = new WindowsLocalComputerExecutor({
      platform:'win32',
      runner:async (request) => ({
        ok:true,
        effect_started:true,
        readback_proven:true,
        readback_kind:readbackKinds[request.action],
        schema:'metaengine.windows-computer-executor.effect.v1',
        action:request.action,
        authority_effect:true,
      }),
    });
    const args = action === 'UIA_SET_VALUE'
      ? { runtime_id:[1,2], value:'fast' }
      : action === 'UIA_EXPAND_COLLAPSE'
        ? { runtime_id:[1,2], state:'EXPAND' }
        : action === 'UIA_SCROLL'
          ? { runtime_id:[1,2], vertical:'SMALL_INCREMENT' }
          : { runtime_id:[1,2] };
    const result = await executor.act({
      action,
      agent_id:'agent_test-12345678',
      target,
      args,
    }, contextFor(action));
    assert.equal(result.outcome, 'EFFECT_PROVEN', action);
    assert.equal(result.authority_effect, true, action);
    assert.equal(result.automatic_retry_allowed, false, action);
  }
});

test('proven mutation becomes EFFECT_PROVEN only after positive readback', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => ({
      ok:true,
      effect_started:true,
      readback_proven:true,
      readback_kind:'UIA_VALUE_EXACT',
      schema:'metaengine.windows-computer-executor.effect.v1',
      authority_effect:true,
    }),
  });
  const result = await executor.act({ action:'TYPE_TEXT', agent_id:'agent_test-12345678', target, args:{ text:'hello', runtime_id:[1,2,3] } }, contextFor('TYPE_TEXT'));
  assert.equal(result.outcome, 'EFFECT_PROVEN');
  assert.equal(result.authority_effect, true);
  assert.equal(result.automatic_retry_allowed, false);
});

test('generic readback boolean cannot promote a delivery-only action to EFFECT_PROVEN', async () => {
  for (const action of ['UIA_INVOKE','KEY_PRESS']) {
    const executor = new WindowsLocalComputerExecutor({
      platform:'win32',
      runner:async () => ({
        ok:true,
        effect_started:true,
        readback_proven:true,
        readback_kind:'DELIVERY_ONLY',
        dispatch_proven:true,
        authority_effect:true,
      }),
    });
    const args = action === 'UIA_INVOKE' ? { runtime_id:[1,2,3] } : { key:'ENTER' };
    const result = await executor.act({ action, agent_id:'agent_test-12345678', target, args }, contextFor(action));
    assert.equal(result.outcome, 'AMBIGUOUS_NO_RETRY', action);
    assert.equal(result.authority_effect, false, action);
    assert.equal(result.automatic_retry_allowed, false, action);
  }
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

test('visual pointer fallback consumes one fresh exact-window capture and then fails closed', async () => {
  let now = 1000;
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    clock:() => now,
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'c'.repeat(64),
          pixel_sha256:'2'.repeat(64),
          foreground:true,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      assert.deepEqual(request.args.visual_fence.window_rect, { left:10, top:20, width:800, height:600 });
      assert.equal(request.args.visual_fence.pixel_sha256, '2'.repeat(64));
      assert.equal(request.args.visual_fence.foreground_at_capture, true);
      assert.equal(request.args.visual_fence.geometry_stable_at_capture, true);
      return {
        ok:true,
        effect_started:true,
        readback_proven:false,
        dispatch_proven:true,
        schema:'metaengine.windows-computer-executor.effect.v1',
        authority_effect:false,
      };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
  const payload = {
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'c'.repeat(64) } },
  };
  const first = await executor.act(payload, contextFor('POINTER_CLICK'));
  assert.equal(first.outcome, 'AMBIGUOUS_NO_RETRY');
  assert.equal(first.authority_effect, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal(physicalCalls, 1);

  const second = await executor.act(payload, contextFor('POINTER_CLICK'));
  assert.equal(second.outcome, 'NO_EFFECT_PROVEN');
  assert.match(second.error, /computer_visual_frame_not_observed/);
  assert.equal(physicalCalls, 1);
});

test('background window capture cannot authorize visual pointer mutation', async () => {
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'8'.repeat(64),
          pixel_sha256:'5'.repeat(64),
          foreground:false,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:false, authority_effect:false };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'8'.repeat(64) } },
  }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_not_foreground_at_capture/);
  assert.equal(physicalCalls, 0);
});

test('geometry-unstable window capture cannot authorize visual pointer mutation', async () => {
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'6'.repeat(64),
          pixel_sha256:'6'.repeat(64),
          foreground:true,
          geometry_stable:false,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:false, authority_effect:false };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'6'.repeat(64) } },
  }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_geometry_unstable_at_capture/);
  assert.equal(physicalCalls, 0);
});

test('window capture without raw pixel digest cannot authorize visual pointer mutation', async () => {
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'7'.repeat(64),
          foreground:true,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:false, authority_effect:false };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'7'.repeat(64) } },
  }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_not_observed/);
  assert.equal(physicalCalls, 0);
});

test('desktop capture cannot authorize a target-window pointer mutation', async () => {
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      if (request.action === 'CAPTURE_DESKTOP') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'f'.repeat(64),
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:true, authority_effect:true };
    },
  });
  await executor.observe({ action:'CAPTURE_DESKTOP', args:{} });
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'f'.repeat(64) } },
  }, contextFor('POINTER_CLICK'));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_target_unbound/);
  assert.equal(physicalCalls, 0);
});

test('window capture cannot be replayed against a different exact target', async () => {
  let physicalCalls = 0;
  const otherTarget = {
    ...target,
    process_id:101,
    process_creation_time_ms:1791122744585,
    window_handle:'0x4321',
    generation:4,
  };
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'9'.repeat(64),
          pixel_sha256:'3'.repeat(64),
          foreground:true,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:true, authority_effect:true };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
  const result = await executor.act({
    action:'POINTER_CLICK',
    agent_id:'agent_test-12345678',
    target:otherTarget,
    args:{ x:10, y:20, visual_fence:{ frame_sha256:'9'.repeat(64) } },
  }, contextFor('POINTER_CLICK', otherTarget));
  assert.equal(result.outcome, 'NO_EFFECT_PROVEN');
  assert.match(result.error, /computer_visual_frame_target_mismatch/);
  assert.equal(physicalCalls, 0);
});

test('stale visual capture is rejected before physical execution', async () => {
  let now = 1000;
  let physicalCalls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    clock:() => now,
    runner:async (request) => {
      if (request.action === 'CAPTURE_WINDOW') {
        return {
          ok:true,
          effect_started:false,
          png_sha256:'d'.repeat(64),
          pixel_sha256:'4'.repeat(64),
          foreground:true,
          geometry_stable:true,
          machine_fingerprint_sha256:target.machine_fingerprint_sha256,
          target,
          rect:{ left:10, top:20, width:800, height:600 },
          authority_effect:false,
        };
      }
      physicalCalls += 1;
      return { ok:true, effect_started:true, readback_proven:true, authority_effect:true };
    },
  });
  await executor.observe({ action:'CAPTURE_WINDOW', target });
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

test('dispatch-only physical mutations remain ambiguous without semantic effect readback', async () => {
  for (const [action,args] of [
    ['UIA_INVOKE',{ runtime_id:[1,2] }],
    ['KEY_PRESS',{ key:'ENTER' }],
  ]) {
    const executor = new WindowsLocalComputerExecutor({
      platform:'win32',
      runner:async (request) => ({
        ok:true,
        effect_started:true,
        readback_proven:false,
        dispatch_proven:true,
        schema:'metaengine.windows-computer-executor.effect.v1',
        action:request.action,
        authority_effect:false,
      }),
    });
    const result = await executor.act({
      action,
      agent_id:'agent_test-12345678',
      target,
      args,
    }, contextFor(action));
    assert.equal(result.outcome, 'AMBIGUOUS_NO_RETRY', action);
    assert.equal(result.authority_effect, false, action);
    assert.equal(result.automatic_retry_allowed, false, action);
  }
});

test('TYPE_TEXT without value readback is terminal ambiguous after dispatch', async () => {
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => ({
      ok:true,
      effect_started:true,
      readback_proven:false,
      dispatch_proven:true,
      value_readback_available:false,
      schema:'metaengine.windows-computer-executor.effect.v1',
      authority_effect:false,
    }),
  });
  const result = await executor.act({
    action:'TYPE_TEXT',
    agent_id:'agent_test-12345678',
    target,
    args:{ text:'hello', runtime_id:[1,2,3] },
  }, contextFor('TYPE_TEXT'));
  assert.equal(result.outcome, 'AMBIGUOUS_NO_RETRY');
  assert.equal(result.authority_effect, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('TYPE_TEXT append mode fails before physical dispatch because exact caret semantics are unproven', async () => {
  let calls = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform:'win32',
    runner:async () => { calls += 1; return { ok:true }; },
  });
  await assert.rejects(
    () => executor.act({
      action:'TYPE_TEXT',
      agent_id:'agent_test-12345678',
      target,
      args:{ text:'hello', runtime_id:[1,2,3], replace:false },
    }, contextFor('TYPE_TEXT')),
    /computer_type_append_mode_unproven/,
  );
  assert.equal(calls, 0);
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
