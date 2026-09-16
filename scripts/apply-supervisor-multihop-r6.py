from pathlib import Path

core_path = Path('apps/metaengine-browser/src/supervisor-lifecycle-runtime-core.mjs')
core = core_path.read_text(encoding='utf-8')
old = """    const pendingProcess = String(pending.process_incarnation_id || '');
    const currentProcess = String(keepalive.process_incarnation_id || '');
    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;
    if (!predecessorProcess || predecessorProcess !== pendingProcess || !keepalive.predecessor_fenced_at) return false;

    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
"""
new = """    const pendingProcess = String(pending.process_incarnation_id || '');
    const currentProcess = String(keepalive.process_incarnation_id || '');
    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;

    const directPredecessorBoundary = Boolean(
      predecessorProcess
      && predecessorProcess === pendingProcess
      && keepalive.predecessor_fenced_at,
    );
    const preparedAt = Date.parse(String(pending.prepared_at || ''));
    const ambiguousAt = Date.parse(String(pending.ambiguous_at || ''));
    const currentStartedAt = Date.parse(String(keepalive.process_incarnation_started_at || ''));
    const predecessorFencedAt = Date.parse(String(keepalive.predecessor_fenced_at || ''));
    const legacyMultiHopBoundary = Boolean(
      !directPredecessorBoundary
      && predecessorProcess
      && predecessorProcess !== pendingProcess
      && predecessorProcess !== currentProcess
      && pending.automatic_retry_allowed === false
      && Number.isFinite(preparedAt)
      && Number.isFinite(ambiguousAt)
      && Number.isFinite(currentStartedAt)
      && Number.isFinite(predecessorFencedAt)
      && preparedAt <= ambiguousAt
      && ambiguousAt < currentStartedAt
      && predecessorFencedAt === currentStartedAt,
    );
    if (!directPredecessorBoundary && !legacyMultiHopBoundary) return false;

    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
"""
if core.count(old) != 1:
    raise SystemExit(f'expected one R5 boundary block, found {core.count(old)}')
core = core.replace(old, new)
old2 = """    const retiredWakeId = String(pending.wake_id || '');
    await this.#keepalive.retireAmbiguousAfterProcessBoundary({
      reason: 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST',
      replacement_tab_id: root.tab_id,
    });
    this.#lastRecovery = {
      action: 'PROCESS_BOUNDARY_AMBIGUOUS_WAKE_RETIRED',
      wake_id: retiredWakeId,
      tab_id: String(root.tab_id),
      proof: 'PREDECESSOR_FENCED_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT',
      confirmed: true,
      ambiguous: false,
      automatic_retry_allowed: false,
      at: new Date().toISOString(),
      authority_effect: false,
    };

    const bootstrapped = await this.#bootstrapSupervisorConversation({ preferredExistingRootTabId: root.tab_id });
    if (bootstrapped) {
      this.#lastRecovery = {
        action: 'PROCESS_BOUNDARY_BOOTSTRAP_RECOVERED',
        wake_id: this.#keepalive.activeWake()?.wake_id || null,
        retired_wake_id: retiredWakeId,
        tab_id: String(root.tab_id),
        proof: 'RETIRED_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT',
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    }
"""
new2 = """    const retiredWakeId = String(pending.wake_id || '');
    const boundaryProof = directPredecessorBoundary
      ? 'DIRECT_PREDECESSOR_FENCED_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT'
      : 'MULTIHOP_DURABLE_CHRONOLOGY_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT';
    if (directPredecessorBoundary) {
      await this.#keepalive.retireAmbiguousAfterProcessBoundary({
        reason: 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST',
        replacement_tab_id: root.tab_id,
      });
    } else {
      // Legacy R4/R5 wakes can survive more than one Browser restart. We never
      // replay that old physical effect: strict durable chronology proves it
      // belongs to an older process, then we retire it as ambiguous history.
      await this.#keepalive.retireAmbiguousAfterTerminal({
        reason: 'PROCESS_BOUNDARY_MULTI_HOP_ORIGINAL_BOOTSTRAP_TARGET_LOST',
      });
      const afterRetire = this.#keepalive.snapshot();
      const sameReasonCurrentWake = (afterRetire.queued_wakes || []).some((wake) => (
        String(wake?.reason || '') === String(pending.reason || '')
        && String(wake?.process_incarnation_id || '') === String(afterRetire.process_incarnation_id || '')
      ));
      if (!sameReasonCurrentWake) {
        await this.#keepalive.enqueueWake(pending.reason, {
          key: `process-boundary-recovery:${retiredWakeId}`,
        });
      }
      await this.#keepalive.resume();
    }
    this.#lastRecovery = {
      action: 'PROCESS_BOUNDARY_AMBIGUOUS_WAKE_RETIRED',
      wake_id: retiredWakeId,
      tab_id: String(root.tab_id),
      proof: boundaryProof,
      confirmed: true,
      ambiguous: false,
      automatic_retry_allowed: false,
      at: new Date().toISOString(),
      authority_effect: false,
    };

    const bootstrapped = await this.#bootstrapSupervisorConversation({ preferredExistingRootTabId: root.tab_id });
    if (bootstrapped) {
      this.#lastRecovery = {
        action: 'PROCESS_BOUNDARY_BOOTSTRAP_RECOVERED',
        wake_id: this.#keepalive.activeWake()?.wake_id || null,
        retired_wake_id: retiredWakeId,
        tab_id: String(root.tab_id),
        proof: directPredecessorBoundary
          ? 'RETIRED_DIRECT_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT'
          : 'RETIRED_MULTIHOP_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT',
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    }
"""
if core.count(old2) != 1:
    raise SystemExit(f'expected one R5 retirement block, found {core.count(old2)}')
core = core.replace(old2, new2)
core_path.write_text(core, encoding='utf-8')

test_path = Path('apps/metaengine-browser/test/supervisor-process-boundary-ambiguity-r6.test.mjs')
test_path.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';

const ORIGIN_PROCESS = 'process_origin-r6';
const IMMEDIATE_PROCESS = 'process_immediate-r6';
const OLD_WAKE = 'wake_multihop-process-boundary-r6';

function seedState({ ambiguousAt = '2026-09-16T00:00:01.000Z' } = {}) {
  return {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 0,
    state: 'WAKE_AMBIGUOUS',
    conversation_url: null,
    tab_id: null,
    paused: false,
    process_incarnation_id: IMMEDIATE_PROCESS,
    process_incarnation_started_at: '2026-09-16T00:10:00.000Z',
    predecessor_process_incarnation_id: 'process_prior-r6',
    predecessor_fenced_at: '2026-09-16T00:10:00.000Z',
    admission_state: 'UNKNOWN',
    queued_wakes: [],
    pending_wake: {
      wake_id: OLD_WAKE,
      reason: 'RESEARCH_ACCELERATOR_DUE',
      queue_key: 'RESEARCH_ACCELERATOR_DUE:epoch-1',
      prepared_at: '2026-09-16T00:00:00.000Z',
      supervisor_epoch: 1,
      cycle_seq: 1,
      process_incarnation_id: ORIGIN_PROCESS,
      ambiguous_at: ambiguousAt,
      ambiguous_reason: 'TYPE_EFFECT_AMBIGUOUS',
      automatic_retry_allowed: false,
    },
    active_wake: null,
    last_research_wake_at: null,
  };
}

function rootFrame() {
  return {
    url: 'https://chatgpt.com/',
    title: 'ChatGPT',
    text_excerpt: '',
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT', semantic_ref: 'composer', value_length: 0 },
      { role: 'button', name: 'Send prompt', semantic_ref: 'send' },
    ],
  };
}

async function makeRuntime({ tabs, seed = seedState() }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r6-'));
  const statePath = path.join(dir, 'keepalive.json');
  await fs.writeFile(statePath, `${JSON.stringify(seed, null, 2)}\n`);
  const actions = [];
  let typed = 0;
  let currentTabs = structuredClone(tabs);
  const executeCommand = async ({ action, payload }) => {
    actions.push(action);
    if (action === 'CAPTURE') {
      const tab = currentTabs.find((row) => String(row?.tab_id || '') === String(payload?.tab_id || ''));
      return { ...rootFrame(), url: String(tab?.url || 'https://chatgpt.com/'), tab_id: String(payload?.tab_id || '') };
    }
    if (action === 'SEMANTIC_TYPE') {
      typed += 1;
      currentTabs = currentTabs.map((row) => String(row?.tab_id || '') === String(payload?.tab_id || '')
        ? { ...row, url: 'https://chatgpt.com/c/r6-recovered' }
        : row);
      return {
        effect_state: 'PROVEN_NEW_CONVERSATION',
        url: 'https://chatgpt.com/c/r6-recovered',
        tab_id: String(payload?.tab_id || ''),
        text_excerpt: '',
        semantic_targets: [],
      };
    }
    if (action === 'NEW_TAB') throw new Error('r6_must_reuse_existing_root');
    throw new Error(`unexpected_effect:${action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(currentTabs), fleet: { agents: [] } }),
    executeCommand,
    canActuate: () => true,
    statePath,
    researchMs: 24 * 60 * 60 * 1000,
  });
  return { runtime, actions, statePath, typed: () => typed };
}

test('multi-hop process-boundary ambiguity retires the old wake and reuses one clean root without replay', async () => {
  const { runtime, actions, statePath, typed } = await makeRuntime({
    tabs: [{ tab_id: 'replacement-root-r6', url: 'https://chatgpt.com/', selected: false }],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.conversation_url, 'https://chatgpt.com/c/r6-recovered');
  assert.equal(snap.keepalive.tab_id, 'replacement-root-r6');
  assert.notEqual(snap.keepalive.active_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.active_wake?.reason, 'RESEARCH_ACCELERATOR_DUE');
  assert.equal(snap.keepalive.ambiguous_history.length, 1);
  assert.equal(snap.keepalive.ambiguous_history[0].wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history[0].retired_reason, 'PROCESS_BOUNDARY_MULTI_HOP_ORIGINAL_BOOTSTRAP_TARGET_LOST');
  assert.equal(snap.keepalive.ambiguous_history[0].automatic_retry_allowed, false);
  assert.equal(typed(), 1);
  assert.equal(actions.includes('NEW_TAB'), false);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake, null);
  assert.equal(durable.ambiguous_history[0].wake_id, OLD_WAKE);
  assert.equal(durable.ambiguous_history[0].automatic_retry_allowed, false);
});

test('multi-hop recovery stays fail-closed when clean replacement roots are not unique', async () => {
  const { runtime, actions, typed } = await makeRuntime({
    tabs: [
      { tab_id: 'replacement-root-r6-a', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'replacement-root-r6-b', url: 'https://chatgpt.com/', selected: false },
    ],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(typed(), 0);
  assert.equal(actions.includes('NEW_TAB'), false);
});

test('legacy multi-hop chronology must be strictly older than the current process boundary', async () => {
  const { runtime, actions, typed } = await makeRuntime({
    tabs: [{ tab_id: 'replacement-root-r6', url: 'https://chatgpt.com/', selected: false }],
    seed: seedState({ ambiguousAt: '2999-09-16T00:00:01.000Z' }),
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(typed(), 0);
  assert.equal(actions.includes('NEW_TAB'), false);
});
''', encoding='utf-8')
