// W63: temporary fixture diagnostics are classification-only. Never log native paths or tokens.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
