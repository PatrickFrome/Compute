import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalSubmissionModeObserver, goalSubmissionModeText, shouldPollClientGoal } from './goal-submission-mode-observer.mjs';

test('a durable pre-dispatch rejection stops polling without hiding active or ambiguous requests',()=>{
 const rejected={request_id:'old',kind:'NATIVE_CODING',state:'FAILED',last_error:'native_goal_rejected_before_dispatch',
  native_rejection:{schema:'metaengine.native-coding.seed-rejection.v1',state:'REJECTED_BEFORE_DISPATCH'},progress:null};
 assert.equal(shouldPollClientGoal(rejected,null),false);
 for(const change of [{state:'RECONCILE_REQUIRED'},{last_error:'other'}, {native_rejection:null},
  {native_rejection:{schema:'other',state:'REJECTED_BEFORE_DISPATCH'}}, {kind:'BROWSER'}])
  assert.equal(shouldPollClientGoal({...rejected,...change},null),true);
 assert.equal(shouldPollClientGoal(null,null),false);
 assert.equal(shouldPollClientGoal({request_id:'new',kind:'NATIVE_CODING',state:'RUNNING',progress:null},null),true);
 assert.equal(shouldPollClientGoal({request_id:'new',kind:'NATIVE_CODING',progress:{terminal:true}},null),false);
});

const ready = Object.freeze({
  schema: 'metaengine.client.goal-submission-mode.v1', kind: 'NATIVE_CODING',
  state: 'HOST_VERIFICATION_REQUIRED', reason: null,
  automatic_retry_allowed: false, authority_effect: false,
});
const hold = reason => ({ ...ready, state: 'HOLD', reason });
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('slow mode read survives repeated runtime ticks and replaces an earlier HOLD', async () => {
  const slow = deferred(), published = [];
  let calls = 0;
  const observer = createGoalSubmissionModeObserver({
    read: () => ++calls === 1 ? Promise.resolve(hold('NATIVE_PROFILE_STATUS_UNAVAILABLE')) : slow.promise,
    publish: mode => published.push(mode),
  });
  const stop = observer.start();
  await observer.refresh();
  assert.equal(published.at(-1).state, 'HOLD');
  const pending = observer.refresh();
  await tick();
  for (let i = 0; i < 8; i++) {
    assert.equal(observer.refresh(), pending, 'a runtime tick joins the actual pending read');
    await tick();
  }
  assert.equal(calls, 2);
  slow.resolve(ready);
  assert.deepEqual(await pending, ready);
  assert.equal(published.length, 2);
  assert.deepEqual(published.at(-1), ready);
  stop();
});

test('explicit fresh check starts a new read and an older HOLD cannot overwrite it', async () => {
  const old = deferred(), fresh = deferred(), published = [];
  let calls = 0;
  const observer = createGoalSubmissionModeObserver({
    read: () => ++calls === 1 ? old.promise : fresh.promise,
    publish: mode => published.push(mode),
  });
  const stop = observer.start();
  const polling = observer.refresh();
  await tick();
  const explicit = observer.refresh({ fresh: true });
  await tick();
  assert.notEqual(explicit, polling);
  assert.equal(calls, 2, 'the user action cannot reuse a read started before it');
  assert.equal(observer.refresh(), explicit, 'later ticks join the newer explicit read');
  fresh.resolve(ready);
  assert.deepEqual(await explicit, ready);
  old.resolve(hold('NATIVE_PROFILE_STATUS_TIMEOUT'));
  await polling;
  assert.deepEqual(published, [ready]);
  stop();
});

test('older positive response neither replaces a newer HOLD nor returns permission to its caller', async () => {
  const old = deferred(), fresh = deferred(), published = [];
  let calls = 0;
  const observer = createGoalSubmissionModeObserver({
    read: () => ++calls === 1 ? old.promise : fresh.promise,
    publish: mode => published.push(mode),
  });
  const stop = observer.start();
  const before = observer.refresh();
  await tick();
  const after = observer.refresh({ fresh: true });
  const blocked = hold('NATIVE_PROFILE_BUSY');
  fresh.resolve(blocked);
  assert.deepEqual(await after, blocked);
  old.resolve(ready);
  assert.equal((await before).state, 'HOLD');
  assert.deepEqual(published, [blocked]);
  stop();
});

test('unmount fences pending results and stopped reads; a new mount rejects the old epoch', async () => {
  const old = deferred(), current = deferred(), published = [];
  let calls = 0;
  const observer = createGoalSubmissionModeObserver({
    read: () => ++calls === 1 ? old.promise : current.promise,
    publish: mode => published.push(mode),
  });
  const stopOld = observer.start();
  const before = observer.refresh();
  await tick();
  stopOld();
  assert.equal((await observer.refresh({ fresh: true })).state, 'HOLD');
  assert.equal(calls, 1, 'unmounted checks perform no I/O');
  const stopCurrent = observer.start();
  const after = observer.refresh();
  stopOld();
  current.resolve(hold('NATIVE_PROFILE_CAPABILITY_UNAVAILABLE'));
  await after;
  old.resolve(ready);
  assert.equal((await before).state, 'HOLD');
  assert.equal(published.length, 1);
  assert.equal(published[0].reason, 'NATIVE_PROFILE_CAPABILITY_UNAVAILABLE');
  stopCurrent();
});

test('cleanup before read dispatch prevents even the obsolete readonly call', async () => {
  let calls = 0;
  const published = [];
  const observer = createGoalSubmissionModeObserver({
    read: async () => { calls++; return ready; },
    publish: mode => published.push(mode),
  });
  const stop = observer.start();
  const pending = observer.refresh();
  stop();
  assert.equal((await pending).state, 'HOLD');
  assert.equal(calls, 0);
  assert.equal(published.length, 0);
});

test('failed observation removes cached positive state and exposes no raw transport error', async () => {
  let fail = false;
  const published = [];
  const observer = createGoalSubmissionModeObserver({
    read: async () => { if (fail) throw Error('private-path-and-credential'); return ready; },
    publish: mode => published.push(mode),
  });
  const stop = observer.start();
  await observer.refresh();
  fail = true;
  const mode = await observer.refresh({ fresh: true });
  assert.equal(mode.kind, 'NATIVE_CODING');
  assert.equal(mode.state, 'HOLD');
  assert.equal(mode.reason, 'GOAL_SUBMISSION_MODE_UNAVAILABLE');
  assert.equal(mode.authority_effect, false);
  assert.equal(mode.automatic_retry_allowed, false);
  assert.doesNotMatch(JSON.stringify(published), /private-path|credential/);
  stop();
});

test('malformed or authority-bearing readback cannot replace HOLD with a positive mode', async () => {
  for (const invalid of [null, {}, { ...ready, authority_effect: true }, { ...ready, automatic_retry_allowed: true },
    { ...ready, state: 'READY' }, { ...ready, kind: 'UNAVAILABLE' }, { ...ready, reason: 'HIDDEN_HOLD' },
    { ...ready, project_id: '../../private' }, hold('private error message')]) {
    const published = [];
    const observer = createGoalSubmissionModeObserver({ read: async () => invalid, publish: mode => published.push(mode) });
    const stop = observer.start();
    const mode = await observer.refresh();
    assert.equal(mode.state, 'HOLD');
    assert.equal(mode.reason, 'GOAL_SUBMISSION_MODE_UNAVAILABLE');
    assert.deepEqual(published, [mode]);
    stop();
  }
});

test('native diagnostics explain bounded causes without echoing unknown errors', () => {
  const causes = [
    ['NATIVE_PROFILE_CAPABILITY_UNAVAILABLE', 'Native profile is not loaded'],
    ['NATIVE_PROFILE_STATUS_TIMEOUT', 'Native admission check timed out'],
    ['NATIVE_PROFILE_HOST_UNAVAILABLE', 'Native runtime disconnected'],
    ['NATIVE_PROFILE_VERIFICATION_FAILED', 'Native profile verification failed'],
    ['NATIVE_PROFILE_BUSY', 'Current native project is active'],
  ];
  for (const [reason, label] of causes) {
    assert.equal(goalSubmissionModeText(hold(reason)).label, label);
    assert.ok(goalSubmissionModeText(hold(reason)).detail.length > label.length);
  }
  for (const reason of ['private-path-and-credential', 'constructor', undefined]) {
    const text = goalSubmissionModeText(hold(reason));
    assert.equal(text.label, 'Admission on hold');
    assert.doesNotMatch(JSON.stringify(text), /private-path|credential|constructor/);
  }
  assert.match(goalSubmissionModeText(ready).detail, /does not prove execution/);
});

test('native admission explains the CLI executor without claiming chat pickup or execution',()=>{
 const text=goalSubmissionModeText(ready);
 assert.match(text.label,/Codex CLI/);
 assert.match(text.detail,/Chat sessions/);
 assert.match(text.detail,/does not prove execution/);
});

test('chat-led profile explains the planned handoff without claiming execution',async()=>{
 const mode={...ready,coordination_mode:'CHAT_LED'};
 const observer=createGoalSubmissionModeObserver({read:async()=>mode,publish:()=>{}}),stop=observer.start();
 try{
  const result=await observer.refresh();assert.equal(result.coordination_mode,'CHAT_LED');
  const text=goalSubmissionModeText(result);assert.match(text.label,/Chat planner.*Codex CLI.*CRITIC/);
  assert.match(text.detail,/does not prove execution or review/);
 }finally{stop();}
});
