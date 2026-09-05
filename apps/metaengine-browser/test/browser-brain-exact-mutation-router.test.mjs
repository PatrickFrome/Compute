import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBrainExactMutationRouter } from '../src/browser-brain-exact-mutation-router.mjs';

const TAB_A = 'tab_11111111-1111-4111-8111-111111111111';
const TAB_B = 'tab_22222222-2222-4222-8222-222222222222';
const COMMAND_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMMAND_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function command(tabId, commandId, action = 'TYPED_CLICK') {
  return { command_id: commandId, action, platform: 'CHATGPT', payload: { tab_id: tabId, node_id: 'node-1' } };
}

function harness({ executeEffect } = {}) {
  const calls = [];
  const webContents = new Map([[TAB_A, { id: 11 }], [TAB_B, { id: 22 }]]);
  const plane = {
    prepareMutation(value) {
      calls.push(['prepare', value.payload.tab_id]);
      const a = value.payload.tab_id === TAB_A;
      return {
        schema: 'metaengine.browser.runtime-mutation-fence.v1',
        cell_id: a ? 'cell-a' : 'cell-b',
        binding_generation: a ? 7 : 9,
        target_id: a ? 'target-a' : 'target-b',
      };
    },
    assertMutationTarget({ command: value, fence, webContents: wc }) {
      calls.push(['assert', value.payload.tab_id, wc.id]);
      return { ...fence, validated_immediately_before_effect: true };
    },
  };
  const router = new BrowserBrainExactMutationRouter({
    runtimeControlPlane: plane,
    resolveWebContentsByTab(tabId) {
      calls.push(['resolve', tabId]);
      return webContents.get(tabId) || null;
    },
    executeEffect: executeEffect || (async ({ command: value }) => {
      calls.push(['effect', value.payload.tab_id]);
      return { dispatched: true };
    }),
  });
  return { router, calls };
}

test('requires explicit tab identity before routing any mutation', async () => {
  const { router, calls } = harness();
  await assert.rejects(
    router.route({ command_id: COMMAND_A, action: 'TYPED_CLICK', payload: {} }),
    /browser_exact_mutation_router_explicit_tab_required/,
  );
  assert.deepEqual(calls, []);
});

test('never uses selected/platform fallback and asserts immediately before effect', async () => {
  const { router, calls } = harness();
  const result = await router.route(command(TAB_A, COMMAND_A));
  assert.equal(result.ok, true);
  assert.equal(result.tab_id, TAB_A);
  assert.equal(result.selected_tab_fallback_allowed, false);
  assert.equal(result.platform_fallback_allowed, false);
  assert.deepEqual(calls, [
    ['prepare', TAB_A],
    ['resolve', TAB_A],
    ['assert', TAB_A, 11],
    ['effect', TAB_A],
  ]);
});

test('independent BrowserCells execute concurrently without a global mutation lock', async () => {
  const entered = [];
  const releases = new Map();
  const { router } = harness({
    executeEffect: ({ command: value }) => new Promise((resolve) => {
      entered.push(value.payload.tab_id);
      releases.set(value.payload.tab_id, resolve);
    }),
  });

  const a = router.route(command(TAB_A, COMMAND_A));
  const b = router.route(command(TAB_B, COMMAND_B));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(entered), new Set([TAB_A, TAB_B]));
  assert.equal(router.snapshot().active_cell_count, 2);

  releases.get(TAB_A)({ done: 'a' });
  releases.get(TAB_B)({ done: 'b' });
  await Promise.all([a, b]);
  assert.equal(router.snapshot().active_cell_count, 0);
});

test('same BrowserCell overlap fails closed instead of creating a hidden queue', async () => {
  let release;
  const { router } = harness({
    executeEffect: () => new Promise((resolve) => { release = resolve; }),
  });
  const first = router.route(command(TAB_A, COMMAND_A));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    router.route(command(TAB_A, COMMAND_B)),
    /browser_exact_mutation_router_cell_busy/,
  );
  assert.equal(router.snapshot().second_scheduler, false);
  release({ done: true });
  await first;
});

test('failed physical effects are not retried and release the cell fence', async () => {
  let effects = 0;
  const { router } = harness({
    executeEffect: async () => {
      effects += 1;
      throw new Error('ambiguous_transport_outcome');
    },
  });
  await assert.rejects(router.route(command(TAB_A, COMMAND_A)), /ambiguous_transport_outcome/);
  assert.equal(effects, 1);
  assert.equal(router.snapshot().active_cell_count, 0);
  assert.equal(router.snapshot().automatic_retry_allowed, false);
});
