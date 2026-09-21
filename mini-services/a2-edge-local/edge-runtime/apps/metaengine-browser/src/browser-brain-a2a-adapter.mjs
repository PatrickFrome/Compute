import crypto from 'node:crypto';

export const BROWSER_BRAIN_A2A_ADAPTER_SCHEMA = 'metaengine.browser-brain.a2a-boundary-adapter.v1';
const STATE_TO_A2A = Object.freeze({ READY: 'submitted', ACTIVE: 'working', BLOCKED: 'input-required', FAILED: 'failed', COMPLETED: 'completed', CANCELLED: 'canceled' });
const A2A_TO_STATE = Object.freeze({ submitted: 'READY', working: 'ACTIVE', 'input-required': 'BLOCKED', failed: 'FAILED', completed: 'COMPLETED', canceled: 'CANCELLED', cancelled: 'CANCELLED', rejected: 'FAILED' });
const MESSAGE_KINDS = new Set(['ASSIGNMENT', 'FACT', 'QUESTION', 'PROPOSAL', 'CRITIQUE', 'RESULT', 'BLOCKER', 'HANDOFF', 'STATE_CHANGED', 'ACK']);
const SAFE_INTERNAL_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;
const MAX_TASK_HISTORY = 256;
const MAX_EXTERNAL_PARTS = 32;
const MAX_EXTERNAL_JSON_BYTES = 65_536;

function sha256Text(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function boundedArray(value, max, code) {
  if (!Array.isArray(value)) throw new Error(code);
  if (value.length > max) throw new Error(code);
  return value;
}
function safeBoundaryId(value, { prefix = 'a2a', fallback = null, preserveSafe = true, code = 'browser_brain_a2a_id_invalid' } = {}) {
  const raw = String(value ?? fallback ?? '').trim();
  if (!raw) throw new Error(code);
  const normalized = raw.toLowerCase();
  if (preserveSafe && SAFE_INTERNAL_ID_RE.test(normalized)) return normalized;
  const prefixed = `${prefix}:${normalized}`;
  if (SAFE_INTERNAL_ID_RE.test(prefixed)) return prefixed;
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'external';
  const candidate = `${prefix}:${slug}:${sha256Text(raw).slice(0, 24)}`;
  if (!SAFE_INTERNAL_ID_RE.test(candidate)) throw new Error(code);
  return candidate;
}
function positiveGeneration(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('browser_brain_a2a_agent_generation_invalid');
  return parsed;
}
function boundedMaterialDigest(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('browser_brain_a2a_ingress_material_invalid');
  }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > MAX_EXTERNAL_JSON_BYTES) {
    throw new Error('browser_brain_a2a_ingress_material_too_large');
  }
  return `sha256:${crypto.createHash('sha256').update(encoded, 'utf8').digest('hex')}`;
}

export class BrowserBrainA2AAdapter {
  toA2ATask({ task, messages = [], artifacts = [] } = {}) {
    if (!task?.task_id || !task?.context_id) throw new Error('browser_brain_a2a_task_invalid');
    const history = boundedArray(messages, MAX_TASK_HISTORY, 'browser_brain_a2a_task_history_invalid');
    const taskArtifacts = boundedArray(artifacts, MAX_TASK_HISTORY, 'browser_brain_a2a_task_artifacts_invalid');
    return Object.freeze({
      id: String(task.task_id),
      contextId: String(task.context_id),
      status: Object.freeze({ state: STATE_TO_A2A[String(task.status || '').toUpperCase()] || 'unknown' }),
      history: Object.freeze(history.map((message) => this.toA2AMessage(message))),
      artifacts: Object.freeze(taskArtifacts.map((artifact) => this.toA2AArtifact(artifact))),
      metadata: Object.freeze({ metaengine_advisory_only: true, metaengine_progress_revision: Number(task.progress_revision || 0), metaengine_authority_effect: false }),
    });
  }
  toA2AMessage(message = {}) {
    if (!message.message_id) throw new Error('browser_brain_a2a_message_invalid');
    return Object.freeze({
      messageId: String(message.message_id),
      contextId: message.context_id ? String(message.context_id) : undefined,
      taskId: message.task_id ? String(message.task_id) : undefined,
      role: 'agent',
      parts: Object.freeze([Object.freeze({ data: Object.freeze({ bodyDigest: message.body_digest, kind: message.kind, artifactRefs: Object.freeze([...(Array.isArray(message.artifact_refs) ? message.artifact_refs : [])]), evidenceRefs: Object.freeze([...(Array.isArray(message.evidence_refs) ? message.evidence_refs : [])]) }) })]),
      metadata: Object.freeze({ sourceAgentId: message.source_agent_id || null, causalEpoch: Number(message.causal_epoch || 0), metaengine_untrusted_transport: true, metaengine_authority_effect: false }),
    });
  }
  toA2AArtifact(artifact = {}) {
    if (!artifact.artifact_id) throw new Error('browser_brain_a2a_artifact_invalid');
    return Object.freeze({
      artifactId: String(artifact.artifact_id),
      name: String(artifact.kind || 'metaengine-artifact'),
      parts: Object.freeze([Object.freeze({ data: Object.freeze({ contentDigest: artifact.content_digest, refs: Object.freeze([...(Array.isArray(artifact.refs) ? artifact.refs : [])]), baseSha: artifact.base_sha || null, branch: artifact.branch || null }) })]),
      metadata: Object.freeze({ immutable: true, bodyStored: false, metaengine_authority_effect: false }),
    });
  }
  fromA2AMessage(message = {}, { source_agent_id, source_generation = 1, target = 'topic:a2a-ingress', kind = 'FACT' } = {}) {
    if (!message.messageId) throw new Error('browser_brain_a2a_ingress_message_invalid');
    const parts = boundedArray(message.parts ?? [], MAX_EXTERNAL_PARTS, 'browser_brain_a2a_ingress_parts_invalid');
    const normalizedKind = String(kind).toUpperCase();
    if (!MESSAGE_KINDS.has(normalizedKind)) throw new Error('browser_brain_a2a_ingress_kind_invalid');
    const material = { role: message.role, parts, metadata: message.metadata || null };
    return Object.freeze({
      message_id: safeBoundaryId(message.messageId, { prefix: 'a2a', preserveSafe: false, code: 'browser_brain_a2a_ingress_message_invalid' }),
      context_id: safeBoundaryId(message.contextId, { prefix: 'ctx.a2a', fallback: 'ctx.a2a-external', code: 'browser_brain_a2a_ingress_context_invalid' }),
      task_id: message.taskId ? safeBoundaryId(message.taskId, { prefix: 'a2a', preserveSafe: false, code: 'browser_brain_a2a_ingress_task_invalid' }) : null,
      source_agent_id: safeBoundaryId(source_agent_id, { prefix: 'agent.a2a', fallback: 'agent_a2a_external', code: 'browser_brain_a2a_ingress_agent_invalid' }),
      source_generation: positiveGeneration(source_generation),
      target: safeBoundaryId(target, { prefix: 'topic.a2a', code: 'browser_brain_a2a_ingress_target_invalid' }),
      kind: normalizedKind,
      causal_parent_ids: [],
      artifact_refs: [],
      evidence_refs: [],
      body_digest: boundedMaterialDigest(material),
      causal_epoch: 0,
      external_data_untrusted: true,
      execution_authority: false,
      authority_effect: false,
    });
  }
  fromA2ATask(task = {}) {
    if (!task.id) throw new Error('browser_brain_a2a_ingress_task_invalid');
    const taskId = safeBoundaryId(task.id, { prefix: 'a2a', preserveSafe: false, code: 'browser_brain_a2a_ingress_task_invalid' });
    return Object.freeze({
      context_id: safeBoundaryId(task.contextId, { prefix: 'ctx.a2a', fallback: `ctx.a2a:${sha256Text(task.id).slice(0, 24)}`, code: 'browser_brain_a2a_ingress_context_invalid' }),
      task_id: taskId,
      objective: `External A2A task ${String(task.id).slice(0, 512)}`,
      status: A2A_TO_STATE[String(task.status?.state || '').toLowerCase()] || 'READY',
      dependencies: [],
      required_capabilities: [],
      external_data_untrusted: true,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_A2A_ADAPTER_SCHEMA,
      protocol_target: 'A2A_1_0_OBJECT_MODEL',
      boundary_only: true,
      bounded_external_payloads: true,
      collision_resistant_external_ids: true,
      internal_runtime_replaced: false,
      current_scheduler_remains_only_scheduler: true,
      external_data_grants_authority: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
