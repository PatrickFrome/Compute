// Chat delivery admits commands into the existing PostgreSQL queue. It never
// executes a command, accepts a caller-supplied lease or creates another scheduler.
export const CHAT_COMMAND_SCHEMA = 'metaengine.chat-command-admission.v1';
export const CHAT_COMMAND_ACTIONS = Object.freeze([
  'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES','PROCESS_CENSUS','PROCESS_EVENTS',
  'SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS','TAB_TELEMETRY','SYSTEM_TELEMETRY',
  'READ_TRANSCRIPT','TAB_CENSUS','FLEET_STATUS','DOWNLOAD_STATUS','DEV_PLANE_STATUS','DEV_PLANE_HEALTH',
  'DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD','SELF_UPDATE_STATUS',
  'COMPUTER_STATUS','COMPUTER_OBSERVE','COMPUTER_ACTION','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS',
  'SEMANTIC_TYPE','TYPED_CLICK','SELECT_TAB','PRESS_KEY','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
  'NEW_TAB','FLEET_RECONCILE','FLEET_SET_PROFILE','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
  'SELF_UPDATE_CHECK','SELF_UPDATE_APPLY',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const agent = /^agent_[a-z0-9-]{8,64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeChatCommand(body) {
  const fields = ['request_id','relay_id','operator_user_id','action','payload'];
  if (!object(body) || Object.keys(body).length !== fields.length || fields.some(key=>!Object.hasOwn(body,key))
      || !uuid.test(body.request_id || '') || !uuid.test(body.relay_id || '')
      || !Number.isSafeInteger(body.operator_user_id) || body.operator_user_id <= 0
      || !CHAT_COMMAND_ACTIONS.includes(body.action) || !object(body.payload)
      || new TextEncoder().encode(JSON.stringify(body.payload)).length > 120_000
      || ['chat_relay','effect_binding','lease','context','command_id'].some(key=>Object.hasOwn(body.payload,key))) {
    throw new Error('chat_command_invalid');
  }
  if (body.action === 'COMPUTER_ACTION' && !agent.test(body.payload.agent_id || '')) {
    throw new Error('chat_command_agent_required');
  }
  // Existing RPCs require empty payloads for these operations. The issuer
  // attribution carries the relay identity; do not alter their payload shape.
  const payload = structuredClone(body.payload);
  return Object.freeze({ ...body,payload, idempotency_key:`chat:${body.relay_id}:${body.request_id}`,
    issued_by:`github-chat:${body.relay_id}:${body.operator_user_id}` });
}

