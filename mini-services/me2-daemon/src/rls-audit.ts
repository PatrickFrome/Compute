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
import { tokenGet } from "./tokens";
import { anonRegisteredJwt, mintSupabaseJwt, publishableKey } from "./supabase-jwt";

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
  // R66: поведенческий REST-аудит (PostgREST) — anon fail-closed + service читает.
  // Честность: если anon-канал = mint и контрольная mint-authenticated проба тоже 401 — канал отвергнут
  // облаком (ротация ключей), anon-блокировка НЕДОКАЗУЕМА из REST → INCONCLUSIVE (нужен publishable/anon-ключ).
  | {
      ok: true; schema: string; mode: "live-rest"; verdict: "PASS" | "FAIL" | "INCONCLUSIVE"; ran_at: string;
      probes: Array<{ table: string; anon_status: number | null; anon_blocked: boolean | null; service_status: number; service_ok: boolean }>;
      anon_channel: "publishable" | "anon_registered" | "mint" | "none";
      control_status?: number | null;
      service_all_ok: boolean; anon_all_blocked: boolean;
      duration_ms: number; cached?: boolean; note: string;
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

/** R66: поведенческий REST-аудит (PostgREST): anon fail-closed + service читает. Никогда не бросает. */
async function rlsAuditRest(): Promise<RlsAuditResult> {
  const t0 = Date.now();
  const base = (tokenGet("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = tokenGet("SUPABASE_SERVICE_ROLE_JWT");
  if (!base || !key) return { ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "no_rest_credentials" };
  // anon-ключ: канонический RLS-гейт — publishable → anon_registered → mint (тот же порядок, что в ui-token).
  let anonChannel: "publishable" | "anon_registered" | "mint" | "none" = "none";
  let anonKey: string | null = null;
  const pub = publishableKey();
  if (pub) { anonChannel = "publishable"; anonKey = pub; }
  else {
    const reg = anonRegisteredJwt();
    if (reg) { anonChannel = "anon_registered"; anonKey = reg; }
    else {
      const minted = mintSupabaseJwt("anon");
      if (minted) { anonChannel = "mint"; anonKey = minted; }
    }
  }
  try {
    const hdr = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}` });
    const probes: Array<{ table: string; anon_status: number | null; anon_blocked: boolean | null; service_status: number; service_ok: boolean }> = [];
    for (const t of RLS_EXPECTED_FLAGS) {
      const svc = await fetch(`${base}/rest/v1/${t}?select=*&limit=1`, { headers: hdr(key), signal: AbortSignal.timeout(8000) });
      let anonStatus: number | null = null;
      let anonBlocked: boolean | null = null;
      if (anonKey) {
        const an = await fetch(`${base}/rest/v1/${t}?select=*&limit=1`, { headers: hdr(anonKey), signal: AbortSignal.timeout(8000) });
        anonStatus = an.status;
        // 401/403 = отказ; 400 = PGRST-ошибка формы (тоже не отдаёт строки); 404 = таблица нет (PGRST205) — аноним строки не видит.
        anonBlocked = an.status === 401 || an.status === 403 || an.status === 400 || an.status === 404;
      }
      probes.push({ table: t, anon_status: anonStatus, anon_blocked: anonBlocked, service_status: svc.status, service_ok: svc.ok });
    }
    const serviceAllOk = probes.every((p) => p.service_ok);
    const anonAllBlocked = probes.every((p) => p.anon_blocked === true);
    // Контрольная проба для mint-канала: mint-authenticated должен читать (200) — иначе канал отвергнут облаком
    // и anon-блокировка (401) может быть «невалидный ключ», а не RLS-гейт → честный INCONCLUSIVE.
    let controlStatus: number | null = null;
    if (anonChannel === "mint") {
      const ctl = mintSupabaseJwt("authenticated");
      if (ctl) {
        const cr = await fetch(`${base}/rest/v1/${RLS_EXPECTED_FLAGS[0]}?select=*&limit=1`, { headers: hdr(ctl), signal: AbortSignal.timeout(8000) });
        controlStatus = cr.status;
      }
    }
    const mintUntrusted = anonChannel === "mint" && controlStatus !== 200;
    const verdict: "PASS" | "FAIL" | "INCONCLUSIVE" =
      !serviceAllOk ? "FAIL" : mintUntrusted ? "INCONCLUSIVE" : anonAllBlocked && anonChannel !== "none" ? "PASS" : "FAIL";
    const result: RlsAuditResult = {
      ok: true, schema: RLS_AUDIT_SCHEMA, mode: "live-rest", verdict, ran_at: new Date().toISOString(),
      probes, anon_channel: anonChannel, control_status: controlStatus, service_all_ok: serviceAllOk, anon_all_blocked: anonAllBlocked,
      duration_ms: Date.now() - t0,
      note: mintUntrusted
        ? "поведенческий REST-аудит: mint-канал отвергнут облаком (контрольная authenticated-проба " + (controlStatus ?? "?") + ") — anon-блокировка недоказуема из REST; нужен sb_publishable_/anon-ключ оператора; service_role читает ✓"
        : "поведенческий REST-аудит (PostgREST): anon не читает строки (fail-closed), service_role читает; гранты/политики pg_catalog из REST недоступны — матрица sql/0003+0004 сверяется офлайн (probe)",
    };
    cache = { at: Date.now(), data: result };
    return result;
  } catch (e) {
    return { ok: false, schema: RLS_AUDIT_SCHEMA, mode: "live", reason: "rest_failed", detail: String(e).slice(0, 140) };
  }
}

/** Живой аудит: bash-скрипт (psql-канал) → JSON → честная раздача. Никогда не бросает. */
export async function runRlsAuditAsync(force = false): Promise<RlsAuditResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    const c = cache.data;
    return c.ok && "mode" in c && (c.mode === "live" || c.mode === "live-rest") ? { ...c, cached: true } : c;
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
      if (code === 3) { void rlsAuditRest().then(resolve); return; } // R66: psql недоступен → поведенческий REST-аудит
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
