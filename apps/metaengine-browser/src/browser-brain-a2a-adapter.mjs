import crypto from 'node:crypto';

export const BROWSER_BRAIN_A2A_ADAPTER_SCHEMA = 'metaengine.browser-brain.a2a-boundary-adapter.v1';
const STATE_TO_A2A = Object.freeze({ READY: 'submitted', ACTIVE: 'working', BLOCKED: 'input-required', FAILED: 'failed', COMPLETED: 'completed', CANCELLED: 'canceled' });
const A2A_TO_STATE = Object.freeze({ submitted: 'READY', working: 'ACTIVE', 'input-required': 'BLOCKED', failed: 'FAILED', completed: 'COMPLETED', canceled: 'CANCELLED', cancelled: 'CANCELLED', rejected: 'FAILED' });
function digest(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function asArray(v) { return Array.isArray(v) ? v : []; }

export class BrowserBrainA2AAdapter {
  toA2ATask({ task, messages = [], artifacts = [] } = {}) {
    if (!task?.task_id || !task?.context_id) throw new Error('browser_brain_a2a_task_invalid');
    return Object.freeze({
      id: String(task.task_id),
      contextId: String(task.context_id),
      status: Object.freeze({ state: STATE_TO_A2A[String(task.status || '').toUpperCase()] || 'unknown' }),
      history: Object.freeze(messages.map((message) => this.toA2AMessage(message))),
      artifacts: Object.freeze(artifacts.map((artifact) => this.toA2AArtifact(artifact))),
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
      parts: Object.freeze([{ data: { bodyDigest: message.body_digest, kind: message.kind, artifactRefs: asArray(message.artifact_refs), evidenceRefs: asArray(message.evidence_refs) } }]),
      metadata: Object.freeze({ sourceAgentId: message.source_agent_id || null, causalEpoch: Number(message.causal_epoch || 0), metaengine_untrusted_transport: true, metaengine_authority_effect: false }),
    });
  }
  toA2AArtifact(artifact = {}) {
    if (!artifact.artifact_id) throw new Error('browser_brain_a2a_artifact_invalid');
    return Object.freeze({
      artifactId: String(artifact.artifact_id),
      name: String(artifact.kind || 'metaengine-artifact'),
      parts: Object.freeze([{ data: { contentDigest: artifact.content_digest, refs: asArray(artifact.refs), baseSha: artifact.base_sha || null, branch: artifact.branch || null } }]),
      metadata: Object.freeze({ immutable: true, bodyStored: false, metaengine_authority_effect: false }),
    });
  }
  fromA2AMessage(message = {}, { source_agent_id, source_generation = 1, target = 'topic:a2a-ingress', kind = 'FACT' } = {}) {
    if (!message.messageId) throw new Error('browser_brain_a2a_ingress_message_invalid');
    const material = { role: message.role, parts: asArray(message.parts), metadata: message.metadata || null };
    return Object.freeze({
      message_id: `a2a:${String(message.messageId)}`.slice(0, 192).toLowerCase(),
      context_id: String(message.contextId || 'ctx.a2a-external').toLowerCase(),
      task_id: message.taskId ? String(message.taskId).toLowerCase() : null,
      source_agent_id: String(source_agent_id || 'agent_a2a_external').toLowerCase(),
      source_generation: Number(source_generation) || 1,
      target: String(target).toLowerCase(),
      kind: String(kind).toUpperCase(),
      causal_parent_ids: [], artifact_refs: [], evidence_refs: [], body_digest: digest(material), causal_epoch: 0,
      external_data_untrusted: true,
      execution_authority: false,
      authority_effect: false,
    });
  }
  fromA2ATask(task = {}) {
    if (!task.id) throw new Error('browser_brain_a2a_ingress_task_invalid');
    return Object.freeze({
      context_id: String(task.contextId || `ctx.a2a:${task.id}`).toLowerCase(),
      task_id: `a2a:${String(task.id)}`.slice(0, 192).toLowerCase(),
      objective: `External A2A task ${String(task.id)}`,
      status: A2A_TO_STATE[String(task.status?.state || '').toLowerCase()] || 'READY',
      dependencies: [], required_capabilities: [],
      external_data_untrusted: true,
      scheduler_authority: false, execution_authority: false, authority_effect: false,
    });
  }
  snapshot() { return Object.freeze({ schema: BROWSER_BRAIN_A2A_ADAPTER_SCHEMA, protocol_target: 'A2A_1_0_OBJECT_MODEL', boundary_only: true, internal_runtime_replaced: false, current_scheduler_remains_only_scheduler: true, external_data_grants_authority: false, scheduler_authority: false, execution_authority: false, authority_effect: false }); }
}
