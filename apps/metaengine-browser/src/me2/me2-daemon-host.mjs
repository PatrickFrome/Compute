/**
 * ME2 Daemon Host (R40 smart merge) — Electron-хост для ядра METAENGINE 2.
 *
 * Наследие механизмов старого браузера (supervisor-keepalive + crash sentinel):
 *   • дочерний процесс ME2 daemon (Bun) с health-пробой и перезапуском c backoff;
 *   • честные lifecycle-строки в stdout-шину браузера (JSON rows, schema-контракт);
 *   • fail-open: нет ME2-рунтайма на хосте → состояние DEGRADED, браузер живёт как раньше.
 *
 * ME2 daemon: mini-services/me2-daemon (REST :3041, WS :3040) — флот агентных чатов,
 * пул исполнителей, workgraph, evidence hash-chain, governor LLM-плоскости.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ME2_DAEMON_HOST_SCHEMA = 'metaengine.browser.me2.daemon-host.v1';

const HEALTH_URL = process.env.ME2_DAEMON_HEALTH_URL || 'http://127.0.0.1:3041/state';
const REST_BASE = process.env.ME2_DAEMON_REST || 'http://127.0.0.1:3041';
const MAX_RESTARTS = Number(process.env.ME2_DAEMON_MAX_RESTARTS || 8);
const HEALTH_INTERVAL_MS = Number(process.env.ME2_DAEMON_HEALTH_INTERVAL_MS || 15000);
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

let child = null;
let state = 'IDLE';
let restarts = 0;
let lastError = null;
let lastHealthOkAt = null;
let healthTimer = null;
let stopped = false;
let daemonDataDir = null;
let lastLaunchMode = null;

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  // stdout браузера зарезервирован для probe-режимов — в них только stderr
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function row(statePatch) {
  return {
    schema: ME2_DAEMON_HOST_SCHEMA,
    state,
    restarts,
    last_error: lastError,
    last_health_ok_at: lastHealthOkAt,
    launch_mode: lastLaunchMode,
    rest_base: REST_BASE,
    ...statePatch,
  };
}

export function me2DaemonStatus() {
  return {
    schema: ME2_DAEMON_HOST_SCHEMA,
    state,
    restarts,
    last_error: lastError,
    last_health_ok_at: lastHealthOkAt,
    launch_mode: lastLaunchMode,
    child_pid: child?.pid ?? null,
    stopped,
  };
}

/** Здоровье daemon'а: GET /state отвечает ok:true → жив (hash-chain last_seq как бонус). */
export async function me2HealthProbe(timeout_ms = 4000) {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(timeout_ms) });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const j = await r.json();
    return { ok: j?.ok === true, reason: j?.ok === true ? 'ok' : 'bad_payload', last_seq: j?.last_seq ?? null };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 120) };
  }
}

export function resolveMe2DaemonLaunch({
  resourcesPath = process.resourcesPath || '',
  cwd = process.cwd(),
  env = process.env,
  exists = existsSync,
} = {}) {
  const candidates = [
    env.ME2_DAEMON_DIR,
    join(resourcesPath, 'me2-daemon'),
    join(cwd, 'me2-daemon'),
    join(cwd, '..', 'me2-daemon'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      const packaged = join(dir, 'me2-daemon.exe');
      if (exists(packaged)) {
        return Object.freeze({ dir, bin: packaged, args: [], mode: 'PACKAGED_STANDALONE' });
      }
      if (exists(join(dir, 'index.ts'))) {
        return Object.freeze({ dir, bin: env.ME2_DAEMON_BIN || 'bun', args: ['index.ts'], mode: 'SOURCE_BUN' });
      }
    } catch { /* следующий кандидат */ }
  }
  return null;
}

function spawnDaemon(launch) {
  lastLaunchMode = launch.mode;
  const childEnv = {
    ...process.env,
    ME2_HOSTED_BY_BROWSER: '1',
    // R85: the Browser remains the sole scheduler/authority owner. The packaged
    // legacy daemon boots as a bounded service plane until R86 explicitly
    // converges task authority; operators can opt into another mode explicitly.
    ME2_BOOT_MODE: process.env.ME2_DAEMON_BOOT_MODE || 'probe',
  };
  if (!childEnv.ME2_DATA_DIR && daemonDataDir) childEnv.ME2_DATA_DIR = daemonDataDir;
  child = spawn(launch.bin, launch.args, {
    cwd: launch.dir,
    env: childEnv,
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
        if (line) emitRow({ schema: 'metaengine.browser.me2.daemon-stdout.v1', line: line.slice(0, 400) }, { error: toErr });
      }
    });
  };
  fwd(child.stdout, false);
  fwd(child.stderr, true);
  child.on('exit', (code, signal) => {
    child = null;
    if (stopped) return;
    lastError = `daemon_exit code=${code} signal=${signal}`;
    state = 'RESTARTING';
    emitRow(row({ event: 'DAEMON_EXIT' }), { error: true });
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
    state = restarts >= MAX_RESTARTS ? 'DEGRADED' : state;
    if (restarts >= MAX_RESTARTS) emitRow(row({ event: 'RESTARTS_EXHAUSTED' }), { error: true });
    return;
  }
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** restarts, BACKOFF_MAX_MS);
  restarts += 1;
  setTimeout(() => {
    if (stopped) return;
    const launch = resolveMe2DaemonLaunch();
    if (!launch) {
      state = 'DEGRADED';
      lastError = 'me2_daemon_launch_not_found';
      emitRow(row({ event: 'DAEMON_LAUNCH_NOT_FOUND' }), { error: true });
      return;
    }
    state = 'STARTING';
    spawnDaemon(launch);
  }, delay);
}

/** Старт хоста: если daemon уже жив (внешняя инкарнация) — усыновляем, не спавним. */
export async function startMe2DaemonHost({ dataDir = null } = {}) {
  stopped = false;
  daemonDataDir = dataDir ? String(dataDir) : null;
  const pre = await me2HealthProbe(2500);
  if (pre.ok) {
    state = 'ADOPTED';
    lastLaunchMode = 'ADOPTED_EXTERNAL';
    lastHealthOkAt = new Date().toISOString();
    emitRow(row({ event: 'DAEMON_ADOPTED', last_seq: pre.last_seq }));
  } else {
    const launch = resolveMe2DaemonLaunch();
    if (!launch) {
      state = 'DEGRADED';
      lastError = 'me2_daemon_launch_not_found';
      emitRow(row({ event: 'DAEMON_LAUNCH_NOT_FOUND' }), { error: true });
    } else {
      state = 'STARTING';
      spawnDaemon(launch);
      emitRow(row({ event: 'DAEMON_SPAWN', mode: launch.mode }));
    }
  }
  healthTimer = setInterval(async () => {
    if (stopped) return;
    const h = await me2HealthProbe();
    if (h.ok) {
      if (state !== 'ADOPTED' && state !== 'HEALTHY') emitRow(row({ event: 'DAEMON_HEALTHY', last_seq: h.last_seq }));
      state = child ? 'HEALTHY' : 'ADOPTED';
      lastHealthOkAt = new Date().toISOString();
      restarts = 0; // живой daemon = счётчик перезапусков честно сброшен
    } else if (!child && state !== 'DEGRADED' && state !== 'RESTARTING') {
      // принятый daemon умер — пробуем перерождение (наследие вечно-живущего супервизора)
      lastError = `health_${h.reason}`;
      scheduleRestart();
    }
  }, HEALTH_INTERVAL_MS);
  return me2DaemonStatus();
}

export function stopMe2DaemonHost({ killChild = false } = {}) {
  stopped = true;
  if (healthTimer) clearInterval(healthTimer);
  state = 'STOPPED';
  if (killChild && child) {
    try { child.kill('SIGTERM'); } catch { /* уже мёртв */ }
  }
  return me2DaemonStatus();
}

export { REST_BASE as ME2_REST_BASE };
