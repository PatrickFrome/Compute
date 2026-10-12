import { DatabaseSync } from 'node:sqlite';

/** Deterministic database provider fixture. It never opens a ChatGPT session. */
export function createAutonomousProjectProviderFixture({ filePath, projectId, rootTask, capacity = 8, afterCommit = null } = {}) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS batches(request_id TEXT PRIMARY KEY,body TEXT NOT NULL,receipt TEXT NOT NULL);');
  if (!db.prepare('SELECT 1 FROM state WHERE id=1').get()) db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({ project_id: projectId, root_task_id: rootTask.task_id, state: 'ACTIVE', policy: {}, tasks: [rootTask], entries: [], physical_provider_creations: 0 }));
  const read = () => JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);
  const write = state => db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
  let counter = read().tasks.length;
  const uuid = () => `cccccccc-cccc-4ccc-8ccc-${String(++counter).padStart(12, '0')}`;
  return {
    read,
    update(fn) { const state = read(); fn(state); write(state); },
    async request({ path, body }) {
      const state = read();
      const selected = state.tasks.find(row => row.task_id === (body.task_id || body.parent_task_id));
      if (path.endsWith('/reconcile')) return body.project_id === null
        ? { schema: 'metaengine.devos.project-reconcile.v1', project_id: null, projects: [], bounded_projects: 4, authority_effect: false }
        : { schema: 'metaengine.devos.project-reconcile.v1', project_id: state.project_id, authority_effect: false };
      if (path.endsWith('/snapshot')) return { schema: 'metaengine.devos.project-snapshot.v1', found: Boolean(selected), ...state,
        selected_task: selected, immediate_children: selected ? state.tasks.filter(row => row.parent_task_id === selected.task_id) : [], proposals: [], authority_effect: false };
      if (path.endsWith('/history')) {
        const entries = state.entries.filter(row => row.seq > body.after_seq).slice(0, body.limit);
        return { schema: 'metaengine.devos.project-history.v1', project_id: state.project_id, entries,
          cursor: { after_seq: body.after_seq, through_seq: state.entries.length,
            next_seq: entries.at(-1)?.seq ?? body.after_seq, has_more: entries.at(-1)?.seq < state.entries.length, commit_ordered: true }, authority_effect: false };
      }
      if (!selected || selected.claim_id !== body.claim_id || selected.lease_generation !== body.lease_generation || state.policy.owner_stop) throw new Error('FIXTURE_PARENT_FENCED');
      if (path.endsWith('/spawn')) {
        const existing = db.prepare('SELECT * FROM batches WHERE request_id=?').get(body.request_id);
        if (existing) {
          if (existing.body !== JSON.stringify(body)) throw new Error('FIXTURE_IMMUTABLE_BATCH_CONFLICT');
          return { ...JSON.parse(existing.receipt), replayed: true };
        }
        const children = body.children.map((child, child_index) => {
          if (state.tasks.length >= capacity) return { child_index, task_id: null, depth: selected.depth + 1, status: 'CAPACITY_WAIT', wait_reason: 'FIXTURE_CAPACITY' };
          const task_id = uuid();
          state.tasks.push({ task_id, parent_task_id: selected.task_id, root_task_id: state.root_task_id,
            depth: selected.depth + 1, state: 'RUNNING', role: child.role, objective: child.objective,
            agent_id: `agent_child-fixture-${counter}`, claim_id: counter + 10, lease_generation: 1,
            task_spec: { project_continuity: { project_id: state.project_id, depth: selected.depth + 1 } } });
          state.entries.push({ seq: state.entries.length + 1, event_type: 'CHILD_TASK_ADMITTED', task_id,
            parent_task_id: selected.task_id, source: 'DETERMINISTIC_PROVIDER_FIXTURE', verified_evidence: false });
          return { child_index, task_id, depth: selected.depth + 1, status: 'ADMITTED', wait_reason: null };
        });
        const receipt = { schema: 'metaengine.devos.project-spawn.v1', project_id: state.project_id,
          request_id: body.request_id, parent_task_id: selected.task_id, replayed: false, children, proposals_preserved: true, authority_effect: false };
        db.exec('BEGIN IMMEDIATE');
        try { write(state); db.prepare('INSERT INTO batches VALUES(?,?,?)').run(body.request_id, JSON.stringify(body), JSON.stringify(receipt)); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
        if (afterCommit) await afterCommit(receipt);
        return receipt;
      }
      if (path.endsWith('/activity')) return { schema: 'metaengine.devos.project-activity.v1', recorded: true, authority_effect: false };
      throw new Error('FIXTURE_ROUTE_UNKNOWN');
    },
    close() { db.close(); },
  };
}
