import fs from 'node:fs/promises';
import path from 'node:path';
import { createManagedTaskProjectCommandAdapter, MANAGED_PROJECT_COMMAND_ACTIONS } from './managed-task-project-command-adapter.mjs';
import { createManagedTaskProjectSqliteJournal } from './managed-task-project-sqlite-journal.mjs';
import { createShellFreeGitExecutor } from './managed-task-project-runtime.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import { assertManagedProjectPhysicalDirectory, prepareManagedTaskProjectStorage, verifyManagedProjectPrivateFile } from './managed-task-project-storage.mjs';
import { readManagedTaskProjectRepository } from './managed-task-project-repository.mjs';
import { normalizeManagedProjectAuthorityRequest, managedProjectEffectKey } from './managed-task-project-authority-resolver.mjs';

export const MANAGED_TASK_PROJECT_HOST_SCHEMA = 'metaengine.devos.managed-task-project-host.v1';
const JOURNAL_NAME = 'effects.sqlite';
const fail = code => { throw new Error(`managed_project_host_${code}`); };

/** Host-owned composition only. Paths and callbacks are installed by main,
 * never read from a command, renderer, GitHub message or loopback request.
 * PostgreSQL still owns admission and leases; the SQLite journal only records
 * local effects. Closing denies new project commands and drains effects before
 * closing SQLite, so restart reconciliation sees their committed receipts. */
export async function createManagedTaskProjectHost({
  userDataPath, executeCommand, resolveProjectBinding, reserveBinding, finalizeBinding, openProject = null,
  provisionRepository = null,
  platform = process.platform, protectStorage = protectOwnerOnlyWindowsDirectory,
  verifyStorage = verifyOwnerOnlyWindowsStorage, createJournal = createManagedTaskProjectSqliteJournal,
  gitExecutor = createShellFreeGitExecutor(),
} = {}) {
  for (const [name, value] of Object.entries({ executeCommand, resolveProjectBinding, reserveBinding, finalizeBinding, protectStorage, verifyStorage, createJournal })) {
    if (typeof value !== 'function') fail(`${name}_required`);
  }
  if (openProject !== null && typeof openProject !== 'function') fail('openProject_invalid');
  if (provisionRepository !== null && typeof provisionRepository !== 'function') fail('provisionRepository_invalid');
  if (!gitExecutor || typeof gitExecutor.execute !== 'function') fail('git_executor_required');
  const directory = await prepareManagedTaskProjectStorage({ userDataPath, platform, protectStorage, verifyStorage });

  const filePath = path.join(directory, JOURNAL_NAME);
  const existing = await fs.lstat(filePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) {
    await verifyManagedProjectPrivateFile(filePath, { platform, verifyStorage });
  }
  const journal = createJournal({ filePath });
  try {
    if (platform !== 'win32' && !existing) await fs.chmod(filePath, 0o600);
    await verifyManagedProjectPrivateFile(filePath, { platform, verifyStorage });
  } catch (error) { await journal.close(); throw error; }

  const pending = new Set();
  let state = 'READY'; let commands = 0; let failures = 0; let closing = null; let repositoryState = 'NOT_CHECKED';
  return Object.freeze({
    async executeCommand(command) {
      if (!MANAGED_PROJECT_COMMAND_ACTIONS.includes(command?.action)) return executeCommand(command);
      if (state !== 'READY') fail('closed');
      const copiedCommand = structuredClone(command);
      const identity = normalizeManagedProjectAuthorityRequest(copiedCommand?.payload);
      // CLI, shell and leased commands share one host-owned journal key.
      // A different caller key cannot bypass the existing worktree receipt.
      copiedCommand.payload = { ...identity, idempotency_key: managedProjectEffectKey(identity) };
      commands++;
      // Track before invoking async code, including a synchronous resolver error.
      const effect = Promise.resolve().then(async () => {
        let configuration = null;
        if (provisionRepository) {
          configuration = await readManagedTaskProjectRepository({ userDataPath, platform, verifyStorage });
          repositoryState = configuration ? 'CONFIGURED' : 'NOT_CONFIGURED';
          if (configuration && configuration.coordination_workspace_id !== identity.coordination_workspace_id) fail('repository_workspace_mismatch');
          if (configuration) { await provisionRepository(configuration); repositoryState = 'PROVISIONED'; }
        }
        const adapter = createManagedTaskProjectCommandAdapter({ executeCommand, reserveBinding, finalizeBinding, openProject, journal,
          executePlan: plan => gitExecutor.execute(plan),
          resolveProjectBinding: async request => {
            const admission = await resolveProjectBinding(request);
            if (configuration && ['coordination_workspace_id', 'repo_id', 'repo_root', 'managed_root'].some(key => configuration[key] !== admission?.workspace_binding?.[key])) fail('repository_admission_drift');
            return admission;
          },
        });
        return adapter(copiedCommand);
      });
      pending.add(effect);
      try { return await effect; }
      catch (error) { failures++; throw error; }
      finally { pending.delete(effect); }
    },
    snapshot() {
      return Object.freeze({ schema: MANAGED_TASK_PROJECT_HOST_SCHEMA, state,
        durable_journal: true, private_storage_verified: true, in_flight: pending.size,
        project_commands_total: commands, project_failures_total: failures, repository_state: repositoryState,
        scheduler_authority: false, automatic_retry_allowed: false, authority_effect: false });
    },
    close() {
      if (closing) return closing;
      state = 'CLOSING';
      closing = (async () => {
        await Promise.allSettled([...pending]);
        await journal.close(); state = 'CLOSED';
      })();
      return closing;
    },
  });
}
