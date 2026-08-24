import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type Client as PgClient } from "pg";

const { Client, Pool } = pg;

type Json = Record<string, unknown>;

const DATABASE_URL = required("DATABASE_URL");
const HOST = process.env.A2_HTTP_HOST || "127.0.0.1";
const PORT = numberInRange(process.env.A2_HTTP_PORT, 8_091, 1, 65_535);
const TOKEN = process.env.A2_OBSERVER_TOKEN || process.env.SOVEREIGN_CONTROL_TOKEN || "";
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const uiDirectory = join(sourceDirectory, "..", "ui");
const sseClients = new Map<string, Set<ServerResponse>>();
let listenClient: PgClient | null = null;
let listenReady = false;
let stopped = false;

const RPC_SQL = {
  readSnapshot: "select public.h205f22_a2_read_snapshot_v1($1,$2) as value",
  readEvents: "select public.h205f22_a2_read_events_v1($1,$2,$3) as value",
  readAncestry: "select public.h205f22_a2_read_event_ancestry_v1($1,$2) as value",
  readSync: "select public.h205f22_a2_read_sync_state_v1($1) as value",
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function numberInRange(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.toLowerCase());
}

if (!TOKEN && !isLoopback(HOST)) throw new Error("A2_OBSERVER_TOKEN_required_for_non_loopback");

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorized(request: IncomingMessage): boolean {
  if (!TOKEN) return isLoopback(HOST);
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ") && constantTimeEqual(authorization.slice(7), TOKEN);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function sendFile(response: ServerResponse, path: string, contentType: string): void {
  try {
    const body = readFileSync(path);
    response.statusCode = 200;
    response.setHeader("content-type", contentType);
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "not_found" });
  }
}

async function rpc<T = Json>(name: keyof typeof RPC_SQL, args: unknown[]): Promise<T> {
  const result = await pool.query<{ value: T }>(RPC_SQL[name], args);
  if (result.rows[0]?.value === undefined) throw new Error(`rpc_empty:${name}`);
  return result.rows[0].value;
}

async function authority(): Promise<Json> {
  const result = await pool.query<{ alignment: Json; roadmap: Json }>(
    "select destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() alignment, destruktion_meta.compute_fabric_roadmap_status_h205f22() roadmap",
  );
  const row = result.rows[0];
  if (!row) throw new Error("authority_read_empty");
  const semanticHead = (row.roadmap.semantic_head || {}) as Json;
  const nextMainline = (row.roadmap.next_mainline || {}) as Json;
  return {
    fresh: row.alignment.canonical_integrity === true && row.roadmap.definition_integrity === true && row.alignment.drift_detected !== true,
    canonical_integrity: row.alignment.canonical_integrity === true,
    definition_integrity: row.roadmap.definition_integrity === true,
    drift_detected: row.alignment.drift_detected === true,
    drift_reasons: row.alignment.drift_reasons || [],
    checkpoint_id: semanticHead.checkpoint_id,
    payload_root_sha256: semanticHead.payload_root_sha256,
    roadmap_definition_sha256: row.roadmap.current_definition_sha256,
    canonical_digest: row.alignment.canonical_digest,
    next_mainline: nextMainline.milestone_key,
    canonical_focus: row.alignment.current_canonical_focus,
  };
}

function peerMap(peers: Json[], cursors: Json[]): Record<string, Json> {
  const mapped: Record<string, Json> = {};
  for (const peer of peers || []) {
    const cursor = (cursors || []).find((candidate) => candidate.session_id === peer.session_id) || {};
    mapped[String(peer.agent)] = {
      model: peer.requested_model,
      runtime_id: peer.runtime_id,
      status: peer.status,
      lastSeen: Number(cursor.last_applied_commit_seq || 0),
      applied: Number(cursor.last_applied_commit_seq || 0),
      received: Number(cursor.last_received_commit_seq || 0),
      frontier: cursor.causal_frontier_hash,
      capabilities: peer.capabilities,
    };
  }
  return mapped;
}

async function ingressReceipts(eventHashes: string[]): Promise<Map<string, Json>> {
  if (!eventHashes.length) return new Map();
  const result = await pool.query<Json>(
    "select receipt_id,event_hash,verifier_id,issued_at,expires_at,consumed_event_id,signature_sha256,canonical,authority_effect from destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22 where event_hash=any($1::text[])",
    [eventHashes],
  );
  return new Map(result.rows.map((receipt) => [String(receipt.event_hash), receipt]));
}

async function decorateEvents(events: Json[]): Promise<Json[]> {
  const hashes = events.map((event) => event.event_hash).filter((hash): hash is string => typeof hash === "string");
  const receipts = await ingressReceipts(hashes);
  const appliedBy = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.event_type !== "PEER_EVENT_APPLIED") continue;
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Json : {};
    const eventHashes = Array.isArray(payload.peer_event_hashes) ? payload.peer_event_hashes : [];
    for (const hash of eventHashes) {
      if (typeof hash !== "string") continue;
      const agents = appliedBy.get(hash) || new Set<string>();
      agents.add(String(event.agent || event.agent_id || ""));
      appliedBy.set(hash, agents);
    }
  }
  return events.map((event) => {
    const agent = String(event.agent || event.agent_id || "");
    const acknowledgers = [...(appliedBy.get(String(event.event_hash)) || new Set())].filter(Boolean).sort();
    const expectedPeer = agent === "GPT" ? "GLM" : agent === "GLM" ? "GPT" : null;
    return {
      ...event,
      ingress_receipt: receipts.get(String(event.event_hash)) || null,
      applied_by: acknowledgers,
      expected_peer: expectedPeer,
      peer_applied: expectedPeer ? acknowledgers.includes(expectedPeer) : null,
    };
  });
}

async function snapshot(workspaceId: string): Promise<Json> {
  const [raw, sync] = await Promise.all([rpc<Json>("readSnapshot", [workspaceId, 250]), rpc<Json>("readSync", [workspaceId])]);
  const workspace = (raw.workspace || {}) as Json;
  const events = Array.isArray(raw.events) ? (raw.events as Json[]) : [];
  const peers = Array.isArray(raw.peers) ? (raw.peers as Json[]) : [];
  const cursors = Array.isArray(raw.cursors) ? (raw.cursors as Json[]) : [];
  return {
    ...raw,
    semantic_point: workspace.semantic_point,
    mode: workspace.mode,
    events: await decorateEvents(events),
    peers: peerMap(peers, cursors),
    authority: await authority(),
    sync,
  };
}

async function eventsAfter(workspaceId: string, after: number, limit = 100): Promise<Json[]> {
  const readback = await rpc<Json>("readEvents", [workspaceId, after, limit]);
  const events = Array.isArray(readback.events) ? (readback.events as Json[]) : [];
  return decorateEvents(events);
}

function sendSse(response: ServerResponse, data: unknown, id?: number): void {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function broadcastNotification(messagePayload: string | undefined): Promise<void> {
  const payload = JSON.parse(messagePayload || "{}") as Json;
  const workspaceId = String(payload.workspace_id || "");
  const commitSequence = Number(payload.commit_seq || 0);
  if (!isUuid(workspaceId) || !Number.isSafeInteger(commitSequence) || commitSequence < 1) return;
  const clients = sseClients.get(workspaceId);
  if (!clients?.size) return;
  const events = await eventsAfter(workspaceId, commitSequence - 1, 10);
  const event = events.find((candidate) => Number(candidate.commit_seq) === commitSequence);
  if (!event) return;
  for (const response of clients) sendSse(response, event, commitSequence);
}

async function listenLoop(): Promise<void> {
  while (!stopped) {
    const client = new Client({ connectionString: DATABASE_URL });
    listenClient = client;
    try {
      await client.connect();
      await client.query("listen h205f22_a2_event");
      listenReady = true;
      client.on("notification", (message) => {
        void broadcastNotification(message.payload).catch((error) => console.error("a2_observer_notification_failed", String(error)));
      });
      await new Promise<void>((resolve) => {
        client.once("error", () => resolve());
        client.once("end", () => resolve());
      });
    } catch (error) {
      if (!stopped) console.error("a2_observer_listen_reconnect", String(error));
    } finally {
      listenReady = false;
      await client.end().catch(() => undefined);
      if (listenClient === client) listenClient = null;
    }
    if (!stopped) await sleep(500);
  }
}

void listenLoop();

setInterval(() => {
  for (const clients of sseClients.values()) {
    for (const response of clients) sendSse(response, { type: "heartbeat", ts: new Date().toISOString() });
  }
}, 15_000).unref();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://observer.invalid");
  try {
    if (url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", service: "a2-observer", listen_ready: listenReady });
      return;
    }
    if (url.pathname.startsWith("/a2") && !authorized(request)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/a2") {
      sendFile(response, join(uiDirectory, "index.html"), "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && (url.pathname === "/a2/app.js" || url.pathname === "/a2/assets/app.js")) {
      sendFile(response, join(uiDirectory, "app.js"), "text/javascript; charset=utf-8");
      return;
    }
    if (request.method === "GET" && (url.pathname === "/a2/styles.css" || url.pathname === "/a2/assets/styles.css")) {
      sendFile(response, join(uiDirectory, "styles.css"), "text/css; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/a2/api/authority") {
      sendJson(response, 200, await authority());
      return;
    }
    if (request.method === "GET" && url.pathname === "/a2/api/snapshot") {
      const workspaceId = url.searchParams.get("workspace_id") || "";
      if (!isUuid(workspaceId)) {
        sendJson(response, 400, { error: "workspace_id_invalid" });
        return;
      }
      sendJson(response, 200, await snapshot(workspaceId));
      return;
    }
    if (request.method === "GET" && url.pathname === "/a2/api/events") {
      const workspaceId = url.searchParams.get("workspace_id") || "";
      if (!isUuid(workspaceId)) {
        sendJson(response, 400, { error: "workspace_id_invalid" });
        return;
      }
      const queryAfter = Number(url.searchParams.get("after") || 0);
      const headerAfter = Number(request.headers["last-event-id"] || 0);
      const after = Math.max(0, Number.isSafeInteger(queryAfter) ? queryAfter : 0, Number.isSafeInteger(headerAfter) ? headerAfter : 0);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      });
      for (const event of await eventsAfter(workspaceId, after, 250)) sendSse(response, event, Number(event.commit_seq));
      let clients = sseClients.get(workspaceId);
      if (!clients) {
        clients = new Set();
        sseClients.set(workspaceId, clients);
      }
      clients.add(response);
      request.on("close", () => {
        clients?.delete(response);
        if (!clients?.size) sseClients.delete(workspaceId);
      });
      return;
    }
    const ancestryMatch = url.pathname.match(/^\/a2\/api\/events\/([0-9a-f-]+)\/ancestry$/i);
    if (request.method === "GET" && ancestryMatch) {
      if (!isUuid(ancestryMatch[1]!)) {
        sendJson(response, 400, { error: "event_id_invalid" });
        return;
      }
      sendJson(response, 200, await rpc("readAncestry", [ancestryMatch[1], 48]));
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(`A2 observer listening on ${HOST}:${PORT}`));

async function shutdown(): Promise<void> {
  if (stopped) return;
  stopped = true;
  server.close();
  await Promise.allSettled([pool.end(), listenClient?.end()]);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
