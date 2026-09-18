import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildDevosRuntimeObservability, mergeDevosRuntimeObservability } from '../src/devos-runtime-observability.mjs';

const read = (rel) => fs.readFile(new URL(rel, import.meta.url), 'utf8');

test('DevOS runtime observability is bounded and carries no prompt/page payload', () => {
  const projection = buildDevosRuntimeObservability({
    identity: { device_id: 'device-id', secret: 'DO_NOT_EMIT' },
    devos_scheduler_source: 'NATIVE_SUPERVISOR_IDLE_FAST_LANE',
    devos_execution_mode: 'BOUNDED_RUN_ONCE',
    devos_last_error: 'e'.repeat(1000),
    idle_background_work: {
      in_flight: true,
      last_at: '2026-09-18T00:00:00.000Z',
      last_error: 'i'.repeat(1000),
      command_lease_precedes_idle_work: true,
      read_only_can_overlap: true,
      page_text: 'PAGE_SECRET',
    },
    continuous_service: {
      actuation_allowed: true,
      runtime_control: {
        state: 'OPEN',
        reason: null,
        generation_floor: 28,
        authoritative: true,
        supervisor_admission_enabled: true,
      },
    },
    control_fast_lane: {
      transport: 'SUPPORTED',
      last_batch_count: 0,
      last_wait_batch_wake_reason: 'TIMEOUT',
      last_wait_batch_elapsed_ms: 15000,
      last_wait_batch_response_at: '2026-09-18T00:00:00.000Z',
      maintenance_in_flight: false,
    },
    devos_task_cycle: {
      fleet_transport_promotion: {
        state: 'LEASE_FENCED',
        reason: 'r'.repeat(1000),
        agent_id: 'agent_12345678',
        tab_id: 'tab_12345678-1234-1234-1234-123456789012',
        target_id: 'webcontents:3',
        agent_generation_epoch: 28,
        transport_stage: 'PRECONVERSATION_ROOT',
        lease_id: '00000000-0000-4000-8000-000000000000',
        conversation_url: 'https://chatgpt.com/c/private',
        prompt: 'PROMPT_SECRET',
      },
    },
  });

  assert.equal(projection.schema, 'metaengine.devos.runtime-observability.v1');
  assert.equal(projection.identity_enrolled, true);
  assert.equal(projection.admission.actuation_allowed, true);
  assert.equal(projection.admission.generation_floor, 28);
  assert.equal(projection.command_lane.last_batch_count, 0);
  assert.equal(projection.transport_promotion.state, 'LEASE_FENCED');
  assert.equal(projection.transport_promotion.lease_observed, true);
  assert.ok(projection.last_error.length <= 240);
  assert.ok(projection.idle.last_error.length <= 240);
  assert.ok(projection.transport_promotion.reason.length <= 240);
  assert.equal(projection.authority_effect, false);
  assert.equal(projection.scheduler_authority, false);
  assert.equal(projection.lease_authority, false);
  assert.equal(projection.automatic_retry_allowed, false);

  const wire = JSON.stringify(projection);
  for (const forbidden of ['PAGE_SECRET', 'PROMPT_SECRET', 'https://chatgpt.com/c/private', '00000000-0000-4000-8000-000000000000', 'DO_NOT_EMIT']) {
    assert.equal(wire.includes(forbidden), false, forbidden);
  }
});

test('DevOS runtime observability nests inside existing lifecycle plane', () => {
  const runtime = buildDevosRuntimeObservability({});
  const merged = mergeDevosRuntimeObservability({
    schema: 'metaengine.supervisor-lifecycle-runtime.v4',
    keepalive: { cycle_seq: 25 },
  }, runtime);
  assert.equal(merged.schema, 'metaengine.supervisor-lifecycle-runtime.v4');
  assert.equal(merged.keepalive.cycle_seq, 25);
  assert.equal(merged.devos_runtime.schema, 'metaengine.devos.runtime-observability.v1');
  assert.equal(merged.devos_runtime.authority_effect, false);
});

test('primary and realtime state writers preserve the same bounded DevOS lifecycle projection', async () => {
  const core = await read('../src/native-supervisor-client-core-base.mjs');
  const base = await read('../src/native-supervisor-client-base.mjs');
  const publicClient = await read('../src/native-supervisor-client.mjs');
  const edge = await read('../supabase/a2-browser-native-supervisor-v1/index.ts');

  assert.match(core, /buildDevosRuntimeObservability\(localSnapshot \|\| \{\}\)/);
  assert.match(core, /supervisor_lifecycle:\s*supervisorLifecycle/);
  assert.match(base, /state\?\.supervisor_lifecycle\?\.devos_runtime/);
  assert.match(base, /supervisor_lifecycle:\s*supervisorLifecycle/);
  assert.match(publicClient, /buildDevosRuntimeObservability\(base \|\| \{\}\)/);
  assert.match(publicClient, /mergeDevosRuntimeObservability\(lifecycleStatus, devosRuntime\)/);
  assert.match(edge, /row\.supervisor_lifecycle=boundedObject\(s\.supervisor_lifecycle,32768\)/);
});

test('observability contract cannot become a second scheduler or effect lane', async () => {
  const source = await read('../src/devos-runtime-observability.mjs');
  assert.doesNotMatch(source, /setInterval|setTimeout|fetch\(|signedRequest|executeCommand|SEMANTIC_TYPE|TYPED_CLICK|markTransport|promotion-lease/);
  assert.match(source, /scheduler_authority:\s*false/);
  assert.match(source, /lease_authority:\s*false/);
  assert.match(source, /page_text_exposed:\s*false/);
  assert.match(source, /prompt_plaintext_exposed:\s*false/);
});
