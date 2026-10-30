import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, deferred, element, flush, harness, loadUi } from './ui-reliability-harness.mjs';
import * as observatory from './operator-observatory.mjs';
import * as resync from './operator-observatory-resync.mjs';
import * as primary from './operator-primary-views.mjs';
import * as mode from './goal-submission-mode-observer.mjs';
import * as readFlight from './ui-read-flight.mjs';
import * as draft from './goal-draft.mjs';

function environment(ui, time, extra = {}) {
  const listeners = new Map();
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const date = class extends Date { static now = time.now; };
  const context = { ...ui, ...time, ...observatory, ...resync, ...primary, ...mode, ...readFlight, ...draft, Date: date,
    isPrimaryRosterFresh: (expiresAt, now = time.now()) => readFlight.isPrimaryRosterFresh(expiresAt, now),
    primaryChatActivity: (actor, state, expiresAt, now = time.now()) => readFlight.primaryChatActivity(actor, state, expiresAt, now),
    advanceOperatorObservatoryResync: (previous, value, options) => resync.advanceOperatorObservatoryResync(previous, value, { ...options, nowMs: time.now() }),
    expireOperatorObservatoryResync: previous => resync.expireOperatorObservatoryResync(previous, { nowMs: time.now() }),
    performance: { now: time.now }, document, queueMicrotask,
    useMe2: fn => fn({ setPage() {}, page: 'browser' }), useToast: () => ({ toast() {} }),
    useClientRuntimeStatus: () => ({ state: 'UNAVAILABLE', readback: null }),
    refreshClientRuntimeStatus: async () => ({}),
    TopBar: 'topbar', CommandPalette: 'palette', InterruptedSetupRecovery: 'recovery',
    Dialog: 'dialog', DialogContent: 'content', DialogTitle: 'title', DialogDescription: 'description',
    window: { ...time, addEventListener() {}, removeEventListener() {}, ...extra },
  };
  context.createGoalDraftStore = scope => draft.createGoalDraftStore(scope, { storage: () => context.window.localStorage });
  context.useGoalDraft = loadUi('../hooks/use-goal-draft.ts', ['useGoalDraft'], context).useGoalDraft;
  return context;
}

function composerFixture({ storage = new Map(), storageFails = false } = {}) {
  const ui = harness(), time = clock(), calls = [], details = [], ack = deferred();
  const bridge = {
    typed_positive_api: true, generic_command_exposed: false,
    latestGoal: async () => null, workReadiness: async () => ({ execution_ready: true }),
    goalSubmissionMode: async () => ({ schema: 'metaengine.client.goal-submission-mode.v1', kind: 'PREPARED_GOAL',
      state: 'HOST_VERIFICATION_REQUIRED', reason: null, authority_effect: false, automatic_retry_allowed: false }),
    submitGoal: value => { calls.push(value); return ack.promise; },
  };
  const context = environment(ui, time, { metaengineClient: bridge,
    localStorage: { getItem: key => { if (storageFails) throw Error('private storage detail'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (storageFails) throw Error('private storage detail'); storage.set(key, value); } } });
  const pageState = { page: 'browser', init() {}, setPage() {}, paletteOpen: false, recentPages: [] };
  context.useMe2 = selector => selector(pageState);
  const loaded = loadUi('../components/me2/shell/me2-shell.tsx', ['GoalComposer', 'Me2Shell'], context);
  const confirmedScope = { principalId: 'test-principal', workspaceId: 'test-workspace', projectId: null };
  const mount = () => ui.mount(props => loaded.GoalComposer({ ...props, draft: context.useGoalDraft(confirmedScope) }), { detailOpen: false, onDetailOpenChange: open => details.push(open) });
  const input = () => element(ui.render(), 'client-goal-input');
  const type = value => input().props.onChange({ target: { value } });
  return { ui, time, calls, details, ack, storage, bridge, mount, input, type,
    navigate(page) {
      ui.unmount(); pageState.page = page;
      const shell = ui.mount(loaded.Me2Shell);
      const containsComposer = node => node?.tag === loaded.GoalComposer || (node?.children?.flat(Infinity) ?? []).some(containsComposer);
      assert.equal(containsComposer(shell), page === 'browser');
      ui.unmount();
    },
    submit: () => element(ui.render(), 'client-goal-submit').props.onClick() };
}

for (const page of ['system', 'tasks']) test(`goal text survives composer unmount for ${page} and return`, async () => {
  const f = composerFixture(); f.mount(); await flush();
  f.type('Retain this unsent goal'); f.navigate(page); f.mount(); await flush();
  assert.equal(f.input().props.value, 'Retain this unsent goal');
  assert.deepEqual(f.calls, []);
});

test('an accepted send cannot clear text entered while the response was pending', async () => {
  const f = composerFixture(); f.mount(); await flush(); f.type('First goal'); f.submit(); await flush();
  assert.deepEqual(f.calls, ['First goal']);
  f.type('Newer draft');
  f.ack.resolve({ schema: 'metaengine.native-coding.pending-goal-admission.v1', state: 'PENDING_ACTIVATION',
    root_state: 'BLOCKED', project_state: 'PAUSED', execution_ready: false, owner_incarnation_verified: false,
    production_qualified: false, automatic_retry_allowed: false, authority_effect: false });
  await flush(); assert.equal(f.input().props.value, 'Newer draft');
});

test('a hung next roster read expires previous LIVE activity without overlapping reads', async () => {
  const ui = harness(), time = clock(), hung = deferred(); let calls = 0;
  const roster = { schema: 'metaengine.browser.primary-chat-fleet-roster.v1', actors: [{ actor_id: 'a', state: 'ACTIVE' }],
    actor_count: 1, supervisor_count: 0, agent_count: 1, selected_actor_id: 'a' };
  const context = environment(ui, time, { metaengineShell: { primaryChatFleetRoster: () => ++calls === 1 ? Promise.resolve(roster) : hung.promise } });
  const { usePrimaryChatRoster } = loadUi('../components/me2/shell/me2-shell.tsx', ['usePrimaryChatRoster'], context);
  ui.mount(usePrimaryChatRoster); await flush(); assert.equal(ui.render().state, 'LIVE');
  await time.advance(12_000);
  assert.equal(calls, 2);
  assert.equal(ui.render().state, 'STALE');
  assert.equal(ui.render().roster.actors[0].actor_id, 'a');
  ui.unmount(); hung.resolve(roster); await flush();
});

test('Observatory deadline cannot release the physical read before it settles', async () => {
  const ui = harness(), time = clock(), hung = deferred(); let calls = 0;
  const context = environment(ui, time, { metaengineOperator: { readContext: () => { calls++; return hung.promise; } } });
  const { OperatorObservatoryPage } = loadUi('../components/me2/pages/operator-observatory.tsx', ['OperatorObservatoryPage'], context);
  ui.mount(OperatorObservatoryPage); await flush();
  await time.advance(12_000);
  assert.equal(calls, 1, 'deadline is not cancellation');
  ui.unmount(); hung.resolve(null); await flush();
});

test('composer restores after a renderer restart without sending the stored goal', async () => {
  const first = composerFixture(); first.mount(); await flush(); first.type('Persist through restart'); first.ui.unmount();
  const restarted = composerFixture({ storage: first.storage }); restarted.mount(); await flush();
  assert.equal(restarted.input().props.value, 'Persist through restart');
  assert.equal(restarted.input().props.maxLength, 480);
  assert.deepEqual(restarted.calls, []); restarted.ui.unmount();
});

test('composer keeps an unsaved draft during storage failure and shows a bounded warning', async () => {
  const f = composerFixture({ storageFails: true }); f.mount(); await flush(); f.type('Keep this in memory');
  const warning = element(f.ui.render(), 'client-goal-draft-warning');
  assert.ok(warning); assert.doesNotMatch(JSON.stringify(warning), /private storage detail/);
  f.navigate('system'); f.mount(); await flush();
  assert.equal(f.input().props.value, 'Keep this in memory');
  assert.deepEqual(f.calls, []); f.ui.unmount();
});

test('draft warning is a labelled native button opening explanation without submission', async () => {
  const f = composerFixture({ storageFails: true }); f.mount(); await flush(); f.type('Do not send on warning activation');
  const warning = element(f.ui.render(), 'client-goal-draft-warning');
  assert.equal(warning.tag, 'button'); assert.equal(warning.props.type, 'button');
  assert.match(warning.props['aria-label'], /Local storage is unavailable/);
  warning.props.onClick({ currentTarget: { isConnected: true } }); await flush(); assert.deepEqual(f.details, [true]); assert.deepEqual(f.calls, []); f.ui.unmount();
});

test('lost submit response and failed readback preserve the draft without repeated sends', async () => {
  const f = composerFixture(); f.mount(); await flush(); f.type('Uncertain goal'); f.submit(); await flush();
  f.bridge.latestGoal = async () => { throw Error('observation failed'); };
  f.ack.reject(Error('response lost')); await flush();
  assert.equal(f.input().props.value, 'Uncertain goal');
  await f.time.advance(20_000); f.navigate('tasks'); f.mount(); await flush();
  assert.equal(f.input().props.value, 'Uncertain goal');
  assert.deepEqual(f.calls, ['Uncertain goal']); f.ui.unmount();
});

test('late acknowledgement after unmount cannot clear or resend a remounted draft', async () => {
  const f = composerFixture(); f.mount(); await flush(); f.type('Original'); f.submit(); await flush();
  assert.equal(f.input().props.disabled, false, 'editing the next draft does not dispatch another goal');
  f.navigate('tasks'); f.mount(); await flush(); f.type('New mount draft');
  f.ack.resolve({ schema: 'metaengine.native-coding.pending-goal-admission.v1', state: 'PENDING_ACTIVATION',
    root_state: 'BLOCKED', project_state: 'PAUSED', execution_ready: false, owner_incarnation_verified: false,
    production_qualified: false, automatic_retry_allowed: false, authority_effect: false });
  await flush(); assert.equal(f.input().props.value, 'New mount draft');
  assert.deepEqual(f.calls, ['Original']); f.ui.unmount();
});

function rosterValue(id = 'agent:a') {
  return { schema: 'metaengine.browser.primary-chat-fleet-roster.v1', actor_count: 1, supervisor_count: 0,
    agent_count: 1, selected_actor_id: id, actors: [{ actor_id: id, actor_type: 'AGENT', state: 'ACTIVE',
      role: 'worker', title: 'Chat', tab_id: 'tab:a', exact_native_binding: true }] };
}

test('hidden roster expires without another poll and rows lose active text and green tone', async () => {
  const ui = harness(), time = clock(); let calls = 0;
  const context = environment(ui, time, { metaengineShell: { primaryChatFleetRoster: async () => { calls++; return rosterValue(); } } });
  const { ChatFleetRail } = loadUi('../components/me2/shell/me2-shell.tsx', ['ChatFleetRail'], context);
  ui.mount(ChatFleetRail, { pickerOpen: false, onPickerOpenChange() {} }); await flush();
  assert.match(JSON.stringify(element(ui.render(), 'chat-agent-row')), /bg-emerald-400/);
  assert.ok(element(ui.render(), 'chat-roster-observed-at'));
  context.document.visibilityState = 'hidden'; await time.advance(6_000);
  const row = element(ui.render(), 'chat-agent-row');
  assert.equal(calls, 1); assert.equal(row.props.disabled, true);
  assert.match(JSON.stringify(row), /Status stale/); assert.doesNotMatch(JSON.stringify(row), /bg-emerald-400/);
  ui.unmount();
});

test('chat selection still requires its own exact acknowledgement and stale rows cannot select', async () => {
  const ui = harness(), time = clock(), selections = [], closed = [];
  const context = environment(ui, time, {
    metaengineShell: { primaryChatFleetRoster: async () => rosterValue() },
    metaengineClient: { selectAgent: async id => { selections.push(id); return { selection_applied: true,
      exact_native_binding: true, actor_id: 'agent:wrong', tab_id: 'tab:a' }; } },
  });
  const { ChatFleetRail } = loadUi('../components/me2/shell/me2-shell.tsx', ['ChatFleetRail'], context);
  ui.mount(ChatFleetRail, { pickerOpen: false, onPickerOpenChange: value => closed.push(value) }); await flush();
  element(ui.render(), 'chat-agent-row').props.onClick(); await flush();
  assert.deepEqual(selections, ['a']); assert.deepEqual(closed, []);
  assert.match(JSON.stringify(ui.render()), /selection was not confirmed/);
  context.document.visibilityState = 'hidden'; await time.advance(6_000);
  element(ui.render(), 'chat-agent-row').props.onClick(); await flush();
  assert.deepEqual(selections, ['a']); ui.unmount();
});

test('roster late result cannot populate a new mount; slot recovers only after settlement', async () => {
  const ui = harness(), time = clock(), old = deferred(); let calls = 0;
  const context = environment(ui, time, { metaengineShell: { primaryChatFleetRoster: () => ++calls === 1 ? old.promise : Promise.resolve(rosterValue('agent:new')) } });
  const { usePrimaryChatRoster } = loadUi('../components/me2/shell/me2-shell.tsx', ['usePrimaryChatRoster'], context);
  ui.mount(usePrimaryChatRoster); await flush(); ui.unmount(); ui.mount(usePrimaryChatRoster); await flush();
  assert.equal(calls, 1); old.resolve(rosterValue('agent:old')); await flush();
  assert.equal(ui.render().roster.actors.length, 0);
  await time.advance(2_000); assert.equal(calls, 2);
  assert.equal(ui.render().roster.actors[0].actor_id, 'agent:new'); ui.unmount();
});

test('a late timed-out roster result cannot renew freshness; a new read can', async () => {
  const ui = harness(), time = clock(), slow = deferred(); let calls = 0;
  const context = environment(ui, time, { metaengineShell: { primaryChatFleetRoster: () => ++calls === 2 ? slow.promise : Promise.resolve(rosterValue()) } });
  const { usePrimaryChatRoster } = loadUi('../components/me2/shell/me2-shell.tsx', ['usePrimaryChatRoster'], context);
  ui.mount(usePrimaryChatRoster); await flush(); const first = ui.render().observedAt;
  await time.advance(10_000); assert.equal(ui.render().state, 'STALE'); assert.equal(calls, 2);
  slow.resolve(rosterValue()); await flush(); assert.equal(ui.render().observedAt, first);
  assert.equal(ui.render().state, 'STALE'); await time.advance(2_000);
  assert.equal(ui.render().state, 'LIVE'); assert.equal(calls, 3); assert.ok(ui.render().observedAt > first); ui.unmount();
});

function observatoryFixture() {
  const ui = harness(), time = clock(), reads = [], accepted = [];
  const context = environment(ui, time, { metaengineOperator: { readContext: () => { const read = deferred(); reads.push(read); return read.promise; } } });
  // Keep the real reducer; additionally record whether old native replies reach it.
  context.advanceOperatorObservatoryResync = (previous, value, options) => {
    if (value !== null) accepted.push(value);
    return resync.advanceOperatorObservatoryResync(previous, value, { ...options, nowMs: time.now() });
  };
  const { OperatorObservatoryPage } = loadUi('../components/me2/pages/operator-observatory.tsx', ['OperatorObservatoryPage'], context);
  return { ui, time, reads, accepted, mount: scope => ui.mount(OperatorObservatoryPage, { observationScope: scope }),
    refresh: () => element(ui.render(), 'operator-observatory-refresh').props.onClick() };
}

test('Observatory timeout ignores late success and manual refresh cannot overlap; next settled poll recovers', async () => {
  const f = observatoryFixture(); f.mount('A'); await flush(); await f.time.advance(2_500);
  const phase = element(f.ui.render(), 'operator-primary-phase');
  assert.match(JSON.stringify(phase), /TIMED_OUT/);
  f.refresh(); f.refresh(); await flush(); assert.equal(f.reads.length, 1);
  f.reads[0].resolve({ old: true }); await flush(); assert.deepEqual(f.accepted, []);
  await f.time.advance(2_500); assert.equal(f.reads.length, 2);
  f.reads[1].resolve({ current: true }); await flush(); assert.deepEqual(f.accepted, [{ current: true }]); f.ui.unmount();
});

for (const change of ['scope', 'remount']) test(`Observatory ${change} invalidates pending result without releasing its slot`, async () => {
  const f = observatoryFixture(); f.mount('A'); await flush();
  if (change === 'remount') { f.ui.unmount(); f.mount('B'); }
  else f.ui.render({ observationScope: 'B' });
  await flush(); f.refresh(); await f.time.advance(5_000); assert.equal(f.reads.length, 1);
  f.reads[0].resolve({ oldScope: 'A' }); await flush(); assert.deepEqual(f.accepted, []);
  await f.time.advance(5_000); assert.equal(f.reads.length, 2);
  f.reads[1].resolve({ newScope: 'B' }); await flush(); assert.deepEqual(f.accepted, [{ newScope: 'B' }]); f.ui.unmount();
});

test('Observatory late rejection after timeout is consumed and a later read can recover', async () => {
  const f = observatoryFixture(); f.mount('A'); await flush(); await f.time.advance(2_500);
  f.reads[0].reject(Error('private backend detail')); await flush();
  assert.doesNotMatch(JSON.stringify(f.ui.render()), /private backend detail/);
  await f.time.advance(2_500); assert.equal(f.reads.length, 2);
  f.reads[1].resolve(null); await flush(); f.ui.unmount();
});

test('draft hook isolates identity/project changes and never migrates unbound text', () => {
  const ui = harness(), time = clock(), records = new Map();
  const context = environment(ui, time, { localStorage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) } });
  const a = { principalId: 'A', workspaceId: 'same', projectId: 'one' };
  const b = { ...a, principalId: 'B' }, c = { ...a, projectId: 'two' };
  ui.mount(props => context.useGoalDraft(props.scope), { scope: null });
  ui.render().setGoal('Unbound');
  let view = ui.render({ scope: a }); assert.equal(view.goal, ''); view.setGoal('Draft A');
  const acknowledgeA = ui.render().acknowledgeGoal;
  view = ui.render({ scope: b }); assert.equal(view.goal, ''); view.setGoal('Draft B');
  acknowledgeA(); assert.equal(ui.render().goal, 'Draft B');
  view = ui.render({ scope: c }); assert.equal(view.goal, ''); view.setGoal('Project two');
  view = ui.render({ scope: b }); assert.equal(view.goal, 'Draft B');
  view = ui.render({ scope: null }); assert.equal(view.goal, ''); assert.equal(view.draftStorage, 'UNBOUND'); ui.unmount();
});

test('actual shell retains an unbound draft across Settings/Tasks without touching storage', async () => {
  const ui = harness(), time = clock(); let storageCalls = 0;
  const state = { page: 'browser', init() {}, paletteOpen: false, recentPages: [], setPage() {} };
  const context = environment(ui, time);
  Object.defineProperty(context.window, 'localStorage', { get() { storageCalls++; throw Error('unconfirmed scope'); } });
  context.useMe2 = select => select(state);
  const loaded = loadUi('../components/me2/shell/me2-shell.tsx', ['Me2Shell', 'GoalComposer'], context);
  const findComposer = tree => {
    if (tree?.tag === loaded.GoalComposer) return tree;
    for (const child of tree?.children?.flat(Infinity) ?? []) { const found = findComposer(child); if (found) return found; }
  };
  let tree = ui.mount(loaded.Me2Shell); await flush();
  findComposer(ui.render()).props.draft.setGoal('Unbound, retained in this shell');
  for (const page of ['system', 'tasks']) { state.page = page; tree = ui.render(); assert.equal(findComposer(tree), undefined); }
  state.page = 'browser'; const composer = findComposer(ui.render());
  assert.equal(composer.props.draft.goal, 'Unbound, retained in this shell');
  assert.equal(composer.props.draft.draftStorage, 'UNBOUND'); assert.equal(storageCalls, 0); ui.unmount();
});

test('production page fails closed without a confirmed scope, including after reload', async () => {
  // This exercises the real caller. Positive reload restoration is still
  // BLOCKED on a native scope contract; historical/status IDs cannot supply it.
  let storageCalls = 0, submits = 0;
  const saved = { schema: draft.GOAL_DRAFT_SCHEMA, principal_id: 'another-principal',
    workspace_id: 'workspace', project_id: 'same-project', text: 'Private earlier draft' };
  for (let reload = 0; reload < 2; reload++) {
    const ui = harness(), time = clock();
    const context = environment(ui, time, {
      metaengineClient: { latestGoal: async () => ({ project: { project_id: saved.project_id } }),
        connectionStatus: async () => ({ device_enrolled: true, admin_ready: true }),
        submitGoal: async () => { submits++; } },
      metaengineOperator: { readContext: async () => ({ owner_id: saved.principal_id }) },
      localStorage: { getItem: () => { storageCalls++; return JSON.stringify(saved); },
        setItem: () => { storageCalls++; } },
    });
    const state = { page: 'browser', init() {}, paletteOpen: false, recentPages: [], setPage() {} };
    context.useMe2 = select => select(state);
    const shell = loadUi('../components/me2/shell/me2-shell.tsx', ['Me2Shell', 'GoalComposer'], context);
    const { Page } = loadUi('../app/page.tsx', ['Page'], { ...context, Me2Shell: shell.Me2Shell });
    const page = Page();
    ui.mount(page.tag, page.props); await flush();
    const composer = () => ui.render().children.flat(Infinity).find(child => child?.tag === shell.GoalComposer);
    assert.equal(composer().props.draft.goal, '');
    assert.equal(composer().props.draft.draftStorage, 'UNBOUND');
    composer().props.draft.setGoal('Unconfirmed text stays in this shell');
    state.page = 'system'; ui.render(); state.page = 'browser';
    assert.equal(composer().props.draft.goal, 'Unconfirmed text stays in this shell');
    ui.unmount();
  }
  assert.equal(storageCalls, 0); assert.equal(submits, 0);
});

test('actual shell remounts the composer when its confirmed identity or project changes', () => {
  const ui = harness(), time = clock(), records = new Map();
  const state = { page: 'browser', init() {}, paletteOpen: false, recentPages: [], setPage() {} };
  const context = environment(ui, time, { localStorage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) } });
  context.useMe2 = select => select(state);
  const loaded = loadUi('../components/me2/shell/me2-shell.tsx', ['Me2Shell', 'GoalComposer'], context);
  const composer = tree => tree.children.flat(Infinity).find(child => child?.tag === loaded.GoalComposer);
  const scope = { principalId: 'A', workspaceId: 'one', projectId: null };
  const first = composer(ui.mount(loaded.Me2Shell, { draftScope: scope }));
  first.props.draft.setGoal('Principal A draft');
  const second = composer(ui.render({ draftScope: { ...scope, principalId: 'B' } }));
  assert.notEqual(first.props.key, second.props.key); assert.equal(second.props.draft.goal, '');
  const third = composer(ui.render({ draftScope: { ...scope, principalId: 'B', projectId: 'new' } }));
  assert.notEqual(second.props.key, third.props.key); assert.equal(third.props.draft.goal, '');
  ui.unmount();
});

function verifiedContext(now, seq = 10) {
  const at = new Date(now).toISOString(), run = 'run:ui', owner = 'owner:ui', sha = 'a'.repeat(40), proof = 'b'.repeat(64);
  return { schema: 'metaengine.operator.context.v1', scope: 'READ_ONLY', storage: 'OWN_POSTGRES_ONLY', authority_effect: false,
    scheduler_authority: false, automatic_retry_allowed: false, remote_fallback_allowed: false, cloud_database_dependency: false,
    generated_at: at, run_id: run, owner_id: owner, owner_epoch: 7, source_sha: sha, event_seq: seq, proof_identity: proof,
    planes: {
      database: { state: 'AVAILABLE', source: 'LOCAL_POSTGRES', fresh: true, proof: 'TRUSTED_READBACK', observed_at: at },
      source: { state: 'AVAILABLE', source: 'EXACT_GIT_READBACK', proof: 'TRUSTED_READBACK', fresh: true, proven: true,
        observed_at: at, run_id: run, owner_id: owner, owner_epoch: 7, source_sha: sha },
      continuity: { state: 'AVAILABLE', source: 'LOCAL_CHECKPOINT_LEDGER', proof: 'TRUSTED_READBACK', fresh: true, proven: true,
        observed_at: at, run_id: run, owner_id: owner, owner_epoch: 7, event_seq: seq, proof_identity: proof },
    } };
}

test('Observatory really recovers to a verified frame after timeout, without an implicit resync', async () => {
  const f = observatoryFixture(); f.mount('A'); await flush();
  f.reads[0].resolve(verifiedContext(f.time.now())); await flush();
  assert.match(JSON.stringify(element(f.ui.render(), 'operator-primary-phase')), /TRACKING/);
  await f.time.advance(7_500); assert.equal(f.reads.length, 2);
  f.reads[1].resolve(verifiedContext(f.time.now())); await flush();
  assert.equal(f.accepted.length, 1, 'late valid evidence is still discarded');
  await f.time.advance(2_500); assert.equal(f.reads.length, 3);
  f.reads[2].resolve(verifiedContext(f.time.now(), 11)); await flush();
  assert.match(JSON.stringify(element(f.ui.render(), 'operator-primary-phase')), /TRACKING/); f.ui.unmount();
});

test('Observatory explicit reconciliation fence still blocks automatic reads', async () => {
  const f = observatoryFixture(); f.mount('A'); await flush(); f.reads[0].resolve(verifiedContext(f.time.now())); await flush();
  f.refresh(); await flush(); f.reads[1].resolve(verifiedContext(f.time.now(), 13)); await flush();
  assert.ok(element(f.ui.render(), 'operator-observatory-explicit-resync'));
  await f.time.advance(20_000); f.refresh(); await flush(); assert.equal(f.reads.length, 2);
  element(f.ui.render(), 'operator-observatory-explicit-resync').props.onClick(); await flush(); assert.equal(f.reads.length, 3);
  f.reads[2].resolve(verifiedContext(f.time.now(), 13)); await flush();
  assert.ok(element(f.ui.render(), 'operator-observatory-explicit-resync'), 'clicking without a source-bound witness does not clear the fence'); f.ui.unmount();
});
