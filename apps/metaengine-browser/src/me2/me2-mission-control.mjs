/**
 * ME2 Mission Control (R41 smart merge) — браузер САМ открывает чат-агентов прямо в сайте.
 *
 * Наследие Electron-версии (fleet provisioner открывал вкладки chat.z.ai сам): теперь флот —
 * постоянные агентные чаты ME2 daemon'а, и браузер открывает для них вкладки ВНУТРИ сайта:
 *   • ОДНА вкладка Mission Control: TabRegistry.create(role='SUPERVISOR'), url = ME2 UI
 *     (GET /ui самого daemon'а — самодостаточная страница флота, реки рассуждений и хода оператора);
 *   • по вкладке на ACTIVE чат-агента: TabRegistry.create(role='FLEET'),
 *     url = ME2 UI#chat=<session_id> — сайт сам открывает конкретного агента (hash-роутинг);
 *   • чат закрылся в daemon'е → вкладка закрывается; чат ожил (restore) → вкладка возвращается;
 *     вкладку снаружи закрыл оператор → честный churn-лимит (не спамим пересозданием).
 *
 * Fail-open: нет хоста (main.mjs не зарегистрировал capability) или daemon'а → DEGRADED-строки,
 * браузер живёт как раньше. Zero-authority: никаких эффектов на self-update/окна/сессии;
 * вкладки создаются штатным createTab() браузера (навигационная политика браузера авторитетна —
 * loopback LOCAL_DEV разрешён её же контрактом).
 */
import { ME2_REST_BASE } from './me2-daemon-host.mjs';
import { me2FleetTabsGetHost, me2FleetTabsResolveIdentity } from './me2-fleet-tabs-host.mjs';
import { me2UiGatewayStatus } from './me2-ui-gateway.mjs';

export const ME2_MISSION_CONTROL_SCHEMA = 'metaengine.browser.me2.mission-control.v1';

const UI_URL_ENV = process.env.ME2_UI_URL || null; // оператор может закрепить любой UI
const DAEMON_UI_URL = `${ME2_REST_BASE}/ui`; // самодостаточный фолбэк (R49)
const POLL_MS = Number(process.env.ME2_MISSION_POLL_MS || 30000);
const FIRST_POLL_DELAY_MS = Number(process.env.ME2_MISSION_FIRST_DELAY_MS || 9000);
const AGENT_TAB_CEILING = Number(process.env.ME2_AGENT_TAB_CEILING || 12); // сверх FLEET-квоты браузера не прыгаем
const CHURN_COOLDOWN_MS = Number(process.env.ME2_AGENT_TAB_CHURN_MS || 60000);

let pollTimer = null;
let firstTimer = null;
let stopped = false;
let supervisorTabId = null;
let agentTabs = new Map(); // session_id -> { tab_id, title, created_at }
let lastRecreateAt = new Map(); // session_id -> ts (churn-лимит)
let lastDigest = null;
let startedAt = null;
let lastError = null;

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

/**
 * R50 (фаза B): разрешение UI Mission Control на каждый ensure —
 * env ME2_UI_URL → живой встроенный gateway (панели v5 + daemon за XTransformPort) →
 * самодостаточный GET /ui daemon'а (фолбэк R49). Деградация ui-host не ломает вкладки.
 */
function resolveUiUrl() {
  if (UI_URL_ENV) return { url: UI_URL_ENV, mode: 'env' };
  const g = me2UiGatewayStatus();
  if (g?.state === 'LIVE' && g.url) return { url: g.url, mode: 'live_gateway' };
  return { url: DAEMON_UI_URL, mode: 'daemon_fallback' };
}

function row(event, patch = {}) {
  const ui = resolveUiUrl();
  return {
    schema: ME2_MISSION_CONTROL_SCHEMA,
    event,
    ui_url: ui.url,
    ui_mode: ui.mode,
    supervisor_tab_id: supervisorTabId,
    agent_tabs: agentTabs.size,
    ...patch,
  };
}

async function me2Fetch(path, init) {
  const r = await fetch(`${ME2_REST_BASE}${path}`, { signal: AbortSignal.timeout(8000), ...init });
  if (!r.ok) throw new Error(`me2_http_${r.status}`);
  return r.json();
}

function nativeIdentity(tabId) {
  return me2FleetTabsResolveIdentity(tabId);
}

function existingTabByUrlPrefix(urlPrefix, role) {
  const host = me2FleetTabsGetHost();
  if (!host) return null;
  try {
    const found = host.registry.snapshot().tabs.find((t) => t.role === role && String(t.url || '').startsWith(urlPrefix));
    return found ? found.tab_id : null;
  } catch { return null; }
}

/** Вкладка Mission Control (role='SUPERVISOR') — ровно одна, идемпотентно. */
async function ensureSupervisorTab() {
  const host = me2FleetTabsGetHost();
  if (!host) return false;
  const { url: UI_URL } = resolveUiUrl();
  if (supervisorTabId && host.registry.get(supervisorTabId)) return true; // жива
  const existing = existingTabByUrlPrefix(UI_URL, 'SUPERVISOR');
  if (existing) {
    supervisorTabId = existing;
    emitRow(row('SUPERVISOR_TAB_EXISTS', { tab_id: existing, runtime_identity: nativeIdentity(existing) }));
    return true;
  }
  try {
    const tab = await host.createTab(UI_URL, { role: 'SUPERVISOR', select: false, awaitLoad: false });
    supervisorTabId = tab.tab_id;
    try {
      host.registry.update(tab.tab_id, { title: 'ME2 Mission Control', kind: 'ME2_MISSION_CONTROL' });
    } catch { /* title/kind — косметика, вкладка уже открыта */ }
    emitRow(row('SUPERVISOR_TAB_CREATED', {
      tab_id: tab.tab_id,
      url: UI_URL,
      role: 'SUPERVISOR',
      runtime_identity: nativeIdentity(tab.tab_id),
    }));
    return true;
  } catch (e) {
    lastError = `supervisor_tab: ${String(e?.message || e).slice(0, 120)}`;
    emitRow(row('SUPERVISOR_TAB_FAILED', { error: lastError }), { error: true });
    return false;
  }
}

/** Вкладка чат-агента (role='FLEET') — сайт сам открывает конкретного агента (#chat=<id>). */
async function ensureAgentTab(session) {
  const host = me2FleetTabsGetHost();
  if (!host) return;
  const { url: UI_URL } = resolveUiUrl();
  if (agentTabs.size >= AGENT_TAB_CEILING) return; // честный потолок видимости флота
  const known = agentTabs.get(session.id);
  if (known) {
    if (host.registry.get(known.tab_id)) return; // вкладка жива
    agentTabs.delete(session.id); // вкладку снаружи закрыли — разрешим пересоздание по churn-лимиту
  }
  const last = lastRecreateAt.get(session.id) || 0;
  if (Date.now() - last < CHURN_COOLDOWN_MS) return;
  const url = `${UI_URL}#chat=${encodeURIComponent(session.id)}`;
  try {
    const tab = await host.createTab(url, { role: 'FLEET', select: false, awaitLoad: false });
    agentTabs.set(session.id, { tab_id: tab.tab_id, title: session.title || session.id, created_at: new Date().toISOString() });
    lastRecreateAt.set(session.id, Date.now());
    try {
      host.registry.update(tab.tab_id, {
        title: `ME2 · ${String(session.title || session.id).slice(0, 40)}`,
        kind: 'ME2_AGENT_CHAT',
      });
    } catch { /* косметика */ }
    emitRow(row('AGENT_TAB_CREATED', {
      session_id: session.id,
      tab_id: tab.tab_id,
      role: session.role || 'CODE',
      runtime_identity: nativeIdentity(tab.tab_id),
    }));
  } catch (e) {
    lastRecreateAt.set(session.id, Date.now()); // и при отказе (quota/wall) — без шторма повторов
    lastError = `agent_tab ${session.id}: ${String(e?.message || e).slice(0, 120)}`;
    emitRow(row('AGENT_TAB_FAILED', { session_id: session.id, error: lastError }), { error: true });
  }
}

async function closeAgentTab(sessionId, reason) {
  const host = me2FleetTabsGetHost();
  const known = agentTabs.get(sessionId);
  if (!host || !known) return;
  try {
    if (typeof host.closeTab === 'function') await host.closeTab(known.tab_id);
    else host.registry.close(known.tab_id);
    emitRow(row('AGENT_TAB_CLOSED', { session_id: sessionId, tab_id: known.tab_id, reason }));
  } catch { /* tab may already be physically gone; reconciliation stays idempotent */ }
  agentTabs.delete(sessionId);
}

/** Один цикл сверки «флот daemon'а ⇄ вкладки браузера» (наследие FLEET_RECONCILE). */
export async function me2MissionReconcile() {
  const host = me2FleetTabsGetHost();
  if (!host) {
    emitRow(row('MISSION_DEGRADED', { reason: 'fleet_tabs_host_not_registered' }), { error: true });
    return null;
  }
  const ac = await me2Fetch('/agentchat');
  if (!ac?.ok) throw new Error('me2_agentchat_bad_payload');
  const active = (ac.sessions ?? []).filter((s) => s.status === 'ACTIVE');
  lastDigest = {
    active_chats: active.length,
    agent_tabs: agentTabs.size,
    supervisor_tab: supervisorTabId,
    at: new Date().toISOString(),
  };
  // 1. Вкладка Mission Control (одна, SUPERVISOR)
  await ensureSupervisorTab();
  // 2. По вкладке на каждый ACTIVE чат (FLEET, сайт открывает агента сам)
  for (const s of active) await ensureAgentTab(s);
  // 3. Чат закрылся в daemon'е → вкладка закрывается (контекст не теряется: чат постоянен)
  for (const sessionId of [...agentTabs.keys()]) {
    if (!active.some((s) => s.id === sessionId)) await closeAgentTab(sessionId, 'session_not_active');
  }
  emitRow(row('MISSION_DIGEST', { ...lastDigest, census_roles: host.registry.census().by_role }));
  return lastDigest;
}

export function startMe2MissionControl() {
  if (stopped || pollTimer) return me2MissionControlStatus();
  startedAt = new Date().toISOString();
  emitRow(row('MISSION_START', { poll_ms: POLL_MS }));
  const tick = () => {
    if (stopped) return; // после stop() сверка не выполняется
    me2MissionReconcile().catch((e) => {
      lastError = String(e?.message || e).slice(0, 140);
      emitRow(row('RECONCILE_FAILED', { error: lastError }), { error: true });
    });
  };
  firstTimer = setTimeout(tick, FIRST_POLL_DELAY_MS); // daemon-хосту нужно время подняться/усыновиться
  pollTimer = setInterval(tick, POLL_MS);
  return me2MissionControlStatus();
}

export function stopMe2MissionControl() {
  stopped = true;
  if (firstTimer) clearTimeout(firstTimer); // первая отложенная сверка тоже отменяется
  firstTimer = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  return me2MissionControlStatus();
}

export function me2MissionControlStatus() {
  const ui = resolveUiUrl();
  return {
    schema: ME2_MISSION_CONTROL_SCHEMA,
    started_at: startedAt,
    stopped,
    ui_url: ui.url,
    ui_mode: ui.mode,
    supervisor_tab_id: supervisorTabId,
    agent_tabs: [...agentTabs.entries()].map(([session_id, t]) => ({
      session_id,
      ...t,
      runtime_identity: nativeIdentity(t.tab_id),
    })),
    last_digest: lastDigest,
    last_error: lastError,
    host: me2FleetTabsGetHost() ? 'registered' : 'not_registered',
    authority_effect: false,
  };
}
