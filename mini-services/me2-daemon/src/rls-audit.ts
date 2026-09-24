// ── R58 «Политики как данные»: RLS-самоаудит облака против ожидаемой матрицы ──
//
// Роль (план R58): sql/0003 (политики) + sql/0004 (гранты) + relrowsecurity (sql/0001/0002)
// — ИСТОЧНИК ОЖИДАНИЙ; живой каталог Postgres — ФАКТ. Модуль сводит их (psql-канал R56,
// скрипт scripts/rls-audit.sh) и отдаёт результат через GET /sqlmirror/rls-audit.
// Аналоги: git fsck, Terraform drift detection, pg_dump schema-diff — «ожидаемое состояние
// как данные», не как память оператора.
//
// Семантика вердикта (урок живой пробы R58-1): СТРОГО по DML-слою (SELECT/INSERT/UPDATE/
// DELETE — то, чем оперирует PostgREST-гейт); REFERENCES/TRIGGER/TRUNCATE — платформенные
// дефолты Supabase-проекта (ALTER DEFAULT PRIVILEGES), PostgREST их не открывает — info.
// anon fail-closed = 0 DML-грантов + 0 политик (доказано живой 42501-пробой R56).
//
// Zero-authority: read-only интроспекция; на шину, решения и self-update не влияет.
// 47-инвариант не трогается (вне шины). Probe-режим (eval/CI) — честный офлайн-ответ.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLMIRROR_TABLE } from "./sqlmirror";

export const RLS_AUDIT_SCHEMA = "me2.rls-audit.v1";
export const RPC_REGISTRY_TABLE = process.env.ME2_RPC_REGISTRY_TABLE || "me2_rpc_registry_h205f22";
const AUDIT_SCRIPT = join(import.meta.dir, "..", "scripts", "rls-audit.sh");
const CACHE_MS = 60_000; // анти-шторм: живой psql-пробой не чаще раза в минуту

/** Ожидаемая DML-матрица (источник: sql/0004-mirror-grants.sql) — данные, не строки. */
export const RLS_EXPECTED_DML: Array<{ table: string; role: string; privs: string[] }> = [
  { table: SQLMIRROR_TABLE, role: "authenticated", privs: ["SELECT"] },
  { table: SQLMIRROR_TABLE, role: "service_role", privs: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
  { table: RPC_REGISTRY_TABLE, role: "authenticated", privs: ["SELECT"] },
  { table: RPC_REGISTRY_TABLE, role: "service_role", privs: ["SELECT"] },
];

/** Ожидаемые политики (источник: sql/0003-mirror-read-policy.sql). */
export const RLS_EXPECTED_POLICIES: Array<{ table: string; policy: string; role: string; cmd: string }> = [
  { table: SQLMIRROR_TABLE, policy: "me2_event_mirror_read_auth", role: "authenticated", cmd: "SELECT" },
  { table: RPC_REGISTRY_TABLE, policy: "me2_rpc_registry_read_auth", role: "authenticated", cmd: "SELECT" },
];

/** Ожидаемые RLS-флаги (sql/0001/0002: enable row level security). */
export const RLS_EXPECTED_FLAGS = [SQLMIRROR_TABLE, RPC_REGISTRY_TABLE];

export type RlsAuditResult =
  | {
      ok: true; schema: string; mode: "live"; verdict: "PASS" | "FAIL"; ran_at: string;
      grants: { expected_dml: string; actual_dml: string; mismatch: number; platform_extra: string[]; platform_anon_rows: number };
      policies: { expected: string; actual: string; rows: string[]; mismatch: number };
      rls_flags: Record<string, boolean>;
      anon: { dml_grants: number; policies: number };
      duration_ms: number; cached?: boolean;
    }
  | { ok: false; schema: string; mode: "live"; reason: string; detail?: string }
  | {
      ok: true; schema: string; mode: "probe_offline"; reason: "audit_live_skipped_in_probe";
      script_present: boolean; expected: { dml_rows: number; policies: number; flags: string[]; anon_dml: number; anon_policies: number };
      note: string;
    };

let cache: { at: number; data: RlsAuditResult } | null = null;
let busy: Promise<RlsAuditResult> | null = null;

/** Пробный (офлайн) режим: eval/CI — без сети и секретов, честная сводка ожиданий. */
export function rlsAuditProbeOffline(): RlsAuditResult {
  return {
    ok: true, schema: RLS_AUDIT_SCHEMA, mode: "probe_offline", reason: "audit_live_skipped_in_probe",
    script_present: existsSync(AUDIT_SCRIPT),
    expected: {
      dml_rows: RLS_EXPECTED_DML.length,
      policies: RLS_EXPECTED_POLICIES.length,
      flags: RLS_EXPECTED_FLAGS,
      anon_dml: 0,
      anon_policies: 0,
    },
    note: "живой psql-аудит в probe-режиме не выполняется (изолированный инстанс без сети/секретов) — матрица ожиданий проверена офлайн",
  };
}

/** Живой аудит: bash-скрипт (psql-канал) → JSON → честная раздача. Никогда не бросает. */
export async function runRlsAuditAsync(force = false): Promise<RlsAuditResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    const c = cache.data;
    return c.ok && "mode" in c && c.mode === "live" ? { ...c, cached: true } : c;
  }
  if (process.env.ME2_BOOT_MODE === "probe") return rlsAuditProbeOffline();
  if (busy) return busy;
  busy = new Promise<RlsAuditResult>((resolve) => {
    const outDir = mkdtempSync(join(tmpdir(), "me2-rls-audit."));
    const outFile = join(outDir, "result.json");
    const t0 = Date.now();
    const child = spawn("bash", [AUDIT_SCRIPT], {
      env: { ...process.env, ME2_RLS_AUDIT_OUT: outFile },
      timeout: 30_000,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d).slice(0, 300); });
    child.on("error", (e) => {
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* tmp */ }
      busy = null;
      resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "spawn_failed", detail: String(e).slice(0, 140) });
    });
    child.on("close", (code) => {
      busy = null;
      // Урок R58-1 (аудит поймал собственный баг): результат читаем ДО удаления tmp-каталога.
      let raw: string | null = null;
      try { raw = readFileSync(outFile, "utf8"); } catch { raw = null; }
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* tmp */ }
      if (code === 2) return resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "no_db_url" });
      if (code === 3) return resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "psql_unavailable" });
      if (code === 4) return resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "not_supabase_url" });
      if (code === 6) return resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "query_failed", detail: stderr.slice(0, 160) });
      if (raw === null) {
        return resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: code === 5 ? "mismatch_no_json" : "no_json", detail: stderr.slice(0, 160) });
      }
      try {
        const j = JSON.parse(raw) as {
          verdict: "PASS" | "FAIL"; ran_at: string;
          grants: { expected_dml: string; actual_dml: string; mismatch: number; platform_extra: string[]; platform_anon_rows: number };
          policies: { expected: string; actual: string; rows: string[]; mismatch: number };
          rls_flags: Record<string, boolean>;
          anon: { dml_grants: number; policies: number };
        };
        const result: RlsAuditResult = {
          ok: true, schema: RLS_AUDIT_SCHEMA, mode: "live", verdict: j.verdict, ran_at: j.ran_at,
          grants: j.grants, policies: j.policies, rls_flags: j.rls_flags, anon: j.anon,
          duration_ms: Date.now() - t0,
        };
        cache = { at: Date.now(), data: result };
        resolve(result);
      } catch (e) {
        resolve({ ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "bad_json", detail: String(e).slice(0, 120) });
      }
    });
  });
  return busy;
}
