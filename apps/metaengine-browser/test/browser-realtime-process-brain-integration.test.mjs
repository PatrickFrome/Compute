import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';

const TAB_ID = 'tab_00000000-0000-4000-8000-000000000201';

class FakeApp extends EventEmitter {
  getAppMetrics() {
    return [
      {
        pid: 1,
        creationTime: 1000,
        type: 'Browser',
        cpu: { percentCPUUsage: 1 },
        memory: { workingSetSize: 128000 },
      },
      {
        pid: 201,
        creationTime: 2001,
        type: 'Tab',
        cpu: { percentCPUUsage: 2 },
        memory: { workingSetSize: 64000 },
      },
    ];
  }
}

function fakeWebContents() {
  return {
    id: 201,
    getOSProcessId: () => 201,
    isDestroyed: () => false,
    getURL: () => 'https://chatgpt.com/c/test',
    getTitle: () => 'ChatGPT',
    getType: () => 'window',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isCrashed: () => false,
    isFocused: () => false,
    isAudioMuted: () => false,
    isCurrentlyAudible: () => false,
  };
}

test('metrics edge reaches the integrated Brain before external onChange callback', () => {
  const calls = [];
  const brain = {
    observeEdge(event, { process_snapshot }) {
      calls.push({ phase: 'brain', type: event.type, snapshot: process_snapshot });
      return { pressure_evaluated: true };
    },
    pressureBudget() {
      return {
        pressure_band: 'GREEN',
        read_concurrency: 128,
        mutation_concurrency: 1,
        resource_sample_ms: 250,
        authority_effect: false,
      };
    },
    snapshot() {
      return {
        schema: 'metaengine.browser-brain.continuous-coordinator.v1',
        edge_count: calls.filter((row) => row.phase === 'brain').length,
        authority_effect: false,
      };
    },
  };
  const wc = fakeWebContents();
  const plane = new BrowserRealtimeProcessPlane({
    app: new FakeApp(),
    getWebContents: () => [wc],
    resolveTabId: (id) => id === 201 ? TAB_ID : null,
    brainCoordinator: brain,
    onChange: (event) => calls.push({ phase: 'external', type: event.type, brain_edges: brain.snapshot().edge_count }),
  });

  const snapshot = plane.refresh('METRICS_SAMPLE');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].phase, 'brain');
  assert.equal(calls[1].phase, 'external');
  assert.equal(calls[1].brain_edges, 1);
  assert.equal(calls[0].snapshot.web_contents[0].tab_id, TAB_ID);
  assert.equal(snapshot.browser_brain.process_plane_integrated, true);
  assert.equal(snapshot.browser_brain.same_event_stream, true);
  assert.equal(snapshot.browser_brain.second_process_observer, false);
  assert.equal(snapshot.tab_identity_source, 'EXACT_WEBCONTENTS_TAB_INDEX_O1');
  assert.equal(snapshot.second_scheduler, false);
});

test('Brain failure is fail-soft and does not suppress process-plane delivery', () => {
  let external = 0;
  const plane = new BrowserRealtimeProcessPlane({
    app: new FakeApp(),
    getWebContents: () => [fakeWebContents()],
    resolveTabId: () => TAB_ID,
    brainCoordinator: {
      observeEdge() { throw new Error('brain_fixture_failure'); },
      pressureBudget() { return null; },
      snapshot() { return { schema: 'metaengine.browser-brain.continuous-coordinator.v1', authority_effect: false }; },
    },
    onChange: () => { external += 1; },
  });

  const snapshot = plane.refresh('METRICS_SAMPLE');
  assert.equal(external, 1);
  assert.match(snapshot.browser_brain.process_plane_last_error, /brain_fixture_failure/);
  assert.equal(snapshot.control_authority, false);
});


test('existing process cadence emits bounded Brain working memory to the RSI sidecar without a second observer', () => {
  const observed = [];
  const workingMemory = Object.freeze({
    schema: 'metaengine.browser.brain-working-memory.v1',
    global: Object.freeze({ process_revision: 1, cognitive_sequence: 2, dropped_events: 0 }),
    cell_count: 0,
    cells: Object.freeze([]),
    raw_dom_stored: false,
    raw_network_stored: false,
    page_text_stored: false,
    input_values_stored: false,
    command_payload_stored: false,
    execution_authority: false,
    authority_effect: false,
  });
  const brain = {
    observeEdge: () => Object.freeze({ authority_effect: false }),
    pressureBudget: () => null,
    workingMemorySnapshot: () => workingMemory,
    snapshot: () => Object.freeze({
      schema: 'metaengine.browser-brain.continuous-coordinator.v1',
      observation: { working_memory: workingMemory },
      authority_effect: false,
    }),
  };
  const plane = new BrowserRealtimeProcessPlane({
    app: new FakeApp(),
    getWebContents: () => [fakeWebContents()],
    resolveTabId: () => TAB_ID,
    brainCoordinator: brain,
    onBrainSnapshot: (snapshot, metadata) => observed.push({ snapshot, metadata }),
  });

  const snapshot = plane.refresh('METRICS_SAMPLE');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].snapshot.schema, 'metaengine.browser.brain-working-memory.v1');
  assert.equal(observed[0].metadata.cadence, 'EXISTING_PROCESS_SAMPLE');
  assert.equal(observed[0].metadata.second_scheduler, false);
  assert.equal(snapshot.rsi_brain_observation_sidecar, true);
  assert.equal(snapshot.rsi_brain_observation_cadence, 'EXISTING_PROCESS_SAMPLE_PLUS_TOPOLOGY_REFRESH');
  assert.equal(snapshot.browser_brain_second_process_observer, false);
});
