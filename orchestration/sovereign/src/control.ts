import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

type JsonObject = Record<string, unknown>;
type Role = "GPT" | "GLM";

const DATABASE_URL = required("DATABASE_URL");
const HOST = process.env.SOVEREIGN_HTTP_HOST || "127.0.0.1";
const PORT = boundedInt(process.env.SOVEREIGN_HTTP_PORT, 8090, 1, 65535);
const CONTROL_TOKEN = process.env.SOVEREIGN_CONTROL_TOKEN || "";
const GPT_URL = process.env.SOVEREIGN_GPT_URL || "http://127.0.0.1:8001";
const GLM_URL = process.env.SOVEREIGN_GLM_URL || "http://127.0.0.1:8002";
const GPT_MODEL = process.env.SOVEREIGN_GPT_MODEL || "openai/gpt-oss-20b";
const GLM_MODEL = process.env.SOVEREIGN_GLM_MODEL || "zai-org/GLM-4.7-Flash";
const COMMON_MODEL_TOKEN = process.env.SOVEREIGN_INFERENCE_TOKEN || "";
const GPT_TOKEN = process.env.SOVEREIGN_GPT_TOKEN || COMMON_MODEL_TOKEN;
const GLM_TOKEN = process.env.SOVEREIGN_GLM_TOKEN || COMMON_MODEL_TOKEN;
const UPSTREAM_TIMEOUT_MS = boundedInt(process.env.SOVEREIGN_UPSTREAM_TIMEOUT_MS, 120_000, 5_000, 600_000);
const MAX_BODY_BYTES = boundedInt(process.env.SOVEREIGN_HTTP_MAX_BODY_BYTES, 2 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
const CHANNEL = "h205f22_same_point_v4_ready";
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

let requestsTotal = 0;
let upstreamRequestsTotal = 0;
let lastReady = false;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function isLoopback(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

if (!isLoopback(HOST) && !CONTROL_TOKEN) {
  throw new Error("SOVEREIGN_CONTROL_TOKEN_required_for_non_loopback_bind");
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function constantEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function authorized(req: IncomingMessage): boolean {
  if (!CONTROL_TOKEN) return isLoopback(HOST);
  const header = req.headers.authorization || "";
  const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(candidate) && constantEqual(candidate, CONTROL_TOKEN);
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (authorized(req)) return true;
  sendJson(res, 401, { error: "unauthorized" });
  return false;
}

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json_object_required");
  return value as JsonObject;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function modelConfig(role: Role): { base: string; model: string; token: string } {
  return role === "GPT"
    ? { base: GPT_URL, model: GPT_MODEL, token: GPT_TOKEN }
    : { base: GLM_URL, model: GLM_MODEL, token: GLM_TOKEN };
}

async function probeModel(role: Role): Promise<JsonObject> {
  const cfg = modelConfig(role);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("probe_timeout"), Math.min(UPSTREAM_TIMEOUT_MS, 10_000));
  try {
    const response = await fetch(`${cfg.base.replace(/\/$/, "")}/v1/models`, {
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let visible = false;
    if (response.ok) {
      try {
        const body = JSON.parse(text) as { data?: Array<{ id?: string }> };
        visible = Boolean(body.data?.some((entry) => entry.id === cfg.model));
      } catch {
        visible = false;
      }
    }
    return {
      role,
      ok: response.ok,
      model_visible: visible,
      expected_model: cfg.model,
      endpoint: cfg.base,
      latency_ms: Date.now() - started,
      status: response.status,
    };
  } catch {
    return { role, ok: false, model_visible: false, expected_model: cfg.model, endpoint: cfg.base, latency_ms: Date.now() - started, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function dbProbe(): Promise<JsonObject> {
  const started = Date.now();
  try {
    const result = await pool.query<{ ok: number }>("select 1::integer as ok");
    return { ok: result.rows[0]?.ok === 1, latency_ms: Date.now() - started };
  } catch {
    return { ok: false, latency_ms: Date.now() - started };
  }
}

async function readiness(): Promise<JsonObject> {
  const [db, gpt, glm] = await Promise.all([dbProbe(), probeModel("GPT"), probeModel("GLM")]);
  const ready = db.ok === true && gpt.ok === true && glm.ok === true && gpt.model_visible === true && glm.model_visible === true;
  lastReady = ready;
  return { ready, protocol: "SAME_POINT_DUEL_V4", db, gpt, glm };
}

async function proxyModel(req: IncomingMessage, res: ServerResponse, role: Role, kind: "models" | "chat"): Promise<void> {
  const cfg = modelConfig(role);
  upstreamRequestsTotal += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("upstream_timeout"), UPSTREAM_TIMEOUT_MS);
  try {
    const base = cfg.base.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
    let init: RequestInit = { method: kind === "models" ? "GET" : "POST", headers, signal: controller.signal };
    if (kind === "chat") {
      const input = await readJson(req);
      input.model = cfg.model;
      headers["content-type"] = "application/json";
      init = { ...init, body: JSON.stringify(input) };
    }
    const upstream = await fetch(`${base}${kind === "models" ? "/v1/models" : "/v1/chat/completions"}`, init);
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) res.setHeader("cache-control", cacheControl);
    if (!upstream.body) {
      res.end();
      return;
    }
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(Buffer.from(chunk));
    }
    res.end();
  } finally {
    clearTimeout(timer);
  }
}

async function createDuel(input: JsonObject): Promise<JsonObject> {
  const duelKey = String(input.duel_key || "").trim();
  const milestone = String(input.milestone_key || "").trim();
  const baseSha = String(input.base_github_sha || "").trim().toLowerCase();
  const subject = input.subject && typeof input.subject === "object" && !Array.isArray(input.subject) ? input.subject as JsonObject : {};
  const policy = String(input.execution_policy || "SOVEREIGN_ONLY");
  const gptModel = String(input.gpt_model || GPT_MODEL);
  const glmModel = String(input.glm_model || GLM_MODEL);
  if (duelKey.length < 3) throw new Error("duel_key_required");
  if (!milestone) throw new Error("milestone_key_required");
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("base_github_sha_invalid");
  if (policy === "HOSTED_ONLY") throw new Error("hosted_v4_executor_not_implemented");
  if (!new Set(["SOVEREIGN_ONLY", "ANY"]).has(policy)) throw new Error("execution_policy_invalid");
  const result = await pool.query<{ v: JsonObject }>(
    "select public.h205f22_duel_create_same_point_v4($1::text,$2::text,$3::text,$4::jsonb,$5::text,$6::text,$7::text) as v",
    [duelKey, milestone, baseSha, JSON.stringify(subject), policy, gptModel, glmModel],
  );
  return result.rows[0]?.v || {};
}

async function readDuel(duelId: string): Promise<JsonObject> {
  const result = await pool.query<{ v: JsonObject }>(
    "select public.h205f22_duel_read_same_point_v4($1::uuid) as v",
    [duelId],
  );
  return result.rows[0]?.v || {};
}

async function signalDuel(duelId: string): Promise<JsonObject> {
  const result = await pool.query<{ duel_key: string; checkpoint: string; status: string; protocol: string | null }>(
    "select duel_key,current_checkpoint_sha256 as checkpoint,status,subject->>'debate_protocol' as protocol from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=$1::uuid",
    [duelId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("duel_not_found");
  if (row.protocol !== "SAME_POINT_DUEL_V4") throw new Error("duel_protocol_mismatch");
  if (!new Set(["READY", "RUNNING"]).has(row.status)) throw new Error("duel_not_wakeable");
  const payload = JSON.stringify({ duel_id: duelId, duel_key: row.duel_key, checkpoint_sha256: row.checkpoint, debate_protocol: row.protocol, source: "sovereign-control" });
  await pool.query("select pg_notify($1::text,$2::text)", [CHANNEL, payload]);
  return { accepted: true, duel_id: duelId, channel: CHANNEL, status: row.status };
}

function parseV4Path(pathname: string): { duelId?: string; tail?: string } | null {
  const match = pathname.match(/^\/v4\/duels\/([^/]+)(?:\/(decision|wake))?$/);
  if (!match) return null;
  return { duelId: match[1], tail: match[2] };
}

const server = createServer(async (req, res) => {
  requestsTotal += 1;
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { status: "ok", service: "metaengine-sovereign-control", protocol: "SAME_POINT_DUEL_V4" });
      return;
    }
    if (method === "GET" && url.pathname === "/readyz") {
      const state = await readiness();
      sendJson(res, state.ready === true ? 200 : 503, { ready: state.ready, protocol: state.protocol });
      return;
    }
    if (method === "GET" && url.pathname === "/metrics") {
      if (!requireAuth(req, res)) return;
      sendText(res, 200, [
        "# TYPE metaengine_sovereign_http_requests_total counter",
        `metaengine_sovereign_http_requests_total ${requestsTotal}`,
        "# TYPE metaengine_sovereign_upstream_requests_total counter",
        `metaengine_sovereign_upstream_requests_total ${upstreamRequestsTotal}`,
        "# TYPE metaengine_sovereign_ready gauge",
        `metaengine_sovereign_ready ${lastReady ? 1 : 0}`,
        "",
      ].join("\n"), "text/plain; version=0.0.4; charset=utf-8");
      return;
    }
    if (method === "GET" && url.pathname === "/status") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, await readiness());
      return;
    }
    if (method === "GET" && url.pathname === "/v1/models") {
      if (!requireAuth(req, res)) return;
      const state = await readiness();
      sendJson(res, 200, {
        object: "list",
        data: [
          { id: GPT_MODEL, object: "model", owned_by: "sovereign-gpt", ready: (state.gpt as JsonObject).ok === true },
          { id: GLM_MODEL, object: "model", owned_by: "sovereign-glm", ready: (state.glm as JsonObject).ok === true },
        ],
      });
      return;
    }
    if (method === "GET" && url.pathname === "/gpt/v1/models") {
      if (!requireAuth(req, res)) return;
      await proxyModel(req, res, "GPT", "models");
      return;
    }
    if (method === "GET" && url.pathname === "/glm/v1/models") {
      if (!requireAuth(req, res)) return;
      await proxyModel(req, res, "GLM", "models");
      return;
    }
    if (method === "POST" && url.pathname === "/gpt/v1/chat/completions") {
      if (!requireAuth(req, res)) return;
      await proxyModel(req, res, "GPT", "chat");
      return;
    }
    if (method === "POST" && url.pathname === "/glm/v1/chat/completions") {
      if (!requireAuth(req, res)) return;
      await proxyModel(req, res, "GLM", "chat");
      return;
    }
    if (method === "POST" && url.pathname === "/v4/duels") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 201, await createDuel(await readJson(req)));
      return;
    }
    const v4 = parseV4Path(url.pathname);
    if (v4?.duelId && uuid(v4.duelId)) {
      if (!requireAuth(req, res)) return;
      if (method === "GET" && !v4.tail) {
        sendJson(res, 200, await readDuel(v4.duelId));
        return;
      }
      if (method === "GET" && v4.tail === "decision") {
        const full = await readDuel(v4.duelId);
        sendJson(res, 200, { duel_id: v4.duelId, decision: full.decision ?? null, status: full.status ?? null });
        return;
      }
      if (method === "POST" && v4.tail === "wake") {
        sendJson(res, 202, await signalDuel(v4.duelId));
        return;
      }
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "internal_error";
    const clientErrors = new Set([
      "request_body_too_large", "json_object_required", "duel_key_required", "milestone_key_required",
      "base_github_sha_invalid", "execution_policy_invalid", "hosted_v4_executor_not_implemented",
      "duel_not_found", "duel_protocol_mismatch", "duel_not_wakeable",
    ]);
    const status = code === "request_body_too_large" ? 413 : clientErrors.has(code) ? 400 : 500;
    sendJson(res, status, { error: status >= 500 ? "internal_error" : code });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    status: "LISTENING",
    service: "metaengine-sovereign-control",
    host: HOST,
    port: PORT,
    protocol: "SAME_POINT_DUEL_V4",
    control_auth: CONTROL_TOKEN ? "BEARER" : "LOOPBACK_ONLY",
    gpt_model: GPT_MODEL,
    glm_model: GLM_MODEL,
  }));
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ status: "STOPPING", signal }));
  server.close();
  await pool.end().catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal).finally(() => { process.exitCode = 0; }));
}
