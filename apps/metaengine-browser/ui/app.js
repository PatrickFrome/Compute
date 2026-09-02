const api = window.metaengineShell;
const tabsEl = document.getElementById('tabs');
const address = document.getElementById('address');
const routeKind = document.getElementById('routeKind');
const versionEl = document.getElementById('version');
const statusEls = Object.freeze({
  fleet: document.getElementById('fleetStatus'),
  supervisor: document.getElementById('supervisorStatus'),
  update: document.getElementById('updateStatus'),
  dev: document.getElementById('devPlaneStatus'),
  compute: document.getElementById('computeStatus'),
  gates: document.getElementById('gateStatus'),
});
let snapshot = null;

function text(value, fallback = '—') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function compact(value, max = 18) {
  const out = text(value);
  return out.length > max ? `${out.slice(0, Math.max(1, max - 1))}…` : out;
}

function setSystemStatus(element, { value, tone = 'neutral', title = '' } = {}) {
  if (!element) return;
  element.classList.remove('good', 'warn', 'bad', 'neutral');
  element.classList.add(['good', 'warn', 'bad'].includes(tone) ? tone : 'neutral');
  const valueEl = element.querySelector('.systemValue');
  if (valueEl) valueEl.textContent = text(value);
  if (title) element.title = title;
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
  const tone = ambiguous > 0 ? 'bad' : (lost > 0 || bound > 0 ? 'warn' : (active > 0 ? 'good' : 'neutral'));
  return {
    value: `${active}/${total}`,
    tone,
    title: `Fleet · ${active} active · ${bound} bound unverified · ${ambiguous} ambiguous · ${lost} lost · ${text(fleet.readiness_contract, 'no readiness contract')}`,
  };
}

function supervisorStatus(next) {
  const supervisor = next?.supervisor;
  if (!supervisor) return { value: 'unknown', tone: 'neutral', title: 'Supervisor snapshot unavailable' };
  const mode = text(supervisor.supervisor_mode, 'OFF').toUpperCase();
  const armed = supervisor.armed === true;
  const running = supervisor.running === true;
  const hasError = Boolean(supervisor.last_error || supervisor.devos_last_error);
  const tone = hasError ? 'bad' : (running && mode === 'CONTROL' && armed ? 'good' : (running ? 'warn' : 'neutral'));
  const value = mode === 'CONTROL' ? `${armed ? 'ARM' : 'SAFE'}` : compact(mode, 10);
  return {
    value,
    tone,
    title: `Supervisor · ${mode} · ${armed ? 'armed' : 'disarmed'} · ${running ? 'running' : 'stopped'}${hasError ? ` · ${text(supervisor.last_error || supervisor.devos_last_error)}` : ''}`,
  };
}

function updateStatus(next) {
  const update = next?.supervisor?.self_update;
  if (!update) return { value: 'unknown', tone: 'neutral', title: 'Self-update snapshot unavailable' };
  const state = text(update.state, 'UNKNOWN').toUpperCase();
  const badStates = new Set(['ERROR', 'REJECTED_METADATA', 'DISCOVERY_ERROR']);
  const activeStates = new Set(['APPROVED_DOWNLOAD', 'DOWNLOADING', 'READY_RESTART', 'RESTART_GRACE', 'RESTARTING']);
  const goodStates = new Set(['CURRENT', 'IDLE', 'NO_UPDATE', 'READY']);
  const tone = badStates.has(state) ? 'bad' : (activeStates.has(state) ? 'warn' : (goodStates.has(state) ? 'good' : 'neutral'));
  const available = update.available_version || update.downloaded_version || null;
  return {
    value: available && available !== update.current_version ? compact(available, 12) : compact(state.replaceAll('_', ' '), 12),
    tone,
    title: `Self-update · ${state} · current ${text(update.current_version)}${available ? ` · target ${available}` : ''} · automatic effect retry disabled`,
  };
}

function developmentPlaneStatus(next) {
  const dev = next?.development_plane;
  if (!dev) return { value: 'unknown', tone: 'neutral', title: 'Development Plane snapshot unavailable' };
  const state = text(dev.state, 'UNKNOWN').toUpperCase();
  const tone = state === 'READY' ? 'good' : (['ERROR', 'FAILED', 'CRASHED'].includes(state) ? 'bad' : 'warn');
  return {
    value: compact(state, 10),
    tone,
    title: `Development Plane · ${state}${dev.version ? ` · ${dev.version}` : ''}`,
  };
}

function computeStatus(next) {
  const compute = next?.compute;
  if (!compute) return { value: 'unknown', tone: 'neutral', title: 'Compute snapshot unavailable' };
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

function renderTabs(next) {
  const tabState = next?.tabs || {};
  const selectedId = tabState.selected_tab_id;
  const tabs = Array.isArray(tabState.tabs) ? tabState.tabs : [];
  const selected = tabs.find((tab) => tab.tab_id === selectedId) || null;
  if (selected && document.activeElement !== address) address.value = selected.url || '';
  routeKind.textContent = selected?.kind === 'CHATGPT' ? 'CHAT' : 'WEB';
  routeKind.classList.toggle('chat', selected?.kind === 'CHATGPT');

  tabsEl.replaceChildren(...tabs.map((tab) => {
    const active = tab.tab_id === selectedId;
    const wrap = document.createElement('div');
    wrap.className = `tab ${active ? 'active' : ''} ${tab.kind === 'CHATGPT' ? 'chat' : 'web'}`;
    wrap.dataset.tabId = tab.tab_id;

    const select = document.createElement('button');
    select.className = 'tabSelect';
    select.textContent = tab.title || (tab.kind === 'CHATGPT' ? 'ChatGPT' : tab.url) || 'Untitled';
    select.title = tab.url || select.textContent;
    select.setAttribute('aria-label', `${active ? 'Current tab' : 'Select tab'}: ${select.textContent}`);
    select.onclick = () => api.command('SELECT_TAB', { tab_id: tab.tab_id }).catch(() => {});

    const close = document.createElement('button');
    close.className = 'tabClose';
    close.textContent = '×';
    close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${select.textContent}`);
    close.onclick = (event) => {
      event.stopPropagation();
      api.command('CLOSE_TAB', { tab_id: tab.tab_id }).catch(() => {});
    };

    wrap.append(select, close);
    return wrap;
  }));
}

function render(next) {
  snapshot = next || null;
  versionEl.textContent = next?.version ? `v${next.version}` : 'Browser';
  renderTabs(next);
  setSystemStatus(statusEls.fleet, fleetStatus(next));
  setSystemStatus(statusEls.supervisor, supervisorStatus(next));
  setSystemStatus(statusEls.update, updateStatus(next));
  setSystemStatus(statusEls.dev, developmentPlaneStatus(next));
  setSystemStatus(statusEls.compute, computeStatus(next));
  setSystemStatus(statusEls.gates, gateStatus(next));
}

document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => {
  api.command(button.dataset.cmd, {}).catch(() => {});
}));
document.getElementById('newChat').addEventListener('click', () => api.command('NEW_CHATGPT', {}).catch(() => {}));
document.getElementById('addressForm').addEventListener('submit', (event) => {
  event.preventDefault();
  api.command('NAVIGATE', { url: address.value }).catch(() => {});
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    address.focus();
    address.select();
  }
});

api.onSnapshot(render);
api.snapshot().then(render).catch(() => render(snapshot));
