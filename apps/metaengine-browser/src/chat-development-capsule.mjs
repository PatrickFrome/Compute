import crypto from 'node:crypto';

export const CHAT_DEVELOPMENT_CAPSULE_SCHEMA = 'metaengine.chat-development-capsule.v1';
export const CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES = 4 * 1024;
export const CHAT_DEVELOPMENT_CAPSULE_MAX_CI_ROWS = 8;
export const CHAT_DEVELOPMENT_CAPSULE_MAX_ITEMS = 8;
export const CHAT_DEVELOPMENT_CAPSULE_MAX_HOTSPOTS = 12;

const ALLOWED_EVIDENCE_KINDS = new Set(['BLOCKER', 'HOTSPOT', 'NEXT_ACTION', 'CHECKPOINT', 'CHANGE']);
const SEVERITY = Object.freeze({ CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 });
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

function sourceShape(source) {
  const value = plain(source) ? source : {};
  return Object.freeze({
    repository: clip(value.repository, 200),
    branch: clip(value.branch ?? value.ref, 240),
    head_sha: clip(value.head_sha ?? value.head, 64),
    base_sha: clip(value.base_sha, 64),
    pr: Number.isSafeInteger(Number(value.pr)) ? Number(value.pr) : null,
    dirty: typeof value.dirty === 'boolean' ? value.dirty : null,
    authority_effect: false,
  });
}

function normalizeCiRow(row, index) {
  if (!plain(row) || row.authority_effect === true) throw new Error(`chat_dev_capsule_ci_invalid:${index}`);
  const status = String(row.status || '').trim().toLowerCase();
  const conclusion = row.conclusion == null ? null : String(row.conclusion).trim().toLowerCase();
  return Object.freeze({
    id: clip(row.id ?? row.run_id, 40),
    name: clip(row.name, 160),
    status: clip(status, 24),
    conclusion: clip(conclusion, 24),
    head_sha: clip(row.head_sha ?? row.sha, 64),
    ref: clip(row.ref, 180),
    authority_effect: false,
  });
}

function normalizeEvidence(row, index) {
  if (!plain(row) || row.authority_effect === true) throw new Error(`chat_dev_capsule_evidence_invalid:${index}`);
  const kind = String(row.kind || '').trim().toUpperCase();
  if (!ALLOWED_EVIDENCE_KINDS.has(kind)) return null;
  const severity = String(row.severity || 'INFO').trim().toUpperCase();
  if (!(severity in SEVERITY)) throw new Error(`chat_dev_capsule_severity_invalid:${index}`);
  const id = String(row.id || '').trim();
  if (!id || id.length > 160) throw new Error(`chat_dev_capsule_id_invalid:${index}`);
  return Object.freeze({
    id,
    kind,
    title: clip(row.title, 220),
    ref: clip(row.ref, 180),
    path: clip(row.path, 320),
    severity,
    updated_at: row.updated_at == null ? null : clip(new Date(row.updated_at).toISOString(), 40),
    authority_effect: false,
  });
}

function evidenceSort(a, b) {
  return (SEVERITY[b.severity] - SEVERITY[a.severity])
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || a.id.localeCompare(b.id);
}

function compactCi(source, ciRows) {
  const rows = (Array.isArray(ciRows) ? ciRows : []).map(normalizeCiRow);
  const exactHead = source.head_sha;
  const exact = exactHead ? rows.filter((row) => !row.head_sha || row.head_sha === exactHead) : rows;
  const stale = exactHead ? rows.filter((row) => row.head_sha && row.head_sha !== exactHead).length : 0;
  const failed = exact.filter((row) => row.conclusion && !['success', 'skipped', 'neutral'].includes(row.conclusion));
  const pending = exact.filter((row) => !row.conclusion && !['completed'].includes(row.status));
  const success = exact.filter((row) => row.conclusion === 'success').length;
  const state = failed.length ? 'RED' : pending.length ? 'PENDING' : exact.length ? 'GREEN' : 'UNKNOWN';
  return Object.freeze({
    state,
    exact_sha: exactHead,
    success,
    pending: pending.length,
    failed: failed.length,
    stale_rows_ignored: stale,
    failures: failed.slice(0, CHAT_DEVELOPMENT_CAPSULE_MAX_CI_ROWS).map((row) => ({ id: row.id, name: row.name, conclusion: row.conclusion, authority_effect: false })),
    pending_runs: pending.slice(0, CHAT_DEVELOPMENT_CAPSULE_MAX_CI_ROWS).map((row) => ({ id: row.id, name: row.name, status: row.status, authority_effect: false })),
    authority_effect: false,
  });
}

function focusOf(ci, blockers, nextActions) {
  if (ci.failed > 0) return Object.freeze({ kind: 'CI_FAILURE', id: ci.failures[0]?.id ?? null, title: ci.failures[0]?.name ?? null, authority_effect: false });
  if (blockers.length) return Object.freeze({ kind: 'BLOCKER', id: blockers[0].id, title: blockers[0].title, authority_effect: false });
  if (nextActions.length) return Object.freeze({ kind: 'NEXT_ACTION', id: nextActions[0].id, title: nextActions[0].title, authority_effect: false });
  if (ci.pending > 0) return Object.freeze({ kind: 'CI_PENDING', id: ci.pending_runs[0]?.id ?? null, title: ci.pending_runs[0]?.name ?? null, authority_effect: false });
  return Object.freeze({ kind: 'NONE', id: null, title: null, authority_effect: false });
}

function fit(value) {
  const out = structuredClone(value);
  const arrays = ['hotspots', 'changes', 'checkpoints', 'next_actions', 'blockers'];
  while (bytes(out) > CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES) {
    let changed = false;
    for (const key of arrays) {
      if (Array.isArray(out[key]) && out[key].length > 1) {
        out[key].pop();
        changed = true;
        if (bytes(out) <= CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES) break;
      }
    }
    if (!changed && out.ci?.pending_runs?.length) { out.ci.pending_runs.pop(); changed = true; }
    if (!changed && out.ci?.failures?.length > 1) { out.ci.failures.pop(); changed = true; }
    if (!changed) throw new Error(`chat_dev_capsule_budget_exceeded:${bytes(out)}`);
  }
  out.bytes = bytes(out);
  return Object.freeze(out);
}

export function buildChatDevelopmentCapsule({
  source = null,
  ci_runs = [],
  evidence = [],
  evidence_revision = null,
  repo_index_revision = null,
  capability_revision = null,
  generated_at = new Date().toISOString(),
} = {}) {
  const src = sourceShape(source);
  const normalizedEvidence = (Array.isArray(evidence) ? evidence : []).map(normalizeEvidence).filter(Boolean).sort(evidenceSort);
  const selectKind = (kind, limit = CHAT_DEVELOPMENT_CAPSULE_MAX_ITEMS) => normalizedEvidence.filter((row) => row.kind === kind).slice(0, limit);
  const blockers = selectKind('BLOCKER');
  const nextActions = selectKind('NEXT_ACTION');
  const hotspots = selectKind('HOTSPOT', CHAT_DEVELOPMENT_CAPSULE_MAX_HOTSPOTS);
  const checkpoints = selectKind('CHECKPOINT');
  const changes = selectKind('CHANGE');
  const ci = compactCi(src, ci_runs);
  const base = {
    schema: CHAT_DEVELOPMENT_CAPSULE_SCHEMA,
    revision: null,
    generated_at: clip(new Date(generated_at).toISOString(), 40),
    source: src,
    ci,
    focus: focusOf(ci, blockers, nextActions),
    blockers,
    next_actions: nextActions,
    hotspots,
    checkpoints,
    changes,
    search: {
      evidence_revision: clip(evidence_revision, 96),
      repo_index_revision: clip(repo_index_revision, 96),
      capability_revision: clip(capability_revision, 96),
      preferred_tool: 'dev_query',
      authority_effect: false,
    },
    scheduler_authority: false,
    command_authority: false,
    browser_execution_authority: false,
    authority_effect: false,
  };
  const material = JSON.stringify({ ...base, revision: undefined, generated_at: undefined });
  base.revision = `dc:${sha256(material)}`;
  return fit(base);
}
