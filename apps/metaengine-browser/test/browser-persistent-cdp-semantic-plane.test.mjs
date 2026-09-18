import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PersistentBrowserCdpSessionPool } from '../src/browser-persistent-cdp-session.mjs';
import { BrowserRealtimeSemanticPlane } from '../src/browser-realtime-semantic-plane.mjs';

class FakeDebugger extends EventEmitter {
  constructor() {
    super();
    this.attached = false;
    this.attachCount = 0;
    this.detachCount = 0;
    this.calls = [];
    this.axNodes = [
      { nodeId: 'root', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Page' } },
      { nodeId: 'button', ignored: false, role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 11 },
      { nodeId: 'text', ignored: false, role: { value: 'StaticText' }, name: { value: 'hello realtime' }, backendDOMNodeId: 12 },
    ];
  }
  isAttached() { return this.attached; }
  attach(version) { this.attached = true; this.attachCount += 1; this.version = version; }
  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.detachCount += 1;
    this.emit('detach', {}, 'target closed');
  }
  async sendCommand(method, params = {}, sessionId = undefined) {
    if (!this.attached) throw new Error('not_attached');
    this.calls.push({ method, params, sessionId });
    if (method === 'Accessibility.getFullAXTree') return { nodes: structuredClone(this.axNodes) };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800, pageX: 0, pageY: 0, scale: 1 } };
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    return {};
  }
  push(method, params = {}, sessionId = null) { this.emit('message', {}, method, params, sessionId); }
}

class FakeContents extends EventEmitter {
  constructor(id, pid, url = 'https://chatgpt.com/') {
    super();
    this.id = id;
    this.pid = pid;
    this.url = url;
    this.title = `Tab ${id}`;
    this.destroyed = false;
    this.debugger = new FakeDebugger();
  }
  isDestroyed() { return this.destroyed; }
  getOSProcessId() { return this.pid; }
  getOrCreateDevToolsTargetId() { return `target-${this.id}`; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
}

const nextImmediate = () => new Promise((resolve) => setImmediate(resolve));

test('persistent CDP pool attaches once and reuses the same hot debugger across commands', async () => {
  const pool = new PersistentBrowserCdpSessionPool();
  const contents = new FakeContents(7, 700);
  await pool.ensure(contents);
  await pool.ensure(contents);
  await pool.send(contents, 'Page.getLayoutMetrics');
  await pool.send(contents, 'Accessibility.getFullAXTree');
  assert.equal(contents.debugger.attachCount, 1);
  assert.equal(contents.debugger.detachCount, 0);
  assert.equal(pool.snapshot().ready_count, 1);
  assert.equal(pool.snapshot().attach_per_command, false);
  assert.equal(pool.snapshot().raw_cdp_passthrough, false);
  assert.equal(pool.release(contents), true);
  assert.equal(contents.debugger.detachCount, 1);
});

test('persistent pool forwards instrumentation events and performs one immediate recovery attempt after detach', async () => {
  const pool = new PersistentBrowserCdpSessionPool();
  const contents = new FakeContents(8, 800);
  const events = [];
  const unsubscribe = pool.subscribe(contents, (event) => events.push(event));
  await pool.ensure(contents);
  contents.debugger.push('Page.lifecycleEvent', { name: 'networkIdle', frameId: 'f1' });
  assert.equal(events.at(-1).method, 'Page.lifecycleEvent');
  contents.debugger.attached = false;
  contents.debugger.emit('detach', {}, 'replaced_with_devtools');
  await nextImmediate();
  await nextImmediate();
  assert.ok(contents.debugger.attachCount >= 2);
  assert.ok(events.some((row) => row.method === 'METAENGINE.DebuggerDetached'));
  unsubscribe();
  pool.release(contents);
});

test('semantic plane mirrors all tab targets and applies Accessibility deltas without another capture request', async () => {
  const pool = new PersistentBrowserCdpSessionPool();
  const a = new FakeContents(11, 1100);
  const b = new FakeContents(12, 1200, 'https://chatgpt.com/c/test');
  const plane = new BrowserRealtimeSemanticPlane({
    pool,
    getTargets: () => [
      { tab_id: 'tab_00000000-0000-4000-8000-000000000011', webContents: a },
      { tab_id: 'tab_00000000-0000-4000-8000-000000000012', webContents: b },
    ],
  });
  await plane.start();
  const initial = plane.snapshot({ includeText: true, eventLimit: 0 });
  assert.equal(initial.target_count, 2);
  assert.equal(initial.ready_count, 2);
  assert.equal(initial.persistent_cdp_sessions, true);
  assert.equal(initial.attach_per_command, false);
  assert.match(initial.targets[0].text_excerpt, /hello realtime/);
  assert.equal(initial.targets[0].semantic_targets.find((row) => row.role === 'button').name, 'Send');

  const beforeCalls = a.debugger.calls.filter((row) => row.method === 'Accessibility.getFullAXTree').length;
  a.debugger.push('Accessibility.nodesUpdated', {
    nodes: [{ nodeId: 'button', ignored: false, role: { value: 'button' }, name: { value: 'Stop generating' }, backendDOMNodeId: 11 }],
  });
  const after = plane.target('tab_00000000-0000-4000-8000-000000000011');
  const afterCalls = a.debugger.calls.filter((row) => row.method === 'Accessibility.getFullAXTree').length;
  assert.equal(after.semantic_targets.find((row) => row.role === 'button').name, 'Stop generating');
  assert.equal(afterCalls, beforeCalls, 'AX delta should update the hot mirror without a full recapture');
  plane.stop();
});

test('DOM mutation bursts coalesce into one timer-free refresh frontier', async () => {
  const pool = new PersistentBrowserCdpSessionPool();
  const contents = new FakeContents(21, 2100);
  const tabId = 'tab_00000000-0000-4000-8000-000000000021';
  const plane = new BrowserRealtimeSemanticPlane({ pool, getTargets: () => [{ tab_id: tabId, webContents: contents }] });
  await plane.start();
  const before = contents.debugger.calls.filter((row) => row.method === 'Accessibility.getFullAXTree').length;
  for (let i = 0; i < 50; i += 1) contents.debugger.push('DOM.characterDataModified', { nodeId: i + 1, characterData: `v${i}` });
  await nextImmediate();
  await nextImmediate();
  const after = contents.debugger.calls.filter((row) => row.method === 'Accessibility.getFullAXTree').length;
  assert.equal(after, before + 1);
  const snapshot = plane.snapshot({ eventLimit: 128 });
  assert.equal(snapshot.refresh_coalescing, 'ONE_IN_FLIGHT_PLUS_ONE_PENDING_NO_TIMER');
  assert.equal(snapshot.second_scheduler, false);
  assert.ok(snapshot.events.some((row) => row.method === 'DOM.characterDataModified'));
  assert.equal(snapshot.events.at(-1).raw_params_exposed, false);
  plane.stop();
});

test('network/runtime telemetry is live but does not expose headers, bodies or raw CDP payloads', async () => {
  const pool = new PersistentBrowserCdpSessionPool();
  const contents = new FakeContents(31, 3100);
  const tabId = 'tab_00000000-0000-4000-8000-000000000031';
  const plane = new BrowserRealtimeSemanticPlane({ pool, getTargets: () => [{ tab_id: tabId, webContents: contents }] });
  await plane.start();
  contents.debugger.push('Runtime.executionContextCreated', { context: { id: 9, origin: 'https://chatgpt.com', name: 'main' } });
  contents.debugger.push('Network.requestWillBeSent', { requestId: 'r1', type: 'Fetch', request: { url: 'https://chatgpt.com/backend-api/test', method: 'GET', headers: { authorization: 'secret' }, postData: 'secret' } });
  contents.debugger.push('Network.webSocketCreated', { requestId: 'ws1', url: 'wss://chatgpt.com/ws' });
  const target = plane.target(tabId);
  assert.equal(target.runtime_context_count, 1);
  assert.equal(target.network_inflight_count, 1);
  assert.equal(target.websocket_count, 1);
  const event = plane.snapshot({ eventLimit: 32 }).events.find((row) => row.method === 'Network.requestWillBeSent');
  assert.equal(event.url, 'https://chatgpt.com/backend-api/test');
  assert.equal('headers' in event, false);
  assert.equal('postData' in event, false);
  assert.equal(event.raw_params_exposed, false);
  assert.equal(plane.snapshot().raw_cdp_passthrough, false);
  plane.stop();
});
