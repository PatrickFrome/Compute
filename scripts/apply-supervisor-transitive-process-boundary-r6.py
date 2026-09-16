from pathlib import Path

root = Path(__file__).resolve().parents[1]
keepalive_path = root / 'apps/metaengine-browser/src/supervisor-keepalive.mjs'
lifecycle_path = root / 'apps/metaengine-browser/src/supervisor-lifecycle-runtime-core.mjs'
test_path = root / 'apps/metaengine-browser/test/supervisor-process-boundary-ambiguity-r5.test.mjs'

keepalive = keepalive_path.read_text(encoding='utf-8')
old_init = """      this.#state.process_incarnation_id = this.#processIncarnationId;\n      this.#state.process_incarnation_started_at = recoveredAt;\n    }\n\n    if (this.#state.pending_wake && !this.#state.pending_wake.ambiguous_at) {\n"""
new_init = """      this.#state.process_incarnation_id = this.#processIncarnationId;\n      this.#state.process_incarnation_started_at = recoveredAt;\n      const pendingProcess = sanitizeProcessIncarnationId(this.#state.pending_wake?.process_incarnation_id);\n      if (pendingProcess && pendingProcess !== this.#processIncarnationId) {\n        // The process boundary itself is trusted local evidence that this pending wake\n        // belongs to a fenced predecessor/ancestor. Stamp the exact current process\n        // that observed the boundary so later recovery does not depend on the wake\n        // owner being the immediately previous process after multiple restarts.\n        this.#state.pending_wake.process_boundary_fenced_at = recoveredAt;\n        this.#state.pending_wake.process_boundary_fenced_by = this.#processIncarnationId;\n        this.#state.pending_wake.automatic_retry_allowed = false;\n      }\n    }\n\n    if (this.#state.pending_wake && !this.#state.pending_wake.ambiguous_at) {\n"""
if keepalive.count(old_init) != 1:
    raise SystemExit(f'keepalive_init_anchor_invalid:{keepalive.count(old_init)}')
keepalive = keepalive.replace(old_init, new_init, 1)

old_retire = """    const predecessorProcess = sanitizeProcessIncarnationId(this.#state.predecessor_process_incarnation_id);\n    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) {\n      throw new Error('keepalive_process_boundary_ambiguity_not_proven');\n    }\n    if (!predecessorProcess || predecessorProcess !== pendingProcess || !this.#state.predecessor_fenced_at) {\n      throw new Error('keepalive_process_boundary_predecessor_not_proven');\n    }\n"""
new_retire = """    const predecessorProcess = sanitizeProcessIncarnationId(this.#state.predecessor_process_incarnation_id);\n    const boundaryFencedBy = sanitizeProcessIncarnationId(pending.process_boundary_fenced_by);\n    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) {\n      throw new Error('keepalive_process_boundary_ambiguity_not_proven');\n    }\n    const immediatePredecessorProven = Boolean(\n      predecessorProcess\n      && predecessorProcess === pendingProcess\n      && this.#state.predecessor_fenced_at,\n    );\n    const transitiveBoundaryProven = Boolean(\n      pending.process_boundary_fenced_at\n      && boundaryFencedBy === currentProcess,\n    );\n    if (!immediatePredecessorProven && !transitiveBoundaryProven) {\n      throw new Error('keepalive_process_boundary_predecessor_not_proven');\n    }\n"""
if keepalive.count(old_retire) != 1:
    raise SystemExit(f'keepalive_retire_anchor_invalid:{keepalive.count(old_retire)}')
keepalive = keepalive.replace(old_retire, new_retire, 1)
keepalive_path.write_text(keepalive, encoding='utf-8')

lifecycle = lifecycle_path.read_text(encoding='utf-8')
old_lifecycle = """    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');\n    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;\n    if (!predecessorProcess || predecessorProcess !== pendingProcess || !keepalive.predecessor_fenced_at) return false;\n\n    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];\n"""
new_lifecycle = """    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');\n    const boundaryFencedBy = String(pending.process_boundary_fenced_by || '');\n    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;\n    const immediatePredecessorProven = Boolean(\n      predecessorProcess\n      && predecessorProcess === pendingProcess\n      && keepalive.predecessor_fenced_at,\n    );\n    const transitiveBoundaryProven = Boolean(\n      pending.process_boundary_fenced_at\n      && boundaryFencedBy === currentProcess,\n    );\n    if (!immediatePredecessorProven && !transitiveBoundaryProven) return false;\n\n    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];\n"""
if lifecycle.count(old_lifecycle) != 1:
    raise SystemExit(f'lifecycle_boundary_anchor_invalid:{lifecycle.count(old_lifecycle)}')
lifecycle = lifecycle.replace(old_lifecycle, new_lifecycle, 1)
lifecycle = lifecycle.replace(
    "proof: 'PREDECESSOR_FENCED_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT'",
    "proof: 'PROCESS_BOUNDARY_FENCED_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT'",
    1,
)
lifecycle = lifecycle.replace(
    "proof: 'RETIRED_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT'",
    "proof: 'RETIRED_FENCED_ANCESTOR_THEN_REUSED_UNIQUE_EMPTY_ROOT'",
    1,
)
lifecycle_path.write_text(lifecycle, encoding='utf-8')

test_src = test_path.read_text(encoding='utf-8')
old_make = """async function makeRuntime({ tabs }) {\n  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r5-'));\n  const statePath = path.join(dir, 'keepalive.json');\n  await fs.writeFile(statePath, `${JSON.stringify(seedState(), null, 2)}\\n`);\n"""
new_make = """async function makeRuntime({ tabs, seed = seedState() }) {\n  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r5-'));\n  const statePath = path.join(dir, 'keepalive.json');\n  await fs.writeFile(statePath, `${JSON.stringify(seed, null, 2)}\\n`);\n"""
if test_src.count(old_make) != 1:
    raise SystemExit(f'test_make_anchor_invalid:{test_src.count(old_make)}')
test_src = test_src.replace(old_make, new_make, 1)
append = r'''

test('multi-hop process-boundary ambiguity retires a transitively fenced ancestor wake', async () => {
  const seed = seedState();
  seed.process_incarnation_id = 'process_middle-r6';
  seed.process_incarnation_started_at = '2026-09-16T00:10:00.000Z';
  seed.predecessor_process_incarnation_id = OLD_PROCESS;
  seed.predecessor_fenced_at = '2026-09-16T00:10:00.000Z';
  seed.predecessor_queued_wake_count = 1;
  seed.queued_wakes = [{
    key: 'RESEARCH_ACCELERATOR_DUE:epoch-1',
    reason: 'RESEARCH_ACCELERATOR_DUE',
    queued_at: '2026-09-16T00:10:01.000Z',
    agent_id: null,
    agent_count: 0,
    process_incarnation_id: 'process_middle-r6',
    authority_effect: false,
  }];

  const { runtime, actions, statePath, typed } = await makeRuntime({
    seed,
    tabs: [{ tab_id: 'replacement-root-r6', url: 'https://chatgpt.com/', selected: false }],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.conversation_url, 'https://chatgpt.com/c/r5-recovered');
  assert.equal(snap.keepalive.tab_id, 'replacement-root-r6');
  assert.notEqual(snap.keepalive.active_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 1);
  assert.equal(snap.keepalive.ambiguous_history[0].wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history[0].retired_process_incarnation_id, OLD_PROCESS);
  assert.ok(snap.keepalive.ambiguous_history[0].process_boundary_fenced_at);
  assert.ok(snap.keepalive.ambiguous_history[0].process_boundary_fenced_by);
  assert.equal(typed(), 1);
  assert.equal(actions.includes('NEW_TAB'), false);

  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake, null);
  assert.equal(durable.ambiguous_history[0].automatic_retry_allowed, false);
  assert.equal(durable.ambiguous_history[0].replacement_tab_id, 'replacement-root-r6');
});
'''
if "multi-hop process-boundary ambiguity retires a transitively fenced ancestor wake" in test_src:
    raise SystemExit('test_already_present')
test_src += append
test_path.write_text(test_src, encoding='utf-8')
