// ── R68 «Webhooks-in (push)»: POST /hooks/github — HMAC-верифицированный вход событий ──
//
// Роль (P0-e по DAG R65, вторая фаза — push): внешний триггер-канал ME2.
// GitHub (или любой совместимый отправитель) шлёт webhook → daemon проверяет
// X-Hub-Signature-256 (HMAC-SHA256 над RAW-телом, сравнение timing-safe) → событие
// в event-log (HOOK_PING / GIT_PUSH / CI_HOOK_RUN_COMPLETED|FAILED / HOOK_EVENT) →
// sqlmirror зеркалит в облако. Дедупликация по X-GitHub-Delivery (GUID) — повторные
// доставки GitHub (retry по таймауту) не плодят дубли событий (in-memory, честно:
// рестарт очищает окно дедупа — новые доставки всё равно приходят с новыми GUID).
//
// Секрет: vault (tokenGet GITHUB_WEBHOOK_SECRET) — канон; ME2_WEBHOOK_SECRET env —
// ТОЛЬКО dev-самотест (честный флаг "env-dev" в статусе, вердикт DEV_SECRET).
// Без секрета — 503 + вердикт NO_SECRET (канал не активирован оператором), честно.
//
// Разделение с pull-каналом (ci.ts): webhook workflow_run эмитит СВОИ типы
// CI_HOOK_RUN_* (не CI_RUN_*), чтобы одна сборка не считалась дважды.
//
// Zero-authority: события — наблюдения; на шину решений не влияют; 47-инвариант
// не трогается (POST /hooks/github и GET /hooks вне шины).
//
// Аналоги: GitHub webhook receivers (smee.io), ArgoCD webhooks, K8s Event API (push).

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, emit, getMeta, nowIso, setMeta } from "../store";
import { tokenGet } from "./tokens";

export const HOOKS_SCHEMA = "me2.hooks.v2";
const DEDUPE_CAP = 512;

// R69: дедуп ПЕРСИСТЕНТЕН — таблица hook_deliveries переживает рестарт daemon'а
// (урок R68: in-memory окно очищалось рестартом; повторы GitHub после рестарта
// плодили бы дубли). PK-lookup на каждый POST — дёшево; кап 512 строк.
let hooksSchemaReady = false;
function ensureSchema(): void {
  if (hooksSchemaReady) return;
  db.run("CREATE TABLE IF NOT EXISTS hook_deliveries (guid TEXT PRIMARY KEY, event TEXT, at TEXT NOT NULL)");
  hooksSchemaReady = true;
}
function hasDelivery(guid: string): boolean {
  ensureSchema();
  return !!db.query("SELECT 1 FROM hook_deliveries WHERE guid = ?").get(guid);
}
function recordDelivery(guid: string, event: string): void {
  ensureSchema();
  db.query("INSERT OR IGNORE INTO hook_deliveries (guid, event, at) VALUES (?, ?, ?)").run(guid, event, nowIso());
  db.run(`DELETE FROM hook_deliveries WHERE guid NOT IN (SELECT guid FROM hook_deliveries ORDER BY rowid DESC LIMIT ${DEDUPE_CAP})`);
}
function deliveriesCount(): number {
  ensureSchema();
  const r = db.query("SELECT COUNT(*) AS n FROM hook_deliveries").get() as { n?: number } | null;
  return Number(r?.n ?? 0);
}

export type HookDelivery = {
  delivery: string;
  event: string;
  action: string | null;
  emitted: string[];
  at: string;
};

export type HooksStatus = {
  ok: boolean;
  schema: string;
  secret: "vault" | "env-dev" | "missing";
  received_total: number;
  verified_total: number;
  rejected_total: number;
  events_emitted_total: number;
  rejected_last_reason: string | null;
  dedupe_size: number;
  dedupe_persistent: boolean;
  gateway: { path: string; via: string; secret_header: string; observed_origin: string | null; observed_candidates: string[] };
  events_supported: string[];
  last_delivery_at: string | null;
  deliveries: HookDelivery[];
  verdict: "LIVE" | "DEV_SECRET" | "NO_SECRET" | "WARMUP";
};

const deliveries: HookDelivery[] = [];

// R69.1: сеем дисплей-историю из персистентной таблицы при старте — карточка сразу
// показывает последние доставки (в т.ч. внешние), а не «доставок нет» после рестарта
function seedDeliveriesFromDb(): void {
  try {
    ensureSchema();
    const rows = db.query("SELECT guid, event, at FROM hook_deliveries ORDER BY rowid DESC LIMIT 8").all() as { guid: string; event: string | null; at: string }[];
    for (const r of rows.reverse()) {
      deliveries.push({ delivery: r.guid.slice(0, 16), event: r.event ?? "unknown", action: null, emitted: ["persisted"], at: r.at });
    }
  } catch { /* посев не критичен */ }
}
seedDeliveriesFromDb();

function secretSource(): { secret: string; source: "vault" | "env-dev" } | null {
  const v = tokenGet("GITHUB_WEBHOOK_SECRET");
  if (v) return { secret: v, source: "vault" };
  const e = process.env.ME2_WEBHOOK_SECRET;
  if (e) return { secret: e, source: "env-dev" };
  return null;
}

/** Сравнение hex-подписей за константное время (timing-safe). */
function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifySignature(raw: Buffer, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const hex = header.slice(7).trim().toLowerCase();
  const expect = createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqualHex(hex, expect);
}

function metaNum(k: string): number {
  return Number(getMeta(k) || 0);
}

function bump(k: string): void {
  setMeta(k, String(metaNum(k) + 1));
}

function pushDelivery(d: HookDelivery): void {
  deliveries.unshift(d);
  if (deliveries.length > 8) deliveries.pop();
}

/** Обработка одного webhook-POST (raw body). Никогда не бросает. */
export function handleGithubWebhook(
  headers: { delivery: string | null; event: string | null; signature: string | null },
  raw: Buffer,
): { status: number; body: Record<string, unknown> } {
  try {
    bump("hooks_received");
    const s = secretSource();
    if (!s) {
      setMeta("hooks_rejected_last", "no_secret");
      return {
        status: 503,
        body: {
          ok: false,
          error: "webhook_secret_not_configured",
          hint: "GITHUB_WEBHOOK_SECRET в vault (POST /tokens op=set) — канон; ME2_WEBHOOK_SECRET env — только dev-самотест",
        },
      };
    }
    if (!verifySignature(raw, headers.signature, s.secret)) {
      bump("hooks_rejected");
      setMeta("hooks_rejected_last", headers.signature ? "bad_signature" : "signature_missing");
      return { status: 401, body: { ok: false, error: "invalid_signature" } };
    }
    // Дедуп по GUID доставки (idempotent replay, ПЕРСИСТЕНТЕН — R69)
    const delivery = headers.delivery || `noguid-${Date.now().toString(36)}`;
    if (hasDelivery(delivery)) {
      return { status: 200, body: { ok: true, dedupe: true, delivery: delivery.slice(0, 16), persisted: true } };
    }
    recordDelivery(delivery, headers.event ?? "unknown");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    } catch {
      bump("hooks_rejected");
      setMeta("hooks_rejected_last", "body_not_json");
      return { status: 400, body: { ok: false, error: "body_not_json" } };
    }
    const event = headers.event || "unknown";
    const action = typeof payload.action === "string" ? payload.action : null;
    const repoObj = payload.repository as Record<string, unknown> | undefined;
    const repo = typeof repoObj?.full_name === "string" ? String(repoObj.full_name) : null;
    const emitted: string[] = [];
    const tr = (t: string, d: Record<string, unknown>) => {
      try {
        emit(t, d, null, null);
        emitted.push(t);
      } catch {
        /* шина не критична */
      }
    };
    if (event === "ping") {
      tr("HOOK_PING", {
        zen: typeof payload.zen === "string" ? (payload.zen as string).slice(0, 120) : null,
        hook_id: payload.hook_id ?? null,
        repo,
      });
    } else if (event === "push") {
      const pusher = payload.pusher as Record<string, unknown> | undefined;
      tr("GIT_PUSH", {
        ref: typeof payload.ref === "string" ? payload.ref : null,
        sha7: typeof payload.after === "string" ? String(payload.after).slice(0, 7) : null,
        pusher: typeof pusher?.name === "string" ? String(pusher.name) : null,
        commits: Array.isArray(payload.commits) ? payload.commits.length : 0,
        repo,
      });
    } else if (event === "pull_request") {
      // R69: PR-события — вход для fleet-целей (ветка открыта/закрыта/влита)
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      const base = {
        number: pr ? Number(pr.number ?? 0) : null,
        title: pr && typeof pr.title === "string" ? (pr.title as string).slice(0, 120) : null,
        action,
        sender: typeof (payload.sender as Record<string, unknown> | undefined)?.login === "string"
          ? String((payload.sender as Record<string, unknown>).login)
          : null,
        repo,
      };
      if (action === "opened") tr("GIT_PR_OPENED", base);
      else if (action === "closed" && pr?.merged === true) tr("GIT_PR_MERGED", base);
      else if (action === "closed") tr("GIT_PR_CLOSED", base);
      else tr("HOOK_EVENT", { event, action, repo });
    } else if (event === "workflow_run" && action === "completed") {
      const wr = payload.workflow_run as Record<string, unknown> | undefined;
      const okRun = wr?.conclusion === "success";
      tr(okRun ? "CI_HOOK_RUN_COMPLETED" : "CI_HOOK_RUN_FAILED", {
        run_id: wr ? Number(wr.id) : null,
        name: wr ? String(wr.name ?? "?") : "?",
        sha7: wr && typeof wr.head_sha === "string" ? String(wr.head_sha).slice(0, 7) : null,
        conclusion: wr?.conclusion ? String(wr.conclusion) : null,
        repo,
        via: "webhook",
      });
    } else {
      tr("HOOK_EVENT", { event, action, repo });
    }
    bump("hooks_verified");
    if (emitted.length) setMeta("hooks_events_emitted", String(metaNum("hooks_events_emitted") + emitted.length));
    setMeta("hooks_last_delivery_at", new Date().toISOString());
    pushDelivery({ delivery: delivery.slice(0, 16), event, action, emitted, at: new Date().toISOString() });
    return { status: 200, body: { ok: true, event, action, emitted } };
  } catch (e) {
    return { status: 500, body: { ok: false, error: String(e).slice(0, 160) } };
  }
}

export function hooksStatus(): HooksStatus {
  const s = secretSource();
  const verified = metaNum("hooks_verified");
  const verdict: HooksStatus["verdict"] = !s
    ? "NO_SECRET"
    : s.source === "env-dev"
      ? "DEV_SECRET"
      : verified > 0
        ? "LIVE"
        : "WARMUP";
  return {
    ok: true,
    schema: HOOKS_SCHEMA,
    secret: !s ? "missing" : s.source === "vault" ? "vault" : "env-dev",
    received_total: metaNum("hooks_received"),
    verified_total: verified,
    rejected_total: metaNum("hooks_rejected"),
    events_emitted_total: metaNum("hooks_events_emitted"),
    rejected_last_reason: getMeta("hooks_rejected_last") || null,
    dedupe_size: deliveriesCount(),
    last_delivery_at: getMeta("hooks_last_delivery_at") || null,
    deliveries: [...deliveries],
    dedupe_persistent: true,
    gateway: {
      path: "/hooks/github",
      via: ":81 /hooks/github?XTransformPort=3041 (Caddy reverse_proxy — тело и заголовки прозрачны, HMAC сохраняется)",
      secret_header: "X-Hub-Signature-256",
      // R69.1: публичный origin, наблюдённый в живом трафике через preview-прокси (мета public_origin_last / host_candidates)
      observed_origin: getMeta("public_origin_last") || null,
      observed_candidates: (() => { try { return JSON.parse(getMeta("host_candidates") || "[]") as string[]; } catch { return []; } })(),
    },
    events_supported: ["ping", "push", "pull_request", "workflow_run"],
    verdict,
  };
}

export const HOOKS_NOTE =
  "P0-e webhooks-in (push): POST /hooks/github — HMAC-SHA256 (X-Hub-Signature-256, timing-safe), персистентный дедуп X-GitHub-Delivery (SQLite, переживает рестарт — R69), HOOK_PING/GIT_PUSH/GIT_PR_*/CI_HOOK_RUN_* → event-log → sqlmirror в облако; gateway-лег :81?XTransformPort=3041; регистрация в репо — scripts/webhook-register.sh";
