import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BRANCH_LINEAGE_AUDIT_SCHEMA = 'metaengine.devos.branch-lineage-audit.v1';
export const BRANCH_LINEAGE_AUDIT_VERSION = '1.1.0';

export const AUTHORITY_RULES = Object.freeze([
  ['CI_GOVERNANCE', (p) => p.startsWith('.github/workflows/')],
  ['DATABASE_AUTHORITY', (p) => p.startsWith('supabase/migrations/') || p.includes('/supabase/')],
  ['SCHEDULER_CONTROL', (p) => /(^|\/)(devos|meta-orchestrator|autonomy-governor|fleet-task)/.test(p)],
  ['BROWSER_ACTUATION', (p) => p.startsWith('apps/metaengine-browser/src/') && /(native-browser-control|native-supervisor|devos-native-task-cycle|fleet-runtime-bridge|fleet-supervisor|main\.mjs)/.test(p)],
  ['WORKSPACE_MUTATION', (p) => p.startsWith('apps/metaengine-browser/src/workspace-') || /workspace[_-]binding/.test(p)],
  ['RELEASE_SELF_UPDATE', (p) => /(self-update|trusted-dev-release-resolver|verified-download-manager)/.test(p)],
  ['AGENT_RUNTIME', (p) => p.startsWith('coordination/browser-shared/') || p.startsWith('coordination/browser-compute/') || p.startsWith('coordination/browser-skill-source-')],
]);

const KNOWN_FAMILIES = Object.freeze([
  'self-update', 'browser', 'devos', 'c0', 'c5', 'workspace', 'meta', 'a2', 'windows', 'release', 'supervisor',
]);

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error?.stderr || error?.message || error).trim().slice(0, 500);
    throw new Error(`branch_lineage_git_failed:${args[0]}:${detail}`);
  }
}

function positiveInt(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`branch_lineage_${name}_invalid`);
  return parsed;
}

function resolveCommit(cwd, ref) {
  const value = git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error('branch_lineage_commit_resolution_invalid');
  return value.toLowerCase();
}

function familyOf(branch) {
  const [namespace, rest = ''] = String(branch).split('/', 2);
  if (namespace === 'integration' || namespace === 'release') {
    const stem = rest.split('-').slice(0, 3).join('-') || rest;
    return `${namespace}/${stem}`;
  }
  if (namespace !== 'work') return namespace || 'other';
  const lower = rest.toLowerCase();
  const known = KNOWN_FAMILIES.find((prefix) => lower === prefix || lower.startsWith(`${prefix}-`));
  if (known) return `work/${known}`;
  const stem = rest.split('-').slice(0, 2).join('-') || rest;
  return `work/${stem || 'other'}`;
}

function classifyAuthority(paths) {
  const matches = [];
  const categories = new Set();
  for (const path of paths) {
    const pathCategories = AUTHORITY_RULES.filter(([, test]) => test(path)).map(([name]) => name);
    if (!pathCategories.length) continue;
    pathCategories.forEach((name) => categories.add(name));
    matches.push({ path, categories: pathCategories.sort() });
  }
  return {
    authority_critical: matches.length > 0,
    authority_categories: [...categories].sort(),
    authority_matches: matches,
  };
}

function parseCounts(value) {
  const match = String(value || '').match(/^(\d+)\s+(\d+)$/);
  if (!match) throw new Error('branch_lineage_rev_count_invalid');
  return { base_only_commits: Number(match[1]), unique_commits: Number(match[2]) };
}

function relationClass({ baseSha, headSha, baseOnly, unique, authority }) {
  if (headSha === baseSha) return 'BASE';
  if (unique === 0) return 'CONTAINED';
  const prefix = baseOnly === 0 ? 'AHEAD' : 'DIVERGED';
  return `${prefix}_${authority ? 'AUTHORITY' : 'NONAUTHORITY'}`;
}

function riskRank(classification) {
  return ({
    BASE: 0,
    CONTAINED: 0,
    AHEAD_NONAUTHORITY: 1,
    DIVERGED_NONAUTHORITY: 2,
    AHEAD_AUTHORITY: 3,
    DIVERGED_AUTHORITY: 4,
  })[classification] ?? 5;
}

function sortRisk(a, b) {
  return b.risk_rank - a.risk_rank || b.unique_commits - a.unique_commits || a.branch.localeCompare(b.branch);
}

function containingRefs(cwd, headSha, namespace) {
  const raw = git(cwd, ['for-each-ref', '--format=%(refname)', '--contains', headSha, namespace]);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function enrichLineageTips(cwd, branches, namespace) {
  const byRef = new Map(branches.map((row) => [row.ref, row]));
  const byFamily = new Map();
  for (const row of branches) {
    if (!byFamily.has(row.family)) byFamily.set(row.family, []);
    byFamily.get(row.family).push(row);
  }

  const descendantsByBranch = new Map();
  for (const row of branches) {
    if (row.unique_commits === 0 || row.classification === 'BASE') {
      descendantsByBranch.set(row.branch, []);
      continue;
    }
    const descendants = containingRefs(cwd, row.head_sha, namespace)
      .map((ref) => byRef.get(ref))
      .filter((candidate) => candidate
        && candidate.branch !== row.branch
        && candidate.family === row.family
        && candidate.unique_commits > 0
        && candidate.head_sha !== row.head_sha);
    descendants.sort(sortRisk);
    descendantsByBranch.set(row.branch, descendants);
  }

  const canonicalByHead = new Map();
  for (const [family, rows] of byFamily) {
    const byHead = new Map();
    for (const row of rows.filter((candidate) => candidate.unique_commits > 0)) {
      if (!byHead.has(row.head_sha)) byHead.set(row.head_sha, []);
      byHead.get(row.head_sha).push(row);
    }
    for (const [headSha, aliases] of byHead) {
      aliases.sort((a, b) => a.branch.localeCompare(b.branch));
      canonicalByHead.set(`${family}:${headSha}`, aliases[0].branch);
    }
  }

  for (const row of branches) {
    const canonical = canonicalByHead.get(`${row.family}:${row.head_sha}`) || row.branch;
    const descendants = descendantsByBranch.get(row.branch) || [];
    row.equivalent_to_branch = canonical !== row.branch ? canonical : null;
    row.lineage_tip = row.unique_commits > 0
      && row.classification !== 'BASE'
      && row.equivalent_to_branch == null
      && descendants.length === 0;
  }

  const tipsByFamily = new Map();
  for (const row of branches.filter((candidate) => candidate.lineage_tip)) {
    if (!tipsByFamily.has(row.family)) tipsByFamily.set(row.family, []);
    tipsByFamily.get(row.family).push(row);
  }
  for (const tips of tipsByFamily.values()) tips.sort(sortRisk);

  for (const row of branches) {
    if (row.superseded_by_base) {
      row.superseded_by_branch = null;
      continue;
    }
    const descendants = descendantsByBranch.get(row.branch) || [];
    const descendantBranches = new Set(descendants.map((candidate) => candidate.branch));
    const terminalTips = (tipsByFamily.get(row.family) || []).filter((tip) => descendantBranches.has(tip.branch));
    if (terminalTips.length) row.superseded_by_branch = terminalTips[0].branch;
    else if (row.equivalent_to_branch) row.superseded_by_branch = row.equivalent_to_branch;
    else row.superseded_by_branch = null;
  }

  const lineageTips = branches.filter((row) => row.lineage_tip).sort(sortRisk);
  const familySummary = [...byFamily.entries()].map(([family, rows]) => ({
    family,
    branch_count: rows.length,
    contained_count: rows.filter((row) => row.superseded_by_base).length,
    lineage_tip_count: rows.filter((row) => row.lineage_tip).length,
    authority_lineage_tip_count: rows.filter((row) => row.lineage_tip && row.authority_critical).length,
  })).sort((a, b) => b.authority_lineage_tip_count - a.authority_lineage_tip_count || b.lineage_tip_count - a.lineage_tip_count || a.family.localeCompare(b.family));

  return { lineageTips, familySummary };
}

export function listBranchRefs({ cwd = process.cwd(), namespace = 'refs/remotes/origin/' } = {}) {
  if (!String(namespace).startsWith('refs/')) throw new Error('branch_lineage_namespace_invalid');
  const raw = git(cwd, ['for-each-ref', '--format=%(refname)\t%(objectname)\t%(symref)', namespace]);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [refname, sha, symref = ''] = line.split('\t');
    return { refname, sha: String(sha || '').toLowerCase(), symref };
  }).filter((row) => row.refname && /^[0-9a-f]{40}$/.test(row.sha) && !row.symref);
}

export function auditBranchLineage({
  cwd = process.cwd(),
  baseRef = 'HEAD',
  namespace = 'refs/remotes/origin/',
  include = /^(work|integration|release)\//,
  maxBranches = 1000,
  maxFilesPerBranch = 200,
  refs = null,
} = {}) {
  const branchLimit = positiveInt(maxBranches, 1000, 'max_branches');
  const fileLimit = positiveInt(maxFilesPerBranch, 200, 'max_files');
  const includeRe = include instanceof RegExp ? include : new RegExp(String(include));
  const baseSha = resolveCommit(cwd, baseRef);
  const sourceRefs = refs ?? listBranchRefs({ cwd, namespace });
  const prefix = String(namespace);
  const candidates = sourceRefs.map((row) => ({
    ...row,
    branch: row.refname.startsWith(prefix) ? row.refname.slice(prefix.length) : row.refname.replace(/^refs\/(heads|remotes\/[^/]+)\//, ''),
  })).filter((row) => includeRe.test(row.branch));

  if (candidates.length > branchLimit) {
    throw new Error(`branch_lineage_branch_limit_exceeded:${candidates.length}:${branchLimit}`);
  }

  const branches = candidates.map((row) => {
    const headSha = resolveCommit(cwd, row.refname);
    const counts = parseCounts(git(cwd, ['rev-list', '--left-right', '--count', `${baseSha}...${headSha}`]));
    let mergeBaseSha = null;
    let uniquePaths = [];
    if (counts.unique_commits === 0) {
      mergeBaseSha = headSha;
    } else if (counts.base_only_commits === 0) {
      mergeBaseSha = baseSha;
      uniquePaths = git(cwd, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${baseSha}..${headSha}`, '--']).split('\n').filter(Boolean);
    } else {
      mergeBaseSha = git(cwd, ['merge-base', baseSha, headSha]);
      if (!/^[0-9a-f]{40}$/i.test(mergeBaseSha || '')) throw new Error(`branch_lineage_merge_base_invalid:${row.branch}`);
      mergeBaseSha = mergeBaseSha.toLowerCase();
      uniquePaths = git(cwd, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${mergeBaseSha}..${headSha}`, '--']).split('\n').filter(Boolean);
    }

    const authority = classifyAuthority(uniquePaths);
    const classification = relationClass({
      baseSha,
      headSha,
      baseOnly: counts.base_only_commits,
      unique: counts.unique_commits,
      authority: authority.authority_critical,
    });
    return {
      branch: row.branch,
      ref: row.refname,
      family: familyOf(row.branch),
      head_sha: headSha,
      merge_base_sha: mergeBaseSha,
      base_only_commits: counts.base_only_commits,
      unique_commits: counts.unique_commits,
      classification,
      risk_rank: riskRank(classification),
      authority_critical: authority.authority_critical,
      authority_categories: authority.authority_categories,
      authority_match_count: authority.authority_matches.length,
      authority_matches: authority.authority_matches.slice(0, fileLimit),
      unique_file_count: uniquePaths.length,
      unique_files_truncated: uniquePaths.length > fileLimit,
      unique_files: uniquePaths.slice(0, fileLimit),
      superseded_by_base: classification === 'CONTAINED',
      superseded_by_branch: null,
      equivalent_to_branch: null,
      lineage_tip: false,
      read_only: true,
      authority_effect: false,
    };
  });

  branches.sort(sortRisk);
  const { lineageTips, familySummary } = enrichLineageTips(cwd, branches, namespace);
  const counts = {};
  for (const branch of branches) counts[branch.classification] = (counts[branch.classification] || 0) + 1;
  const authorityLineageTips = lineageTips.filter((row) => row.authority_critical);
  return {
    schema: BRANCH_LINEAGE_AUDIT_SCHEMA,
    version: BRANCH_LINEAGE_AUDIT_VERSION,
    base_ref: String(baseRef),
    base_sha: baseSha,
    namespace,
    branch_count: branches.length,
    classification_counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    authority_branch_count: branches.filter((row) => row.authority_critical && row.unique_commits > 0).length,
    lineage_tip_count: lineageTips.length,
    authority_lineage_tip_count: authorityLineageTips.length,
    family_summary: familySummary,
    lineage_tips: lineageTips,
    top_authority_lineage_tips: authorityLineageTips.slice(0, 25),
    branches,
    mutates_refs: false,
    mutates_worktree: false,
    invokes_scheduler: false,
    authority_effect: false,
  };
}

export function renderBranchLineageMarkdown(report) {
  if (report?.schema !== BRANCH_LINEAGE_AUDIT_SCHEMA) throw new Error('branch_lineage_report_schema_invalid');
  const lines = [
    '# Branch Lineage Audit V1',
    '',
    `Base: \`${report.base_ref}\` @ \`${report.base_sha}\``,
    `Branches: ${report.branch_count}; raw authority-bearing branches: ${report.authority_branch_count}; lineage tips: ${report.lineage_tip_count}; authority-bearing tips: ${report.authority_lineage_tip_count}.`,
    '',
    '| Tip | Class | Branch | Unique | Base-only | Superseded by | Authority | Family |',
    '|---|---|---|---:|---:|---|---|---|',
  ];
  for (const row of report.branches) {
    const authority = row.authority_categories.length ? row.authority_categories.join(', ') : '—';
    const superseded = row.superseded_by_base ? 'BASE' : (row.superseded_by_branch || row.equivalent_to_branch || '—');
    lines.push(`| ${row.lineage_tip ? 'TIP' : '—'} | ${row.classification} | \`${row.branch}\` | ${row.unique_commits} | ${row.base_only_commits} | \`${superseded}\` | ${authority} | \`${row.family}\` |`);
  }
  lines.push('', '> Read-only audit: no ref mutation, worktree mutation, scheduler call, merge, cherry-pick, release, or Browser actuation is performed.');
  return `${lines.join('\n')}\n`;
}

function parseCli(argv) {
  const out = {
    cwd: process.cwd(),
    baseRef: 'HEAD',
    namespace: 'refs/remotes/origin/',
    include: /^(work|integration|release)\//,
    maxBranches: 1000,
    maxFilesPerBranch: 200,
    format: 'json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next == null) throw new Error(`branch_lineage_cli_value_missing:${arg}`);
      return next;
    };
    if (arg === '--cwd') out.cwd = value();
    else if (arg === '--base') out.baseRef = value();
    else if (arg === '--namespace') out.namespace = value();
    else if (arg === '--include') out.include = new RegExp(value());
    else if (arg === '--max-branches') out.maxBranches = positiveInt(value(), 1000, 'max_branches');
    else if (arg === '--max-files') out.maxFilesPerBranch = positiveInt(value(), 200, 'max_files');
    else if (arg === '--format') out.format = value();
    else if (arg === '--help') out.help = true;
    else throw new Error(`branch_lineage_cli_argument_unknown:${arg}`);
  }
  if (!['json', 'markdown'].includes(out.format)) throw new Error('branch_lineage_cli_format_invalid');
  return out;
}

function help() {
  return [
    'Usage: node coordination/devos/branch-lineage-auditor.mjs [options]',
    '  --base <ref>          comparison base (default HEAD)',
    '  --namespace <ref/>    branch namespace (default refs/remotes/origin/)',
    '  --include <regex>      branch-name regex (default ^(work|integration|release)/)',
    '  --format json|markdown',
    '  --max-branches <n>     fail-closed branch cap (default 1000)',
    '  --max-files <n>        emitted file cap per branch (authority detection still scans all)',
    '',
    'Lineage tips are derived only from exact Git ancestry inside the same branch family.',
    'The auditor is read-only and never runs git mutation commands.',
  ].join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.help) process.stdout.write(`${help()}\n`);
    else {
      const report = auditBranchLineage(cli);
      process.stdout.write(cli.format === 'markdown' ? renderBranchLineageMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}
