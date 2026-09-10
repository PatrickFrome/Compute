import crypto from 'node:crypto';
import { ChatDevelopmentIndex } from './chat-development-index.mjs';
import { buildChatDevelopmentCapsule } from './chat-development-capsule.mjs';
import { buildFastContext } from './fast-context-v1.mjs';

export const CHAT_DEVELOPMENT_CONTROL_STATE_SCHEMA = 'metaengine.chat-development-control-state.v1';
export const CHAT_DEVELOPMENT_CONTROL_MAX_CI = 64;
export const CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE = 256;

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

function normalizeSource(source) {
  if (!plain(source) || source.authority_effect === true) throw new Error('chat_dev_control_source_invalid');
  const repository = String(source.repository || '').trim();
  const headSha = String(source.head_sha ?? source.head ?? '').trim().toLowerCase();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('chat_dev_control_repository_invalid');
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('chat_dev_control_head_invalid');
  return Object.freeze({
    repository,
    branch: clip(source.branch ?? source.ref, 240),
    head_sha: headSha,
    base_sha: /^[0-9a-f]{40}$/i.test(String(source.base_sha || '')) ? String(source.base_sha).toLowerCase() : null,
    pr: Number.isSafeInteger(Number(source.pr)) ? Number(source.pr) : null,
    dirty: typeof source.dirty === 'boolean' ? source.dirty : null,
    authority_effect: false,
  });
}

function normalizeCi(row) {
  if (!plain(row) || row.authority_effect === true) throw new Error('chat_dev_control_ci_invalid');
  const id = String(row.id ?? row.run_id ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) throw new Error('chat_dev_control_ci_id_invalid');
  return Object.freeze({
    id,
    name: clip(row.name, 160),
    status: clip(String(row.status || '').toLowerCase(), 24),
    conclusion: row.conclusion == null ? null : clip(String(row.conclusion).toLowerCase(), 24),
    head_sha: clip(String(row.head_sha ?? row.sha ?? '').toLowerCase(), 64),
    updated_at: row.updated_at == null ? null : new Date(row.updated_at).toISOString(),
    authority_effect: false,
  });
}

function normalizeEvidence(row, sourceHead) {
  if (!plain(row) || row.authority_effect === true) throw new Error('chat_dev_control_evidence_invalid');
  const id = String(row.id || '').trim();
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(id)) throw new Error('chat_dev_control_evidence_id_invalid');
  const suppliedSha = String(row.sha ?? row.head_sha ?? '').trim().toLowerCase();
  if (suppliedSha && suppliedSha !== sourceHead) throw new Error('chat_dev_control_evidence_head_mismatch');
  return Object.freeze({
    id,
    kind: String(row.kind || '').trim().toUpperCase(),
    title: clip(row.title, 240),
    text: clip(row.text, 1600),
    ref: clip(row.ref, 240),
    path: clip(row.path, 400),
    sha: sourceHead,
    severity: String(row.severity || 'INFO').trim().toUpperCase(),
    updated_at: row.updated_at == null ? null : new Date(row.updated_at).toISOString(),
    authority_effect: false,
  });
}

function ciSort(a, b) {
  return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || a.id.localeCompare(b.id);
}

function evidenceSort(a, b) {
  return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || a.id.localeCompare(b.id);
}

export class ChatDevelopmentControlState {
  #source = null;
  #sourceEpoch = 0;
  #ci = new Map();
  #evidence = new Map();
  #index = new ChatDevelopmentIndex();
  #repoIndexRevision = null;
  #capabilityRevision = null;
  #updatedAt = null;
  #revision = 'dcs:empty';

  #recompute(now = new Date().toISOString()) {
    const ci = [...this.#ci.values()].sort(ciSort);
    const evidence = [...this.#evidence.values()].sort(evidenceSort);
    this.#index.replace(evidence);
    const material = JSON.stringify({
      source: this.#source,
      source_epoch: this.#sourceEpoch,
      ci,
      evidence_revision: this.#index.snapshot().revision,
      repo_index_revision: this.#repoIndexRevision,
      capability_revision: this.#capabilityRevision,
    });
    this.#revision = `dcs:${sha256(material)}`;
    this.#updatedAt = new Date(now).toISOString();
    return this.snapshot();
  }

  setSource(source, now = new Date().toISOString()) {
    const next = normalizeSource(source);
    const changed = !this.#source || this.#source.repository !== next.repository || this.#source.head_sha !== next.head_sha;
    if (changed) {
      this.#sourceEpoch += 1;
      this.#ci.clear();
      this.#evidence.clear();
      this.#repoIndexRevision = null;
    }
    this.#source = next;
    return this.#recompute(now);
  }

  setCapabilityRevision(revision, now = new Date().toISOString()) {
    const value = String(revision || '').trim();
    if (value.length > 96) throw new Error('chat_dev_control_capability_revision_invalid');
    this.#capabilityRevision = value || null;
    return this.#recompute(now);
  }

  setRepoIndexRevision(revision, { head_sha = null, now = new Date().toISOString() } = {}) {
    if (!this.#source) throw new Error('chat_dev_control_source_required');
    if (head_sha && String(head_sha).toLowerCase() !== this.#source.head_sha) throw new Error('chat_dev_control_repo_index_head_mismatch');
    const value = String(revision || '').trim();
    if (!value || value.length > 96) throw new Error('chat_dev_control_repo_index_revision_invalid');
    this.#repoIndexRevision = value;
    return this.#recompute(now);
  }

  upsertCi(row, now = new Date().toISOString()) {
    if (!this.#source) throw new Error('chat_dev_control_source_required');
    const value = normalizeCi(row);
    if (value.head_sha && value.head_sha !== this.#source.head_sha) return Object.freeze({ accepted: false, reason: 'STALE_HEAD', snapshot: this.snapshot(), authority_effect: false });
    this.#ci.set(value.id, Object.freeze({ ...value, head_sha: this.#source.head_sha }));
    if (this.#ci.size > CHAT_DEVELOPMENT_CONTROL_MAX_CI) {
      const rows = [...this.#ci.values()].sort(ciSort);
      this.#ci = new Map(rows.slice(0, CHAT_DEVELOPMENT_CONTROL_MAX_CI).map((item) => [item.id, item]));
    }
    return Object.freeze({ accepted: true, snapshot: this.#recompute(now), authority_effect: false });
  }

  upsertEvidence(row, now = new Date().toISOString()) {
    if (!this.#source) throw new Error('chat_dev_control_source_required');
    const value = normalizeEvidence(row, this.#source.head_sha);
    this.#evidence.set(value.id, value);
    if (this.#evidence.size > CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE) {
      const rows = [...this.#evidence.values()].sort(evidenceSort);
      this.#evidence = new Map(rows.slice(0, CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE).map((item) => [item.id, item]));
    }
    return Object.freeze({ accepted: true, snapshot: this.#recompute(now), authority_effect: false });
  }

  removeEvidence(id, now = new Date().toISOString()) {
    const removed = this.#evidence.delete(String(id || ''));
    if (removed) this.#recompute(now);
    return Object.freeze({ removed, snapshot: this.snapshot(), authority_effect: false });
  }

  query(input) {
    return this.#index.query(input);
  }

  capsule(generatedAt = this.#updatedAt || new Date().toISOString()) {
    if (!this.#source) return null;
    return buildChatDevelopmentCapsule({
      source: this.#source,
      ci_runs: [...this.#ci.values()],
      evidence: [...this.#evidence.values()],
      evidence_revision: this.#index.snapshot().revision,
      repo_index_revision: this.#repoIndexRevision,
      capability_revision: this.#capabilityRevision,
      generated_at: generatedAt,
    });
  }

  fastContext({ state = {}, fields = null, if_none_match = null, max_bytes, now_ms = Date.now() } = {}) {
    const ciRows = [...this.#ci.values()];
    const success = ciRows.filter((row) => row.conclusion === 'success').length;
    const failed = ciRows.filter((row) => row.conclusion && !['success', 'skipped', 'neutral'].includes(row.conclusion)).length;
    const pending = ciRows.filter((row) => !row.conclusion && row.status !== 'completed').length;
    return buildFastContext({
      state,
      source: this.#source,
      ci: { success, failed, pending, exact_sha: this.#source?.head_sha ?? null },
      development_capsule: this.capsule(new Date(now_ms).toISOString()),
      capability_revision: this.#capabilityRevision,
      fields,
      if_none_match,
      max_bytes,
      now_ms,
    });
  }

  snapshot() {
    return Object.freeze({
      schema: CHAT_DEVELOPMENT_CONTROL_STATE_SCHEMA,
      revision: this.#revision,
      updated_at: this.#updatedAt,
      source: this.#source ? structuredClone(this.#source) : null,
      source_epoch: this.#sourceEpoch,
      ci_rows: this.#ci.size,
      evidence_rows: this.#evidence.size,
      evidence_revision: this.#index.snapshot().revision,
      repo_index_revision: this.#repoIndexRevision,
      capability_revision: this.#capabilityRevision,
      query_network_reads: 0,
      query_filesystem_reads: 0,
      second_scheduler: false,
      command_authority: false,
      browser_execution_authority: false,
      authority_effect: false,
    });
  }
}
