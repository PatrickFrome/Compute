'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEVOS_REPO_SEARCH_SCHEMA = 'metaengine.development-plane.repo-search.v1';
const DEVOS_REPO_SEARCH_INDEX_SCHEMA = 'metaengine.development-plane.repo-search-index.v1';
const MAX_FILES = 512;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILE_TOKENS = 4096;
const MAX_HITS = 16;
const MAX_RESULT_BYTES = 12 * 1024;
const MAX_QUERY_BYTES = 1024;
const ALLOWED_ROOTS = Object.freeze([
  'apps/metaengine-browser/src',
  'apps/metaengine-browser/test',
  'apps/metaengine-browser/supabase',
  '.github/workflows',
]);
const ALLOWED_EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.ts', '.sql', '.json', '.md', '.yml', '.yaml', '.ps1']);
const EXCLUDED_BASENAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json']);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function exactSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('devos_repo_search_source_invalid');
  const repository = String(source.repository || '').trim();
  const head = String(source.head || '').trim().toLowerCase();
  const ref = source.ref == null ? null : String(source.ref).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('devos_repo_search_repository_invalid');
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('devos_repo_search_head_invalid');
  if (ref != null && (!ref || ref.length > 400 || /[\u0000-\u001f\u007f]/.test(ref))) throw new Error('devos_repo_search_ref_invalid');
  return { repository, head, ref };
}

function tokenize(value, maxTokens = MAX_FILE_TOKENS) {
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

function validateRelative(relative) {
  const value = String(relative || '').replaceAll('\\', '/');
  if (!value || value.startsWith('/') || value.includes('/../') || value.startsWith('../') || value.includes('\u0000')) {
    throw new Error('devos_repo_search_path_invalid');
  }
  return value;
}

function allowedFile(relative) {
  const normalized = validateRelative(relative);
  const basename = path.posix.basename(normalized);
  if (EXCLUDED_BASENAMES.has(basename)) return false;
  if (basename.startsWith('.env') || /(?:secret|credential|private[-_]?key)/i.test(basename)) return false;
  return ALLOWED_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function firstEvidence(text, terms) {
  const lower = text.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const at = lower.indexOf(term.toLowerCase());
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  if (best < 0) return { line: null, snippet: null };
  const lineStart = Math.max(0, text.lastIndexOf('\n', best - 1) + 1);
  let lineEnd = text.indexOf('\n', best);
  if (lineEnd < 0) lineEnd = text.length;
  const line = lineNumberAt(text, lineStart);
  const snippet = text.slice(lineStart, Math.min(lineEnd, lineStart + 600)).trim();
  return { line, snippet: clip(snippet, 600) };
}

function scoreFile(file, terms) {
  const pathTokens = new Set(tokenize(file.relative_path, 128));
  const titleTokens = new Set(tokenize(path.posix.basename(file.relative_path), 128));
  const textTokens = file.tokens;
  let matched = 0;
  let score = 0;
  for (const term of terms) {
    if (!textTokens.has(term)) continue;
    matched += 1;
    score += 10;
    if (pathTokens.has(term)) score += 16;
    if (titleTokens.has(term)) score += 20;
  }
  if (matched === terms.length) score += 30;
  return { matched, score };
}

function preferExactTermRows(rows, termCount) {
  const exact = rows.filter((row) => row.matched === termCount);
  if (exact.length) return Object.freeze({ rows: exact, mode: 'ALL_TERMS' });
  return Object.freeze({ rows, mode: 'PARTIAL_FALLBACK' });
}

function fitResult(result, maxBytes) {
  const budget = Math.max(1024, Math.min(MAX_RESULT_BYTES, Number(maxBytes) || MAX_RESULT_BYTES));
  const out = structuredClone(result);
  while (out.hits.length && bytes(out) > budget) out.hits.pop();
  if (bytes(out) > budget) throw new Error(`devos_repo_search_result_budget_exceeded:${bytes(out)}:${budget}`);
  out.truncated = out.total_hits > out.hits.length;
  out.bytes = 0;
  out.bytes = bytes(out);
  out.bytes = bytes(out);
  if (bytes(out) > budget) throw new Error(`devos_repo_search_result_budget_exceeded:${bytes(out)}:${budget}`);
  return Object.freeze(out);
}

class DevOSRepoSearchIndex {
  #repoRoot;
  #head = null;
  #repository = null;
  #ref = null;
  #files = [];
  #postings = new Map();
  #indexedBytes = 0;
  #revision = null;
  #buildPromise = null;

  constructor({ repoRoot } = {}) {
    const root = path.resolve(String(repoRoot || ''));
    if (!root) throw new Error('devos_repo_search_root_invalid');
    this.#repoRoot = root;
  }

  async #walkRoot(relativeRoot, out) {
    const root = path.resolve(this.#repoRoot, relativeRoot);
    const rootRel = path.relative(this.#repoRoot, root);
    if (!rootRel || rootRel.startsWith('..') || path.isAbsolute(rootRel)) throw new Error('devos_repo_search_root_escape');
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(root, entry.name);
      const relative = validateRelative(path.relative(this.#repoRoot, absolute));
      if (entry.isDirectory()) {
        await this.#walkRoot(relative, out);
        continue;
      }
      if (!entry.isFile() || !allowedFile(relative)) continue;
      out.push(relative);
    }
  }

  async #build(source) {
    const exact = exactSource(source);
    const paths = [];
    for (const root of ALLOWED_ROOTS) {
      if (paths.length >= MAX_FILES) break;
      await this.#walkRoot(root, paths);
    }
    const files = [];
    const postings = new Map();
    let indexedBytes = 0;
    for (const relative of paths) {
      if (files.length >= MAX_FILES || indexedBytes >= MAX_TOTAL_BYTES) break;
      const absolute = path.resolve(this.#repoRoot, relative);
      const rel = path.relative(this.#repoRoot, absolute);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('devos_repo_search_file_escape');
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      if (indexedBytes + stat.size > MAX_TOTAL_BYTES) break;
      const text = await fs.readFile(absolute, 'utf8');
      const tokens = new Set(tokenize(`${relative}\n${text}`, MAX_FILE_TOKENS));
      const file = Object.freeze({
        relative_path: relative.replaceAll('\\', '/'),
        sha256: `sha256:${sha256(Buffer.from(text, 'utf8'))}`,
        bytes: Buffer.byteLength(text, 'utf8'),
        text,
        tokens,
      });
      const fileIndex = files.length;
      files.push(file);
      indexedBytes += file.bytes;
      for (const token of tokens) {
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push(fileIndex);
      }
    }
    const revisionMaterial = files.map((file) => [file.relative_path, file.sha256, file.bytes]);
    this.#files = files;
    this.#postings = postings;
    this.#indexedBytes = indexedBytes;
    this.#head = exact.head;
    this.#repository = exact.repository;
    this.#ref = exact.ref;
    this.#revision = `repoidx:${sha256(Buffer.from(JSON.stringify({ source: exact, files: revisionMaterial }), 'utf8'))}`;
    return this.snapshot();
  }

  async ensure(source) {
    const exact = exactSource(source);
    if (this.#head === exact.head && this.#repository === exact.repository && this.#revision) {
      return Object.freeze({ rebuilt: false, snapshot: this.snapshot() });
    }
    if (!this.#buildPromise) this.#buildPromise = this.#build(exact).finally(() => { this.#buildPromise = null; });
    const snapshot = await this.#buildPromise;
    if (this.#head !== exact.head || this.#repository !== exact.repository) {
      throw new Error('devos_repo_search_source_changed_during_build');
    }
    return Object.freeze({ rebuilt: true, snapshot });
  }

  snapshot() {
    return Object.freeze({
      schema: DEVOS_REPO_SEARCH_INDEX_SCHEMA,
      repository: this.#repository,
      head: this.#head,
      ref: this.#ref,
      revision: this.#revision,
      indexed_file_count: this.#files.length,
      indexed_bytes: this.#indexedBytes,
      indexed_tokens: this.#postings.size,
      max_files: MAX_FILES,
      max_file_bytes: MAX_FILE_BYTES,
      max_total_bytes: MAX_TOTAL_BYTES,
      max_file_tokens: MAX_FILE_TOKENS,
      allowed_roots: [...ALLOWED_ROOTS],
      arbitrary_path_selection: false,
      process_spawn_used: false,
      ...zeroAuthority(),
    });
  }

  async query(source, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('devos_repo_search_query_invalid');
    if (input.authority_effect === true) throw new Error('devos_repo_search_authority_forbidden');
    const allowedKeys = new Set(['query', 'limit', 'if_none_match', 'max_bytes', 'authority_effect']);
    for (const key of Object.keys(input)) if (!allowedKeys.has(key)) throw new Error(`devos_repo_search_query_field_unknown:${key}`);
    const query = String(input.query || '').trim();
    if (!query || Buffer.byteLength(query, 'utf8') > MAX_QUERY_BYTES) throw new Error('devos_repo_search_query_invalid');
    const limit = Number(input.limit ?? 8);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HITS) throw new Error('devos_repo_search_limit_invalid');
    const ensured = await this.ensure(source);
    const terms = tokenize(query, 12);
    if (!terms.length) throw new Error('devos_repo_search_terms_invalid');
    const queryRevision = `rq:${sha256(Buffer.from(JSON.stringify({ index: this.#revision, terms }), 'utf8'))}`;
    if (input.if_none_match && String(input.if_none_match) === queryRevision) {
      const out = {
        schema: DEVOS_REPO_SEARCH_SCHEMA,
        status: 'NOT_MODIFIED',
        repository: this.#repository,
        head: this.#head,
        index_revision: this.#revision,
        query_revision: queryRevision,
        index_rebuilt: ensured.rebuilt,
        ...zeroAuthority(),
      };
      return Object.freeze({ ...out, bytes: bytes(out), truncated: false });
    }
    const candidates = new Set();
    for (const term of terms) for (const fileIndex of this.#postings.get(term) || []) candidates.add(fileIndex);
    const rankedCandidates = [...candidates]
      .map((fileIndex) => ({ file: this.#files[fileIndex], ...scoreFile(this.#files[fileIndex], terms) }))
      .filter((row) => row.matched > 0)
      .sort((a, b) => b.score - a.score || b.matched - a.matched || a.file.relative_path.localeCompare(b.file.relative_path));
    const preferred = preferExactTermRows(rankedCandidates, terms.length);
    const ranked = preferred.rows;
    const result = {
      schema: DEVOS_REPO_SEARCH_SCHEMA,
      status: 'OK',
      repository: this.#repository,
      head: this.#head,
      ref: this.#ref,
      index_revision: this.#revision,
      query_revision: queryRevision,
      query_terms: terms,
      match_mode: preferred.mode,
      index_rebuilt: ensured.rebuilt,
      indexed_file_count: this.#files.length,
      indexed_bytes: this.#indexedBytes,
      total_hits: ranked.length,
      hits: ranked.slice(0, limit).map(({ file, score, matched }) => {
        const evidence = firstEvidence(file.text, terms);
        return {
          path: file.relative_path,
          sha256: file.sha256,
          line: evidence.line,
          snippet: evidence.snippet,
          score,
          matched_terms: matched,
          authority_effect: false,
        };
      }),
      search_strategy: 'HEAD_CACHED_INVERTED_INDEX',
      arbitrary_path_selection: false,
      process_spawn_used: false,
      ...zeroAuthority(),
    };
    return fitResult(result, input.max_bytes);
  }
}

module.exports = Object.freeze({
  DEVOS_REPO_SEARCH_SCHEMA,
  DEVOS_REPO_SEARCH_INDEX_SCHEMA,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_FILE_TOKENS,
  MAX_HITS,
  MAX_RESULT_BYTES,
  ALLOWED_ROOTS,
  DevOSRepoSearchIndex,
});
