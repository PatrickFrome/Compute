const api = window.metaengineShell;
const tabsEl = document.getElementById('tabs');
const address = document.getElementById('address');
const compute = document.getElementById('compute');
const devConsole = document.getElementById('devConsole');
let snapshot = null;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null ? '—' : String(value);
}

function format(value) {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function badge(id, label, tone) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = label;
  el.className = `badge ${tone || ''}`.trim();
}

function boolLine(label, value) {
  return `${value === true ? '✓' : value === false ? '×' : '·'} ${label}: ${value == null ? 'unknown' : value}`;
}

async function command(name, payload = {}) {
  try {
    return await api.command(name, payload);
  } catch (error) {
    console.error(name, error);
    return null;
  }
}

function renderTabs(next) {
  const selected = next?.tabs?.tabs?.find((x) => x.tab_id === next.tabs.selected_tab_id);
  if (selected && document.activeElement !== address) address.value = selected.url || '';
  tabsEl.replaceChildren(...(next?.tabs?.tabs || []).map((tab) => {
    const wrap = document.createElement('div');
    wrap.className = `tab ${tab.tab_id === next.tabs.selected_tab_id ? 'active' : ''}`;
    const select = document.createElement('button');
    select.className = 'tabSelect';
    select.textContent = tab.title || (tab.kind === 'CHATGPT' ? 'ChatGPT' : tab.url);
    select.title = tab.url;
    select.onclick = () => { void command('SELECT_TAB', { tab_id: tab.tab_id }); };
    const close = document.createElement('button');
    close.className = 'tabClose';
    close.textContent = '×';
    close.onclick = () => { void command('CLOSE_TAB', { tab_id: tab.tab_id }); };
    wrap.append(select, close);
    return wrap;
  }));
}

function renderDp(next) {
  const dp = next?.development_plane;
  if (!dp) {
    badge('dpBadge', 'offline', 'bad');
    text('dpState', 'Development Plane is not initialized');
    return;
  }
  badge('dpBadge', dp.state || 'unknown', dp.state === 'READY' ? 'good' : dp.state === 'LOST' ? 'bad' : 'warn');
  text('dpState', [
    `version: ${dp.version || '—'}`,
    `pid: ${dp.pid || '—'}`,
    `capabilities: ${(dp.capabilities || []).length}`,
    boolLine('sandbox backend bound', dp.sandbox_backend_bound),
    boolLine('sandbox execution', dp.verification_sandbox_execution),
    boolLine('direct promotion', dp.direct_promote_current),
  ].join('\n'));
}

function renderGateway(next) {
  const dp = next?.development_plane;
  const verify = dp?.advisory_evidence_verification === true;
  const safe = verify
    && dp?.advisory_evidence_network_dispatch === false
    && dp?.advisory_evidence_browser_authority === false
    && dp?.advisory_evidence_promotion_authority === false;
  badge('gatewayBadge', safe ? 'verify-only' : verify ? 'check fences' : 'unavailable', safe ? 'good' : verify ? 'warn' : 'bad');
  text('gatewayState', [
    boolLine('evidence verification', dp?.advisory_evidence_verification),
    boolLine('network dispatch', dp?.advisory_evidence_network_dispatch),
    boolLine('browser authority', dp?.advisory_evidence_browser_authority),
    boolLine('promotion authority', dp?.advisory_evidence_promotion_authority),
    'trust target: persisted-readback / attested',
  ].join('\n'));
}

function renderFleet(next) {
  const fleet = next?.fleet;
  const online = next?.compute?.available === true;
  badge('fleetBadge', online ? 'compute ready' : 'compute offline', online ? 'good' : 'warn');
  text('fleetState', [
    `compute: ${online ? (next.compute?.result?.runtime || 'available') : 'offline'}`,
    `fleet profile: ${fleet?.profile || fleet?.policy?.profile || '—'}`,
    `fleet state: ${fleet?.state || fleet?.mode || '—'}`,
    `agents: ${fleet?.agents?.length ?? fleet?.agent_count ?? '—'}`,
  ].join('\n'));
}

function renderSecurity(next) {
  const dp = next?.development_plane;
  const policy = next?.policy || {};
  const checks = [
    policy.cookie_transfer_to_compute_space === false,
    dp?.browser_actuation_authority === false,
    dp?.direct_promote_current === false,
    dp?.verification_sandbox_execution === false,
    dp?.advisory_evidence_network_dispatch === false,
  ];
  const ok = checks.every(Boolean);
  badge('securityBadge', ok ? 'fenced' : 'attention', ok ? 'good' : 'bad');
  text('securityState', [
    boolLine('cookie transfer disabled', policy.cookie_transfer_to_compute_space === false),
    boolLine('browser actuation authority', dp?.browser_actuation_authority),
    boolLine('arbitrary eval', dp?.arbitrary_eval),
    boolLine('sandbox execution', dp?.verification_sandbox_execution),
    boolLine('direct promotion', dp?.direct_promote_current),
  ].join('\n'));
}

function renderSelfTest(next) {
  const report = next?.test_console?.last_self_test;
  const root = document.getElementById('selfTest');
  if (!report) {
    badge('selfTestBadge', 'not run', 'muted');
    root.replaceChildren();
    return;
  }
  badge('selfTestBadge', report.status, report.status === 'PASS' ? 'good' : report.status === 'WARN' ? 'warn' : 'bad');
  root.replaceChildren(...(report.checks || []).map((check) => {
    const row = document.createElement('div');
    row.className = `checkRow ${String(check.status || '').toLowerCase()}`;
    const state = document.createElement('span');
    state.className = 'checkState';
    state.textContent = check.status === 'PASS' ? '✓' : check.status === 'WARN' ? '!' : '×';
    const body = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = check.id;
    const detail = document.createElement('small');
    detail.textContent = format(check.detail).replace(/\n/g, ' ').slice(0, 240);
    body.append(name, detail);
    row.append(state, body);
    return row;
  }));
}

function renderEvents(next) {
  const data = next?.test_console?.diagnostics;
  const rows = [...(data?.events || [])].reverse();
  text('eventCount', `${rows.length}/${data?.limit || 120}`);
  const root = document.getElementById('events');
  root.replaceChildren(...rows.map((event) => {
    const row = document.createElement('div');
    row.className = `eventRow ${String(event.level || '').toLowerCase()}`;
    const head = document.createElement('div');
    const code = document.createElement('strong');
    code.textContent = `${event.level} · ${event.code}`;
    const at = document.createElement('span');
    at.textContent = `${event.sequence} · ${String(event.at || '').slice(11, 19)}`;
    head.append(code, at);
    const detail = document.createElement('small');
    detail.textContent = format(event.detail).replace(/\n/g, ' ').slice(0, 420);
    row.append(head, detail);
    return row;
  }));
}

function render(next) {
  snapshot = next;
  renderTabs(next);
  compute.textContent = next?.compute?.available ? `Compute: ${next.compute.result?.runtime || 'ready'}` : 'Compute: offline';
  compute.classList.toggle('ready', Boolean(next?.compute?.available));

  const consoleState = next?.test_console;
  devConsole.hidden = consoleState?.open === false;
  document.getElementById('toggleConsole').textContent = consoleState?.open === false ? 'Open Dev Console' : 'Hide Dev Console';
  text('buildMeta', `${consoleState?.build_version || 'test'} · ${consoleState?.runtime?.platform || '—'}/${consoleState?.runtime?.arch || '—'} · Electron ${consoleState?.runtime?.electron || '—'} · Chromium ${consoleState?.runtime?.chromium || '—'}`);

  renderDp(next);
  renderGateway(next);
  renderFleet(next);
  renderSecurity(next);
  renderSelfTest(next);
  renderEvents(next);
}

document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => { void command(button.dataset.cmd, {}); }));
document.getElementById('newChat').addEventListener('click', () => { void command('NEW_CHATGPT', {}); });
document.getElementById('addressForm').addEventListener('submit', (event) => { event.preventDefault(); void command('NAVIGATE', { url: address.value }); });
document.getElementById('toggleConsole').addEventListener('click', () => { void command('TEST_TOGGLE_CONSOLE', { open: snapshot?.test_console?.open === false }); });
document.getElementById('runSelfTest').addEventListener('click', () => { void command('TEST_RUN_SELF_CHECK'); });
document.getElementById('clearEvents').addEventListener('click', () => { void command('TEST_CLEAR_EVENTS'); });
api.onSnapshot(render);
api.snapshot().then(render);
