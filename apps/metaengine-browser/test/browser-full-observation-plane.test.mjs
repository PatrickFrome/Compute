import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserFullObservationPlane } from '../src/browser-full-observation-plane.mjs';

const TAB_A = 'tab_11111111-1111-4111-8111-111111111111';
const TAB_B = 'tab_22222222-2222-4222-8222-222222222222';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function frame(tabId) {
  return {
    schema: 'metaengine.native-browser.capture-thumbnail.v1',
    captured_at: '2026-09-14T00:00:00.000Z',
    url: `https://example.test/${tabId}`,
    title: tabId,
    source_width: 1280,
    source_height: 720,
    capture_backend: 'ELECTRON_CAPTURE_PAGE',
    detached_surface_fallback: false,
    capture_from_surface: true,
    jpeg_bytes: JPEG.byteLength,
    sha256: 'a'.repeat(64),
    jpeg_base64: JPEG.toString('base64'),
    authority_effect: false,
  };
}

test('full observation keeps verified JPEG keyframes across tab switches', async () => {
  let now = Date.parse('2026-09-14T00:00:00.000Z');
  let selected = TAB_A;
  const captures = [];
  const plane = new BrowserFullObservationPlane({
    clock: () => now,
    minCaptureIntervalMs: 100,
    getState: async () => ({
      tabs: { selected_tab_id: selected, tabs: [{ tab_id: TAB_A }, { tab_id: TAB_B }] },
      active_tab: { tab_id: selected },
      perception: { tab_id: selected },
    }),
    getProcessSnapshot: ({ eventLimit }) => ({ schema: 'process', eventLimit, authority_effect: false }),
    getSemanticSnapshot: ({ includeText, eventLimit }) => ({
      schema: 'semantic',
      eventLimit,
      includeText,
      targets: [
        { tab_id: TAB_A, text_excerpt: 'page-a' },
        { tab_id: 'webcontents:7', text_excerpt: 'METAENGINE shell UI' },
      ],
      authority_effect: false,
    }),
    captureView: async (tabId) => {
      captures.push(tabId);
      return frame(tabId);
    },
  });

  await plane.captureSelected({ reason: 'BOOT', force: true });
  assert.equal(captures.at(-1), TAB_A);
  assert.equal(plane.frame(TAB_A, { includeJpeg: true }).jpeg_base64, JPEG.toString('base64'));

  selected = TAB_B;
  now += 200;
  await plane.captureSelected({ reason: 'SELECT_TAB', force: true });
  assert.equal(captures.at(-1), TAB_B);
  assert.equal(plane.frame(TAB_A, { includeJpeg: true }).jpeg_base64, JPEG.toString('base64'));
  assert.equal(plane.frame(TAB_B, { includeJpeg: true }).jpeg_base64, JPEG.toString('base64'));

  const snapshot = await plane.fullSnapshot({ includeJpeg: true, tabId: TAB_A, includeText: true });
  assert.equal(snapshot.schema, 'metaengine.browser.full-observation.v1');
  assert.equal(snapshot.selected_tab_id, TAB_B);
  assert.equal(snapshot.requested_tab_id, TAB_A);
  assert.equal(snapshot.visual.requested_frame.tab_id, TAB_A);
  assert.equal(snapshot.visual.requested_frame.jpeg_base64, JPEG.toString('base64'));
  assert.equal(snapshot.visual.detached_tabs_use_last_verified_keyframe, true);
  assert.equal(snapshot.shell_ui_semantic_targets, 1);
  assert.equal(snapshot.page_text_exposed, true);
  assert.equal(snapshot.input_values_exposed, false);
  assert.equal(snapshot.secret_fields_exposed, false);
});

test('full observation coalesces visual capture pressure instead of polling', async () => {
  let now = 10_000;
  let captures = 0;
  const plane = new BrowserFullObservationPlane({
    clock: () => now,
    minCaptureIntervalMs: 100,
    getState: async () => ({ active_tab: { tab_id: TAB_A } }),
    getProcessSnapshot: () => ({}),
    getSemanticSnapshot: () => ({ targets: [] }),
    captureView: async () => {
      captures += 1;
      return frame(TAB_A);
    },
  });

  await plane.captureSelected({ reason: 'INITIAL', force: true });
  assert.equal(captures, 1);
  plane.scheduleVisualCapture('A');
  plane.scheduleVisualCapture('B');
  assert.equal(plane.snapshot().capture_scheduled, true);
  plane.stop();
  assert.equal(plane.snapshot().capture_scheduled, false);
  assert.equal(plane.snapshot().second_scheduler, false);
});
