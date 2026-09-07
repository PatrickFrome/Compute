import crypto from 'node:crypto';

export const BROWSER_BRAIN_COLLABORATION_FABRIC_SCHEMA = 'metaengine.browser-brain.collaboration-fabric.v1';
export const BROWSER_BRAIN_HANDOFF_SCHEMA = 'metaengine.browser-brain.handoff-capsule.v1';
export const BROWSER_BRAIN_AUTONOMY_DECISION_SCHEMA = 'metaengine.browser-brain.autonomy-decision.v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const TASK_STATES = new Set(['READY', 'ACTIVE', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED']);
const TERMINAL_TASK_STATES = new Set(['COMPLETED', 'CANCELLED']);
const MESSAGE_KINDS = new Set([
  'ASSIGNMENT', 'FACT', 'QUESTION', 'PROPOSAL', 'CRITIQUE',
  'RESULT', 'BLOCKER', 'HANDOFF', 'STATE_CHANGED', 'ACK',
]);
const CLAIM_MODES = new Set(['PRIMARY', 'INDEPENDENT_VERIFIER']);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeId(value, code, { lower = false, max = 192 } = {}) {
  const raw = String(value || '').trim();
  const out = lower ? raw.toLowerCase() : raw;
  if (!out || out.length > max || !SAFE_ID_RE.test(out)) throw new Error(code);
  return out;
}

function shortText(value, max = 512) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function digest(value, code) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(code);
  return out;
}

function positiveInt(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

function nonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function uniqueIds(value, code, max = 32) {
  if (!Array.isArray(value) || value.length > max) throw new Error(code);
  return Object.freeze([...new Set(value.map((row) => safeId(row, code, { lower: true, max: 192 })))]);
}

function uniqueTexts(value, code, { maxItems = 16, maxText = 240 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(code);
  return Object.freeze([...new Set(value.map((row) => {
    const text = shortText(row, maxText);
    if (!text) throw new Error(code);
    return text;
  }))]);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function publicTask(row) {
  return Object.freeze({
    context_id: row.contextId,
    task_id: row.taskId,
    objective: row.objective,
    status: row.status,
    owner_agent_id: row.ownerAgentId,
    progress_revision: row.progressRevision,
    dependencies: Object.freeze([...row.dependencies]),
    required_capabilities: Object.freeze([...row.requiredCapabilities]),
    blocker: row.blocker,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    assignment_is_advisory: true,
    execution_authority: false,
    scheduler_authority: false,
    authority_effect: false,
  });
}

function publicClaim(row) {
  return Object.freeze({
    claim_id: row.claimId,
    context_id: row.contextId,
    task_id: row.taskId,
    agent_id: row.agentId,
    agent_generation: row.agentGeneration,
    scope: row.scope,
    mode: row.mode,
    claimed_at_ms: row.claimedAtMs,
    expires_at_ms: row.expiresAtMs,
    advisory_only: true,
    execution_authority: false,
    scheduler_authority: false,
    lease_authority: false,
    authority_effect: false,
  });
}

function publicArtifact(row) {
  return Object.freeze({
    artifact_id: row.artifactId,
    context_id: row.contextId,
    task_id: row.taskId,
    kind: row.kind,
    content_digest: row.contentDigest,
    refs: Object.freeze([...row.refs]),
    base_sha: row.baseSha,
    branch: row.branch,
    recorded_at: row.recordedAt,
    immutable: true,
    body_stored: false,
    execution_authority: false,
    authority_effect: false,
  });
}

function publicMessage(row) {
  return Object.freeze({
    message_id: row.messageId,
    context_id: row.contextId,
    task_id: row.taskId,
    source_agent_id: row.sourceAgentId,
    source_generation: row.sourceGeneration,
    target: row.target,
    kind: row.kind,
    priority: row.priority,
    causal_parent_ids: Object.freeze([...row.causalParentIds]),
    artifact_refs: Object.freeze([...row.artifactRefs]),
    evidence_refs: Object.freeze([...row.evidenceRefs]),
    body_digest: row.bodyDigest,
    causal_epoch: row.causalEpoch,
    created_at: row.createdAt,
    body_stored: false,
    delivery_grants_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

export class BrowserBrainCollaborationFabric {
  #clock;
  #maxContexts;
  #maxTasks;
  #maxMessages;
  #maxArtifacts;
  #maxClaims;
  #maxHandoffs;
  #contexts = new Map();
  #tasks = new Map();
  #messages = new Map();
  #messageOrder = [];
  #artifacts = new Map();
  #artifactOrder = [];
  #claims = new Map();
  #handoffs = new Map();
  #handoffOrder = [];
  #messageDuplicates = 0;
  #claimConflicts = 0;
  #replans = 0;
  #discoveries = 0;
  #continuationDecisions = 0;

  constructor({
    clock = () => Date.now(),
    maxContexts = 1024,
    maxTasks = 4096,
    maxMessages = 8192,
    maxArtifacts = 4096,
    maxClaims = 4096,
    maxHandoffs = 2048,
  } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_collaboration_clock_invalid');
    this.#clock = clock;
    this.#maxContexts = boundedInt(maxContexts, 1024, 1, 8192);
    this.#maxTasks = boundedInt(maxTasks, 4096, 1, 32768);
    this.#maxMessages = boundedInt(maxMessages, 8192, 64, 65536);
    this.#maxArtifacts = boundedInt(maxArtifacts, 4096, 1, 32768);
    this.#maxClaims = boundedInt(maxClaims, 4096, 1, 32768);
    this.#maxHandoffs = boundedInt(maxHandoffs, 2048, 1, 16384);
  }

  #nowMs() {
    const value = Number(this.#clock());
    if (!Number.isFinite(value) || value < 0) throw new Error('browser_brain_collaboration_clock_invalid');
    return value;
  }

  #nowIso() {
    return new Date(this.#nowMs()).toISOString();
  }

  #evictTask(taskId) {
    this.#tasks.delete(taskId);
    for (const [messageId, row] of this.#messages) {
      if (row.taskId === taskId) this.#messages.delete(messageId);
    }
    this.#messageOrder = this.#messageOrder.filter((messageId) => this.#messages.has(messageId));
    for (const [artifactId, row] of this.#artifacts) {
      if (row.taskId === taskId) this.#artifacts.delete(artifactId);
    }
    this.#artifactOrder = this.#artifactOrder.filter((artifactId) => this.#artifacts.has(artifactId));
    for (const [claimId, row] of this.#claims) {
      if (row.taskId === taskId) this.#claims.delete(claimId);
    }
    for (const [handoffId, row] of this.#handoffs) {
      if (row.task_id === taskId) this.#handoffs.delete(handoffId);
    }
    this.#handoffOrder = this.#handoffOrder.filter((handoffId) => this.#handoffs.has(handoffId));
  }

  #evictContext(contextId) {
    const taskIds = [...this.#tasks.values()]
      .filter((row) => row.contextId === contextId)
      .map((row) => row.taskId);
    for (const taskId of taskIds) this.#evictTask(taskId);
    for (const [messageId, row] of this.#messages) {
      if (row.contextId === contextId) this.#messages.delete(messageId);
    }
    this.#messageOrder = this.#messageOrder.filter((messageId) => this.#messages.has(messageId));
    for (const [artifactId, row] of this.#artifacts) {
      if (row.contextId === contextId) this.#artifacts.delete(artifactId);
    }
    this.#artifactOrder = this.#artifactOrder.filter((artifactId) => this.#artifacts.has(artifactId));
    for (const [claimId, row] of this.#claims) {
      if (row.contextId === contextId) this.#claims.delete(claimId);
    }
    for (const [handoffId, row] of this.#handoffs) {
      if (row.context_id === contextId) this.#handoffs.delete(handoffId);
    }
    this.#handoffOrder = this.#handoffOrder.filter((handoffId) => this.#handoffs.has(handoffId));
    this.#contexts.delete(contextId);
  }

  #ensureContext(contextIdRaw) {
    const contextId = safeId(contextIdRaw, 'browser_brain_collaboration_context_invalid', { lower: true });
    let row = this.#contexts.get(contextId);
    if (row) return row;
    if (this.#contexts.size >= this.#maxContexts) {
      const terminal = [...this.#contexts.values()].find((candidate) => {
        const tasks = [...this.#tasks.values()].filter((task) => task.contextId === candidate.contextId);
        return tasks.length === 0 || tasks.every((task) => TERMINAL_TASK_STATES.has(task.status));
      });
      if (!terminal) throw new Error('browser_brain_collaboration_context_capacity_exceeded');
      this.#evictContext(terminal.contextId);
    }
    row = { contextId, createdAt: this.#nowIso(), revision: 0 };
    this.#contexts.set(contextId, row);
    return row;
  }

  #task(taskIdRaw) {
    const taskId = safeId(taskIdRaw, 'browser_brain_collaboration_task_invalid', { lower: true });
    return this.#tasks.get(taskId) || null;
  }

  #activeClaimsForTask(taskId, now = this.#nowMs()) {
    return [...this.#claims.values()].filter((row) => row.taskId === taskId && row.expiresAtMs > now);
  }

  #dependenciesComplete(task) {
    return task.dependencies.every((dependencyId) => this.#tasks.get(dependencyId)?.status === 'COMPLETED');
  }

  recordTask({
    context_id,
    task_id,
    objective,
    dependencies = [],
    required_capabilities = [],
    owner_agent_id = null,
    status = 'READY',
  } = {}) {
    const context = this.#ensureContext(context_id);
    const taskId = safeId(task_id, 'browser_brain_collaboration_task_invalid', { lower: true });
    if (this.#tasks.has(taskId)) throw new Error('browser_brain_collaboration_task_exists');
    if (this.#tasks.size >= this.#maxTasks) {
      const victim = [...this.#tasks.values()].find((row) => TERMINAL_TASK_STATES.has(row.status));
      if (!victim) throw new Error('browser_brain_collaboration_task_capacity_exceeded');
      this.#evictTask(victim.taskId);
    }
    const normalizedStatus = String(status || 'READY').toUpperCase();
    if (!TASK_STATES.has(normalizedStatus)) throw new Error('browser_brain_collaboration_task_status_invalid');
    const normalizedDependencies = uniqueIds(dependencies, 'browser_brain_collaboration_task_dependency_invalid', 64);
    if (normalizedDependencies.includes(taskId)) throw new Error('browser_brain_collaboration_task_self_dependency');
    const capabilities = uniqueIds(required_capabilities, 'browser_brain_collaboration_task_capability_invalid', 64);
    const ownerAgentId = owner_agent_id == null
      ? null
      : safeId(owner_agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 });
    const now = this.#nowIso();
    const row = {
      contextId: context.contextId,
      taskId,
      objective: shortText(objective, 768),
      status: normalizedStatus,
      ownerAgentId,
      progressRevision: 1,
      dependencies: normalizedDependencies,
      requiredCapabilities: capabilities,
      blocker: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!row.objective) throw new Error('browser_brain_collaboration_task_objective_required');
    this.#tasks.set(taskId, row);
    context.revision += 1;
    return publicTask(row);
  }

  advanceTask({
    task_id,
    progress_revision,
    status,
    owner_agent_id = undefined,
    blocker = null,
  } = {}) {
    const row = this.#task(task_id);
    if (!row) throw new Error('browser_brain_collaboration_task_not_found');
    const revision = positiveInt(progress_revision, 'browser_brain_collaboration_progress_revision_invalid');
    if (revision <= row.progressRevision) throw new Error('browser_brain_collaboration_progress_revision_regression');
    if (TERMINAL_TASK_STATES.has(row.status)) throw new Error('browser_brain_collaboration_terminal_task_immutable');
    const nextStatus = String(status || row.status).toUpperCase();
    if (!TASK_STATES.has(nextStatus)) throw new Error('browser_brain_collaboration_task_status_invalid');
    if (owner_agent_id !== undefined) {
      row.ownerAgentId = owner_agent_id == null
        ? null
        : safeId(owner_agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 });
    }
    row.status = nextStatus;
    row.progressRevision = revision;
    row.blocker = nextStatus === 'BLOCKED' || nextStatus === 'FAILED' ? shortText(blocker, 512) : null;
    row.updatedAt = this.#nowIso();
    this.#contexts.get(row.contextId).revision += 1;
    return publicTask(row);
  }

  recordMessage({
    message_id,
    context_id,
    task_id = null,
    source_agent_id,
    source_generation = 1,
    target,
    kind,
    priority = 'NORMAL',
    causal_parent_ids = [],
    artifact_refs = [],
    evidence_refs = [],
    body_digest,
    causal_epoch = 0,
  } = {}) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const messageId = safeId(message_id, 'browser_brain_collaboration_message_invalid', { lower: true });
    const taskId = task_id == null ? null : safeId(task_id, 'browser_brain_collaboration_task_invalid', { lower: true });
    if (taskId && this.#tasks.get(taskId)?.contextId !== contextId) {
      throw new Error('browser_brain_collaboration_message_task_context_mismatch');
    }
    const normalizedKind = String(kind || '').toUpperCase();
    if (!MESSAGE_KINDS.has(normalizedKind)) throw new Error('browser_brain_collaboration_message_kind_invalid');
    const material = {
      messageId,
      contextId,
      taskId,
      sourceAgentId: safeId(source_agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 }),
      sourceGeneration: positiveInt(source_generation, 'browser_brain_collaboration_agent_generation_invalid'),
      target: safeId(target, 'browser_brain_collaboration_target_invalid', { lower: true }),
      kind: normalizedKind,
      priority: String(priority || 'NORMAL').toUpperCase().slice(0, 24),
      causalParentIds: uniqueIds(causal_parent_ids, 'browser_brain_collaboration_causal_parent_invalid', 32),
      artifactRefs: uniqueIds(artifact_refs, 'browser_brain_collaboration_artifact_ref_invalid', 32),
      evidenceRefs: uniqueIds(evidence_refs, 'browser_brain_collaboration_evidence_ref_invalid', 32),
      bodyDigest: digest(body_digest, 'browser_brain_collaboration_message_digest_invalid'),
      causalEpoch: nonNegativeInt(causal_epoch),
    };
    const prior = this.#messages.get(messageId);
    if (prior) {
      if (contentHash({ ...prior, createdAt: null }) !== contentHash({ ...material, createdAt: null })) {
        throw new Error('browser_brain_collaboration_message_id_collision');
      }
      this.#messageDuplicates += 1;
      return Object.freeze({ ...publicMessage(prior), duplicate: true });
    }
    const context = this.#ensureContext(contextId);
    const row = { ...material, createdAt: this.#nowIso() };
    this.#messages.set(messageId, row);
    this.#messageOrder.push(messageId);
    while (this.#messageOrder.length > this.#maxMessages) {
      const victim = this.#messageOrder.shift();
      if (victim) this.#messages.delete(victim);
    }
    context.revision += 1;
    return Object.freeze({ ...publicMessage(row), duplicate: false });
  }

  recordArtifact({
    artifact_id,
    context_id,
    task_id = null,
    kind,
    content_digest,
    refs = [],
    base_sha = null,
    branch = null,
  } = {}) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const artifactId = safeId(artifact_id, 'browser_brain_collaboration_artifact_invalid', { lower: true });
    const taskId = task_id == null ? null : safeId(task_id, 'browser_brain_collaboration_task_invalid', { lower: true });
    if (taskId && this.#tasks.get(taskId)?.contextId !== contextId) {
      throw new Error('browser_brain_collaboration_artifact_task_context_mismatch');
    }
    const normalizedKind = safeId(kind, 'browser_brain_collaboration_artifact_kind_invalid', { lower: true, max: 64 });
    const normalizedDigest = digest(content_digest, 'browser_brain_collaboration_artifact_digest_invalid');
    const normalizedRefs = uniqueIds(refs, 'browser_brain_collaboration_artifact_ref_invalid', 32);
    const normalizedBaseSha = base_sha == null ? null : String(base_sha).trim().toLowerCase();
    if (normalizedBaseSha != null && !SHA40_RE.test(normalizedBaseSha)) {
      throw new Error('browser_brain_collaboration_artifact_base_sha_invalid');
    }
    const normalizedBranch = branch == null ? null : shortText(branch, 192);
    const material = {
      artifactId,
      contextId,
      taskId,
      kind: normalizedKind,
      contentDigest: normalizedDigest,
      refs: normalizedRefs,
      baseSha: normalizedBaseSha,
      branch: normalizedBranch,
    };
    const prior = this.#artifacts.get(artifactId);
    if (prior) {
      if (contentHash({ ...prior, recordedAt: null }) !== contentHash({ ...material, recordedAt: null })) {
        throw new Error('browser_brain_collaboration_artifact_immutable_conflict');
      }
      return Object.freeze({ ...publicArtifact(prior), duplicate: true });
    }
    const context = this.#ensureContext(contextId);
    const row = {
      ...material,
      recordedAt: this.#nowIso(),
    };
    this.#artifacts.set(artifactId, row);
    this.#artifactOrder.push(artifactId);
    while (this.#artifactOrder.length > this.#maxArtifacts) {
      const victim = this.#artifactOrder.shift();
      if (victim) this.#artifacts.delete(victim);
    }
    context.revision += 1;
    return Object.freeze({ ...publicArtifact(row), duplicate: false });
  }

  claimWork({
    claim_id,
    context_id,
    task_id,
    agent_id,
    agent_generation = 1,
    scope,
    mode = 'PRIMARY',
    ttl_ms = 15 * 60_000,
  } = {}) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const task = this.#task(task_id);
    if (!task || task.contextId !== contextId) throw new Error('browser_brain_collaboration_claim_task_invalid');
    const claimId = safeId(claim_id, 'browser_brain_collaboration_claim_invalid', { lower: true });
    const agentId = safeId(agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 });
    const agentGeneration = positiveInt(agent_generation, 'browser_brain_collaboration_agent_generation_invalid');
    const normalizedScope = safeId(scope, 'browser_brain_collaboration_claim_scope_invalid', { lower: true });
    const normalizedMode = String(mode || 'PRIMARY').toUpperCase();
    if (!CLAIM_MODES.has(normalizedMode)) throw new Error('browser_brain_collaboration_claim_mode_invalid');
    const ttl = boundedInt(ttl_ms, 15 * 60_000, 1_000, 24 * 60 * 60_000);
    const now = this.#nowMs();

    const existingById = this.#claims.get(claimId);
    if (existingById) {
      const existingTtl = existingById.expiresAtMs - existingById.claimedAtMs;
      if (
        existingById.contextId !== contextId
        || existingById.taskId !== task.taskId
        || existingById.agentId !== agentId
        || existingById.agentGeneration !== agentGeneration
        || existingById.scope !== normalizedScope
        || existingById.mode !== normalizedMode
        || existingTtl !== ttl
      ) throw new Error('browser_brain_collaboration_claim_id_collision');
      return Object.freeze({ claimed: true, duplicate: true, claim: publicClaim(existingById), task_materialized: false, authority_effect: false });
    }

    if (normalizedMode === 'PRIMARY') {
      const conflict = [...this.#claims.values()].find((row) =>
        row.contextId === contextId
        && row.taskId === task.taskId
        && row.scope === normalizedScope
        && row.mode === 'PRIMARY'
        && row.agentId !== agentId
        && row.expiresAtMs > now
      );
      if (conflict) {
        this.#claimConflicts += 1;
        return Object.freeze({
          claimed: false,
          duplicate: false,
          reason: 'ADVISORY_SCOPE_ALREADY_CLAIMED',
          conflicting_claim: publicClaim(conflict),
          work_blocked_globally: false,
          autonomous_alternative_required: true,
          authority_effect: false,
        });
      }
    }

    if (this.#claims.size >= this.#maxClaims) {
      const expired = [...this.#claims.values()].find((row) => row.expiresAtMs <= now);
      if (!expired) throw new Error('browser_brain_collaboration_claim_capacity_exceeded');
      this.#claims.delete(expired.claimId);
    }
    const context = this.#ensureContext(contextId);
    const row = {
      claimId,
      contextId,
      taskId: task.taskId,
      agentId,
      agentGeneration,
      scope: normalizedScope,
      mode: normalizedMode,
      claimedAtMs: now,
      expiresAtMs: now + ttl,
    };
    this.#claims.set(claimId, row);
    let materializedTask = null;
    if (task.status === 'READY') {
      task.status = 'ACTIVE';
      task.ownerAgentId = agentId;
      task.progressRevision += 1;
      task.updatedAt = this.#nowIso();
      materializedTask = publicTask(task);
    }
    context.revision += 1;
    return Object.freeze({
      claimed: true,
      duplicate: false,
      claim: publicClaim(row),
      task_materialized: materializedTask != null,
      materialized_task: materializedTask,
      authority_effect: false,
    });
  }

  releaseClaim(claim_id, reason = 'WORK_SCOPE_FINISHED') {
    const claimId = safeId(claim_id, 'browser_brain_collaboration_claim_invalid', { lower: true });
    const row = this.#claims.get(claimId);
    if (!row) return Object.freeze({ released: false, reason: 'CLAIM_NOT_FOUND', authority_effect: false });
    this.#claims.delete(claimId);
    return Object.freeze({
      released: true,
      claim_id: claimId,
      reason: shortText(reason, 160) || 'WORK_SCOPE_FINISHED',
      advisory_only: true,
      authority_effect: false,
    });
  }

  recordHandoff({
    handoff_id,
    context_id,
    task_id = null,
    from_agent_id,
    to_agent_id = null,
    objective,
    completed = [],
    verified_facts = [],
    hypotheses = [],
    rejected_paths = [],
    blockers = [],
    artifact_refs = [],
    evidence_refs = [],
    next_actions = [],
    base_sha = null,
    branch = null,
    confidence = 0.5,
  } = {}) {
    const handoffId = safeId(handoff_id, 'browser_brain_collaboration_handoff_invalid', { lower: true });
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const taskId = task_id == null ? null : safeId(task_id, 'browser_brain_collaboration_task_invalid', { lower: true });
    if (taskId && this.#tasks.get(taskId)?.contextId !== contextId) {
      throw new Error('browser_brain_collaboration_handoff_task_context_mismatch');
    }
    const normalizedBaseSha = base_sha == null ? null : String(base_sha).trim().toLowerCase();
    if (normalizedBaseSha != null && !SHA40_RE.test(normalizedBaseSha)) {
      throw new Error('browser_brain_collaboration_handoff_base_sha_invalid');
    }
    const normalizedConfidence = Number(confidence);
    if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
      throw new Error('browser_brain_collaboration_handoff_confidence_invalid');
    }
    const material = {
      schema: BROWSER_BRAIN_HANDOFF_SCHEMA,
      handoff_id: handoffId,
      context_id: contextId,
      task_id: taskId,
      from_agent_id: safeId(from_agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 }),
      to_agent_id: to_agent_id == null ? null : safeId(to_agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 }),
      objective: shortText(objective, 768),
      completed: uniqueTexts(completed, 'browser_brain_collaboration_handoff_completed_invalid'),
      verified_facts: uniqueTexts(verified_facts, 'browser_brain_collaboration_handoff_fact_invalid'),
      hypotheses: uniqueTexts(hypotheses, 'browser_brain_collaboration_handoff_hypothesis_invalid'),
      rejected_paths: uniqueTexts(rejected_paths, 'browser_brain_collaboration_handoff_rejected_invalid'),
      blockers: uniqueTexts(blockers, 'browser_brain_collaboration_handoff_blocker_invalid'),
      artifact_refs: uniqueIds(artifact_refs, 'browser_brain_collaboration_artifact_ref_invalid', 32),
      evidence_refs: uniqueIds(evidence_refs, 'browser_brain_collaboration_evidence_ref_invalid', 32),
      next_actions: uniqueTexts(next_actions, 'browser_brain_collaboration_handoff_next_action_invalid'),
      base_sha: normalizedBaseSha,
      branch: branch == null ? null : shortText(branch, 192),
      confidence: normalizedConfidence,
      full_transcript_stored: false,
      external_confirmation_required: false,
      execution_authority: false,
      authority_effect: false,
    };
    const prior = this.#handoffs.get(handoffId);
    if (prior) {
      if (contentHash({ ...prior, recorded_at: null }) !== contentHash({ ...material, recorded_at: null })) {
        throw new Error('browser_brain_collaboration_handoff_id_collision');
      }
      return Object.freeze({ ...prior, duplicate: true });
    }
    const context = this.#ensureContext(contextId);
    const row = Object.freeze({
      ...material,
      recorded_at: this.#nowIso(),
    });
    if (!row.objective) throw new Error('browser_brain_collaboration_handoff_objective_required');
    this.#handoffs.set(handoffId, row);
    this.#handoffOrder.push(handoffId);
    while (this.#handoffOrder.length > this.#maxHandoffs) {
      const victim = this.#handoffOrder.shift();
      if (victim) this.#handoffs.delete(victim);
    }
    context.revision += 1;
    return Object.freeze({ ...row, duplicate: false });
  }

  taskLedger(context_id) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const tasks = [...this.#tasks.values()].filter((row) => row.contextId === contextId);
    const facts = [...this.#messages.values()]
      .filter((row) => row.contextId === contextId && row.kind === 'FACT')
      .slice(-64)
      .map(publicMessage);
    return Object.freeze({
      schema: 'metaengine.browser-brain.task-ledger.v1',
      context_id: contextId,
      context_revision: this.#contexts.get(contextId)?.revision || 0,
      tasks: Object.freeze(tasks.map(publicTask)),
      verified_fact_messages: Object.freeze(facts),
      artifact_refs: Object.freeze(
        [...this.#artifacts.values()].filter((row) => row.contextId === contextId).map((row) => row.artifactId),
      ),
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }

  progressLedger(context_id) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const tasks = [...this.#tasks.values()].filter((row) => row.contextId === contextId);
    const now = this.#nowMs();
    const claims = [...this.#claims.values()].filter((row) => row.contextId === contextId && row.expiresAtMs > now);
    const blockers = tasks.filter((row) => row.status === 'BLOCKED' || row.status === 'FAILED');
    return Object.freeze({
      schema: 'metaengine.browser-brain.progress-ledger.v1',
      context_id: contextId,
      context_revision: this.#contexts.get(contextId)?.revision || 0,
      ready: tasks.filter((row) => row.status === 'READY').length,
      active: tasks.filter((row) => row.status === 'ACTIVE').length,
      blocked: blockers.length,
      completed: tasks.filter((row) => row.status === 'COMPLETED').length,
      failed: tasks.filter((row) => row.status === 'FAILED').length,
      active_agents: Object.freeze([...new Set(claims.map((row) => row.agentId))].sort()),
      blockers: Object.freeze(blockers.map((row) => Object.freeze({
        task_id: row.taskId,
        blocker: row.blocker,
        progress_revision: row.progressRevision,
      }))),
      advisory_work_claim_count: claims.length,
      external_confirmation_required: false,
      authority_effect: false,
    });
  }

  decideAutonomousContinuation({ context_id, agent_id } = {}) {
    const contextId = safeId(context_id, 'browser_brain_collaboration_context_invalid', { lower: true });
    const agentId = safeId(agent_id, 'browser_brain_collaboration_agent_invalid', { lower: true, max: 128 });
    this.#ensureContext(contextId);
    const tasks = [...this.#tasks.values()].filter((row) => row.contextId === contextId);
    const now = this.#nowMs();
    const activeClaims = [...this.#claims.values()].filter((row) => row.contextId === contextId && row.expiresAtMs > now);
    const ownActive = tasks
      .filter((row) => row.status === 'ACTIVE' && row.ownerAgentId === agentId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];

    let action;
    let taskId = null;
    let reason;

    if (ownActive) {
      action = 'CONTINUE_TASK';
      taskId = ownActive.taskId;
      reason = 'OWN_ACTIVE_TASK_EXISTS';
    } else {
      const ready = tasks.find((row) =>
        row.status === 'READY'
        && this.#dependenciesComplete(row)
        && !activeClaims.some((claim) => claim.taskId === row.taskId && claim.mode === 'PRIMARY' && claim.agentId !== agentId)
      );
      if (ready) {
        action = 'CLAIM_READY_TASK';
        taskId = ready.taskId;
        reason = 'READY_UNCLAIMED_WORK_EXISTS';
      } else if (tasks.some((row) => row.status === 'BLOCKED' || row.status === 'FAILED')) {
        action = 'REPLAN_AROUND_BLOCKERS';
        reason = 'BLOCKED_OR_FAILED_WORK_REQUIRES_NEW_PLAN';
        this.#replans += 1;
      } else if (tasks.some((row) => !TERMINAL_TASK_STATES.has(row.status))) {
        action = 'FIND_COMPLEMENTARY_WORK';
        reason = 'NONTERMINAL_WORK_ALREADY_CLAIMED_OR_DEPENDENCY_BOUND';
        this.#discoveries += 1;
      } else if (tasks.length > 0) {
        action = 'DISCOVER_NEXT_OBJECTIVE';
        reason = 'CURRENT_CONTEXT_OBJECTIVES_TERMINAL';
        this.#discoveries += 1;
      } else {
        action = 'DISCOVER_USEFUL_WORK';
        reason = 'NO_TASKS_EXIST';
        this.#discoveries += 1;
      }
    }

    this.#continuationDecisions += 1;
    return Object.freeze({
      schema: BROWSER_BRAIN_AUTONOMY_DECISION_SCHEMA,
      context_id: contextId,
      agent_id: agentId,
      action,
      task_id: taskId,
      reason,
      continue_autonomously: true,
      external_prompt_required: false,
      user_confirmation_required: false,
      idle_wait_allowed: false,
      work_cycle_limit: null,
      scheduler_authority: false,
      execution_authority: false,
      physical_effect_requires_existing_machine_authority_path: true,
      automatic_destructive_retry_allowed: false,
      authority_effect: false,
    });
  }

  snapshot() {
    const now = this.#nowMs();
    const activeClaims = [...this.#claims.values()].filter((row) => row.expiresAtMs > now).length;
    return Object.freeze({
      schema: BROWSER_BRAIN_COLLABORATION_FABRIC_SCHEMA,
      context_count: this.#contexts.size,
      task_count: this.#tasks.size,
      message_count: this.#messages.size,
      artifact_count: this.#artifacts.size,
      active_claim_count: activeClaims,
      handoff_count: this.#handoffs.size,
      message_duplicate_count: this.#messageDuplicates,
      claim_conflict_count: this.#claimConflicts,
      replan_count: this.#replans,
      discovery_count: this.#discoveries,
      continuation_decision_count: this.#continuationDecisions,
      typed_messages: true,
      causal_message_links: true,
      task_ledger: true,
      progress_ledger: true,
      immutable_artifact_refs: true,
      compact_handoff_capsules: true,
      advisory_anti_duplication_claims: true,
      continuous_autonomous_work: true,
      external_confirmation_gate: false,
      external_prompt_required_for_continuation: false,
      idle_wait_allowed: false,
      work_cycle_limit: null,
      bounded_memory: true,
      full_transcript_stored: false,
      message_body_stored: false,
      second_scheduler: false,
      hidden_queue: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      automatic_destructive_retry_allowed: false,
      authority_effect: false,
    });
  }
}
