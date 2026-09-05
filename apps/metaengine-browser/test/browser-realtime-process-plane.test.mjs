import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';

class FakeApp extends EventEmitter {
  constructor(metrics = []) {
    super();
    this.metrics = metrics;
  }
  getAppMetrics() { return structuredClone(this.metrics); }
}

class FakeContents extends EventEmitter {
  constructor({ id, pid, type = 'window', url = 'https://chatgpt.com/', title = 'ChatGPT' }) {
    super();
    this.id = id;
    this.pid = pid;
    this.type = type;
    this.url = url;
    this.title = title;
    this.destroyed = false;
    this.loading = false;
    this.focused = false;
  }
  getOSProcessId() { return this.pid; }
  getType() { return this.type; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  isDestroyed() { return this.destroyed; }
  isLoading() { return this.loading; }
  isLoadingMainFrame() { return this.loading; }
  isCrashed() { return false; }
  isFocused() { return this.focused; }
  isAudioMuted() { return false; }
  isCurrentlyAudible() { return false; }
}

const metrics = () => [
  {
    pid: 100,
    creationTime: 1725520000000,
    type: 'Browser',
    name: 'METAENGINE Browser',
    cpu: { percentCPUUsage: 3.5, idleWakeupsPerSecond: 1 },
    memory: { workingSetSize: 1000, peakWorkingSetSize: 1500, privateBytes: 900 },
    sandboxed: false,
  },
  {
    pid: 200,
    creationTime: 1725520000100,
    type: 'Tab',
    name: 'Renderer',
    cpu: { percentCPUUsage: 4.25, idleWakeupsPerSecond: 2 },
    memory: { workingSetSize: 2000, peakWorkingSetSize: 2500, privateBytes: 1800 },
    sandboxed: true,
  },
  {
    pid: 300,
    creationTime: 1725520000200,
    type: 'GPU',
    name: 'GPU Process',
    cpu: { percentCPUUsage: 1.25, idleWakeupsPerSecond: 0 },
    memory: { workingSetSize: 500, peakWorkingSetSize: 700, privateBytes: 450 },
    sandboxed: true,
  },
];

test('realtime process plane joins Electron process metrics to webContents and exact tab identity', () => {
  const app = new FakeApp(metrics());
  const remote = new FakeContents({ id: 7, pid: 200 });
  const shell = new FakeContents({ id: 8, pid: 210, type: 'window', url: 'metaengine://shell/', title: 'METAENGINE' });
  const changes = [];
  const plane = new BrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [remote, shell],
    resolveTabId: (id) => id === 7 ? 'tab_00000000-0000-4000-8000-000000000001' : null,
    sampleMs: 5000,
    onChange: (event) => changes.push(event),
  });

  const snapshot = plane.start();
  assert.equal(snapshot.running, true);
  assert.equal(snapshot.process_count, 3);
  assert.equal(snapshot.web_contents_count, 2);
  assert.equal(snapshot.event_driven_lifecycle, true);
  assert.equal(snapshot.periodic_resource_sampling, true);
  assert.equal(snapshot.control_authority, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.second_scheduler, false);
  const renderer = snapshot.processes.find((row) => row.pid === 200);
  assert.equal(renderer.creation_time_ms, 1725520000100);
  assert.equal(renderer.process_key, '200:1725520000100');
  assert.equal(renderer.process_identity_complete, true);
  assert.equal(renderer.web_contents[0].web_contents_id, 7);
  assert.equal(renderer.web_contents[0].tab_id, 'tab_00000000-0000-4000-8000-000000000001');
  assert.equal(renderer.web_contents[0].process_key, renderer.process_key);
  const remoteRow = snapshot.web_contents.find((row) => row.web_contents_id === 7);
  assert.equal(remoteRow.url, 'https://chatgpt.com/');
  assert.equal(remoteRow.process_key, renderer.process_key);
  assert.equal(snapshot.process_identity_pid_reuse_safe, true);
  assert.ok(changes.some((row) => row.type === 'PROCESS_CENSUS_REFRESHED'));
  plane.stop();
});

test('process identity changes when the OS reuses a PID for a new process incarnation', () => {
  const app = new FakeApp(metrics());
  const remote = new FakeContents({ id: 11, pid: 200 });
  const plane = new BrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [remote],
    resolveTabId: () => 'tab_00000000-0000-4000-8000-000000000011',
    sampleMs: 5000,
  });
  const first = plane.start();
  const firstRenderer = first.processes.find((row) => row.pid === 200);
  assert.equal(firstRenderer.process_key, '200:1725520000100');

  app.metrics = app.metrics.map((row) => row.pid === 200
    ? { ...row, creationTime: 1725529999999, name: 'Replacement Renderer' }
    : row);
  const second = plane.refresh('PID_REUSE_TEST');
  const secondRenderer = second.processes.find((row) => row.pid === 200);
  assert.equal(secondRenderer.process_key, '200:1725529999999');
  assert.notEqual(secondRenderer.process_key, firstRenderer.process_key);
  assert.equal(second.web_contents.find((row) => row.web_contents_id === 11).process_key, secondRenderer.process_key);
  plane.stop();
});

test('renderer and child process lifecycle changes are pushed into ordered deltas immediately', () => {
  let now = Date.parse('2026-09-05T10:00:00.000Z');
  const app = new FakeApp(metrics());
  const remote = new FakeContents({ id: 17, pid: 200 });
  const plane = new BrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [remote],
    resolveTabId: () => 'tab_00000000-0000-4000-8000-000000000017',
    clock: () => (now += 1),
    sampleMs: 5000,
  });
  plane.start();
  const before = plane.snapshot({ eventLimit: 0 }).sequence;

  remote.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  app.emit('child-process-gone', {}, { type: 'Utility', reason: 'abnormal-exit', exitCode: 17, serviceName: 'METAENGINE Development Plane', name: 'utility' });

  const delta = plane.snapshot({ eventsSince: before, eventLimit: 32 });
  assert.ok(delta.sequence > before);
  assert.ok(delta.events.some((row) => row.type === 'RENDER_PROCESS_GONE' && row.os_pid === 200 && row.exit_code === 9));
  assert.ok(delta.events.some((row) => row.type === 'CHILD_PROCESS_GONE' && row.service_name === 'METAENGINE Development Plane' && row.exit_code === 17));
  const ordered = delta.events.map((row) => row.seq);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  plane.stop();
});

test('event history is bounded and reports dropped deltas rather than growing without limit', () => {
  const app = new FakeApp(metrics());
  const remote = new FakeContents({ id: 27, pid: 200 });
  const plane = new BrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [remote],
    eventLimit: 32,
    sampleMs: 5000,
  });
  plane.start();
  for (let i = 0; i < 100; i += 1) remote.emit(i % 2 ? 'focus' : 'blur');
  const snapshot = plane.snapshot({ eventLimit: 1024 });
  assert.equal(snapshot.events.length, 32);
  assert.ok(snapshot.dropped_events >= 68);
  assert.equal(snapshot.page_content_exposed, false);
  assert.equal(snapshot.authority_effect, false);
  plane.stop();
});

test('stop removes app/webContents listeners and has no hidden command scheduler', () => {
  const app = new FakeApp(metrics());
  const remote = new FakeContents({ id: 37, pid: 200 });
  const plane = new BrowserRealtimeProcessPlane({ app, getWebContents: () => [remote], sampleMs: 5000 });
  plane.start();
  assert.ok(app.listenerCount('child-process-gone') > 0);
  assert.ok(remote.listenerCount('render-process-gone') > 0);
  assert.equal(plane.stop(), true);
  assert.equal(app.listenerCount('child-process-gone'), 0);
  assert.equal(remote.listenerCount('render-process-gone'), 0);
  assert.equal(plane.snapshot().second_scheduler, false);
});
