import crypto from 'node:crypto';

const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_ID_RE = /^tab_[a-z0-9-]{8,80}$/;
const TARGET_ID_RE = /^[a-z0-9][a-z0-9:._-]{2,159}$/;

function text(value, name, max = 160) {
  const out = String(value || '').trim();
  if (!out || out.length > max) throw new Error(`federated_${name}_invalid`);
  return out;
}

function epoch(value) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > 1_000_000_000) throw new Error('federated_generation_epoch_invalid');
  return out;
}

export function normalizeFleetAgentId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!AGENT_ID_RE.test(id)) throw new Error('federated_agent_id_invalid');
  return id;
}

export function fleetSupervisorInstanceId(agentId) {
  const id = normalizeFleetAgentId(agentId);
  return `fsup_${crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 24)}`;
}

export function buildFleetSupervisorBinding({ agent_id, role, tab_id, target_id, generation_epoch } = {}) {
  const agentId = normalizeFleetAgentId(agent_id);
  const supervisorId = fleetSupervisorInstanceId(agentId);
  const normalizedRole = text(role, 'role', 64).toUpperCase();
  const tabId = text(tab_id, 'tab_id', 96).toLowerCase();
  const targetId = text(target_id, 'target_id', 160).toLowerCase();
  const generationEpoch = epoch(generation_epoch);
  if (!TAB_ID_RE.test(tabId)) throw new Error('federated_tab_id_invalid');
  if (!TARGET_ID_RE.test(targetId)) throw new Error('federated_target_id_invalid');

  const material = [
    'METAENGINE_FLEET_SUPERVISOR_BINDING_V1',
    `agent_id:${agentId}`,
    `supervisor_instance_id:${supervisorId}`,
    `tab_id:${tabId}`,
    `target_id:${targetId}`,
    `generation_epoch:${generationEpoch}`,
  ].join('\n');

  return Object.freeze({
    schema: 'metaengine.fleet-supervisor-binding.v1',
    agent_id: agentId,
    supervisor_instance_id: supervisorId,
    role: normalizedRole,
    tab_id: tabId,
    target_id: targetId,
    generation_epoch: generationEpoch,
    binding_sha256: crypto.createHash('sha256').update(material, 'utf8').digest('hex'),
    supervisor_capable: true,
    ambient_browser_authority: false,
    browser_effect_path: 'TYPED_INTENT_VIA_SHARED_MESH_EXECUTOR',
    page_data_authority: false,
    authority_effect: false,
  });
}

export function bindingMatchesPhysicalAgent(binding, agent = {}) {
  if (!binding || binding.schema !== 'metaengine.fleet-supervisor-binding.v1') return false;
  try {
    const rebuilt = buildFleetSupervisorBinding({
      agent_id: agent.agent_id,
      role: agent.role,
      tab_id: agent.tab_id,
      target_id: agent.target_id,
      generation_epoch: agent.generation_epoch,
    });
    return rebuilt.supervisor_instance_id === binding.supervisor_instance_id
      && rebuilt.binding_sha256 === binding.binding_sha256
      && rebuilt.agent_id === binding.agent_id
      && rebuilt.tab_id === binding.tab_id
      && rebuilt.target_id === binding.target_id
      && rebuilt.generation_epoch === binding.generation_epoch;
  } catch {
    return false;
  }
}
