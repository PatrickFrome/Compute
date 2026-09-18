import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditBranchLineage,
  BRANCH_LINEAGE_AUDIT_SCHEMA,
  listBranchRefs,
  renderBranchLineageMarkdown,
} from '../coordination/devos/branch-lineage-auditor.mjs';

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

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lineage-audit-'));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'audit@example.invalid');
  git(cwd, 'config', 'user.name', 'Lineage Audit Test');
  write(cwd, 'README.md', 'root\n');
  commitAll(cwd, 'root');

  git(cwd, 'checkout', '-b', 'work/contained');
  write(cwd, 'docs/contained.md', 'contained\n');
  commitAll(cwd, 'contained');

  git(cwd, 'checkout', '-b', 'audit');
  write(cwd, 'docs/audit.md', 'audit base\n');
  commitAll(cwd, 'audit base');

  git(cwd, 'checkout', '-b', 'work/ahead-safe');
  write(cwd, 'docs/safe.md', 'safe unique\n');
  commitAll(cwd, 'safe ahead');

  git(cwd, 'checkout', 'audit');
  git(cwd, 'checkout', '-b', 'work/ahead-authority');
  write(cwd, 'supabase/migrations/20990101000000_authority.sql', 'select 1;\n');
  commitAll(cwd, 'authority ahead');

  git(cwd, 'checkout', 'main');
  git(cwd, 'checkout', '-b', 'work/diverged-authority');
  write(cwd, 'apps/metaengine-browser/src/devos-new-control.mjs', 'export const authority = false;\n');
  commitAll(cwd, 'authority diverged');

  git(cwd, 'checkout', 'audit');
  return cwd;
}

function stackedFixture() {
  const cwd = fixture();
  git(cwd, 'checkout', 'main');

  git(cwd, 'checkout', '-b', 'work/c0-layer-a');
  write(cwd, 'supabase/migrations/20990101000100_c0_a.sql', 'select 1;\n');
  commitAll(cwd, 'c0 a');

  git(cwd, 'checkout', '-b', 'work/c0-layer-b');
  write(cwd, 'docs/c0-b.md', 'layer b\n');
  commitAll(cwd, 'c0 b');

  git(cwd, 'checkout', '-b', 'work/c0-layer-c');
  write(cwd, 'apps/metaengine-browser/src/devos-c0-control.mjs', 'export const authority = false;\n');
  commitAll(cwd, 'c0 c');
  git(cwd, 'branch', 'work/c0-layer-c-alias');

  git(cwd, 'checkout', 'main');
  git(cwd, 'checkout', '-b', 'work/c0-sibling');
  write(cwd, 'supabase/migrations/20990101000200_c0_sibling.sql', 'select 2;\n');
  commitAll(cwd, 'c0 sibling');

  git(cwd, 'checkout', 'audit');
  return cwd;
}

function historicalAuthorityConvergenceFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lineage-convergence-'));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'audit@example.invalid');
  git(cwd, 'config', 'user.name', 'Lineage Audit Test');
  write(cwd, 'README.md', 'root\n');
  commitAll(cwd, 'root');

  git(cwd, 'checkout', '-b', 'audit');
  write(cwd, 'supabase/migrations/20990101000900_shared.sql', 'select 42;\n');
  commitAll(cwd, 'integrate authority independently');

  git(cwd, 'checkout', 'main');
  git(cwd, 'checkout', '-b', 'work/c0-converged-authority');
  write(cwd, 'supabase/migrations/20990101000900_shared.sql', 'select 42;\n');
  commitAll(cwd, 'historical authority implementation');

  git(cwd, 'checkout', 'audit');
  return cwd;
}

function byBranch(report, name) {
  const row = report.branches.find((entry) => entry.branch === name);
  assert.ok(row, `missing branch ${name}`);
  return row;
}

test('classifies contained, ahead and diverged lineages with authority risk', () => {
  const cwd = fixture();
  const refs = listBranchRefs({ cwd, namespace: 'refs/heads/' });
  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\//,
    refs,
  });

  assert.equal(report.schema, BRANCH_LINEAGE_AUDIT_SCHEMA);
  assert.equal(report.authority_effect, false);
  assert.equal(report.mutates_refs, false);
  assert.equal(report.mutates_worktree, false);
  assert.equal(report.invokes_scheduler, false);

  const contained = byBranch(report, 'work/contained');
  assert.equal(contained.classification, 'CONTAINED');
  assert.equal(contained.unique_commits, 0);
  assert.equal(contained.superseded_by_base, true);
  assert.equal(contained.lineage_tip, false);

  const safe = byBranch(report, 'work/ahead-safe');
  assert.equal(safe.classification, 'AHEAD_NONAUTHORITY');
  assert.equal(safe.unique_commits, 1);
  assert.equal(safe.authority_critical, false);
  assert.equal(safe.lineage_tip, true);

  const aheadAuthority = byBranch(report, 'work/ahead-authority');
  assert.equal(aheadAuthority.classification, 'AHEAD_AUTHORITY');
  assert.equal(aheadAuthority.authority_categories.includes('DATABASE_AUTHORITY'), true);
  assert.equal(aheadAuthority.unique_files.includes('supabase/migrations/20990101000000_authority.sql'), true);

  const diverged = byBranch(report, 'work/diverged-authority');
  assert.equal(diverged.classification, 'DIVERGED_AUTHORITY');
  assert.equal(diverged.base_only_commits > 0, true);
  assert.equal(diverged.unique_commits, 1);
  assert.equal(diverged.authority_categories.includes('SCHEDULER_CONTROL'), true);
});

test('historical authority commits do not remain current authority blockers after byte-identical tip convergence', () => {
  const cwd = historicalAuthorityConvergenceFixture();
  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\/c0-converged-authority$/,
  });
  const row = byBranch(report, 'work/c0-converged-authority');

  assert.equal(row.unique_commits, 1);
  assert.equal(row.base_only_commits, 1);
  assert.equal(row.classification, 'DIVERGED_HISTORY_ONLY');
  assert.equal(row.semantic_converged_to_base, true);
  assert.equal(row.tip_delta_file_count, 0);
  assert.equal(row.authority_critical, false);
  assert.equal(row.authority_categories.length, 0);
  assert.equal(row.historical_authority_critical, true);
  assert.equal(row.historical_authority_categories.includes('DATABASE_AUTHORITY'), true);
  assert.equal(row.lineage_tip, false);
  assert.equal(report.authority_branch_count, 0);
  assert.equal(report.historical_authority_branch_count, 1);
  assert.equal(report.semantic_converged_branch_count, 1);
});

test('exact ancestry collapses stacked same-family branches to independent lineage tips', () => {
  const cwd = stackedFixture();
  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\/c0-/,
  });

  assert.equal(report.branch_count, 5);
  assert.equal(report.lineage_tip_count, 2);
  assert.equal(report.authority_lineage_tip_count, 2);

  const a = byBranch(report, 'work/c0-layer-a');
  const b = byBranch(report, 'work/c0-layer-b');
  const c = byBranch(report, 'work/c0-layer-c');
  const alias = byBranch(report, 'work/c0-layer-c-alias');
  const sibling = byBranch(report, 'work/c0-sibling');

  assert.equal(a.lineage_tip, false);
  assert.equal(a.superseded_by_branch, 'work/c0-layer-c');
  assert.equal(b.lineage_tip, false);
  assert.equal(b.superseded_by_branch, 'work/c0-layer-c');
  assert.equal(c.lineage_tip, true);
  assert.equal(c.superseded_by_branch, null);
  assert.equal(alias.lineage_tip, false);
  assert.equal(alias.equivalent_to_branch, 'work/c0-layer-c');
  assert.equal(alias.superseded_by_branch, 'work/c0-layer-c');
  assert.equal(sibling.lineage_tip, true);

  assert.deepEqual(report.lineage_tips.map((row) => row.branch).sort(), ['work/c0-layer-c', 'work/c0-sibling']);
  assert.equal(report.family_summary.length, 1);
  assert.deepEqual(report.family_summary[0], {
    family: 'work/c0',
    branch_count: 5,
    contained_count: 0,
    semantic_converged_count: 0,
    lineage_tip_count: 2,
    authority_lineage_tip_count: 2,
  });
});

test('audit is observational: refs, HEAD and worktree stay byte-for-byte unchanged', () => {
  const cwd = fixture();
  const refsBefore = git(cwd, 'show-ref');
  const headBefore = git(cwd, 'rev-parse', 'HEAD');
  const statusBefore = git(cwd, 'status', '--porcelain=v1', '--untracked-files=all');

  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\//,
  });
  assert.equal(report.branches.length, 4);

  assert.equal(git(cwd, 'show-ref'), refsBefore);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'), statusBefore);
});

test('branch and file caps fail closed or truncate output without hiding authority risk', () => {
  const cwd = fixture();
  assert.throws(() => auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\//,
    maxBranches: 2,
  }), /branch_limit_exceeded/);

  const report = auditBranchLineage({
    cwd,
    baseRef: 'audit',
    namespace: 'refs/heads/',
    include: /^work\/ahead-authority$/,
    maxFilesPerBranch: 1,
  });
  const row = byBranch(report, 'work/ahead-authority');
  assert.equal(row.authority_critical, true);
  assert.equal(row.authority_match_count, 1);
  assert.equal(row.unique_files.length, 1);
  assert.equal(row.tip_delta_files.length, 1);
});

test('markdown projection is deterministic and explicitly read-only', () => {
  const cwd = fixture();
  const report = auditBranchLineage({ cwd, baseRef: 'audit', namespace: 'refs/heads/', include: /^work\// });
  const first = renderBranchLineageMarkdown(report);
  const second = renderBranchLineageMarkdown(report);
  assert.equal(first, second);
  assert.match(first, /DIVERGED_AUTHORITY/);
  assert.match(first, /AHEAD_NONAUTHORITY/);
  assert.match(first, /authority-bearing tips/);
  assert.match(first, /Historical authority/);
  assert.match(first, /Read-only audit/);
  assert.doesNotMatch(first, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
