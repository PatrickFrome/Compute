export const CLIENT_GOAL_SCHEMA = 'metaengine.client.goal-submission.v1';
export const CLIENT_AGENT_SELECTION_SCHEMA = 'metaengine.client.agent-selection.v1';
export const CLIENT_GOAL_MAX_CHARS = 480;

const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;
const ZERO_AUTHORITY_KEYS = ['automatic_retry_allowed', 'scheduler_authority', 'browser_authority', 'release_authority', 'authority_effect'];

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const zeroAuthority = (value) => object(value) && ZERO_AUTHORITY_KEYS.every((key) => value[key] === false);

function boundedGoal(value) {
  if (typeof value !== 'string') throw new Error('client_goal_invalid');
  const goal = value.trim();
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
    || row.objective !== goal
    || row.roadmap_id !== 'metaengine-client-v1'
    || !positiveInteger(row.plan_generation)
    || !Array.isArray(row.point_ids)
    || row.point_ids.length !== 1
    || row.node_count !== 1
    || !Array.isArray(row.task_ids)
    || row.task_ids.length !== 1
    || row.task_admission_state !== 'ADMITTED'
    || row.atomic_plan_and_admission !== true
    || row.operator_initiated !== true
    || row.automatic_retry_allowed !== false
    || row.scheduler_authority !== false
    || row.browser_authority !== false
    || row.release_authority !== false
    || row.authority_effect !== false
  ) throw new Error('client_goal_activation_readback_invalid');

  const pointIds = row.point_ids;
  if (pointIds.some((point) => typeof point !== 'string' || !POINT_RE.test(point))) throw new Error('client_goal_point_readback_invalid');
  const taskIds = row.task_ids;
  if (taskIds.some((taskId) => typeof taskId !== 'string' || !UUID_RE.test(taskId))) {
    throw new Error('client_goal_task_readback_invalid');
  }
  const activation = object(row.activation);
  const admission = object(row.admission);
  if (
    !activation || !admission
    || activation.schema !== 'metaengine.meta-orchestrator.plan-state.v1'
    || activation.state !== 'ACTIVE'
    || !zeroAuthority(activation) || !zeroAuthority(admission)
    || typeof activation.workspace_id !== 'string' || !UUID_RE.test(activation.workspace_id)
    || admission.workspace_id !== activation.workspace_id
    || activation.roadmap_id !== row.roadmap_id || admission.roadmap_id !== row.roadmap_id
    || activation.plan_generation !== row.plan_generation || admission.plan_generation !== row.plan_generation
    || !positiveInteger(activation.alignment_epoch) || admission.alignment_epoch !== activation.alignment_epoch
    || typeof activation.baseline_sha !== 'string' || !/^[0-9a-f]{40}$/.test(activation.baseline_sha)
    || typeof activation.plan_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(activation.plan_sha256)
    || typeof admission.task_spec_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(admission.task_spec_sha256)
    || admission.schema !== 'metaengine.meta-orchestrator.task-admission.v1'
    || admission.task_id !== taskIds[0] || admission.point_id !== pointIds[0]
    || admission.task_content_authority !== false
    || admission.task_payload_returned !== false || admission.scheduler_identity_returned !== false
  ) throw new Error('client_goal_admission_binding_invalid');

  const planGeneration = row.plan_generation;
  return Object.freeze({
    schema: CLIENT_GOAL_SCHEMA,
    goal,
    objective_id: `${row.roadmap_id}:g${planGeneration}`,
    roadmap_id: row.roadmap_id,
    workspace_id: activation.workspace_id,
    alignment_epoch: activation.alignment_epoch,
    baseline_sha: activation.baseline_sha,
    plan_sha256: activation.plan_sha256,
    task_spec_sha256: admission.task_spec_sha256,
    plan_generation: planGeneration,
    point_ids: Object.freeze([...pointIds]),
    node_count: pointIds.length,
    task_id: taskIds[0],
    task_ids: Object.freeze([...taskIds]),
    task_admission_state: 'ADMITTED',
    atomic_plan_and_admission: true,
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
