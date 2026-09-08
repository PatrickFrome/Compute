import crypto from 'node:crypto';

export const BROWSER_BRAIN_EPISODIC_MEMORY_SCHEMA = 'metaengine.browser-brain.episodic-memory.v1';
export const BROWSER_BRAIN_MEMORY_EPISODE_SCHEMA = 'metaengine.browser-brain.collaboration-episode.v1';
export const BROWSER_BRAIN_MEMORY_RETRIEVAL_SCHEMA = 'metaengine.browser-brain.hybrid-retrieval.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/;

function boundedInt(v, fallback, min, max) { const n = Number(v); return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function safeId(v, code) { const s = String(v || '').trim().toLowerCase(); if (!SAFE_ID_RE.test(s)) throw new Error(code); return s; }
function text(v, max = 768) { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; }
function uniq(values = [], max = 64) { if (!Array.isArray(values)) return []; return [...new Set(values.map((v) => text(v, 240)).filter(Boolean))].slice(0, max); }
function uniqLower(values = [], max = 64) { return uniq(values, max).map((value) => value.toLowerCase()); }
function tokens(value) { return [...new Set(String(value || '').toLowerCase().match(/[a-z0-9_:-]{3,}/g) || [])].slice(0, 256); }
function hashVector(value, dims = 64) {
  const out = new Float64Array(dims);
  for (const token of tokens(value)) {
    const hash = crypto.createHash('sha256').update(token).digest();
    const idx = hash.readUInt16BE(0) % dims;
    out[idx] += (hash[2] & 1) === 0 ? 1 : -1;
  }
  let norm = 0; for (const n of out) norm += n * n; norm = Math.sqrt(norm) || 1;
  return Array.from(out, (n) => n / norm);
}
function cosine(a, b) { if (!a?.length || a.length !== b?.length) return 0; let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return Math.max(-1, Math.min(1, s)); }
function lexicalScore(q, doc) { if (!q.length || !doc.length) return 0; const set = new Set(doc); const hits = q.filter((t) => set.has(t)).length; return hits / Math.max(1, q.length); }
function stable(v) { if (Array.isArray(v)) return v.map(stable); if (!v || typeof v !== 'object') return v; return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); }
function digest(v) { return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }

function publicEpisode(row) {
  return Object.freeze({
    schema: BROWSER_BRAIN_MEMORY_EPISODE_SCHEMA,
    episode_id: row.episodeId,
    context_id: row.contextId,
    task_id: row.taskId,
    objective: row.objective,
    outcome: row.outcome,
    required_capabilities: Object.freeze([...row.requiredCapabilities]),
    artifact_refs: Object.freeze([...row.artifactRefs]),
    evidence_refs: Object.freeze([...row.evidenceRefs]),
    verified_facts: Object.freeze([...row.verifiedFacts]),
    rejected_paths: Object.freeze([...row.rejectedPaths]),
    next_actions: Object.freeze([...row.nextActions]),
    base_sha: row.baseSha,
    branch: row.branch,
    supersedes: Object.freeze([...row.supersedes]),
    recorded_at: row.recordedAt,
    immutable: true,
    execution_authority: false,
    authority_effect: false,
  });
}

export class BrowserBrainEpisodicMemory {
  #clock; #maxEpisodes; #maxFacts; #maxPlaybooks; #episodes = new Map(); #order = [];
  #facts = new Map(); #playbooks = new Map(); #episodeDuplicates = 0; #retrievals = 0; #consolidations = 0;

  constructor({ clock = () => Date.now(), maxEpisodes = 4096, maxFacts = 2048, maxPlaybooks = 1024 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_episodic_clock_invalid');
    this.#clock = clock;
    this.#maxEpisodes = boundedInt(maxEpisodes, 4096, 64, 32768);
    this.#maxFacts = boundedInt(maxFacts, 2048, 16, 16384);
    this.#maxPlaybooks = boundedInt(maxPlaybooks, 1024, 16, 8192);
  }
  #now() { const n = Number(this.#clock()); if (!Number.isFinite(n) || n < 0) throw new Error('browser_brain_episodic_clock_invalid'); return new Date(n).toISOString(); }

  reset() {
    this.#episodes.clear();
    this.#order = [];
    this.#facts.clear();
    this.#playbooks.clear();
    this.#episodeDuplicates = 0;
    this.#retrievals = 0;
    this.#consolidations = 0;
    return this.snapshot();
  }

  #removeEpisode(episodeId) {
    this.#episodes.delete(episodeId);
    for (const map of [this.#facts, this.#playbooks]) {
      for (const [key, support] of map.entries()) {
        if (!support.episodeIds.includes(episodeId)) continue;
        support.episodeIds = support.episodeIds.filter((id) => id !== episodeId);
        if (support.episodeIds.length === 0) map.delete(key);
      }
    }
  }

  recordEpisode({ episode_id, context_id, task_id, objective, outcome = 'COMPLETED', required_capabilities = [], artifact_refs = [], evidence_refs = [], verified_facts = [], rejected_paths = [], next_actions = [], base_sha = null, branch = null, supersedes = [] } = {}) {
    const episodeId = safeId(episode_id, 'browser_brain_episode_id_invalid');
    const prior = this.#episodes.get(episodeId);
    const baseSha = base_sha == null ? null : String(base_sha).trim().toLowerCase();
    if (baseSha != null && !SHA40_RE.test(baseSha)) throw new Error('browser_brain_episode_base_sha_invalid');
    const material = {
      episodeId,
      contextId: safeId(context_id, 'browser_brain_episode_context_invalid'),
      taskId: safeId(task_id, 'browser_brain_episode_task_invalid'),
      objective: text(objective, 1024),
      outcome: String(outcome || '').toUpperCase().slice(0, 32),
      requiredCapabilities: uniqLower(required_capabilities),
      artifactRefs: uniq(artifact_refs),
      evidenceRefs: uniq(evidence_refs),
      verifiedFacts: uniq(verified_facts, 32),
      rejectedPaths: uniq(rejected_paths, 32),
      nextActions: uniq(next_actions, 32),
      baseSha,
      branch: branch == null ? null : text(branch, 192),
      supersedes: uniq(supersedes, 16),
    };
    if (!material.objective) throw new Error('browser_brain_episode_objective_required');
    if (prior) {
      const a = digest({ ...prior, recordedAt: null, vector: null, docTokens: null });
      const b = digest({ ...material, recordedAt: null, vector: null, docTokens: null });
      if (a !== b) throw new Error('browser_brain_episode_immutable_conflict');
      this.#episodeDuplicates += 1;
      return Object.freeze({ ...publicEpisode(prior), duplicate: true });
    }
    const document = [material.objective, ...material.requiredCapabilities, ...material.verifiedFacts, ...material.rejectedPaths, ...material.nextActions].join(' ');
    const row = { ...material, docTokens: tokens(document), vector: hashVector(document), recordedAt: this.#now() };
    this.#episodes.set(episodeId, row); this.#order.push(episodeId);
    while (this.#order.length > this.#maxEpisodes) {
      const victim = this.#order.shift();
      if (victim) this.#removeEpisode(victim);
    }
    this.#consolidateEpisode(row);
    return Object.freeze({ ...publicEpisode(row), duplicate: false });
  }

  #consolidateEpisode(row) {
    if (row.outcome !== 'COMPLETED') return;
    const support = (kind, phrase, map, max) => {
      const key = `${kind}:${digest(phrase).slice(0, 24)}`;
      const prior = map.get(key) || { id: key, phrase, episodeIds: [] };
      if (!prior.episodeIds.includes(row.episodeId)) prior.episodeIds.push(row.episodeId);
      map.set(key, prior);
      while (map.size > max) map.delete(map.keys().next().value);
    };
    for (const fact of row.verifiedFacts) support('fact', fact, this.#facts, this.#maxFacts);
    for (const action of row.nextActions) support('playbook', action, this.#playbooks, this.#maxPlaybooks);
    this.#consolidations += 1;
  }

  retrieve({ query = '', context_id = null, base_sha = null, required_capabilities = [], token_budget = 1200, max_results = 8 } = {}) {
    const budget = boundedInt(token_budget, 1200, 128, 8192);
    const limit = boundedInt(max_results, 8, 1, 32);
    const requestedContext = context_id == null ? null : String(context_id).trim().toLowerCase();
    const requestedBaseSha = base_sha == null ? null : String(base_sha).trim().toLowerCase();
    if (requestedBaseSha != null && !SHA40_RE.test(requestedBaseSha)) throw new Error('browser_brain_memory_retrieval_base_sha_invalid');
    const queryTokens = tokens(query);
    const qVector = hashVector(query);
    const required = new Set(uniqLower(required_capabilities));
    const rows = [];
    for (const row of this.#episodes.values()) {
      if (requestedContext != null && row.contextId !== requestedContext) continue;
      if (requestedBaseSha != null && row.baseSha !== requestedBaseSha) continue;
      if ([...required].some((cap) => !row.requiredCapabilities.includes(cap))) continue;
      const lexical = lexicalScore(queryTokens, row.docTokens);
      const vector = (cosine(qVector, row.vector) + 1) / 2;
      const graph = row.supersedes.length > 0 ? 0.08 : 0;
      const provenance = row.baseSha && requestedBaseSha && row.baseSha === requestedBaseSha ? 0.12 : 0;
      const score = 0.5 * lexical + 0.3 * vector + graph + provenance;
      rows.push({ row, score, lexical, vector, graph, provenance });
    }
    rows.sort((a, b) => b.score - a.score || b.row.recordedAt.localeCompare(a.row.recordedAt));
    let used = 0; const results = [];
    for (const item of rows.slice(0, limit * 3)) {
      const cost = Math.max(24, Math.ceil((item.row.objective.length + item.row.verifiedFacts.join(' ').length + item.row.nextActions.join(' ').length) / 4));
      if (used + cost > budget) continue;
      used += cost;
      results.push(Object.freeze({
        episode: publicEpisode(item.row),
        score: Number(item.score.toFixed(6)),
        score_components: Object.freeze({ lexical: Number(item.lexical.toFixed(6)), vector: Number(item.vector.toFixed(6)), graph: item.graph, provenance: item.provenance }),
        estimated_tokens: cost,
      }));
      if (results.length >= limit || used >= budget) break;
    }
    this.#retrievals += 1;
    return Object.freeze({
      schema: BROWSER_BRAIN_MEMORY_RETRIEVAL_SCHEMA,
      results: Object.freeze(results),
      token_budget: budget,
      estimated_tokens_used: used,
      pipeline: 'METADATA_FILTER_TO_LEXICAL_AND_LOCAL_VECTOR_TO_GRAPH_PROVENANCE_RERANK',
      exact_base_sha_required_when_filtered: requestedBaseSha != null,
      external_confirmation_required: false,
      execution_authority: false,
      authority_effect: false,
    });
  }

  semanticFacts() {
    return Object.freeze([...this.#facts.values()].filter((row) => row.episodeIds.length >= 2).map((row) => Object.freeze({
      fact_id: row.id,
      fact: row.phrase,
      supporting_episode_ids: Object.freeze([...row.episodeIds]),
      support_count: row.episodeIds.length,
      immutable_support: true,
      execution_authority: false,
      authority_effect: false,
    })));
  }
  playbooks() {
    return Object.freeze([...this.#playbooks.values()].filter((row) => row.episodeIds.length >= 2).map((row) => Object.freeze({
      playbook_id: row.id,
      reusable_action: row.phrase,
      supporting_episode_ids: Object.freeze([...row.episodeIds]),
      support_count: row.episodeIds.length,
      generated_on_terminal_write_path: true,
      execution_authority: false,
      authority_effect: false,
    })));
  }
  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_EPISODIC_MEMORY_SCHEMA,
      episode_count: this.#episodes.size,
      semantic_fact_count: [...this.#facts.values()].filter((row) => row.episodeIds.length >= 2).length,
      procedural_playbook_count: [...this.#playbooks.values()].filter((row) => row.episodeIds.length >= 2).length,
      episode_duplicate_count: this.#episodeDuplicates,
      retrieval_count: this.#retrievals,
      consolidation_count: this.#consolidations,
      immutable_provenance: true,
      supersession_graph: true,
      hybrid_retrieval: true,
      bounded_memory: true,
      strict_retrieval_token_budget: true,
      strict_base_sha_filtering: true,
      consolidation_on_terminal_write_path_only: true,
      semantic_hot_path_writes: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
