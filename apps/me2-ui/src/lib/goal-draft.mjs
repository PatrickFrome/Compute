export const GOAL_DRAFT_SCHEMA = 'metaengine.ui.goal-draft.v1';
export const GOAL_DRAFT_MAX_LENGTH = 480;
export const GOAL_DRAFT_MAX_RECORD_LENGTH = 8_192;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 192 && !/[\u0000-\u001f\u007f]/.test(value);

export function goalDraftStorageKey(scope) {
  if (!id(scope?.principalId) || !id(scope?.workspaceId) || !(scope.projectId === null || id(scope.projectId))) throw Error('goal_draft_scope_invalid');
  return `${GOAL_DRAFT_SCHEMA}:${JSON.stringify([scope.principalId, scope.workspaceId, scope.projectId])}`;
}

// Local text only. This store has no bridge, submit, retry, or execution API.
export function createGoalDraftStore(scope, { storage = () => window.localStorage } = {}) {
  const key = scope === null ? null : goalDraftStorageKey(scope);
  const identity = scope === null ? null : Object.freeze({ principalId: scope.principalId, workspaceId: scope.workspaceId, projectId: scope.projectId });
  const initial = Object.freeze({ text: '', revision: 0, storage: identity ? 'LOADING' : 'UNBOUND' });
  let snapshot = initial, loaded = false;
  const listeners = new Set();
  const publish = patch => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  };
  const restore = () => {
    if (loaded) return;
    loaded = true;
    if (!identity) return;
    try {
      const raw = storage().getItem(key);
      if (raw === null) { publish({ storage: 'SAVED' }); return; }
      if (typeof raw !== 'string' || raw.length > GOAL_DRAFT_MAX_RECORD_LENGTH) throw Error('invalid');
      const record = JSON.parse(raw);
      if (record?.schema !== GOAL_DRAFT_SCHEMA || record.principal_id !== identity.principalId || record.workspace_id !== identity.workspaceId
        || record.project_id !== identity.projectId || typeof record.text !== 'string' || record.text.length > GOAL_DRAFT_MAX_LENGTH
        || Object.keys(record).sort().join(',') !== 'principal_id,project_id,schema,text,workspace_id') throw Error('invalid');
      publish({ text: record.text, storage: 'SAVED' });
    } catch { publish({ storage: 'UNAVAILABLE' }); }
  };
  const write = text => {
    restore();
    if (typeof text !== 'string' || text.length > GOAL_DRAFT_MAX_LENGTH) return false;
    let persisted = identity ? 'SAVED' : 'UNBOUND';
    try {
      if (identity) {
        storage().setItem(key, JSON.stringify({ schema: GOAL_DRAFT_SCHEMA, principal_id: identity.principalId, workspace_id: identity.workspaceId,
          project_id: identity.projectId, text }));
      }
    } catch { persisted = 'UNAVAILABLE'; }
    // Every input gets a revision, including edit-away/edit-back (ABA).
    publish({ text, revision: snapshot.revision + 1, storage: persisted });
    return true;
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener) {
      listeners.add(listener); restore();
      return () => { listeners.delete(listener); };
    },
    write,
    clearIfUnchanged(revision) {
      if (snapshot.revision !== revision) return false;
      return write('');
    },
  });
}
