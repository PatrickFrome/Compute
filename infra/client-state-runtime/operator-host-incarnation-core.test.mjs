import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';
import { OPERATOR_HOST_EVIDENCE_SCHEMA } from './operator-host-incarnation-core.mjs';

const now = Date.parse('2026-10-12T12:00:00Z');
const at = delta => new Date(now + delta).toISOString();
const key = 'browser-incarnation-A-123';
const owner = { pid: 9876, created_at: at(-65_000), process_incarnation_id: 'owner-9876-incarnation-a', owner_id: 'host-owner-9876', device_id: 'host-device-9876', generation: 2, observed_at: at(-250) };
const browser = { pid: 4242, created_at: at(-60_000), process_incarnation_id: key };
const guardian = () => ({
  schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  state: 'READY', ready: true, guardian_service_ready: true,
  owner_binding_proven: true, device_binding_proven: true,
  owner_id: owner.owner_id, device_id: owner.device_id, owner_generation: owner.generation,
  owner_pid: owner.pid, owner_created_at: owner.created_at, owner_process_incarnation_id: owner.process_incarnation_id,
  stale: false, observed_at: at(-250),
  automatic_retry_allowed: false, authority_effect: false,
});
const signals = () => Object.fromEntries(
  ['startup', 'liveness', 'readiness', 'progress'].map(k => [k, { sequence: 3, observed_at_ms: now - 200 }]),
);
const evidence = () => ({
  schema: OPERATOR_HOST_EVIDENCE_SCHEMA,
  source: 'TRUSTED_HOST_READBACK', authority_effect: false,
  observed_at: at(-100), guardian_health_observed_at: at(-100),
  browser: { ...browser },
  owner: { ...owner },
  owner_runtime_probe: { source: 'OS_PROCESS_INVENTORY', pid: owner.pid, created_at: owner.created_at,
    process_incarnation_id: owner.process_incarnation_id, state: 'PRESENT', observed_at: at(-120) },
  guardian: guardian(),
  runtime_probe: { source: 'OS_PROCESS_INVENTORY', ...browser, state: 'PRESENT', observed_at: at(-120) },
  heartbeat_fence: { valid: true, reason: 'EXACT_SPLIT_HEARTBEATS_FENCED',
    pid: browser.pid, process_incarnation_id: key, channels: signals() },
});
const host = value => buildUnifiedOperatorContext({ nowMs: now, observations: { host: value } }).planes.host;

test('host readback reports process AVAILABLE, never Host or product READY', () => {
  const value = host(evidence());
  assert.equal(value.state, 'AVAILABLE');
  assert.equal(value.proof, 'EXACT_CROSS_BOUND_HOST_READBACK');
  assert.equal(value.details.browser_pid, 4242);
  assert.match(value.details.incarnation_sha256, /^[a-f0-9]{64}$/);
  assert.equal(value.details.product_readiness_proven, false);
  assert.equal(buildUnifiedOperatorContext({ nowMs: now, observations: { host: evidence() } }).operational_state, 'NOT_PROVEN');
});
test('PID reuse (same PID, different creation timestamp) is AMBIGUOUS', () => {
  const v = evidence(); v.runtime_probe.created_at = at(-20_000);
  assert.equal(host(v).state, 'AMBIGUOUS');
});
test('incarnation reuse and heartbeat cross-binding mismatch never pass', () => {
  const v = evidence(); v.heartbeat_fence.process_incarnation_id = 'another-incarnation-3';
  assert.equal(host(v).state, 'AMBIGUOUS');
});
test('stale heartbeat, stale guardian and future timestamp are STALE', () => {
  const a = evidence(); a.heartbeat_fence.channels.readiness.observed_at_ms = now - 10_001;
  assert.equal(host(a).state, 'STALE');
  const b = evidence(); b.guardian.observed_at = at(-10_001);
  assert.equal(host(b).state, 'STALE');
  const c = evidence(); c.observed_at = at(5_001);
  assert.equal(host(c).state, 'STALE');
  const d = evidence(); d.guardian.stale = true;
  assert.equal(host(d).state, 'STALE');
});
test('impossible future process creation cannot become AVAILABLE', () => {
  const v = evidence();
  v.browser.created_at = at(60_000);
  v.runtime_probe.created_at = at(60_000);
  assert.equal(host(v).state, 'UNVERIFIED');
});
test('missing Guardian or heartbeat yields UNKNOWN, never PID-derived READY', () => {
  const v = evidence(); delete v.guardian;
  assert.equal(host(v).state, 'UNKNOWN');
  const w = evidence(); delete w.heartbeat_fence;
  assert.equal(host(w).state, 'UNKNOWN');
});
test('runtime probe-only is UNKNOWN even when PID is present', () => {
  const v = evidence(); delete v.browser; delete v.guardian; delete v.heartbeat_fence;
  assert.equal(host(v).state, 'UNKNOWN');
  assert.equal(host(null).state, 'UNKNOWN');
});
test('non-ready Guardian blocks, even with fresh process and heartbeat', () => {
  const v = evidence(); v.guardian.state = 'HOLD'; v.guardian.ready = false;
  assert.equal(host(v).state, 'BLOCKED');
  const u = evidence(); u.runtime_probe.state = 'ABSENT';
  assert.equal(host(u).state, 'OFFLINE');
});
test('unverified provenance and missing state proof fail closed', () => {
  const v = evidence(); v.source = 'NATIVE_BROWSER_READBACK';
  assert.equal(host(v).state, 'UNVERIFIED');
  const w = evidence(); w.heartbeat_fence.valid = false;
  assert.equal(host(w).state, 'UNVERIFIED');
});
test('strict metadata allowlist redacts private fields and raw incarnation identity', () => {
  const v = evidence();
  v.token = 'MUST_NOT_OUTPUT_TOKEN'; v.browser.command_line = '--secret=MUST_NOT_OUTPUT_TOKEN';
  v.guardian.owner_profile = 'MUST_NOT_OUTPUT_TOKEN';
  v.runtime_probe.private_path = 'MUST_NOT_OUTPUT_TOKEN';
  v.heartbeat_fence.authorization = 'MUST_NOT_OUTPUT_TOKEN';
  const json = JSON.stringify(host(v));
  assert.equal(json.includes('MUST_NOT_OUTPUT_TOKEN'), false);
  assert.equal(json.includes(key), false);
  assert.equal(json.includes('command_line'), false);
  assert.equal(json.includes('private_path'), false);
  assert.equal(json.includes('READY'), false);
});
