import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditBranchLineage } from '../../../coordination/devos/branch-lineage-auditor.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd, name, value, message) {
  writeFileSync(join(cwd, name), value);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-m', message);
}

test('branch lineage audit covers every namespace and preserves unrelated history as evidence', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'metaengine-branch-lineage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, 'init', '-b', 'release/current');
  git(cwd, 'config', 'user.name', 'METAENGINE Test');
  git(cwd, 'config', 'user.email', 'metaengine-test@example.invalid');
  commitFile(cwd, 'base.txt', 'base\n', 'base');
  const baseSha = git(cwd, 'rev-parse', 'HEAD');

  for (const branch of ['main', 'me2/donor', 'repair/runtime', 'fix/packaging', 'scratch/probe', 'perf/soak']) {
    git(cwd, 'branch', branch, baseSha);
  }

  git(cwd, 'checkout', '--orphan', 'sandbox/history');
  git(cwd, 'rm', '-rf', '.');
  commitFile(cwd, 'history.txt', 'independent\n', 'independent history');
  const unrelatedHead = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', 'release/current');

  const report = auditBranchLineage({
    cwd,
    baseRef: 'release/current',
    namespace: 'refs/heads/',
  });

  for (const branch of ['main', 'me2/donor', 'repair/runtime', 'fix/packaging', 'scratch/probe', 'perf/soak', 'sandbox/history']) {
    assert.ok(report.branches.some((row) => row.branch === branch), `missing branch ${branch}`);
  }

  const unrelated = report.branches.find((row) => row.branch === 'sandbox/history');
  assert.equal(unrelated.head_sha, unrelatedHead);
  assert.equal(unrelated.history_related, false);
  assert.equal(unrelated.merge_base_sha, null);
  assert.equal(unrelated.classification, 'UNRELATED_HISTORY');
  assert.equal(unrelated.semantic_converged_to_base, false);
  assert.deepEqual(unrelated.unique_files, ['history.txt']);
  assert.equal(report.classification_counts.UNRELATED_HISTORY, 1);

  const cli = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('../../../coordination/devos/branch-lineage-auditor.mjs', import.meta.url)),
    '--cwd', cwd,
    '--base', 'release/current',
    '--namespace', 'refs/heads/',
    '--format', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(cli.branch_count, report.branch_count, 'CLI default must audit the same complete namespace as the library API');
  for (const branch of ['main', 'me2/donor', 'repair/runtime', 'fix/packaging', 'scratch/probe', 'perf/soak', 'sandbox/history']) {
    assert.ok(cli.branches.some((row) => row.branch === branch), `CLI omitted branch ${branch}`);
  }
});
