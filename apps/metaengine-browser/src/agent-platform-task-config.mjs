import { classifyAgentPlatformSurface } from './browser-agent-platform.mjs';

// Agent-platform task configuration contract — z.ai Agent-surface provisioning.
//
// R97 live correction (2026-09-28): the ordinary signed-in root is the Chat
// surface and MUST NOT be treated as an Agent task surface. The Agent product
// is SPA state on the same https://chat.z.ai/ URL and direct /agent navigation
// fails. Therefore URL/title are insufficient authority: Agent readiness is
// proven from exact semantic controls (Agent + New Task + template/model
// evidence). New Task configuration remains separately gated until its own
// post-activation controls are physically observed.
//
// Operator note (2026-09-19, live): NEW AGENTS DO NOT SEE ALL DATABASES
// RIGHT AWAY — the database list of a freshly created task populates
// asynchronously. Every provisioning step that needs a specific database
// must therefore POLL for its visibility instead of assuming the first
// observed list is complete. waitForAgentPlatformDatabaseVisibility is that
// bounded poll; it never mutates anything and fails closed with the exact
// missing set.

export const AGENT_PLATFORM_TASK_CONFIG_SCHEMA = 'metaengine.browser.agent-platform.task-config.v1';

export const AGENT_HOME_CONTROLS = Object.freeze({
  agent_nav: Object.freeze({ role: 'button', name: 'Agent' }),
  new_task: Object.freeze({ role: 'button', name: 'New Task' }),
  model_selector: Object.freeze({ role: 'button', name: 'Select a model' }),
  full_stack_template: Object.freeze({ role: 'button', name: 'Full-Stack' }),
});

function exactNamedTarget(frame, { role, name }) {
  const rows = (Array.isArray(frame?.semantic_targets) ? frame.semantic_targets : [])
    .filter((row) => String(row?.role || '').toLowerCase() === String(role || '').toLowerCase()
      && String(row?.name || '') === String(name || ''));
  return rows.length === 1 ? rows[0] : null;
}

export function classifyAgentPlatformTaskSurface(frame) {
  const transport = classifyAgentPlatformSurface(frame?.url);
  if (!transport) return Object.freeze({ stage: 'NOT_AGENT_PLATFORM', proven: false, authority_effect: false });
  if (transport.stage === 'CONVERSATION') {
    // A /c/<id> URL is shared by ordinary Chat and Agent-created sessions.
    // URL reachability alone therefore carries ZERO Agent-origin authority.
    // Admission must come from the durable fleet transport proof that binds
    // the conversation to a previously proven AGENT_HOME capture.
    return Object.freeze({
      stage: 'CONVERSATION_ORIGIN_UNPROVEN',
      proven: false,
      url_only_authority: false,
      requires_durable_agent_origin_proof: true,
      authority_effect: false,
    });
  }
  if (transport.stage !== 'PRECONVERSATION_ROOT') {
    return Object.freeze({ stage: 'OTHER', proven: false, authority_effect: false });
  }

  const agentNav = exactNamedTarget(frame, AGENT_HOME_CONTROLS.agent_nav);
  const newTask = exactNamedTarget(frame, AGENT_HOME_CONTROLS.new_task);
  const fullStack = exactNamedTarget(frame, AGENT_HOME_CONTROLS.full_stack_template);
  const modelSelector = exactNamedTarget(frame, AGENT_HOME_CONTROLS.model_selector);
  const agentHome = Boolean(agentNav && newTask && fullStack && modelSelector);

  return Object.freeze({
    stage: agentHome ? 'AGENT_HOME' : 'CHAT_ROOT',
    proven: agentHome,
    controls: Object.freeze({
      agent_nav: agentNav ? structuredClone(agentNav) : null,
      new_task: newTask ? structuredClone(newTask) : null,
      model_selector: modelSelector ? structuredClone(modelSelector) : null,
      full_stack_template: fullStack ? structuredClone(fullStack) : null,
    }),
    url_only_authority: false,
    authority_effect: false,
  });
}

export function resolveAgentHomeControls(frame) {
  const surface = classifyAgentPlatformTaskSurface(frame);
  if (surface.stage !== 'AGENT_HOME' || surface.proven !== true) {
    return Object.freeze({
      schema: 'metaengine.browser.agent-platform.agent-home-controls.v1',
      ready: false,
      stage: surface.stage,
      controls: surface.controls || null,
      authority_effect: false,
    });
  }
  return Object.freeze({
    schema: 'metaengine.browser.agent-platform.agent-home-controls.v1',
    ready: true,
    stage: 'AGENT_HOME',
    controls: surface.controls,
    authority_effect: false,
  });
}

// Named-control contract for the New Task configuration surface. Unnamed
// controls are NOT addressable through this contract — they need a fresh
// capture and its semantic_ref (the platform's only stable addressing key).
export const TASK_CONFIG_CONTROLS = Object.freeze({
  full_stack_toggle: Object.freeze({
    role: 'switch',
    name: 'Full-Stack',
    address: 'ROLE_NAME_OR_SEMANTIC_REF',
    expected_state_for_fleet_agents: true,
  }),
  long_running_toggle: Object.freeze({
    role: 'switch',
    name: 'Long-running Tasks',
    address: 'ROLE_NAME_OR_SEMANTIC_REF',
    expected_state_for_fleet_agents: true,
  }),
  database_section: Object.freeze({
    role: 'button',
    name: 'Databases',
    address: 'ROLE_NAME_OR_SEMANTIC_REF',
    opens: 'DATABASE_ATTACHMENT_LIST',
  }),
});

const CONTROL_NAMES = new Map(Object.entries(TASK_CONFIG_CONTROLS)
  .map(([key, control]) => [key, String(control.name || '').toLowerCase()]));

function normalizedNames(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row || '').trim().toLowerCase())
    .filter(Boolean));
}

// Resolve the task-configuration controls from a capture frame. Returns a
// frozen projection of which contract controls are present and addressable
// on the captured surface; a control absent from the frame is simply not
// addressable (never an error — the dialog may not be open).
export function resolveTaskConfigControls(frame) {
  const rows = Array.isArray(frame?.semantic_targets) ? frame.semantic_targets : [];
  const byName = new Map();
  for (const row of rows) {
    const name = String(row?.name || '').trim().toLowerCase();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);
  }
  const controls = {};
  for (const [key, name] of CONTROL_NAMES) {
    const matches = byName.get(name) || [];
    const exact = matches.filter((row) => String(row?.role || '').toLowerCase() === TASK_CONFIG_CONTROLS[key].role);
    controls[key] = Object.freeze({
      expected: TASK_CONFIG_CONTROLS[key],
      present: exact.length === 1,
      ambiguous: exact.length > 1,
      role: exact.length === 1 ? exact[0].role : null,
      name: exact.length === 1 ? exact[0].name : null,
      semantic_ref: exact.length === 1 ? (exact[0].semantic_ref || null) : null,
      backend_node_id: exact.length === 1 ? Number(exact[0].backend_node_id || 0) || null : null,
    });
  }
  return Object.freeze({
    schema: AGENT_PLATFORM_TASK_CONFIG_SCHEMA,
    frame_url: String(frame?.url || '').slice(0, 1200) || null,
    controls: Object.freeze(controls),
    authority_effect: false,
  });
}

// Bounded wait for database visibility on a freshly created task surface.
//
// listDatabases  async () => string[] | null — snapshot adapter of the
//                database names currently visible to the task; null/throw
//                means "not readable yet" and keeps polling.
// required       database names the provisioning step needs before it may
//                proceed (case-insensitive, trimmed).
// deadlineMs     hard bound on the whole wait (default 30s).
// intervalMs     poll interval (default 1s, min 100ms).
//
// Returns { complete, visible, missing, attempts, waited_ms, first_visible_at }.
// complete === true when every required database is visible. The wait never
// mutates the surface and never retries a mutation — it is a perception-only
// poll, so automatic_retry_allowed stays false.
export async function waitForAgentPlatformDatabaseVisibility({
  listDatabases,
  required = [],
  deadlineMs = 30000,
  intervalMs = 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  if (typeof listDatabases !== 'function') throw new Error('task_config_database_list_adapter_required');
  const needed = normalizedNames(required);
  const boundedDeadline = Math.max(1000, Number(deadlineMs) || 30000);
  const boundedInterval = Math.max(100, Number(intervalMs) || 1000);
  const startedAt = now();
  let attempts = 0;
  let lastVisible = new Set();
  let firstVisibleAt = null;
  while (true) {
    attempts += 1;
    let snapshot = null;
    try {
      const observed = await listDatabases();
      if (Array.isArray(observed)) snapshot = normalizedNames(observed);
    } catch {
      snapshot = null;
    }
    if (snapshot) {
      lastVisible = snapshot;
      if (firstVisibleAt == null && snapshot.size > 0) firstVisibleAt = now();
      const missing = [...needed].filter((name) => !snapshot.has(name));
      if (missing.length === 0) {
        return Object.freeze({
          complete: true,
          visible: [...snapshot].sort(),
          missing: [],
          attempts,
          waited_ms: now() - startedAt,
          first_visible_at: firstVisibleAt,
          automatic_retry_allowed: false,
          authority_effect: false,
        });
      }
    }
    const elapsed = now() - startedAt;
    if (elapsed + boundedInterval >= boundedDeadline) {
      return Object.freeze({
        complete: false,
        visible: [...lastVisible].sort(),
        missing: [...needed].filter((name) => !lastVisible.has(name)),
        attempts,
        waited_ms: now() - startedAt,
        first_visible_at: firstVisibleAt,
        timed_out: true,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    await sleep(boundedInterval);
  }
}

export function agentPlatformTaskConfigSnapshot() {
  return Object.freeze({
    schema: AGENT_PLATFORM_TASK_CONFIG_SCHEMA,
    platform: 'GLM_ZAI',
    task_creation_surface: 'AGENT_HOME_NEW_TASK_FLOW',
    ordinary_root_is_task_surface: false,
    conversation_url_is_agent_surface_authority: false,
    conversation_origin_requires_durable_agent_surface_proof: true,
    agent_home_proof: 'EXACT_AGENT_NEW_TASK_MODEL_FULL_STACK_CONTROLS',
    agent_home_controls: AGENT_HOME_CONTROLS,
    task_config_surface_state: 'NOT_VERIFIED_UNTIL_NEW_TASK_POSTCONDITION',
    composer_ignores_synthetic_editing_keys: null,
    composer_enter_submits: null,
    replace_gesture_root_surface: null,
    database_visibility: 'ASYNC_POPULATED_BOUNDED_WAIT_REQUIRED',
    controls: TASK_CONFIG_CONTROLS,
    authority_effect: false,
  });
}
