import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutonomousProjectTaskRuntime } from './autonomous-project-task-runtime.mjs';
import { createAutonomousProjectJournal } from './autonomous-project-journal.mjs';
import { prepareManagedTaskProjectStorage, verifyManagedProjectPrivateFile } from './managed-task-project-storage.mjs';
import { managedProjectEffectKey } from './managed-task-project-authority-resolver.mjs';

/** Main-process composition of project continuity. The existing managed host
 * remains the only owner of worktree effects and the Supervisor owns dispatch. */
export async function createAutonomousProjectHost({ userDataPath, supervisor, getManagedHost,
  platform = process.platform, prepareStorage = prepareManagedTaskProjectStorage,
  verifyFile = verifyManagedProjectPrivateFile, createJournal = createAutonomousProjectJournal } = {}) {
  if (!supervisor || typeof supervisor.projectContinuityRequest !== 'function'
    || typeof supervisor.snapshot !== 'function' || typeof getManagedHost !== 'function') {
    throw new Error('autonomous_project_host_dependencies_required');
  }
  const directory = await prepareStorage({ userDataPath, platform });
  const filePath = path.join(directory, 'effects-project.sqlite');
  const existing = await fs.lstat(filePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) await verifyFile(filePath, { platform });
  const journal = createJournal({ filePath });
  try {
    if (platform !== 'win32' && !existing) await fs.chmod(filePath, 0o600);
    await verifyFile(filePath, { platform });
    return new AutonomousProjectTaskRuntime({
      journal,
      request: ({ path: requestPath, body }) => {
        const operation = requestPath.replace('/v1/devos/project/', '');
        return supervisor.projectContinuityRequest({ operation, body });
      },
      isStopped: () => {
        const state = supervisor.snapshot();
        const control = state?.runtime_control;
        return control?.owner_stop === true || control?.admission_state === 'STOPPED'
          || (control?.authoritative === true && control.continuous_service_allowed === false);
      },
      materializeProject: async ({ lease, claim_id, project_id, snapshot, task }) => {
        // Research/verifier tasks do not acquire writable worktrees. Mutation
        // tasks use the binding installed by the existing scheduler, never a
        // workspace/path proposed by model text.
        if (task?.claim_class === 'READ_ONLY') return { state: 'NOT_REQUIRED' };
        if (task?.claim_class != null && task.claim_class !== 'MUTATING') throw new Error('autonomous_project_claim_class_invalid');
        if (task?.claim_class == null && !['CODER', 'INTEGRATOR', 'IMPLEMENTER', 'SYNTHESIZER'].includes(lease.role)) return { state: 'NOT_REQUIRED' };
        const observation = supervisor.snapshot()?.workspace_bindings;
        const rows = (observation?.bindings || []).filter(row => row.task_id === lease.task_id
          && row.agent_id === lease.agent_id && row.claim_id === claim_id
          && row.lease_generation === lease.lease_generation && row.lease_current === true);
        if (rows.length > 1) throw new Error('autonomous_project_workspace_binding_ambiguous');
        // An initial scheduler claim may not yet have a workspace reservation.
        // Derive a stable host key; signed admission resolves that existing
        // claim and the configured repository before it registers any paths.
        const hash = createHash('sha256').update(`project-workspace:${project_id}:${lease.task_id}:${lease.lease_generation}`).digest('hex');
        const workspaceId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const row = rows[0] || { workspace_id: workspaceId, workspace_generation: 1,
          coordination_workspace_id: snapshot?.coordination_workspace_id, base_sha: lease.base_sha };
        if (row.state === 'FROZEN' || row.dirty_hold || row.ambiguity_code) throw new Error('autonomous_project_workspace_fenced');
        const host = getManagedHost();
        if (host?.snapshot()?.state !== 'READY') throw new Error('autonomous_project_managed_host_unavailable');
        const payload = { idempotency_key: 'project:pending', coordination_workspace_id: row.coordination_workspace_id,
          task_id: lease.task_id, agent_id: lease.agent_id, claim_id, lease_generation: lease.lease_generation,
          workspace_id: row.workspace_id, workspace_generation: row.workspace_generation };
        payload.idempotency_key = managedProjectEffectKey(payload);
        const receipt = await host.executeCommand({ action: 'PROJECT_CREATE', issued_by: 'autonomous-project-host', payload });
        if (receipt?.state !== 'PROVEN' || receipt.authority_effect !== false || receipt.automatic_retry_allowed !== false
          || receipt.reservation?.workspace_id !== row.workspace_id || receipt.reservation?.task_id !== lease.task_id
          || receipt.reservation?.claim_id !== claim_id || receipt.reservation?.agent_id !== lease.agent_id
          || receipt.reservation?.lease_generation !== lease.lease_generation || receipt.proof?.head_sha !== row.base_sha
          || receipt.proof?.locked !== true) throw new Error('autonomous_project_workspace_effect_not_proven');
        return { state: 'PROVEN' };
      },
    });
  } catch (error) { await journal.close(); throw error; }
}
