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

function scoreRecord(record, terms) {
  const title = new Set(tokenize(record.title));
  const path = new Set(tokenize(record.path));
  const ref = new Set(tokenize(record.ref));
  const all = new Set(recordTokens(record));
  let score = SEVERITY_SCORE[record.severity] || 0;
  let matched = 0;
  for (const term of terms) {
    if (!all.has(term)) continue;
    matched += 1;
    score += 10;
    if (title.has(term)) score += 10;
    if (path.has(term)) score += 8;
    if (ref.has(term)) score += 4;
  }
  if (matched === terms.length) score += 25;
  return { score, matched };
}

function fitResult(result, maxBytes) {
  const budget = Math.max(512, Math.min(CHAT_DEVELOPMENT_MAX_RESULT_BYTES, Number(maxBytes) || CHAT_DEVELOPMENT_MAX_RESULT_BYTES));
  const out = structuredClone(result);
  while (out.hits.length > 0 && bytes(out) > budget) out.hits.pop();
  if (bytes(out) > budget) throw new Error(`chat_dev_result_budget_exceeded:${bytes(out)}:${budget}`);
  out.truncated = out.total_hits > out.hits.length;
  out.bytes = bytes(out);
  return Object.freeze(out);
}

export class ChatDevelopmentIndex {
  #records = [];
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
    const postings = new Map();
    normalized.forEach((record, index) => {
      for (const token of recordTokens(record)) {
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push(index);
      }
    });
    this.#records = normalized;
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
    if (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > CHAT_DEVELOPMENT_MAX_HITS) {
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
      };
      return Object.freeze({ ...out, bytes: bytes(out), truncated: false });
    }

    const candidates = new Set();
    for (const term of terms) for (const index of this.#postings.get(term) || []) candidates.add(index);
    const ranked = [...candidates]
      .map((index) => ({ record: this.#records[index], ...scoreRecord(this.#records[index], terms) }))
      .filter((row) => row.matched > 0 && (!allowedKinds || allowedKinds.has(row.record.kind)))
      .sort((a, b) => b.score - a.score || b.matched - a.matched || String(b.record.updated_at || '').localeCompare(String(a.record.updated_at || '')) || a.record.id.localeCompare(b.record.id));

    const result = {
      schema: CHAT_DEVELOPMENT_QUERY_SCHEMA,
      status: 'OK',
      revision: this.#revision,
      query_revision: queryRevision,
      query_terms: terms,
      total_hits: ranked.length,
      hits: ranked.slice(0, Number(limit)).map(({ record, score, matched }) => ({ ...record, score, matched_terms: matched })),
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
