import { createHash } from 'node:crypto';
import { AGENT_PLATFORM_HOME_URL, classifyAgentPlatformSurface, normalizeAgentPlatformConversationUrl } from './browser-agent-platform.mjs';

const boundedId = (value, required = false) => {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(value)) throw new Error('keepalive_transport_identity_invalid');
  return value;
};

// This record is recovery evidence, never proof that a message was sent.
export function buildSupervisorWakeTransportIntent({ pending, processIncarnationId, phase, tab_id, frame, message, recorded_at } = {}) {
  if (!pending || !/^wake_[a-z0-9-]+$/i.test(pending.wake_id || '')
    || pending.process_incarnation_id !== processIncarnationId
    || !['ROOT_SEED', 'WAKE'].includes(phase) || !frame || typeof frame !== 'object'
    || (frame.tab_id != null && frame.tab_id !== tab_id)
    || typeof message !== 'string' || !message || Buffer.byteLength(message) > 65536
    || !Number.isFinite(Date.parse(recorded_at))) throw new Error('keepalive_transport_intent_invalid');
  let url;
  try { url = new URL(frame.url); } catch { throw new Error('keepalive_transport_surface_invalid'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('keepalive_transport_surface_invalid');
  const surface = classifyAgentPlatformSurface(url.href);
  const conversation = surface?.stage === 'CONVERSATION' ? normalizeAgentPlatformConversationUrl(url.href) : null;
  const root = surface?.stage === 'PRECONVERSATION_ROOT';
  if ((phase === 'ROOT_SEED' && !root) || (phase === 'WAKE' && !conversation)) throw new Error('keepalive_transport_surface_invalid');
  return Object.freeze({
    schema: 'metaengine.supervisor-wake.transport-intent.v1',
    wake_id: pending.wake_id, supervisor_epoch: pending.supervisor_epoch, cycle_seq: pending.cycle_seq,
    phase, tab_id: boundedId(tab_id, true), process_incarnation_id: boundedId(processIncarnationId, true),
    surface_url: conversation || AGENT_PLATFORM_HOME_URL, conversation_url: conversation,
    target_id: boundedId(frame.target_id), runtime_observation_id: boundedId(frame.runtime_observation_id),
    state_revision_id: boundedId(frame.state_revision_id),
    message_sha256: createHash('sha256').update(message, 'utf8').digest('hex'),
    recorded_at, automatic_retry_allowed: false, authority_effect: false,
  });
}
