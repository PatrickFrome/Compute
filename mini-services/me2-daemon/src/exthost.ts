// ── R60 «extension host»: изоляция расширений skills в подпроцессе ──
//
// Канон — VS Code extension host (разбор: research/2026/r59-analogues §2):
//  - ОТДЕЛЬНЫЙ ПРОЦЕСС: краш расширения не валит daemon (одноразовый spawn на прогон);
//  - API-ПОВЕРХНОСТЬ вместо доступа к ядру: расширение видит ТОЛЬКО stdio
//    (newline-delimited JSON) — ни импортов daemon-модулей, ни fetch, ни БД;
//  - ИЗОЛЯЦИЯ РЕСУРСОВ: prlimit (канон sandbox.ts: --as=1GiB --nofile=256 --core=0)
//    + timeout + env-БЕЛЫЙ-СПИСОК (секреты daemon'а не покидают процесс);
//  - CAPS-МЕДИАЦИЯ: расширение декларирует caps в манифесте; неизвестная cap —
//    честный отказ (fail-closed); данные (зеркало) доставляет ХОСТ сам, у
//    расширения сети нет по построению;
//  - ACTIVATION EVENTS: "manual" и/или "bus:<TYPE>" — опрос шины 30с (level-triggered,
//    узор K8s resync; курсор инициализируется головой шины — старьё не спамится);
//  - $initialize HANDSHAKE: нет корректного ack за 2с — процесс убивается (канон
//    «вечно-THINKING ловится супервизором», у нас — супервизором прогона).
//
// Zero-authority: расширение не пишет ни в шину, ни в БД; вердикт прогона — данные
// для оператора (журнал exthost_runs + событие EXT_RUN + span). 47-инвариант не
// тронут (REST вне шины). Probe-режим (ME2_BOOT_MODE=probe) — честный офлайн-ответ
// без spawn (eval/CI).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db, emit, lastSeq, VERSION } from "../store";
import { recordSpan } from "./otel";
import { sandboxCaps } from "./sandbox";

export const EXTHOST_SCHEMA = "me2.exthost.v1";

const EXT_DIR = join(process.cwd(), "skills", "ext");
const HANDSHAKE_MS = 2_000;
const DEFAULT_RUN_MS = 5_000;
const RESULT_CAP = 3_000;
const EXT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/** Белый список capability (caps-медиация: данные доставляет хост, расширению сети нет). */
export const CAPS_WHITELIST = ["mirror.feed.read"] as const;
export type ExtCap = (typeof CAPS_WHITELIST)[number];

/** Манифест расширения (skills/ext/<id>/ext.json) — декларация, не код. */
export interface ExtManifest {
  id: string;
  title: string;
  version: string;
  entry: string;
  activation: string[]; // "manual" | "bus:<TYPE>"
  caps: string[];
  timeout_ms?: number;
}

/** Все объявленные caps должны быть в белом списке — иначе расширение не запускается. */
export function capsAllowed(caps: unknown): boolean {
  if (!Array.isArray(caps)) return false;
  return caps.every((c) => (CAPS_WHITELIST as readonly string[]).includes(String(c)));
}

// ── DI: провайдер данных зеркала (index.ts привязывает живой SqlMirror; без него — честный отказ) ──
type MirrorFeedProvider = () => Promise<{ ok: boolean; rows?: unknown[]; error?: string }>;
let mirrorFeedProvider: MirrorFeedProvider | null = null;
export function setMirrorFeedProvider(p: MirrorFeedProvider | null): void { mirrorFeedProvider = p; }

// ── журнал прогонов (SQLite; данных оператора, не шина) ──
db.exec(`
CREATE TABLE IF NOT EXISTS exthost_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT,
  ms INTEGER,
  result_excerpt TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exthost_runs_ext ON exthost_runs (ext_id, at);
`);

export type ExtRunResult =
  | { ok: true; schema: string; ext: string; source: string; result: unknown; ms: number; prlimit: boolean }
  | { ok: false; schema: string; ext: string; source: string; reason: string; detail?: string; ms?: number };

/** Каталог расширений: чтение skills/ext/*, fail-closed на битый манифест. Никогда не бросает. */
export function listExts(): { exts: Array<ExtManifest & { caps_ok: boolean }>; errors: Array<{ dir: string; reason: string }> } {
  const exts: Array<ExtManifest & { caps_ok: boolean }> = [];
  const errors: Array<{ dir: string; reason: string }> = [];
  try {
    if (!existsSync(EXT_DIR)) return { exts, errors };
    for (const d of readdirSync(EXT_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!d.isDirectory()) continue;
      const mf = join(EXT_DIR, d.name, "ext.json");
      try {
        const m = JSON.parse(readFileSync(mf, "utf8")) as ExtManifest;
        if (!EXT_ID_RE.test(String(m.id)) || m.id !== d.name) throw new Error("id mismatch/invalid");
        if (!m.entry || !m.entry.endsWith(".js")) throw new Error("entry must be *.js (stdio-only, без shell)");
        if (String(m.entry).includes("..") || String(m.entry).includes("/")) throw new Error("entry path traversal");
        if (!Array.isArray(m.activation) || !Array.isArray(m.caps)) throw new Error("activation/caps must be arrays");
        exts.push({ ...m, caps_ok: capsAllowed(m.caps) });
      } catch (e) {
        errors.push({ dir: d.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    errors.push({ dir: "*", reason: e instanceof Error ? e.message : String(e) });
  }
  return { exts, errors };
}

function journalRun(extId: string, source: string, ok: boolean, reason: string | null, ms: number | null, excerpt: string | null): void {
  try {
    db.query(`INSERT INTO exthost_runs (ext_id, source, ok, reason, ms, result_excerpt, at) VALUES (?,?,?,?,?,?,?)`)
      .run(extId, source, ok ? 1 : 0, reason, ms, excerpt, Date.now());
  } catch { /* журнал не критичен для вердикта */ }
}

function killTree(child: ReturnType<typeof spawn>): void {
  try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
  setTimeout(() => { try { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); } catch { /* гонка на выходе */ } }, 800).unref();
}

/** Один прогон расширения: spawn (prlimit) → handshake → run → kill. Никогда не бросает. */
export async function runExtension(rawId: string, event?: Record<string, unknown>, source = "manual"): Promise<ExtRunResult> {
  const id = String(rawId ?? "").trim().toLowerCase();
  const t0 = Date.now();
  const fail = (reason: string, detail?: string): ExtRunResult => {
    const ms = Date.now() - t0;
    journalRun(id || "?", source, false, reason, ms, detail ? detail.slice(0, 300) : null);
    try { emit("EXT_RUN", { ext: id, source, ok: false, reason, ms }, null, null); } catch { /* шина не критична */ }
    try { recordSpan("exthost.run", { "me2.ext": id, "me2.source": source, "me2.ok": 0 }, t0, { status: "ERROR", message: reason }); } catch { /* телеметрия */ }
    return { ok: false, schema: EXTHOST_SCHEMA, ext: id || "?", source, reason, ...(detail ? { detail: detail.slice(0, 200) } : {}), ms };
  };

  if (!EXT_ID_RE.test(id) || id.includes("..")) return fail("bad_id");
  const { exts } = listExts();
  const man = exts.find((x) => x.id === id);
  if (!man) return fail("not_found", "манифест отсутствует или бит — см. listExts().errors");
  if (!man.caps_ok) return fail("cap_not_allowed", `caps ${JSON.stringify(man.caps)} вне белого списка ${JSON.stringify(CAPS_WHITELIST)} (fail-closed)`);
  const entryAbs = join(EXT_DIR, id, man.entry);
  if (!existsSync(entryAbs)) return fail("entry_missing", man.entry);

  const capsData: Record<string, unknown> = {};
  for (const cap of man.caps) {
    if (cap === "mirror.feed.read") {
      if (!mirrorFeedProvider) { capsData[cap] = { ok: false, error: "provider_unavailable" }; continue; }
      try { capsData[cap] = await mirrorFeedProvider(); } catch (e) { capsData[cap] = { ok: false, error: String(e).slice(0, 120) }; }
    }
  }

  const usePrlimit = sandboxCaps().rlimit;
  // NB: как в sandbox.ts — RLIMIT_NPROC per-UID не трогаем; изоляция: адресное пространство, fd, core.
  const argv = usePrlimit
    ? ["prlimit", "--as=1073741824", "--nofile=256", "--core=0", process.execPath, entryAbs]
    : [process.execPath, entryAbs];
  // env-белый-список: секреты daemon'а (vault, DB URL, токены) процесс расширения не видит.
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    LANG: process.env.LANG ?? "C.UTF-8",
    ME2_EXT_ID: id,
    ME2_EXT_PROTO: "1",
    ME2_HOST_VERSION: VERSION,
  };

  return await new Promise<ExtRunResult>((resolve) => {
    let settled = false;
    let buf = "";
    let stage: "handshake" | "run" | "done" = "handshake";
    const child = spawn(argv[0]!, argv.slice(1), { cwd: join(EXT_DIR, id), env: childEnv });
    const finish = (r: ExtRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(runTimer);
      killTree(child);
      if (r.ok) {
        const excerpt = JSON.stringify(r.result)?.slice(0, RESULT_CAP) ?? null;
        journalRun(id, source, true, null, r.ms, excerpt);
        try { emit("EXT_RUN", { ext: id, source, ok: true, ms: r.ms }, null, null); } catch { /* шина не критична */ }
        try { recordSpan("exthost.run", { "me2.ext": id, "me2.source": source, "me2.ok": 1, "me2.ms": r.ms, "me2.prlimit": usePrlimit }, t0); } catch { /* телеметрия */ }
      }
      resolve(r);
    };

    const runMs = Math.min(Math.max(Number(man.timeout_ms) || DEFAULT_RUN_MS, 1_000), 30_000);
    const runTimer = setTimeout(() => {
      finish(fail(stage === "handshake" ? "handshake_timeout" : "run_timeout",
        stage === "handshake" ? `нет ack initialize за ${HANDSHAKE_MS}мс` : `нет вердикта за ${runMs}мс (канон «вечно-THINKING ловится»)`));
    }, HANDSHAKE_MS + runMs + 1_000);
    const hsTimer = setTimeout(() => {
      if (stage === "handshake") finish(fail("handshake_timeout", "нет ack initialize за 2с"));
    }, HANDSHAKE_MS);

    child.on("error", (e) => finish(fail("spawn_failed", String(e).slice(0, 160))));
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: { ok?: unknown; proto?: unknown; result?: unknown; ext?: unknown; caps?: unknown };
        try { msg = JSON.parse(line); } catch { finish(fail("protocol_error", "строка не JSON")); return; }
        if (stage === "handshake") {
          if (msg.ok !== true) { finish(fail("handshake_refused", line.slice(0, 120))); return; }
          clearTimeout(hsTimer);
          stage = "run";
          child.stdin!.write(JSON.stringify({ op: "run", event: event ?? null, caps: capsData }) + "\n");
        } else if (stage === "run") {
          stage = "done";
          if (msg.ok === true) finish({ ok: true, schema: EXTHOST_SCHEMA, ext: id, source, result: msg.result ?? null, ms: Date.now() - t0, prlimit: usePrlimit });
          else finish(fail("ext_error", line.slice(0, 160)));
          return;
        }
      }
    });
    child.stderr!.setEncoding("utf8");
    let errTail = "";
    child.stderr!.on("data", (d: string) => { errTail = (errTail + d).slice(-300); });
    child.on("close", (code) => {
      if (!settled) finish(fail(code === 0 ? "closed_early" : "exit_" + code, errTail.slice(0, 160) || "процесс завершился без вердикта"));
    });

    // handshake — первый и единственный хост→расширение кадр до ack
    try { child.stdin!.write(JSON.stringify({ op: "initialize", proto: 1, host: "me2-daemon", version: VERSION, ext: id }) + "\n"); }
    catch (e) { finish(fail("write_failed", String(e).slice(0, 120))); }
  });
}

export interface ExthostStatus {
  ok: true; schema: string; mode: "live" | "probe_offline";
  ext_dir: string;
  exts: Array<ExtManifest & { caps_ok: boolean; runs: number; last: { ok: boolean; reason: string | null; ms: number | null; source: string; at: number } | null }>;
  errors: Array<{ dir: string; reason: string }>;
  proto: { handshake_ms: number; default_run_ms: number; prlimit: boolean };
  note?: string;
}

/** Статус-каталог для GET /exthost: манифесты + журнал последних прогонов. Никогда не бросает. */
export function exthostStatus(): ExthostStatus {
  const { exts, errors } = listExts();
  const rows = exts.map((m) => {
    let runs = 0; let last: ExthostStatus["exts"][number]["last"] = null;
    try {
      const cnt = db.query(`SELECT COUNT(*) AS n FROM exthost_runs WHERE ext_id = ?`).get(m.id) as { n: number };
      runs = Number(cnt?.n ?? 0);
      if (runs > 0) {
        const l = db.query(`SELECT ok, reason, ms, source, at FROM exthost_runs WHERE ext_id = ? ORDER BY at DESC LIMIT 1`).get(m.id) as { ok: number; reason: string | null; ms: number | null; source: string; at: number };
        last = { ok: l.ok === 1, reason: l.reason, ms: l.ms, source: l.source, at: l.at };
      }
    } catch { /* журнал может отсутствовать в probe */ }
    return { ...m, runs, last };
  });
  const probe = process.env.ME2_BOOT_MODE === "probe";
  return {
    ok: true, schema: EXTHOST_SCHEMA, mode: probe ? "probe_offline" : "live",
    ext_dir: "skills/ext", exts: rows, errors,
    proto: { handshake_ms: HANDSHAKE_MS, default_run_ms: DEFAULT_RUN_MS, prlimit: sandboxCaps().rlimit },
    ...(probe ? { note: "probe-режим: живые прогоны расширений отключены (без spawn); манифесты проверены офлайн" } : {}),
  };
}

/** Офлайн-проба для eval/CI: каталог без сети и spawn — честная сводка. */
export function exthostProbeOffline(): { ok: boolean; mode: "probe_offline"; exts: Array<{ id: string; manifest_ok: boolean; caps_ok: boolean }>; errors: number } {
  const { exts, errors } = listExts();
  return {
    ok: true, mode: "probe_offline",
    exts: exts.map((x) => ({ id: x.id, manifest_ok: true, caps_ok: x.caps_ok })),
    errors: errors.length,
  };
}

// ── activation events: опрос шины 30с (level-triggered, узор K8s resync) ──
let loopOn = false;
export function exthostStartEventLoop(): void {
  if (loopOn) return;
  loopOn = true;
  let cursor: number | null = null; // null = «инициализация головой шины» — старьё не спамится
  const tick = async () => {
    try {
      if (cursor === null) { cursor = lastSeq(); return; }
      const rows = db.query(`SELECT seq, type, data FROM events WHERE seq > ? ORDER BY seq ASC LIMIT 50`).all(cursor) as Array<{ seq: number; type: string; data: string | null }>;
      if (!rows.length) return;
      cursor = rows[rows.length - 1]!.seq;
      const { exts } = listExts();
      if (!exts.length) return;
      for (const r of rows) {
        for (const ext of exts) {
          if (!ext.caps_ok) continue; // fail-closed: расширение вне белого списка не активируется
          if (ext.activation.includes("bus:" + r.type)) {
            let preview: unknown = null;
            try { preview = r.data ? JSON.parse(r.data) : null; } catch { preview = String(r.data ?? "").slice(0, 120); }
            void runExtension(ext.id, { type: r.type, seq: r.seq, data: preview }, "bus").catch(() => { /* цикл никогда не бросает */ });
          }
        }
      }
    } catch { /* цикл никогда не бросает */ }
  };
  setInterval(() => { void tick(); }, 30_000).unref();
}
