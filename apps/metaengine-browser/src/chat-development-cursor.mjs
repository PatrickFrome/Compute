import crypto from 'node:crypto';
import { CHAT_DEVELOPMENT_PROVIDER_SCHEMA } from './chat-development-query-provider.mjs';

export const CHAT_DEVELOPMENT_CURSOR_SCHEMA = 'metaengine.chat-development-cursor.v1';
export const CHAT_DEVELOPMENT_CURSOR_MAX_BYTES = 4 * 1024;
export const CHAT_DEVELOPMENT_CURSOR_MAX_HITS = 4;

const CONTINUATION_INTENTS = new Set([
  'continue',
  'continue development',
  'continue work',
  'proceed',
  'next',
  'next step',
  'what next',
  'current blocker',
  'продолжи',
  'продолжай',
  'продолжить',
  'продолжи разработку',
  'продолжай разработку',
  'дальше',
  'что дальше',
  'следующий шаг',
  'текущий блокер',
]);

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

export function normalizeContinuationIntent(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[.!?;,：:]+$/gu, '')
    .replace(/\s+/g, ' ');
}

export function isContinuationIntent(value) {
  return CONTINUATION_INTENTS.has(normalizeContinuationIntent(value));
}

function sanitizeOrientation(value) {
  if (!value || typeof value !== 'object' || value.authority_effect === true) return null;
  const prValue = value.pr == null ? null : Number(value.pr);
  return Object.freeze({
    revision: clip(value.revision, 96),
    head_sha: clip(value.head_sha, 64),
    branch: clip(value.branch, 240),
    pr: prValue != null && Number.isSafeInteger(prValue) ? prValue : null,
    ci_state: clip(value.ci_state, 24),
    ci_failed: Number(value.ci_failed || 0),
    ci_pending: Number(value.ci_pending || 0),
    focus_kind: clip(value.focus_kind, 48),
    focus_id: clip(value.focus_id, 160),
    focus_title: clip(value.focus_title, 240),
    authority_effect: false,
  });
}

function sanitizeHit(value) {
  if (!value || typeof value !== 'object' || value.authority_effect === true) return null;
  return Object.freeze({
    source: clip(value.source, 24),
    id: clip(value.id, 160),
    kind: clip(value.kind, 48),
    title: clip(value.title, 240),
    path: clip(value.path, 400),
    line: Number.isSafeInteger(Number(value.line)) ? Number(value.line) : null,
    snippet: clip(value.snippet ?? value.text, 640),
    ref: clip(value.ref, 240),
    severity: clip(value.severity, 24),
    score: Number.isFinite(Number(value.score)) ? Number(value.score) : null,
    authority_effect: false,
  });
}

function boundedCursor({ stateRevision, sourceQuery, result }) {
  const orientation = sanitizeOrientation(result?.orientation);
  const hits = Array.isArray(result?.hits)
    ? result.hits.map(sanitizeHit).filter(Boolean).slice(0, CHAT_DEVELOPMENT_CURSOR_MAX_HITS)
    : [];
  const base = {
    schema: CHAT_DEVELOPMENT_CURSOR_SCHEMA,
    state_revision: stateRevision,
    source_query: clip(sourceQuery, 512),
    source_query_revision: clip(result?.query_revision, 96),
    orientation,
    hits,
    total_hits: Number.isSafeInteger(Number(result?.total_hits)) ? Number(result.total_hits) : hits.length,
    truncated: Boolean(result?.truncated) || (Array.isArray(result?.hits) && result.hits.length > hits.length),
    authority_effect: false,
  };
  while (base.hits.length && bytes(base) > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) base.hits.pop();
  if (bytes(base) > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) {
    base.source_query = clip(base.source_query, 160);
    if (base.orientation) {
      base.orientation = Object.freeze({
        head_sha: base.orientation.head_sha,
        ci_state: base.orientation.ci_state,
        focus_kind: base.orientation.focus_kind,
        focus_id: base.orientation.focus_id,
        focus_title: clip(base.orientation.focus_title, 120),
        authority_effect: false,
      });
    }
  }
  if (bytes(base) > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) throw new Error('chat_development_cursor_too_large');
  base.cursor_revision = `cursor:${sha256(JSON.stringify(base))}`;
  base.bytes = 0;
  base.bytes = bytes(base);
  if (base.bytes > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) throw new Error('chat_development_cursor_too_large');
  base.hits = Object.freeze(base.hits);
  return Object.freeze(base);
}

function boundedReplay(cursor) {
  const out = {
    schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
    status: 'OK',
    query_revision: cursor.cursor_revision,
    source_query_revision: cursor.source_query_revision,
    cursor_hit: true,
    cursor_revision: cursor.cursor_revision,
    cursor_source_query: cursor.source_query,
    orientation: cursor.orientation,
    hits: Array.isArray(cursor.hits) ? cursor.hits.slice() : [],
    total_hits: cursor.total_hits,
    truncated: cursor.truncated,
    one_call_orientation: true,
    development_plane_calls: 0,
    network_reads_required: 0,
    filesystem_reads_required: 0,
    authority_effect: false,
    bytes: 0,
  };
  while (out.hits.length && bytes(out) > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) {
    out.hits.pop();
    out.truncated = true;
  }
  if (bytes(out) > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) {
    out.cursor_source_query = clip(out.cursor_source_query, 160);
    if (out.orientation) {
      out.orientation = Object.freeze({
        head_sha: out.orientation.head_sha,
        ci_state: out.orientation.ci_state,
        focus_kind: out.orientation.focus_kind,
        focus_id: out.orientation.focus_id,
        focus_title: clip(out.orientation.focus_title, 120),
        authority_effect: false,
      });
    }
  }
  out.bytes = bytes(out);
  if (out.bytes > CHAT_DEVELOPMENT_CURSOR_MAX_BYTES) throw new Error('chat_development_cursor_replay_too_large');
  out.hits = Object.freeze(out.hits);
  return Object.freeze(out);
}

export class ChatDevelopmentCursor {
  #cursor = null;
  #captures = 0;
  #captureSkips = 0;
  #hits = 0;
  #misses = 0;

  capture({ state_revision, query, result } = {}) {
    const stateRevision = String(state_revision || '').trim();
    if (!stateRevision || !result || result.status !== 'OK' || result.authority_effect === true) return false;
    if (isContinuationIntent(query)) return false;
    const sourceQuery = clip(query, 512);
    const sourceRevision = clip(result?.query_revision, 96);
    if (this.#cursor
      && this.#cursor.state_revision === stateRevision
      && this.#cursor.source_query === sourceQuery
      && this.#cursor.source_query_revision === sourceRevision) {
      this.#captureSkips += 1;
      return false;
    }
    this.#cursor = boundedCursor({ stateRevision, sourceQuery: query, result });
    this.#captures += 1;
    return true;
  }

  resolve({ state_revision, query } = {}) {
    if (!isContinuationIntent(query)) return null;
    const stateRevision = String(state_revision || '').trim();
    if (!this.#cursor || this.#cursor.state_revision !== stateRevision) {
      this.#misses += 1;
      return null;
    }
    this.#hits += 1;
    return boundedReplay(this.#cursor);
  }

  snapshot(currentStateRevision = null) {
    const current = String(currentStateRevision || '').trim();
    return Object.freeze({
      schema: CHAT_DEVELOPMENT_CURSOR_SCHEMA,
      present: Boolean(this.#cursor),
      current_revision_match: Boolean(this.#cursor && current && this.#cursor.state_revision === current),
      cursor_revision: this.#cursor?.cursor_revision ?? null,
      bytes: Number(this.#cursor?.bytes || 0),
      max_bytes: CHAT_DEVELOPMENT_CURSOR_MAX_BYTES,
      max_hits: CHAT_DEVELOPMENT_CURSOR_MAX_HITS,
      captures: this.#captures,
      capture_skips: this.#captureSkips,
      hits: this.#hits,
      misses: this.#misses,
      timers: false,
      network_reads: 0,
      filesystem_reads: 0,
      authority_effect: false,
    });
  }
}
