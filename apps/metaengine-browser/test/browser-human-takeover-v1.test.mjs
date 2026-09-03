import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HumanTakeoverController } from '../src/human-takeover.mjs';

function fixture(overrides = {}) {
  let state = { supervisor_mode: 'CONTROL', armed: true, current_command: null, ...overrides };
  const calls = [];
  return {
    calls,
    supervisor: {
      snapshot: () => structuredClone(state),
      setControlState: (patch) => {
        calls.push(structuredClone(patch));
        state = {
          ...state,
          ...(patch.mode === undefined ? {} : { supervisor_mode: patch.mode }),
          ...(patch.armed === undefined ? {} : { armed: patch.armed === true }),
        };
        return structuredClone(state);
      },
    },
  };
}

test('pause gates future authority but never claims to abort an in-flight effect', () => {
  const f = fixture({ current_command: { command_id: 'cmd-1', action: 'TYPED_CLICK' } });
  const controller = new HumanTakeoverController({ getSupervisor: () => f.supervisor });
  const result = controller.pause();
  assert.deepEqual(f.calls, [{ mode: 'MONITOR', armed: false }]);
  assert.equal(result.state, 'PAUSED');
  assert.equal(result.future_devos_leases_allowed, false);
  assert.equal(result.reason, 'COMMAND_IN_FLIGHT_NOT_CANCELLED');
  assert.equal(result.retroactive_effect_cancellation, false);
  assert.equal(result.in_flight_effect_aborted, false);
  assert.equal(result.automatic_resume_allowed, false);
});

test('pause is idempotent', () => {
  const f = fixture({ supervisor_mode: 'MONITOR', armed: false });
  const controller = new HumanTakeoverController({ getSupervisor: () => f.supervisor });
  const result = controller.pause();
  assert.equal(result.state, 'PAUSED');
  assert.equal(result.changed, false);
  assert.equal(f.calls.length, 0);
});

test('OFF remains OFF and keyboard-toggle state is not resumable PAUSED', () => {
  const alreadyOff = fixture({ supervisor_mode: 'OFF', armed: false });
  const a = new HumanTakeoverController({ getSupervisor: () => alreadyOff.supervisor });
  assert.equal(a.snapshot().state, 'DISABLED');
  const unchanged = a.pause();
  assert.equal(unchanged.state, 'DISABLED');
  assert.equal(unchanged.supervisor_mode, 'OFF');
  assert.equal(unchanged.changed, false);
  assert.equal(alreadyOff.calls.length, 0);

  const armedOff = fixture({ supervisor_mode: 'OFF', armed: true });
  const b = new HumanTakeoverController({ getSupervisor: () => armedOff.supervisor });
  const disarmed = b.pause();
  assert.deepEqual(armedOff.calls, [{ armed: false }]);
  assert.equal(disarmed.state, 'DISABLED');
  assert.equal(disarmed.supervisor_mode, 'OFF');
  assert.equal(disarmed.armed, false);
});

test('resume is fail-closed while a command remains active', () => {
  const f = fixture({ supervisor_mode: 'MONITOR', armed: false, current_command: { command_id: 'cmd-2', action: 'SEMANTIC_TYPE' } });
  const controller = new HumanTakeoverController({ getSupervisor: () => f.supervisor });
  const result = controller.resume();
  assert.equal(result.state, 'RESUME_BLOCKED');
  assert.equal(result.reason, 'ACTIVE_COMMAND_REQUIRES_POSITIVE_COMPLETION_READBACK');
  assert.equal(result.future_devos_leases_allowed, false);
  assert.equal(f.calls.length, 0);
});

test('resume requires positive CONTROL+armed readback', () => {
  const f = fixture({ supervisor_mode: 'MONITOR', armed: false });
  const controller = new HumanTakeoverController({ getSupervisor: () => f.supervisor });
  const result = controller.resume();
  assert.deepEqual(f.calls, [{ mode: 'CONTROL', armed: true }]);
  assert.equal(result.state, 'RUNNING');
  assert.equal(result.future_devos_leases_allowed, true);
  assert.equal(result.automatic_retry_allowed, false);
});

test('main wires takeover only through trusted shell/local keyboard and not remote supervisor dispatch', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /HumanTakeoverController/);
  assert.match(source, /TAKEOVER_STATUS/);
  assert.match(source, /TAKEOVER_PAUSE/);
  assert.match(source, /TAKEOVER_RESUME/);
  assert.match(source, /before-input-event/);
  assert.match(source, /input\?\.shift !== true/);
  assert.match(source, /toLowerCase\(\) !== 'h'/);
  assert.match(source, /input\?\.type !== 'keyDown'/);
  assert.match(source, /input\?\.isAutoRepeat === true/);
  assert.match(source, /state\.state === 'PAUSED' \? 'RESUME' : 'PAUSE'/);
  const start = source.indexOf('async function executeNativeSupervisorCommand');
  const end = source.indexOf('async function initNativeSupervisor', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const remoteDispatch = source.slice(start, end);
  assert.doesNotMatch(remoteDispatch, /TAKEOVER_/);
  assert.doesNotMatch(remoteDispatch, /HumanTakeoverController/);
});
