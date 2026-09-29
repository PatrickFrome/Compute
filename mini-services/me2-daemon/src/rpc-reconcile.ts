// ── R59 «Реестр как данные»: сверка живого RPC-реестра облака с классификацией R52 ──
//
// Роль (план R59): research/2026/r52-rpc-registry.json (243 RPC, ACTIVE 24 /
// CONTROL_PLANE 37 / FREEZE 182 — собран из живого OpenAPI в R52, версионирован в
// репо) — ИСТОЧНИК ОЖИДАНИЙ; живая таблица me2_rpc_registry_h205f22 (psql-канал R56,
// скрипт scripts/rpc-reconcile.sh) — ФАКТ. Модуль сводит их (count + поимённый состав
// + тир-дрейф + sha256-хеш множества) и отдаёт результат через GET /sqlmirror/rpc-reconcile.
// Аналоги: Kubernetes reconcile (desired vs observed), AWS Config drift detection,
// Terraform plan — «ожидаемое состояние как данные», не как память оператора.
//
// Zero-authority: read-only сверка; на шину, решения и self-update не влияет.
// 47-инвариант не трогается (вне шины). Probe-режим (eval/CI) — честный офлайн-ответ.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tokenGet } from "./tokens";
import { RPC_REGISTRY_TABLE } from "./rls-audit";

export const RPC_RECONCILE_SCHEMA = "me2.rpc-reconcile.v1";
const RECONCILE_SCRIPT = join(import.meta.dir, "..", "scripts", "rpc-reconcile.sh");
const EXPECTED_JSON = join(import.meta.dir, "..", "..", "..", "research", "2026", "r52-rpc-registry.json");
const CACHE_MS = 60_000; // анти-шторм: живой psql-пробой не чаще раза в минуту

/** Ожидаемая классификация (источник: r52-rpc-registry.json → sql/0002) — данные, не строки. */
export const RPC_EXPECTED_TOTAL = 243;
export const RPC_EXPECTED_TIERS: Record<"ACTIVE" | "CONTROL_PLANE" | "FREEZE", number> = {
  ACTIVE: 24,
  CONTROL_PLANE: 37,
  FREEZE: 182,
};

type RpcRegistryDigest = {
  expected_total: number; actual_total: number;
  per_tier_expected: Record<string, number>; per_tier_actual: Record<string, number>;
  missing: string[]; missing_count: number;
  extra: string[]; extra_count: number;
  tier_mismatch: string[]; tier_mismatch_count: number;
  bad_lines: string[];
  hash_expected: string; hash_actual: string;
};

export type RpcReconcileResult =
  | {
      ok: true; schema: string; mode: "live"; verdict: "PASS" | "FAIL"; ran_at: string;
      registry: RpcRegistryDigest;
      duration_ms: number; cached?: boolean;
    }
  // R66: REST-канал (PostgREST) — факты из me2_rpc_registry_h205f22 + кросс-чек живого OpenAPI.
  // Причина: psql-канал недоступен в песочнице (нет бинаря/SUPABASE_DB_URL) — код 3 → live-rest.
  | {
      ok: true; schema: string; mode: "live-rest"; verdict: "PASS" | "FAIL"; ran_at: string;
      registry: RpcRegistryDigest;
      openapi_total: number | null;
      duration_ms: number; cached?: boolean; note: string;
    }
  | { ok: false; schema: string; mode: "live"; reason: string; detail?: string }
  | {
      ok: true; schema: string; mode: "probe_offline"; reason: "reconcile_live_skipped_in_probe";
      script_present: boolean; expected_source_present: boolean;
      expected: { total: number; tiers: Record<string, number> };
      note: string;
    };

let cache: { at: number; data: RpcReconcileResult } | null = null;
let busy: Promise<RpcReconcileResult> | null = null;

/** Пробный (офлайн) режим: eval/CI — без сети и секретов, честная сводка ожиданий. */
export function rpcReconcileProbeOffline(): RpcReconcileResult {
  return {
    ok: true, schema: RPC_RECONCILE_SCHEMA, mode: "probe_offline", reason: "reconcile_live_skipped_in_probe",
    script_present: existsSync(RECONCILE_SCRIPT),
    expected_source_present: existsSync(EXPECTED_JSON),
    expected: { total: RPC_EXPECTED_TOTAL, tiers: { ...RPC_EXPECTED_TIERS } },
    note: "живая psql-сверка в probe-режиме не выполняется (изолированный инстанс без сети/секретов) — ожидания R52 проверены офлайн",
  };
}

/** R66: REST-канал (PostgREST) — факты из таблицы реестра + кросс-чек живого OpenAPI. Никогда не бросает. */
async function rpcReconcileRest(): Promise<RpcReconcileResult> {
  const t0 = Date.now();
  const base = (tokenGet("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = tokenGet("SUPABASE_SERVICE_ROLE_JWT");
  if (!base || !key) return { ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "no_rest_credentials" };
  // Ожидания (источник — версионированный в репо r52-rpc-registry.json, как у psql-канала).
  let expected: { total: number; tiers: Record<string, number>; names: Record<string, string[]> };
  try {
    const raw = JSON.parse(readFileSync(EXPECTED_JSON, "utf8")) as {
      total: number; counts: Record<string, number>; ACTIVE: string[]; CONTROL_PLANE: string[]; FREEZE: string[];
    };
    expected = { total: raw.total, tiers: raw.counts, names: { ACTIVE: raw.ACTIVE, CONTROL_PLANE: raw.CONTROL_PLANE, FREEZE: raw.FREEZE } };
  } catch {
    return { ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "expected_source_missing", detail: EXPECTED_JSON };
  }
  try {
    const hdr = { apikey: key, Authorization: `Bearer ${key}` };
    const rr = await fetch(`${base}/rest/v1/${RPC_REGISTRY_TABLE}?select=rpc_name,tier&limit=1000`, { headers: hdr, signal: AbortSignal.timeout(8000) });
    if (!rr.ok) return { ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "rest_registry_read_failed", detail: `HTTP ${rr.status}` };
    const rows = (await rr.json()) as Array<{ rpc_name?: string; tier?: string }>;
    // Кросс-чек с живым OpenAPI: таблица может отставать от развернутых функций (честная асимметрия).
    let openapiTotal: number | null = null;
    try {
      const os = await fetch(`${base}/rest/v1/`, { headers: hdr, signal: AbortSignal.timeout(8000) });
      if (os.ok) {
        const spec = (await os.json()) as { paths?: Record<string, unknown> };
        openapiTotal = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/rpc/")).length;
      }
    } catch { /* OpenAPI — best-effort, не валит сверку */ }
    const actualRows = rows.filter((r) => r && typeof r.rpc_name === "string" && typeof r.tier === "string") as Array<{ rpc_name: string; tier: string }>;
    const actualSet = new Set(actualRows.map((r) => r.rpc_name));
    const expectedTierOf = new Map<string, string>();
    for (const [tier, names] of Object.entries(expected.names)) for (const n of names) expectedTierOf.set(n, tier);
    const missing = [...expectedTierOf.keys()].filter((n) => !actualSet.has(n)).sort();
    const extra = actualRows.map((r) => r.rpc_name).filter((n) => !expectedTierOf.has(n)).sort();
    const tierMismatch = actualRows
      .filter((r) => expectedTierOf.has(r.rpc_name) && expectedTierOf.get(r.rpc_name) !== r.tier)
      .map((r) => `${r.rpc_name}:${r.tier}≠${expectedTierOf.get(r.rpc_name)}`)
      .sort();
    const perTierActual: Record<string, number> = { ACTIVE: 0, CONTROL_PLANE: 0, FREEZE: 0 };
    for (const r of actualRows) if (r.tier in perTierActual) perTierActual[r.tier]++;
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const hashExpected = sha(Object.entries(expected.names).flatMap(([t, ns]) => ns.map((n) => `${n}|${t}`)).sort().join("\n"));
    const hashActual = sha(actualRows.map((r) => `${r.rpc_name}|${r.tier}`).sort().join("\n"));
    const verdict: "PASS" | "FAIL" = missing.length === 0 && extra.length === 0 && tierMismatch.length === 0 ? "PASS" : "FAIL";
    const result: RpcReconcileResult = {
      ok: true, schema: RPC_RECONCILE_SCHEMA, mode: "live-rest", verdict, ran_at: new Date().toISOString(),
      registry: {
        expected_total: expected.total, actual_total: actualRows.length,
        per_tier_expected: expected.tiers, per_tier_actual: perTierActual,
        missing, missing_count: missing.length, extra, extra_count: extra.length,
        tier_mismatch: tierMismatch, tier_mismatch_count: tierMismatch.length,
        bad_lines: [], hash_expected: hashExpected, hash_actual: hashActual,
      },
      openapi_total: openapiTotal,
      duration_ms: Date.now() - t0,
      note: "REST-канал (PostgREST): факт = таблица реестра; pg_catalog недоступен из REST — классификация сверяется поимённо (sql/0002 проверяется офлайн-миграциями)",
    };
    cache = { at: Date.now(), data: result };
    return result;
  } catch (e) {
    return { ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "rest_failed", detail: String(e).slice(0, 140) };
  }
}

/** Живая сверка: bash-скрипт (psql-канал) → JSON → честная раздача. Никогда не бросает. */
export async function runRpcReconcileAsync(force = false): Promise<RpcReconcileResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    const c = cache.data;
    return c.ok && "mode" in c && (c.mode === "live" || c.mode === "live-rest") ? { ...c, cached: true } : c;
  }
  if (process.env.ME2_BOOT_MODE === "probe") return rpcReconcileProbeOffline();
  if (busy) return busy;
  busy = new Promise<RpcReconcileResult>((resolve) => {
    const outDir = mkdtempSync(join(tmpdir(), "me2-rpc-reconcile."));
    const outFile = join(outDir, "result.json");
    const t0 = Date.now();
    const child = spawn("bash", [RECONCILE_SCRIPT], {
      env: { ...process.env, ME2_RPC_RECONCILE_OUT: outFile },
      timeout: 30_000,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d).slice(0, 300); });
    child.on("error", (e) => {
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* tmp */ }
      busy = null;
      resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "spawn_failed", detail: String(e).slice(0, 140) });
    });
    child.on("close", (code) => {
      busy = null;
      // Урок R58-1 (аудит поймал собственный баг): результат читаем ДО удаления tmp-каталога.
      let raw: string | null = null;
      try { raw = readFileSync(outFile, "utf8"); } catch { raw = null; }
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* tmp */ }
      if (code === 2) return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "no_db_url" });
      if (code === 3) { void rpcReconcileRest().then(resolve); return; } // R66: psql недоступен → REST-канал
      if (code === 4) return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "not_supabase_url" });
      if (code === 7) return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "expected_source_missing", detail: EXPECTED_JSON });
      if (code === 6) return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "query_failed", detail: stderr.slice(0, 160) });
      if (raw === null) {
        return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: code === 5 ? "mismatch_no_json" : "no_json", detail: stderr.slice(0, 160) });
      }
      try {
        const j = JSON.parse(raw) as {
          verdict: "PASS" | "FAIL"; ran_at: string;
          registry: RpcReconcileResult extends { registry: infer R } ? R : never;
        };
        const result: RpcReconcileResult = {
          ok: true, schema: RPC_RECONCILE_SCHEMA, mode: "live", verdict: j.verdict, ran_at: j.ran_at,
          registry: j.registry,
          duration_ms: Date.now() - t0,
        };
        cache = { at: Date.now(), data: result };
        resolve(result);
      } catch (e) {
        resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "bad_json", detail: String(e).slice(0, 120) });
      }
    });
  });
  return busy;
}
