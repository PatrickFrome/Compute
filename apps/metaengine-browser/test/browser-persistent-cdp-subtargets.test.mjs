import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { PersistentBrowserCdpSessionPool } from '../src/browser-persistent-cdp-session.mjs';

class FakeDebugger extends EventEmitter {
  attached = false;
  attachCalls = 0;
  detachCalls = 0;
  calls = [];
  failTargetAutoAttach = false;

  isAttached() { return this.attached; }

  attach() {
    this.attachCalls += 1;
    this.attached = true;
  }

  detach() {
    this.detachCalls += 1;
    this.attached = false;
    this.emit('detach', {}, 'target closed');
  }

  async sendCommand(method, params = {}, sessionId = undefined) {
    this.calls.push({ method, params, sessionId: sessionId || null });
    if (method === 'Target.setAutoAttach' && this.failTargetAutoAttach) {
      throw new Error('Target domain unavailable');
    }
    return {};
  }
}

class FakeWebContents extends EventEmitter {
  constructor(id = 701, debuggerInstance = new FakeDebugger()) {
    super();
    this.id = id;
    this.debugger = debuggerInstance;
  }

  isDestroyed() { return false; }
  getOSProcessId() { return 1701; }
  getOrCreateDevToolsTargetId() { return `root-target-${this.id}`; }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('persistent auto-attach sees nested related targets without contaminating root document generation', async () => {
  const dbg = new FakeDebugger();
  const wc = new FakeWebContents(701, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  const events = [];

  await pool.ensure(wc);
  pool.subscribe(wc, (event) => events.push(event));

  const initial = pool.identity(wc);
  assert.equal(initial.document_generation, 1);
  assert.equal(initial.target_auto_attach_enabled, true);
  assert.equal(initial.target_auto_attach_flatten, true);
  assert.equal(initial.target_wait_for_debugger_on_start, false);
  assert.equal(dbg.attachCalls, 1);

  dbg.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'session-worker',
    targetInfo: {
      targetId: 'target-worker',
      type: 'worker',
      url: 'https://chatgpt.com/worker.js',
      title: 'worker',
    },
    waitingForDebugger: false,
  }, null);
  await nextTurn();

  let snapshot = pool.snapshot();
  assert.equal(snapshot.subtarget_count, 1);
  assert.equal(snapshot.sessions[0].subtargets[0].target_id, 'target-worker');
  assert.equal(snapshot.sessions[0].subtargets[0].parent_target_id, null);
  assert.equal(snapshot.sessions[0].subtargets[0].nested_auto_attach, true);
  assert.ok(dbg.calls.some((call) => call.method === 'Target.setAutoAttach' && call.sessionId === 'session-worker'));

  dbg.emit('message', {}, 'DOM.documentUpdated', {}, 'session-worker');
  assert.equal(pool.identity(wc).document_generation, 1);
  assert.equal(events.filter((event) => event.method === 'DOM.documentUpdated').length, 0);

  dbg.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'session-iframe',
    targetInfo: {
      targetId: 'target-iframe',
      type: 'iframe',
      url: 'https://chatgpt.com/embedded',
      title: 'iframe',
    },
    waitingForDebugger: false,
  }, 'session-worker');
  await nextTurn();

  snapshot = pool.snapshot();
  assert.equal(snapshot.subtarget_count, 2);
  const iframe = snapshot.sessions[0].subtargets.find((row) => row.target_id === 'target-iframe');
  assert.equal(iframe.parent_session_id, 'session-worker');
  assert.equal(iframe.parent_target_id, 'target-worker');
  assert.equal(iframe.nested_auto_attach, true);

  dbg.emit('message', {}, 'Inspector.targetCrashed', {}, 'session-iframe');
  snapshot = pool.snapshot();
  assert.equal(snapshot.subtarget_count, 1);
  assert.equal(snapshot.sessions[0].subtargets[0].target_id, 'target-worker');
  assert.ok(events.some((event) => event.method === 'METAENGINE.SubtargetCrashed'));

  dbg.emit('message', {}, 'DOM.documentUpdated', {}, null);
  assert.equal(pool.identity(wc).document_generation, 2);
  assert.equal(events.filter((event) => event.method === 'DOM.documentUpdated').length, 1);

  await pool.ensure(wc);
  assert.equal(dbg.attachCalls, 1);
  assert.equal(dbg.detachCalls, 0);
  pool.release(wc);
  assert.equal(dbg.detachCalls, 1);
});

test('Target auto-attach is fail-soft and never blocks the root persistent CDP session', async () => {
  const dbg = new FakeDebugger();
  dbg.failTargetAutoAttach = true;
  const wc = new FakeWebContents(702, dbg);
  const pool = new PersistentBrowserCdpSessionPool();

  const ready = await pool.ensure(wc);
  assert.equal(ready.ready, true);
  assert.equal(ready.attached, true);
  assert.equal(ready.target_auto_attach_enabled, false);
  assert.match(ready.target_auto_attach_last_error, /Target domain unavailable/);
  assert.equal(ready.document_generation, 1);
  assert.equal(ready.raw_cdp_passthrough, false);
  assert.equal(ready.command_leasing, false);
  assert.equal(dbg.attachCalls, 1);

  pool.release(wc);
});
