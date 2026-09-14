import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import {
  readNativeSupervisorFleetStatus,
  runSupervisorEnrollmentBootstrap,
} from '../src/native-supervisor-client.mjs';
import { BrowserCognitiveDeltaBus } from '../src/browser-cognitive-delta-bus.mjs';
import { projectCognitiveDeltaBatch } from '../supabase/a2-browser-native-supervisor-v1/cognitive-delta-routes.mjs';
import { withTemporaryDetachedCaptureSurface } from '../src/browser-detached-capture-surface.mjs';
import { captureViewThumbnail as captureActivatedViewThumbnail } from '../src/native-browser-control-activated.mjs';
import { BrowserRealtimeProcessPlane as ActivatedBrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane-activated.mjs';

test('enrollment bootstrap exposes no control authority while approval is pending', async () => {
  let calls = 0;
  const result = await runSupervisorEnrollmentBootstrap({
    async ensureEnrollment() {
      calls += 1;
      return { status: 'PENDING_APPROVAL', request_id: '00000000-0000-4000-8000-000000000001', device_id: null };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'PENDING_APPROVAL');
  assert.equal(result.device_id, null);
  assert.equal(result.command_leasing, false);
  assert.equal(result.browser_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.second_polling_loop, false);
  assert.equal(result.authority_effect, false);
});

test('enrollment bootstrap reports an already-approved device without granting command authority itself', async () => {
  const result = await runSupervisorEnrollmentBootstrap({
    async ensureEnrollment() {
      return {
        status: 'APPROVED',
        request_id: '00000000-0000-4000-8000-000000000001',
        device_id: '00000000-0000-4000-8000-000000000002',
      };
    },
  });
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.device_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(result.command_leasing, false);
  assert.equal(result.browser_authority, false);
});

test('targetless fleet status reads trusted local state without requiring a browser view', async () => {
  const fleet = {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    counts: { ACTIVE: 0, REGISTERED: 0 },
    agents: [],
    authority_effect: false,
  };
  const result = await readNativeSupervisorFleetStatus(async () => ({ fleet }));
  assert.deepEqual(result, fleet);
  assert.notEqual(result, fleet);

  const source = await readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  const interceptIndex = source.indexOf("if (action === 'FLEET_STATUS') return readNativeSupervisorFleetStatus(sourceGetState);");
  const projectionIndex = source.indexOf('const projected = exactCommandTargetProjection(command);');
  assert.ok(interceptIndex >= 0 && interceptIndex < projectionIndex, 'FLEET_STATUS must bypass target-view routing');
});

test('fleet reconcile performs bounded cleanup before reconcile and reports its physical cleanup count', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const blockStart = source.indexOf("if (command === 'FLEET_RECONCILE') {");
  const blockEnd = source.indexOf("if (command === 'FLEET_SET_PROFILE')", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  const block = source.slice(blockStart, blockEnd);
  const retiredIndex = block.indexOf('const retired = await retireFleetSurplus');
  const sweptIndex = block.indexOf('const sweptOrphans = await sweepOrphanFleetTabs');
  const reconcileIndex = block.indexOf('await fleet?.reconcile({');
  assert.ok(retiredIndex >= 0 && retiredIndex < reconcileIndex, 'retired must be defined before reconcile');
  assert.ok(sweptIndex >= 0 && sweptIndex < reconcileIndex, 'sweptOrphans must be defined before reconcile');
  assert.match(block, /const physicalCleanupCount = retired\.length \+ sweptOrphans\.length;/);
  assert.match(block, /physical_cleanup_count: physicalCleanupCount/);
  assert.doesNotMatch(block, /physical_cleanup_count:\s*retired\.length \+ sweptOrphans\.length[\s\S]*const retired/);
});

test('cognitive deltas preserve absent target identity as null and satisfy the production batch contract', () => {
  const bus = new BrowserCognitiveDeltaBus({
    streamId: '12345678-1234-4123-8123-123456789abc',
    maxEvents: 16,
  });
  const published = bus.publish({ type: 'METRICS_SAMPLE' });
  assert.equal(published.accepted, true);
  assert.equal(published.event.source_sequence, null);
  assert.equal(published.event.web_contents_id, null);
  assert.equal(published.event.os_pid, null);

  const batch = {
    schema: 'metaengine.browser.cognitive-delta-batch.v1',
    stream_id: published.event.stream_id,
    after_sequence: 0,
    through_sequence: 1,
    event_count: 1,
    events: [published.event],
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    delivery_is_authority: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  };
  const projected = projectCognitiveDeltaBatch(JSON.stringify(batch), batch);
  assert.equal(projected.events[0].web_contents_id, null);
  assert.equal(projected.events[0].source_sequence, null);
  assert.equal(projected.authority_effect, false);
});

test('activated realtime process plane restores latest_sequence required by cognitive gap recovery', () => {
  const app = new EventEmitter();
  app.getAppMetrics = () => [];
  const brain = {
    observeEdge: () => null,
    snapshot: () => ({ schema: 'test.brain.v1', authority_effect: false }),
    pressureBudget: () => ({ state: 'NORMAL', authority_effect: false }),
  };
  const pressure = {
    sample: () => ({ state: 'NORMAL', authority_effect: false }),
    snapshot: () => ({ state: 'NORMAL', authority_effect: false }),
  };
  const plane = new ActivatedBrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [],
    brainCoordinator: brain,
    mainLoopPressure: pressure,
  });
  const snapshot = plane.cognitiveSnapshot({ eventsSince: 0, eventLimit: 8 });
  assert.equal(snapshot.latest_sequence, snapshot.sequence);
  assert.equal(snapshot.latest_sequence, 0);
  assert.equal(snapshot.cognitive_gap_recovery_cursor_complete, true);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.control_authority, false);
  assert.equal(snapshot.authority_effect, false);
});

test('public wrapper recovers enrollment through startup and the one existing command cycle only', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  const startIndex = source.indexOf('async start()');
  const processIndex = source.indexOf('await this.#startRealtimeProcessPlane()', startIndex);
  const enrollIndex = source.indexOf('await this.#bootstrapEnrollment()', startIndex);
  const baseStartIndex = source.indexOf('await super.start()', startIndex);
  assert.ok(startIndex >= 0 && processIndex > startIndex, 'startup must initialize observation plane');
  assert.ok(enrollIndex > processIndex, 'enrollment must follow local observation bootstrap');
  assert.ok(baseStartIndex > enrollIndex, 'existing supervisor runtime must start only after bounded enrollment bootstrap');

  const cycleIndex = source.indexOf('async cycle()');
  const cycleEnrollIndex = source.indexOf('await this.#bootstrapEnrollment()', cycleIndex);
  const baseCycleIndex = source.indexOf('await super.cycle()', cycleIndex);
  assert.ok(cycleIndex >= 0 && cycleEnrollIndex > cycleIndex && baseCycleIndex > cycleEnrollIndex);

  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /commands\/next|commands\/wait-batch|lease_batch|executeCommandBatch/);
  assert.match(source, /realtime_process_plane_second_scheduler:\s*false/);
  assert.match(source, /command_leasing:\s*false/);
  assert.match(source, /enrollment_bootstrap_auto_approval:\s*false/);
  assert.match(source, /automatic_retry_allowed:\s*false/);
});

test('hidden exact view gets a temporary capture surface and is restored hidden afterwards', async () => {
  let bounds = { x: 17, y: 23, width: 640, height: 480 };
  let visible = false;
  const events = [];
  const view = {
    webContents: { isDestroyed: () => false },
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      bounds = { ...next };
      events.push(['bounds', { ...next }]);
    },
    getVisible: () => visible,
    setVisible: (next) => {
      visible = next === true;
      events.push(['visible', visible]);
    },
  };
  const host = {
    contentView: {
      addChildView: (candidate) => events.push(['attach', candidate === view]),
      removeChildView: (candidate) => events.push(['detach', candidate === view]),
    },
    close: () => events.push(['close']),
  };

  const result = await withTemporaryDetachedCaptureSurface(
    view,
    async () => {
      assert.equal(visible, true);
      assert.deepEqual(bounds, { x: 0, y: 0, width: 640, height: 480 });
      events.push(['task']);
      return 'captured';
    },
    {
      settleMs: 0,
      createHost: async () => host,
    },
  );

  assert.equal(result, 'captured');
  assert.equal(visible, false);
  assert.deepEqual(bounds, { x: 17, y: 23, width: 640, height: 480 });
  assert.deepEqual(events, [
    ['attach', true],
    ['bounds', { x: 0, y: 0, width: 640, height: 480 }],
    ['visible', true],
    ['task'],
    ['detach', true],
    ['bounds', { x: 17, y: 23, width: 640, height: 480 }],
    ['visible', false],
    ['close'],
  ]);
});

test('activated native browser control routes hidden exact view through the detached lease', async () => {
  const jpeg = Buffer.from('qualified-hidden-view-capture');
  const image = {
    getSize: () => ({ width: 640, height: 480 }),
    resize() { return this; },
    toJPEG: () => jpeg,
  };
  let captureCalls = 0;
  const webContents = {
    id: 73,
    isDestroyed: () => false,
    capturePage: async () => {
      captureCalls += 1;
      return image;
    },
    getURL: () => 'https://example.test/hidden',
    getTitle: () => 'Hidden exact view',
  };
  const exactView = {
    webContents,
    getVisible: () => false,
  };
  let leasedView = null;

  const result = await captureActivatedViewThumbnail(webContents, {
    surfaceExpected: false,
    resolveViewImpl: () => exactView,
    withDetachedSurfaceImpl: async (view, task) => {
      leasedView = view;
      return task();
    },
    maxAttempts: 1,
    retryDelayMs: 0,
  });

  assert.equal(leasedView, exactView);
  assert.equal(captureCalls, 1);
  assert.equal(result.capture_backend, 'ELECTRON_CAPTURE_PAGE');
  assert.equal(result.detached_surface_fallback, true);
  assert.equal(result.temporary_surface_lease, true);
  assert.equal(result.authority_effect, false);
});

test('final runtime activates hidden capture, cognitive cursor completion, and non-blocking ready-edge primary UI bootstrap', async () => {
  const source = await readFile(new URL('../src/final-runtime-entry.mjs', import.meta.url), 'utf8');
  const mainImportIndex = source.indexOf("await import('./main-entry.mjs')");
  const primaryInstanceIndex = source.indexOf('const primaryInstance =', mainImportIndex);
  const initialFunctionIndex = source.indexOf('const requestInitialPrimaryUi = () => {', primaryInstanceIndex);
  const readyArmIndex = source.indexOf("app.once('ready', requestInitialPrimaryUi)", initialFunctionIndex);
  assert.ok(mainImportIndex >= 0, 'main-entry authority import must exist');
  assert.ok(primaryInstanceIndex > mainImportIndex, 'initial UI bootstrap must arm only after main-entry authority has settled');
  assert.ok(initialFunctionIndex > primaryInstanceIndex, 'initial UI bootstrap must use the already-registered primary activate path');
  assert.ok(readyArmIndex > initialFunctionIndex, 'initial UI bootstrap must be triggered by the exact Electron ready edge');
  assert.match(source, /queueMicrotask\(requestInitialPrimaryUi\)/);
  assert.match(source, /timeout_ms:\s*0/);
  assert.doesNotMatch(source, /const initialUiBootstrap = await requestPrimaryWindowResurrection/);
  assert.match(source, /app\.hasSingleInstanceLock\(\) === true/);
  assert.match(source, /native-browser-control-activated\.mjs/);
  assert.match(source, /browser-realtime-process-plane-activated\.mjs/);
  assert.match(source, /context\.parentURL === nativeSupervisorUrl && resolved\.url === realtimeProcessPlaneUrl/);
  assert.match(source, /realtime_process_plane_mode:\s*'PROVEN_RUNTIME_PLUS_COGNITIVE_CURSOR_COMPLETION'/);
  assert.match(source, /native_browser_control_mode:\s*'PROVEN_RUNTIME_PLUS_HIDDEN_VIEW_CAPTURE_ACTIVATION'/);
  assert.match(source, /second_browser_runtime_started:\s*false/);
  assert.match(source, /update_authority_effect:\s*false/);
});
