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
  try { return new URL(String(value || '')).hostname || 'web'; } catch { return 'web'; }
}
function stateTone(value) {
  const state = String(value || '').toUpperCase();
  if (['ACTIVE', 'READY', 'RUNNING', 'CURRENT', 'OK', 'RESTORED', 'PROVEN', 'CONFIRMED', 'AVAILABLE'].includes(state)) return 'good';
  if (['BOUND_UNVERIFIED', 'PROVISIONING', 'REGISTERED', 'MONITOR', 'DOWNLOADING', 'READY_RESTART', 'RESTART_GRACE', 'PARTIAL', 'STALE', 'DEGRADED', 'PENDING'].includes(state)) return 'warn';
  if (['AMBIGUOUS', 'PROVISIONING_AMBIGUOUS', 'LOST', 'FAILED', 'ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR', 'CRASHED'].includes(state)) return 'bad';
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
  const total = Array.isArray(fleet.agents) ? fleet.agents.length : Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
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
  const hasError = Boolean(supervisor.last_error || supervisor.devos_last_error);
  return {
    value: mode === 'CONTROL' ? (armed ? 'ARM' : 'SAFE') : compact(mode, 10),
    tone: hasError ? 'bad' : (running && mode === 'CONTROL' && armed ? 'good' : (running ? 'warn' : 'neutral')),
    title: `Supervisor · ${mode} · ${armed ? 'armed' : 'disarmed'} · ${running ? 'running' : 'stopped'}${hasError ? ` · ${text(supervisor.last_error || supervisor.devos_last_error)}` : ''}`,
  };
}
function updateStatus(next) {
  const update = next?.supervisor?.self_update;
  if (!update) return { value: 'unknown', tone: 'neutral', title: 'Self-update snapshot unavailable' };
  const state = text(update.state, 'UNKNOWN').toUpperCase();
  const bad = new Set(['ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR']);
  const busy = new Set(['APPROVED_DOWNLOAD', 'DOWNLOADING', 'READY_RESTART', 'RESTART_GRACE', 'RESTARTING']);
  const good = new Set(['CURRENT', 'IDLE', 'NO_UPDATE', 'READY']);
  const available = update.available_version || update.downloaded_version || null;
  return {
    value: available && available !== update.current_version ? compact(available, 12) : compact(state.replaceAll('_', ' '), 12),
    tone: bad.has(state) ? 'bad' : (busy.has(state) ? 'warn' : (good.has(state) ? 'good' : 'neutral')),
    title: `Self-update · ${state} · current ${text(update.current_version)}${available ? ` · target ${available}` : ''} · automatic effect retry disabled`,
  };
}
function developmentPlaneStatus(next) {
  const dev = next?.development_plane;
  if (!dev) return { value: 'unknown', tone: 'neutral', title: 'Development Plane snapshot unavailable' };
  const state = text(dev.state, 'UNKNOWN').toUpperCase();
  return { value: compact(state, 10), tone: state === 'READY' ? 'good' : (['ERROR', 'FAILED', 'CRASHED'].includes(state) ? 'bad' : 'warn'), title: `Development Plane · ${state}${dev.version ? ` · ${dev.version}` : ''}` };
}
function computeStatus(next) {
  const compute = next?.compute;
  if (!compute) return { value: 'unknown', tone: 'neutral', title: 'Compute health unavailable' };
  const available = compute.available === true;
  const runtime = compute?.result?.runtime || (available ? 'ready' : 'offline');
  return { value: compact(runtime, 12), tone: available ? 'good' : 'bad', title: `Compute · ${available ? 'available' : 'offline'} · ${text(runtime)}` };
}
function gateStatus(next) {
  const gates = next?.owner_safety_gates;
  if (!gates) return { value: 'unknown', tone: 'neutral', title: 'Owner safety gate snapshot unavailable' };
  const overrides = Array.isArray(gates.overrides) ? gates.overrides.length : 0;
  const wildcard = gates.wildcard_disabled === true;
  return {
    value: wildcard ? 'ALL' : (overrides ? `${overrides} override${overrides === 1 ? '' : 's'}` : 'sealed'),
    tone: wildcard ? 'bad' : (overrides ? 'warn' : 'good'),
    title: wildcard ? 'Owner safety gates · wildcard override active' : `Owner safety gates · ${overrides ? `${overrides} explicit override(s) active` : 'no overrides active'}`,
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
function applyLayout(next) {
  const layout = next?.layout;
  if (!layout) return;
  if (layout.requested) requestedLayout = {
    sidebar: text(layout.requested.sidebar, requestedLayout.sidebar).toUpperCase(),
    operations: text(layout.requested.operations, requestedLayout.operations).toUpperCase(),
  };
  const sidebarWidth = Math.max(0, Number(layout?.sidebar_bounds?.width || 0));
  const opsWidth = Math.max(0, Number(layout?.operations_bounds?.width || 0));
  body.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  body.style.setProperty('--ops-width', `${opsWidth}px`);
  body.dataset.sidebar = text(layout.effective_sidebar, 'HIDDEN').toUpperCase();
  body.dataset.operations = text(layout.effective_operations, 'CLOSED').toUpperCase();
  railGeometry.textContent = layout.overlay_remote_content === false ? `Inset ${sidebarWidth}px` : 'Geometry unknown';
}
async function setLayout(patch = {}) {
  requestedLayout = { sidebar: patch.sidebar || requestedLayout.sidebar, operations: patch.operations || requestedLayout.operations };
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
  if (!tab) {
    activeKind.textContent = '—'; activeTitle.textContent = 'No active tab'; activeMeta.textContent = 'Awaiting browser state'; return;
  }
  const chat = tab.kind === 'CHATGPT';
  activeKind.textContent = chat ? 'C' : 'W';
  activeTitle.textContent = text(tab.title, chat ? 'ChatGPT' : hostFor(tab.url));
  activeMeta.textContent = agent ? `${text(agent.role, 'AGENT')} · ${text(agent.lifecycle_state, 'UNKNOWN')} · g${Number(agent.generation_epoch || 0)}` : hostFor(tab.url);
  if (document.activeElement !== address) address.value = tab.url || '';
  routeKind.textContent = chat ? 'CHAT' : 'WEB';
  routeKind.classList.toggle('chat', chat);
}
function makeTabRow(tab, active, agent) {
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
  avatar.textContent = agent ? text(agent.role, 'A').slice(0, 1) : (tab.kind === 'CHATGPT' ? 'C' : 'W');
  const dot = document.createElement('i');
  dot.className = `tabStateDot ${agent ? stateTone(agent.lifecycle_state) : 'neutral'}`;
  avatar.append(dot);

  const copy = document.createElement('span');
  copy.className = 'tabCopy';
  const title = document.createElement('strong');
  title.textContent = text(tab.title, tab.kind === 'CHATGPT' ? 'ChatGPT' : hostFor(tab.url));
  const meta = document.createElement('small');
  meta.textContent = agent ? `${text(agent.role)} · ${text(agent.lifecycle_state)}` : hostFor(tab.url);
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
function renderContextRail(next) {
  const state = next?.tabs || {};
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  const filter = tabFilter.trim().toLowerCase();
  const shown = tabs.filter((tab) => {
    if (!filter) return true;
    const agent = fleetAgentForTab(next, tab.tab_id);
    return [tab.title, tab.url, agent?.role, agent?.lifecycle_state].some((value) => String(value || '').toLowerCase().includes(filter));
  });
  tabCount.textContent = String(tabs.length);
  verticalTabs.replaceChildren(...shown.map((tab) => makeTabRow(tab, tab.tab_id === state.selected_tab_id, fleetAgentForTab(next, tab.tab_id))));
  const profile = next?.fleet?.policy?.profile;
  const active = Number(next?.fleet?.counts?.ACTIVE || 0);
  const total = Array.isArray(next?.fleet?.agents) ? next.fleet.agents.length : 0;
  fleetProfile.textContent = profile ? `${profile} · ${active}/${total} active` : 'Fleet unknown';
}

function el(tag, className = '', value = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}
function metric(label, value, tone = 'neutral') {
  const card = el('div', `metricCard ${tone}`); card.append(el('span', '', label), el('strong', '', text(value))); return card;
}
function kvRow(label, value, tone = 'neutral') {
  const row = el('div', 'kvRow'); row.append(el('span', '', label), el('b', tone, text(value))); return row;
}
function section(title, subtitle = '') {
  const wrap = el('section', 'opsSection');
  const head = el('div', 'opsSectionTitle'); head.append(el('strong', '', title), el('span', '', subtitle));
  const list = el('div', 'kvList'); wrap.append(head, list); return { wrap, list };
}
function hero(title, subtitle, badge) {
  const wrap = el('div', 'opsHero'); const top = el('div', 'opsHeroTop');
  top.append(el('strong', '', title), el('span', 'heroBadge', badge)); wrap.append(top, el('small', '', subtitle)); return wrap;
}
function entityRow(title, status, tags = []) {
  const row = el('div', 'entityRow'); const top = el('div', 'entityTop');
  top.append(el('strong', '', title), el('span', '', status));
  const meta = el('div', 'entityMeta'); for (const tag of tags) meta.append(el('span', `tinyTag ${tag.tone || ''}`.trim(), tag.value));
  row.append(top, meta); return row;
}

function renderOverview(next) {
  const fragment = document.createDocumentFragment();
  const layout = next?.layout;
  fragment.append(hero(`METAENGINE Browser ${text(next?.version, '')}`.trim(), 'Native-inset workbench. Page/model content remains untrusted; operations telemetry is read-only in this surface.', layout?.overlay_remote_content === false ? 'native geometry' : 'geometry unknown'));
  const grid = el('div', 'opsGrid'); const fleet = fleetStatus(next); const supervisor = supervisorStatus(next); const devos = next?.supervisor?.devos_task_cycle; const update = updateStatus(next);
  grid.append(metric('Fleet', fleet.value, fleet.tone), metric('Supervisor', supervisor.value, supervisor.tone), metric('DevOS cycle', devos ? text(devos.state, 'UNKNOWN') : 'UNKNOWN', devos ? stateTone(devos.state) : 'neutral'), metric('Self update', update.value, update.tone)); fragment.append(grid);
  const evidence = section('Authority & evidence', 'local projection');
  evidence.list.append(kvRow('Effect binding', next?.supervisor?.generic_tab_effect_binding || 'UNKNOWN', next?.supervisor?.generic_tab_effect_binding ? 'good' : 'neutral'), kvRow('DevOS scheduler', next?.supervisor?.devos_scheduler_source || 'UNKNOWN', next?.supervisor?.devos_scheduler_source ? 'good' : 'neutral'), kvRow('Second DevOS loop', next?.supervisor?.devos_second_polling_loop === false ? 'NO' : 'UNKNOWN', next?.supervisor?.devos_second_polling_loop === false ? 'good' : 'neutral'), kvRow('Arbitrary eval', next?.supervisor?.arbitrary_eval === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.arbitrary_eval === false ? 'good' : 'neutral'), kvRow('OS shell authority', next?.supervisor?.os_shell_authority === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.os_shell_authority === false ? 'good' : 'neutral')); fragment.append(evidence.wrap);
  const exposure = section('Runtime exposure', 'do not infer missing modules');
  exposure.list.append(kvRow('Fleet / transport', next?.fleet ? 'EXPOSED' : 'UNKNOWN', next?.fleet ? 'good' : 'neutral'), kvRow('Worker observer', next?.supervisor?.worker_observer ? 'EXPOSED' : 'UNKNOWN', next?.supervisor?.worker_observer ? 'good' : 'neutral'), kvRow('Crash sentinel', 'NOT EXPOSED', 'muted'), kvRow('Host resilience', 'NOT EXPOSED', 'muted')); fragment.append(exposure.wrap);
  return fragment;
}
function renderFleet(next) {
  const fragment = document.createDocumentFragment(); const fleet = next?.fleet;
  if (!fleet) { fragment.append(hero('Fleet unavailable', 'No local fleet snapshot is exposed. The UI does not infer fleet health from tabs.', 'unknown')); return fragment; }
  fragment.append(hero('Fleet transport plane', `${text(fleet.readiness_contract, 'readiness unknown')} · ${text(fleet.policy?.profile, 'profile unknown')}`, 'exact binding'));
  const grid = el('div', 'opsGrid');
  grid.append(metric('Active', Number(fleet.counts?.ACTIVE || 0), Number(fleet.counts?.ACTIVE || 0) ? 'good' : 'neutral'), metric('Bound', Number(fleet.counts?.BOUND_UNVERIFIED || 0), Number(fleet.counts?.BOUND_UNVERIFIED || 0) ? 'warn' : 'good'), metric('Ambiguous', Number(fleet.counts?.PROVISIONING_AMBIGUOUS || 0), Number(fleet.counts?.PROVISIONING_AMBIGUOUS || 0) ? 'bad' : 'good'), metric('Lost', Number(fleet.counts?.LOST || 0), Number(fleet.counts?.LOST || 0) ? 'bad' : 'good')); fragment.append(grid);
  const listSection = section('Agents', `${Array.isArray(fleet.agents) ? fleet.agents.length : 0} registered`); listSection.list.className = 'entityList';
  for (const agent of fleet.agents || []) {
    const proof = agent.transport_proof;
    listSection.list.append(entityRow(`${text(agent.role, 'WORKER')} · ${shortId(agent.agent_id, 14)}`, text(agent.lifecycle_state, 'UNKNOWN'), [{ value: `g${Number(agent.generation_epoch || 0)}`, tone: 'neutral' }, { value: agent.tab_id ? `tab ${shortId(agent.tab_id, 12)}` : 'no tab', tone: agent.tab_id ? 'neutral' : 'warn' }, { value: proof ? 'transport proven' : 'transport unproven', tone: proof ? 'good' : (agent.lifecycle_state === 'ACTIVE' ? 'bad' : 'warn') }]));
  }
  fragment.append(listSection.wrap); return fragment;
}
function renderSupervisor(next) {
  const fragment = document.createDocumentFragment(); const sup = next?.supervisor;
  if (!sup) { fragment.append(hero('Supervisor unavailable', 'No supervisor snapshot is exposed. This is UNKNOWN, not an offline proof.', 'unknown')); return fragment; }
  fragment.append(hero('Native supervisor', `${text(sup.supervisor_mode, 'UNKNOWN')} · ${sup.armed === true ? 'armed' : 'disarmed'} · ${sup.running === true ? 'running' : 'stopped'}`, sup.last_error || sup.devos_last_error ? 'degraded' : 'local'));
  const core = section('Core state', 'heartbeat authority');
  core.list.append(kvRow('Mode', sup.supervisor_mode || 'UNKNOWN', stateTone(sup.supervisor_mode)), kvRow('Armed', sup.armed === true ? 'TRUE' : 'FALSE', sup.armed === true ? 'good' : 'warn'), kvRow('Enrollment', sup.enrollment_status || 'UNKNOWN', stateTone(sup.enrollment_status)), kvRow('Heartbeat', sup.last_heartbeat_at || 'UNKNOWN', sup.last_heartbeat_at ? 'good' : 'neutral'), kvRow('Last command', sup.last_command_status || 'NONE', stateTone(sup.last_command_status)), kvRow('Error', sup.last_error || sup.devos_last_error || 'NONE', sup.last_error || sup.devos_last_error ? 'bad' : 'good')); fragment.append(core.wrap);
  const watchdog = sup.bootstrap_heartbeat; const watchdogSection = section('Heartbeat watchdog', 'no command leasing');
  watchdogSection.list.append(kvRow('Mode', watchdog?.mode || 'UNKNOWN', watchdog ? 'good' : 'neutral'), kvRow('Last watchdog pulse', watchdog?.last_at || 'UNKNOWN', watchdog?.last_at ? 'good' : 'neutral'), kvRow('Control authority', watchdog?.control_authority === false ? 'NONE' : 'UNKNOWN', watchdog?.control_authority === false ? 'good' : 'neutral'), kvRow('Command leasing', watchdog?.command_leasing === false ? 'NONE' : 'UNKNOWN', watchdog?.command_leasing === false ? 'good' : 'neutral')); fragment.append(watchdogSection.wrap);
  const mesh = sup.supervisor_mesh; const meshSection = section('Supervisor mesh', sup.supervisor_mesh_wire_projection || 'projection unknown');
  meshSection.list.append(kvRow('State', mesh?.state || mesh?.lifecycle_state || (mesh ? 'EXPOSED' : 'UNKNOWN'), mesh ? 'good' : 'neutral'), kvRow('Actuation authority', mesh?.actuation_authority === false ? 'NONE' : text(mesh?.actuation_authority, 'UNKNOWN'), mesh?.actuation_authority === false ? 'good' : 'neutral'), kvRow('Instances', Array.isArray(mesh?.instances) ? mesh.instances.length : 'UNKNOWN', 'neutral')); fragment.append(meshSection.wrap); return fragment;
}
function renderDevos(next) {
  const fragment = document.createDocumentFragment(); const sup = next?.supervisor; const cycle = sup?.devos_task_cycle;
  if (!cycle) { fragment.append(hero('DevOS cycle unavailable', 'DevOS is not exposed by the current local supervisor snapshot.', 'unknown')); return fragment; }
  fragment.append(hero('DevOS fleet scheduler', 'One bounded stage of the native supervisor heartbeat; no second polling loop.', text(cycle.state, 'UNKNOWN')));
  const grid = el('div', 'opsGrid'); grid.append(metric('Cycle', cycle.state || 'UNKNOWN', stateTone(cycle.state)), metric('Ready', cycle.backlog?.ready ?? '—', Number(cycle.backlog?.ready || 0) ? 'warn' : 'neutral'), metric('Running', cycle.backlog?.running ?? '—', Number(cycle.backlog?.running || 0) ? 'good' : 'neutral'), metric('Recovery', cycle.ambiguity_recovery?.state || 'NONE', stateTone(cycle.ambiguity_recovery?.state))); fragment.append(grid);
  const transport = section('Transport fencing', 'no blind retry');
  transport.list.append(kvRow('Bound-unverified dispatch', cycle.bound_unverified_dispatch_allowed === false ? 'FORBIDDEN' : 'UNKNOWN', cycle.bound_unverified_dispatch_allowed === false ? 'good' : 'neutral'), kvRow('Proof before dispatch', cycle.fleet_transport_proof_before_physical_dispatch === true ? 'REQUIRED' : 'UNKNOWN', cycle.fleet_transport_proof_before_physical_dispatch === true ? 'good' : 'neutral'), kvRow('Promotion', cycle.fleet_transport_promotion?.state || 'NONE', stateTone(cycle.fleet_transport_promotion?.state)), kvRow('Durable effect journal', cycle.durable_effect_delivery_journal === true ? 'ACTIVE' : 'UNKNOWN', cycle.durable_effect_delivery_journal === true ? 'good' : 'neutral'), kvRow('Scheduler source', sup?.devos_scheduler_source || 'UNKNOWN', sup?.devos_scheduler_source ? 'good' : 'neutral'), kvRow('Second loop', sup?.devos_second_polling_loop === false ? 'NO' : 'UNKNOWN', sup?.devos_second_polling_loop === false ? 'good' : 'neutral')); fragment.append(transport.wrap); return fragment;
}
function renderRuntime(next) {
  const fragment = document.createDocumentFragment(); fragment.append(hero('Runtime surfaces', 'Local runtime evidence only. Missing state remains UNKNOWN.', 'read only'));
  const update = next?.supervisor?.self_update; const continuity = next?.supervisor?.session_continuity; const dev = next?.development_plane; const compute = next?.compute; const downloads = next?.downloads; const observer = next?.supervisor?.worker_observer;
  const runtime = section('Runtime health', 'process-local');
  runtime.list.append(kvRow('Development Plane', dev?.state || 'UNKNOWN', dev ? stateTone(dev.state) : 'neutral'), kvRow('Compute', compute ? (compute.available === true ? 'AVAILABLE' : 'OFFLINE') : 'UNKNOWN', compute ? (compute.available === true ? 'good' : 'bad') : 'neutral'), kvRow('Downloads', downloads?.state || downloads?.status || (downloads ? 'EXPOSED' : 'UNKNOWN'), downloads ? stateTone(downloads.state || downloads.status) : 'neutral'), kvRow('Worker observer', observer ? 'EXPOSED' : 'UNKNOWN', observer ? 'good' : 'neutral'), kvRow('Observer error', observer?.last_error || 'NONE', observer?.last_error ? 'bad' : 'neutral')); fragment.append(runtime.wrap);
  const updateSection = section('Self-update continuity', 'restart resumable');
  updateSection.list.append(kvRow('Updater state', update?.state || 'UNKNOWN', update ? stateTone(update.state) : 'neutral'), kvRow('Current version', update?.current_version || next?.version || 'UNKNOWN', update?.current_version || next?.version ? 'good' : 'neutral'), kvRow('Available version', update?.available_version || 'NONE', update?.available_version ? 'warn' : 'neutral'), kvRow('Install barrier', update?.install_effect_barrier_mode || 'UNKNOWN', update?.install_effect_barrier_mode ? 'good' : 'neutral'), kvRow('Automatic effect retry', update?.automatic_effect_retry === false ? 'DISABLED' : 'UNKNOWN', update?.automatic_effect_retry === false ? 'good' : 'neutral'), kvRow('Session continuity', continuity?.state || 'UNKNOWN', continuity ? stateTone(continuity.state) : 'neutral')); fragment.append(updateSection.wrap); return fragment;
}
function renderSafety(next) {
  const fragment = document.createDocumentFragment(); const gates = next?.owner_safety_gates;
  fragment.append(hero('Safety & trust boundaries', 'This panel reports contracts. It does not disable or enable gates.', gates ? 'local policy' : 'unknown'));
  const guard = section('Browser authority', 'fail closed');
  guard.list.append(kvRow('Arbitrary eval', next?.supervisor?.arbitrary_eval === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.arbitrary_eval === false ? 'good' : 'neutral'), kvRow('OS shell authority', next?.supervisor?.os_shell_authority === false ? 'DISABLED' : 'UNKNOWN', next?.supervisor?.os_shell_authority === false ? 'good' : 'neutral'), kvRow('Remote overlay', next?.layout?.overlay_remote_content === false ? 'NONE' : 'UNKNOWN', next?.layout?.overlay_remote_content === false ? 'good' : 'neutral'), kvRow('Renderer dimensions', next?.layout?.renderer_dimensions_authoritative === false ? 'NON-AUTHORITATIVE' : 'UNKNOWN', next?.layout?.renderer_dimensions_authoritative === false ? 'good' : 'neutral'), kvRow('Effect binding', next?.supervisor?.generic_tab_effect_binding || 'UNKNOWN', next?.supervisor?.generic_tab_effect_binding ? 'good' : 'neutral')); fragment.append(guard.wrap);
  const gateSection = section('Owner safety gates', gates ? `${Array.isArray(gates.overrides) ? gates.overrides.length : 0} override(s)` : 'snapshot unavailable');
  gateSection.list.append(kvRow('Wildcard override', gates ? (gates.wildcard_disabled === true ? 'ACTIVE' : 'NONE') : 'UNKNOWN', gates ? (gates.wildcard_disabled === true ? 'bad' : 'good') : 'neutral'), kvRow('External platform gates', gates?.external_platform_gates_overridable === false ? 'NOT OVERRIDABLE' : 'UNKNOWN', gates?.external_platform_gates_overridable === false ? 'good' : 'neutral'), kvRow('Navigation policy', next?.policy ? 'EXPOSED' : 'UNKNOWN', next?.policy ? 'good' : 'neutral')); fragment.append(gateSection.wrap);
  if (Array.isArray(gates?.overrides) && gates.overrides.length) {
    const list = section('Active overrides', 'owner initiated'); list.list.className = 'entityList';
    for (const row of gates.overrides) list.list.append(entityRow(text(row.gate_id, 'gate'), row.expires_at ? 'TTL' : 'persistent', [{ value: compact(row.reason, 30), tone: 'warn' }])); fragment.append(list.wrap);
  }
  const exposure = section('Unexposed mechanisms', 'source presence is not runtime proof');
  exposure.list.append(kvRow('Browser sentinel', 'NOT EXPOSED', 'muted'), kvRow('Host resilience', 'NOT EXPOSED', 'muted'), kvRow('Parent progress lease', 'NOT EXPOSED', 'muted')); fragment.append(exposure.wrap); return fragment;
}
function commandButton(label, hint, action) {
  const button = el('button', 'commandButton'); button.type = 'button'; button.append(el('strong', '', label), el('span', '', hint)); button.onclick = () => Promise.resolve(action()).catch(() => {}); return button;
}
function renderCommands() {
  const fragment = document.createDocumentFragment(); fragment.append(hero('Command surface', 'Only local navigation and workbench layout commands are exposed here.', 'bounded'));
  const list = el('div', 'commandList');
  list.append(commandButton('New ChatGPT tab', 'Local tab action', () => api.command('NEW_CHATGPT', {})), commandButton('Focus address', 'Ctrl+L', () => { address.focus(); address.select(); }), commandButton('Back', 'Navigation history', () => api.command('BACK', {})), commandButton('Forward', 'Navigation history', () => api.command('FORWARD', {})), commandButton('Reload', 'Current tab only', () => api.command('RELOAD', {})), commandButton('Cycle Context Rail', 'Ctrl+B', cycleSidebar), commandButton('Toggle Operations', 'Ctrl+Shift+O', toggleOperations), commandButton('Open Safety contracts', 'Read only', () => { opsSection = 'safety'; renderOps(snapshot); }), commandButton('Open DevOS evidence', 'Read only', () => { opsSection = 'devos'; renderOps(snapshot); }));
  fragment.append(list); return fragment;
}
function renderOps(next) {
  for (const button of opsNav.querySelectorAll('button[data-section]')) button.classList.toggle('active', button.dataset.section === opsSection);
  let content;
  if (opsSection === 'fleet') content = renderFleet(next);
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
  applyLayout(next); renderActive(next); renderContextRail(next);
  setSystemStatus(statusEls.fleet, fleetStatus(next)); setSystemStatus(statusEls.supervisor, supervisorStatus(next)); setSystemStatus(statusEls.update, updateStatus(next)); setSystemStatus(statusEls.dev, developmentPlaneStatus(next)); setSystemStatus(statusEls.compute, computeStatus(next)); setSystemStatus(statusEls.gates, gateStatus(next)); renderOps(next);
}

document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => api.command(button.dataset.cmd, {}).catch(() => {})));
document.getElementById('newChat').addEventListener('click', () => api.command('NEW_CHATGPT', {}).catch(() => {}));
document.getElementById('sidebarToggle').addEventListener('click', () => cycleSidebar().catch(() => {}));
document.getElementById('railCollapse').addEventListener('click', () => cycleSidebar().catch(() => {}));
document.getElementById('operationsToggle').addEventListener('click', () => toggleOperations().catch(() => {}));
document.getElementById('operationsClose').addEventListener('click', () => toggleOperations('CLOSED').catch(() => {}));
opsNav.addEventListener('click', (event) => { const button = event.target.closest('button[data-section]'); if (!button) return; opsSection = button.dataset.section; renderOps(snapshot); });
tabSearch.addEventListener('input', () => { tabFilter = tabSearch.value || ''; renderContextRail(snapshot); });
document.getElementById('addressForm').addEventListener('submit', (event) => { event.preventDefault(); api.command('NAVIGATE', { url: address.value }).catch(() => {}); });
document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'l') { event.preventDefault(); address.focus(); address.select(); return; }
  if (ctrl && !event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); cycleSidebar().catch(() => {}); return; }
  if (ctrl && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); toggleOperations().catch(() => {}); return; }
  if (ctrl && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); opsSection = 'commands'; toggleOperations('OPEN').then(() => renderOps(snapshot)).catch(() => {}); }
});

api.onSnapshot(render);
api.snapshot().then(render).catch(() => render(snapshot));
