import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import pg, { type Client as PgClient } from "pg";

import {
  INGRESS_VERIFIER_ID,
  ingressSignatureSha256,
  verifyEd25519RawPublicKey,
} from "./a2_protocol.js";

const { Client, Pool } = pg;

type Json = Record<string, unknown>;
type EmitBody = {
  event_id: string;
  session_id: string;
  agent_seq: number;
  semantic_point: string;
  event_type: string;
  priority: number;
  parent_hashes: string[];
  payload: Json;
  visibility_proof_id: string | null;
  model_provenance: Json;
  event_hash: string;
  signature_base64: string;
  signature_key_fingerprint_sha256: string;
};

const DATABASE_URL = required("DATABASE_URL");
const HOST = process.env.A2_INGRESS_HOST || "127.0.0.1";
const PORT = integer(process.env.A2_INGRESS_PORT, 8092, 1, 65_535);
const TOKEN = process.env.A2_INGRESS_TOKEN || "";

if (!TOKEN && !isLoopback(HOST)) {
  throw new Error("A2_INGRESS_TOKEN_required_for_non_loopback");
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
const streams = new Map<string, Set<ServerResponse>>();
let listener: PgClient | null = null;
let listenReady = false;
let stopped = false;

const PEER_SQL: Record<string, string> = {
  h205f22_a2_register_peer_session_v1:
    "select public.h205f22_a2_register_peer_session_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as v",
  h205f22_a2_close_peer_session_v1:
    "select public.h205f22_a2_close_peer_session_v1($1) as v",
  h205f22_a2_create_visibility_proof_v1:
    "select public.h205f22_a2_create_visibility_proof_v1($1,$2,$3,$4,$5,$6) as v",
  h205f22_a2_next_agent_seq_v1:
    "select public.h205f22_a2_next_agent_seq_v1($1) as v",
  h205f22_a2_read_frontier_v1:
    "select public.h205f22_a2_read_frontier_v1($1) as v",
  h205f22_a2_read_frontier_at_v1:
    "select public.h205f22_a2_read_frontier_at_v1($1,$2) as v",
  h205f22_a2_prepare_event_v1:
    "select public.h205f22_a2_prepare_event_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as v",
  h205f22_a2_update_cursor_v1:
    "select public.h205f22_a2_update_cursor_v1($1,$2,$3,$4) as v",
  h205f22_a2_read_events_v1:
    "select public.h205f22_a2_read_events_v1($1,$2,$3) as v",
  h205f22_a2_read_snapshot_v1:
    "select public.h205f22_a2_read_snapshot_v1($1,$2) as v",
  h205f22_a2_read_visibility_proof_v1:
    "select public.h205f22_a2_read_visibility_proof_v1($1) as v",
  h205f22_a2_read_event_ancestry_v1:
    "select public.h205f22_a2_read_event_ancestry_v1($1,$2) as v",
};
const PEER_RPC = new Set(Object.keys(PEER_SQL));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.trunc(parsed)))
    : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.toLowerCase());
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorized(request: IncomingMessage): boolean {
  if (!TOKEN) return isLoopback(HOST);
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") && constantTimeEqual(header.slice(7), TOKEN);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isHash64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function sendSse(response: ServerResponse, data: unknown, id?: number): void {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function bodyJson(request: IncomingMessage, max = 1_000_000): Promise<any> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > max) throw new Error("body_too_large");
    parts.push(buffer);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

async function emitRpc<T = any>(args: any[]): Promise<T> {
  const result = await pool.query<{ v: T }>(
    "select public.h205f22_a2_emit_agent_event_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) as v",
    args,
  );
  return result.rows[0]!.v;
}

async function peerRpc<T = any>(name: string, args: any[]): Promise<T> {
  const sql = PEER_SQL[name];
  if (!sql) throw new Error("a2_peer_rpc_not_allowed");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role a2_peer_runtime");
    const result = await client.query<{ v: T }>(sql, args);
    await client.query("commit");
    return result.rows[0]!.v;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function readBody(request: IncomingMessage): Promise<EmitBody> {
  const value = await bodyJson(request, 256_000);
  const signature =
    typeof value.signature_base64 === "string"
      ? Buffer.from(value.signature_base64, "base64")
      : Buffer.alloc(0);
  if (
    !isUuid(value.event_id) ||
    !isUuid(value.session_id) ||
    !Number.isSafeInteger(value.agent_seq) ||
    value.agent_seq < 1 ||
    typeof value.semantic_point !== "string" ||
    value.semantic_point.length < 1 ||
    value.semantic_point.length > 512 ||
    typeof value.event_type !== "string" ||
    value.event_type.length < 1 ||
    value.event_type.length > 64 ||
    ![0, 1, 2, 3].includes(Number(value.priority)) ||
    !Array.isArray(value.parent_hashes) ||
    value.parent_hashes.length > 64 ||
    !value.parent_hashes.every(isHash64) ||
    !isHash64(value.event_hash) ||
    signature.length !== 64 ||
    !isHash64(value.signature_key_fingerprint_sha256)
  ) {
    throw new Error("emit_body_invalid");
  }
  return {
    event_id: value.event_id,
    session_id: value.session_id,
    agent_seq: value.agent_seq,
    semantic_point: value.semantic_point,
    event_type: value.event_type,
    priority: Number(value.priority),
    parent_hashes: value.parent_hashes,
    payload: value.payload && typeof value.payload === "object" ? value.payload : {},
    visibility_proof_id: value.visibility_proof_id ?? null,
    model_provenance:
      value.model_provenance && typeof value.model_provenance === "object"
        ? value.model_provenance
        : {},
    event_hash: value.event_hash,
    signature_base64: value.signature_base64,
    signature_key_fingerprint_sha256: value.signature_key_fingerprint_sha256,
  };
}

async function dbReceiptPreimage(
  body: EmitBody,
  issuedAt: string,
  expiresAt: string,
  nonce: string,
  signatureSha256: string,
): Promise<string> {
  const result = await pool.query<{ v: string }>(
    "select destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2($1,$2,$3,$4,$5,$6,$7,$8) as v",
    [
      body.event_hash,
      body.session_id,
      body.signature_key_fingerprint_sha256,
      INGRESS_VERIFIER_ID,
      issuedAt,
      expiresAt,
      nonce,
      signatureSha256,
    ],
  );
  const preimage = result.rows[0]?.v;
  if (typeof preimage !== "string" || !preimage.startsWith("A2_INGRESS_RECEIPT_V2\n")) {
    throw new Error("a2_ingress_preimage_unavailable");
  }
  return preimage;
}

async function emitVerified(body: EmitBody): Promise<any> {
  const sessionResult = await pool.query<{
    public_key_base64: string;
    key_fingerprint_sha256: string;
    status: string;
  }>(
    "select public_key_base64,key_fingerprint_sha256,status from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=$1",
    [body.session_id],
  );
  const session = sessionResult.rows[0];
  if (!session || session.status !== "ACTIVE") {
    throw new Error("a2_ingress_session_not_active");
  }
  if (session.key_fingerprint_sha256 !== body.signature_key_fingerprint_sha256) {
    throw new Error("a2_ingress_key_fingerprint_mismatch");
  }

  const prepared = await peerRpc<any>("h205f22_a2_prepare_event_v1", [
    body.event_id,
    body.session_id,
    body.agent_seq,
    body.semantic_point,
    body.event_type,
    body.priority,
    body.parent_hashes,
    body.payload,
    body.visibility_proof_id,
    body.model_provenance,
  ]);
  if (prepared.event_hash !== body.event_hash) {
    throw new Error("a2_ingress_event_hash_mismatch");
  }
  if (
    !verifyEd25519RawPublicKey(
      session.public_key_base64,
      body.event_hash,
      body.signature_base64,
    )
  ) {
    throw new Error("a2_ingress_ed25519_invalid");
  }

  const signatureSha256 = ingressSignatureSha256(body.signature_base64);
  const keyResult = await pool.query<{ k: string }>(
    "select decrypted_secret as k from vault.decrypted_secrets where name='a2_ingress_hmac_v1' order by created_at desc limit 1",
  );
  const key = keyResult.rows[0]?.k;
  if (!key || key.length < 32) throw new Error("a2_ingress_hmac_secret_unavailable");

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 60_000);
  const issued = issuedAt.toISOString();
  const expires = expiresAt.toISOString();
  const nonce = randomBytes(24).toString("hex");
  const preimage = await dbReceiptPreimage(body, issued, expires, nonce, signatureSha256);
  const hmac = createHmac("sha256", key).update(preimage).digest("hex");

  return emitRpc([
    body.event_id,
    body.session_id,
    body.agent_seq,
    body.semantic_point,
    body.event_type,
    body.priority,
    body.parent_hashes,
    body.payload,
    body.visibility_proof_id,
    body.model_provenance,
    body.event_hash,
    body.signature_base64,
    body.signature_key_fingerprint_sha256,
    INGRESS_VERIFIER_ID,
    issued,
    expires,
    nonce,
    hmac,
  ]);
}

async function readEvents(workspaceId: string, after: number, limit = 1_000): Promise<any[]> {
  const result = await peerRpc<any>("h205f22_a2_read_events_v1", [workspaceId, after, limit]);
  return Array.isArray(result.events) ? result.events : [];
}

async function notify(payload: string | undefined): Promise<void> {
  const notice = JSON.parse(payload || "{}");
  const workspaceId = String(notice.workspace_id || "");
  const commitSeq = Number(notice.commit_seq || 0);
  if (!isUuid(workspaceId) || !Number.isSafeInteger(commitSeq) || commitSeq < 1) return;
  const clients = streams.get(workspaceId);
  if (!clients?.size) return;
  const events = await readEvents(workspaceId, commitSeq - 1, 4);
  const event = events.find((candidate: any) => Number(candidate.commit_seq) === commitSeq);
  if (!event) return;
  for (const response of clients) sendSse(response, event, commitSeq);
}

async function listenLoop(): Promise<void> {
  while (!stopped) {
    const client = new Client({ connectionString: DATABASE_URL });
    listener = client;
    try {
      await client.connect();
      await client.query("listen h205f22_a2_event");
      listenReady = true;
      client.on("notification", (message) => {
        void notify(message.payload).catch((error) =>
          console.error("a2_ingress_notify_error", error),
        );
      });
      await new Promise<void>((resolve) => {
        client.once("error", () => resolve());
        client.once("end", () => resolve());
      });
    } catch (error) {
      if (!stopped) console.error("a2_ingress_listen_reconnect", String(error));
    } finally {
      listenReady = false;
      await client.end().catch(() => undefined);
      if (listener === client) listener = null;
    }
    if (!stopped) await sleep(500);
  }
}

void listenLoop();
setInterval(() => {
  for (const clients of streams.values()) {
    for (const response of clients) {
      sendSse(response, { type: "heartbeat", ts: new Date().toISOString() });
    }
  }
}, 15_000).unref();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || `${HOST}:${PORT}`}`,
    );
    if (url.pathname === "/healthz") {
      json(response, 200, {
        status: "ok",
        service: "a2-trusted-ingress",
        verification: "ED25519_THEN_SIGNATURE_BOUND_HMAC_V3",
        preimage_source: "DB_NATIVE_SINGLE_CONTRACT_V2",
        listen_ready: listenReady,
        peer_db_access: "NOLOGIN_CAPABILITY_ROLE",
      });
      return;
    }
    if (!authorized(request)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/a2/emit") {
      json(response, 200, await emitVerified(await readBody(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/a2/rpc") {
      const value = await bodyJson(request);
      if (
        typeof value.fn !== "string" ||
        !Array.isArray(value.args) ||
        !PEER_RPC.has(value.fn)
      ) {
        throw new Error("a2_peer_rpc_not_allowed");
      }
      json(response, 200, { value: await peerRpc(value.fn, value.args) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/a2/stream") {
      const workspaceId = url.searchParams.get("workspace_id") || "";
      if (!isUuid(workspaceId)) {
        json(response, 400, { error: "workspace_id_invalid" });
        return;
      }
      const after = Math.max(0, Number(url.searchParams.get("after") || 0));
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      let clients = streams.get(workspaceId);
      if (!clients) {
        clients = new Set();
        streams.set(workspaceId, clients);
      }
      clients.add(response);
      for (const event of await readEvents(workspaceId, after, 1_000)) {
        sendSse(response, event, Number(event.commit_seq));
      }
      request.on("close", () => {
        clients!.delete(response);
        if (!clients!.size) streams.delete(workspaceId);
      });
      return;
    }
    json(response, 404, { error: "not_found" });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(`A2 trusted ingress http://${HOST}:${PORT}`));

async function shutdown(): Promise<void> {
  if (stopped) return;
  stopped = true;
  server.close();
  await Promise.allSettled([pool.end(), listener?.end()]);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
