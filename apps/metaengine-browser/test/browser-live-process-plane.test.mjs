import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserLiveProcessPlane, bindBrowserLiveProcessPlaneEvents } from '../src/browser-live-process-plane.mjs';

function fakeContents(id, { url = 'https://chat.z.ai/', title = 'GLM', type = 'window' } = {}) {
  const emitter = new EventEmitter();
  emitter.id = id;
  emitter.getType = () => type;
  emitter.getURL = () => url;
  emitter.getTitle = () => title;
  emitter.isLoading = () => false;
  emitter.isLoadingMainFrame = () => false;
  emitter.isWaitingForResponse = () => false;
  emitter.isDestroyed = () => false;
  return emitter;
}

test('live process plane exposes every app process and webcontents without page body authority', () => {
  const contents = [fakeContents(7), fakeContents(9, { url: 'https://chatgpt.com/', title: 'ChatGPT' })];
  const plane = new BrowserLiveProcessPlane({
    getAppMetrics: () => [
      { pid: 22, type: 'Tab', creationTime: 10, cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 128 } },
      { pid: 11, type: 'Browser', creationTime: 1, cpu: { percentCPUUsage: 2.5 }, memory: { workingSetSize: 256 } },
    ],
    getWebContents: () => contents,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });
  const snap = plane.refresh('TEST');
  assert.equal(snap.schema, 'metaengine.browser.live-process-plane.v1');
  assert.deepEqual(snap.processes.map((row) => row.pid), [11, 22]);
  assert.deepEqual(snap.webcontents.map((row) => row.webcontents_id), [7, 9]);
  assert.equal(snap.webcontents[0].url, 'https://chat.z.ai/');
  assert.equal(snap.page_body_exposed, false);
  assert.equal(snap.command_authority, false);
  assert.equal(snap.scheduler_authority, false);
  assert.equal(snap.polling_loop, false);
  assert.equal(snap.authority_effect, false);
});

test('event binding updates the same mirror immediately on Chromium lifecycle events', () => {
  const app = new EventEmitter();
  const first = fakeContents(1);
  const rows = [first];
  const plane = new BrowserLiveProcessPlane({
    getAppMetrics: () => [{ pid: 100, type: 'Browser', cpu: {}, memory: {} }],
    getWebContents: () => rows,
  });
  bindBrowserLiveProcessPlaneEvents({
    app,
    webContentsModule: { getAllWebContents: () => rows },
    plane,
  });
  const before = plane.snapshot().sequence;
  first.emit('did-start-loading');
  const afterLoading = plane.snapshot();
  assert.ok(afterLoading.sequence > before);
  assert.equal(afterLoading.events.at(-2).kind, 'WEB_CONTENTS_LOADING');
  assert.equal(afterLoading.events.at(-1).kind, 'CENSUS_REFRESH');

  const second = fakeContents(2, { url: 'https://chatgpt.com/' });
  rows.push(second);
  app.emit('web-contents-created', {}, second);
  const afterCreate = plane.snapshot();
  assert.equal(afterCreate.webcontents_count, 2);
  assert.ok(afterCreate.events.some((event) => event.kind === 'WEB_CONTENTS_CREATED' && event.details.webcontents_id === 2));
});

test('event buffer is bounded and carries no control authority', () => {
  const plane = new BrowserLiveProcessPlane({
    getAppMetrics: () => [],
    getWebContents: () => [],
    maxEvents: 32,
  });
  for (let i = 0; i < 80; i += 1) plane.record('TEST_EVENT', { i });
  const snap = plane.snapshot({ eventLimit: 32 });
  assert.equal(snap.event_buffer_size, 32);
  assert.equal(snap.events.length, 32);
  assert.equal(snap.events.at(-1).details.i, 79);
  assert.equal(snap.events.every((event) => event.control_authority === false && event.authority_effect === false), true);
});
