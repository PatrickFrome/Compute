import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_ADMISSION_RECOVERY_SCHEMA,
  CLIENT_ADMISSION_RECOVERY_STATE_SCHEMA,
  assertClientAdmissionRecoverySender,
  createClientAdmissionRecovery,
} from '../src/client-admission-recovery.mjs';
import { projectClientWorkReadiness } from '../src/client-work-readiness.mjs';

const START = Date.parse('2026-10-03T00:00:10.000Z');
const REQUEST = Object.freeze({ confirm: true, expected_generation_floor: 28 });
const clone = (value) => structuredClone(value);
const iso = (value) => new Date(value).toISOString();
const receipt = (floor = 28) => ({
  schema: 'metaengine.devos.environment-resume.v1', resumed: true, requested_floor: floor,
  before: { state: 'CLOSED', generation_floor: floor, supervisor_admission_enabled: false },
  after: { state: 'OPEN', generation_floor: floor, supervisor_admission_enabled: true, continuous_service_allowed: true },
  operator_initiated: true, automatic_retry_allowed: false, authority_effect: false,
  readback: { token: 'OWNER_PRIVATE_RESPONSE', signed_request: 'OWNER_PRIVATE_REQUEST' },
});
const storedAttempt = (state = 'PENDING') => ({
  schema: CLIENT_ADMISSION_RECOVERY_STATE_SCHEMA, state, expected_generation_floor: 28,
  requested_at: iso(START - 5_000), preattempt_heartbeat_at: iso(START - 6_000),
  confirmed_heartbeat_at: state === 'CONFIRMED' ? iso(START - 4_000) : null,
});

function harness(options = {}) {
  const h = {
    clock: START, stored: options.stored, writes: [], calls: [], signals: [], reads: 0, loads: 0,
    workOverrides: {},
    connection: {
      schema: 'metaengine.client.connection-status.v1', authority_effect: false,
      local_runtime_ready: true, secure_device_key_ready: true, device_enrolled: true,
      admin_ready: true, access_tier: 'ADMIN', cloud_control_state: 'CONNECTED', admin_scopes: ['CONTROL_PLANE'],
      token: 'CONNECTION_PRIVATE_TOKEN', device_id: 'PRIVATE_DEVICE_ID',
    },
    snapshot: {
      last_heartbeat_at: iso(START - 1_000),
      continuous_service: { runtime_control: {
        schema: 'metaengine.devos.environment-state.v1', state: 'CLOSED', authoritative: true,
        authority_effect: false, automatic_retry_allowed: false, generation_floor: 28,
        refill_enabled: false, supervisor_admission_enabled: false, continuous_service_allowed: false,
      } },
      lifecycle: { keepalive: { state: 'PARKED', admission_state: 'CLOSED', admission_generation_floor: 28 } },
      private_key: 'SNAPSHOT_PRIVATE_KEY',
    },
  };
  h.work = () => ({ ...projectClientWorkReadiness({ connection: h.connection, snapshot: h.snapshot, now: h.clock }), ...h.workOverrides });
  h.dependencies = {
    readConnection: async () => { h.reads++; if (h.readError) throw h.readError; return clone(h.connection); },
    readWorkReadiness: async () => h.work(),
    readSnapshot: async () => clone(h.snapshot),
    resumeAdmission: async (request) => {
      assert.equal(h.stored?.state, 'PENDING', 'the first possible owner effect requires durable PENDING');
      assert.ok(request.signal instanceof AbortSignal);
      h.signals.push(request.signal);
      h.calls.push({ expected_generation_floor: request.expected_generation_floor });
      return options.owner ? options.owner(request, h) : receipt(request.expected_generation_floor);
    },
    loadState: async () => {
      h.loads++;
      if (options.load) return options.load(h);
      if (h.stored === undefined) throw Object.assign(new Error('PRIVATE_MISSING_PATH'), { code: 'ENOENT' });
      return clone(h.stored);
    },
    saveState: async (next) => {
      if (options.save) await options.save(next, h);
      h.stored = clone(next);
      h.writes.push(clone(next));
    },
    now: () => h.clock,
    deadlineMs: options.deadlineMs ?? 1_000,
  };
  h.controller = createClientAdmissionRecovery(h.dependencies);
  h.restart = () => { h.controller = createClientAdmissionRecovery(h.dependencies); return h.controller; };
  h.open = (heartbeat = h.clock) => {
    Object.assign(h.snapshot.continuous_service.runtime_control, {
      state: 'OPEN', refill_enabled: true, supervisor_admission_enabled: true, continuous_service_allowed: true,
    });
    h.snapshot.lifecycle.keepalive.admission_state = 'OPEN';
    h.snapshot.last_heartbeat_at = iso(heartbeat);
  };
  h.close = (heartbeat = h.clock) => {
    Object.assign(h.snapshot.continuous_service.runtime_control, {
      state: 'CLOSED', refill_enabled: false, supervisor_admission_enabled: false, continuous_service_allowed: false,
    });
    h.snapshot.lifecycle.keepalive.admission_state = 'CLOSED';
    h.snapshot.last_heartbeat_at = iso(heartbeat);
  };
  h.floor = (floor) => {
    h.snapshot.continuous_service.runtime_control.generation_floor = floor;
    h.snapshot.lifecycle.keepalive.admission_generation_floor = floor;
  };
  return h;
}

function assertProjection(status) {
  assert.equal(status.schema, CLIENT_ADMISSION_RECOVERY_SCHEMA);
  assert.equal(status.automatic_retry_allowed, false);
  assert.equal(status.scheduler_authority, false);
  assert.equal(status.authority_effect, false);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|"(?:token|private_key|readback|signed_request)"/);
}

test('admission recovery requires every native owner and durable storage dependency', () => {
  const dependencies = harness().dependencies;
  for (const key of ['readConnection', 'readWorkReadiness', 'readSnapshot', 'resumeAdmission', 'loadState', 'saveState', 'now']) {
    assert.throws(() => createClientAdmissionRecovery({ ...dependencies, [key]: null }), /dependencies_invalid/);
  }
  for (const deadlineMs of [0, -1, 30_001, '10', 1.5, Infinity, null]) {
    assert.throws(() => createClientAdmissionRecovery({ ...dependencies, deadlineMs }), /deadline_invalid/);
  }
});

test('status is read-only before intent and ENOENT alone means empty state', async () => {
  const h = harness();
  const result = await h.controller.status();
  assert.equal(result.state, 'IDLE');
  assert.equal(result.reason, 'EXPLICIT_CONFIRMATION_REQUIRED');
  assertProjection(result);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.loads, 1);
});

test('strict confirmation and numeric floor reject malformed intent without an owner effect', async (t) => {
  const extraSymbol = { ...REQUEST, [Symbol('hidden')]: true };
  const nonEnumerable = Object.defineProperty({ ...REQUEST }, 'secret', { value: true });
  for (const [name, request] of [
    ['missing', undefined], ['null', null], ['array', [REQUEST]], ['false confirmation', { ...REQUEST, confirm: false }],
    ['string confirmation', { ...REQUEST, confirm: 'true' }], ['no floor', { confirm: true }],
    ['string floor', { ...REQUEST, expected_generation_floor: '28' }], ['negative', { ...REQUEST, expected_generation_floor: -1 }],
    ['fraction', { ...REQUEST, expected_generation_floor: 28.5 }], ['unsafe', { ...REQUEST, expected_generation_floor: Number.MAX_SAFE_INTEGER + 1 }],
    ['extra key', { ...REQUEST, command: 'DEVOS_RESUME' }], ['symbol key', extraSymbol], ['non-enumerable key', nonEnumerable],
    ['inherited keys', Object.create(REQUEST)],
  ]) await t.test(name, async () => {
    const h = harness();
    const result = await h.controller.resume(request);
    assert.equal(result.state, 'HOLD');
    assert.equal(result.reason, 'EXPLICIT_CONFIRMATION_AND_FLOOR_REQUIRED');
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0); assertProjection(result);
  });
});

test('live owner guards require connected enrolled ADMIN with CONTROL_PLANE scope', async (t) => {
  for (const [key, value] of [
    ['schema', 'other'], ['authority_effect', true], ['local_runtime_ready', false], ['secure_device_key_ready', false],
    ['device_enrolled', false], ['admin_ready', false], ['access_tier', 'USER'], ['cloud_control_state', 'RECONNECTING'],
    ['admin_scopes', []], ['admin_scopes', 'CONTROL_PLANE'],
  ]) await t.test(key, async () => {
    const h = harness(); h.connection[key] = value;
    const result = await h.controller.resume(REQUEST);
    assert.equal(result.reason, 'ADMIN_CONTROL_CONNECTION_REQUIRED');
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  });
});

test('a paused UI projection cannot replace exact raw CLOSED authority, fresh heartbeat, and matching floors', async (t) => {
  const cases = [
    ['work state', h => { h.workOverrides.state = 'READY'; }],
    ['work reason', h => { h.workOverrides.reason = 'SUPERVISOR_RECOVERY_REQUIRED'; }],
    ['execution ready', h => { h.workOverrides.execution_ready = true; }],
    ['work authority', h => { h.workOverrides.authority_effect = true; }],
    ['work scheduler authority', h => { h.workOverrides.scheduler_authority = true; }],
    ['work retry authority', h => { h.workOverrides.automatic_retry_allowed = true; }],
    ['work effect', h => { h.workOverrides.recovery_effect_exposed = true; }],
    ['useful work claim', h => { h.workOverrides.useful_work_verified = true; }],
    ['stale heartbeat', h => { h.snapshot.last_heartbeat_at = iso(h.clock - 30_001); }],
    ['future heartbeat', h => { h.snapshot.last_heartbeat_at = iso(h.clock + 5_001); }],
    ['malformed heartbeat', h => { h.snapshot.last_heartbeat_at = '2026-10-03'; }],
    ['raw authority', h => { h.snapshot.continuous_service.runtime_control.authoritative = false; }],
    ['raw schema', h => { h.snapshot.continuous_service.runtime_control.schema = 'other'; }],
    ['raw open', h => { h.snapshot.continuous_service.runtime_control.state = 'OPEN'; }],
    ['raw flags contradiction', h => { Object.assign(h.snapshot.continuous_service.runtime_control, { refill_enabled: true, supervisor_admission_enabled: true }); }],
    ['raw allowed', h => { h.snapshot.continuous_service.runtime_control.continuous_service_allowed = true; }],
    ['raw effect', h => { h.snapshot.continuous_service.runtime_control.authority_effect = true; }],
    ['raw retry authority', h => { h.snapshot.continuous_service.runtime_control.automatic_retry_allowed = true; }],
    ['local floor', h => { h.snapshot.lifecycle.keepalive.admission_generation_floor = 27; }],
    ['work floor', h => { h.workOverrides.generation_floor = 29; }],
    ['work local floor', h => { h.workOverrides.local_generation_floor = 29; }],
    ['raw numeric string', h => { h.snapshot.continuous_service.runtime_control.generation_floor = '28'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const h = harness(); mutate(h);
    // Simulate stale presentation that still looks paused; the raw owner must remain decisive.
    Object.assign(h.workOverrides, { state: 'PAUSED', reason: 'WORKSPACE_EXECUTION_PAUSED' }, name.startsWith('work ') ? {} : { heartbeat_fresh: true });
    if (name === 'work state') h.workOverrides.state = 'READY';
    if (name === 'work reason') h.workOverrides.reason = 'SUPERVISOR_RECOVERY_REQUIRED';
    const result = await h.controller.resume(REQUEST);
    assert.equal(result.state, 'HOLD'); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  });
  const h = harness();
  assert.equal((await h.controller.resume({ ...REQUEST, expected_generation_floor: 29 })).reason, 'GENERATION_FLOOR_MISMATCH');
  assert.equal(h.calls.length, 0);
});

test('PENDING is durable before one signed owner call and acknowledgment requires independent readback', async () => {
  const h = harness();
  const before = clone(h.snapshot);
  const result = await h.controller.resume(REQUEST);
  assert.equal(result.state, 'READBACK_REQUIRED'); assert.equal(result.fresh_readback_required, true);
  assert.deepEqual(h.calls, [{ expected_generation_floor: 28 }]);
  assert.deepEqual(h.writes.map(row => row.state), ['PENDING', 'READBACK_REQUIRED']);
  assert.deepEqual(h.snapshot, before, 'the recovery controller never changes runtime authority');
  assert.equal((await h.controller.status()).state, 'READBACK_REQUIRED');
  assert.equal((await h.controller.resume(REQUEST)).state, 'READBACK_REQUIRED');
  assert.equal(h.calls.length, 1);
  assertProjection(result);
  assert.doesNotMatch(JSON.stringify(h.stored), /PRIVATE|token|readback|signed_request/);
  assert.deepEqual(Object.keys(h.stored).sort(), ['schema', 'state', 'expected_generation_floor', 'requested_at', 'preattempt_heartbeat_at', 'confirmed_heartbeat_at'].sort());
});

test('generation floor zero is a valid explicit owner intent without coercion', async () => {
  const h = harness(); h.floor(0);
  assert.equal((await h.controller.resume({ confirm: true, expected_generation_floor: 0 })).state, 'READBACK_REQUIRED');
  assert.deepEqual(h.calls, [{ expected_generation_floor: 0 }]);
});

test('only independent OPEN with all flags, exact floors and a newer heartbeat reconciles the durable latch', async (t) => {
  const cases = [
    ['same heartbeat', h => { h.open(START - 1_000); }],
    ['same request time', h => { h.open(START); }],
    ['older than future preattempt', h => { h.stored.preattempt_heartbeat_at = iso(START + 2_000); h.open(START + 1_000); h.restart(); }],
    ['stale', h => { h.clock += 40_000; h.open(START + 1_000); }],
    ['future', h => { h.open(h.clock + 5_001); }],
    ['state', h => { h.snapshot.continuous_service.runtime_control.state = 'CLOSED'; }],
    ['refill flag', h => { h.snapshot.continuous_service.runtime_control.refill_enabled = false; }],
    ['admission flag', h => { h.snapshot.continuous_service.runtime_control.supervisor_admission_enabled = false; }],
    ['allowed flag', h => { h.snapshot.continuous_service.runtime_control.continuous_service_allowed = false; }],
    ['authority', h => { h.snapshot.continuous_service.runtime_control.authoritative = false; }],
    ['raw floor', h => { h.snapshot.continuous_service.runtime_control.generation_floor = 29; }],
    ['local floor', h => { h.snapshot.lifecycle.keepalive.admission_generation_floor = 29; }],
    ['work floor', h => { h.workOverrides.generation_floor = 29; }],
    ['work local floor', h => { h.workOverrides.local_generation_floor = 29; }],
    ['projection authority', h => { h.workOverrides.scheduler_authority = true; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const h = harness(); await h.controller.resume(REQUEST); h.clock += 1_000; h.open(); mutate(h);
    const result = await h.controller.status();
    assert.notEqual(result.state, 'CONFIRMED'); assert.equal(h.calls.length, 1);
  });
  const h = harness(); await h.controller.resume(REQUEST); h.clock += 1_000; h.open();
  assert.equal(h.work().execution_ready, false, 'Agent and Supervisor readiness remain separately unproven');
  const result = await h.controller.status();
  assert.equal(result.state, 'CONFIRMED'); assert.equal(result.fresh_readback_required, false);
  assert.equal(h.stored.confirmed_heartbeat_at, h.snapshot.last_heartbeat_at);
  assertProjection(result); assert.equal(h.calls.length, 1);
});

test('persistent PENDING, READBACK_REQUIRED and AMBIGUOUS survive restart without another effect', async (t) => {
  for (const state of ['PENDING', 'READBACK_REQUIRED', 'AMBIGUOUS']) await t.test(state, async () => {
    const h = harness({ stored: storedAttempt(state) });
    assert.equal((await h.controller.resume(REQUEST)).state, state);
    assert.equal((await h.controller.status()).state, state);
    assert.equal(h.calls.length, 0);
    h.open();
    assert.equal((await h.controller.status()).state, 'CONFIRMED');
    assert.equal(h.calls.length, 0);
  });
});

test('invalid owner receipts stay ambiguous and cannot become local execution authority', async (t) => {
  for (const [name, change] of [
    ['empty', () => ({})], ['null', () => null], ['wrong schema', row => ({ ...row, schema: 'other' })],
    ['wrong floor', row => ({ ...row, requested_floor: 29 })], ['wrong before floor', row => ({ ...row, before: { ...row.before, generation_floor: 29 } })],
    ['wrong before state', row => ({ ...row, before: { ...row.before, state: 'OPEN' } })],
    ['missing before flag', row => ({ ...row, before: { state: 'CLOSED', generation_floor: 28 } })],
    ['closed after', row => ({ ...row, after: { ...row.after, state: 'CLOSED' } })],
    ['missing admission', row => ({ ...row, after: { ...row.after, supervisor_admission_enabled: false } })],
    ['missing continuous', row => ({ ...row, after: { ...row.after, continuous_service_allowed: false } })],
    ['effect claim', row => ({ ...row, authority_effect: true })], ['retry claim', row => ({ ...row, automatic_retry_allowed: true })],
    ['operator missing', row => ({ ...row, operator_initiated: false })],
  ]) await t.test(name, async () => {
    const h = harness({ owner: async () => change(receipt()) });
    const result = await h.controller.resume(REQUEST);
    assert.equal(result.state, 'AMBIGUOUS'); assertProjection(result);
    await h.controller.resume(REQUEST); assert.equal(h.calls.length, 1);
  });
});

test('only exact generation mismatch 409 proves no effect; every other owner failure stays ambiguous', async (t) => {
  for (const [message, expected] of [
    ['native_supervisor_devos_resume_http_409:devos_resume_generation_mismatch', 'NO_EFFECT'],
    ['native_supervisor_devos_resume_http_409:devos_resume_generation_mismatch PRIVATE_TRAILER', 'AMBIGUOUS'],
    ['native_supervisor_devos_resume_http_409:unknown', 'AMBIGUOUS'],
    ['native_supervisor_devos_resume_http_403:denied PRIVATE_TOKEN', 'AMBIGUOUS'],
    ['network PRIVATE_TOKEN', 'AMBIGUOUS'],
  ]) await t.test(expected + ':' + message.split(':')[0], async () => {
    const h = harness({ owner: async () => { throw new Error(message); } });
    const result = await h.controller.resume(REQUEST);
    assert.equal(result.state, expected); assertProjection(result);
    await h.controller.resume(REQUEST);
    assert.equal(h.calls.length, expected === 'NO_EFFECT' ? 2 : 1);
  });
});

test('corrupt or unavailable durable state holds before all possible owner effects', async (t) => {
  const wrongConfirmed = { ...storedAttempt('CONFIRMED'), confirmed_heartbeat_at: iso(START - 5_000) };
  for (const [name, options, expected] of [
    ['null', { stored: null }, 'RECOVERY_STATE_INVALID'],
    ['legacy partial state', { stored: { state: 'PENDING' } }, 'RECOVERY_STATE_INVALID'],
    ['unknown state', { stored: { ...storedAttempt(), state: 'IDLE' } }, 'RECOVERY_STATE_INVALID'],
    ['extra stored secret', { stored: { ...storedAttempt(), token: 'PRIVATE_TOKEN' } }, 'RECOVERY_STATE_INVALID'],
    ['false confirmation timestamp', { stored: wrongConfirmed }, 'RECOVERY_STATE_INVALID'],
    ['parse error', { load: async () => { throw new SyntaxError('PRIVATE_JSON_CONTENT'); } }, 'RECOVERY_STATE_INVALID'],
    ['permission error', { load: async () => { throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EACCES' }); } }, 'RECOVERY_STATE_STORAGE_UNAVAILABLE'],
    ['I/O error', { load: async () => { throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EIO' }); } }, 'RECOVERY_STATE_STORAGE_UNAVAILABLE'],
  ]) await t.test(name, async () => {
    const h = harness(options);
    for (const result of [await h.controller.status(), await h.controller.resume(REQUEST)]) {
      assert.equal(result.state, 'HOLD'); assert.equal(result.reason, expected); assertProjection(result);
    }
    assert.equal(h.calls.length, 0); assert.equal(h.reads, 0); assert.equal(h.writes.length, 0);
  });
});

test('failed PENDING storage prevents transport; failed post-effect storage preserves restart latch', async () => {
  const h = harness({ save: async () => { throw new Error('PRIVATE_DISK_PATH'); } });
  assert.equal((await h.controller.resume(REQUEST)).reason, 'RECOVERY_STATE_STORAGE_UNAVAILABLE');
  assert.equal((await h.controller.resume(REQUEST)).state, 'HOLD');
  assert.equal(h.calls.length, 0);
  const post = harness({ save: async (next) => { if (next.state === 'READBACK_REQUIRED') throw new Error('PRIVATE_DISK_PATH'); } });
  assert.equal((await post.controller.resume(REQUEST)).state, 'HOLD');
  assert.equal(post.stored.state, 'PENDING'); assert.equal(post.calls.length, 1);
  assert.equal((await post.controller.status()).state, 'HOLD');
  post.restart(); post.clock += 1_000; post.open();
  assert.equal((await post.controller.status()).state, 'CONFIRMED');
  await post.controller.resume(REQUEST); assert.equal(post.calls.length, 1);
});

test('in-flight repeated intent and status cannot duplicate the signed effect', async () => {
  let settle;
  const h = harness({ owner: () => new Promise(resolve => { settle = resolve; }) });
  const first = h.controller.resume(REQUEST);
  for (let index = 0; index < 30 && !settle; index++) await Promise.resolve();
  assert.equal(typeof settle, 'function');
  assert.equal((await h.controller.resume(REQUEST)).state, 'PENDING');
  assert.equal((await h.controller.status()).state, 'PENDING');
  assert.equal(h.calls.length, 1);
  settle(receipt()); assert.equal((await first).state, 'READBACK_REQUIRED');
});

test('bounded owner wait releases ambiguous readback without a retry or late-receipt overwrite', async () => {
  let settle;
  const h = harness({ deadlineMs: 10, owner: () => new Promise(resolve => { settle = resolve; }) });
  const result = await h.controller.resume(REQUEST);
  assert.equal(result.state, 'AMBIGUOUS'); assert.equal(h.calls.length, 1); assertProjection(result);
  assert.equal(h.signals[0].aborted, true, 'the whole owner deadline aborts header and body transport');
  await h.controller.resume(REQUEST); assert.equal(h.calls.length, 1);
  h.clock += 1_000; h.open();
  assert.equal((await h.controller.status()).state, 'CONFIRMED');
  settle(receipt()); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.stored.state, 'CONFIRMED'); assert.equal(h.calls.length, 1);
});

test('whole-owner deadline covers a stalled signed HTTP response body and ignores its late completion', async () => {
  const { NativeSupervisorClient } = await import('../src/native-supervisor-client-base.mjs');
  let bodyStream;
  let posted;
  const owner = new NativeSupervisorClient({
    identity: {
      ensure: async () => ({ device_id: 'existing-device' }),
      deviceHeaders: async () => ({ 'x-test-device-signature': 'PRIVATE_SIGNATURE' }),
      snapshot: () => ({}),
    },
    fetchImpl: async (url, init) => {
      posted = { url: String(url), body: JSON.parse(init.body), signal: init.signal };
      // Headers arrive immediately but JSON cannot finish until the body closes.
      return new Response(new ReadableStream({ start(controller) {
        bodyStream = controller;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(receipt())));
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    getState: async () => ({}), executeCommand: async () => ({}), version: 'test',
  });
  const h = harness({ deadlineMs: 10, owner: request => owner.devosResumeAdmission(request) });
  assert.equal((await h.controller.resume(REQUEST)).state, 'AMBIGUOUS');
  assert.ok(posted.url.endsWith('/v1/devos/resume-admission'));
  assert.deepEqual(posted.body, { confirm: true, expected_generation_floor: 28 });
  assert.equal(posted.signal.aborted, true);
  h.clock += 1_000; h.open();
  assert.equal((await h.controller.status()).state, 'CONFIRMED');
  bodyStream.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.stored.state, 'CONFIRMED'); assert.equal(h.calls.length, 1);
  await h.controller.resume(REQUEST); assert.equal(h.calls.length, 1);
});

test('confirmed recovery allows a new explicit same-floor intent only after a newer authoritative pause', async () => {
  const h = harness(); await h.controller.resume(REQUEST); h.clock += 1_000; h.open();
  assert.equal((await h.controller.status()).state, 'CONFIRMED');
  const confirmedAt = Date.parse(h.stored.confirmed_heartbeat_at);
  h.restart(); h.close(confirmedAt);
  assert.equal((await h.controller.status()).reason, 'NEW_PAUSE_READBACK_REQUIRED');
  assert.equal((await h.controller.resume(REQUEST)).reason, 'NEW_PAUSE_READBACK_REQUIRED');
  assert.equal(h.calls.length, 1);
  h.clock += 1_000; h.close();
  assert.equal((await h.controller.status()).state, 'IDLE'); assert.equal(h.calls.length, 1);
  assert.equal((await h.controller.resume(REQUEST)).state, 'READBACK_REQUIRED');
  assert.equal(h.calls.length, 2); assert.equal(h.stored.confirmed_heartbeat_at, null);
});

test('new-floor intent after confirmed recovery requires exact current runtime, work and local floor', async () => {
  const h = harness({ stored: storedAttempt('CONFIRMED') }); h.floor(29);
  assert.equal((await h.controller.resume({ ...REQUEST, expected_generation_floor: 28 })).reason, 'GENERATION_FLOOR_MISMATCH');
  assert.equal(h.calls.length, 0);
  assert.equal((await h.controller.resume({ ...REQUEST, expected_generation_floor: 29 })).state, 'READBACK_REQUIRED');
  assert.deepEqual(h.calls, [{ expected_generation_floor: 29 }]);
});

test('confirmed OPEN heartbeat high-water persists so stale CLOSED cannot rearm after restart', async () => {
  const h = harness(); await h.controller.resume(REQUEST); h.clock += 1_000; h.open();
  await h.controller.status();
  const firstProof = Date.parse(h.stored.confirmed_heartbeat_at);
  h.clock += 2_000; h.open();
  assert.equal((await h.controller.status()).state, 'CONFIRMED');
  assert.equal(h.stored.confirmed_heartbeat_at, iso(h.clock));
  const writes = h.writes.length;
  await h.controller.status(); assert.equal(h.writes.length, writes, 'identical OPEN readback needs no duplicate durable write');
  h.restart(); h.close(firstProof + 1_000);
  assert.equal((await h.controller.resume(REQUEST)).reason, 'NEW_PAUSE_READBACK_REQUIRED');
  assert.equal(h.calls.length, 1);
  h.clock += 1_000; h.close();
  assert.equal((await h.controller.resume(REQUEST)).state, 'READBACK_REQUIRED');
  assert.equal(h.calls.length, 2);
});

test('native readback and clock errors produce sanitized holds before transport', async () => {
  const h = harness(); h.readError = new Error('PRIVATE_NATIVE_ERROR');
  assert.equal((await h.controller.status()).reason, 'NATIVE_READBACK_UNAVAILABLE');
  const failed = await h.controller.resume(REQUEST); assertProjection(failed); assert.equal(h.calls.length, 0);
  for (const now of [() => { throw new Error('PRIVATE_CLOCK_ERROR'); }, () => NaN, () => Infinity, () => -1]) {
    const controller = createClientAdmissionRecovery({ ...h.dependencies, readConnection: async () => h.connection, now });
    assert.equal((await controller.status()).reason, 'CLOCK_UNAVAILABLE');
    assert.equal((await controller.resume(REQUEST)).reason, 'CLOCK_UNAVAILABLE');
  }
  assert.equal(h.calls.length, 0);
});

function senderFixture() {
  const frame = { url: 'http://127.0.0.1:8137/#browser', origin: 'http://127.0.0.1:8137', detached: false };
  const webContents = { id: 7, mainFrame: frame, isDestroyed: () => false };
  return { event: { sender: webContents, senderFrame: frame }, options: { webContents, primaryShellMode: 'ME2_PRIMARY', primaryShellUrl: 'http://127.0.0.1:8137/#browser' } };
}

test('admission sender accepts only the exact live primary main frame on configured loopback root origin', () => {
  const { event, options } = senderFixture();
  assert.doesNotThrow(() => assertClientAdmissionRecoverySender(event, options));
  event.senderFrame.url = 'http://127.0.0.1:8137/#settings';
  assert.doesNotThrow(() => assertClientAdmissionRecoverySender(event, options));
});

test('foreign, detached, subframe and navigated admission senders fail closed', async (t) => {
  const cases = [
    ['same id different sender', row => { row.event.sender = { id: 7 }; }],
    ['foreign sender', row => { row.event.sender = { id: 8 }; }],
    ['subframe same URL', row => { row.event.senderFrame = { ...row.event.senderFrame }; }],
    ['missing frame', row => { delete row.event.senderFrame; }],
    ['detached frame', row => { row.event.senderFrame.detached = true; }],
    ['opaque origin', row => { row.event.senderFrame.origin = 'null'; }],
    ['foreign frame origin', row => { row.event.senderFrame.origin = 'https://chat.z.ai'; }],
    ['missing frame origin', row => { delete row.event.senderFrame.origin; }],
    ['destroyed sender', row => { row.options.webContents.isDestroyed = () => true; }],
    ['legacy shell', row => { row.options.primaryShellMode = 'LEGACY_RECOVERY'; }],
    ['different port', row => { row.event.senderFrame.url = 'http://127.0.0.1:8138/'; }],
    ['external origin', row => { row.event.senderFrame.url = 'https://chat.z.ai/'; }],
    ['localhost alias', row => { row.event.senderFrame.url = 'http://localhost:8137/'; }],
    ['loopback subpath', row => { row.event.senderFrame.url = 'http://127.0.0.1:8137/other'; }],
    ['query', row => { row.event.senderFrame.url = 'http://127.0.0.1:8137/?page=other'; }],
    ['URL credentials', row => { row.event.senderFrame.url = 'http://user:secret@127.0.0.1:8137/'; }],
    ['missing configured URL', row => { row.options.primaryShellUrl = null; }],
    ['external configured origin', row => { row.options.primaryShellUrl = row.event.senderFrame.url = 'https://chat.z.ai/'; }],
    ['no explicit configured port', row => { row.options.primaryShellUrl = row.event.senderFrame.url = 'http://127.0.0.1/'; }],
    ['configured path', row => { row.options.primaryShellUrl = row.event.senderFrame.url = 'http://127.0.0.1:8137/other'; }],
    ['configured credentials', row => { row.options.primaryShellUrl = row.event.senderFrame.url = 'http://user:secret@127.0.0.1:8137/'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const row = senderFixture(); mutate(row);
    assert.throws(() => assertClientAdmissionRecoverySender(row.event, row.options), /^Error: client_admission_recovery_sender_not_trusted$/);
  });
});
