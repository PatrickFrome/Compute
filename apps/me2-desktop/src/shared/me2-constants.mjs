/**
 * ME2 Desktop — system constants (single source of truth).
 * Port map mirrors the ME2 OS sandbox contracts (R50+ / capsule 01):
 *   daemon socket.io :3040 · REST :3041 · screencast WS :3042 · CDP :3043
 *   Mission Control Next :3000 · desktop ui-gateway :8137
 */

export const DAEMON = {
  WS_PORT: 3040,
  REST_PORT: 3041,
  SCREENCAST_PORT: 3042,
  CDP_PORT: 3043,
};

export const UI = {
  PORT: 3000,
  HEALTH_PATH: '/',
};

export const GATEWAY = {
  PORT: 8137,
  // XTransformPort allowlist — the gateway never proxies anything else (R50 contract)
  ALLOWED_TARGETS: [3040, 3041, 3042, 3043],
  QUERY_KEY: 'XTransformPort',
};

export const CONTRACT = {
  SCHEMA: 'me2-daemon-contract.v1',
  HANDSHAKE_PATH: '/state',
  HEALTH_PATH: '/health',
};

/** Daemon-host restart policy (honest caps, no restart storms). */
export const DAEMON_HOST = {
  MAX_RESTARTS: 8,
  RESTART_BACKOFF_MS: 2000,
  HEALTH_TIMEOUT_MS: 4000,
  ADOPT_PROBE_TIMEOUT_MS: 2500,
};

/** ui-host spawn policy. */
export const UI_HOST = {
  START_TIMEOUT_MS: 30000,
  PROBE_INTERVAL_MS: 1000,
};

/** Desktop self-update channel (own schema — not the legacy rail format). */
export const UPDATE = {
  MANIFEST_SCHEMA: 'me2.desktop-update-manifest.v1',
  POLL_INTERVAL_MS: 15 * 60 * 1000, // 15 min, mirrors legacy dev cadence
  RETRY_MS: 5 * 60 * 1000,
  STAGED_DIR_NAME: 'staged-updates',
  JOURNAL_NAME: 'me2-desktop-update-journal.jsonl',
  MAX_STAGED_RETENTION: 3,
};

/** FLEET tab policy (chat agents live on chat.z.ai). */
export const FLEET = {
  ORIGIN: 'https://chat.z.ai',
  TAB_CEILING: 12, // the fleet is 12 persistent sessions
};

/** Window roles (TabRegistry contract reduced to the honest minimum). */
export const TAB_ROLES = ['MAIN', 'FLEET', 'SUPERVISOR'];

/**
 * Pure decision: which spawn mode should ui-host use?
 * bun present → `bun server.js`; otherwise Electron runs the standalone server
 * in node mode (ELECTRON_RUN_AS_NODE=1) — operator machines need no bun (R77 lesson).
 */
export function resolveUiSpawnMode({ bunAvailable, explicitBin, dev } = {}) {
  if (dev) return { mode: 'bun-dev', args: ['run', 'dev'], runAsNode: false };
  if (explicitBin) return { mode: 'explicit', args: ['run', 'start'], runAsNode: false };
  if (bunAvailable) return { mode: 'bun', args: ['server.js'], runAsNode: false };
  return { mode: 'electron-node', args: ['server.js'], runAsNode: true };
}

/**
 * Pure decision: single-instance semantics.
 * Returns the action the runtime must take for this process.
 */
export function resolveInstanceAction({ lockAcquired, hasResurrectionSignal }) {
  if (lockAcquired) return 'primary';
  return hasResurrectionSignal ? 'secondary-resurrect' : 'secondary-exit';
}

/**
 * Pure decision: gateway routing for one request.
 * Returns {allow, target} — allow=false means the gateway must answer 403/400.
 */
export function resolveGatewayRoute({ url, allowlist }) {
  let parsed;
  try {
    parsed = new URL(url, 'http://gateway.invalid');
  } catch {
    return { allow: false, reason: 'url_unparseable' };
  }
  const raw = parsed.searchParams.get('XTransformPort');
  if (!raw) return { allow: false, reason: 'no_xtransformport' };
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { allow: false, reason: 'port_invalid' };
  }
  if (!allowlist.includes(port)) return { allow: false, reason: 'port_not_allowed' };
  return { allow: true, target: port, pathname: parsed.pathname + parsed.search };
}

/** Parse daemon /state handshake into the contract shape (pure). */
export function parseHandshake(body) {
  let json;
  try {
    json = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { ok: false, reason: 'handshake_not_json' };
  }
  const caps = json?.capabilities ?? json?.data?.capabilities;
  if (!caps || typeof caps !== 'object') return { ok: false, reason: 'capabilities_missing' };
  const contract = caps.contract ?? caps.CONTRACT_VERSION;
  if (contract !== CONTRACT.SCHEMA) {
    return { ok: false, reason: 'contract_mismatch', seen: contract ?? null };
  }
  return { ok: true, capabilities: caps, version: json.version ?? json.data?.version ?? null };
}
