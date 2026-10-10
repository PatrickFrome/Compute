import { randomUUID } from 'node:crypto';
import { normalizeWorkspaceBindingSnapshot } from './workspace-binding-observer.mjs';
import { managedProjectEffectKey } from './managed-task-project-authority-resolver.mjs';

export const MANAGED_PROJECT_CLIENT_STATUS_SCHEMA = 'metaengine.client.managed-project-status.v1';
export const MANAGED_PROJECT_CLIENT_RESULT_SCHEMA = 'metaengine.client.managed-project-result.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OBSERVATION_AGE_MS = 45000;
const flags = Object.freeze({ filesystem_paths_exposed: false, scheduler_authority: false,
  browser_actuation_authority: false, automatic_retry_allowed: false, authority_effect: false });
const fail = code => { throw new Error(`managed_project_client_${code}`); };

/** Dedicated product control: the renderer selects one registered workspace.
 * Main reads its identities afresh; signed PostgreSQL admission still decides
 * whether a physical effect may execute. Observations never mint a claim. */
export function createManagedTaskProjectClientControl({ getObservation, getHostSnapshot, executeCommand, now = Date.now } = {}) {
  for (const value of [getObservation, getHostSnapshot, executeCommand, now]) {
    if (typeof value !== 'function') fail('dependencies_required');
  }
  const pending = new Set();

  async function read() {
    const [raw, host] = await Promise.all([getObservation(), getHostSnapshot()]);
    const hostReady = host?.schema === 'metaengine.devos.managed-task-project-host.v1' && host.state === 'READY'
      && host.durable_journal === true && host.private_storage_verified === true && host.authority_effect === false;
    const observation = raw?.schema === 'metaengine.browser.workspace-binding-observer.v1'
      ? normalizeWorkspaceBindingSnapshot({ ...raw, schema: 'metaengine.devos.workspace-binding-snapshot.v1' }) : null;
    let reason = !hostReady ? 'HOST_UNAVAILABLE' : !observation ? 'OBSERVATION_UNAVAILABLE' : null;
    // The observer normalizer fills a missing timestamp for presentation. A
    // control must use an actual source timestamp before offering an action.
    const observedAt = typeof raw?.observed_at === 'string' ? Date.parse(raw.observed_at) : NaN;
    if (!reason && (!Number.isFinite(observedAt) || observedAt > now() + 5000 || now() - observedAt > MAX_OBSERVATION_AGE_MS)) reason = 'OBSERVATION_STALE';
    const bindings = observation?.bindings || [];
    if (!reason && new Set(bindings.map(row => row.workspace_id)).size !== bindings.length) reason = 'BINDING_AMBIGUOUS';
    return { hostReady, hostState: host?.state || 'UNAVAILABLE', observation, bindings, reason };
  }

  function bindingReason(row) {
    if (row.state === 'FROZEN' || row.dirty_hold || row.ambiguity_code) return 'BINDING_FENCED';
    if (row.lease_current !== true || Date.parse(row.lease_expires_at) <= now()) return 'LEASE_STALE';
    if (pending.has(row.workspace_id)) return 'COMMAND_IN_FLIGHT';
    return null;
  }

  async function status() {
    let current;
    try { current = await read(); }
    catch { current = { hostReady: false, hostState: 'UNAVAILABLE', observation: null, bindings: [], reason: 'OBSERVATION_UNAVAILABLE' }; }
    return Object.freeze({ schema: MANAGED_PROJECT_CLIENT_STATUS_SCHEMA,
      state: current.reason ? (current.hostReady ? 'DEGRADED' : 'UNAVAILABLE') : 'AVAILABLE',
      host_state: current.hostState, observed_at: current.observation?.observed_at || null, reason: current.reason,
      projects: current.bindings.map(row => {
        const reason = current.reason || bindingReason(row);
        return Object.freeze({ workspace_id: row.workspace_id, workspace_generation: row.workspace_generation,
          task_id: row.task_id, agent_id: row.agent_id, repo_id: row.repo_id, branch_name: row.branch_name,
          state: row.state, can_create: !reason && ['RESERVED', 'READY'].includes(row.state),
          can_open: !reason && row.state === 'READY', in_flight: pending.has(row.workspace_id), reason });
      }), ...flags });
  }

  async function perform(action, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
        || !Object.hasOwn(input, 'workspace_id') || typeof input.workspace_id !== 'string' || !UUID.test(input.workspace_id)) fail('request_invalid');
    const workspaceId = input.workspace_id.toLowerCase();
    // Reserve before awaits so simultaneous clicks cannot issue two effects.
    if (pending.has(workspaceId)) fail('command_in_flight');
    pending.add(workspaceId);
    try {
      let current;
      try { current = await read(); } catch { fail('observation_unavailable'); }
      if (current.reason) fail(current.reason.toLowerCase());
      const row = current.bindings.find(binding => binding.workspace_id === workspaceId);
      if (!row) fail('binding_missing');
      if (row.state === 'FROZEN' || row.dirty_hold || row.ambiguity_code) fail('binding_fenced');
      if (row.lease_current !== true || Date.parse(row.lease_expires_at) <= now()) fail('lease_stale');
      if (action === 'PROJECT_OPEN' && row.state !== 'READY') fail('project_not_ready');
      const payload = { idempotency_key: 'project:pending',
        coordination_workspace_id: row.coordination_workspace_id, task_id: row.task_id, agent_id: row.agent_id,
        claim_id: row.claim_id, lease_generation: row.lease_generation,
        workspace_id: row.workspace_id, workspace_generation: row.workspace_generation };
      payload.idempotency_key = managedProjectEffectKey(payload);
      let result;
      try { result = await executeCommand({ command_id: randomUUID(), action, issued_by: 'client-project-control', payload }); }
      catch { fail('effect_failed'); }
      const reservation = result?.reservation, proof = result?.proof;
      if (result?.schema !== 'metaengine.devos.managed-task-project-runtime.v1' || result.state !== 'PROVEN'
          || result.action !== action || result.idempotency_key !== payload.idempotency_key
          || result.authority_effect !== false || result.automatic_retry_allowed !== false
          || reservation?.schema !== 'metaengine.devos.workspace-binding.v1' || reservation.state !== 'READY'
          || reservation.authority_effect !== false || reservation.dirty_hold !== false || reservation.ambiguity_code != null
          || ['workspace_id', 'workspace_generation', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation'].some(key => reservation[key] !== row[key])
          || reservation.base_sha !== row.base_sha || reservation.branch_name !== row.branch_name || reservation.repo_id !== row.repo_id
          || proof?.schema !== 'metaengine.devos.workspace-git-inventory-proof.v1'
          || ['workspace_id', 'workspace_generation', 'task_id', 'lease_generation'].some(key => proof[key] !== row[key])
          || proof.head_sha !== row.base_sha || proof.branch_ref !== `refs/heads/${row.branch_name}`
          || proof.locked !== true || proof.prunable !== false || proof.authority_effect !== false || proof.automatic_retry_allowed !== false
          || typeof reservation.worktree_path !== 'string' || !reservation.worktree_path || proof.worktree_path !== reservation.worktree_path
          || (action === 'PROJECT_OPEN' && result.opened !== true)) fail('effect_not_proven');
      return Object.freeze({ schema: MANAGED_PROJECT_CLIENT_RESULT_SCHEMA, ok: true, state: 'PROVEN', action,
        workspace_id: row.workspace_id, workspace_generation: row.workspace_generation, task_id: row.task_id,
        head_sha: proof.head_sha, replayed: result.replayed === true, opened: result.opened === true, ...flags });
    } finally { pending.delete(workspaceId); }
  }

  return Object.freeze({ status, create: input => perform('PROJECT_CREATE', input), open: input => perform('PROJECT_OPEN', input) });
}
