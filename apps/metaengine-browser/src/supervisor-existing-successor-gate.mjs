import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_URLS = new Set(['https://chatgpt.com/', 'https://www.chatgpt.com/']);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function uniqueActiveStandby(row, currentConversation) {
  if (!row || row.status !== 'ACTIVE' || row.supervisor_capable === false) return false;
  if (row.fleet_bound === true || row.coordination_blocked === true) return false;
  if (!row.tab_id || !row.conversation_url || row.conversation_url === currentConversation) return false;
  if (row.pending_delivery || row.ambiguous_delivery) return false;
  const incarnations = Array.isArray(row.tab_incarnations) ? [...new Set(row.tab_incarnations.map(String))] : [];
  return incarnations.length === 1 && incarnations[0] === String(row.tab_id);
}

export function existingSupervisorRolloverProof({ keepalive, mesh } = {}) {
  const attempt = keepalive?.rollover_attempt;
  const state = String(keepalive?.state || '');
  if (state !== 'ROLLOVER_PENDING' || !attempt?.attempt_id) {
    return { suppress_new_tab: false, reason: 'NO_PENDING_ROLLOVER', authority_effect: false };
  }
  const currentConversation = String(attempt.previous_conversation || keepalive?.conversation_url || '');
  if (!currentConversation || String(keepalive?.conversation_url || '') !== currentConversation) {
    return { suppress_new_tab: false, reason: 'ROLLOVER_PRIMARY_BINDING_MISMATCH', authority_effect: false };
  }
  if (!mesh || !['metaengine.supervisor-mesh.state.v1','metaengine.supervisor-mesh.state.v2'].includes(String(mesh.schema || ''))) {
    return { suppress_new_tab: false, reason: 'MESH_STATE_UNAVAILABLE', authority_effect: false };
  }
  const candidates = (Array.isArray(mesh.supervisors) ? mesh.supervisors : [])
    .filter((row) => uniqueActiveStandby(row, currentConversation));
  if (candidates.length === 0) {
    return { suppress_new_tab: false, reason: 'NO_UNIQUE_ACTIVE_STANDBY', authority_effect: false };
  }
  return {
    suppress_new_tab: true,
    reason: 'MESH_EXISTING_SUCCESSOR_AVAILABLE',
    rollover_attempt_id: String(attempt.attempt_id),
    supervisor_epoch: Number(keepalive?.supervisor_epoch || 0),
    existing_successor_count: candidates.length,
    candidate_supervisor_ids: candidates.map((row) => String(row.supervisor_id || '')).filter(Boolean).sort(),
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

async function defaultLoadProof() {
  const { app } = await import('electron');
  const userData = app.getPath('userData');
  const [keepalive, mesh] = await Promise.all([
    readJson(path.join(userData, 'metaengine-supervisor-keepalive-v1.json')),
    readJson(path.join(userData, 'metaengine-supervisor-mesh-v2.json')),
  ]);
  return existingSupervisorRolloverProof({ keepalive, mesh });
}

export function createExistingSupervisorRolloverGate({ executeCommand, loadProof = defaultLoadProof } = {}) {
  if (typeof executeCommand !== 'function' || typeof loadProof !== 'function') throw new Error('existing_successor_gate_dependencies_required');
  return async function executeWithExistingSuccessorGate(command) {
    const internalRolloverNewTab = !command?.command_id
      && String(command?.action || '') === 'NEW_TAB'
      && ROOT_URLS.has(String(command?.payload?.url || ''))
      && command?.payload?.select === false;
    if (!internalRolloverNewTab) return executeCommand(command);

    let proof = null;
    try { proof = await loadProof(); }
    catch { return executeCommand(command); }
    if (proof?.suppress_new_tab !== true) return executeCommand(command);

    return Object.freeze({
      schema: 'metaengine.supervisor-existing-successor-gate.v1',
      suppressed: true,
      reason: proof.reason,
      rollover_attempt_id: proof.rollover_attempt_id,
      supervisor_epoch: proof.supervisor_epoch,
      existing_successor_count: proof.existing_successor_count,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  };
}
