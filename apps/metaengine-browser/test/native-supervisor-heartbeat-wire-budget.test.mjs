import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { projectRealtimeProcessPlaneForTransport } from '../src/native-supervisor-client.mjs';

test('realtime process heartbeat projection is scalar-bounded even when local telemetry is huge', () => {
  const hugeTask = {
    task_id: 'task_1',
    status: 'ACTIVE',
    objective: 'x'.repeat(20_000),
    evidence: 'y'.repeat(20_000),
  };
  const full = {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence: 987,
    observed_at: '2026-10-07T18:00:00.000Z',
    sample_interval_ms: 250,
    process_count: 64,
    web_contents_count: 48,
    exact_tab_bound_web_contents_count: 12,
    unbound_live_web_contents_count: 36,
    semantic_root_target_capacity: 4096,
    chromium_subtarget_count: 31,
    chromium_attached_subtarget_count: 30,
    processes: Array.from({ length: 64 }, (_, i) => ({
      pid: 1000 + i,
      payload: 'p'.repeat(10_000),
    })),
    web_contents: Array.from({ length: 48 }, (_, i) => ({
      web_contents_id: i + 1,
      url: 'https://chatgpt.com/' + 'u'.repeat(5000),
    })),
    events: Array.from({ length: 512 }, (_, i) => ({ seq: i + 1, payload: 'e'.repeat(4000) })),
    semantic_plane: {
      schema: 'metaengine.browser.realtime-semantic-plane.v1',
      running: true,
      state: 'READY',
      sequence: 654,
      observed_at: '2026-10-07T18:00:00.000Z',
      target_count: 4000,
      ready_count: 3800,
      dirty_count: 4,
      target_capacity: 4096,
      chromium_subtarget_count: 31,
      chromium_attached_subtarget_count: 30,
      persistent_cdp_sessions: true,
      attach_per_command: false,
      targets: Array.from({ length: 4096 }, () => ({ text: 't'.repeat(1000) })),
      events: Array.from({ length: 512 }, () => ({ text: 's'.repeat(1000) })),
    },
    browser_brain: {
      schema: 'metaengine.browser-brain.continuous-coordinator.v1',
      edge_count: 100_000,
      reconcile_count: 5000,
      continuous_autonomous_work: true,
      durable_collaboration_memory: true,
      episodic_collaboration_memory: true,
      routing_v2: true,
      adaptive_sparse_fanout: true,
      cognition_fabric: { raw: 'c'.repeat(100_000) },
      observation: { raw: 'o'.repeat(100_000) },
      collaboration_fabric: {
        schema: 'metaengine.browser-brain.collaboration-runtime.v2',
        task_count: 2048,
        agent_count: 128,
        journal: { entries: Array(500).fill({ body: 'j'.repeat(4000) }) },
        episodic_memory: { episodes: Array(500).fill({ body: 'm'.repeat(4000) }) },
        workbench: {
          schema: 'metaengine.browser-brain.collaboration-workbench.v1',
          context_count: 128,
          visible_context_count: 32,
          total_task_count: 2048,
          visible_task_count: 512,
          contexts_truncated: true,
          bounded: true,
          contexts: Array.from({ length: 32 }, () => ({
            tasks: Array.from({ length: 64 }, () => hugeTask),
          })),
        },
      },
    },
    cognitive_delta_bus: {
      schema: 'metaengine.browser.cognitive-delta-bus.v1',
      state: 'READY',
      latest_sequence: 333,
      oldest_sequence: 201,
      dropped_events: 7,
      events: Array(1024).fill({ payload: 'd'.repeat(4000) }),
    },
  };

  const projected = projectRealtimeProcessPlaneForTransport(full);
  const bytes = Buffer.byteLength(JSON.stringify(projected), 'utf8');

  assert.ok(bytes < 8192, `transport projection must stay tiny; got ${bytes} bytes`);
  assert.equal(projected.process_count, 64);
  assert.equal(projected.semantic_plane.target_count, 4000);
  assert.equal(projected.browser_brain.collaboration_fabric.workbench.total_task_count, 2048);
  assert.equal(projected.cognitive_delta_bus.sequence, 333);

  assert.equal(projected.processes, undefined);
  assert.equal(projected.web_contents, undefined);
  assert.equal(projected.events, undefined);
  assert.equal(projected.semantic_plane.targets, undefined);
  assert.equal(projected.semantic_plane.events, undefined);
  assert.equal(projected.browser_brain.cognition_fabric, undefined);
  assert.equal(projected.browser_brain.observation, undefined);
  assert.equal(projected.browser_brain.collaboration_fabric.journal, undefined);
  assert.equal(projected.browser_brain.collaboration_fabric.episodic_memory, undefined);
  assert.equal(projected.browser_brain.collaboration_fabric.workbench.contexts, undefined);
  assert.equal(projected.cognitive_delta_bus.events, undefined);

  assert.equal(projected.full_snapshot_retained_locally, true);
  assert.equal(projected.full_snapshot_available_by_command, true);
  assert.equal(projected.transport_projection, true);
  assert.equal(projected.projection_is_authority, false);
  assert.equal(projected.authority_effect, false);
});

test('both durable state writers use compact transport projection while local/read-only surfaces remain full', async () => {
  const source = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');

  const calls = source.match(/projectRealtimeProcessPlaneForTransport\s*\(/g) || [];
  assert.ok(calls.length >= 3, 'definition plus primary heartbeat and realtime fallback must use the compact projector');

  assert.match(
    source,
    /realtime_process_plane:\s*this\.#processPlaneRef\?\.\(\)\?\.snapshot\(\{ eventLimit: 32 \}\)/,
    'local NativeSupervisorClient.snapshot must retain the full process plane for the ME2/UI projection',
  );
  assert.match(source, /action === 'PROCESS_CENSUS'/);
  assert.match(source, /action === 'PROCESS_EVENTS'/);
  assert.match(source, /action === 'SEMANTIC_CENSUS'/);
  assert.match(source, /action === 'SEMANTIC_EVENTS'/);
});

test('Edge independently refuses to persist full realtime process archives from older clients', async () => {
  const edge = await fs.readFile(
    new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(edge, /function boundedRealtimeProcessPlane\(value:any\)/);
  assert.match(
    edge,
    /row\.realtime_process_plane=boundedObject\(boundedRealtimeProcessPlane\(s\.realtime_process_plane\),32768\)/,
  );
  assert.doesNotMatch(edge, /boundedObject\(s\.realtime_process_plane,262144\)/);

  for (const forbidden of ['processes:', 'web_contents:', 'events:', 'contexts:']) {
    const helper = edge.slice(
      edge.indexOf('function boundedRealtimeProcessPlane'),
      edge.indexOf('async function verifyEnrollment'),
    );
    assert.equal(helper.includes(forbidden), false, `Edge compact projector must not persist ${forbidden}`);
  }
});
