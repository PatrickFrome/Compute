const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new Error(`client_project_${code}`); };
const count = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const id = value => typeof value === 'string' && UUID.test(value);
const text = (value, max = 240) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

export function normalizeClientProjectRegistration(value, requestId) {
  if (!object(value) || value.schema !== 'metaengine.devos.project-registration.v1' || value.authority_effect !== false
      || !id(value.project_id) || !id(value.root_task_id) || value.request_id !== requestId
      || typeof value.replayed !== 'boolean') fail('registration_invalid');
  return Object.freeze({ schema: value.schema, project_id: value.project_id.toLowerCase(), root_task_id: value.root_task_id.toLowerCase(),
    request_id: value.request_id, replayed: value.replayed, authority_effect: false });
}

export function normalizeClientProjectSnapshotRequest(input) {
  if (!object(input) || Object.keys(input).some(key => !['project_id', 'task_id', 'task_after_seq', 'limit'].includes(key))
      || Boolean(input.project_id) === Boolean(input.task_id)) fail('snapshot_request_invalid');
  const field = input.project_id ? 'project_id' : 'task_id';
  if (!id(input[field]) || !count(input.task_after_seq ?? 0) || !count(input.limit ?? 128, 1) || (input.limit ?? 128) > 128) fail('snapshot_request_invalid');
  return { [field]: input[field].toLowerCase(), task_after_seq: input.task_after_seq ?? 0, limit: input.limit ?? 128 };
}

export function normalizeClientProjectSnapshot(value, expected) {
  if (!object(value) || value.schema !== 'metaengine.devos.project-snapshot.v1' || typeof value.found !== 'boolean'
      || value.authority_effect !== false) fail('snapshot_invalid');
  if (!value.found) return Object.freeze({ schema: value.schema, found: false, automatic_retry_allowed: false, authority_effect: false });
  if (!id(value.project_id) || !id(value.root_task_id) || !id(value.request_id) || !text(value.state, 64)
      || !text(value.goal, 12000) || !count(value.last_seq) || !count(value.total_tasks, 1)
      || (expected?.project_id && value.project_id !== expected.project_id) || !Array.isArray(value.tasks) || value.tasks.length > 128
      || !object(value.task_cursor) || !count(value.task_cursor.after_seq) || !count(value.task_cursor.next_seq)
      || value.task_cursor.next_seq < value.task_cursor.after_seq || typeof value.task_cursor.has_more !== 'boolean') fail('snapshot_invalid');
  const readTask = row => {
    if (!object(row) || !id(row.task_id) || (row.parent_task_id !== null && !id(row.parent_task_id))
        || !count(row.depth) || !text(row.state, 64) || !text(row.role, 64)) fail('snapshot_task_invalid');
    return Object.freeze({ task_id: row.task_id, parent_task_id: row.parent_task_id, depth: row.depth,
      state: row.state, role: row.role, task_seq: count(row.task_seq) ? row.task_seq : null,
      open_children: count(row.open_children) ? row.open_children : null,
      blocking_children: count(row.blocking_children) ? row.blocking_children : null,
      pending_proposals: count(row.pending_proposals) ? row.pending_proposals : null });
  };
  const tasks = value.tasks.map(readTask);
  if (new Set(tasks.map(row => row.task_id)).size !== tasks.length) fail('snapshot_task_ambiguous');
  const selected = value.selected_task == null ? null : readTask(value.selected_task);
  if (expected?.task_id && selected?.task_id !== expected.task_id) fail('snapshot_task_binding_invalid');
  if (selected && !expected?.task_id && selected.task_id !== value.root_task_id) fail('snapshot_task_binding_invalid');
  const children = Array.isArray(value.immediate_children) && value.immediate_children.length <= 128
    ? value.immediate_children.map(readTask) : [];
  if (children.some(row => row.parent_task_id !== selected?.task_id) || new Set(children.map(row => row.task_id)).size !== children.length) fail('snapshot_children_invalid');
  return Object.freeze({ schema: value.schema, found: true, project_id: value.project_id, root_task_id: value.root_task_id,
    request_id: value.request_id, state: value.state, goal: value.goal,
    total_tasks: value.total_tasks, selected_task: selected, immediate_children: children,
    children_truncated: value.children_truncated === true,
    tasks, last_seq: value.last_seq,
    task_cursor: object(value.task_cursor) ? { after_seq: value.task_cursor.after_seq, next_seq: value.task_cursor.next_seq,
      has_more: value.task_cursor.has_more === true } : null,
    policy: object(value.policy) ? { max_depth: value.policy.max_depth ?? null, max_tasks: value.policy.max_tasks ?? null,
      max_children: value.policy.max_children ?? null, owner_stop: value.policy.owner_stop === true,
      generation: count(value.policy.generation, 1) ? value.policy.generation : null } : null,
    filesystem_paths_exposed: false, automatic_retry_allowed: false, scheduler_authority: false, authority_effect: false });
}

export function normalizeClientProjectHistoryRequest(input) {
  const fields = ['project_id', 'after_seq', 'through_seq', 'limit', 'task_id', 'attempt', 'event_type'];
  if (!object(input) || Object.keys(input).some(key => !fields.includes(key)) || !id(input.project_id)
      || !count(input.after_seq ?? 0) || !count(input.limit ?? 128, 1) || (input.limit ?? 128) > 128
      || (input.through_seq != null && (!count(input.through_seq) || input.through_seq < (input.after_seq ?? 0)))
      || (input.task_id != null && !id(input.task_id)) || (input.attempt != null && !count(input.attempt))
      || (input.event_type != null && (!text(input.event_type, 96) || !/^[A-Z][A-Z0-9_]{0,95}$/.test(input.event_type)))) fail('history_request_invalid');
  return { project_id: input.project_id.toLowerCase(), after_seq: input.after_seq ?? 0,
    through_seq: input.through_seq ?? null, limit: input.limit ?? 128, task_id: input.task_id ?? null,
    attempt: input.attempt ?? null, event_type: input.event_type ?? null };
}

export function normalizeClientProjectHistory(value, request) {
  const cursor = value?.cursor;
  if (!object(value) || value.schema !== 'metaengine.devos.project-history.v1' || value.project_id !== request.project_id
      || value.authority_effect !== false || !object(cursor) || cursor.commit_ordered !== true
      || cursor.after_seq !== request.after_seq || !count(cursor.through_seq) || cursor.through_seq < request.after_seq
      || !count(cursor.next_seq) || cursor.next_seq < request.after_seq || cursor.next_seq > cursor.through_seq
      || (request.through_seq !== null && cursor.through_seq !== request.through_seq)
      || typeof cursor.has_more !== 'boolean' || (cursor.has_more && cursor.next_seq <= request.after_seq)
      || !Array.isArray(value.entries) || value.entries.length > request.limit) fail('history_invalid');
  let previous = request.after_seq;
  const entries = value.entries.map(row => {
    if (!object(row) || !count(row.seq, 1) || row.seq <= previous || row.seq > cursor.next_seq
        || (row.causal_parent_seq !== null && (!count(row.causal_parent_seq, 1) || row.causal_parent_seq >= row.seq))
        || (row.task_id !== null && !id(row.task_id)) || (row.attempt !== null && !count(row.attempt))
        || !text(row.event_type, 96) || !/^[A-Z][A-Z0-9_]{0,95}$/.test(row.event_type) || !text(row.source, 96)
        || (row.actor !== null && !text(row.actor, 1024)) || !text(row.created_at, 64) || !Number.isFinite(Date.parse(row.created_at))
        || row.verified_evidence !== false
        || !object(row.content) || JSON.stringify(row.content).length > 32768
        || (request.task_id !== null && row.task_id !== request.task_id)
        || (request.attempt !== null && row.attempt !== request.attempt)
        || (request.event_type !== null && row.event_type !== request.event_type)) fail('history_entry_invalid');
    previous = row.seq;
    // Whitelist fields. Device grants, private paths and future RPC fields never
    // become implicit additions to the product bridge.
    return Object.freeze({ project_id: request.project_id, seq: row.seq, causal_parent_seq: row.causal_parent_seq, task_id: row.task_id,
      attempt: row.attempt, actor: structuredClone(row.actor), event_type: row.event_type, source: row.source,
      verified_evidence: row.verified_evidence, content: structuredClone(row.content),
      receipt_reference_verified: row.receipt_reference_verified === true,
      tool: row.tool ?? null, artifact: row.artifact ?? null, created_at: row.created_at ?? null });
  });
  return Object.freeze({ schema: value.schema, project_id: value.project_id, entries,
    cursor: { after_seq: cursor.after_seq, through_seq: cursor.through_seq, next_seq: cursor.next_seq,
      has_more: cursor.has_more, commit_ordered: true }, content_is_authority: false, automatic_retry_allowed: false,
    scheduler_authority: false, authority_effect: false });
}
