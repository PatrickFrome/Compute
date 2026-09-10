import { ChatDevelopmentControlState } from './chat-development-control-state.mjs';
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

function notModified(queryRevision) {
  const out = {
    schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
    status: 'NOT_MODIFIED',
    query_revision: queryRevision,
    warm_cache: true,
    authority_effect: false,
    truncated: false,
    bytes: 0,
  };
  out.bytes = jsonBytes(out);
  out.bytes = jsonBytes(out);
  return Object.freeze(out);
}

export class ChatFastControlRuntime {
  #controlState;
  #queryProvider;
  #gateway;
  #mcp;
  #getBrowserState;
  #browserStateReads = 0;
  #devQueryCache = new Map();
  #devQueryCacheHits = 0;
  #devQueryCacheMisses = 0;
  #devQueryNotModifiedHits = 0;

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
    const key = normalizeQueryKey(input, stateRevision);
    const cached = this.#devQueryCache.get(key);
    if (cached) {
      this.#devQueryCache.delete(key);
      this.#devQueryCache.set(key, cached);
      this.#devQueryCacheHits += 1;
      if (input?.if_none_match && String(input.if_none_match) === cached.query_revision) {
        this.#devQueryNotModifiedHits += 1;
        return notModified(cached.query_revision);
      }
      return Object.freeze(structuredClone(cached.result));
    }

    this.#devQueryCacheMisses += 1;
    const result = await this.#queryProvider.query({
      ...input,
      orientation: compactOrientation(this.#controlState.capsule()),
    });
    if (result?.status === 'OK' && result?.query_revision) {
      this.#devQueryCache.set(key, Object.freeze({
        query_revision: String(result.query_revision),
        result: structuredClone(result),
      }));
      while (this.#devQueryCache.size > CHAT_FAST_CONTROL_QUERY_CACHE_MAX) {
        this.#devQueryCache.delete(this.#devQueryCache.keys().next().value);
      }
    }
    return result;
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
    return Object.freeze({
      schema: CHAT_FAST_CONTROL_RUNTIME_SCHEMA,
      control_state: this.#controlState.snapshot(),
      query_provider: this.#queryProvider.snapshot(),
      tools: this.#gateway.manifest().tools.map((row) => row.name),
      browser_state_reads: this.#browserStateReads,
      dev_query_includes_orientation: true,
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
