import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';
import { BrowserRealtimeSemanticPlane } from '../src/browser-realtime-semantic-plane.mjs';
import { BrowserRuntimeBindingIndex } from '../src/browser-runtime-binding-index.mjs';
import { ExactBrowserTabViewMap, clearWebContentsTabIndex } from '../src/browser-webcontents-tab-index.mjs';
import { PersistentBrowserCdpSessionPool } from '../src/browser-persistent-cdp-session.mjs';
import { BrowserCellContinuityIntegrationW41 } from '../src/browsercell-continuity-integration-w41.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000041';
const CELL = 'client:worker:41';
const ROOT = 'CDP-root-W41';
const BASE = Date.parse('2026-10-14T22:00:00.000Z');

class FakeDebugger extends EventEmitter {
  attached = false;
  calls = [];
  isAttached() { return this.attached; }
  attach() { this.attached = true; }
  detach() { this.attached = false; this.emit('detach', {}, 'target_closed'); }
  async sendCommand(method) {
    this.calls.push(method);
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    return {};
  }
}
class FakeWebContents extends EventEmitter {
  constructor(id = 7, target = ROOT) {
    super();
    this.id = id;
    this.target = target;
    this.pid = 341;
    this.dead = false;
    this.debugger = new FakeDebugger();
  }
  isDestroyed() { return this.dead; }
  isCrashed() { return false; }
  getOSProcessId() { return this.pid; }
  getOrCreateDevToolsTargetId() { return this.target; }
  getType() { return 'window'; }
  getURL() { return 'secret://never-expose-page'; }
  getTitle() { return 'never-expose-title'; }
}

async function harness() {
  clearWebContentsTabIndex();
  let now = BASE;
  let birth = 1725000000041;
  let wc = new FakeWebContents();
  let metricsAvailable = true;
  const app = new EventEmitter();
  app.getAppMetrics = () => metricsAvailable
    ? [{ pid: wc.pid, creationTime: birth, type: 'Tab', name: 'secret process' }] : [];
  const views = new ExactBrowserTabViewMap();
  views.set(TAB, { webContents: wc });
  const cells = new Map([[TAB, { cell_id: CELL, cell_generation: 4,
    secret: 'never-expose-cell' }]]);
  const index = new BrowserRuntimeBindingIndex({ clock: () => now });
  const pool = new PersistentBrowserCdpSessionPool();
  const brain = {
    observeEdge(event, { process_snapshot, cell_by_tab } = {}) {
      if (event?.type === 'METRICS_SAMPLE' || event?.type === 'PROCESS_CENSUS_REFRESHED') {
        index.reconcile({ tabs: [{ tab_id: TAB }], process_snapshot, cell_by_tab });
      }
      if (['WEB_CONTENTS_DESTROYED','RENDER_PROCESS_GONE'].includes(event?.type)) {
        index.applyLifecycleEvent(event);
      }
      return Object.freeze({ authority_effect: false });
    },
    binding: (tabId, opts) => index.resolveTab(tabId, opts),
    snapshot: () => Object.freeze({}),
    pressureBudget: () => Object.freeze({}),
  };
  let integration = null;
  const plane = new BrowserRealtimeProcessPlane({
    app, brainCoordinator: brain, sampleMs: 5000, clock: () => now,
    getWebContents: () => [wc],
    resolveBrowserCell: (tabId) => cells.get(tabId) || null,
    onChange: (event, source) => integration?.observe(event, source),
  });
  const newBinding = () => {
    const cdp = pool.identity(wc);
    return index.bind({
      tab_id: TAB, cell_id: CELL, cell_generation: cells.get(TAB).cell_generation,
      web_contents_id: wc.id, renderer_pid: wc.pid,
      renderer_process_key: `${wc.pid}:${birth}`,
      target_id: cdp?.target_id || ROOT,
      document_generation: cdp?.document_generation ?? 1,
    });
  };
  const observePool = (source) => pool.subscribe(source, (envelope) => {
    const event = Object.freeze({
      type: 'SEMANTIC_EVENT', tab_id: TAB,
      web_contents_id: envelope.web_contents_id, target_id: envelope.target_id,
      semantic_method: envelope.method, root_session: envelope.root_session,
      cdp_attachment_generation: envelope.attachment_generation,
      cdp_binding_generation: envelope.binding_generation,
      cdp_document_generation: envelope.document_generation,
      authority_effect: false,
    });
    integration?.observe(event, source);
  });
  await pool.ensure(wc); // Only test setup against a fake debugger.
  plane.refresh('METRICS_SAMPLE');
  newBinding();
  integration = new BrowserCellContinuityIntegrationW41({
    views, cells, processPlane: plane, cdpPool: pool,
    clock: () => now, maxAgeMs: 1000, maxCells: 2,
  });
  const unsubscribe = observePool(wc);
  return {
    get wc() { return wc; }, views, cells, pool, index, plane, integration,
    newBinding, unsubscribe,
    setBirth(value) { birth = value; },
    setMetricsAvailable(value) { metricsAvailable = value; },
    advance(ms) { now += ms; },
    tick() { plane.refresh('METRICS_SAMPLE'); },
    async replace({ id = 7, pid = 341, birthMs = 1725000001041, target = ROOT } = {}) {
      unsubscribe();
      wc = new FakeWebContents(id, target);
      wc.pid = pid;
      birth = birthMs;
      views.set(TAB, { webContents: wc });
      await pool.ensure(wc);
      plane.refresh('METRICS_SAMPLE');
      newBinding();
      observePool(wc);
      return wc;
    },
  };
}

test('W41 joins actual tab index, Brain binding, Electron census and existing CDP pool without Send', async () => {
  const f = await harness();
  const witness = f.integration.read(TAB);
  assert.equal(witness.state, 'BOUND_READ_ONLY');
  assert.equal(witness.renderer_process_key, '341:1725000000041');
  assert.equal(witness.cdp_attachment_generation, 1);
  assert.equal(f.integration.isCurrent(witness), true);
  assert.equal(f.integration.snapshot().tracked_cell_count, 1);
  assert.equal(f.integration.snapshot().new_registry, false);
  assert.equal(witness.send_allowed, false);
  assert.equal(f.pool.identity(f.wc).attached, true);
  const output = JSON.stringify(witness) + JSON.stringify(f.integration.snapshot());
  for (const secret of ['secret://', 'never-expose-cell', 'never-expose-title']) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(f.wc.debugger.calls.some((v) => v.startsWith('Input.') || v === 'Runtime.evaluate'), false);
});

test('W41 real CDP root navigation invalidates old witness, then accepts a newly bound document', async () => {
  const f = await harness();
  const before = f.integration.read(TAB);
  f.wc.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main-frame' } });
  assert.equal(f.integration.isCurrent(before), false);
  assert.equal(f.integration.snapshot().tracked_cell_count, 0);
  f.newBinding();
  const after = f.integration.read(TAB);
  assert.equal(after.state, 'BOUND_READ_ONLY');
  assert.equal(after.document_generation, before.document_generation + 1);
  assert.equal(f.integration.isCurrent(before), false);
});

test('W41 exact CDP detach fences old binding; reattach must establish a new generation', async () => {
  const f = await harness();
  const before = f.integration.read(TAB);
  f.wc.debugger.detach();
  assert.equal(f.integration.isCurrent(before), false);
  assert.equal(f.integration.snapshot().tracked_cell_count, 0);
  // Pool re-attach is a preexisting CDP recovery path, not invoked by W41.
  await f.pool.ensure(f.wc);
  f.newBinding();
  const after = f.integration.read(TAB);
  assert.equal(after.state, 'BOUND_READ_ONLY');
  assert.ok(after.cdp_attachment_generation > before.cdp_attachment_generation);
});

test('W41 recycled renderer PID, new process creationTime and missing census fail closed', async () => {
  const f = await harness();
  const old = f.integration.read(TAB);
  f.setBirth(1725000001099); // identical PID, different OS process birth
  f.tick();
  assert.equal(f.integration.isCurrent(old), false);
  const stale = f.integration.read(TAB);
  assert.notEqual(stale.state, 'BOUND_READ_ONLY');
  f.newBinding();
  assert.equal(f.integration.read(TAB).state, 'BOUND_READ_ONLY');
  f.setMetricsAvailable(false);
  f.tick();
  assert.notEqual(f.integration.read(TAB).state, 'BOUND_READ_ONLY');
});

test('W41 late event from old WebContents cannot fence same-ID successor', async () => {
  const f = await harness();
  const oldWC = f.wc;
  const old = f.integration.read(TAB);
  const successor = await f.replace();
  const next = f.integration.read(TAB);
  assert.equal(next.state, 'BOUND_READ_ONLY');
  assert.equal(f.integration.isCurrent(old), false);
  assert.equal(f.integration.observe({
    type: 'WEB_CONTENTS_DESTROYED', tab_id: TAB,
    web_contents_id: old.web_contents_id,
  }, oldWC).accepted, false);
  assert.equal(f.integration.isCurrent(next), true);
  assert.equal(f.integration.observe({
    type: 'SEMANTIC_EVENT', tab_id: TAB,
    web_contents_id: old.web_contents_id, target_id: old.target_id,
    semantic_method: 'Page.frameNavigated', root_session: true,
    cdp_attachment_generation: old.cdp_attachment_generation,
    cdp_binding_generation: old.cdp_binding_generation + 1,
    cdp_document_generation: old.document_generation + 1,
  }, oldWC).accepted, false);
  assert.equal(f.integration.isCurrent(next), true);
  assert.notEqual(successor, oldWC);
});

test('W41 late same-object CDP event from old attachment cannot poison successor', async () => {
  const f = await harness();
  const old = f.integration.read(TAB);
  // Detach and reattach on the *same* WebContents object.
  f.wc.debugger.detach();
  await f.pool.ensure(f.wc);
  f.newBinding();
  const successor = f.integration.read(TAB);
  assert.equal(successor.state, 'BOUND_READ_ONLY');
  assert.equal(f.integration.observe({
    type: 'SEMANTIC_EVENT', tab_id: TAB, web_contents_id: old.web_contents_id,
    target_id: old.target_id, semantic_method: 'Page.frameNavigated',
    root_session: true, cdp_attachment_generation: old.cdp_attachment_generation,
    cdp_binding_generation: old.cdp_binding_generation + 1,
    cdp_document_generation: old.document_generation + 1,
  }, f.wc).accepted, false);
  assert.equal(f.integration.isCurrent(successor), true);
});

test('W41 missing native root-target match or unproven renderer death never grants authority', async () => {
  const f = await harness();
  const old = f.integration.read(TAB);
  assert.equal(f.integration.observe({
    type: 'RENDER_PROCESS_GONE', tab_id: TAB,
    web_contents_id: old.web_contents_id, os_pid: old.renderer_pid,
  }, f.wc).reason, 'OLD_RENDERER_BIRTH_UNPROVEN');
  assert.equal(f.integration.isCurrent(old), true);
  f.index.bind({
    tab_id: TAB, cell_id: CELL, cell_generation: 4,
    web_contents_id: 7, renderer_pid: 341,
    renderer_process_key: old.renderer_process_key,
    target_id: 'wrong-root-target', document_generation: old.document_generation,
  });
  assert.equal(f.integration.read(TAB).reason, 'CDP_ROOT_TARGET_UNVERIFIED');
  assert.equal(f.integration.isCurrent(old), false);
});

test('W41 bounded state revokes witnesses when native census becomes stale', async () => {
  const f = await harness();
  const prior = f.integration.read(TAB);
  f.advance(1001);
  assert.equal(f.integration.read(TAB).reason, 'PROCESS_CENSUS_MISSING_OR_STALE');
  assert.equal(f.integration.isCurrent(prior), false);
  assert.equal(f.integration.snapshot().tracked_cell_count, 0);
  assert.equal(f.integration.snapshot().max_cells, 2);
});

test('W41 real native render-process-gone event invalidates Brain binding with no fabricated birth proof', async () => {
  const f = await harness();
  const witness = f.integration.read(TAB);
  f.wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(f.integration.isCurrent(witness), false);
  // The existing census refresh may reconstruct only a placeholder Brain target.
  // W41 must reject that provisional row rather than promote it as a root CDP binding.
  assert.equal(f.index.resolveTab(TAB)?.target_id, 'webcontents:7');
  assert.equal(f.integration.read(TAB).reason, 'CDP_ROOT_TARGET_UNVERIFIED');
});

test('W41 real semantic-plane CDP callback carries in-process object and root lifetime', async () => {
  const f = await harness();
  const observations = [];
  const semantic = new BrowserRealtimeSemanticPlane({
    pool: f.pool,
    getTargets: () => [{ tab_id: TAB, webContents: f.wc }],
    onChange: (e, nativeSource) => {
      observations.push({ e, nativeSource });
      f.integration.observe({
        type: 'SEMANTIC_EVENT', tab_id: e.tab_id,
        web_contents_id: e.web_contents_id, target_id: e.target_id,
        semantic_method: e.method, root_session: e.root_session,
        cdp_attachment_generation: e.cdp_attachment_generation,
        cdp_binding_generation: e.cdp_binding_generation,
        cdp_document_generation: e.cdp_document_generation,
      }, nativeSource);
    },
  });
  await semantic.start();
  const witness = f.integration.read(TAB);
  f.wc.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main-frame' } });
  assert.ok(observations.some(({ e, nativeSource }) =>
    e.method === 'Page.frameNavigated'
    && e.root_session === true
    && Number.isSafeInteger(e.cdp_attachment_generation)
    && nativeSource === f.wc));
  assert.equal(f.integration.isCurrent(witness), false);
  await semantic.stop();
});
