import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalDraftStore, goalDraftStorageKey, GOAL_DRAFT_SCHEMA, GOAL_DRAFT_MAX_LENGTH, GOAL_DRAFT_MAX_RECORD_LENGTH } from './goal-draft.mjs';

const scope = { principalId: 'principal:one', workspaceId: 'workspace:one', projectId: 'project:one' };
function fixture() {
  const records = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const open = (target = scope, source = () => storage) => {
    const store = createGoalDraftStore(target, { storage: source });
    store.subscribe(() => {});
    return store;
  };
  return { records, storage, open };
}

test('draft survives a fresh store/restart with an explicit bounded schema and no effect metadata', () => {
  const f = fixture(), first = f.open();
  const text = '  Keep whitespace and русский текст\nSecond line  ';
  assert.equal(first.write(text), true);
  assert.equal(f.open().getSnapshot().text, text);
  const record = JSON.parse(f.records.get(goalDraftStorageKey(scope)));
  assert.deepEqual(record, { schema: GOAL_DRAFT_SCHEMA, principal_id: scope.principalId, workspace_id: scope.workspaceId, project_id: scope.projectId, text });
  assert.ok(JSON.stringify(record).length <= GOAL_DRAFT_MAX_RECORD_LENGTH);
});

test('workspace and project drafts cannot overwrite or restore each other', () => {
  const f = fixture(), a = f.open(), bScope = { ...scope, projectId: 'project:two' }, cScope = { ...scope, workspaceId: 'workspace:two' };
  a.write('A'); f.open(bScope).write('B'); f.open(cScope).write('C');
  assert.equal(f.open().getSnapshot().text, 'A');
  assert.equal(f.open(bScope).getSnapshot().text, 'B');
  assert.equal(f.open(cScope).getSnapshot().text, 'C');
  assert.notEqual(goalDraftStorageKey({ principalId: 'p', workspaceId: 'a:b', projectId: 'c' }), goalDraftStorageKey({ principalId: 'p', workspaceId: 'a', projectId: 'b:c' }));
});

test('a different principal cannot read or clear another principal draft in the same workspace', () => {
  const f = fixture(), original = f.open(); original.write('Private A');
  const other = f.open({ ...scope, principalId: 'principal:two' });
  assert.equal(other.getSnapshot().text, ''); other.write('Private B');
  original.clearIfUnchanged(original.getSnapshot().revision);
  assert.equal(f.open({ ...scope, principalId: 'principal:two' }).getSnapshot().text, 'Private B');
});

test('unknown identity never reads or writes persistent storage and cannot restore on restart', () => {
  let calls = 0;
  const options = { storage: () => { calls++; throw Error('must not touch storage'); } };
  const unbound = createGoalDraftStore(null, options); unbound.subscribe(() => {}); unbound.write('Unbound text');
  assert.equal(unbound.getSnapshot().text, 'Unbound text');
  assert.equal(unbound.getSnapshot().storage, 'UNBOUND');
  const restarted = createGoalDraftStore(null, options); restarted.subscribe(() => {});
  assert.equal(restarted.getSnapshot().text, ''); assert.equal(calls, 0);
  assert.throws(() => goalDraftStorageKey({ workspaceId: scope.workspaceId, projectId: scope.projectId }), /scope_invalid/);
});

test('unchanged accepted draft clears durably; edits including ABA survive the older acknowledgement', () => {
  const f = fixture(), store = f.open();
  store.write('A'); const old = store.getSnapshot().revision;
  store.write('B'); store.write('A');
  assert.equal(store.clearIfUnchanged(old), false);
  assert.equal(f.open().getSnapshot().text, 'A');
  assert.equal(store.clearIfUnchanged(store.getSnapshot().revision), true);
  assert.equal(f.open().getSnapshot().text, '');
});

test('480-character payload boundary remains enforced without truncating an existing draft', () => {
  const f = fixture(), store = f.open();
  const exact = 'x'.repeat(480);
  assert.equal(GOAL_DRAFT_MAX_LENGTH, 480);
  assert.equal(store.write(exact), true);
  assert.equal(store.write(exact + 'x'), false);
  assert.equal(store.getSnapshot().text, exact);
  assert.equal(f.open().getSnapshot().text, exact);
});

for (const failure of ['get', 'set', 'access']) test(`storage ${failure} failure preserves the in-memory draft and reports it unsaved`, () => {
  const f = fixture(); let failed = true;
  const storage = {
    getItem: key => { if (failed && failure === 'get') throw Error('private detail'); return f.storage.getItem(key); },
    setItem: (key, value) => { if (failed && failure === 'set') throw Error('private detail'); f.storage.setItem(key, value); },
  };
  const store = f.open(scope, () => { if (failed && failure === 'access') throw Error('private detail'); return storage; });
  store.write('Retained locally');
  assert.equal(store.getSnapshot().text, 'Retained locally');
  if (failure !== 'get') assert.equal(store.getSnapshot().storage, 'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /private detail/);
  failed = false; store.write('Saved after recovery');
  assert.equal(store.getSnapshot().storage, 'SAVED');
  assert.equal(f.open().getSnapshot().text, 'Saved after recovery');
});

for (const invalid of ['{', ' '.repeat(GOAL_DRAFT_MAX_RECORD_LENGTH + 1),
  JSON.stringify({ schema: GOAL_DRAFT_SCHEMA, principal_id: scope.principalId, workspace_id: 'other', project_id: scope.projectId, text: 'foreign' }),
  JSON.stringify({ schema: GOAL_DRAFT_SCHEMA, principal_id: scope.principalId, workspace_id: scope.workspaceId, project_id: scope.projectId, text: 'x'.repeat(481) }),
  JSON.stringify({ schema: GOAL_DRAFT_SCHEMA, principal_id: scope.principalId, workspace_id: scope.workspaceId, project_id: scope.projectId, text: 'x', execution_ready: true }),
]) test('malformed, foreign, oversized or authority-bearing storage is not restored', () => {
  const f = fixture(); f.records.set(goalDraftStorageKey(scope), invalid);
  const store = f.open();
  assert.equal(store.getSnapshot().text, '');
  assert.equal(store.getSnapshot().storage, 'UNAVAILABLE');
  assert.equal(f.records.get(goalDraftStorageKey(scope)), invalid, 'a read does not silently destroy malformed storage');
});
