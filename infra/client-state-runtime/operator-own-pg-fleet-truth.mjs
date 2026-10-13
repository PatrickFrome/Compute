// Read-only W2/P0 witness against the EXISTING self-operated PostgreSQL ledger.
// These fixed SELECTs require an independently authorised read-only database role.
// Missing privileges, rows or Owner binding never fall back to hosted storage.
// This observer creates no table, trigger, scheduler, claim, lease or effect.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_ROWS = 64;
const MAX_AGE = 30_000;
const CLOCK_SKEW = 5_000;
const toMs = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
const safeInt = value => Number.isSafeInteger(value) && value >= 0;
const bad = (state, owner, nowMs) => state === 'AMBIGUOUS' && owner
  ? failures(state, owner, nowMs) : { fleet: null, continuity: null, reason: state };
const observation = (source, state, owner, nowMs, extra = {}) => ({
  source, state, proven: true, owner_id: owner.owner_id,
  heartbeat_at: new Date(toMs(owner.heartbeat_at)).toISOString(),
  observed_at: new Date(nowMs).toISOString(), ...extra,
});

// Every query is prewritten and parameter-bound. No pagination arguments from HTTP.
// The +1 sentinel makes truncation visible rather than claiming a complete snapshot.
export const OPERATOR_OWN_PG_PROJECT_SQL = [
  'SELECT project_id, workspace_id, device_id, client_id, admin_grant_epoch,',
  'total_tasks, last_seq, policy_generation, pg_catalog.clock_timestamp() AS observed_at',
  'FROM destruktion_meta.project_run_h205f22',
  'WHERE project_id=$1::uuid AND workspace_id=$2::uuid AND device_id=$3::uuid',
  'AND client_id=$4::text AND admin_grant_epoch=$5::bigint LIMIT 2',
].join(' ');
export const OPERATOR_OWN_PG_TASK_CLAIM_SQL = [
  'SELECT x.task_seq, t.task_id, t.state AS task_state, t.lease_generation,',
  't.lease_agent_id, t.lease_agent_generation_epoch, t.lease_expires_at,',
  'c.claim_id, c.state AS claim_state, c.agent_id AS claim_agent_id,',
  'c.lease_generation AS claim_generation, c.agent_generation_epoch AS claim_agent_generation,',
  'c.expires_at AS claim_expires_at, c.workspace_id AS claim_workspace_id',
  'FROM destruktion_meta.project_task_h205f22 x',
  'JOIN destruktion_meta.devos_fleet_task_h205f22 t ON t.task_id=x.task_id',
  'LEFT JOIN destruktion_meta.devos_fleet_claim_h205f22 c',
  "ON c.task_id=t.task_id AND c.state='ACTIVE'",
  'WHERE x.project_id=$1::uuid ORDER BY x.task_seq,c.claim_id LIMIT 65',
].join(' ');
export const OPERATOR_OWN_PG_EVENT_SQL = [
  'SELECT seq, event_type, task_id FROM destruktion_meta.project_event_h205f22',
  'WHERE project_id=$1::uuid AND seq>$2::bigint AND seq<=$3::bigint',
  'ORDER BY seq LIMIT 65',
].join(' ');

// Only an internal Owner adapter can provide this shape. This is a structural
// provenance check, NOT cryptographic attestation of an arbitrary caller.
export function qualifyOperatorOwner(owner, nowMs = Date.now()) {
  if (!owner || owner.schema !== 'metaengine.operator.trusted-owner.v1'
    || owner.source !== 'TRUSTED_OWNER_READBACK' || owner.verified !== true
    || ![owner.project_id, owner.workspace_id, owner.device_id].every(v => typeof v === 'string' && UUID.test(v))
    || !OWNER.test(owner.owner_id || '') || !OWNER.test(owner.client_id || '')
    || owner.owner_id !== owner.client_id || !safeInt(owner.admin_grant_epoch) || owner.admin_grant_epoch < 1
    || !safeInt(owner.owner_generation) || owner.owner_generation < 1
    || !OWNER.test(owner.process_incarnation || '')
    || !safeInt(owner.event_after_seq === undefined ? 0 : owner.event_after_seq)
    || !Number.isSafeInteger(nowMs)) return false;
  const observed = toMs(owner.observed_at), heartbeat = toMs(owner.heartbeat_at);
  return Number.isFinite(observed) && Number.isFinite(heartbeat)
    && observed <= nowMs + CLOCK_SKEW && nowMs - observed <= MAX_AGE
    && heartbeat <= observed + CLOCK_SKEW && heartbeat <= nowMs + CLOCK_SKEW
    && nowMs - heartbeat <= MAX_AGE;
}

const failures = (state, owner, nowMs) => ({
  fleet: observation('LOCAL_TASK_LEDGER', state, owner, nowMs, { lease_generation: 0 }),
  continuity: observation('LOCAL_CHECKPOINT_LEDGER', state, owner, nowMs, { event_seq: 0 }),
});

// Must be called INSIDE a REPEATABLE READ READ ONLY transaction. Transaction and
// Owner adapter lifecycle are managed by db-api.mjs, never by this module.
export async function readOwnPostgresOperatorTruth({ tx, owner, nowMs = Date.now() } = {}) {
  if (!qualifyOperatorOwner(owner, nowMs)) return bad('UNKNOWN');
  if (!tx || typeof tx.unsafe !== 'function') return bad('UNKNOWN');
  const args = [owner.project_id, owner.workspace_id, owner.device_id, owner.client_id, owner.admin_grant_epoch];
  const projects = await tx.unsafe(OPERATOR_OWN_PG_PROJECT_SQL, args);
  if (!Array.isArray(projects) || projects.length !== 1) return bad('UNKNOWN');
  const project = projects[0];
  if (String(project.project_id).toLowerCase() !== owner.project_id.toLowerCase()
    || String(project.workspace_id).toLowerCase() !== owner.workspace_id.toLowerCase()
    || String(project.device_id).toLowerCase() !== owner.device_id.toLowerCase()
    || project.client_id !== owner.client_id
    || Number(project.admin_grant_epoch) !== owner.admin_grant_epoch
    || !safeInt(project.last_seq) || !safeInt(project.total_tasks)
    || !safeInt(project.policy_generation)
    || project.policy_generation < 1 || project.total_tasks < 1) return bad('UNKNOWN');

  const dbObservedMs = toMs(project.observed_at);
  if (!Number.isFinite(dbObservedMs) || dbObservedMs > nowMs + CLOCK_SKEW
    || nowMs - dbObservedMs > MAX_AGE) return bad('UNKNOWN');
  const afterSeq = owner.event_after_seq ?? 0;
  if (afterSeq > project.last_seq) return bad('UNKNOWN');
  const [tasks, events] = await Promise.all([
    tx.unsafe(OPERATOR_OWN_PG_TASK_CLAIM_SQL, [owner.project_id]),
    tx.unsafe(OPERATOR_OWN_PG_EVENT_SQL, [owner.project_id, afterSeq, project.last_seq]),
  ]);
  if (!Array.isArray(tasks) || !Array.isArray(events)) return bad('UNKNOWN');
  if (tasks.length > MAX_ROWS || events.length > MAX_ROWS + 1) return bad('UNKNOWN');
  const eventPage = events.slice(0, MAX_ROWS);

  const grouped = new Map();
  let state = 'AVAILABLE', claimCount = 0, maxLeaseGeneration = 0;
  const fail = next => { if (state !== 'AMBIGUOUS') state = next; };
  for (const row of tasks) {
    if (!UUID.test(row.task_id || '') || !safeInt(row.task_seq) || row.task_seq < 1
      || !safeInt(row.lease_generation) || !OWNER.test(row.task_state || '')) return bad('UNKNOWN');
    const key = row.task_id.toLowerCase();
    const previous = grouped.get(key);
    if (previous && (previous.task_seq !== row.task_seq
      || previous.lease_generation !== row.lease_generation
      || previous.task_state !== row.task_state)) return bad('AMBIGUOUS', owner, nowMs);
    const group = previous || { task_seq: row.task_seq, lease_generation: row.lease_generation,
      task_state: row.task_state, rows: [] };
    group.rows.push(row); grouped.set(key, group);
    maxLeaseGeneration = Math.max(maxLeaseGeneration, row.lease_generation);
  }
  const sequences = new Set([...grouped.values()].map(x => x.task_seq));
  if (sequences.size !== grouped.size || [...sequences].some(s => s > project.total_tasks))
    return bad('AMBIGUOUS', owner, nowMs);
  if (grouped.size === 0 || grouped.size > project.total_tasks) return bad('UNKNOWN');
  for (const task of grouped.values()) {
    const active = task.rows.filter(row => row.claim_id !== null && row.claim_id !== undefined);
    claimCount += active.length;
    if (active.length > 1) { fail('AMBIGUOUS'); continue; }
    const leased = task.task_state === 'LEASED' || task.task_state === 'RUNNING';
    if (!leased && active.length) { fail('AMBIGUOUS'); continue; }
    if (leased && !active.length) return bad('UNKNOWN');
    if (leased) {
      const c = active[0], expires = toMs(c.claim_expires_at);
      const taskExpires = toMs(c.lease_expires_at);
      if (!safeInt(c.claim_id) || c.claim_id < 1 || !safeInt(c.claim_generation)
        || !safeInt(c.claim_agent_generation) || c.claim_workspace_id !== owner.workspace_id
        || c.claim_generation !== task.lease_generation
        || c.claim_agent_id !== c.lease_agent_id
        || c.claim_agent_generation !== c.lease_agent_generation_epoch
        || !Number.isFinite(expires) || !Number.isFinite(taskExpires)
        || expires !== taskExpires) { fail('AMBIGUOUS'); continue; }
      if (expires <= nowMs) return bad('UNKNOWN');
    }
    if (['AMBIGUOUS', 'FENCED', 'BLOCKED', 'FAILED'].includes(task.task_state) && state === 'AVAILABLE')
      state = 'DEGRADED';
  }
  if (state === 'AVAILABLE' && grouped.size !== project.total_tasks) state = 'DEGRADED';

  let nextSeq = afterSeq;
  for (const event of eventPage) {
    if (!safeInt(event.seq) || event.seq !== nextSeq + 1 || event.seq > project.last_seq
      || !/^[A-Z][A-Z0-9_]{0,95}$/.test(event.event_type || '')
      || (event.task_id !== null && event.task_id !== undefined && !UUID.test(event.task_id)))
      return bad('AMBIGUOUS', owner, nowMs);
    nextSeq = event.seq;
  }
  if (nextSeq < project.last_seq && eventPage.length === 0) return bad('AMBIGUOUS', owner, nowMs);
  const cursor = { project_id: owner.project_id, after_seq: afterSeq, next_seq: nextSeq,
    through_seq: project.last_seq, has_more: nextSeq < project.last_seq };

  return {
    fleet: observation('LOCAL_TASK_LEDGER', state, owner, dbObservedMs, {
      lease_generation: maxLeaseGeneration, owner_generation: owner.owner_generation,
      project_id: owner.project_id, task_count: grouped.size, claim_count: claimCount,
      truncated: grouped.size !== project.total_tasks,
    }),
    continuity: observation('LOCAL_CHECKPOINT_LEDGER', 'AVAILABLE', owner, dbObservedMs, {
      owner_generation: owner.owner_generation, event_seq: nextSeq, cursor,
    }),
    reason: null,
  };
}
