import crypto from 'node:crypto';

export const CHAT_DEVELOPMENT_INDEX_SCHEMA = 'metaengine.chat-development-index.v1';
export const CHAT_DEVELOPMENT_QUERY_SCHEMA = 'metaengine.chat-development-query.v1';
export const CHAT_DEVELOPMENT_MAX_RECORDS = 512;
export const CHAT_DEVELOPMENT_MAX_QUERY_BYTES = 1024;
export const CHAT_DEVELOPMENT_MAX_RESULT_BYTES = 8 * 1024;
export const CHAT_DEVELOPMENT_MAX_HITS = 12;

const ALLOWED_KINDS = new Set([
  'SOURCE',
  'CI',
  'CHECKPOINT',
  'CHANGE',
  'HOTSPOT',
  'BLOCKER',
  'NEXT_ACTION',
  'RUNTIME',
  'DATABASE',
]);
const SEVERITY_SCORE = Object.freeze({ CRITICAL: 40, HIGH: 30, MEDIUM: 20, LOW: 10, INFO: 0 });
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function tokenize(value, maxTokens = 256) {
  const matches = String(value || '')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}][\p{L}\p{N}._/-]{1,79}/gu) || [];
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const token = String(raw || '').toLowerCase().replace(/^[._/-]+|[._/-]+$/g, '');
    if (token.length < 2 || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };
  for (const raw of matches) {
    add(raw);
    const expanded = raw.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2');
    for (const part of expanded.split(/[\s._/-]+/u)) add(part);
    if (out.length >= maxTokens) break;
  }
  return out.slice(0, maxTokens);
}

function normalizeRecord(record, index) {
  if (!plainObject(record)) throw new Error(`chat_dev_record_invalid:${index}`);
  if (record.authority_effect === true) throw new Error(`chat_dev_record_authority_forbidden:${index}`);
  const kind = String(record.kind || '').trim().toUpperCase();
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`chat_dev_record_kind_invalid:${index}`);
  const id = String(record.id || '').trim();
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(id)) throw new Error(`chat_dev_record_id_invalid:${index}`);
  const severity = String(record.severity || 'INFO').trim().toUpperCase();
  if (!(severity in SEVERITY_SCORE)) throw new Error(`chat_dev_record_severity_invalid:${index}`);
  const updatedAt = record.updated_at == null ? null : new Date(record.updated_at).toISOString();
  return Object.freeze({
    id,
    kind,
    title: clip(record.title, 240),
    text: clip(record.text, 1600),
    ref: clip(record.ref, 240),
    path: clip(record.path, 400),
    sha: clip(record.sha, 64),
    severity,
    updated_at: updatedAt,
    authority_effect: false,
  });
}

function recordTokens(record) {
  return tokenize([record.id, record.kind, record.title, record.text, record.ref, record.path, record.sha, record.severity].filter(Boolean).join(' '));
}

function buildSearchMetadata(record) {
  return Object.freeze({
    all: new Set(recordTokens(record)),
    title: new Set(tokenize(record.title)),
    path: new Set(tokenize(record.path)),
    ref: new Set(tokenize(record.ref)),
  });
}

function scoreRecord(record, metadata, terms) {
  let score = SEVERITY_SCORE[record.severity] || 0;
  let matched = 0;
  for (const term of terms) {
    if (!metadata.all.has(term)) continue;
    matched += 1;
    score += 10;
    if (metadata.title.has(term)) score += 10;
    if (metadata.path.has(term)) score += 8;
    if (metadata.ref.has(term)) score += 4;
  }
  if (matched === terms.length) score += 25;
  return { score, matched };
}

function rankCompare(a, b) {
  return b.score - a.score
    || b.matched - a.matched
    || String(b.record.updated_at || '').localeCompare(String(a.record.updated_at || ''))
    || a.record.id.localeCompare(b.record.id);
}

function pushTopRanked(rows, row, limit) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rankCompare(row, rows[mid]) < 0) high = mid;
    else low = mid + 1;
  }
  if (low >= limit) return;
  rows.splice(low, 0, row);
  if (rows.length > limit) rows.pop();
}

function stabilizeBytes(out) {
  let measured = Number(out.bytes || 0);
  for (let i = 0; i < 8; i += 1) {
    out.bytes = measured;
    const next = bytes(out);
    if (next === measured) return measured;
    measured = next;
  }
  out.bytes = measured;
  const final = bytes(out);
  if (final !== measured) throw new Error('chat_dev_result_byte_accounting_unstable');
  return final;
}

function fitResult(result, maxBytes) {
  const budget = Math.max(512, Math.min(CHAT_DEVELOPMENT_MAX_RESULT_BYTES, Number(maxBytes) || CHAT_DEVELOPMENT_MAX_RESULT_BYTES));
  const out = { ...result, hits: [...result.hits], bytes: 0 };
  while (true) {
    out.truncated = out.total_hits > out.hits.length;
    out.bytes = 0;
    if (stabilizeBytes(out) <= budget) break;
    if (!out.hits.length) throw new Error(`chat_dev_result_budget_exceeded:${out.bytes}:${budget}`);
    out.hits.pop();
  }
  out.hits = Object.freeze(out.hits);
  Object.freeze(out);
  if (bytes(out) !== out.bytes) throw new Error('chat_dev_result_byte_accounting_drift');
  return out;
}

export class ChatDevelopmentIndex {
  #records = [];
  #search = [];
  #postings = new Map();
  #revision = `dev:${sha256('[]')}`;

  constructor({ records = [] } = {}) {
    this.replace(records);
  }

  replace(records) {
    if (!Array.isArray(records) || records.length > CHAT_DEVELOPMENT_MAX_RECORDS) {
      throw new Error('chat_dev_records_invalid');
    }
    const normalized = records.map(normalizeRecord);
    const ids = new Set();
    for (const record of normalized) {
      if (ids.has(record.id)) throw new Error(`chat_dev_record_duplicate:${record.id}`);
      ids.add(record.id);
    }
    const search = normalized.map(buildSearchMetadata);
    const postings = new Map();
    search.forEach((metadata, index) => {
      for (const token of metadata.all) {
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push(index);
      }
    });
    for (const list of postings.values()) Object.freeze(list);
    this.#records = normalized;
    this.#search = search;
    this.#postings = postings;
    this.#revision = `dev:${sha256(JSON.stringify(normalized))}`;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: CHAT_DEVELOPMENT_INDEX_SCHEMA,
      revision: this.#revision,
      records: this.#records.length,
      indexed_tokens: this.#postings.size,
      warm_query_record_tokenization: 'BUILD_TIME',
      warm_query_ranking: 'BOUNDED_TOP_K',
      network_reads: 0,
      filesystem_reads: 0,
      scheduler_authority: false,
      command_authority: false,
      authority_effect: false,
    });
  }

  query({ query, kinds = null, limit = 8, if_none_match = null, max_bytes = CHAT_DEVELOPMENT_MAX_RESULT_BYTES } = {}) {
    const queryText = String(query || '').trim();
    if (!queryText || Buffer.byteLength(queryText, 'utf8') > CHAT_DEVELOPMENT_MAX_QUERY_BYTES) {
      throw new Error('chat_dev_query_invalid');
    }
    const resultLimit = Number(limit);
    if (!Number.isSafeInteger(resultLimit) || resultLimit < 1 || resultLimit > CHAT_DEVELOPMENT_MAX_HITS) {
      throw new Error('chat_dev_query_limit_invalid');
    }
    const allowedKinds = kinds == null ? null : new Set((Array.isArray(kinds) ? kinds : []).map((value) => String(value || '').trim().toUpperCase()));
    if (allowedKinds && (allowedKinds.size < 1 || allowedKinds.size > ALLOWED_KINDS.size || [...allowedKinds].some((kind) => !ALLOWED_KINDS.has(kind)))) {
      throw new Error('chat_dev_query_kinds_invalid');
    }
    const terms = tokenize(queryText, 12);
    if (terms.length < 1) throw new Error('chat_dev_query_terms_invalid');
    const queryRevision = `q:${sha256(JSON.stringify({ revision: this.#revision, terms, kinds: allowedKinds ? [...allowedKinds].sort() : null }))}`;
    if (if_none_match && String(if_none_match) === queryRevision) {
      const out = {
        schema: CHAT_DEVELOPMENT_QUERY_SCHEMA,
        status: 'NOT_MODIFIED',
        revision: this.#revision,
        query_revision: queryRevision,
        authority_effect: false,
        truncated: false,
        bytes: 0,
      };
      stabilizeBytes(out);
      return Object.freeze(out);
    }

    const candidates = new Set();
    for (const term of terms) for (const index of this.#postings.get(term) || []) candidates.add(index);
    let totalHits = 0;
    const ranked = [];
    for (const index of candidates) {
      const record = this.#records[index];
      if (allowedKinds && !allowedKinds.has(record.kind)) continue;
      const scored = { record, ...scoreRecord(record, this.#search[index], terms) };
      if (scored.matched < 1) continue;
      totalHits += 1;
      pushTopRanked(ranked, scored, resultLimit);
    }

    const result = {
      schema: CHAT_DEVELOPMENT_QUERY_SCHEMA,
      status: 'OK',
      revision: this.#revision,
      query_revision: queryRevision,
      query_terms: terms,
      total_hits: totalHits,
      hits: ranked.map(({ record, score, matched }) => Object.freeze({ ...record, score, matched_terms: matched })),
      search_strategy: 'IN_MEMORY_INVERTED_INDEX',
      network_reads: 0,
      filesystem_reads: 0,
      scheduler_authority: false,
      command_authority: false,
      authority_effect: false,
    };
    return fitResult(result, max_bytes);
  }
}
