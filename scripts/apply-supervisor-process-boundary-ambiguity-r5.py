from pathlib import Path

CORE = Path('apps/metaengine-browser/src/supervisor-lifecycle-runtime-core.mjs')
KEEPALIVE = Path('apps/metaengine-browser/src/supervisor-keepalive.mjs')
TEST = Path('apps/metaengine-browser/test/supervisor-process-boundary-ambiguity-r5.test.mjs')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


keepalive = KEEPALIVE.read_text(encoding='utf-8')
keepalive_marker = "  async retireAmbiguousAfterTerminal({ tab_id = null, generation_epoch = null, reason = 'TERMINAL_BOUNDARY_CONFIRMED' } = {}) {\n"
keepalive_method = """  async retireAmbiguousAfterProcessBoundary({ reason = 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST', replacement_tab_id = null } = {}) {
    const pending = this.#state.pending_wake;
    if (!pending || !pending.ambiguous_at) throw new Error('keepalive_no_ambiguous_wake');
    const pendingProcess = sanitizeProcessIncarnationId(pending.process_incarnation_id);
    const currentProcess = sanitizeProcessIncarnationId(this.#state.process_incarnation_id);
    const predecessorProcess = sanitizeProcessIncarnationId(this.#state.predecessor_process_incarnation_id);
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) {
      throw new Error('keepalive_process_boundary_ambiguity_not_proven');
    }
    if (!predecessorProcess || predecessorProcess !== pendingProcess || !this.#state.predecessor_fenced_at) {
      throw new Error('keepalive_process_boundary_predecessor_not_proven');
    }
    const retiredAt = iso(this.#clock);
    this.#state.cycle_seq = Math.max(this.#state.cycle_seq, Math.max(1, Number(pending.cycle_seq) || 1));
    this.#state.queued_wakes = this.#state.queued_wakes.filter((row) => !(
      row.key === pending.queue_key
      && sanitizeProcessIncarnationId(row.process_incarnation_id) === pendingProcess
    ));
    this.#state.ambiguous_history = [
      ...this.#state.ambiguous_history,
      {
        ...clone(pending),
        retired_at: retiredAt,
        retired_reason: String(reason || 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST').slice(0, 200),
        retired_process_incarnation_id: pendingProcess,
        recovery_process_incarnation_id: currentProcess,
        replacement_tab_id: replacement_tab_id ? String(replacement_tab_id).slice(0, 120) : null,
        automatic_retry_allowed: false,
      },
    ].slice(-MAX_WAKE_HISTORY);
    this.#state.pending_wake = null;
    this.#state.last_completed_cycle_at = retiredAt;
    this.#state.state = this.#state.paused
      ? 'PAUSED'
      : (this.#state.admission_state === 'CLOSED'
        ? 'PARKED'
        : (this.#state.conversation_url ? 'WAITING' : 'RECOVERING'));
    await this.#persist();
    return this.snapshot();
  }

"""
keepalive = replace_once(keepalive, keepalive_marker, keepalive_method + keepalive_marker, 'keepalive process-boundary retirement')
KEEPALIVE.write_text(keepalive, encoding='utf-8')

core = CORE.read_text(encoding='utf-8')
old_signature = "  async #bootstrapSupervisorConversation() {\n"
new_signature = "  async #bootstrapSupervisorConversation({ preferredExistingRootTabId = null } = {}) {\n"
core = replace_once(core, old_signature, new_signature, 'bootstrap signature')

old_tab_creation = """    let prepared = null;
    try {
      const tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
"""
new_tab_creation = """    let prepared = null;
    try {
      const current = await this.#getState();
      const fleetTabs = new Set((current?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
      const reusableRoots = (current?.tabs || []).filter((candidate) => (
        !fleetTabs.has(String(candidate?.tab_id || ''))
        && CHAT_ROOT_RE.test(String(candidate?.url || ''))
      ));
      const preferredId = String(preferredExistingRootTabId || '');
      const scopedRoots = preferredId
        ? reusableRoots.filter((candidate) => String(candidate?.tab_id || '') === preferredId)
        : reusableRoots;
      if ((preferredId && scopedRoots.length !== 1) || (!preferredId && scopedRoots.length > 1)) {
        this.#lastError = 'supervisor_bootstrap_pre_effect:BOOTSTRAP_ROOT_AMBIGUOUS';
        return false;
      }
      let tab = scopedRoots[0] || null;
      if (!tab) {
        tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      }
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
"""
core = replace_once(core, old_tab_creation, new_tab_creation, 'bootstrap root reuse')

continue_marker = "  async #continueExisting(tabId, frame) {\n"
process_boundary_method = """  async #recoverProcessBoundaryBootstrapAmbiguity(state, keepalive) {
    const pending = keepalive?.pending_wake;
    if (keepalive?.state !== 'WAKE_AMBIGUOUS' || !pending?.ambiguous_at || keepalive?.conversation_url) return false;
    const pendingProcess = String(pending.process_incarnation_id || '');
    const currentProcess = String(keepalive.process_incarnation_id || '');
    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;
    if (!predecessorProcess || predecessorProcess !== pendingProcess || !keepalive.predecessor_fenced_at) return false;

    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const durableTabId = String(
      pending.ambiguity_continuation_tab_id
      || keepalive.tab_id
      || '',
    );
    if (durableTabId && tabs.some((tab) => String(tab?.tab_id || '') === durableTabId)) return false;

    const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
    const roots = tabs.filter((tab) => (
      !fleetTabs.has(String(tab?.tab_id || ''))
      && CHAT_ROOT_RE.test(String(tab?.url || ''))
    ));
    if (roots.length !== 1 || this.#canActuate() !== true) return false;

    const root = roots[0];
    let frame;
    try { frame = await this.#capture(root.tab_id); } catch { return false; }
    if (!CHAT_ROOT_RE.test(String(frame?.url || root?.url || '')) || generating(frame)) return false;
    if (String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''))) return false;
    const composer = unique(frame, 'textbox');
    if (!composer || Number(composer.value_length) !== 0) return false;
    const live = tabLiveness(state, root.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: root.tab_id, frame, ...live });
    if (row.terminal_ready !== true) return false;

    const retiredWakeId = String(pending.wake_id || '');
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
    return true;
  }

"""
core = replace_once(core, continue_marker, process_boundary_method + continue_marker, 'process-boundary recovery method')

old_return_block = """        keepalive = this.#keepalive.snapshot();
        if (keepalive.state === 'WAKE_AMBIGUOUS') return this.snapshot();
        if (keepalive.active_wake && !keepalive.conversation_url) return this.snapshot();
        state = await this.#getState();
"""
new_return_block = """        keepalive = this.#keepalive.snapshot();
        if (keepalive.state === 'WAKE_AMBIGUOUS') {
          const processBoundaryHandled = await this.#recoverProcessBoundaryBootstrapAmbiguity(state, keepalive);
          keepalive = this.#keepalive.snapshot();
          if (keepalive.state === 'WAKE_AMBIGUOUS') return this.snapshot();
          if (processBoundaryHandled && !keepalive.conversation_url) return this.snapshot();
        }
        if (keepalive.active_wake && !keepalive.conversation_url) return this.snapshot();
        state = await this.#getState();
"""
core = replace_once(core, old_return_block, new_return_block, 'cycle process-boundary hook')
CORE.write_text(core, encoding='utf-8')

TEST.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';

const OLD_PROCESS = 'process_old-r5';
const OLD_WAKE = 'wake_process-boundary-r5';

function seedState() {
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
    process_incarnation_id: OLD_PROCESS,
    process_incarnation_started_at: '2026-09-16T00:00:00.000Z',
    admission_state: 'UNKNOWN',
    queued_wakes: [],
    pending_wake: {
      wake_id: OLD_WAKE,
      reason: 'RESEARCH_ACCELERATOR_DUE',
      queue_key: 'RESEARCH_ACCELERATOR_DUE:epoch-1',
      prepared_at: '2026-09-16T00:00:00.000Z',
      supervisor_epoch: 1,
      cycle_seq: 1,
      process_incarnation_id: OLD_PROCESS,
      ambiguous_at: '2026-09-16T00:00:01.000Z',
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

async function makeRuntime({ tabs }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r5-'));
  const statePath = path.join(dir, 'keepalive.json');
  await fs.writeFile(statePath, `${JSON.stringify(seedState(), null, 2)}\n`);
  const actions = [];
  let typed = 0;
  const executeCommand = async ({ action, payload }) => {
    actions.push(action);
    if (action === 'CAPTURE') return rootFrame();
    if (action === 'SEMANTIC_TYPE') {
      typed += 1;
      return {
        effect_state: 'PROVEN_NEW_CONVERSATION',
        url: 'https://chatgpt.com/c/r5-recovered',
        tab_id: String(payload?.tab_id || ''),
        text_excerpt: '',
        semantic_targets: [],
      };
    }
    if (action === 'NEW_TAB') throw new Error('r5_must_reuse_existing_root');
    throw new Error(`unexpected_effect:${action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(tabs), fleet: { agents: [] } }),
    executeCommand,
    canActuate: () => true,
    statePath,
    researchMs: 24 * 60 * 60 * 1000,
  });
  return { runtime, actions, statePath, typed: () => typed };
}

test('process-boundary bootstrap ambiguity retires predecessor and reuses one clean root for a new wake', async () => {
  const { runtime, actions, statePath, typed } = await makeRuntime({
    tabs: [{ tab_id: 'replacement-root', url: 'https://chatgpt.com/', selected: false }],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.conversation_url, 'https://chatgpt.com/c/r5-recovered');
  assert.equal(snap.keepalive.tab_id, 'replacement-root');
  assert.notEqual(snap.keepalive.active_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.active_wake?.reason, 'RESEARCH_ACCELERATOR_DUE');
  assert.equal(snap.keepalive.ambiguous_history.length, 1);
  assert.equal(snap.keepalive.ambiguous_history[0].wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history[0].retired_reason, 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST');
  assert.equal(snap.keepalive.ambiguous_history[0].automatic_retry_allowed, false);
  assert.equal(typed(), 1);
  assert.equal(actions.includes('NEW_TAB'), false);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake, null);
  assert.equal(durable.ambiguous_history[0].retired_process_incarnation_id, OLD_PROCESS);
  assert.equal(durable.ambiguous_history[0].replacement_tab_id, 'replacement-root');
});

test('process-boundary ambiguity stays fail-closed when replacement roots are not unique', async () => {
  const { runtime, actions, typed } = await makeRuntime({
    tabs: [
      { tab_id: 'replacement-root-a', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'replacement-root-b', url: 'https://chatgpt.com/', selected: false },
    ],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(typed(), 0);
  assert.equal(actions.includes('NEW_TAB'), false);
});
''', encoding='utf-8')

print('applied supervisor process-boundary ambiguity R5 repair')
