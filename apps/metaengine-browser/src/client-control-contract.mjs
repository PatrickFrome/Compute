export const CLIENT_GOAL_SCHEMA = 'metaengine.client.goal-submission.v1';
export const CLIENT_AGENT_SELECTION_SCHEMA = 'metaengine.client.agent-selection.v1';
export const CLIENT_GOAL_MAX_CHARS = 480;

const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;

function boundedGoal(value) {
  const goal = String(value ?? '').trim();
  if (!goal || goal.length > CLIENT_GOAL_MAX_CHARS) throw new Error('client_goal_invalid');
  return goal;
}

export function normalizeClientGoalIntent(input) {
  const value = typeof input === 'string' ? input : input?.goal;
  const goal = boundedGoal(value);
  return Object.freeze({
    schema: 'metaengine.client.goal-intent.v1',
    goal,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function normalizeClientGoalActivationReadback(value, expectedGoal) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const goal = boundedGoal(expectedGoal);
  if (
    !row
    || row.schema !== 'metaengine.meta-orchestrator.objective-activation.v1'
    || String(row.objective || '') !== goal
    || typeof row.roadmap_id !== 'string'
    || !row.roadmap_id
    || !Number.isSafeInteger(Number(row.plan_generation))
    || Number(row.plan_generation) < 1
    || !Array.isArray(row.point_ids)
    || row.point_ids.length < 1
    || row.point_ids.length > 32
    || Number(row.node_count) !== row.point_ids.length
    || row.operator_initiated !== true
    || row.automatic_retry_allowed !== false
    || row.scheduler_authority !== false
    || row.browser_authority !== false
    || row.release_authority !== false
    || row.authority_effect !== false
  ) throw new Error('client_goal_activation_readback_invalid');

  const pointIds = row.point_ids.map((point) => String(point || '').trim());
  if (pointIds.some((point) => !point || point.length > 192)) throw new Error('client_goal_point_readback_invalid');

  const planGeneration = Number(row.plan_generation);
  return Object.freeze({
    schema: CLIENT_GOAL_SCHEMA,
    goal,
    objective_id: `${row.roadmap_id}:g${planGeneration}`,
    roadmap_id: row.roadmap_id,
    plan_generation: planGeneration,
    point_ids: Object.freeze(pointIds),
    node_count: pointIds.length,
    task_admission_state: 'PENDING_CANONICAL_SCHEDULER_ADMISSION',
    exact_activation_readback: true,
    operator_initiated: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

export function normalizeClientAgentId(value) {
  const agentId = String(value ?? '').trim().toLowerCase();
  if (!AGENT_ID_RE.test(agentId)) throw new Error('client_agent_id_invalid');
  return agentId;
}

export function normalizeClientAgentSelectionReadback(value, expectedAgentId) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const agentId = normalizeClientAgentId(expectedAgentId);
  if (
    !row
    || row.schema !== 'metaengine.browser.primary-chat-actor-selection.v1'
    || row.actor_id !== `agent:${agentId}`
    || row.actor_type !== 'AGENT'
    || row.selection_applied !== true
    || row.exact_native_binding !== true
    || row.presentation_only !== true
    || row.renderer_routing_authority !== false
    || row.browser_command_authority !== false
    || row.scheduler_authority !== false
    || row.update_authority !== false
    || row.authority_effect !== false
  ) throw new Error('client_agent_selection_readback_invalid');

  return Object.freeze({
    schema: CLIENT_AGENT_SELECTION_SCHEMA,
    agent_id: agentId,
    actor_id: row.actor_id,
    tab_id: String(row.tab_id || ''),
    selection_applied: true,
    exact_native_binding: true,
    presentation_only: true,
    scheduler_authority: false,
    browser_actuation_authority: false,
    update_authority: false,
    authority_effect: false,
  });
}
