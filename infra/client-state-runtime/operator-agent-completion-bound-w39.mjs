// W39: observational assembly on top of W31's completion guard and the existing
// own-PG project/DevOS ledger. Never call from a renderer, worker or model.
// withOwnerReadbackTransaction must be the existing trusted Owner's
// consistent PostgreSQL transaction callback (not a caller SQL API).
// Project snapshot's device-grant function uses SELECT ... FOR SHARE, so
// PostgreSQL SET TRANSACTION READ ONLY would reject that fixed function.
// The adapter itself issues only fixed SELECTs, with no mutation route.
// Native Owner, SELECT/EXECUTE grants and real PG17 remain release gates.
import { qualifyOperatorOwner } from './operator-own-pg-fleet-truth.mjs';
import { readClientAgentCompletion } from './operator-agent-completion-evidence.mjs';

export const OPERATOR_AGENT_COMPLETION_BOUND_W39_SCHEMA = 'metaengine.operator.agent-completion-bound-w39.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const AGENT = /^agent_[a-z0-9-]{8,64}$/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const asMs = x => x instanceof Date ? x.getTime() : typeof x === 'string' ? Date.parse(x) : NaN;
const asIso = x => Number.isFinite(asMs(x)) ? new Date(asMs(x)).toISOString() : null;
const lower = x => String(x ?? '').toLowerCase();
const goodInt = x => Number.isSafeInteger(x) && x > 0;
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fenced = reason => Object.freeze({
  schema: OPERATOR_AGENT_COMPLETION_BOUND_W39_SCHEMA, state: 'UNKNOWN', reason,
  source_evidence_qualified: false, successful_completion: false,
  independent_live_attestation_verified: false, owner_accepted: false,
  verified: false, promotion_authorized: false, automatic_retry_allowed: false,
  authority_effect: false,
});

// Actual P0/P3 SQL contracts inspected: project_snapshot_v1 / project_run,
// project_task, devos_fleet_task, project_event, devos_fleet_claim, and
// project_result_bound_h205f22 / project_completion_ready_h205f22.
// Each string is fixed; no caller-provided SQL, identifiers, URLs or paths.
// The independent typed Workspace Binding snapshot provides the verified worktree
// head; base_sha and an untrusted result claim are NOT substitutes for PR HEAD.
export const W39_PROJECT_SQL =
  'SELECT public.h205f22_project_snapshot_v1($1::uuid,NULL::uuid,$2::uuid,0,1,$3::uuid,$4::text,$5::bigint) AS snapshot';
export const W39_FLEET_SQL =
  'SELECT public.devos_fleet_snapshot_v1($1::uuid) AS snapshot';
export const W39_WORKSPACE_SQL =
  'SELECT public.h205f22_a2_workspace_binding_snapshot_v1($1::uuid) AS snapshot';
export const W39_TASK_SQL = [
  'SELECT t.task_id,t.workspace_id,t.state,t.lease_generation,t.lease_agent_id,t.base_sha,',
  't.result_sha256,t.result_summary_sha256,t.finished_at,',
  "t.result_summary->>'result_claim_sha256' AS claim_sha256,",
  'destruktion_meta.project_result_bound_h205f22(t.task_id,\'READY\') AS bound_ready,',
  'destruktion_meta.project_completion_ready_h205f22(t.task_id) AS completion_ready,',
  'pg_catalog.clock_timestamp() AS observed_at,',
  '(SELECT e.created_at FROM destruktion_meta.project_event_h205f22 e',
  " WHERE e.project_id=x.project_id AND e.task_id=t.task_id AND e.attempt=t.lease_generation AND e.event_type='TASK_STATE_CHANGED'",
  " AND e.content->>'state'='RESULT_READY' AND e.content->>'result_sha256'=t.result_sha256 ORDER BY e.seq DESC LIMIT 1) AS ready_at,",
  '(SELECT e.seq FROM destruktion_meta.project_event_h205f22 e',
  " WHERE e.project_id=x.project_id AND e.task_id=t.task_id AND e.attempt=t.lease_generation AND e.event_type='TASK_STATE_CHANGED'",
  " AND e.content->>'state'='RESULT_READY' AND e.content->>'result_sha256'=t.result_sha256 ORDER BY e.seq DESC LIMIT 1) AS ready_seq,",
  '(SELECT e.seq FROM destruktion_meta.project_event_h205f22 e',
  " WHERE e.project_id=x.project_id AND e.task_id=t.task_id AND e.attempt=t.lease_generation AND e.event_type='TASK_STATE_CHANGED'",
  " AND e.content->>'state'='COMPLETED' AND e.content->>'result_sha256'=t.result_sha256 ORDER BY e.seq DESC LIMIT 1) AS completed_seq",
  'FROM destruktion_meta.project_task_h205f22 x',
  'JOIN destruktion_meta.project_run_h205f22 r ON r.project_id=x.project_id',
  'JOIN destruktion_meta.devos_fleet_task_h205f22 t ON t.task_id=x.task_id',
  'WHERE x.project_id=$1::uuid AND t.task_id=$2::uuid AND r.workspace_id=$3::uuid',
  'AND r.device_id=$4::uuid AND r.client_id=$5::text AND r.admin_grant_epoch=$6::bigint LIMIT 2',
].join(' ');
export const W39_CRITIC_SQL = [
  'SELECT v.task_id,v.role,v.state,v.lease_agent_id,v.lease_generation,v.finished_at,',
  "v.task_spec->'verification_subject'->>'task_id' AS subject_task_id,",
  "v.task_spec->'verification_subject'->>'result_sha256' AS subject_sha256,",
  "v.result_summary->>'result_claim_subject_result_sha256' AS accepted_subject_sha256,",
  "v.result_summary->>'result_claim_disposition' AS disposition,",
  'destruktion_meta.project_result_bound_h205f22(v.task_id,\'ACCEPT\') AS bound_accept,',
  '(SELECT e.seq FROM destruktion_meta.project_event_h205f22 e',
  " WHERE e.project_id=x.project_id AND e.task_id=v.task_id AND e.attempt=v.lease_generation AND e.event_type='TASK_STATE_CHANGED'",
  " AND e.content->>'state'='COMPLETED' AND e.content->>'result_sha256'=v.result_sha256 ORDER BY e.seq DESC LIMIT 1) AS critic_seq",
  'FROM destruktion_meta.project_task_h205f22 x',
  'JOIN destruktion_meta.devos_fleet_task_h205f22 v ON v.task_id=x.task_id',
  "WHERE x.project_id=$1::uuid AND x.parent_task_id=$2::uuid AND v.role IN ('CRITIC','FALSIFIER')",
  'ORDER BY x.task_seq LIMIT 3',
].join(' ');

function boundTask({ expected: b, owner, project, fleet, workspaces, tasks, critics, nowMs }) {
  if (!isObject(project) || project.schema !== 'metaengine.devos.project-snapshot.v1'
      || project.found !== true || project.authority_effect !== false
      || lower(project.project_id) !== lower(b.run_id)
      || lower(project.coordination_workspace_id) !== lower(owner.workspace_id)
      || !goodInt(project.last_seq) || !isObject(project.selected_task))
    return null;
  const p = project.selected_task;
  if (lower(p.task_id) !== lower(b.task_id) || p.state !== 'COMPLETED'
      || p.lease_generation !== b.lease_generation || p.agent_id !== b.agent_id
      || lower(p.coordination_workspace_id) !== lower(owner.workspace_id)
      || !SHA.test(lower(p.base_sha))) return null;

  // W30/W5 executor's existing DevOS snapshot is advisory. It may omit closed
  // tasks, but a conflicting live claim or reincarnated task must veto the proof.
  if (!isObject(fleet) || fleet.authority_effect !== false
      || !Array.isArray(fleet.active_tasks) || !Array.isArray(fleet.active_claims)
      || fleet.active_tasks.length > 128 || fleet.active_claims.length > 128) return null;
  const same = v => lower(v?.task_id) === lower(b.task_id);
  if (fleet.active_claims.some(same)) return null;
  if (fleet.active_tasks.filter(same).length > 1) return null;
  if (fleet.active_tasks.some(t => t.lease_generation !== b.lease_generation
      || t.state !== 'COMPLETED' || lower(t.lease_agent_id) !== b.agent_id)) return null;

  // Actual W30/W5 workspace registry shape (source-only evidence, not host
  // attestation). A changed generation/head/lease binding fails closed.
  if (!isObject(workspaces)
      || workspaces.schema !== 'metaengine.devos.workspace-binding-snapshot.v1'
      || workspaces.state !== 'AVAILABLE' || workspaces.authority_effect !== false
      || lower(workspaces.coordination_workspace_id) !== lower(owner.workspace_id)
      || !Array.isArray(workspaces.bindings) || workspaces.bindings.length > 64) return null;
  const bound = workspaces.bindings.filter(w => lower(w?.task_id) === lower(b.task_id));
  if (bound.length !== 1) return null;
  const w = bound[0];
  if (w.lease_generation !== b.lease_generation
      || w.agent_id !== b.agent_id || lower(w.base_sha) !== lower(p.base_sha)
      || lower(w.repo_id) !== lower(b.repository)
      || lower(w.coordination_workspace_id) !== lower(owner.workspace_id)
      || lower(w.last_verified_head_sha) !== lower(b.source_sha)
      || !goodInt(w.workspace_generation) || !goodInt(w.claim_id)
      || !['READY', 'FROZEN'].includes(w.state)
      || w.dirty_hold !== false || w.ambiguity_code != null
      || w.authority_effect !== false || w.automatic_retry_allowed !== false
      || !Number.isFinite(asMs(w.updated_at)) || asMs(w.updated_at) > nowMs) return null;

  if (!Array.isArray(tasks) || tasks.length !== 1 || !Array.isArray(critics)
      || critics.length < 1 || critics.length > 2) return null;
  const t = tasks[0];
  const claim = lower(t.claim_sha256);
  if (lower(t.task_id) !== lower(b.task_id) || lower(t.workspace_id) !== lower(owner.workspace_id)
      || t.state !== 'COMPLETED' || t.lease_generation !== b.lease_generation
      || t.lease_agent_id !== b.agent_id || lower(t.base_sha) !== lower(p.base_sha)
      || t.bound_ready !== true || t.completion_ready !== true
      || !HASH.test(claim)
      || !HASH.test(lower(t.result_sha256))
      || lower(t.result_sha256) !== lower(t.result_summary_sha256)) return null;
  const ready = asMs(t.ready_at), complete = asMs(t.finished_at);
  if (!Number.isFinite(ready) || !Number.isFinite(complete)
      || complete < ready || complete >= ready + DAY
      || !goodInt(t.ready_seq) || !goodInt(t.completed_seq)
      || t.ready_seq >= t.completed_seq || t.completed_seq > project.last_seq) return null;
  const critic = critics.find(c => c.role === 'CRITIC');
  if (!critic || critics.some(c => !['CRITIC','FALSIFIER'].includes(c.role))
      || new Set(critics.map(c => c.role)).size !== critics.length
      || critics.some(c => c.state !== 'COMPLETED' || c.disposition !== 'ACCEPT'
        || !goodInt(c.lease_generation) || c.bound_accept !== true
        || lower(c.subject_task_id) !== lower(b.task_id)
        || lower(c.subject_sha256) !== claim || lower(c.accepted_subject_sha256) !== claim
        || c.lease_agent_id === b.agent_id || !AGENT.test(c.lease_agent_id)
        || !goodInt(c.critic_seq) || c.critic_seq <= t.ready_seq
        || c.critic_seq >= t.completed_seq || asMs(c.finished_at) > complete))
    return null;
  const at = asIso(t.observed_at);
  if (!at || asMs(at) > nowMs || nowMs - asMs(at) > 300_000) return null;

  // The existing independent critic is a *separate child task with a
  // database-bound ACCEPT result*, never a claimed verified=true property.
  return {
    schema: 'metaengine.operator.task-readback.v1', readback_source: 'OWN_POSTGRES',
    task_id: b.task_id, run_id: b.run_id, owner_epoch: b.owner_epoch,
    lease_generation: b.lease_generation, agent_id: b.agent_id, source_sha: b.source_sha,
    state: t.state, result_sha256: claim, authority_effect: false,
    result_ready_at: asIso(t.ready_at),
    result_ready_expires_at: new Date(ready + DAY).toISOString(),
    completed_at: asIso(t.finished_at), observed_at: at,
    verifier: {
      schema: 'metaengine.operator.independent-verifier.v1',
      readback_source: 'OWN_POSTGRES', authority_effect: false,
      verdict: 'ACCEPT', role: critic.role, agent_id: critic.lease_agent_id,
      task_id: b.task_id, subject_result_sha256: claim,
      run_id: b.run_id, owner_epoch: b.owner_epoch,
      lease_generation: b.lease_generation, verified_at: asIso(critic.finished_at),
    },
  };
}

export async function readBoundClientAgentCompletion({
  expected, owner, withOwnerReadbackTransaction, readGitHubPull, readGitHubChecks,
  observed_at_ms = Date.now(),
} = {}) {
  const b = expected;
  if (!isObject(b) || !UUID.test(String(b.task_id ?? '')) || !UUID.test(String(b.run_id ?? ''))
      || !goodInt(b.owner_epoch) || !goodInt(b.lease_generation)
      || !AGENT.test(b.agent_id) || !SHA.test(b.source_sha)
      || !Number.isSafeInteger(observed_at_ms) || observed_at_ms < 0)
    return fenced('BINDING_INVALID');
  // A structurally valid Owner witness does not attest the installed process;
  // the native Owner callback is required, not a caller-submitted JSON body.
  if (!qualifyOperatorOwner(owner, observed_at_ms)
      || lower(owner.project_id) !== lower(b.run_id)
      || owner.admin_grant_epoch !== b.owner_epoch)
    return fenced('TRUSTED_OWNER_MISSING');
  if (typeof withOwnerReadbackTransaction !== 'function'
      || typeof readGitHubPull !== 'function' || typeof readGitHubChecks !== 'function')
    return fenced('READERS_UNBOUND');
  try {
    const task = await withOwnerReadbackTransaction(async tx => {
      if (typeof tx?.unsafe !== 'function') throw new Error('tx_missing');
      const selectors = [owner.workspace_id, b.task_id, owner.device_id,
        owner.client_id, owner.admin_grant_epoch];
      const pRows = await tx.unsafe(W39_PROJECT_SQL, selectors);
      const fRows = await tx.unsafe(W39_FLEET_SQL, [owner.workspace_id]);
      const wRows = await tx.unsafe(W39_WORKSPACE_SQL, [owner.workspace_id]);
      const tasks = await tx.unsafe(W39_TASK_SQL, [
        b.run_id, b.task_id, owner.workspace_id, owner.device_id, owner.client_id, owner.admin_grant_epoch,
      ]);
      const critics = await tx.unsafe(W39_CRITIC_SQL, [b.run_id, b.task_id]);
      if (!Array.isArray(pRows) || pRows.length !== 1 || !Array.isArray(fRows)
          || fRows.length !== 1 || !Array.isArray(wRows) || wRows.length !== 1) return null;
      return boundTask({ expected: b, owner, project: pRows[0]?.snapshot,
        fleet: fRows[0]?.snapshot, workspaces: wRows[0]?.snapshot, tasks, critics, nowMs: observed_at_ms });
    });
    if (!task) return fenced('OWN_PG_BINDING_OR_CRITIC_UNPROVEN');
    // W31 performs expiry/freshness and *then* exact repo/PR/current HEAD/check
    // reads. No GitHub call is made for a failing PostgreSQL/critic witness.
    const evidence = await readClientAgentCompletion({
      expected: b, observed_at_ms,
      readOwnTask: async () => task, readGitHubPull, readGitHubChecks,
    });
    return Object.freeze({
      ...evidence, schema: OPERATOR_AGENT_COMPLETION_BOUND_W39_SCHEMA,
      owner_accepted: false, verified: false,
      // W31 source qualification is observational, not acceptance.
      successful_completion: false, promotion_authorized: false,
      independent_live_attestation_verified: false, automatic_retry_allowed: false,
      authority_effect: false,
    });
  } catch {
    return fenced('SOURCE_READBACK_FAILED');
  }
}
