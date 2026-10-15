// W55: in-process, read-only native composition. W51 owns the main.mjs hook;
// W52 owns genuine canonical Owner verification, which must be bound by host.
// No renderer/IPC argument selects a repository, path, command, or endpoint.
import { readClientSourceSyncPreflightW50 } from './client-source-sync-preflight-w50.mjs';
import { readInstalledGithubCredential } from './github-repository-connection.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CLIENT_SOURCE_SYNC_NATIVE_W55_SCHEMA = 'metaengine.client.source-sync-native-w55.v1';
const REPOSITORY = 'PatrickFrome/Compute';
const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{3,200}$/;
const safePath = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !path.isAbsolute(a) || !path.isAbsolute(b)) return false;
  return process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
};
const unavailable = () => Object.freeze({
  schema: 'metaengine.client.source-sync-w50.v1', state: 'UNKNOWN',
  reason: 'TRUSTED_READERS_UNBOUND', repository: REPOSITORY,
  current_source_sha: null, witness_sha256: null, classification: 'SOURCE',
  source_observation_only: true, installed_healthy: false, installed_active: false,
  live_authority_proven: false, owner_accepted: false, promotion_authorized: false,
  automatic_retry_allowed: false, scheduler_authority: false,
  browser_actuation_authority: false, authority_effect: false,
});

/** GitHub refs API is the source-of-truth; origin/* is never consulted as proof.
 * Only the already-installed GitHub credential reader is used. */
export function createFixedGithubRefReaderW55({
  githubConnection, userDataPath, safeStorage,
  readCredential = readInstalledGithubCredential, fetchImpl = fetch, now = Date.now,
} = {}) {
  return async ({ repository, ref } = {}) => {
    if (repository !== REPOSITORY || typeof ref !== 'string'
      || !ref.startsWith('refs/heads/') || !BRANCH.test(ref.slice(11))
      || typeof githubConnection?.connect !== 'function'
      || typeof githubConnection?.snapshot !== 'function'
      || typeof readCredential !== 'function' || typeof fetchImpl !== 'function'
      || typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)
      || !safeStorage) return null;
    try {
      // Refresh current auth/repository permission, not a cached CONNECTED bit.
      const connected = await githubConnection.connect();
      if (connected?.state !== 'CONNECTED' || connected.authenticated !== true
        || connected.repository_access_verified !== true || connected.repository !== REPOSITORY
        || !Number.isFinite(Date.parse(connected.checked_at))
        || Math.abs(now() - Date.parse(connected.checked_at)) > 30_000
        || connected.authority_effect !== false) return null;
      const credential = await readCredential({ userDataPath, safeStorage });
      if (!credential || typeof credential.token !== 'string'
        || !/^\S{20,512}$/.test(credential.token)
        || !['WINDOWS_GCM', 'SECURE_STORAGE'].includes(credential.source)) return null;
      const branch = ref.slice(11);
      const segments = branch.split('/').map(encodeURIComponent).join('/');
      const url = 'https://api.github.com/repos/PatrickFrome/Compute/git/ref/heads/' + segments;
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        headers: { accept: 'application/vnd.github+json',
          authorization: 'Bearer ' + credential.token,
          'x-github-api-version': '2026-03-10',
          'user-agent': 'METAENGINE-Browser' },
      });
      if (response?.status !== 200 || !response.ok) return null;
      const text = await response.text();
      if (typeof text !== 'string' || Buffer.byteLength(text) > 16_384) return null;
      const body = JSON.parse(text);
      if (body?.ref !== ref || body.object?.type !== 'commit'
        || !SHA.test(body.object?.sha || '')) return null;
      return Object.freeze({ repository: REPOSITORY, ref,
        provider: 'GITHUB_REFS_API', cached: false,
        head_sha: body.object.sha, observed_at: new Date(now()).toISOString() });
    } catch { return null; }
  };
}

/** Integrates the existing native workspace observation + managed Git runner.
 * The Owner binding callback must come from W52's verified native service;
 * when absent this module cannot infer trust from a PID, page or env variable.
 */
export function createClientSourceSyncNativeServiceW55({
  readVerifiedOwnerBinding, nativeSupervisorClient, managedProjectHost,
  githubConnection, userDataPath, safeStorage,
  readCredential, fetchImpl, now = Date.now,
} = {}) {
  const wired = typeof readVerifiedOwnerBinding === 'function'
    && typeof nativeSupervisorClient?.snapshot === 'function'
    && typeof managedProjectHost?.readSourceSyncGit === 'function'
    && typeof githubConnection?.connect === 'function'
    && typeof githubConnection?.snapshot === 'function';
  const readGitHubHead = createFixedGithubRefReaderW55({
    githubConnection, userDataPath, safeStorage, readCredential, fetchImpl, now,
  });
  return Object.freeze({
    schema: CLIENT_SOURCE_SYNC_NATIVE_W55_SCHEMA,
    async read() {
      if (!wired) return unavailable();
      const readTrustedBinding = async () => {
        const binding = await readVerifiedOwnerBinding();
        if (!binding || binding.schema !== 'metaengine.devos.workspace-binding.v1'
          || binding.repo_id !== REPOSITORY || binding.state !== 'READY') return null;
        // Never follow a reparse/link instead of a physically owned worktree.
        const realRoot = await fs.realpath(binding.repo_root);
        const realManaged = await fs.realpath(binding.managed_root);
        const realWork = await fs.realpath(binding.worktree_path);
        if (!safePath(realRoot, binding.repo_root) ||
          !safePath(realManaged, binding.managed_root) ||
          !safePath(realWork, binding.worktree_path) ||
          !safePath(realWork, binding.worktree_realpath)) return null;
        const rel = path.relative(realManaged, realWork);
        if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
        return binding;
      };
      const readWorkspaceSnapshot = async () => nativeSupervisorClient.snapshot()?.workspace_bindings ?? null;
      const readGit = async plan => {
        const result = await managedProjectHost.readSourceSyncGit(plan);
        return result?.stdout;
      };
      return readClientSourceSyncPreflightW50({
        readTrustedBinding, readWorkspaceSnapshot, readGit, readGitHubHead, now,
      });
    },
  });
}
