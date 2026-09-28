/**
 * Browser-packaged ME2 compatibility probe.
 *
 * R105: this is a standalone, zero-authority loopback projection. It MUST NOT
 * import index.ts, store.ts, provider SDKs, workers, schedulers, command buses,
 * token vaults, SQL mirrors, browser drivers, or any mutation-capable ME2
 * module. The Browser's canonical task/agent/effect authority lives in the
 * native METAENGINE Browser runtime.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const VERSION = '0.57.1';
const CONTRACT = 'me2-daemon-contract.v1';
const REST_PORT = Number(process.env.ME2_REST_PORT || 3041);
const LOOPBACK = '127.0.0.1';
const BOOT_TS = new Date().toISOString();

const PROBE_POLICY = Object.freeze({
  boot_mode: 'probe',
  read_only: true,
  model_execution_enabled: false,
  provider_api_enabled: false,
  provider_network_enabled: false,
  agentchat_mutation_enabled: false,
  scheduler_authority: false,
  browser_actuation_authority: false,
  command_mutation_enabled: false,
  token_mutation_enabled: false,
  filesystem_mutation_enabled: false,
  sql_mutation_enabled: false,
  legacy_daemon_module_loaded: false,
  socket_mutation_surface_enabled: false,
  authority_effect: false,
});

const CAPABILITIES = Object.freeze({
  contract: CONTRACT,
  version: VERSION,
  ops: Object.freeze([]),
  transport: Object.freeze({
    socket: null,
    path: null,
    port: null,
    ack: false,
    events: Object.freeze([]),
  }),
  rest: Object.freeze({
    read: Object.freeze(['/health', '/state', '/actions', '/events', '/evidence', '/ui']),
    write: Object.freeze([]),
  }),
  memory: Object.freeze([]),
  ui: '/ui',
  compat: Object.freeze({
    daemon: VERSION,
    contract: CONTRACT,
    ui_fallback: '/ui',
    browser_expect: 'native-browser-authority',
    notes: Object.freeze([
      'Browser-packaged ME2 is a read-only compatibility projection.',
      'Native Browser owns fleet, task, model, scheduler and effect authority.',
    ]),
  }),
});

function zeroStats() {
  return {
    tasksReady: 0,
    tasksRunning: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    agentsBusy: 0,
    agentsIdle: 0,
    workersOnline: 0,
  };
}

function stateSnapshot() {
  return {
    ok: true,
    ts: new Date().toISOString(),
    agents: [],
    tasks: [],
    archived: [],
    workers: [],
    commands: [],
    events: [],
    budget: { used: 0, limit: 0, window_ms: 60_000 },
    stats: zeroStats(),
    meta: { version: VERSION, boot: BOOT_TS, projection: 'BROWSER_PROBE_ONLY' },
    contract: CONTRACT,
    capabilities: CAPABILITIES,
    browser_probe: PROBE_POLICY,
    task_content_authority: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'http://127.0.0.1',
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`<!doctype html><meta charset="utf-8"><title>METAENGINE Browser</title>
<style>body{font:14px system-ui;background:#09090b;color:#e4e4e7;padding:24px;max-width:760px;margin:auto}code{color:#6ee7b7}</style>
<h1>METAENGINE Browser</h1>
<p>The legacy ME2 daemon control plane is retired in this Browser build.</p>
<p>This loopback endpoint is a <code>read-only compatibility probe</code>. Fleet, task, model and effect authority live in the native Browser runtime.</p>`);
}

function denied(req: IncomingMessage, res: ServerResponse, path: string) {
  return json(res, 403, {
    ok: false,
    error: 'ME2_BROWSER_PROBE_READ_ONLY',
    method: String(req.method || 'GET').toUpperCase(),
    path,
    ...PROBE_POLICY,
  });
}

const server = createServer((req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', `http://${LOOPBACK}:${REST_PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'http://127.0.0.1',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (method !== 'GET') {
    denied(req, res, path);
    return;
  }

  if (path === '/health') {
    json(res, 200, {
      ok: true,
      service: 'me2-daemon-browser-probe',
      version: VERSION,
      boot: BOOT_TS,
      last_seq: 0,
      actions: 0,
      ts: new Date().toISOString(),
      browser_probe: PROBE_POLICY,
    });
    return;
  }
  if (path === '/state') {
    json(res, 200, stateSnapshot());
    return;
  }
  if (path === '/actions') {
    json(res, 200, { ok: true, actions: [], browser_probe: PROBE_POLICY, authority_effect: false });
    return;
  }
  if (path === '/events') {
    json(res, 200, { ok: true, events: [], exact_task_history_available: false, browser_probe: PROBE_POLICY, authority_effect: false });
    return;
  }
  if (path === '/evidence') {
    json(res, 200, {
      ok: true,
      mode: 'OFF',
      pending: 0,
      method: null,
      last_error: null,
      last_sent_seq: 0,
      storage: { ok: false, bucket: '', objects: 0 },
      ddl: { last_result: null, retry_every_min: 0, next_retry_at: null, attempts_total: 0 },
      browser_probe: PROBE_POLICY,
      authority_effect: false,
    });
    return;
  }
  if (path === '/ui') {
    html(res);
    return;
  }

  denied(req, res, path);
});

server.on('error', (error) => {
  process.stderr.write(`[me2-browser-probe] server_error:${String((error as Error)?.message || error).slice(0,160)}\n`);
  process.exitCode = 1;
});

server.listen(REST_PORT, LOOPBACK, () => {
  process.stdout.write(JSON.stringify({
    schema: 'metaengine.browser.me2-compat-probe.v1',
    event: 'PROBE_READY',
    host: LOOPBACK,
    rest_port: REST_PORT,
    version: VERSION,
    browser_probe: PROBE_POLICY,
    authority_effect: false,
  }) + '\n');
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
