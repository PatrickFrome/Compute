import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectClientWorkReadiness, projectNativeRuntimeObservation } from '../src/client-work-readiness.mjs';
import { AgentObservationPlane } from '../src/agent-observation-plane.mjs';
import { normalizeDevosRuntimeControl } from '../src/devos-runtime-control.mjs';

const now = Date.parse('2026-10-01T00:00:00Z');
function input() {
  return {
    now,
    isCurrentBinding: () => true,
    connection: { local_runtime_ready: true, admin_ready: true, cloud_control_state: 'CONNECTED' },
    snapshot: {
      started_at: '2026-09-30T23:00:00Z', last_heartbeat_at: new Date(now - 1_000).toISOString(),
      continuous_service: { actuation_allowed: true, runtime_control: {
        state: 'OPEN', authoritative: true, generation_floor: 28,
        refill_enabled: true, supervisor_admission_enabled: true, continuous_service_allowed: true, authority_effect: false,
      } },
      lifecycle: { keepalive: { state: 'WAITING', tab_id: 'tab_supervisor', conversation_url: 'https://chat.z.ai/c/test', cycle_seq: 2109, admission_state: 'OPEN', admission_generation_floor: 28 } },
      control_fast_lane: { maintenance_in_flight: true, scheduler: { pressure_band: 'NORMAL' } },
    },
    fleet: { counts: { ACTIVE: 1, BOUND_UNVERIFIED: 0 }, agents: [{
      lifecycle_state: 'ACTIVE', tab_id: 'tab_agent', target_id: 'target_agent', generation_epoch: 28,
      transport_proof: { tab_id: 'tab_agent', target_id: 'target_agent', generation_epoch: 28,
        agent_surface_sha256: 'a'.repeat(64), conversation_url_sha256: 'b'.repeat(64) },
    }] },
  };
}

test('positive readiness requires current admission and exact Agent origin; completion is still unproven', () => {
  const result = projectClientWorkReadiness(input());
  assert.equal(result.state, 'READY');
  assert.equal(result.execution_ready, true);
  assert.equal(result.proven_agent_count, 1);
  assert.equal(result.useful_work_verified, false);
  assert.equal(result.authority_effect, false);
});

for (const [name, mutate, reason, state] of [
  ['connection alone', x => { x.snapshot.continuous_service.runtime_control.authoritative = false; }, 'WORKSPACE_AUTHORITY_UNAVAILABLE', 'BLOCKED'],
  ['missing heartbeat', x => { x.snapshot.last_heartbeat_at = null; }, 'HEARTBEAT_READBACK_STALE', 'BLOCKED'],
  ['stale heartbeat', x => { x.snapshot.last_heartbeat_at = new Date(now - 30_001).toISOString(); }, 'HEARTBEAT_READBACK_STALE', 'BLOCKED'],
  ['future heartbeat', x => { x.snapshot.last_heartbeat_at = new Date(now + 5_001).toISOString(); }, 'HEARTBEAT_READBACK_STALE', 'BLOCKED'],
  ['generation regression', x => { x.snapshot.continuous_service.runtime_control.generation_floor = 0; }, 'GENERATION_FLOOR_REGRESSION', 'BLOCKED'],
  ['explicit regression fence', x => { Object.assign(x.snapshot.continuous_service.runtime_control, { authoritative: false, reason: 'GENERATION_FLOOR_REGRESSION' }); }, 'GENERATION_FLOOR_REGRESSION', 'BLOCKED'],
  ['closed workspace', x => { x.snapshot.continuous_service.runtime_control.state = 'CLOSED'; }, 'WORKSPACE_EXECUTION_PAUSED', 'PAUSED'],
  ['partial admission', x => { x.snapshot.continuous_service.runtime_control.supervisor_admission_enabled = false; }, 'WORKSPACE_EXECUTION_PAUSED', 'PAUSED'],
  ['local admission lag', x => { x.snapshot.lifecycle.keepalive.admission_state = 'UNKNOWN'; }, 'SUPERVISOR_ADMISSION_NOT_OBSERVED', 'BLOCKED'],
  ['ambiguous rollover', x => { x.snapshot.lifecycle.keepalive.state = 'ROLLOVER_AMBIGUOUS'; }, 'SUPERVISOR_RECOVERY_REQUIRED', 'BLOCKED'],
  ['destroyed supervisor tab', x => { x.isCurrentBinding = binding => binding.tab_id !== 'tab_supervisor'; }, 'SUPERVISOR_RECOVERY_REQUIRED', 'BLOCKED'],
  ['destroyed agent tab', x => { x.isCurrentBinding = binding => binding.tab_id !== 'tab_agent'; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
  ['root-only transport', x => { x.fleet.agents[0].lifecycle_state = 'BOUND_UNVERIFIED'; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
  ['missing Agent digest', x => { x.fleet.agents[0].transport_proof.agent_surface_sha256 = null; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
  ['different target', x => { x.fleet.agents[0].transport_proof.target_id = 'other'; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
  ['different generation', x => { x.fleet.agents[0].transport_proof.generation_epoch = 27; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
  ['zero generation', x => { x.fleet.agents[0].generation_epoch = 0; x.fleet.agents[0].transport_proof.generation_epoch = 0; }, 'AGENT_ORIGIN_UNVERIFIED', 'BLOCKED'],
]) {
  test(`${name} cannot masquerade as ready`, () => {
    const value = input(); mutate(value);
    const result = projectClientWorkReadiness(value);
    assert.equal(result.state, state);
    assert.equal(result.reason, reason);
    assert.equal(result.execution_ready, false);
  });
}

test('native telemetry receives actual lifecycle, DevOS and accepted-heartbeat data', () => {
  const value = input();
  value.snapshot.lifecycle.keepalive.state = 'ROLLOVER_AMBIGUOUS';
  const state = { ...projectNativeRuntimeObservation(value.snapshot, 'candidate'), fleet: value.fleet };
  const telemetry = new AgentObservationPlane().systemTelemetry(state);
  assert.equal(telemetry.supervisor.keepalive_state, 'ROLLOVER_AMBIGUOUS');
  assert.equal(telemetry.supervisor.keepalive_cycle_seq, 2109);
  assert.equal(telemetry.devos.admission_state, 'OPEN');
  assert.equal(telemetry.devos.actuation_allowed, true);
  assert.equal(telemetry.heartbeat_at, value.snapshot.last_heartbeat_at);
  assert.equal(telemetry.shell_version, 'candidate');
  assert.equal(telemetry.control.maintenance_in_flight, true);
});

test('runtime projection never serializes identity, prompt or pending command payloads', () => {
  const value = input().snapshot;
  value.identity = { private_key: 'SENTINEL_SECRET' };
  value.current_command = { payload: 'SENTINEL_SECRET' };
  value.lifecycle.keepalive.pending_wake = { prompt: 'SENTINEL_SECRET' };
  assert.doesNotMatch(JSON.stringify(projectNativeRuntimeObservation(value)), /SENTINEL_SECRET/);
});

test('explicit missing authority never normalizes an invented floor zero into a closed authoritative row', () => {
  const result = normalizeDevosRuntimeControl({
    schema: 'metaengine.devos.environment-state.v1', authority_present: false,
    workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', generation_floor: 0,
    refill_enabled: false, supervisor_admission_enabled: false, authority_effect: false,
  });
  assert.equal(result.authoritative, false);
  assert.equal(result.generation_floor, null);
  assert.equal(result.reason, 'WORKSPACE_AUTHORITY_MISSING');
});

test('the primary renderer receives only an observation IPC and main uses the same telemetry projection', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  assert.match(main, /ipcMain\.handle\('metaengine:client:work-readiness',[\s\S]{0,100}assertShellSender\(event\)/);
  assert.match(main, /projectNativeRuntimeObservation\(nativeSupervisor\?\.snapshot/);
  assert.match(preload, /workReadiness: clientWorkReadiness/);
});
