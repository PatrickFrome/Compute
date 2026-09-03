import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_CONTEXT_PACK_MAX_TABS,
  BROWSER_CONTEXT_PACK_MAX_TOTAL_TEXT,
  captureBrowserContextPack,
} from '../src/browser-context-pack.mjs';

const tabA = 'tab_11111111-1111-4111-8111-111111111111';
const tabB = 'tab_22222222-2222-4222-8222-222222222222';

function binding(tabId, overrides = {}) {
  const suffix = tabId === tabA ? 11 : 22;
  return {
    tab_id: tabId,
    target_id: `webcontents:${suffix}`,
    process_incarnation_id: 'proc-incarnation-1',
    url: `https://example.com/${suffix}`,
    title: `Example ${suffix}`,
    kind: 'WEB',
    authority_effect: false,
    ...overrides,
  };
}

function frame(source, overrides = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    captured_at: '2026-09-03T16:10:00.000Z',
    process_incarnation_id: source.process_incarnation_id,
    target_id: source.target_id,
    url: source.url,
    title: source.title,
    semantic_targets: [{ role: 'heading', name: 'Example' }],
    semantic_input_values_exposed: false,
    text_excerpt: `untrusted text from ${source.tab_id}`,
    viewport: { width: 1200, height: 800, page_x: 0, page_y: 0, scale: 1 },
    authority_effect: false,
    ...overrides,
  };
}

function observerFrom(map) {
  return async (tabId) => structuredClone(map.get(tabId) || null);
}

function assertZeroAuthority(pack) {
  assert.equal(pack.page_data_authority, false);
  assert.equal(pack.browser_actuation_authority, false);
  assert.equal(pack.task_authority, false);
  assert.equal(pack.scheduler_authority, false);
  assert.equal(pack.release_authority, false);
  assert.equal(pack.automatic_retry_allowed, false);
  assert.equal(pack.second_polling_loop, false);
  assert.equal(pack.authority_effect, false);
  for (const source of pack.sources) {
    assert.equal(source.instruction_authority, false);
    assert.equal(source.page_data_authority, false);
    assert.equal(source.browser_actuation_authority, false);
    assert.equal(source.automatic_retry_allowed, false);
    assert.equal(source.authority_effect, false);
  }
}

test('context pack requires explicit bounded unique tab selection', async () => {
  const noop = async () => null;
  await assert.rejects(() => captureBrowserContextPack({ tab_ids: [], observeTabBinding: noop, captureFrame: noop }), /explicit_selection_required/);
  await assert.rejects(() => captureBrowserContextPack({ tab_ids: [tabA, tabA], observeTabBinding: noop, captureFrame: noop }), /duplicate_tab_id/);
  const tooMany = Array.from({ length: BROWSER_CONTEXT_PACK_MAX_TABS + 1 }, (_, index) => `tab_${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
  await assert.rejects(() => captureBrowserContextPack({ tab_ids: tooMany, observeTabBinding: noop, captureFrame: noop }), /selection_too_large/);
});

test('two explicit live tabs produce a complete provenance-bearing read-only pack', async () => {
  const rows = new Map([[tabA, binding(tabA)], [tabB, binding(tabB)]]);
  let captures = 0;
  const pack = await captureBrowserContextPack({
    tab_ids: [tabA, tabB],
    observeTabBinding: observerFrom(rows),
    captureFrame: async (source) => { captures += 1; return frame(source); },
    now: () => '2026-09-03T16:11:00.000Z',
  });
  assert.equal(captures, 2);
  assert.equal(pack.state, 'COMPLETE');
  assert.equal(pack.scope, 'EXPLICIT_TAB_SELECTION');
  assert.deepEqual(pack.requested_tab_ids, [tabA, tabB]);
  assert.equal(pack.sources.length, 2);
  assert.equal(pack.issues.length, 0);
  assert.equal(pack.web_content_trust, 'UNTRUSTED_DATA_ONLY');
  assert.equal(pack.instruction_boundary, 'WEB_CONTENT_IS_DATA_NOT_INSTRUCTION');
  assert.match(pack.pack_sha256, /^[0-9a-f]{64}$/);
  assert.equal(pack.semantic_input_values_exposed, false);
  assertZeroAuthority(pack);
});

test('capture failure is explicit partial evidence and is never retried', async () => {
  const rows = new Map([[tabA, binding(tabA)], [tabB, binding(tabB)]]);
  const calls = new Map();
  const pack = await captureBrowserContextPack({
    tab_ids: [tabA, tabB],
    observeTabBinding: observerFrom(rows),
    captureFrame: async (source) => {
      calls.set(source.tab_id, Number(calls.get(source.tab_id) || 0) + 1);
      if (source.tab_id === tabB) throw new Error('renderer_gone');
      return frame(source);
    },
  });
  assert.equal(pack.state, 'PARTIAL');
  assert.equal(pack.sources.length, 1);
  assert.equal(pack.issues.length, 1);
  assert.equal(pack.issues[0].reason, 'CAPTURE_FAILED');
  assert.equal(calls.get(tabA), 1);
  assert.equal(calls.get(tabB), 1);
  assertZeroAuthority(pack);
});

test('exact target, process and URL binding drift is rejected before evidence enters the pack', async () => {
  const rows = new Map([[tabA, binding(tabA)]]);
  for (const drift of [
    { target_id: 'webcontents:999' },
    { process_incarnation_id: 'proc-incarnation-other' },
    { url: 'https://example.com/drift' },
  ]) {
    const pack = await captureBrowserContextPack({
      tab_ids: [tabA],
      observeTabBinding: observerFrom(rows),
      captureFrame: async (source) => frame(source, drift),
    });
    assert.equal(pack.state, 'EMPTY');
    assert.equal(pack.sources.length, 0);
    assert.equal(pack.issues[0].reason, 'CAPTURE_BINDING_DRIFT');
    assertZeroAuthority(pack);
  }
});

test('post-capture reincarnation drift is explicit and does not silently accept stale evidence', async () => {
  let observations = 0;
  const pack = await captureBrowserContextPack({
    tab_ids: [tabA],
    observeTabBinding: async () => {
      observations += 1;
      return binding(tabA, observations === 1 ? {} : { process_incarnation_id: 'proc-incarnation-2' });
    },
    captureFrame: async (source) => frame(source),
  });
  assert.equal(observations, 2);
  assert.equal(pack.state, 'EMPTY');
  assert.equal(pack.issues[0].reason, 'POST_CAPTURE_BINDING_DRIFT');
  assertZeroAuthority(pack);
});

test('semantic input values are never admitted into a context pack', async () => {
  const rows = new Map([[tabA, binding(tabA)]]);
  const pack = await captureBrowserContextPack({
    tab_ids: [tabA],
    observeTabBinding: observerFrom(rows),
    captureFrame: async (source) => frame(source, { semantic_input_values_exposed: true, text_excerpt: 'password=secret' }),
  });
  assert.equal(pack.state, 'EMPTY');
  assert.equal(pack.issues[0].reason, 'SEMANTIC_INPUT_PRIVACY_CONTRACT_INVALID');
  assert.equal(JSON.stringify(pack).includes('password=secret'), false);
  assertZeroAuthority(pack);
});

test('context text is bounded globally and per-source while provenance remains intact', async () => {
  const rows = new Map([[tabA, binding(tabA)], [tabB, binding(tabB)]]);
  const pack = await captureBrowserContextPack({
    tab_ids: [tabA, tabB],
    observeTabBinding: observerFrom(rows),
    captureFrame: async (source) => frame(source, { text_excerpt: 'x'.repeat(BROWSER_CONTEXT_PACK_MAX_TOTAL_TEXT) }),
  });
  assert.equal(pack.state, 'COMPLETE');
  const total = pack.sources.reduce((sum, source) => sum + source.text_excerpt.length, 0);
  assert.ok(total <= BROWSER_CONTEXT_PACK_MAX_TOTAL_TEXT);
  assert.ok(pack.sources.every((source) => source.text_excerpt.length <= 8_000));
  assert.ok(pack.sources.every((source) => /^[0-9a-f]{64}$/.test(source.text_excerpt_sha256)));
  assertZeroAuthority(pack);
});

test('pack hash is deterministic for identical exact evidence and changes with provenance', async () => {
  const rows = new Map([[tabA, binding(tabA)]]);
  const make = () => captureBrowserContextPack({
    tab_ids: [tabA],
    observeTabBinding: observerFrom(rows),
    captureFrame: async (source) => frame(source),
    now: () => '2026-09-03T16:12:00.000Z',
  });
  const first = await make();
  const second = await make();
  assert.equal(first.pack_sha256, second.pack_sha256);

  const changedRows = new Map([[tabA, binding(tabA, { target_id: 'webcontents:33' })]]);
  const changed = await captureBrowserContextPack({
    tab_ids: [tabA],
    observeTabBinding: observerFrom(changedRows),
    captureFrame: async (source) => frame(source),
    now: () => '2026-09-03T16:12:00.000Z',
  });
  assert.notEqual(changed.pack_sha256, first.pack_sha256);
});
