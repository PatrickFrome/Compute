// ME2 OS daemon — REST :3041 + WS event bus :3040 (R81-PHASE0 recovery build).
// Protocol invariants honoured:
//  - REST families + action bus; machine-coded errors {error:{code,message}}
//  - secrets never leave the process (Supabase key server-side only)
//  - fail-closed event log integrity; boot-span-aware verdicts
import { OpError, } from "./errors";
import { ChainError, appendEvent, loadEventLog, lastSeq, headHash, subscribe, tail, verifyChain, MIRROR_ANCHOR } from "./eventlog";
import { ACTIONS, dispatch } from "./actions";
import { listWorktrees, createWorktree, removeWorktree } from "./worktrees";
import { execWhitelisted, probe, whitelist } from "./sandbox";
import { evaluateVerdicts } from "./verdicts";
import { ROADMAP, RELEASE_AUTHORITY, DONOR_AUTHORITIES, RECOVERY_STATUS, CONVERGENCE_EVIDENCE } from "./roadmap";
import { supervisorSnapshot, mirrorTail, runtimeCapabilities, writeMirrorAnchor } from "./controlplane";
import { monitorHistory, monitorStatus, startMonitor } from "./monitor";
import { donorRegistry } from "./donor-registry";
import { convergenceStatus } from "./github";
import { r82Diagnosis } from "./r82";
import { VERSION, ROUND, REST_PORT, WS_PORT, STARTED_AT } from "./version";
import { STARTED_VERSION } from "./boot";

loadEventLog();

type Handler = (req: Request, url: URL, body: Record<string, unknown>) => Promise<unknown> | unknown;

const DONOR = donorRegistry(ACTIONS.map((a) => ({ name: a.name, family: a.family })));

const routes: { method: string; path: string; handler: Handler }[] = [
  {
    method: "GET",
    path: "/health",
    handler: () => ({
      ok: true,
      version: VERSION,
      round: ROUND,
      uptime_s: Math.round((Date.now() - STARTED_VERSION.started_at_ms) / 1000),
      started_at: STARTED_AT,
      actions: {
        implemented: ACTIONS.length,
        donor_registry: `${DONOR.total} recovered (sandbox/me2-os @ ${DONOR.provenance.source_sha.slice(0, 8)}) · local counterparts ${DONOR.reconciliation.counterparts_count}/${DONOR.total}`,
      },
      last_seq: lastSeq(),
      head_hash: headHash(),
      ws_port: WS_PORT,
      mirror_anchor: MIRROR_ANCHOR,
      monitor: monitorStatus(),
    }),
  },
  {
    method: "GET",
    path: "/capabilities",
    handler: () => ({
      count: ACTIONS.length,
      note: `R81-PHASE1: local implemented registry; donor ${DONOR.total}-action manifest recovered from sandbox/me2-os @ ${DONOR.provenance.source_sha.slice(0, 8)} (see /donor-registry)`,
      actions: ACTIONS,
    }),
  },
  { method: "GET", path: "/events", handler: (_r, url) => ({ events: tail(Number(url.searchParams.get("limit") ?? 50)), last_seq: lastSeq() }) },
  {
    method: "POST",
    path: "/events",
    handler: (_r, _u, body) =>
      appendEvent(String(body.type ?? ""), String(body.actor ?? "operator"), body.subject == null ? null : String(body.subject), body.payload ?? null),
  },
  { method: "GET", path: "/eventlog/verify", handler: () => verifyChain() },
  {
    method: "POST",
    path: "/action",
    handler: async (_r, _u, body) => {
      if (typeof body.action !== "string") throw new OpError("action_field_missing", "body.action required");
      const result = await dispatch(body.action, (body.args ?? {}) as Record<string, unknown>);
      return { ok: true, action: body.action, result };
    },
  },
  { method: "GET", path: "/worktrees", handler: () => ({ worktrees: listWorktrees() }) },
  {
    method: "POST",
    path: "/worktrees",
    handler: (_r, _u, body) => {
      if (typeof body.name !== "string") throw new OpError("worktree_name_missing", "body.name required");
      return { created: createWorktree(body.name) };
    },
  },
  {
    method: "DELETE",
    path: "/worktrees",
    handler: (_r, _u, body) => {
      const name = typeof body.name === "string" ? body.name : null;
      if (!name) throw new OpError("worktree_name_missing", "body.name required");
      return removeWorktree(name);
    },
  },
  { method: "GET", path: "/sandbox/probe", handler: () => probe() },
  {
    method: "POST",
    path: "/sandbox/exec",
    handler: (_r, _u, body) => execWhitelisted(Array.isArray(body.cmd) ? (body.cmd as string[]) : []),
  },
  { method: "GET", path: "/sandbox/whitelist", handler: () => ({ whitelist: whitelist() }) },
  { method: "GET", path: "/verdicts", handler: () => evaluateVerdicts() },
  {
    method: "GET",
    path: "/roadmap",
    handler: () => ({ roadmap: ROADMAP, release_authority: RELEASE_AUTHORITY, donors: DONOR_AUTHORITIES, convergence_evidence: CONVERGENCE_EVIDENCE }),
  },
  { method: "GET", path: "/recovery", handler: () => RECOVERY_STATUS },
  { method: "GET", path: "/donor-registry", handler: () => donorRegistry(ACTIONS.map((a) => ({ name: a.name, family: a.family }))) },
  {
    method: "GET",
    path: "/convergence",
    handler: (_r, url) => convergenceStatus(url.searchParams.get("fresh") === "1"),
  },
  {
    method: "GET",
    path: "/r82",
    handler: (_r, url) => r82Diagnosis(url.searchParams.get("fresh") === "1"),
  },
  {
    method: "GET",
    path: "/control-plane/supervisor",
    handler: (_r, url) => supervisorSnapshot(url.searchParams.get("fresh") === "1"),
  },
  { method: "GET", path: "/control-plane/mirror-tail", handler: () => mirrorTail() },
  { method: "GET", path: "/control-plane/capabilities", handler: () => runtimeCapabilities() },
  { method: "GET", path: "/control-plane/history", handler: () => monitorHistory() },
  { method: "POST", path: "/control-plane/mirror-anchor", handler: () => writeMirrorAnchor() },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  try {
    const t = await req.text();
    if (!t) return {};
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new OpError("body_not_object", "JSON body must be an object");
  } catch (e) {
    if (e instanceof OpError) throw e;
    throw new OpError("body_invalid_json", "body is not valid JSON");
  }
}

const restServer = Bun.serve({
  port: REST_PORT,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      return json({ error: { code: "route_not_found", message: `${req.method} ${url.pathname} (see /capabilities)` } }, 404);
    }
    try {
      const body = await readBody(req);
      const result = await route.handler(req, url, body);
      return json(result);
    } catch (e) {
      if (e instanceof OpError) return json({ error: { code: e.code, message: e.message } }, e.status);
      if (e instanceof ChainError) return json({ error: { code: e.code, message: e.message } }, 500);
      return json({ error: { code: "internal_error", message: String((e as Error)?.message ?? e).slice(0, 300) } }, 500);
    }
  },
});

// ---- WS event bus :3040 (browser connects via gateway: /?XTransformPort=3040) ----
interface BusSocket {
  send: (s: string) => void;
  id: string;
}
const sockets = new Set<BusSocket>();

const wsServer = Bun.serve<BusSocket>({
  port: WS_PORT,
  fetch(req, server) {
    const success = server.upgrade(req, {
      data: { send: (_s: string) => {}, id: crypto.randomUUID() },
    });
    if (success) return;
    return new Response("ME2 event bus: WebSocket upgrade required (use /?XTransformPort=3040)", {
      status: 426,
      headers: CORS,
    });
  },
  websocket: {
    open(ws) {
      ws.data.send = (s: string) => ws.sendText(s);
      sockets.add(ws.data);
      ws.sendText(
        JSON.stringify({
          kind: "hello",
          bus: "me2-event-bus",
          version: VERSION,
          round: ROUND,
          last_seq: lastSeq(),
        })
      );
      appendEvent("BUS_CLIENT_CONNECTED", "daemon", ws.data.id, { clients: sockets.size });
    },
    message(ws, message) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(String(message)) as Record<string, unknown>;
      } catch {
        ws.sendText(JSON.stringify({ kind: "error", code: "bus_message_invalid_json" }));
        return;
      }
      if (parsed.kind === "ping") {
        ws.sendText(JSON.stringify({ kind: "pong", last_seq: lastSeq(), ts: new Date().toISOString() }));
      } else {
        ws.sendText(JSON.stringify({ kind: "error", code: "bus_message_unknown", hint: "send {\"kind\":\"ping\"}" }));
      }
    },
    close(ws) {
      sockets.delete(ws.data);
    },
  },
});

// broadcast every appended event to the bus
subscribe((ev) => {
  const frame = JSON.stringify({ kind: "event", event: ev });
  for (const s of sockets) s.send(frame);
});

appendEvent("DAEMON_BOOT", "daemon", null, {
  version: VERSION,
  round: ROUND,
  rest_port: REST_PORT,
  ws_port: WS_PORT,
  anchor: MIRROR_ANCHOR.seq,
});

// convergence monitor: silent sampler, starts after boot (never blocks listen)
startMonitor();

console.log(`[me2-daemon] ${VERSION} (${ROUND}) REST :${restServer.port} · WS bus :${wsServer.port} · anchor seq ${MIRROR_ANCHOR.seq}`);
