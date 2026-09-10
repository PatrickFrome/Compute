import crypto from 'node:crypto';
import { CHAT_DEVELOPMENT_MAX_RESULT_BYTES } from './chat-development-index.mjs';

export const CHAT_DEVELOPMENT_PROVIDER_SCHEMA = 'metaengine.chat-development-provider.v1';
export const CHAT_DEVELOPMENT_PROVIDER_MAX_HITS = 12;
export const CHAT_DEVELOPMENT_PROVIDER_CACHE = 64;

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);

function fit(result, maxBytes) {
  const budget = Math.max(1024, Math.min(CHAT_DEVELOPMENT_MAX_RESULT_BYTES, Number(maxBytes) || CHAT_DEVELOPMENT_MAX_RESULT_BYTES));
  const out = structuredClone(result);
  while (out.hits.length > 0 && bytes(out) > budget) out.hits.pop();
  if (bytes(out) > budget) throw new Error(`chat_dev_provider_budget_exceeded:${bytes(out)}:${budget}`);
  out.truncated = out.total_hits > out.hits.length;
  out.bytes = bytes(out);
  return Object.freeze(out);
}

function normalizeRepoHit(hit) {
  return Object.freeze({
    source: 'REPO',
    kind: 'SOURCE',
    id: `repo:${clip(hit?.path, 400)}:${Number(hit?.line || 0)}`,
    title: clip(hit?.path, 400),
    text: clip(hit?.snippet, 600),
    ref: clip(hit?.sha256, 96),
    path: clip(hit?.path, 400),
    line: Number.isSafeInteger(Number(hit?.line)) ? Number(hit.line) : null,
    score: Number(hit?.score || 0),
    matched_terms: Number(hit?.matched_terms || 0),
    authority_effect: false,
  });
}

function normalizeEvidenceHit(hit) {
  return Object.freeze({
    source: 'EVIDENCE',
    kind: clip(hit?.kind, 32),
    id: clip(hit?.id, 160),
    title: clip(hit?.title, 240),
    text: clip(hit?.text, 600),
    ref: clip(hit?.ref, 240),
    path: clip(hit?.path, 400),
    line: null,
    score: Number(hit?.score || 0),
    matched_terms: Number(hit?.matched_terms || 0),
    severity: clip(hit?.severity, 16),
    updated_at: clip(hit?.updated_at, 40),
    authority_effect: false,
  });
}

function componentResult(current, prior) {
  if (!current) return null;
  if (current.status === 'NOT_MODIFIED') return prior || null;
  return current;
}

export class ChatDevelopmentQueryProvider {
  #developmentPlane;
  #evidenceIndex;
  #etagCache = new Map();

  constructor({ developmentPlane, evidenceIndex } = {}) {
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('chat_dev_provider_development_plane_required');
    if (!evidenceIndex || typeof evidenceIndex.query !== 'function') throw new Error('chat_dev_provider_evidence_index_required');
    this.#developmentPlane = developmentPlane;
    this.#evidenceIndex = evidenceIndex;
  }

  snapshot() {
    return Object.freeze({
      schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
      repo_search_capability: 'DEVOS_REPO_SEARCH',
      query_fanout_max: 2,
      result_max_bytes: CHAT_DEVELOPMENT_MAX_RESULT_BYTES,
      result_max_hits: CHAT_DEVELOPMENT_PROVIDER_MAX_HITS,
      etag_cache_entries: this.#etagCache.size,
      network_reads_owned: 0,
      browser_execution_authority: false,
      command_leasing_authority: false,
      authority_effect: false,
    });
  }

  async query({ query, kinds = null, limit = 8, if_none_match = null, max_bytes = CHAT_DEVELOPMENT_MAX_RESULT_BYTES } = {}) {
    const queryText = String(query || '').trim();
    if (!queryText) throw new Error('chat_dev_provider_query_invalid');
    const resultLimit = Number(limit);
    if (!Number.isSafeInteger(resultLimit) || resultLimit < 1 || resultLimit > CHAT_DEVELOPMENT_PROVIDER_MAX_HITS) throw new Error('chat_dev_provider_limit_invalid');
    if (kinds != null && (!Array.isArray(kinds) || kinds.length < 1)) throw new Error('chat_dev_provider_kinds_invalid');
    const kindSet = kinds == null ? null : new Set(kinds.map((value) => String(value || '').trim().toUpperCase()));
    const sourceWanted = kindSet == null || kindSet.has('SOURCE');
    const evidenceKinds = kindSet == null ? null : [...kindSet].filter((kind) => kind !== 'SOURCE');
    const evidenceWanted = kindSet == null || evidenceKinds.length > 0;
    const requestKey = sha256(JSON.stringify({
      query: queryText,
      kinds: kindSet ? [...kindSet].sort() : null,
      limit: resultLimit,
      max_bytes: Number(max_bytes) || CHAT_DEVELOPMENT_MAX_RESULT_BYTES,
    }));
    const cached = if_none_match ? this.#etagCache.get(String(if_none_match)) : null;
    const prior = cached?.request_key === requestKey ? cached : null;
    const componentBudget = Math.max(1024, Math.min(4096, Math.floor(Number(max_bytes || CHAT_DEVELOPMENT_MAX_RESULT_BYTES) / (sourceWanted && evidenceWanted ? 2 : 1))));

    const [repoRaw, evidenceRaw] = await Promise.all([
      sourceWanted
        ? this.#developmentPlane.request('DEVOS_REPO_SEARCH', {
          query: queryText,
          limit: Math.min(8, resultLimit),
          if_none_match: prior?.repo_query_revision || null,
          max_bytes: componentBudget,
          authority_effect: false,
        })
        : Promise.resolve(null),
      evidenceWanted
        ? Promise.resolve(this.#evidenceIndex.query({
          query: queryText,
          kinds: evidenceKinds && evidenceKinds.length ? evidenceKinds : null,
          limit: Math.min(8, resultLimit),
          if_none_match: prior?.evidence_query_revision || null,
          max_bytes: componentBudget,
        }))
        : Promise.resolve(null),
    ]);

    const repoUnchanged = !repoRaw || repoRaw.status === 'NOT_MODIFIED';
    const evidenceUnchanged = !evidenceRaw || evidenceRaw.status === 'NOT_MODIFIED';
    if (prior && repoUnchanged && evidenceUnchanged) {
      const unchanged = {
        schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
        status: 'NOT_MODIFIED',
        query_revision: String(if_none_match),
        authority_effect: false,
      };
      return Object.freeze({ ...unchanged, bytes: bytes(unchanged), truncated: false });
    }

    const repo = componentResult(repoRaw, prior?.repo_result);
    const evidence = componentResult(evidenceRaw, prior?.evidence_result);
    const repoHits = repo?.status === 'OK' && Array.isArray(repo.hits) ? repo.hits.map(normalizeRepoHit) : [];
    const evidenceHits = evidence?.status === 'OK' && Array.isArray(evidence.hits) ? evidence.hits.map(normalizeEvidenceHit) : [];
    const hits = [...repoHits, ...evidenceHits]
      .sort((a, b) => b.score - a.score || b.matched_terms - a.matched_terms || String(a.id).localeCompare(String(b.id)))
      .slice(0, resultLimit);
    const repoRevision = repo?.query_revision || null;
    const evidenceRevision = evidence?.query_revision || null;
    const queryRevision = `dq:${sha256(JSON.stringify({ request_key: requestKey, repo: repoRevision, evidence: evidenceRevision }))}`;
    this.#etagCache.set(queryRevision, Object.freeze({
      request_key: requestKey,
      repo_query_revision: repoRevision,
      evidence_query_revision: evidenceRevision,
      repo_result: repo ? structuredClone(repo) : null,
      evidence_result: evidence ? structuredClone(evidence) : null,
    }));
    while (this.#etagCache.size > CHAT_DEVELOPMENT_PROVIDER_CACHE) this.#etagCache.delete(this.#etagCache.keys().next().value);

    return fit({
      schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
      status: 'OK',
      query_revision: queryRevision,
      repo_query_revision: repoRevision,
      evidence_query_revision: evidenceRevision,
      total_hits: Number(repo?.total_hits || 0) + Number(evidence?.total_hits || 0),
      hits,
      source_search: sourceWanted,
      evidence_search: evidenceWanted,
      parallel_fanout: sourceWanted && evidenceWanted ? 2 : 1,
      network_reads_owned: 0,
      browser_execution_authority: false,
      command_leasing_authority: false,
      authority_effect: false,
    }, max_bytes);
  }
}
