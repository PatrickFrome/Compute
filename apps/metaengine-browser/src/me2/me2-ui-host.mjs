/**
 * ME2 UI Host (R50 smart merge, фаза B) — хост панели Mission Control (Next UI v5).
 *
 * Наследие desktop/src/daemon-supervisor.ts (R46): тот же класс механизма, что и
 * me2-daemon-host.mjs — усыновление живого (health-проба), спавн с backoff при отсутствии,
 * честные lifecycle-строки. UI — такой же дочерний сервис, как daemon: его можно убить
 * без потери состояния флота (VS Code-паттерн «логика вне UI-процесса»).
 *
 * Разрешение каталога UI (кандидаты): ME2_UI_DIR env → resources/me2-ui (упакованный) →
 * cwd/me2-ui → cwd/../me2-ui. Спавн: ME2_UI_BIN (bun) `run start` (production-сборка Next);
 * при ME2_UI_DEV=1 — `run dev` (только для разработки). Отсутствие каталога и живого UI —
 * честный DEGRADED: Mission Control остаётся на самодостаточном GET /ui daemon'а (фолбэк R49).
 *
 * Fail-open и zero-authority: недоступность UI не роняет браузер и не трогает self-update.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ME2_UI_HOST_SCHEMA = 'metaengine.browser.me2.ui-host.v1';

const UI_HEALTH_URL = process.env.ME2_UI_HEALTH_URL || 'http://127.0.0.1:3000/';
const UI_PORT = Number(process.env.ME2_UI_PORT || 3000);
const MAX_RESTARTS = Number(process.env.ME2_UI_MAX_RESTARTS || 6);
const HEALTH_INTERVAL_MS = Number(process.env.ME2_UI_HEALTH_INTERVAL_MS || 20000);
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 3 * 60 * 1000;

let child = null;
let state = 'IDLE';
let restarts = 0;
let lastError = null;
let lastHealthOkAt = null;
let healthTimer = null;
let stopped = false;
let mode = null; // 'spawned' | 'adopted' | null

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function row(statePatch) {
  return { schema: ME2_UI_HOST_SCHEMA, state, mode, restarts, last_error: lastError, last_health_ok_at: lastHealthOkAt, ...statePatch };
}

/** Здоровье UI: GET / отвечает HTML → жив (панели v5). */
export async function me2UiHealthProbe(timeout_ms = 4000) {
  try {
    const r = await fetch(UI_HEALTH_URL, { signal: AbortSignal.timeout(timeout_ms) });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const ct = String(r.headers.get('content-type') || '');
    return { ok: ct.includes('text/html'), reason: ct.includes('text/html') ? 'ok' : 'not_html' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 120) };
  }
}

function resolveUiDir() {
  const candidates = [
    process.env.ME2_UI_DIR,
    join(process.resourcesPath || '', 'me2-ui'),
    join(process.cwd(), 'me2-ui'),
    join(process.cwd(), '..', 'me2-ui'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (dir && existsSync(join(dir, 'package.json'))) return dir;
    } catch { /* следующий кандидат */ }
  }
  return null;
}

function spawnUi(dir) {
  const bin = process.env.ME2_UI_BIN || 'bun';
  const args = process.env.ME2_UI_DEV === '1' ? ['run', 'dev'] : ['run', 'start'];
  child = spawn(bin, args, {
    cwd: dir,
    env: { ...process.env, PORT: String(UI_PORT), ME2_HOSTED_BY_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const fwd = (stream, toErr) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += String(d);
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) emitRow({ schema: 'metaengine.browser.me2.ui-stdout.v1', line: line.slice(0, 300) }, { error: toErr });
      }
    });
  };
  fwd(child.stdout, false);
  fwd(child.stderr, true);
  child.on('exit', (code, signal) => {
    child = null;
    if (stopped) return;
    lastError = `ui_exit code=${code} signal=${signal}`;
    state = 'RESTARTING';
    emitRow(row({ event: 'UI_EXIT' }), { error: true });
    scheduleRestart();
  });
  child.on('error', (e) => {
    lastError = `spawn_error: ${String(e?.message || e).slice(0, 160)}`;
    state = 'DEGRADED';
    emitRow(row({ event: 'SPAWN_ERROR' }), { error: true });
  });
}

function scheduleRestart() {
  if (stopped || restarts >= MAX_RESTARTS) {
    if (restarts >= MAX_RESTARTS) {
      state = 'DEGRADED';
      emitRow(row({ event: 'RESTARTS_EXHAUSTED' }), { error: true });
    }
    return;
  }
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** restarts, BACKOFF_MAX_MS);
  restarts += 1;
  setTimeout(() => {
    if (stopped) return;
    const dir = resolveUiDir();
    if (!dir) {
      state = 'DEGRADED';
      lastError = 'me2_ui_dir_not_found (Mission Control остаётся на GET /ui daemon\'а)';
      emitRow(row({ event: 'UI_DIR_NOT_FOUND' }), { error: true });
      return;
    }
    state = 'STARTING';
    spawnUi(dir);
    emitRow(row({ event: 'UI_SPAWN', dir }));
  }, delay);
}

/** Старт хоста UI: живой UI усыновляем (порт уже отвечает), отсутствующий — спавним. */
export async function startMe2UiHost() {
  stopped = false;
  const pre = await me2UiHealthProbe(2500);
  if (pre.ok) {
    mode = 'adopted';
    state = 'ADOPTED';
    lastHealthOkAt = new Date().toISOString();
    emitRow(row({ event: 'UI_ADOPTED', port: UI_PORT }));
  } else {
    const dir = resolveUiDir();
    if (!dir) {
      mode = null;
      state = 'DEGRADED';
      lastError = 'me2_ui_dir_not_found (Mission Control остаётся на GET /ui daemon\'а)';
      emitRow(row({ event: 'UI_DIR_NOT_FOUND' }), { error: true });
    } else {
      mode = 'spawned';
      state = 'STARTING';
      spawnUi(dir);
      emitRow(row({ event: 'UI_SPAWN', dir }));
    }
  }
  healthTimer = setInterval(async () => {
    if (stopped) return;
    const h = await me2UiHealthProbe();
    if (h.ok) {
      if (state !== 'ADOPTED' && state !== 'HEALTHY') emitRow(row({ event: 'UI_HEALTHY' }));
      state = child ? 'HEALTHY' : 'ADOPTED';
      lastHealthOkAt = new Date().toISOString();
      restarts = 0;
    } else if (!child && state !== 'DEGRADED' && state !== 'RESTARTING') {
      lastError = `health_${h.reason}`;
      scheduleRestart();
    }
  }, HEALTH_INTERVAL_MS);
  return me2UiHostStatus();
}

export function stopMe2UiHost({ killChild = false } = {}) {
  stopped = true;
  if (healthTimer) clearInterval(healthTimer);
  state = 'STOPPED';
  if (killChild && child) {
    try { child.kill('SIGTERM'); } catch { /* уже мёртв */ }
  }
  return me2UiHostStatus();
}

export function me2UiHostStatus() {
  return {
    schema: ME2_UI_HOST_SCHEMA,
    state,
    mode,
    restarts,
    last_error: lastError,
    last_health_ok_at: lastHealthOkAt,
    child_pid: child?.pid ?? null,
    stopped,
    health_url: UI_HEALTH_URL,
  };
}
