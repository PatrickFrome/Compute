import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';

import { BrowserCognitiveDeltaBus } from '../src/browser-cognitive-delta-bus.mjs';
import {
  BROWSER_COGNITIVE_PORT_ACK_SCHEMA,
  BROWSER_COGNITIVE_PORT_BATCH_SCHEMA,
  BROWSER_COGNITIVE_PORT_HELLO_SCHEMA,
  BROWSER_COGNITIVE_PORT_READY_SCHEMA,
  BROWSER_COGNITIVE_PORT_RESYNC_SCHEMA,
  BrowserCognitiveMessagePortHub,
} from '../src/browser-cognitive-message-port-hub.mjs';

class FakePort extends EventEmitter {
  sent = [];
  started = 0;
  closed = false;

  postMessage(value) { this.sent.push(structuredClone(value)); }
  start() { this.started += 1; }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  receive(data) { this.emit('message', { data }); }
}

function ready(port) {
  const hello = port.sent.find((row) => row.schema === BROWSER_COGNITIVE_PORT_HELLO_SCHEMA);
  port.receive({
    schema: BROWSER_COGNITIVE_PORT_READY_SCHEMA,
    stream_id: hello.stream_id,
    through_sequence: hello.latest_sequence,
    baseline_confirmed: true,
    authority_effect: false,
  });
  return hello;
}

test('long-lived port streams bounded batches with one ACK window and no per-edge snapshot', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 32 });
  const hub = new BrowserCognitiveMessagePortHub({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    batchSize: 4,
  });
  const port = new FakePort();
  const attached = hub.attach(port);
  assert.equal(port.started, 1);
  assert.equal(attached.ready, false);
  const hello = ready(port);
  assert.equal(hello.baseline_required, true);

  bus.publish({ seq: 1, type: 'WEB_CONTENTS_CREATED', web_contents_id: 7 });
  hub.notify();
  const first = port.sent.find((row) => row.schema === BROWSER_COGNITIVE_PORT_BATCH_SCHEMA);
  assert.equal(first.event_count, 1);
  assert.equal(first.after_sequence, hello.latest_sequence);
  assert.equal(first.raw_payload_exposed, false);
  assert.equal(first.control_authority, false);

  bus.publish({ seq: 2, type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated' });
  hub.notify();
  assert.equal(port.sent.filter((row) => row.schema === BROWSER_COGNITIVE_PORT_BATCH_SCHEMA).length, 1);

  port.receive({
    schema: BROWSER_COGNITIVE_PORT_ACK_SCHEMA,
    stream_id: first.stream_id,
    through_sequence: first.through_sequence,
    authority_effect: false,
  });
  const batches = port.sent.filter((row) => row.schema === BROWSER_COGNITIVE_PORT_BATCH_SCHEMA);
  assert.equal(batches.length, 2);
  assert.equal(batches[1].after_sequence, first.through_sequence);
  assert.equal(hub.snapshot().per_consumer_ack_window, 1);
  assert.equal(hub.snapshot().pending_state_bounded_to_boolean, true);
  assert.equal(hub.snapshot().full_snapshot_only_on_attach_or_gap, true);
  assert.equal(hub.snapshot().dedicated_timer, false);
  assert.equal(hub.snapshot().second_scheduler, false);
  hub.closeAll();
});

test('slow consumer gets explicit resync instead of an unbounded hidden queue', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8 });
  const hub = new BrowserCognitiveMessagePortHub({ readDeltas: (after, limit) => bus.readSince(after, limit) });
  const port = new FakePort();
  hub.attach(port);
  ready(port);

  for (let i = 0; i < 8; i += 1) bus.publish({ seq: i + 1, type: 'WEB_CONTENTS_DESTROYED' });
  bus.publish({ seq: 9, type: 'METRICS_SAMPLE' });
  bus.publish({ seq: 10, type: 'WEB_CONTENTS_CREATED' });
  hub.notify();

  const resync = port.sent.find((row) => row.schema === BROWSER_COGNITIVE_PORT_RESYNC_SCHEMA);
  assert.ok(resync);
  assert.equal(resync.full_snapshot_required, true);
  assert.equal(resync.reason, 'DELTA_GAP');
  assert.equal(resync.command_leasing, false);
  assert.equal(hub.snapshot().resync_count, 1);
  hub.closeAll();
});

test('consumer capacity and close lifecycle are bounded', () => {
  const bus = new BrowserCognitiveDeltaBus();
  const hub = new BrowserCognitiveMessagePortHub({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    maxConsumers: 1,
  });
  const first = new FakePort();
  hub.attach(first);
  assert.throws(() => hub.attach(new FakePort()), /capacity_exceeded/);
  first.close();
  assert.equal(hub.snapshot().consumer_count, 0);
  assert.equal(hub.snapshot().detached_count, 1);
});

test('main and isolated preload use transferable MessagePorts, not per-delta IPC snapshots', () => {
  const main = fs.readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(main, /new MessageChannelMain\(\)/);
  assert.match(main, /webContents\.postMessage\('metaengine:brain:port'/);
  assert.match(main, /nativeSupervisor\.detachCognitiveMessagePort\(attached\.consumer_id\)/);
  assert.match(preload, /event\?\.ports\?\.\[0\]/);
  assert.match(preload, /metaengine\.browser\.cognitive-port-ack\.v1/);
  assert.match(preload, /onBrainDelta/);
  assert.match(client, /this\.#cognitivePortHub\?\.notify\(\)/);
  assert.doesNotMatch(client, /setInterval[^\n]*cognitivePort/i);
});
