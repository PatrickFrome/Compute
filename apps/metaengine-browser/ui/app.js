const api = window.metaengineShell;
const body = document.body;
const address = document.getElementById('address');
const routeKind = document.getElementById('routeKind');
const versionEl = document.getElementById('version');
const activeKind = document.getElementById('activeKind');
const activeTitle = document.getElementById('activeTitle');
const activeMeta = document.getElementById('activeMeta');
const verticalTabs = document.getElementById('verticalTabs');
const tabCount = document.getElementById('tabCount');
const tabSearch = document.getElementById('tabSearch');
const fleetProfile = document.getElementById('fleetProfile');
const railGeometry = document.getElementById('railGeometry');
const opsNav = document.getElementById('opsNav');
const opsContent = document.getElementById('opsContent');

const statusEls = Object.freeze({
  fleet: document.getElementById('fleetStatus'),
  supervisor: document.getElementById('supervisorStatus'),
  update: document.getElementById('updateStatus'),
  dev: document.getElementById('devPlaneStatus'),
  compute: document.getElementById('computeStatus'),
  gates: document.getElementById('gateStatus'),
});

let snapshot = null;
let tabFilter = '';
let opsSection = 'overview';
let requestedLayout = { sidebar: 'EXPANDED', operations: 'OPEN' };

function text(value, fallback = '—') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function compact(value, max = 18) {
  const out = text(value);
  return out.length > max ? `${out.slice(0, Math.max(1, max - 1))}…` : out;
}

function shortId(value, max = 10) {
  const out = String(value || '');
  if (!out) return '—';
  return out.length > max ? `${out.slice(0, Math.max(4, max - 3))}…` : out;
}

function hostFor(value) {
  try { return new URL(String(value || '')).hostname || 'web'; }
  catch { return 'web'; }
}

function stateTone(value) {
  const state = String(value || '').toUpperCase();
  if (['ACTIVE', 'READY', 'RUNNING', 'CURRENT', 'OK', 'RESTORED', 'PROVEN', 'CONFIRMED', 'AVAILABLE', 'COMPLETED'].includes(state)) return 'good';
  if (['BOUND_UNVERIFIED', 'PROVISIONING', 'REGISTERED', 'RESERVED', 'MONITOR', 'DOWNLOADING', 'READY_RESTART', 'RESTART_GRACE', 'PARTIAL', 'STALE', 'DEGRADED', 'PENDING', 'ARMED'].includes(state)) return 'warn';
  if (['AMBIGUOUS', 'PROVISIONING_AMBIGUOUS', 'FROZEN', 'LOST', 'FAILED', 'ERROR', 'INVALID_READBACK', 'REJECTED_METADATA', 'DISCOVERY_ERROR', 'CRASHED'].includes(state)) return 'bad';
  return 'neutral';
}

function setSystemStatus(element, { value, tone = 'neutral', title = '' } = {}) {
  if (!element) return;
  element.classList.remove('good', 'warn', 'bad', 'neutral');
  element.classList.add(['good', 'warn', 'bad'].includes(tone) ? tone : 'neutral');
  const valueEl = element.querySelector('.systemValue');
  if (valueEl) valueEl.textContent = text(value);
  element.title = title || '';
}

function fleetStatus(next) {
  const fleet = next?.fleet;
  if (!fleet) return { value: 'unknown', tone: 'neutral', title: 'Fleet snapshot unavailable' };
  const counts = fleet.counts || {};
  const active = Number(counts.ACTIVE || 0);
  const bound = Number(counts.BOUND_UNVERIFIED || 0);
  const ambiguous = Number(counts.PROVISIONING_AMBIGUOUS || 0);
  const lost = Number(counts.LOST || 0);
  const total = Array.isArray(fleet.agents)
    ? fleet.agents.length
    : Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    value: `${active}/${total}`,
    tone: ambiguous > 0 ? 'bad' : (lost > 0 || bound > 0 ? 'warn' : (active > 0 ? 'good' : 'neutral')),
    title: `Fleet · ${active} active · ${bound} bound unverified · ${ambiguous} ambiguous · ${lost} lost · ${text(fleet.readiness_contract, 'contract unknown')}`,
  };
}

function supervisorStatus(next) {
  const supervisor = next?.supervisor;
  if (!supervisor) return { value: 'unknown', tone: 'neutral', title: 'Supervisor snapshot unavailable' };
  const mode = text(supervisor.supervisor_mode, 'UNKNOWN').toUpperCase();
  const armed = supervisor.armed === true;
  const running = supervisor.running === true;
  const error = Boolean(supervisor.last_error || supervisor.devos_last_error);
  return {
    value: mode === 'CONTROL' ? (armed ? 'ARM' : 'SAFE') : compact(mode, 10),
    tone: error ? 'bad' : (running && mode === 'CONTROL' && armed ? 'good' : (running ? 'warn' : 'neutral')),
    title: `Supervisor · ${mode} · ${armed ? 'armed' : 'disarmed'} · ${running ? 'running' : 'stopped'}${error ? ` · ${text(supervisor.last_error || supervisor.devos_last_error)}` : ''}`,
  };
}

function updateStatus(next) {
  const updater = next?.supervisor?.self_update;
  if (!updater) return { value: 'unknown', tone: 'neutral', title: 'Self-update snapshot unavailable' };
  const state = text(updater.state, 'UNKNOWN').toUpperCase();
  const bad = new Set(['ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR']);
  const busy = new Set(['APPROVED_DOWNLOAD', 'DOWNLOADING', 'READY_RESTART', 'RESTART_GRACE', 'RESTARTING']);
  const good = new Set(['CURRENT', 'IDLE', 'NO_UPDATE', 'READY']);
  const available = updater.available_version || updater.downloaded_version || null;
  return {
    value: available && available !== updater.current_version ? compact(available, 12) : compact(state.replaceAll('_', ' '), 12),
    tone: bad.has(state) ? 'bad' : (busy.has(state) ? 'warn' : (good.has(state) ? 'good' : 'neutral')),
    title: `Self-update · ${state} · current ${text(updater.current_version)}${available ? ` · target ${available}` : ''} · automatic effect retry disabled`,
  };
}

function developmentPlaneStatus(next) {
  const plane = next?.development_plane;
  if (!plane) return { value: 'unknown', tone: 'neutral', title: 'Development Plane snapshot unavailable' };
  const state = text(plane.state, 'UNKNOWN').toUpperCase();
  return {
    value: compact(state, 10),
    tone: state === 'READY' ? 'good' : (['ERROR', 'FAILED', 'CRASHED', 'LOST'].includes(state) ? 'bad' : 'warn'),
    title: `Development Plane · ${state}${plane.version ? ` · ${plane.version}` : ''}`,
  };
}

function computeStatus(next) {
  const compute = next?.compute;
  if (!compute) return { value: 'unknown', tone: 'neutral', title: 'Compute health unavailable' };
  const available = compute.available === true;
  const runtime = compute?.result?.runtime || (available ? 'ready' : 'offline');
  return {
    value: compact(runtime, 12),
    tone: available ? 'good' : 'bad',
    title: `Compute · ${available ? 'available' : 'offline'} · ${text(runtime)}`,
  };
}

function gateStatus(next) {
  const gates = next?.owner_safety_gates;
  if (!gates) return { value: 'unknown', tone: 'neutral', title: 'Owner safety gate snapshot unavailable' };
  const overrides = Array.isArray(gates.overrides) ? gates.overrides.length : 0;
  const wildcard = gates.wildcard_disabled === true;
  return {
    value: wildcard ? 'ALL' : (overrides ? `${overrides} override${overrides === 1 ? '' : 's'}` : 'sealed'),
    tone: wildcard ? 'bad' : (overrides ? 'warn' : 'good'),
    title: wildcard
      ? 'Owner safety gates · wildcard override active'
      : `Owner safety gates · ${overrides ? `${overrides} explicit override(s) active` : 'no overrides active'}`,
  };
}

function selectedTab(next) {
  const state = next?.tabs || {};
  const rows = Array.isArray(state.tabs) ? state.tabs : [];
  return rows.find((tab) => tab.tab_id === state.selected_tab_id) || null;
}

function fleetAgentForTab(next, tabId) {
  const rows = Array.isArray(next?.fleet?.agents) ? next.fleet.agents : [];
  return rows.find((row) => String(row?.tab_id || '') === String(tabId || '')) || null;
}

function exactActuationForTab(next, tabId) {
  const command = next?.supervisor?.current_command;
  if (!command) return null;
  const bound = String(command?.target_tab_id || '');
  if (!bound || bound !== String(tabId || '')) return null;
  return Object.freeze({ action: text(command.action, 'COMMAND'), command_id: command.command_id || null });
}

function unavailableWorkspaceProjection(next, sourceState = 'NOT_EXPOSED') {
  const sessions = Array.isArray(next?.tabs?.tabs) ? next.tabs.tabs : [];
  return Object.freeze({
    schema: 'metaengine.browser.workspace-workbench-projection.v1',
    source_state: sourceState,
    source_implemented: false,
    runtime_deployed: null,
    groups: [],
    sessions,
    issues: [],
    counts: { workspaces: 0, sessions: sessions.length, issues: 0, ready: 0, frozen: 0, reserved: 0 },
    grouping_authority: 'DURABLE_WORKSPACE_BINDING_ONLY',
    url_heuristic_grouping: false,
    title_heuristic_grouping: false,
    automatic_retry_allowed: false,
    browser_actuation_authority: false,
    authority_effect: false,
  });
}

function workspaceProjection(next) {
  const projection = next?.workspaces;
  if (!projection || projection.schema !== 'metaengine.browser.workspace-workbench-projection.v1') return unavailableWorkspaceProjection(next);
  if (projection.grouping_authority !== 'DURABLE_WORKSPACE_BINDING_ONLY') return unavailableWorkspaceProjection(next, 'INVALID_PROJECTION');
  if (projection.url_heuristic_grouping !== false || projection.title_heuristic_grouping !== false) return unavailableWorkspaceProjection(next, 'INVALID_PROJECTION');
  if (projection.automatic_retry_allowed !== false || projection.browser_actuation_authority !== false || projection.authority_effect !== false) return unavailableWorkspaceProjection(next, 'INVALID_PROJECTION');
  if (!Array.isArray(projection.groups) || !Array.isArray(projection.sessions) || !Array.isArray(projection.issues) || !projection.counts || typeof projection.counts !== 'object') return unavailableWorkspaceProjection(next, 'INVALID_PROJECTION');
  return projection;
}

function applyLayout(next) {
  const layout = next?.layout;
  if (!layout) return;
  if (layout.requested) {
    requestedLayout = {
      sidebar: text(layout.requested.sidebar, requestedLayout.sidebar).toUpperCase(),
      operations: text(layout.requested.operations, requestedLayout.operations).toUpperCase(),
    };
  }
  const sidebarWidth = Math.max(0, Number(layout?.sidebar_bounds?.width || 0));
  const operationsWidth = Math.max(0, Number(layout?.operations_bounds?.width || 0));
  body.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  body.style.setProperty('--ops-width', `${operationsWidth}px`);
  body.dataset.sidebar = text(layout.effective_sidebar, 'HIDDEN').toUpperCase();
  body.dataset.operations = text(layout.effective_operations, 'CLOSED').toUpperCase();
  railGeometry.textContent = layout.overlay_remote_content === false ? `Inset ${sidebarWidth}px` : 'Geometry unknown';
}

async function setLayout(patch = {}) {
  requestedLayout = {
    sidebar: patch.sidebar || requestedLayout.sidebar,
    operations: patch.operations || requestedLayout.operations,
  };
  await api.command('SHELL_LAYOUT_SET', requestedLayout);
}

async function cycleSidebar() {
  const cycle = { EXPANDED: 'COMPACT', COMPACT: 'HIDDEN', HIDDEN: 'EXPANDED' };
  await setLayout({ sidebar: cycle[requestedLayout.sidebar] || 'EXPANDED' });
}

async function toggleOperations(force = null) {
  await setLayout({ operations: force || (requestedLayout.operations === 'OPEN' ? 'CLOSED' : 'OPEN') });
}

function renderActive(next) {
  const tab = selectedTab(next);
  const agent = tab ? fleetAgentForTab(next, tab.tab_id) : null;
  const actuation = tab ? exactActuationForTab(next, tab.tab_id) : null;
  const workspace = workspaceProjection(next).groups.find((group) => group.tab_id === tab?.tab_id) || null;
  if (!tab) {
    activeKind.textContent = '—';
    activeTitle.textContent = 'No active tab';
    activeMeta.textContent = 'Awaiting browser state';
    return;
  }
  const chat = tab.kind === 'CHATGPT';
  activeKind.textContent = workspace ? 'P' : (chat ? 'C' : 'W');
  activeTitle.textContent = text(tab.title, chat ? 'ChatGPT' : hostFor(tab.url));
  activeMeta.textContent = actuation
    ? `ACTION · ${actuation.action}`
    : (workspace
      ? `${compact(workspace.branch_name, 34)} · ${workspace.state} · lease ${workspace.lease_generation}`
      : (agent ? `${text(agent.role, 'AGENT')} · ${text(agent.lifecycle_state, 'UNKNOWN')} · g${Number(agent.generation_epoch || 0)}` : hostFor(tab.url)));
  if (document.activeElement !== address) address.value = tab.url || '';
  routeKind.textContent = chat ? 'CHAT' : 'WEB';
  routeKind.classList.toggle('chat', chat);
}

function makeTabRow(tab, active, agent, actuation, workspace = null) {
  const row = document.createElement('div');
  row.className = `verticalTab ${active ? 'active' : ''} ${agent ? 'agent' : ''}`;
  row.setAttribute('role', 'listitem');

  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'verticalTabSelect';
  select.title = tab.url || tab.title || 'Tab';
  select.setAttribute('aria-current', active ? 'page' : 'false');
  select.setAttribute('aria-label', `${active ? 'Current tab' : 'Select tab'}: ${text(tab.title, tab.kind === 'CHATGPT' ? 'ChatGPT' : hostFor(tab.url))}`);
  select.onclick = () => api.command('SELECT_TAB', { tab_id: tab.tab_id }).catch(() => {});

  const avatar = document.createElement('span');
  avatar.className = 'tabAvatar';
  avatar.textContent = workspace ? 'P' : (agent ? text(agent.role, 'A').slice(0, 1) : (tab.kind === 'CHATGPT' ? 'C' : 'W'));
  const dot = document.createElement('i');
  dot.className = `tabStateDot ${actuation ? 'warn' : (workspace ? stateTone(workspace.state) : (agent ? stateTone(agent.lifecycle_state) : 'neutral'))}`;
  avatar.append(dot);

  const copy = document.createElement('span');
  copy.className = 'tabCopy';
  const title = document.createElement('strong');
  title.textContent = text(tab.title, tab.kind === 'CHATGPT' ? 'ChatGPT' : hostFor(tab.url));
  const meta = document.createElement('small');
  meta.textContent = actuation
    ? `ACTION · ${actuation.action}`
    : (workspace ? `${workspace.state} · lease ${workspace.lease_generation}` : (agent ? `${text(agent.role)} · ${text(agent.lifecycle_state)}` : hostFor(tab.url)));
  copy.append(title, meta);
  select.append(avatar, copy);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tabClose';
  close.textContent = '×';
  close.title = `Close ${title.textContent}`;
  close.setAttribute('aria-label', `Close ${title.textContent}`);
  close.onclick = () => api.command('CLOSE_TAB', { tab_id: tab.tab_id }).catch(() => {});

  row.append(select, close);
  return row;
}

function railHeader(label, value = '') {
  const row = document.createElement('div');
  row.className = 'railSectionHead';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('b');
  right.textContent = value;
  row.append(left, right);
  return row;
}

function renderContextRail(next) {
  const state = next?.tabs || {};
  const projection = workspaceProjection(next);
  const filter = tabFilter.trim().toLowerCase();
  const nodes = [];

  for (const group of projection.groups) {
    const haystack = [group.branch_name, group.point_id, group.repo_id, group.role, group.state, group.tab?.title, group.tab?.url].join(' ').toLowerCase();
    if (filter && !haystack.includes(filter)) continue;
    nodes.push(railHeader(compact(group.branch_name || group.point_id || 'Workspace', 28), `${group.state} · l${group.lease_generation}`));
    nodes.push(makeTabRow(group.tab, group.tab_id === state.selected_tab_id, group.agent, exactActuationForTab(next, group.tab_id), group));
  }

  const sessions = projection.sessions.filter((tab) => {
    if (!filter) return true;
    const agent = fleetAgentForTab(next, tab.tab_id);
    return [tab.title, tab.url, agent?.role, agent?.lifecycle_state].some((value) => String(value || '').toLowerCase().includes(filter));
  });
  if (sessions.length || projection.groups.length === 0) {
    nodes.push(railHeader('Sessions', String(projection.sessions.length)));
    for (const tab of sessions) {
      nodes.push(makeTabRow(tab, tab.tab_id === state.selected_tab_id, fleetAgentForTab(next, tab.tab_id), exactActuationForTab(next, tab.tab_id)));
    }
  }

  tabCount.textContent = String((state.tabs || []).length);
  verticalTabs.replaceChildren(...nodes);
  if (projection.source_state === 'AVAILABLE') {
    fleetProfile.textContent = `${projection.counts.workspaces} workspace${projection.counts.workspaces === 1 ? '' : 's'} · ${projection.counts.issues} drift`;
  } else if (projection.source_state === 'RUNTIME_NOT_DEPLOYED') {
    fleetProfile.textContent = 'Workspaces · runtime not deployed';
  } else {
    fleetProfile.textContent = `Workspaces · ${compact(projection.source_state, 22)}`;
  }
}

function el(tag, className = '', value = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function metric(label, value, tone = 'neutral') {
  const card = el('div', `metricCard ${tone}`);
  card.append(el('span', '', label), el('strong', '', text(value)));
  return card;
}

function kvRow(label, value, tone = 'neutral') {
  const row = el('div', 'kvRow');
  row.append(el('span', '', label), el('b', tone, text(value)));
  return row;
}

function section(title, subtitle = '') {
  const wrap = el('section', 'opsSection');
  const header = el('div', 'opsSectionTitle');
  header.append(el('strong', '', title), el('span', '', subtitle));
  const list = el('div', 'kvList');
  wrap.append(header, list);
  return { wrap, list };
}

function hero(title, subtitle, badge) {
  const wrap = el('div', 'opsHero');
  const top = el('div', 'opsHeroTop');
  top.append(el('strong', '', title), el('span', 'heroBadge', badge));
  wrap.append(top, el('small', '', subtitle));
  return wrap;
}

function entityRow(title, subtitle, tags = []) {
  const row = el('div', 'entityRow');
  const top = el('div', 'entityTop');
  top.append(el('strong', '', title), el('span', '', subtitle));
  const meta = el('div', 'entityMeta');
  for (const tag of tags) meta.append(el('span', `tinyTag ${tag.tone || ''}`.trim(), tag.value));
  row.append(top, meta);
  return row;
}

function renderOverview(next) {
  const fragment = document.createDocumentFragment();
  const layout = next?.layout;
  const workspaces = workspaceProjection(next);
  fragment.append(hero(
    `METAENGINE Browser ${text(next?.version, '')}`.trim(),
    'Native-inset workbench. Page/model content remains untrusted; operations telemetry is read-only in this surface.',
    layout?.overlay_remote_content === false ? 'native geometry' : 'geometry unknown',
  ));
  const grid = el('div', 'opsGrid');
  const fleet = fleetStatus(next);
  const supervisor = supervisorStatus(next);
  const devos = next?.supervisor?.devos_task_cycle;
  grid.append(
    metric('Workspaces', workspaces.source_state === 'AVAILABLE' ? workspaces.counts.workspaces : workspaces.source_state, workspaces.source_state === 'AVAILABLE' ? (workspaces.counts.issues ? 'warn' : 'good') : 'neutral'),
    metric('Fleet', fleet.value, fleet.tone),
    metric('Supervisor', supervisor.value, supervisor.tone),
    metric('DevOS cycle', devos ? text(devos.state, 'UNKNOWN') : 'UNKNOWN', devos ? stateTone(devos.state) : 'neutral'),
  );
  fragment.append(grid);
  const evidence = section('Authority & evidence', 'trusted main-process projection');
  evidence.list.append(
    kvRow('Workspace grouping', workspaces.grouping_authority, 'good'),
    kvRow('URL/title grouping', 'DISABLED', 'good'),
    kvRow('Effect binding', next?.supervisor?.generic_tab_effect_binding || 'UNKNOWN', next?.supervisor?.generic_tab_effect_binding ? 'good' : 'neutral'),
    kvRow('DevOS scheduler', next?.supervisor?.devos_scheduler_source || 'UNKNOWN', next?.supervisor?.devos_scheduler_source ? 'good' : 'neutral'),
    kvRow('Second DevOS loop', next?.supervisor?.devos_second_polling_loop === false ? 'NO' : 'UNKNOWN', next?.supervisor?.devos_second_polling_loop === false ? 'good' : 'neutral'),
  );
  fragment.append(evidence.wrap);
  const exposure = section('Runtime exposure', 'do not infer missing modules');
  exposure.list.append(
    kvRow('Workspace registry', workspaces.source_state, stateTone(workspaces.source_state)),
    kvRow('Fleet / transport', next?.fleet ? 'EXPOSED' : 'UNKNOWN', next?.fleet ? 'good' : 'neutral'),
    kvRow('Worker observer', next?.supervisor?.worker_observer ? 'EXPOSED' : 'UNKNOWN', next?.supervisor?.worker_observer ? 'good' : 'neutral'),
    kvRow('Crash sentinel', 'NOT EXPOSED', 'muted'),
    kvRow('Host resilience', 'NOT EXPOSED', 'muted'),
  );
  fragment.append(exposure.wrap);
  return fragment;
}

function renderWorkspaces(next) {
  const fragment = document.createDocumentFragment();
  const projection = workspaceProjection(next);
  const deployed = projection.runtime_deployed === true ? 'runtime deployed' : (projection.runtime_deployed === false ? 'runtime not deployed' : 'deployment unknown');
  const subtitle = projection.source_state === 'RUNTIME_NOT_DEPLOYED'
    ? 'Workspace Binding exists in source but the live readback RPC is not deployed. All browser tabs remain Sessions; no URL/title inference is allowed.'
    : 'Groups are admitted only by the trusted main-process projection from current durable Workspace Binding evidence.';
  fragment.append(hero('Typed Workspaces', subtitle, `${projection.source_state} · ${deployed}`));

  const grid = el('div', 'opsGrid');
  grid.append(
    metric('Workspaces', projection.counts.workspaces, projection.counts.workspaces ? 'good' : 'neutral'),
    metric('Ready', projection.counts.ready, projection.counts.ready ? 'good' : 'neutral'),
    metric('Frozen', projection.counts.frozen, projection.counts.frozen ? 'bad' : 'good'),
    metric('Drift issues', projection.counts.issues, projection.counts.issues ? 'bad' : 'good'),
  );
  fragment.append(grid);

  const contract = section('Grouping contract', 'renderer is presentation only');
  contract.list.append(
    kvRow('Authority source', projection.grouping_authority, 'good'),
    kvRow('URL heuristic', projection.url_heuristic_grouping === false ? 'DISABLED' : 'UNKNOWN', 'good'),
    kvRow('Title heuristic', projection.title_heuristic_grouping === false ? 'DISABLED' : 'UNKNOWN', 'good'),
    kvRow('Second polling loop', next?.supervisor?.workspace_binding_second_polling_loop === false ? 'NO' : 'UNKNOWN', next?.supervisor?.workspace_binding_second_polling_loop === false ? 'good' : 'neutral'),
    kvRow('Automatic retry', projection.automatic_retry_allowed === false ? 'DISABLED' : 'UNKNOWN', 'good'),
    kvRow('Browser actuation', projection.browser_actuation_authority === false ? 'NONE' : 'UNKNOWN', 'good'),
  );
  fragment.append(contract.wrap);

  if (projection.groups.length) {
    const list = section('Authoritative groups', `${projection.groups.length} current binding(s)`);
    list.list.className = 'entityList';
    for (const group of projection.groups) {
      list.list.append(entityRow(
        compact(group.branch_name || group.point_id || group.workspace_id, 36),
        `${group.state} · ${group.role}`,
        [
          { value: `w${group.workspace_generation}`, tone: 'neutral' },
          { value: `lease ${group.lease_generation}`, tone: group.state === 'FROZEN' ? 'bad' : 'good' },
          { value: `g${group.agent_generation_epoch}`, tone: 'neutral' },
          { value: shortId(group.task_id, 14), tone: 'neutral' },
          ...(group.ambiguity_code ? [{ value: compact(group.ambiguity_code, 28), tone: 'bad' }] : []),
        ],
      ));
    }
    fragment.append(list.wrap);
  }

  if (projection.issues.length) {
    const list = section('Binding drift / holds', 'never converted into workspace authority');
    list.list.className = 'entityList';
    for (const item of projection.issues) {
      list.list.append(entityRow(text(item.reason, 'DRIFT'), shortId(item.workspace_id || item.task_id, 18), [
        { value: item.tab_id ? `tab ${shortId(item.tab_id, 12)}` : 'no live tab', tone: 'warn' },
        { value: item.lease_generation ? `lease ${item.lease_generation}` : 'lease unknown', tone: 'warn' },
      ]));
    }
    fragment.append(list.wrap);
  }

  const sessions = section('Sessions', `${projection.sessions.length} ungrouped browser tab(s)`);
  sessions.list.append(kvRow('Session fallback', projection.sessions.length ? 'ACTIVE' : 'NONE', projection.sessions.length ? 'neutral' : 'good'));
  fragment.append(sessions.wrap);
  return fragment;
}

function renderFleet(next) {
  const fragment = document.createDocumentFragment();
  const fleet = next?.fleet;
  if (!fleet) {
    fragment.append(hero('Fleet unavailable', 'No local fleet snapshot is exposed. The UI does not infer fleet health from tabs.', 'unknown'));
    return fragment;
  }
  fragment.append(hero('Fleet transport plane', `${text(fleet.readiness_contract, 'readiness unknown')} · ${text(fleet.policy?.profile, 'profile unknown')}`, 'exact binding'));
  const grid = el('div', 'opsGrid');
  grid.append(
    metric('Active', Number(fleet.counts?.ACTIVE || 0), Number(fleet.counts?.ACTIVE || 0) ? 'good' : 'neutral'),
    metric('Bound', Number(fleet.counts?.BOUND_UNVERIFIED || 0), Number(fleet.counts?.BOUND_UNVERIFIED || 0) ? 'warn' : 'good'),
    metric('Ambiguous', Number(fleet.counts?.PROVISIONING_AMBIGUOUS || 0), Number(fleet.counts?.PROVISIONING_AMBIGUOUS || 0) ? 'bad' : 'good'),
    metric('Lost', Number(fleet.counts?.LOST || 0), Number(fleet.counts?.LOST || 0) ? 'bad' : 'good'),
  );
  fragment.append(grid);
  const list = section('Agents', `${Array.isArray(fleet.agents) ? fleet.agents.length : 0} registered`);
  list.list.className = 'entityList';
  for (const agent of fleet.agents || []) {
    const proof = agent.transport_proof;
    list.list.append(entityRow(
      `${text(agent.role, 'WORKER')} · ${shortId(agent.agent_id, 14)}`,
      text(agent.lifecycle_state, 'UNKNOWN'),
      [
        { value: `g${Number(agent.generation_epoch || 0)}`, tone: 'neutral' },
        { value: agent.tab_id ? `tab ${shortId(agent.tab_id, 12)}` : 'no tab', tone: agent.tab_id ? 'neutral' : 'warn' },
        { value: proof ? 'transport proven' : 'transport unproven', tone: proof ? 'good' : (agent.lifecycle_state === 'ACTIVE' ? 'bad' : 'warn') },
      ],
    ));
  }
  fragment.append(list.wrap);
  return fragment;
}

function renderSupervisor(next) {
  const fragment = document.createDocumentFragment();
  const supervisor = next?.supervisor;
  if (!supervisor) {
    fragment.append(hero('Supervisor unavailable', 'No supervisor snapshot is exposed. This is UNKNOWN, not an offline proof.', 'unknown'));
    return fragment;
  }
  fragment.append(hero(
    'Native supervisor',
    `${text(supervisor.supervisor_mode, 'UNKNOWN')} · ${supervisor.armed === true ? 'armed' : 'disarmed'} · ${supervisor.running === true ? 'running' : 'stopped'}`,
    supervisor.last_error || supervisor.devos_last_error ? 'degraded' : 'local',
  ));
  const core = section('Core state', 'heartbeat authority');
  const command = supervisor.current_command;
  const commandTab = String(command?.target_tab_id || '');
  core.list.append(
    kvRow('Mode', supervisor.supervisor_mode || 'UNKNOWN', stateTone(supervisor.supervisor_mode)),
    kvRow('Armed', supervisor.armed === true ? 'TRUE' : 'FALSE', supervisor.armed === true ? 'good' : 'warn'),
    kvRow('Enrollment', supervisor.enrollment_status || 'UNKNOWN', stateTone(supervisor.enrollment_status)),
    kvRow('Heartbeat', supervisor.last_heartbeat_at || 'UNKNOWN', supervisor.last_heartbeat_at ? 'good' : 'neutral'),
    kvRow('Current command', command ? `${text(command.action, 'COMMAND')}${commandTab ? ` · ${shortId(commandTab, 12)}` : ' · target unknown'}` : 'NONE', command ? (commandTab ? 'warn' : 'neutral') : 'neutral'),
    kvRow('Last command', supervisor.last_command_status || 'NONE', stateTone(supervisor.last_command_status)),
    kvRow('Error', supervisor.last_error || supervisor.devos_last_error || 'NONE', supervisor.last_error || supervisor.devos_last_error ? 'bad' : 'good'),
  );
  fragment.append(core.wrap);

  const watchdog = supervisor.bootstrap_heartbeat;
  const watch = section('Heartbeat watchdog', 'no command leasing');
  watch.list.append(
    kvRow('Mode', watchdog?.mode || 'UNKNOWN', watchdog ? 'good' : 'neutral'),
    kvRow('Last watchdog pulse', watchdog?.last_at || 'UNKNOWN', watchdog?.last_at ? 'good' : 'neutral'),
    kvRow('Control authority', watchdog?.control_authority === false ? 'NONE' : 'UNKNOWN', watchdog?.control_authority === false ? 'good' : 'neutral'),
    kvRow('Command leasing', watchdog?.command_leasing === false ? 'NONE' : 'UNKNOWN', watchdog?.command_leasing === false ? 'good' : 'neutral'),
  );
  fragment.append(watch.wrap);

  const runtime = supervisor.supervisor_mesh;
  const durable = runtime?.mesh;
  const mesh = section('Supervisor mesh', supervisor.supervisor_mesh_wire_projection || 'projection unknown');
  const ambiguous = Number(durable?.counts?.ambiguous_incarnation || 0);
  mesh.list.append(
    kvRow('Runtime', runtime ? (runtime.running === true ? 'RUNNING' : 'STOPPED') : 'UNKNOWN', runtime ? stateTone(runtime.running === true ? 'RUNNING' : 'STOPPED') : 'neutral'),
    kvRow('Last reconcile', runtime?.last_reconcile_at || 'UNKNOWN', runtime?.last_reconcile_at ? 'good' : 'neutral'),
    kvRow('Error', runtime?.last_error || 'NONE', runtime?.last_error ? 'bad' : 'good'),
    kvRow('Supervisors', durable?.counts?.total ?? 'UNKNOWN', 'neutral'),
    kvRow('Active', durable?.counts?.active ?? 'UNKNOWN', Number(durable?.counts?.active || 0) ? 'good' : 'neutral'),
    kvRow('Ambiguous incarnation', durable?.counts?.ambiguous_incarnation ?? 'UNKNOWN', ambiguous > 0 ? 'bad' : (durable?.counts ? 'good' : 'neutral')),
    kvRow('Actuation policy', durable?.actuation_policy || 'UNKNOWN', durable?.actuation_policy ? 'good' : 'neutral'),
  );
  fragment.append(mesh.wrap);
  return fragment;
}

function renderDevos(next) {
  const fragment = document.createDocumentFragment();
  const supervisor = next?.supervisor;
  const cycle = supervisor?.devos_task_cycle;
  if (!cycle) {
    fragment.append(hero('DevOS cycle unavailable', 'DevOS is not exposed by the current local supervisor snapshot.', 'unknown'));
    return fragment;
  }
  fragment.append(hero('DevOS fleet scheduler', 'One bounded stage of the native supervisor heartbeat; no second polling loop.', text(cycle.state, 'UNKNOWN')));
  const grid = el('div', 'opsGrid');
  grid.append(
    metric('Cycle', cycle.state || 'UNKNOWN', stateTone(cycle.state)),
    metric('Ready', cycle.backlog?.ready ?? '—', Number(cycle.backlog?.ready || 0) ? 'warn' : 'neutral'),
    metric('Running', cycle.backlog?.running ?? '—', Number(cycle.backlog?.running || 0) ? 'good' : 'neutral'),
    metric('Recovery', cycle.ambiguity_recovery?.state || 'NONE', stateTone(cycle.ambiguity_recovery?.state)),
  );
  fragment.append(grid);
  const transport = section('Transport fencing', 'no blind retry');
  transport.list.append(
    kvRow('Bound-unverified dispatch', cycle.bound_unverified_dispatch_allowed === false ? 'FORBIDDEN' : 'UNKNOWN', cycle.bound_unverified_dispatch_allowed === false ? 'good' : 'neutral'),
    kvRow('Proof before dispatch', cycle.fleet_transport_proof_before_physical_dispatch === true ? 'REQUIRED' : 'UNKNOWN', cycle.fleet_transport_proof_before_physical_dispatch === true ? 'good' : 'neutral'),
    kvRow('Promotion', cycle.fleet_transport_promotion?.state || 'NONE', stateTone(cycle.fleet_transport_promotion?.state)),
    kvRow('Durable effect journal', cycle.durable_effect_delivery_journal === true ? 'ACTIVE' : 'UNKNOWN', cycle.durable_effect_delivery_journal === true ? 'good' : 'neutral'),
    kvRow('Scheduler source', supervisor?.devos_scheduler_source || 'UNKNOWN', supervisor?.devos_scheduler_source ? 'good' : 'neutral'),
    kvRow('Second loop', supervisor?.devos_second_polling_loop === false ? 'NO' : 'UNKNOWN', supervisor?.devos_second_polling_loop === false ? 'good' : 'neutral'),
  );
  fragment.append(transport.wrap);
  return fragment;
}

function renderRuntime(next) {
  const fragment = document.createDocumentFragment();
  fragment.append(hero('Runtime surfaces', 'Local runtime evidence only. Missing state remains UNKNOWN.', 'read only'));
  const updater = next?.supervisor?.self_update;
  const continuity = next?.supervisor?.session_continuity;
  const plane = next?.development_plane;
  const compute = next?.compute;
  const downloads = next?.downloads;
  const observer = next?.supervisor?.worker_observer;
  const workspace = workspaceProjection(next);
  const downloadState = downloads?.active?.state || downloads?.last?.state || (downloads ? 'IDLE' : 'UNKNOWN');
  const runtime = section('Runtime health', 'process-local');
  runtime.list.append(
    kvRow('Workspace observer', workspace.source_state || 'UNKNOWN', stateTone(workspace.source_state)),
    kvRow('Development Plane', plane?.state || 'UNKNOWN', plane ? stateTone(plane.state) : 'neutral'),
    kvRow('Dev browser authority', plane?.browser_actuation_authority === false ? 'NONE' : 'UNKNOWN', plane?.browser_actuation_authority === false ? 'good' : 'neutral'),
    kvRow('Direct promote', plane?.direct_promote_current === false ? 'DISABLED' : 'UNKNOWN', plane?.direct_promote_current === false ? 'good' : 'neutral'),
    kvRow('Compute', compute ? (compute.available === true ? 'AVAILABLE' : 'OFFLINE') : 'UNKNOWN', compute ? (compute.available === true ? 'good' : 'bad') : 'neutral'),
    kvRow('Downloads', downloadState, downloads ? stateTone(downloadState) : 'neutral'),
    kvRow('Download exec authority', downloads?.arbitrary_execution === false ? 'NONE' : 'UNKNOWN', downloads?.arbitrary_execution === false ? 'good' : 'neutral'),
    kvRow('Install authority', downloads?.install_authority === false ? 'NONE' : 'UNKNOWN', downloads?.install_authority === false ? 'good' : 'neutral'),
    kvRow('Worker observer', observer ? 'EXPOSED' : 'UNKNOWN', observer ? 'good' : 'neutral'),
    kvRow('Observer error', observer?.last_error || 'NONE', observer?.last_error ? 'bad' : 'neutral'),
  );
  fragment.append(runtime.wrap);
  const update = section('Self-update continuity', 'restart resumable');
  update.list.append(
    kvRow('Updater state', updater?.state || 'UNKNOWN', updater ? stateTone(updater.state) : 'neutral'),
    kvRow('Current version', updater?.current_version || next?.version || 'UNKNOWN', updater?.current_version || next?.version ? 'good' : 'neutral'),
    kvRow('Available version', updater?.available_version || 'NONE', updater?.available_version ? 'warn' : 'neutral'),
    kvRow('Install barrier', updater?.install_effect_barrier_mode || 'UNKNOWN', updater?.install_effect_barrier_mode ? 'good' : 'neutral'),
    kvRow('Automatic effect retry', updater?.automatic_effect_retry === false ? 'DISABLED' : 'UNKNOWN', updater?.automatic_effect_retry === false ? 'good' : 'neutral'),
    kvRow('Session continuity', continuity?.state || 'UNKNOWN', continuity ? stateTone(continuity.state) : 'neutral'),
  );
  fragment.append(update.wrap);
  return fragment;
}

function renderSafety(next) {
  const fragment = document.createDocumentFragment();
  const gates = next?.owner_safety_gates;
  const workspaces = workspaceProjection(next);
  fragment.append(hero('Safety & trust boundaries', 'This panel reports contracts. It does not disable or enable gates.', gates ? 'local policy' : 'unknown'));
  const authority = section('Browser authority', 'fail closed');
  authority.list.append(
    kvRow('Arbitrary eval', next?.supervisor?.arbitrary_eval === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.arbitrary_eval === false ? 'good' : 'neutral'),
    kvRow('OS shell authority', next?.supervisor?.os_shell_authority === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.os_shell_authority === false ? 'good' : 'neutral'),
    kvRow('Remote overlay', next?.layout?.overlay_remote_content === false ? 'NONE' : 'UNKNOWN', next?.layout?.overlay_remote_content === false ? 'good' : 'neutral'),
    kvRow('Renderer dimensions', next?.layout?.renderer_dimensions_authoritative === false ? 'NON-AUTHORITATIVE' : 'UNKNOWN', next?.layout?.renderer_dimensions_authoritative === false ? 'good' : 'neutral'),
    kvRow('Workspace grouping', workspaces.grouping_authority, 'good'),
    kvRow('Effect binding', next?.supervisor?.generic_tab_effect_binding || 'UNKNOWN', next?.supervisor?.generic_tab_effect_binding ? 'good' : 'neutral'),
  );
  fragment.append(authority.wrap);
  const policies = section('Owner safety gates', gates ? `${Array.isArray(gates.overrides) ? gates.overrides.length : 0} override(s)` : 'snapshot unavailable');
  policies.list.append(
    kvRow('Wildcard override', gates ? (gates.wildcard_disabled === true ? 'ACTIVE' : 'NONE') : 'UNKNOWN', gates ? (gates.wildcard_disabled === true ? 'bad' : 'good') : 'neutral'),
    kvRow('External platform gates', gates?.external_platform_gates_overridable === false ? 'NOT OVERRIDABLE' : 'UNKNOWN', gates?.external_platform_gates_overridable === false ? 'good' : 'neutral'),
    kvRow('Navigation policy', next?.policy ? 'EXPOSED' : 'UNKNOWN', next?.policy ? 'good' : 'neutral'),
  );
  fragment.append(policies.wrap);
  if (Array.isArray(gates?.overrides) && gates.overrides.length) {
    const list = section('Active overrides', 'owner initiated');
    list.list.className = 'entityList';
    for (const row of gates.overrides) list.list.append(entityRow(text(row.gate_id, 'gate'), row.expires_at ? 'TTL' : 'persistent', [{ value: compact(row.reason, 30), tone: 'warn' }]));
    fragment.append(list.wrap);
  }
  const unexposed = section('Unexposed mechanisms', 'source presence is not runtime proof');
  unexposed.list.append(
    kvRow('Browser sentinel','NOT EXPOSED','muted'),
    kvRow('Host resilience','NOT EXPOSED','muted'),
    kvRow('Parent progress lease','NOT EXPOSED','muted'),
  );
  fragment.append(unexposed.wrap);
  return fragment;
}

function commandButton(label, hint, action) {
  const button = el('button', 'commandButton');
  button.type = 'button';
  button.append(el('strong', '', label), el('span', '', hint));
  button.onclick = () => Promise.resolve(action()).catch(() => {});
  return button;
}

function renderCommands() {
  const fragment = document.createDocumentFragment();
  fragment.append(hero('Command surface', 'Only local navigation and workbench layout commands are exposed here.', 'bounded'));
  const list = el('div', 'commandList');
  list.append(
    commandButton('New ChatGPT tab', 'Local tab action', () => api.command('NEW_CHATGPT', {})),
    commandButton('Focus address', 'Ctrl+L', () => { address.focus(); address.select(); }),
    commandButton('Back', 'Navigation history', () => api.command('BACK', {})),
    commandButton('Forward', 'Navigation history', () => api.command('FORWARD', {})),
    commandButton('Reload', 'Current tab only', () => api.command('RELOAD', {})),
    commandButton('Cycle Context Rail', 'Ctrl+B', cycleSidebar),
    commandButton('Toggle Operations', 'Ctrl+Shift+O', toggleOperations),
    commandButton('Open Workspaces', 'Read only', () => { opsSection = 'workspaces'; renderOps(snapshot); }),
    commandButton('Open Safety contracts', 'Read only', () => { opsSection = 'safety'; renderOps(snapshot); }),
    commandButton('Open DevOS evidence', 'Read only', () => { opsSection = 'devos'; renderOps(snapshot); }),
  );
  fragment.append(list);
  return fragment;
}

function renderOps(next) {
  for (const button of opsNav.querySelectorAll('button[data-section]')) button.classList.toggle('active', button.dataset.section === opsSection);
  let content;
  if (opsSection === 'workspaces') content = renderWorkspaces(next);
  else if (opsSection === 'fleet') content = renderFleet(next);
  else if (opsSection === 'supervisor') content = renderSupervisor(next);
  else if (opsSection === 'devos') content = renderDevos(next);
  else if (opsSection === 'runtime') content = renderRuntime(next);
  else if (opsSection === 'safety') content = renderSafety(next);
  else if (opsSection === 'commands') content = renderCommands();
  else content = renderOverview(next);
  opsContent.replaceChildren(content);
}

function render(next) {
  snapshot = next || null;
  versionEl.textContent = next?.version ? `v${next.version}` : 'Browser';
  applyLayout(next);
  renderActive(next);
  renderContextRail(next);
  setSystemStatus(statusEls.fleet, fleetStatus(next));
  setSystemStatus(statusEls.supervisor, supervisorStatus(next));
  setSystemStatus(statusEls.update, updateStatus(next));
  setSystemStatus(statusEls.dev, developmentPlaneStatus(next));
  setSystemStatus(statusEls.compute, computeStatus(next));
  setSystemStatus(statusEls.gates, gateStatus(next));
  renderOps(next);
}

document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => api.command(button.dataset.cmd, {}).catch(() => {})));
document.getElementById('newChat').addEventListener('click', () => api.command('NEW_CHATGPT', {}).catch(() => {}));
document.getElementById('sidebarToggle').addEventListener('click', () => cycleSidebar().catch(() => {}));
document.getElementById('railCollapse').addEventListener('click', () => cycleSidebar().catch(() => {}));
document.getElementById('operationsToggle').addEventListener('click', () => toggleOperations().catch(() => {}));
document.getElementById('operationsClose').addEventListener('click', () => toggleOperations('CLOSED').catch(() => {}));
opsNav.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-section]');
  if (!button) return;
  opsSection = button.dataset.section;
  renderOps(snapshot);
});
tabSearch.addEventListener('input', () => {
  tabFilter = tabSearch.value || '';
  renderContextRail(snapshot);
});
document.getElementById('addressForm').addEventListener('submit', (event) => {
  event.preventDefault();
  api.command('NAVIGATE', { url: address.value }).catch(() => {});
});
document.addEventListener('keydown', (event) => {
  const control = event.ctrlKey || event.metaKey;
  if (control && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    address.focus();
    address.select();
    return;
  }
  if (control && !event.shiftKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    cycleSidebar().catch(() => {});
    return;
  }
  if (control && event.shiftKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    toggleOperations().catch(() => {});
    return;
  }
  if (control && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    opsSection = 'commands';
    toggleOperations('OPEN').then(() => renderOps(snapshot)).catch(() => {});
  }
});

api.onSnapshot(render);
api.snapshot().then(render).catch(() => render(snapshot));

// Agentic Workbench V1 is a renderer-only ergonomics layer. It does not add a
// scheduler, command lease path, page/model authority, arbitrary eval, or retry
// mechanism. All physical effects continue through the existing explicit shell
// commands and native supervisor contracts above.
const AGENTIC_CONTEXT_STORAGE_KEY = 'metaengine.browser.agentic-context-set.v1';
const AGENTIC_CONTEXT_MAX_TABS = 8;
const AGENTIC_SECTIONS = Object.freeze(['attention', 'activity', 'context', 'skills']);
let agenticSection = null;
let agenticContextTabIds = loadAgenticContextTabIds();

function loadAgenticContextTabIds() {
  try {
    const value = JSON.parse(localStorage.getItem(AGENTIC_CONTEXT_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item || '')).filter(Boolean))].slice(0, AGENTIC_CONTEXT_MAX_TABS);
  } catch {
    return [];
  }
}

function persistAgenticContextTabIds() {
  try { localStorage.setItem(AGENTIC_CONTEXT_STORAGE_KEY, JSON.stringify(agenticContextTabIds)); }
  catch { /* Renderer context is convenience only; storage failure has no authority consequence. */ }
}

function pruneAgenticContext(next) {
  const live = new Set((next?.tabs?.tabs || []).map((tab) => String(tab.tab_id || '')).filter(Boolean));
  const filtered = agenticContextTabIds.filter((tabId) => live.has(tabId)).slice(0, AGENTIC_CONTEXT_MAX_TABS);
  if (filtered.length === agenticContextTabIds.length && filtered.every((value, index) => value === agenticContextTabIds[index])) return;
  agenticContextTabIds = filtered;
  persistAgenticContextTabIds();
}

function toggleAgenticContextTab(tabId) {
  const id = String(tabId || '');
  if (!id) return false;
  if (agenticContextTabIds.includes(id)) agenticContextTabIds = agenticContextTabIds.filter((value) => value !== id);
  else agenticContextTabIds = [...agenticContextTabIds, id].slice(-AGENTIC_CONTEXT_MAX_TABS);
  persistAgenticContextTabIds();
  return agenticContextTabIds.includes(id);
}

function agenticContextRows(next) {
  const tabs = Array.isArray(next?.tabs?.tabs) ? next.tabs.tabs : [];
  const groups = workspaceProjection(next).groups;
  return agenticContextTabIds.map((tabId) => {
    const tab = tabs.find((row) => String(row.tab_id) === tabId);
    if (!tab) return null;
    const agent = fleetAgentForTab(next, tabId);
    const workspace = groups.find((row) => String(row.tab_id) === tabId) || null;
    return Object.freeze({ tab, agent, workspace, authority_effect: false });
  }).filter(Boolean);
}

function attentionQueue(next) {
  const items = [];
  const counts = next?.fleet?.counts || {};
  const ambiguous = Number(counts.PROVISIONING_AMBIGUOUS || 0);
  const lost = Number(counts.LOST || 0);
  const bound = Number(counts.BOUND_UNVERIFIED || 0);
  if (ambiguous > 0) items.push({ tone: 'bad', title: 'Fleet ambiguity', detail: `${ambiguous} provisioning ambiguous`, target: 'fleet' });
  if (lost > 0) items.push({ tone: 'bad', title: 'Lost fleet agents', detail: `${lost} lost`, target: 'fleet' });
  if (bound > 0) items.push({ tone: 'warn', title: 'Transport proof pending', detail: `${bound} bound unverified`, target: 'fleet' });

  const workspaces = workspaceProjection(next);
  if (Number(workspaces.counts?.frozen || 0) > 0) items.push({ tone: 'bad', title: 'Frozen workspaces', detail: `${workspaces.counts.frozen} frozen`, target: 'workspaces' });
  if (Number(workspaces.counts?.issues || 0) > 0) items.push({ tone: 'warn', title: 'Workspace binding drift', detail: `${workspaces.counts.issues} issue(s)`, target: 'workspaces' });

  const supervisorError = next?.supervisor?.last_error || next?.supervisor?.devos_last_error || next?.supervisor?.supervisor_mesh?.last_error;
  if (supervisorError) items.push({ tone: 'bad', title: 'Supervisor degraded', detail: compact(supervisorError, 72), target: 'supervisor' });

  const updater = next?.supervisor?.self_update;
  if (['ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR'].includes(String(updater?.state || '').toUpperCase())) {
    items.push({ tone: 'bad', title: 'Self-update hold', detail: compact(updater?.last_error || updater?.state, 72), target: 'runtime' });
  }

  if (next?.development_plane && String(next.development_plane.state || '').toUpperCase() !== 'READY') {
    items.push({ tone: 'warn', title: 'Development Plane not ready', detail: text(next.development_plane.state, 'UNKNOWN'), target: 'runtime' });
  }
  if (next?.compute && next.compute.available !== true) items.push({ tone: 'bad', title: 'Compute offline', detail: 'Compute health reports unavailable', target: 'runtime' });
  if (next?.owner_safety_gates?.wildcard_disabled === true) items.push({ tone: 'bad', title: 'Wildcard gate override', detail: 'Owner safety wildcard override is active', target: 'safety' });

  return Object.freeze(items.map((item) => Object.freeze({ ...item, authority_effect: false })));
}

function installAgenticNav() {
  for (const name of AGENTIC_SECTIONS) {
    if (opsNav.querySelector(`button[data-agentic-section="${name}"]`)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.agenticSection = name;
    button.textContent = name[0].toUpperCase() + name.slice(1);
    opsNav.append(button);
  }
}

function markAgenticNavActive(name) {
  for (const button of opsNav.querySelectorAll('button[data-section], button[data-agentic-section]')) {
    button.classList.toggle('active', button.dataset.agenticSection === name);
  }
}

function openCoreOpsSection(name) {
  agenticSection = null;
  opsSection = name;
  return setLayout({ operations: 'OPEN' }).then(() => renderOps(snapshot));
}

function openAgenticSection(name) {
  if (!AGENTIC_SECTIONS.includes(name)) return Promise.resolve();
  agenticSection = name;
  return setLayout({ operations: 'OPEN' }).then(() => renderAgenticSection(snapshot));
}

function renderAttention(next) {
  const fragment = document.createDocumentFragment();
  const items = attentionQueue(next);
  fragment.append(hero('Attention', 'Trusted shell projections only. Untrusted page text never becomes control authority.', items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'clear'));
  const grid = el('div', 'opsGrid');
  grid.append(
    metric('Critical', items.filter((item) => item.tone === 'bad').length, items.some((item) => item.tone === 'bad') ? 'bad' : 'good'),
    metric('Warnings', items.filter((item) => item.tone === 'warn').length, items.some((item) => item.tone === 'warn') ? 'warn' : 'good'),
    metric('Context tabs', agenticContextRows(next).length, agenticContextRows(next).length ? 'good' : 'neutral'),
    metric('Authority effect', 'NONE', 'good'),
  );
  fragment.append(grid);
  if (!items.length) {
    const clear = section('Current readback', 'no derived attention items');
    clear.list.append(kvRow('State', 'CLEAR', 'good'));
    fragment.append(clear.wrap);
    return fragment;
  }
  const list = section('Derived queue', 'read only; no automatic remediation');
  list.list.className = 'entityList';
  for (const item of items) list.list.append(entityRow(item.title, item.detail, [{ value: item.target, tone: item.tone }, { value: 'no auto action', tone: 'neutral' }]));
  fragment.append(list.wrap);
  return fragment;
}

function renderActivity(next) {
  const fragment = document.createDocumentFragment();
  const supervisor = next?.supervisor;
  const command = supervisor?.current_command;
  const cycle = supervisor?.devos_task_cycle;
  const mesh = supervisor?.supervisor_mesh?.mesh;
  const observer = supervisor?.worker_observer;
  fragment.append(hero('Activity', 'Compact evidence from existing Supervisor, Fleet, Mesh and DevOS state.', command ? 'command in flight' : 'read only'));
  const current = section('Current execution', 'exact already-exposed state');
  current.list.append(
    kvRow('Current command', command ? text(command.action, 'COMMAND') : 'NONE', command ? 'warn' : 'good'),
    kvRow('Target tab', command?.target_tab_id || 'NONE', command?.target_tab_id ? 'warn' : 'neutral'),
    kvRow('Last command', supervisor?.last_command_status || 'NONE', stateTone(supervisor?.last_command_status)),
    kvRow('DevOS cycle', cycle?.state || 'UNKNOWN', cycle ? stateTone(cycle.state) : 'neutral'),
    kvRow('Worker observer', observer ? (observer.last_error ? 'DEGRADED' : 'EXPOSED') : 'UNKNOWN', observer?.last_error ? 'bad' : (observer ? 'good' : 'neutral')),
  );
  fragment.append(current.wrap);
  const meshState = section('Parallel control context', 'routing preference is not actuation authority');
  meshState.list.append(
    kvRow('Mesh epoch', mesh?.mesh_epoch ?? 'UNKNOWN', mesh ? 'good' : 'neutral'),
    kvRow('Active supervisors', mesh?.counts?.active ?? 'UNKNOWN', Number(mesh?.counts?.active || 0) ? 'good' : 'neutral'),
    kvRow('Ambiguous incarnation', mesh?.counts?.ambiguous_incarnation ?? 'UNKNOWN', Number(mesh?.counts?.ambiguous_incarnation || 0) ? 'bad' : (mesh?.counts ? 'good' : 'neutral')),
    kvRow('Fleet active', next?.fleet?.counts?.ACTIVE ?? 'UNKNOWN', Number(next?.fleet?.counts?.ACTIVE || 0) ? 'good' : 'neutral'),
    kvRow('Fleet ambiguous', next?.fleet?.counts?.PROVISIONING_AMBIGUOUS ?? 'UNKNOWN', Number(next?.fleet?.counts?.PROVISIONING_AMBIGUOUS || 0) ? 'bad' : (next?.fleet ? 'good' : 'neutral')),
  );
  fragment.append(meshState.wrap);
  return fragment;
}

function renderContextSet(next) {
  const fragment = document.createDocumentFragment();
  const rows = agenticContextRows(next);
  const current = selectedTab(next);
  const currentPinned = current ? agenticContextTabIds.includes(String(current.tab_id)) : false;
  fragment.append(hero('Context Set', 'Explicit operator-selected open tabs. Titles/URLs stay local; no page text is persisted by this feature.', `${rows.length}/${AGENTIC_CONTEXT_MAX_TABS}`));
  const actions = el('div', 'commandList');
  actions.append(
    commandButton(currentPinned ? 'Remove current tab' : 'Add current tab', current ? compact(current.title || hostFor(current.url), 36) : 'No active tab', () => {
      if (!current) return;
      toggleAgenticContextTab(current.tab_id);
      renderAgenticSection(snapshot);
    }),
    commandButton('Clear Context Set', 'Local renderer state only', () => {
      agenticContextTabIds = [];
      persistAgenticContextTabIds();
      renderAgenticSection(snapshot);
    }),
    commandButton('Reveal Context Rail', 'Expanded native-inset rail', () => setLayout({ sidebar: 'EXPANDED', operations: 'OPEN' })),
  );
  fragment.append(actions);
  const list = section('Selected tabs', rows.length ? `${rows.length} explicit binding(s)` : 'empty');
  list.list.className = 'commandList';
  for (const row of rows) {
    const label = text(row.tab.title, row.tab.kind === 'CHATGPT' ? 'ChatGPT' : hostFor(row.tab.url));
    const hint = row.workspace
      ? `${compact(row.workspace.branch_name, 26)} · ${row.workspace.state}`
      : (row.agent ? `${text(row.agent.role)} · ${text(row.agent.lifecycle_state)}` : hostFor(row.tab.url));
    list.list.append(commandButton(label, hint, () => api.command('SELECT_TAB', { tab_id: row.tab.tab_id })));
  }
  fragment.append(list.wrap);
  const contract = section('Context contract', 'non-authoritative convenience state');
  contract.list.append(
    kvRow('Persistence', 'LOCAL RENDERER STORAGE', 'good'),
    kvRow('Page text persistence', 'NONE', 'good'),
    kvRow('Maximum tabs', AGENTIC_CONTEXT_MAX_TABS, 'good'),
    kvRow('Scheduler authority', 'NONE', 'good'),
    kvRow('Browser actuation authority', 'NONE', 'good'),
  );
  fragment.append(contract.wrap);
  return fragment;
}

function renderSkills(next) {
  const fragment = document.createDocumentFragment();
  fragment.append(hero('Workbench Skills', 'Reusable bounded workflows. No arbitrary scripts, model commands, or automatic page actions.', 'bounded'));
  const list = el('div', 'commandList');
  list.append(
    commandButton('Research Focus', 'Expand Context Rail + open Context Set', () => setLayout({ sidebar: 'EXPANDED', operations: 'OPEN' }).then(() => openAgenticSection('context'))),
    commandButton('Triage Attention', 'Open derived read-only attention queue', () => openAgenticSection('attention')),
    commandButton('Activity Trace', 'Open compact execution evidence', () => openAgenticSection('activity')),
    commandButton('Fleet Transport Review', 'Open existing trusted Fleet panel', () => openCoreOpsSection('fleet')),
    commandButton('Workspace Binding Review', 'Open existing typed Workspace panel', () => openCoreOpsSection('workspaces')),
    commandButton('Authority Review', 'Open existing Safety contracts', () => openCoreOpsSection('safety')),
    commandButton('Toggle current Context tab', 'Explicit local context selection', () => {
      const current = selectedTab(next);
      if (!current) return;
      toggleAgenticContextTab(current.tab_id);
      renderAgenticSection(snapshot);
    }),
    commandButton('New ChatGPT tab', 'Explicit local tab action', () => api.command('NEW_CHATGPT', {})),
  );
  fragment.append(list);
  const contract = section('Skill contract', 'what these workflows cannot do');
  contract.list.append(
    kvRow('Arbitrary eval', 'FORBIDDEN', 'good'),
    kvRow('Direct page/model authority', 'NONE', 'good'),
    kvRow('Automatic effect retry', 'NONE', 'good'),
    kvRow('Second scheduler', 'NONE', 'good'),
  );
  fragment.append(contract.wrap);
  return fragment;
}

function renderAgenticSection(next) {
  if (!agenticSection) return;
  pruneAgenticContext(next);
  markAgenticNavActive(agenticSection);
  let content;
  if (agenticSection === 'attention') content = renderAttention(next);
  else if (agenticSection === 'activity') content = renderActivity(next);
  else if (agenticSection === 'context') content = renderContextSet(next);
  else content = renderSkills(next);
  opsContent.replaceChildren(content);
}

function tabSearchMatches(next, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const groups = workspaceProjection(next).groups;
  return (next?.tabs?.tabs || []).filter((tab) => {
    const agent = fleetAgentForTab(next, tab.tab_id);
    const group = groups.find((row) => String(row.tab_id) === String(tab.tab_id));
    return [tab.title, tab.url, agent?.role, agent?.lifecycle_state, group?.branch_name, group?.point_id, group?.state]
      .some((value) => String(value || '').toLowerCase().includes(needle));
  });
}

function workbenchCommandTarget(token) {
  const normalized = String(token || '').trim().toLowerCase();
  const aliases = Object.freeze({
    attention: ['agentic', 'attention'], activity: ['agentic', 'activity'], context: ['agentic', 'context'], skills: ['agentic', 'skills'],
    fleet: ['core', 'fleet'], workspaces: ['core', 'workspaces'], supervisor: ['core', 'supervisor'], devos: ['core', 'devos'],
    runtime: ['core', 'runtime'], safety: ['core', 'safety'], commands: ['core', 'commands'], overview: ['core', 'overview'],
  });
  return aliases[normalized] || null;
}

function runWorkbenchSkill(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (normalized === 'research') return setLayout({ sidebar: 'EXPANDED', operations: 'OPEN' }).then(() => openAgenticSection('context'));
  if (normalized === 'triage') return openAgenticSection('attention');
  if (normalized === 'activity') return openAgenticSection('activity');
  if (normalized === 'authority') return openCoreOpsSection('safety');
  if (normalized === 'context') return openAgenticSection('context');
  if (normalized === 'new') return api.command('NEW_CHATGPT', {});
  return openAgenticSection('skills');
}

function executeWorkbenchAddress(value) {
  const input = String(value || '').trim();
  if (!input) return false;
  if (input.startsWith('>')) {
    const target = workbenchCommandTarget(input.slice(1));
    if (!target) return openAgenticSection('skills').then(() => true);
    return (target[0] === 'agentic' ? openAgenticSection(target[1]) : openCoreOpsSection(target[1])).then(() => true);
  }
  if (input.startsWith('/')) return Promise.resolve(runWorkbenchSkill(input.slice(1))).then(() => true);
  if (input.startsWith('@')) {
    const query = input.slice(1).trim();
    if (query === '+') {
      const current = selectedTab(snapshot);
      if (current) toggleAgenticContextTab(current.tab_id);
      return openAgenticSection('context').then(() => true);
    }
    const matches = tabSearchMatches(snapshot, query);
    if (matches.length === 1) return api.command('SELECT_TAB', { tab_id: matches[0].tab_id }).then(() => true);
    tabFilter = query;
    tabSearch.value = query;
    return setLayout({ sidebar: 'EXPANDED' }).then(() => {
      renderContextRail(snapshot);
      return true;
    });
  }
  return false;
}

function updateWorkbenchRouteKind() {
  if (document.activeElement !== address) return;
  const value = String(address.value || '').trim();
  if (value.startsWith('>')) routeKind.textContent = 'CMD';
  else if (value.startsWith('@')) routeKind.textContent = 'TAB';
  else if (value.startsWith('/')) routeKind.textContent = 'SKILL';
}

installAgenticNav();
opsNav.addEventListener('click', (event) => {
  const agentic = event.target.closest('button[data-agentic-section]');
  if (agentic) {
    event.preventDefault();
    agenticSection = agentic.dataset.agenticSection;
    renderAgenticSection(snapshot);
    return;
  }
  if (event.target.closest('button[data-section]')) agenticSection = null;
});

address.addEventListener('input', updateWorkbenchRouteKind);
document.addEventListener('keydown', (event) => {
  const control = event.ctrlKey || event.metaKey;
  if (control && !event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    event.stopImmediatePropagation();
    address.focus();
    address.value = '>';
    address.setSelectionRange(address.value.length, address.value.length);
    routeKind.textContent = 'CMD';
    return;
  }
  if (document.activeElement === address && event.key === 'Enter' && /^[>@/]/.test(String(address.value || '').trim())) {
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve(executeWorkbenchAddress(address.value)).catch(() => {});
  }
}, true);

document.addEventListener('click', (event) => {
  const go = event.target.closest('.goButton');
  if (!go || !/^[>@/]/.test(String(address.value || '').trim())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  Promise.resolve(executeWorkbenchAddress(address.value)).catch(() => {});
}, true);

api.onSnapshot((next) => {
  pruneAgenticContext(next);
  if (agenticSection) renderAgenticSection(next);
  updateWorkbenchRouteKind();
});
