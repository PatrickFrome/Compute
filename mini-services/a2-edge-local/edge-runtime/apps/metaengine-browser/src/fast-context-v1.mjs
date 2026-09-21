import crypto from 'node:crypto';
import {
  CHAT_DEVELOPMENT_CAPSULE_SCHEMA,
  CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES,
} from './chat-development-capsule.mjs';

export const FAST_CONTEXT_SCHEMA = 'metaengine.fast-context.v1';
export const FAST_CONTEXT_ORDINARY_BUDGET_BYTES = 8 * 1024;
export const FAST_CONTEXT_HARD_MAX_BYTES = 16 * 1024;
export const FAST_CONTEXT_DELTA_BUDGET_BYTES = 4 * 1024;

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function boundedTabs(state) {
  const rows = Array.isArray(state?.tabs) ? state.tabs : [];
  const selected = rows.find((row) => row?.selected === true) || state?.active_tab || null;
  return {
    count: rows.length,
    selected: selected ? {
      tab_id: clip(selected.tab_id, 96),
      url: clip(selected.url, 1200),
      title: clip(selected.title, 240),
      kind: clip(selected.kind, 48),
    } : null,
    authority_effect: false,
  };
}

function boundedDevelopment(state, source) {
  const dev = state?.development_plane && typeof state.development_plane === 'object'
    ? state.development_plane
    : {};
  const src = source && typeof source === 'object' ? source : {};
  return {
    repository: clip(src.repository ?? dev.repository, 200),
    branch: clip(src.branch ?? dev.branch ?? dev.repo_head?.branch, 240),
    head_sha: clip(src.head_sha ?? dev.head_sha ?? dev.repo_head?.head_sha, 64),
    base_sha: clip(src.base_sha, 64),
    pr: Number.isSafeInteger(Number(src.pr)) ? Number(src.pr) : null,
    dirty: typeof src.dirty === 'boolean' ? src.dirty : null,
    authority_effect: false,
  };
}

function boundedCi(ci) {
  const value = ci && typeof ci === 'object' ? ci : {};
  const count = (key) => Number.isSafeInteger(Number(value[key])) ? Math.max(0, Number(value[key])) : 0;
  return {
    success: count('success'),
    pending: count('pending'),
    failed: count('failed'),
    exact_sha: clip(value.exact_sha, 64),
    authority_effect: false,
  };
}

function authorityContaminated(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((row) => authorityContaminated(row, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (['authority_effect', 'command_authority', 'scheduler_authority', 'browser_execution_authority', 'projection_is_authority'].includes(key) && child === true) return true;
    if (authorityContaminated(child, depth + 1)) return true;
  }
  return false;
}

function boundedDevelopmentCapsule(capsule, development) {
  if (capsule == null) return null;
  if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) throw new Error('fast_context_dev_capsule_invalid');
  if (capsule.schema !== CHAT_DEVELOPMENT_CAPSULE_SCHEMA) throw new Error('fast_context_dev_capsule_schema_invalid');
  if (authorityContaminated(capsule)) throw new Error('fast_context_dev_capsule_authority_forbidden');
  const size = byteLength(capsule);
  if (size > CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES) throw new Error(`fast_context_dev_capsule_too_large:${size}`);
  const contextHead = String(development?.head_sha || '').trim().toLowerCase();
  const capsuleHead = String(capsule?.source?.head_sha || '').trim().toLowerCase();
  if (contextHead && capsuleHead && contextHead !== capsuleHead) throw new Error('fast_context_dev_capsule_head_mismatch');
  return structuredClone(capsule);
}

function pickFields(context, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return context;
  const required = new Set(['schema', 'revision', 'state_digest', 'generated_at', 'freshness_ms', 'capability_revision', 'authority_effect']);
  const allowed = new Set(fields.map((value) => String(value || '').trim()).filter(Boolean));
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    if (required.has(key) || allowed.has(key)) out[key] = value;
  }
  return out;
}

function fitToBudget(context, maxBytes) {
  const budget = Math.max(256, Math.min(FAST_CONTEXT_HARD_MAX_BYTES, Number(maxBytes) || FAST_CONTEXT_ORDINARY_BUDGET_BYTES));
  let out = structuredClone(context);
  if (byteLength(out) <= budget) return Object.freeze({ context: out, bytes: byteLength(out), truncated: false });

  // Drop optional verbose source/UI text before failing the contract. Identity,
  // control, revisions, development capsule and error state are never silently removed.
  if (out.tabs?.selected) {
    out.tabs.selected.title = null;
    out.tabs.selected.url = clip(out.tabs.selected.url, 320);
  }
  if (out.latest_error) out.latest_error = clip(out.latest_error, 160);
  if (byteLength(out) <= budget) return Object.freeze({ context: out, bytes: byteLength(out), truncated: true });

  throw new Error(`fast_context_budget_exceeded:${byteLength(out)}:${budget}`);
}

export function buildFastContext({
  state = {},
  source = null,
  ci = null,
  development_capsule = null,
  capability_revision = null,
  last_checkpoint_id = null,
  fields = null,
  if_none_match = null,
  max_bytes = FAST_CONTEXT_ORDINARY_BUDGET_BYTES,
  now_ms = Date.now(),
} = {}) {
  const generatedAt = new Date(now_ms).toISOString();
  const stateText = JSON.stringify(state ?? {});
  const lastSeenMs = Date.parse(String(state?.heartbeat_at || state?.last_seen_at || generatedAt));
  const freshnessMs = Number.isFinite(lastSeenMs) ? Math.max(0, now_ms - lastSeenMs) : null;
  const development = boundedDevelopment(state, source);
  const context = {
    schema: FAST_CONTEXT_SCHEMA,
    revision: null,
    state_digest: `sha256:${sha256(stateText)}`,
    generated_at: generatedAt,
    freshness_ms: freshnessMs,
    identity: {
      client_id: clip(state?.client_id, 160),
      version: clip(state?.shell_version ?? state?.extension_version, 64),
      process_incarnation_id: clip(state?.process_incarnation_id ?? state?.supervisor_lifecycle?.process_incarnation_id, 96),
      operator_runtime: clip(state?.operator_runtime, 96),
      authority_effect: false,
    },
    control: {
      mode: clip(state?.supervisor_mode, 32),
      armed: state?.armed === true,
      operator_mode: clip(state?.operator_mode, 32),
      authority_effect: false,
    },
    tabs: boundedTabs(state),
    development,
    development_capsule: boundedDevelopmentCapsule(development_capsule, development),
    ci: boundedCi(ci),
    runs: {
      pending: Number.isSafeInteger(Number(state?.runs?.pending)) ? Math.max(0, Number(state.runs.pending)) : 0,
      active: Number.isSafeInteger(Number(state?.runs?.active)) ? Math.max(0, Number(state.runs.active)) : 0,
      authority_effect: false,
    },
    latest_error: clip(state?.last_error, 500),
    capability_revision: clip(capability_revision ?? state?.capability_revision, 80),
    last_checkpoint_id: clip(last_checkpoint_id, 160),
    authority_effect: false,
  };

  const revisionMaterial = JSON.stringify({ ...context, revision: undefined, generated_at: undefined, freshness_ms: undefined });
  context.revision = `ctx:${sha256(revisionMaterial)}`;

  if (if_none_match && String(if_none_match) === context.revision) {
    const notModified = Object.freeze({
      schema: FAST_CONTEXT_SCHEMA,
      status: 'NOT_MODIFIED',
      revision: context.revision,
      generated_at: generatedAt,
      freshness_ms: freshnessMs,
      authority_effect: false,
    });
    return Object.freeze({ status: 'NOT_MODIFIED', context: notModified, bytes: byteLength(notModified), truncated: false });
  }

  const selected = pickFields(context, fields);
  const fitted = fitToBudget(selected, max_bytes);
  return Object.freeze({ status: 'OK', ...fitted });
}
