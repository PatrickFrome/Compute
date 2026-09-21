// Agent-platform task configuration contract — the New Task provisioning
// surface model for the GLM agent platform (chat.z.ai).
//
// Operator directive (2026-09-19): browser agents are created through the
// New Task flow with the Full-Stack and Long-running Tasks options enabled
// (model GLM-5.3 full is selected by the operator and persisted by the
// site). Live recon (2026-09-19) established:
//   - the signed-in root surface IS the agent task surface (composer
//     "What can I build you?"/"How can I help you today?", suggestion
//     cards, Deep Think / Max chips);
//   - the agent-task composer IGNORES synthetic editing keys but honors
//     Enter for submit (see the D-M3 click-select replace gesture);
//   - the exact accessible names of the Full-Stack / Long-running toggles
//     and the database attachment section are finalized from a post-deploy
//     recon of the task creation dialog (the deployed browser build was too
//     old to explore the dialog reliably).
//
// Operator note (2026-09-19, live): NEW AGENTS DO NOT SEE ALL DATABASES
// RIGHT AWAY — the database list of a freshly created task populates
// asynchronously. Every provisioning step that needs a specific database
// must therefore POLL for its visibility instead of assuming the first
// observed list is complete. waitForAgentPlatformDatabaseVisibility is that
// bounded poll; it never mutates anything and fails closed with the exact
// missing set.

export const AGENT_PLATFORM_TASK_CONFIG_SCHEMA = 'metaengine.browser.agent-platform.task-config.v1';

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
    task_creation_surface: 'PRECONVERSATION_ROOT',
    // R-DRAFT-FOCUS (live 2026-09-21): the composer honors CDP key events when
    // the element is FOCUSED (Ctrl+A+Delete select-all+clear proven live on a
    // 48286-char draft) — the historical "ignores synthetic keys" observation
    // was unfocused keys landing on <body>. KEY_ATOMIC (focus → Ctrl+A →
    // Delete → insertText) is the root replace gesture; triple-click only
    // selects one line on the current editor.
    composer_ignores_synthetic_editing_keys: false,
    composer_enter_submits: true,
    replace_gesture_root_surface: 'KEY_ATOMIC',
    database_visibility: 'ASYNC_POPULATED_BOUNDED_WAIT_REQUIRED',
    controls: TASK_CONFIG_CONTROLS,
    authority_effect: false,
  });
}
