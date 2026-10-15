// W63: temporary fixture diagnostics are classification-only. Never log native paths or tokens.
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { parseWorktreePorcelainZ, samePhysicalWorkspacePath } from '../src/workspace-git-hardening.mjs';

const physical = value => {
  try { return realpathSync(value); } catch { return null; }
};
export function sourceSyncFixtureDiagnostics({ repo, dir, work, sha, branch }) {
  let records = [];
  let inventoryAvailable = false;
  try {
    const stdout = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: repo, encoding: 'utf8', windowsHide: true,
      maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
    });
    records = parseWorktreePorcelainZ(stdout);
    inventoryAvailable = true;
  } catch { /* Do not echo native Git errors or paths. */ }
  const canonRoot = physical(dir), canonRepo = physical(repo), canonWork = physical(work);
  return JSON.stringify({
    schema: 'metaengine.w63.nonsecret-fixture-diagnostic.v1',
    platform: process.platform, inventoryAvailable, records: records.length,
    rootCanonical: canonRoot !== null && samePhysicalWorkspacePath(dir, canonRoot),
    repoCanonical: canonRepo !== null && samePhysicalWorkspacePath(repo, canonRepo),
    workCanonical: canonWork !== null && samePhysicalWorkspacePath(work, canonWork),
    workWithinRoot: path.relative(dir, work) === 'work',
    rows: records.slice(0, 3).map(r => ({
      pathAbsolute: path.isAbsolute(r.worktree),
      pathEqual: samePhysicalWorkspacePath(r.worktree, work),
      pathCasefoldEqual: typeof r.worktree === 'string'
        && path.resolve(r.worktree).toLowerCase() === path.resolve(work).toLowerCase(),
      pathHasExtendedPrefix: typeof r.worktree === 'string' && r.worktree.startsWith('\\\\?\\'),
      pathRealpathEqual: physical(r.worktree) !== null
        && canonWork !== null && samePhysicalWorkspacePath(physical(r.worktree), canonWork),
      pathLengthDelta: typeof r.worktree === 'string' ? r.worktree.length - work.length : null,
      prefixCodepoints: typeof r.worktree === 'string' ? Array.from(r.worktree.slice(0, 6), c => c.charCodeAt(0)) : [],
      suffixCodepoints: typeof r.worktree === 'string' ? Array.from(r.worktree.slice(-6), c => c.charCodeAt(0)) : [],
      relativeSuffixEquals: typeof r.worktree === 'string' && r.worktree.endsWith(path.basename(work)),
      controlCharacterCount: typeof r.worktree === 'string' ? (r.worktree.match(/[\\x00-\\x1f]/g) || []).length : null,
      headMatches: r.HEAD === sha, branchMatches: r.branch === 'refs/heads/' + branch,
      locked: Boolean(r.locked), lockType: typeof r.locked,
      detached: Boolean(r.detached), prunable: Boolean(r.prunable),
    })),
  });
}

/**
 * Disposable fixture only. Git for Windows can expand a generated 8.3 TEMP
 * component (e.g. short profile name) when registering worktree paths. Build
 * fixture bindings from Git's exact registered spelling ONLY after independent
 * OS file identities prove the generated root, repo and locked worktree are
 * precisely the same directories. Never use this to normalize native Owner
 * claims or arbitrary production paths.
 */
export function canonicalGeneratedGitFixtureW63({ dir, repo, work, sha, branch }) {
  const stdout = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: repo, encoding: 'utf8', windowsHide: true,
    maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rows = parseWorktreePorcelainZ(stdout);
  const branchRows = rows.filter(r => r.HEAD === sha &&
    r.branch === 'refs/heads/' + branch && Boolean(r.locked) &&
    !r.prunable && !r.detached);
  if (branchRows.length !== 1) throw new Error('disposable_fixture_worktree_not_uniquely_locked');
  const gitWork = branchRows[0].worktree;
  if (typeof gitWork !== 'string' || !path.isAbsolute(gitWork))
    throw new Error('disposable_fixture_git_path_not_absolute');
  // Normalize Git's forward separators to the native absolute spelling, while
  // retaining its Windows long-name components and exact inode identity.
  const registeredWork = path.resolve(gitWork);
  const registeredDir = path.dirname(registeredWork);
  const registeredRepo = path.join(registeredDir, 'repo');
  const rootRows = rows.filter(r => r.HEAD === sha &&
    !r.detached && !r.prunable && !r.locked &&
    samePhysicalWorkspacePath(r.worktree, registeredRepo));
  if (rootRows.length !== 1 || !samePhysicalWorkspacePath(rootRows[0].worktree, registeredRepo))
    throw new Error('disposable_fixture_git_root_not_registered');
  const sameFileId = (expected, actual) => {
    const left = statSync(expected, { bigint: true });
    const right = statSync(actual, { bigint: true });
    return left.isDirectory() && right.isDirectory() &&
      left.ino !== 0n && left.dev === right.dev && left.ino === right.ino &&
      !lstatSync(actual).isSymbolicLink();
  };
  if (![ [dir, registeredDir], [repo, registeredRepo], [work, registeredWork] ]
    .every(([a, b]) => sameFileId(a, b))) {
    throw new Error('disposable_fixture_git_path_not_same_physical_directory');
  }
  if (path.relative(registeredDir, registeredWork) !== 'work' ||
      path.relative(registeredDir, registeredRepo) !== 'repo') {
    throw new Error('disposable_fixture_git_path_outside_root');
  }
  // The native readback must retain its own strict realpath checks. Tests do
  // not weaken those checks to make a short/long-name alias pass.
  return Object.freeze({dir: registeredDir, repo: registeredRepo, work: registeredWork});
}
