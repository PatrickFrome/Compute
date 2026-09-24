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

export type RpcReconcileResult =
  | {
      ok: true; schema: string; mode: "live"; verdict: "PASS" | "FAIL"; ran_at: string;
      registry: {
        expected_total: number; actual_total: number;
        per_tier_expected: Record<string, number>; per_tier_actual: Record<string, number>;
        missing: string[]; missing_count: number;
        extra: string[]; extra_count: number;
        tier_mismatch: string[]; tier_mismatch_count: number;
        bad_lines: string[];
        hash_expected: string; hash_actual: string;
      };
      duration_ms: number; cached?: boolean;
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

/** Живая сверка: bash-скрипт (psql-канал) → JSON → честная раздача. Никогда не бросает. */
export async function runRpcReconcileAsync(force = false): Promise<RpcReconcileResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    const c = cache.data;
    return c.ok && "mode" in c && c.mode === "live" ? { ...c, cached: true } : c;
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
      if (code === 3) return resolve({ ok: false, schema: RPC_RECONCILE_SCHEMA, mode: "live", reason: "psql_unavailable" });
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
