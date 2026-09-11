export const METAENGINE_DEVOS_SYSTEM_ATTENTION_SCHEMA = 'metaengine.devos.system-attention.v1';

const ATTENTION_ORDER = Object.freeze({
  SAFETY_OVERRIDE: 0,
  SUPERVISOR_ERROR: 1,
  SUPERVISOR_MESH_ERROR: 2,
  FLEET_AMBIGUITY: 3,
  FLEET_LOST: 4,
  SELF_UPDATE_HOLD: 5,
  COMPUTE_OFFLINE: 6,
  TASK_FAILED: 7,
  TASK_BLOCKED: 8,
  WORKSPACE_FROZEN: 9,
  WORKSPACE_BINDING_ISSUE: 10,
  FLEET_TRANSPORT_UNVERIFIED: 11,
  DEVELOPMENT_PLANE_DEGRADED: 12,
});

const SELF_UPDATE_HOLD_STATES = new Set(['ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR']);

function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function hasZeroAuthority(value) {
  return value
    && value.projection_is_authority === false
    && value.scheduler_authority === false
    && value.execution_authority === false
    && value.command_leasing === false
    && value.automatic_effect_retry_allowed === false
    && value.page_model_authority === false
    && value.authority_effect === false;
}

function text(value, max = 600) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function boundedCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(1_000_000, Math.floor(parsed));
}

function sourceUsable(value) {
  return value && typeof value === 'object' && value.authority_effect !== true;
}

function validDevOS(devos) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || !hasZeroAuthority(devos)
    || !Array.isArray(devos.attention)
    || !devos.navigation
    || devos.navigation.schema !== 'metaengine.devos.navigation.v1'
    || !hasZeroAuthority(devos.navigation)
    || !Array.isArray(devos.navigation.roots)) return false;
  return devos.attention.every((row) => hasZeroAuthority(row))
    && devos.navigation.roots.every((row) => hasZeroAuthority(row));
}

function attentionRow({ kind, severity, priority, title, reason, target }) {
  return Object.freeze({
    kind,
    severity,
    priority,
    session_id: null,
    task_id: null,
    title: text(title, 600) || kind,
    reason: text(reason, 800) || kind,
    target: text(target, 64),
    source: 'TRUSTED_SHELL_SYSTEM_STATE',
    automatic_remediation: false,
    ...zeroAuthorityContract(),
  });
}

function runtimeRows(runtime = {}) {
  const rows = [];
  const fleet = sourceUsable(runtime.fleet) ? runtime.fleet : null;
  const counts = fleet?.counts && typeof fleet.counts === 'object' ? fleet.counts : {};
  const ambiguous = boundedCount(counts.PROVISIONING_AMBIGUOUS);
  const lost = boundedCount(counts.LOST);
  const bound = boundedCount(counts.BOUND_UNVERIFIED);
  if (ambiguous > 0) rows.push(attentionRow({
    kind: 'FLEET_AMBIGUITY', severity: 'ERROR', priority: 'CRITICAL', target: 'fleet',
    title: 'Fleet ambiguity', reason: `${ambiguous} provisioning ambiguous`,
  }));
  if (lost > 0) rows.push(attentionRow({
    kind: 'FLEET_LOST', severity: 'ERROR', priority: 'HIGH', target: 'fleet',
    title: 'Lost fleet agents', reason: `${lost} lost`,
  }));
  if (bound > 0) rows.push(attentionRow({
    kind: 'FLEET_TRANSPORT_UNVERIFIED', severity: 'WARNING', priority: 'MEDIUM', target: 'fleet',
    title: 'Transport proof pending', reason: `${bound} bound unverified`,
  }));

  const workspaces = sourceUsable(runtime.workspaces) ? runtime.workspaces : null;
  const frozen = Array.isArray(workspaces?.groups)
    ? workspaces.groups.filter((row) => String(row?.state || '').toUpperCase() === 'FROZEN').length
    : 0;
  if (frozen > 0) rows.push(attentionRow({
    kind: 'WORKSPACE_FROZEN', severity: 'ERROR', priority: 'HIGH', target: 'workspaces',
    title: 'Frozen workspaces', reason: `${frozen} frozen`,
  }));

  const supervisor = sourceUsable(runtime.supervisor) ? runtime.supervisor : null;
  const meshError = text(supervisor?.supervisor_mesh?.last_error, 800);
  if (meshError) rows.push(attentionRow({
    kind: 'SUPERVISOR_MESH_ERROR', severity: 'ERROR', priority: 'CRITICAL', target: 'supervisor',
    title: 'Supervisor mesh degraded', reason: meshError,
  }));
  const updater = sourceUsable(supervisor?.self_update) ? supervisor.self_update : null;
  const updateState = String(updater?.state || '').trim().toUpperCase();
  if (SELF_UPDATE_HOLD_STATES.has(updateState)) rows.push(attentionRow({
    kind: 'SELF_UPDATE_HOLD', severity: 'ERROR', priority: 'HIGH', target: 'runtime',
    title: 'Self-update hold', reason: text(updater?.last_error, 800) || updateState,
  }));

  const developmentPlane = sourceUsable(runtime.development_plane) ? runtime.development_plane : null;
  const developmentState = String(developmentPlane?.state || '').trim().toUpperCase();
  if (developmentPlane && developmentState && developmentState !== 'READY') rows.push(attentionRow({
    kind: 'DEVELOPMENT_PLANE_DEGRADED', severity: 'WARNING', priority: 'MEDIUM', target: 'runtime',
    title: 'Development Plane not ready', reason: developmentState,
  }));

  const compute = sourceUsable(runtime.compute) ? runtime.compute : null;
  if (compute && compute.available !== true) rows.push(attentionRow({
    kind: 'COMPUTE_OFFLINE', severity: 'ERROR', priority: 'HIGH', target: 'runtime',
    title: 'Compute offline', reason: 'Compute health reports unavailable',
  }));
  return rows;
}

function attentionKey(row) {
  return [row?.kind, row?.session_id, row?.task_id, row?.reason].map((value) => String(value ?? '')).join('\u001f');
}

function sortedAttention(rows) {
  return Object.freeze([...rows].sort((a, b) => (ATTENTION_ORDER[a.kind] ?? 99) - (ATTENTION_ORDER[b.kind] ?? 99)
    || String(a.session_id || '').localeCompare(String(b.session_id || ''))
    || String(a.task_id || '').localeCompare(String(b.task_id || ''))
    || String(a.reason || '').localeCompare(String(b.reason || ''))));
}

function updatedNavigation(navigation, attention) {
  const systemCount = attention.filter((row) => !row.session_id).length;
  const roots = navigation.roots.map((root) => {
    if (root.root_id === 'NOW') return Object.freeze({ ...root, count: attention.length, state: attention.length ? 'ATTENTION' : 'CLEAR' });
    if (root.root_id === 'SYSTEM') return Object.freeze({ ...root, count: systemCount, state: systemCount ? 'ATTENTION' : 'CLEAR' });
    return root;
  });
  return Object.freeze({ ...navigation, roots: Object.freeze(roots) });
}

export function attachDevOSSystemAttention(devos, runtime = {}) {
  if (!validDevOS(devos)) return devos;
  const emitted = runtimeRows(runtime);
  const seen = new Set(devos.attention.map(attentionKey));
  const additions = emitted.filter((row) => {
    const key = attentionKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const attention = sortedAttention([...devos.attention, ...additions]);
  return Object.freeze({
    ...devos,
    attention,
    navigation: updatedNavigation(devos.navigation, attention),
    system_attention: Object.freeze({
      schema: METAENGINE_DEVOS_SYSTEM_ATTENTION_SCHEMA,
      emitted_count: additions.length,
      total_system_attention: attention.filter((row) => !row.session_id).length,
      trusted_shell_projection: true,
      renderer_reconstruction_required: false,
      automatic_remediation: false,
      second_polling_loop: false,
      ...zeroAuthorityContract(),
    }),
  });
}
