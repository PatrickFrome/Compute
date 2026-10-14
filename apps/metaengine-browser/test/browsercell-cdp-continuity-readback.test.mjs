import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserCellCdpContinuityReadback,
  BROWSERCELL_CDP_CONTINUITY_SCHEMA,
} from '../src/browsercell-cdp-continuity-readback.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000033';
const NOW = Date.parse('2026-10-14T18:00:00.000Z');
const OBSERVED = new Date(NOW).toISOString();
const processKey = '300:1725000000123';

function fixture() {
  let wc = {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    getOSProcessId: () => 300,
    getURL: () => { throw new Error('must not inspect page URL'); },
  };
  const views = new Map([[TAB, { webContents: wc }]]);
  const cells = new Map([[TAB, {
    cell_id: 'client:worker:33', cell_generation: 2,
    secret: 'never-serialize-cell-secret',
  }]]);
  const census = {
    observed_at: OBSERVED,
    processes: [{
      pid: 300, creation_time_ms: 1725000000123, process_key: processKey,
      process_identity_complete: true, command_line: 'never-serialize-process-secret',
    }],
    web_contents: [{
      tab_id: TAB, web_contents_id: 7, os_pid: 300, destroyed: false,
      title: 'never-serialize-page-secret',
    }],
  };
  const binding = {
    valid: true,
    tab_id: TAB,
    cell_id: 'client:worker:33',
    cell_generation: 2,
    web_contents_id: 7,
    renderer_pid: 300,
    renderer_process_key: processKey,
    renderer_process_identity_complete: true,
    target_id: 'CDP-root-33',
    binding_generation: 4,
    document_generation: 5,
    url: 'never-serialize-url',
  };
  const cdp = {
    web_contents_id: 7, os_pid: 300, ready: true,
    attached: true, event_stream_capable: true,
    target_id: 'CDP-root-33',
    attachment_generation: 2, binding_generation: 3, document_generation: 5,
    subtargets: [{ url: 'never-serialize-subtarget-secret' }],
  };
  const index = { tab_id: TAB, web_contents_id: 7, binding_generation: 1 };
  const calls = { census: 0, binding: 0, identity: 0, ensure: 0, send: 0 };
  const processPlane = {
    snapshot({ eventLimit }) {
      calls.census += 1;
      assert.equal(eventLimit, 0);
      return census;
    },
    runtimeBinding(tab, options) {
      calls.binding += 1;
      assert.equal(tab, TAB);
      assert.deepEqual(options, { require_complete_process_identity: true });
      return binding;
    },
  };
  const cdpPool = {
    identity(selected, opts) {
      calls.identity += 1;
      assert.equal(selected, wc);
      assert.deepEqual(opts, { require_ready: true, require_event_stream: true });
      return cdp;
    },
    ensure() { calls.ensure += 1; throw new Error('CDP attach forbidden'); },
    send() { calls.send += 1; throw new Error('CDP commands forbidden'); },
  };
  const adapter = new BrowserCellCdpContinuityReadback({
    views, cells, processPlane, cdpPool,
    resolveIndexedBinding: (tab) => tab === TAB ? index : null,
    resolveIndexedTab: (selected) => selected === wc ? TAB : null,
    clock: () => NOW,
  });
  return {
    adapter, calls, cells, views, census, binding, cdp, index,
    replaceWebContents(newWc) {
      wc = newWc;
      views.set(TAB, { webContents: newWc });
    },
    liveWebContents: () => wc,
  };
}

test('W33 exact native BrowserCell -> tab -> WebContents -> renderer birth -> CDP target is read-only', () => {
  const f = fixture();
  const w = f.adapter.read(TAB);
  assert.equal(w.schema, BROWSERCELL_CDP_CONTINUITY_SCHEMA);
  assert.equal(w.state, 'BOUND_READ_ONLY');
  assert.equal(w.cell_id, 'client:worker:33');
  assert.equal(w.cell_generation, 2);
  assert.equal(w.web_contents_id, 7);
  assert.equal(w.tab_binding_generation, 1);
  assert.equal(w.renderer_pid, 300);
  assert.equal(w.renderer_process_key, processKey);
  assert.equal(w.target_id, 'CDP-root-33');
  assert.equal(w.runtime_binding_generation, 4);
  assert.equal(w.cdp_attachment_generation, 2);
  assert.equal(w.cdp_binding_generation, 3);
  assert.equal(w.document_generation, 5);
  assert.equal(f.adapter.isCurrent(w), true);
  assert.equal(w.healthy, false);
  assert.equal(w.execution_authority, false);
  assert.equal(w.send_allowed, false);
  assert.equal(w.automatic_retry_allowed, false);
  assert.deepEqual([f.calls.ensure, f.calls.send], [0, 0]);
  assert.equal(f.adapter.snapshot().second_scheduler, false);
  assert.equal(f.adapter.snapshot().cdp_attach_on_read, false);
  const out = JSON.stringify(w) + JSON.stringify(f.adapter.snapshot());
  for (const secret of [
    'never-serialize-cell-secret', 'never-serialize-process-secret',
    'never-serialize-page-secret', 'never-serialize-url', 'never-serialize-subtarget-secret',
  ]) assert.equal(out.includes(secret), false);
});

test('W33 absent or stale native census never becomes BOUND from PID alone', () => {
  const f = fixture();
  f.census.observed_at = null;
  assert.equal(f.adapter.read(TAB).reason, 'PROCESS_CENSUS_MISSING_OR_STALE');
  f.census.observed_at = new Date(NOW + 1).toISOString();
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.census.observed_at = new Date(NOW - 2001).toISOString();
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.census.observed_at = OBSERVED;
  f.census.processes[0].process_key = null;
  assert.equal(f.adapter.read(TAB).reason, 'RENDERER_PROCESS_INCARNATION_UNPROVEN');
  f.census.processes[0].process_key = '300:1725000000999';
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.census.processes[0].process_key = processKey;
  f.census.processes[0].process_identity_complete = false;
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
});

test('W33 duplicated process/WebContents census rows are ambiguous, never first-row wins', () => {
  const f = fixture();
  f.census.processes.push({ ...f.census.processes[0] });
  assert.equal(f.adapter.read(TAB).reason, 'PROCESS_CENSUS_AMBIGUOUS');
  f.census.processes.pop();
  f.census.web_contents.push({ ...f.census.web_contents[0] });
  assert.equal(f.adapter.read(TAB).reason, 'PROCESS_CENSUS_AMBIGUOUS');
});

test('W33 exact Brain Cell generation and tab reverse index prohibit cross-cell rebinding', () => {
  const f = fixture();
  f.cells.get(TAB).cell_generation = 3;
  assert.equal(f.adapter.read(TAB).reason, 'BRAIN_RUNTIME_BINDING_MISMATCH');
  f.cells.get(TAB).cell_generation = 2;
  f.index.binding_generation = 0;
  assert.equal(f.adapter.read(TAB).reason, 'WEBCONTENTS_TAB_BINDING_MISMATCH');
  f.index.binding_generation = 1;
  f.index.web_contents_id = 8;
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.index.web_contents_id = 7;
  f.census.web_contents[0].tab_id = 'tab_00000000-0000-4000-8000-000000000034';
  assert.equal(f.adapter.read(TAB).reason, 'RENDERER_PROCESS_INCARNATION_UNPROVEN');
});

test('W33 CDP detached, non-event-stream or placeholder target cannot claim continuity', () => {
  const f = fixture();
  f.cdp.attached = false;
  assert.equal(f.adapter.read(TAB).reason, 'CDP_ROOT_TARGET_UNVERIFIED');
  f.cdp.attached = true;
  f.cdp.event_stream_capable = false;
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.cdp.event_stream_capable = true;
  f.cdp.target_id = 'webcontents:7';
  f.binding.target_id = 'webcontents:7';
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
  f.cdp.target_id = 'CDP-root-33';
  f.binding.target_id = 'CDP-root-33';
  f.cdp.document_generation = 6;
  assert.equal(f.adapter.read(TAB).state, 'UNKNOWN');
});

test('W33 same-PID renderer reincarnation invalidates old identity until exact new Brain binding', () => {
  const f = fixture();
  const before = f.adapter.read(TAB);
  f.census.processes[0].creation_time_ms = 1725000000999;
  f.census.processes[0].process_key = '300:1725000000999';
  assert.equal(f.adapter.read(TAB).reason, 'BRAIN_RUNTIME_BINDING_MISMATCH');
  assert.equal(f.adapter.isCurrent(before), false);
  f.binding.renderer_process_key = '300:1725000000999';
  f.binding.binding_generation += 1;
  f.cdp.attachment_generation += 1;
  f.cdp.binding_generation += 1;
  const after = f.adapter.read(TAB);
  assert.equal(after.state, 'BOUND_READ_ONLY');
  assert.notEqual(after.renderer_process_key, before.renderer_process_key);
  assert.equal(f.adapter.isCurrent(before), false);
  assert.equal(f.adapter.isCurrent(after), true);
});

test('W33 exact native lifecycle terminal event fences a binding until new generation', () => {
  const f = fixture();
  const before = f.adapter.read(TAB);
  const event = {
    type: 'RENDER_PROCESS_GONE', tab_id: TAB,
    web_contents_id: before.web_contents_id,
    renderer_process_key: before.renderer_process_key,
    binding_generation: before.runtime_binding_generation,
    target_id: before.target_id,
  };
  assert.equal(f.adapter.invalidateFromLifecycle(event), true);
  assert.equal(f.adapter.read(TAB).state, 'INVALIDATED');
  assert.equal(f.adapter.isCurrent(before), false);
  assert.equal(f.adapter.invalidateFromLifecycle({ ...event, target_id: 'other-target' }), false);
  // Even if the same pid and native census recover, the terminated generation
  // remains fenced, requiring fresh authoritative binding generation.
  f.binding.binding_generation += 1;
  f.cdp.attachment_generation += 1;
  f.cdp.binding_generation += 1;
  const after = f.adapter.read(TAB);
  assert.equal(after.state, 'BOUND_READ_ONLY');
  assert.equal(f.adapter.invalidateFromLifecycle(event), false);
  assert.equal(f.adapter.read(TAB).state, 'BOUND_READ_ONLY');
  assert.equal(f.adapter.isCurrent(before), false);
});

test('W33 WebContents destroyed/crashed and object replacement fail closed', () => {
  const f = fixture();
  const before = f.adapter.read(TAB);
  f.replaceWebContents({
    id: 8,
    isDestroyed: () => false,
    isCrashed: () => false,
    getOSProcessId: () => 300,
  });
  assert.equal(f.adapter.read(TAB).reason, 'WEBCONTENTS_TAB_BINDING_MISMATCH');
  assert.equal(f.adapter.isCurrent(before), false);
  // Reset to original object; a native crash still forbids target assertion.
  f.replaceWebContents({
    id: 7,
    isDestroyed: () => true,
    getOSProcessId: () => 300,
  });
  assert.equal(f.adapter.read(TAB).reason, 'WEBCONTENTS_UNAVAILABLE');
});

test('W33 provenance cannot be obtained from raw caller flags or untrusted exception contents', () => {
  const f = fixture();
  const before = f.adapter.read(TAB);
  assert.equal(f.adapter.isCurrent({ ...before, target_id: 'forged', verified: true }), false);
  f.views.get(TAB).webContents.getOSProcessId = () => {
    throw new Error('TOKEN_SHOULD_NOT_LEAK');
  };
  const diagnostic = f.adapter.read(TAB);
  assert.equal(diagnostic.reason, 'TRUSTED_READBACK_UNAVAILABLE');
  assert.equal(JSON.stringify(diagnostic).includes('TOKEN_SHOULD_NOT_LEAK'), false);
  assert.equal(f.adapter.read('about:blank').state, 'UNKNOWN');
});

test('W33 input bounds prohibit unbounded observational cache and stale event pollution', () => {
  const f = fixture();
  assert.throws(() => new BrowserCellCdpContinuityReadback({
    views: f.views, cells: f.cells, processPlane: {},
    cdpPool: {}, maxCells: 512,
  }), /trusted_dependencies_required/);
  assert.equal(f.adapter.invalidateFromLifecycle({
    type: 'RENDER_PROCESS_GONE',
    tab_id: TAB, web_contents_id: 7,
  }), false);
  assert.equal(f.adapter.snapshot().observed_cell_count, 0);
  assert.equal(f.adapter.read(TAB).state, 'BOUND_READ_ONLY');
  assert.equal(f.adapter.snapshot().observed_cell_count, 1);
});
