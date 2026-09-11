import { ChatDevelopmentControlState } from './chat-development-control-state.mjs';
import { ChatDevelopmentCursor, isContinuationIntent } from './chat-development-cursor.mjs';
import { ChatDevelopmentQueryProvider, CHAT_DEVELOPMENT_PROVIDER_SCHEMA } from './chat-development-query-provider.mjs';
import { FastControlGatewayCore } from './fast-control-gateway-core.mjs';
import { createFastControlMcpAdapter } from './fast-control-mcp-adapter.mjs';

export const CHAT_FAST_CONTROL_RUNTIME_SCHEMA = 'metaengine.chat-fast-control-runtime.v1';
export const CHAT_FAST_CONTROL_QUERY_CACHE_MAX = 64;

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function compactOrientation(capsule) {
  if (!capsule) return null;
  return Object.freeze({
    revision: capsule.revision,
    head_sha: capsule.source?.head_sha ?? null,
    branch: capsule.source?.branch ?? null,
    pr: capsule.source?.pr ?? null,
    ci_state: capsule.ci?.state ?? 'UNKNOWN',
    ci_failed: Number(capsule.ci?.failed || 0),
    ci_pending: Number(capsule.ci?.pending || 0),
    focus_kind: capsule.focus?.kind ?? 'NONE',
    focus_id: capsule.focus?.id ?? null,
    focus_title: capsule.focus?.title ?? null,
    authority_effect: false,
  });
}

function continuationFallbackQuery(orientation) {
  const parts = [
    orientation?.focus_title,
    orientation?.focus_kind && orientation.focus_kind !== 'NONE' ? orientation.focus_kind.replaceAll('_', ' ') : null,
    'next action',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'current blocker next action';
}

function normalizeQueryKey(input, stateRevision) {
  const query = String(input?.query || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const kinds = Array.isArray(input?.kinds)
    ? [...new Set(input.kinds.map((value) => String(value || '').trim().toUpperCase()))].sort()
    : null;
  return JSON.stringify({
    state_revision: stateRevision,
    query,
    kinds,
    limit: Number(input?.limit ?? 8),
    max_bytes: Number(input?.max_bytes ?? 8192),
  });
}

function notModified(queryRevision, extra = {}) {
  const out = {
    schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
    status: 'NOT_MODIFIED',
    query_revision: queryRevision,
    warm_cache: true,
    ...extra,
    authority_effect: false,
    truncated: false,
    bytes: 0,
  };
  out.bytes = jsonBytes(out);
  return Object.freeze(out);
}

export class ChatFastControlRuntime {
  #controlState;
  #queryProvider;
  #developmentCursor = new ChatDevelopmentCursor();
  #gateway;
  #mcp;
  #getBrowserState;
  #browserStateReads = 0;
  #devQueryCache = new Map();
  #devQueryCacheHits = 0;
  #devQueryCacheMisses = 0;
  #devQueryNotModifiedHits = 0;
  #continuationFallbacks = 0;

  constructor({
    developmentPlane,
    controlState = new ChatDevelopmentControlState(),
    getBrowserState,
    issueBatch,
    resultDelta,
    issueEmergency,
  } = {}) {
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('chat_fast_control_development_plane_required');
    if (!controlState || typeof controlState.query !== 'function' || typeof controlState.fastContext !== 'function') throw new Error('chat_fast_control_state_required');
    if (typeof getBrowserState !== 'function') throw new Error('chat_fast_control_browser_state_required');
    if (typeof issueBatch !== 'function') throw new Error('chat_fast_control_issue_batch_required');
    if (typeof resultDelta !== 'function') throw new Error('chat_fast_control_result_delta_required');
    if (typeof issueEmergency !== 'function') throw new Error('chat_fast_control_issue_emergency_required');
    this.#controlState = controlState;
    this.#getBrowserState = getBrowserState;
    this.#queryProvider = new ChatDevelopmentQueryProvider({ developmentPlane, evidenceIndex: controlState });
    this.#gateway = new FastControlGatewayCore({
      contextGet: async (input) => {
        this.#browserStateReads += 1;
        const state = await this.#getBrowserState();
        return this.#controlState.fastContext({ state, ...input });
      },
      devQuery: (input) => this.#devQuery(input),
      issueBatch,
      resultDelta,
      issueEmergency,
    });
    this.#mcp = createFastControlMcpAdapter(this.#gateway);
  }

  async #devQuery(input) {
    const stateRevision = this.#controlState.snapshot().revision;
    const continuation = isContinuationIntent(input?.query);
    if (continuation) {
      const cursorResult = this.#developmentCursor.resolve({ state_revision: stateRevision, query: input.query });
      if (cursorResult) {
        if (input?.if_none_match && String(input.if_none_match) === cursorResult.query_revision) {
          this.#devQueryNotModifiedHits += 1;
          return notModified(cursorResult.query_revision, { cursor_hit: true });
        }
        return cursorResult;
      }
    }

    const orientation = compactOrientation(this.#controlState.capsule());
    const effectiveInput = continuation
      ? Object.freeze({ ...input, query: continuationFallbackQuery(orientation) })
      : input;
    if (continuation) this.#continuationFallbacks += 1;

    const key = normalizeQueryKey(effectiveInput, stateRevision);
    const cached = this.#devQueryCache.get(key);
    if (cached) {
      this.#devQueryCache.delete(key);
      this.#devQueryCache.set(key, cached);
      this.#devQueryCacheHits += 1;
      this.#developmentCursor.capture({ state_revision: stateRevision, query: effectiveInput.query, result: cached.result });
      if (input?.if_none_match && String(input.if_none_match) === cached.query_revision) {
        this.#devQueryNotModifiedHits += 1;
        return notModified(cached.query_revision, continuation ? { continuation_fallback: true } : {});
      }
      const result = structuredClone(cached.result);
      if (continuation) result.continuation_fallback = true;
      return Object.freeze(result);
    }

    this.#devQueryCacheMisses += 1;
    const result = await this.#queryProvider.query({
      ...effectiveInput,
      orientation,
    });
    if (result?.status === 'OK' && result?.query_revision) {
      this.#developmentCursor.capture({ state_revision: stateRevision, query: effectiveInput.query, result });
      this.#devQueryCache.set(key, Object.freeze({
        query_revision: String(result.query_revision),
        result: structuredClone(result),
      }));
      while (this.#devQueryCache.size > CHAT_FAST_CONTROL_QUERY_CACHE_MAX) {
        this.#devQueryCache.delete(this.#devQueryCache.keys().next().value);
      }
    }
    if (!continuation) return result;
    return Object.freeze({ ...structuredClone(result), continuation_fallback: true });
  }

  setSource(source, now) { return this.#controlState.setSource(source, now); }
  setCapabilityRevision(revision, now) { return this.#controlState.setCapabilityRevision(revision, now); }
  setRepoIndexRevision(revision, options) { return this.#controlState.setRepoIndexRevision(revision, options); }
  upsertCi(row, now) { return this.#controlState.upsertCi(row, now); }
  upsertEvidence(row, now) { return this.#controlState.upsertEvidence(row, now); }
  removeEvidence(id, now) { return this.#controlState.removeEvidence(id, now); }

  listTools() { return this.#mcp.listTools(); }
  callTool(name, input) { return this.#mcp.callTool(name, input); }
  invoke(name, input) { return this.#gateway.invoke(name, input); }

  snapshot() {
    const controlState = this.#controlState.snapshot();
    return Object.freeze({
      schema: CHAT_FAST_CONTROL_RUNTIME_SCHEMA,
      control_state: controlState,
      query_provider: this.#queryProvider.snapshot(),
      development_cursor: this.#developmentCursor.snapshot(controlState.revision),
      tools: this.#gateway.manifest().tools.map((row) => row.name),
      browser_state_reads: this.#browserStateReads,
      dev_query_includes_orientation: true,
      continuation_fallbacks: this.#continuationFallbacks,
      dev_query_warm_cache: {
        entries: this.#devQueryCache.size,
        max_entries: CHAT_FAST_CONTROL_QUERY_CACHE_MAX,
        hits: this.#devQueryCacheHits,
        misses: this.#devQueryCacheMisses,
        not_modified_hits: this.#devQueryNotModifiedHits,
        state_revision_keyed: true,
        timers: false,
        authority_effect: false,
      },
      periodic_source_discovery: false,
      periodic_ci_discovery: false,
      second_scheduler: false,
      command_leasing_authority: false,
      browser_execution_authority: false,
      authority_effect: false,
    });
  }
}
