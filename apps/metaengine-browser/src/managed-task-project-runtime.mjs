// Browser/development compatibility entry. Installed Host imports the Node-safe core.
import { spawn } from 'node:child_process';
import {readMainPrivateNativeTools} from './private-native-tools.mjs';
import {gitInvocationArgv,managedProjectPrivateGitTools} from './managed-task-project-runtime-core.mjs';
export * from './managed-task-project-runtime-core.mjs';

// A native supplied capability remains a composition/test seam. Omission in
// Electron Main selects the actual package context, never an ambient fallback
// after a package or capability failure.
export async function resolveManagedProjectPrivateGitTools(privateTools = null) {
  // This source/development Git adapter does not supply native Host authority.
  // Packaged Electron must use its actual Main context; the installed Node Host
  // has a separate verified-bundle loader and never selects this source path.
  return managedProjectPrivateGitTools(privateTools === null && process.versions.electron
    ? await readMainPrivateNativeTools() : privateTools);
}

/** Execute only the fixed argv plans emitted by workspace-git-hardening. */
export function createShellFreeGitExecutor({ timeoutMs = 120000, spawnProcess = spawn, privateTools = null } = {}) {
  const suppliedTools = managedProjectPrivateGitTools(privateTools);
  let toolsPromise;
  const boundedTimeout = Math.max(1000, Math.min(300000, Number(timeoutMs) || 120000));
  return Object.freeze({
    async execute(plan) {
      const argv = gitInvocationArgv(plan);
      const cwd = plan.cwd;
      const readOnly = plan.effect.endsWith('_READ');
      // Keep one selection promise for this executor, including rejection.
      // Neither a failed load nor a failed revalidation selects ambient Git.
      toolsPromise ??= suppliedTools === null
        ? resolveManagedProjectPrivateGitTools()
        : Promise.resolve(suppliedTools);
      const tools = await toolsPromise;
      // Non-Electron retains its prior selection pending its separate installed
      // Host binding. Packaged Main keeps the full private helper/CA policy.
      const env = tools ? { ...tools.environment }
        : Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
      if (readOnly) {
        env.GIT_OPTIONAL_LOCKS = '0'; env.GIT_TERMINAL_PROMPT = '0';
        env.GCM_INTERACTIVE = 'never'; env.GCM_GUI_PROMPT = '0';
      }
      if (tools) await tools.revalidate();
      return new Promise((resolve, reject) => {
        // The repository remains trusted: Git can execute its configured hooks.
        // On timeout/output overflow wait for close before returning a receipt.
        const child = spawnProcess(tools?.gitExecutable || 'git', argv, { cwd, shell: false, windowsHide: true, env });
        const out = []; const err = []; let bytes = 0; let timer; let failure = null;
        const stop = (reason) => { if (failure) return; failure = new Error(reason); child.kill(); };
        const collect = (target, chunk) => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { stop('managed_project_git_output_too_large'); return; } target.push(chunk); };
        child.stdout.on('data', (chunk) => collect(out, chunk));
        child.stderr.on('data', (chunk) => collect(err, chunk));
        child.once('error', (error) => { failure ||= error; });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          const result = { code, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
          if (failure || code !== 0) { failure ||= new Error(`managed_project_git_failed:${code ?? signal ?? 'unknown'}`); failure.result = result; reject(failure); return; }
          resolve(result);
        });
        timer = setTimeout(() => stop('managed_project_git_timeout'), boundedTimeout);
        timer.unref?.();
      });
    },
  });
}
