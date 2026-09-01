import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditBranchLineage } from '../coordination/devos/branch-lineage-auditor.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function commitAll(cwd, message) {
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', message);
}

test('base-only authority files never become current debt of a nonauthority diverged branch', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lineage-base-only-'));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'audit@example.invalid');
  git(cwd, 'config', 'user.name', 'Lineage Audit Test');
  write(cwd, 'README.md', 'root\n');
  commitAll(cwd, 'root');

  git(cwd, 'checkout', '-b', 'audit');
  write(cwd, 'supabase/migrations/20990101000000_base_only.sql', 'select 1;\n');
  commitAll(cwd, 'base-only authority');

  git(cwd, 'checkout', 'main');
  git(cwd, 'checkout', '-b', 'work/safe-diverged');
  write(cwd, 'docs/safe.md', 'branch-owned nonauthority delta\n');
  commitAll(cwd, 'safe branch delta');
  git(cwd, 'checkout', 'audit');

  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\/safe-diverged$/,
  });
  const row = report.branches[0];
  assert.equal(row.branch, 'work/safe-diverged');
  assert.equal(row.unique_commits, 1);
  assert.equal(row.base_only_commits, 1);
  assert.equal(row.classification, 'DIVERGED_NONAUTHORITY');
  assert.equal(row.authority_critical, false);
  assert.equal(row.historical_authority_critical, false);
  assert.deepEqual(row.tip_delta_files, ['docs/safe.md']);
  assert.equal(row.base_only_tip_delta_file_count, 1);
  assert.equal(row.semantic_converged_to_base, false);
  assert.equal(report.authority_branch_count, 0);
});
