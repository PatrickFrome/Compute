// ── R62 P0-a «edit-tool»: FILE_EDIT — правки файлов с unified-diff, валидацией
// применения и durable-откатом (журнал в SQLite) ──
//
// Гэп: R61-GAP-ANALYSIS §P0-0 (Cursor edit-files: «Suggest edits to files and
// apply them automatically» + diff view; checkpoints — auto snapshot + restore).
// Канон Cursor: правки применяются автоматически, человек смотрит diff; откат —
// checkpoint'ы (снапшоты). Наш слайс P0-a:
//   1. ВХОД = unified diff (канон patch(1)); СНАЧАЛА `patch --dry-run` (валидация
//      применения — контракты edit.request{path,diff} → verdict{applied,hunks}),
//      потом настоящий прогон; если настоящий прогон упал ПОСЛЕ валидного dry-run
//      (гонка) — авто-откат исходного содержимого (EDIT_ROLLBACK в chain).
//   2. DURABLE-ОТКАТ: исходное содержимое кладётся в журнал file_edits (SQLite,
//      cap 2MB) — агент не может подменить бэкап-файл на диске; POST /file
//      {op:"rollback", edit_id} восстанавливает байт-в-байт. Это ЖЁСТЧЕ канона
//      Cursor (checkpoint'ы локальные и не tamper-evident).
//   3. ПУТЬ — только внутри управляемых корней (execRoots: песочницы/worktrees),
//      realpath + префикс; single-file diff (оба заголовка = цель); удаление
//      файлов и .git-цели — отказ; заголовки /dev/null = создание файла.
//   4. patch — spawn под таймаутом, cwd = каталог файла; СЕКРЕТОВ в env нет
//      (наследуется фиксированный минимальный env, не process.env).
// Zero-authority: инструмент не пишет в шину 47/47 — REST-семейство /file.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { db, emit } from "../store";
import { recordSpan } from "./otel";
import { execRoots } from "./exec";
import { SB_ROOT } from "./sandbox";
import { REPO_ROOT } from "./worktrees";

export const EDIT_SCHEMA = "me2.edit.v1";

const DIFF_MAX = 256 * 1024;         // максимум размер diff
const FILE_MAX = 2 * 1024 * 1024;    // максимум размер цели (rollback-гарантия)
const PATCH_TIMEOUT_MS = 15_000;

export interface EditPlan {
  ok: boolean;
  reason?: string;
  detail?: string;
  cwd_dir?: string;        // realpath каталога цели (для patch)
  target?: string;         // realpath цели
  patch_argv?: string[];   // ["patch","--batch",...] без stdin
  creating?: boolean;
  hunks?: number;
}

function headerPath(line: string): string {
  // "--- a/x" | "+++ b/x" | "--- x" | "--- /dev/null"
  const raw = line.replace(/^(---|\+\+\+)\s+/, "").replace(/\t.*$/, "").trim();
  return raw;
}

/** ЧИСТЫЙ планировщик правки: путь + diff без запуска patch (eval/CI-инварианты). */
export function planEdit(rawPath: string, rawDiff: string): EditPlan {
  const path = String(rawPath ?? "").trim();
  const diff = String(rawDiff ?? "");
  if (!path) return { ok: false, reason: "path_required" };
  if (path.includes("\0")) return { ok: false, reason: "bad_path" };
  if (diff.length === 0) return { ok: false, reason: "diff_required" };
  if (diff.length > DIFF_MAX) return { ok: false, reason: "diff_too_large", detail: `max ${DIFF_MAX} bytes` };
  let real = "";
  let creatingCandidate = false; // путь не существует, но родительский каталог жив — создание разрешено, если заголовок --- /dev/null
  try {
    if (existsSync(path)) {
      real = realpathSync(path);
    } else {
      const parent = dirname(resolve(path));
      if (!existsSync(parent)) return { ok: false, reason: "path_missing", detail: "цель и её каталог не существуют" };
      real = join(realpathSync(parent), resolve(path).split("/").pop() ?? "");
      creatingCandidate = true;
    }
  } catch (e) {
    return { ok: false, reason: "path_unresolvable", detail: String(e).slice(0, 120) };
  }
  const roots = execRoots();
  if (!roots.some((r) => real.startsWith(r))) return { ok: false, reason: "root_denied", detail: `цель вне управляемых корней (${roots.join(" | ")})` };
  if (/(^|\/)\.git(\/|$)/.test(real)) return { ok: false, reason: "git_target_denied", detail: "внутренности .git не редактируются инструментом" };

  // заголовки diff — только ДО первого @@ (внутри хунков "--- x" может быть телом строки)
  const firstHunk = diff.indexOf("\n@@");
  const head = firstHunk === -1 ? diff : diff.slice(0, firstHunk);
  const minus = head.split("\n").filter((l) => l.startsWith("--- ")).map(headerPath);
  const plus = head.split("\n").filter((l) => l.startsWith("+++ ")).map(headerPath);
  if (minus.length !== 1 || plus.length !== 1) return { ok: false, reason: "bad_diff_headers", detail: "нужен единый заголовок ---/+++ (single-file diff)" };
  const from = minus[0]!;
  const to = plus[0]!;
  if (to === "/dev/null") return { ok: false, reason: "file_deletion_denied", detail: "удаление файлов — вне слайса P0-a (rollback восстановит, но цель — правки)" };
  const creating = from === "/dev/null";
  // strip a/ b/ префиксы (p1); иначе p0
  const strip = (p: string) => (p.startsWith("a/") ? p.slice(2) : p.startsWith("b/") ? p.slice(2) : p);
  const fromRel = creating ? "" : strip(from);
  const toRel = strip(to);
  if (!toRel || toRel.startsWith("/")) return { ok: false, reason: "bad_diff_headers", detail: "путь в +++ должен быть относительным" };
  if (toRel.includes("..")) return { ok: false, reason: "traversal_denied", detail: ".. в пути заголовка" };
  const dir = dirname(real);
  const base = resolve(dir, toRel);
  if (base !== real) return { ok: false, reason: "target_mismatch", detail: `заголовок +++ ${to} не совпадает с целью ${path}` };
  if (!creating && fromRel !== toRel) return { ok: false, reason: "target_mismatch", detail: `--- ${from} ≠ +++ ${to}` };
  // GNU patch 2.8: creation-дифф (--- /dev/null) работает с -p1 только при префиксе b/
  // (+++ b/file — канон git), иначе нужен -p0 (проверено живыми пробами R62).
  const p = creating ? (to.startsWith("b/") ? 1 : 0) : (from.startsWith("a/") ? 1 : 0);
  const hunks = (diff.match(/^@@/gm) ?? []).length;
  if (hunks === 0) return { ok: false, reason: "no_hunks" };
  if (creating && creatingCandidate === false && existsSync(real)) return { ok: false, reason: "target_exists", detail: "заголовок --- /dev/null означает создание, но файл уже существует" };
  if (!creating && creatingCandidate) return { ok: false, reason: "target_missing", detail: "цель не существует, а diff не является созданием (--- не /dev/null)" };
  if (!creating && !existsSync(real)) return { ok: false, reason: "target_missing" };
  if (!creating) {
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, reason: "not_a_file" };
    if (st.size > FILE_MAX) return { ok: false, reason: "file_too_large", detail: `rollback-гарантия: max ${FILE_MAX} bytes` };
  }
  const argv = ["patch", "--batch", "--forward", "--no-backup-if-mismatch", `-p${p}`];
  return { ok: true, cwd_dir: dir, target: real, patch_argv: argv, creating, hunks };
}

// ── журнал правок (SQLite; backup — исходное содержимое для durable-отката) ──
db.exec(`
CREATE TABLE IF NOT EXISTS file_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  op TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT,
  hunks INTEGER,
  bytes_before INTEGER,
  bytes_after INTEGER,
  sha256_after TEXT,
  backup TEXT,
  rollback_done INTEGER NOT NULL DEFAULT 0,
  rollback_of INTEGER,
  source TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_edits_path ON file_edits (path, at);
`);

export interface EditVerdict {
  ok: boolean;
  schema: string;
  op: "apply" | "rollback";
  path?: string;
  applied?: boolean;
  hunks?: number;
  bytes_before?: number | null;
  bytes_after?: number | null;
  sha256_after?: string | null;
  rollback_at?: number | null;    // id строки журнала с бэкапом (для POST /file {op:"rollback"})
  rolled_back?: boolean;          // авто-откат при гонке после валидного dry-run
  edit_id?: number;
  reason?: string;
  detail?: string;
  dry_run_ok?: boolean;
}

function journalEdit(path: string, op: string, ok: boolean, reason: string | null, hunks: number | null, bytesBefore: number | null, bytesAfter: number | null, shaAfter: string | null, backup: string | null, rollbackOf: number | null, source: string): number | null {
  try {
    const r = db.query(`INSERT INTO file_edits (path, op, ok, reason, hunks, bytes_before, bytes_after, sha256_after, backup, rollback_of, source, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(path.slice(0, 400), op, ok ? 1 : 0, reason, hunks, bytesBefore, bytesAfter, shaAfter, backup, rollbackOf, source, Date.now());
    return Number(r.lastInsertRowid);
  } catch { return null; }
}

function readBackup(id: number): { path: string; backup: string } | null {
  try {
    const r = db.query(`SELECT path, backup FROM file_edits WHERE id = ? AND op = 'apply' AND ok = 1 AND rollback_done = 0`).get(id) as { path: string; backup: string | null } | undefined;
    if (!r || r.backup === null) return null;
    return { path: r.path, backup: r.backup };
  } catch { return null; }
}

/** FILE_EDIT apply: plan → dry-run → apply (авто-откат при гонке). patch — async spawn (event-loop свободен, канон exthost/R25); бэкап/хеш — FS-чтение (без spawn). Никогда не бросает. */
function runPatchAsync(argv: string[], cwdDir: string, diffText: string, dry: boolean): Promise<{ status: number | null; error?: string; stderr: string }> {
  return new Promise((resolve) => {
    const args = [...argv.slice(1), ...(dry ? ["--dry-run"] : [])];
    const child = spawn(argv[0]!, args, { cwd: cwdDir,
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", ME2_EDIT: "1" } });
    let stderr = "";
    let settled = false;
    const done = (status: number | null, error?: string) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
      resolve({ status, error, stderr: stderr.slice(0, 300) });
    };
    const timer = setTimeout(() => done(null, "patch_timeout"), PATCH_TIMEOUT_MS);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => { stderr += d; });
    child.on("error", (e) => done(-1, String(e).slice(0, 160)));
    child.on("close", (code) => done(code));
    try { child.stdin!.end(diffText); } catch (e) { done(-1, String(e).slice(0, 120)); }
  });
}

export async function applyEditAsync(rawPath: string, rawDiff: string, source = "rest"): Promise<EditVerdict> {
  const t0 = Date.now();
  const plan = planEdit(rawPath, rawDiff);
  if (!plan.ok) {
    const id = journalEdit(String(rawPath ?? ""), "apply", false, plan.reason ?? "plan_denied", null, null, null, null, null, source);
    try { emit("EDIT_DENIED", { path: String(rawPath ?? "").slice(0, 160), reason: plan.reason, detail: plan.detail, source }, null, null); } catch { /* шина */ }
    try { recordSpan("edit.apply", { "me2.edit.ok": 0, "me2.edit.reason": plan.reason ?? "?" }, t0, { status: "ERROR", message: plan.reason }); } catch { /* телеметрия */ }
    return { ok: false, schema: EDIT_SCHEMA, op: "apply", path: String(rawPath ?? ""), reason: plan.reason, detail: plan.detail, edit_id: id ?? undefined };
  }
  const path = plan.target!;
  // нормализация диффа: CRLF→LF + гарантированный финальный newline
  // (patch: «unexpectedly ends in middle of line» без него — живая проба R62)
  const diffText = String(rawDiff).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const diffNorm = diffText.endsWith("\n") ? diffText : diffText + "\n";
  const bytesBefore = plan.creating ? 0 : statSync(path).size;
  const dry = await runPatchAsync(plan.patch_argv!, plan.cwd_dir!, diffNorm, true);
  if (dry.status !== 0 || dry.error) {
    const id = journalEdit(path, "apply", false, "dryrun_failed", plan.hunks!, bytesBefore, null, null, null, source);
    const detail = (dry.stderr || String(dry.error ?? "")).slice(0, 300);
    try { emit("EDIT_DENIED", { path, reason: "dryrun_failed", detail: detail.slice(0, 200), source }, null, null); } catch { /* шина */ }
    return { ok: false, schema: EDIT_SCHEMA, op: "apply", path, applied: false, hunks: plan.hunks!, dry_run_ok: false, reason: "dryrun_failed", detail, edit_id: id ?? undefined };
  }
  // бэкап исходного содержимого ДО реального применения (durable, в журнал; FS-чтение без spawn)
  let backup: string | null = null;
  if (!plan.creating) {
    try { backup = readFileSync(path, "utf8"); } catch { backup = null; }
    if (backup === null) {
      const id = journalEdit(path, "apply", false, "backup_failed", plan.hunks!, bytesBefore, null, null, null, source);
      return { ok: false, schema: EDIT_SCHEMA, op: "apply", path, applied: false, hunks: plan.hunks!, dry_run_ok: true, reason: "backup_failed", detail: "исходное содержимое не прочитано — применение отменено (rollback-гарантия первична)", edit_id: id ?? undefined };
    }
  }
  const real = await runPatchAsync(plan.patch_argv!, plan.cwd_dir!, diffNorm, false);
  if (real.status !== 0 || real.error) {
    // гонка после валидного dry-run: авто-откат исходного содержимого (writeFileSync — FS, без spawn)
    let restored = false;
    if (backup !== null) {
      try { writeFileSync(path, backup); restored = true; } catch { restored = false; }
    }
    const id = journalEdit(path, "apply", false, "apply_failed", plan.hunks!, bytesBefore, null, null, backup, null, source);
    try { emit(restored ? "EDIT_ROLLBACK" : "EDIT_DENIED", { path, reason: "apply_failed", auto_rollback: restored, detail: (real.stderr || String(real.error ?? "")).slice(0, 160), source }, null, null); } catch { /* шина */ }
    return { ok: false, schema: EDIT_SCHEMA, op: "apply", path, applied: false, hunks: plan.hunks!, dry_run_ok: true, rolled_back: restored, reason: "apply_failed", detail: (real.stderr || String(real.error ?? "")).slice(0, 300), edit_id: id ?? undefined };
  }
  const bytesAfter = statSync(path).size;
  const buf = readFileSync(path);
  const sha = createHash("sha256").update(buf).digest("hex");
  const id = journalEdit(path, "apply", true, null, plan.hunks!, bytesBefore, bytesAfter, sha, backup, null, source);
  try { emit("EDIT_APPLIED", { path: path.slice(0, 160), hunks: plan.hunks, bytes_before: bytesBefore, bytes_after: bytesAfter, sha256: sha, creating: plan.creating, edit_id: id, source }, null, null); } catch { /* шина */ }
  try { recordSpan("edit.apply", { "me2.edit.ok": 1, "me2.hunks": plan.hunks!, "me2.bytes": bytesAfter, "me2.creating": plan.creating ? 1 : 0 }, t0); } catch { /* телеметрия */ }
  return {
    ok: true, schema: EDIT_SCHEMA, op: "apply", path, applied: true, hunks: plan.hunks!,
    bytes_before: bytesBefore, bytes_after: bytesAfter, sha256_after: sha, rollback_at: id,
    dry_run_ok: true, edit_id: id ?? undefined,
  };
}

/** FILE_EDIT rollback: восстановить исходное содержимое из журнала (байт-в-байт; writeFileSync — без spawn). */
export function rollbackEdit(rawEditId: number, source = "rest"): EditVerdict {
  const t0 = Date.now();
  const id = Number(rawEditId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, schema: EDIT_SCHEMA, op: "rollback", reason: "bad_edit_id" };
  const bk = readBackup(id);
  if (!bk) return { ok: false, schema: EDIT_SCHEMA, op: "rollback", reason: "backup_not_found", detail: "правка не найдена, уже откачена или создана без бэкапа" };
  if (!existsSync(bk.path)) {
    try { db.query(`UPDATE file_edits SET rollback_done = 1 WHERE id = ?`).run(id); } catch { /* журнал */ }
    return { ok: false, schema: EDIT_SCHEMA, op: "rollback", path: bk.path, reason: "target_gone", detail: "файл отсутствует — восстановление байт-в-байт невозможно" };
  }
  const st = statSync(bk.path);
  if (!st.isFile() || st.size > FILE_MAX) return { ok: false, schema: EDIT_SCHEMA, op: "rollback", path: bk.path, reason: "not_restorable", detail: "цель перестала быть файлом или выросла сверх лимита" };
  try { writeFileSync(bk.path, bk.backup); } catch (e) {
    return { ok: false, schema: EDIT_SCHEMA, op: "rollback", path: bk.path, reason: "restore_failed", detail: String(e).slice(0, 200) };
  }
  try { db.query(`UPDATE file_edits SET rollback_done = 1 WHERE id = ?`).run(id); } catch { /* журнал */ }
  const bytes = statSync(bk.path).size;
  const rid = journalEdit(bk.path, "rollback", true, null, null, bytes, bytes, null, null, id, source);
  try { emit("EDIT_ROLLBACK", { path: bk.path.slice(0, 160), edit_id: id, rollback_row: rid, bytes, source }, null, null); } catch { /* шина */ }
  try { recordSpan("edit.rollback", { "me2.edit.ok": 1, "me2.edit_id": id }, t0); } catch { /* телеметрия */ }
  return { ok: true, schema: EDIT_SCHEMA, op: "rollback", path: bk.path, applied: false, edit_id: id, rolled_back: true, bytes_after: bytes };
}

// ── статус / probe ────────────────────────────────────────────────────

export interface EditStatus {
  ok: true;
  schema: string;
  roots: string[];
  limits: { diff_max: number; file_max: number; patch_timeout_ms: number; deletion: "denied"; substitution: "n/a (patch)" };
  counters: { applied: number; denied: number; rollbacks: number };
  recent: Array<{ id: number; path: string; op: string; ok: boolean; reason: string | null; hunks: number | null; rollback_done: boolean; has_backup: boolean; at: number }>;
}

export function editStatus(): EditStatus {
  let applied = 0, denied = 0, rollbacks = 0;
  const recent: EditStatus["recent"] = [];
  try {
    const c = db.query(`SELECT op, ok, COUNT(*) n FROM file_edits GROUP BY op, ok`).all() as Array<{ op: string; ok: number; n: number }>;
    for (const r of c) {
      if (r.op === "apply" && r.ok === 1) applied += r.n;
      if (r.op === "apply" && r.ok === 0) denied += r.n;
      if (r.op === "rollback" && r.ok === 1) rollbacks += r.n;
    }
    const rows = db.query(`SELECT id, path, op, ok, reason, hunks, rollback_done, (backup IS NOT NULL) AS has_backup, at FROM file_edits ORDER BY at DESC LIMIT 10`).all() as Array<{ id: number; path: string; op: string; ok: number; reason: string | null; hunks: number | null; rollback_done: number; has_backup: number; at: number }>;
    for (const r of rows) recent.push({ id: r.id, path: r.path, op: r.op, ok: r.ok === 1, reason: r.reason, hunks: r.hunks, rollback_done: r.rollback_done === 1, has_backup: r.has_backup === 1, at: r.at });
  } catch { /* журнал может отсутствовать в probe */ }
  return {
    ok: true, schema: EDIT_SCHEMA, roots: execRoots(),
    limits: { diff_max: DIFF_MAX, file_max: FILE_MAX, patch_timeout_ms: PATCH_TIMEOUT_MS, deletion: "denied", substitution: "n/a (patch)" },
    counters: { applied, denied, rollbacks },
    recent,
  };
}

/** Офлайн-проба для eval/CI: планировщик без запуска patch — честная сводка инвариантов. */
export function editProbeOffline(): { ok: boolean; mode: "probe_offline"; negatives: Array<{ reason: string; hit: boolean }>; patch_binary: boolean } {
  const patchBinary = ["/usr/bin/patch", "/bin/patch", "/usr/local/bin/patch"].some((x) => existsSync(x));
  // временный файл ВНУТРИ управляемого корня — негативы доходят до нужной проверки, а не до path_missing
  const dir = editEvalTmpDir();
  try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "probe.txt"), "a\n"); } catch { /* probe без FS — негативы честно не сойдут */ }
  const probeFile = join(dir, "probe.txt");
  const cases: Array<{ reason: string; plan: EditPlan }> = [
    { reason: "root_denied", plan: planEdit(join(REPO_ROOT, "package.json"), "--- package.json\n+++ package.json\n@@ -1 +1 @@\n-a\n+b\n") }, // REPO_ROOT вне SB/WT-корней → root_denied
    { reason: "bad_diff_headers", plan: planEdit(probeFile, "+++ /abs/path\n@@ -1 +1 @@\n-a\n+b\n") },
    { reason: "diff_required", plan: planEdit(probeFile, "") },
    { reason: "file_deletion_denied", plan: planEdit(probeFile, "--- probe.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n") },
    { reason: "no_hunks", plan: planEdit(probeFile, "--- /dev/null\n+++ probe.txt\n") },
  ];
  const negatives = cases.map((c) => ({ reason: c.reason, hit: !c.plan.ok && c.plan.reason === c.reason }));
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* уборка не критична */ }
  return { ok: patchBinary && negatives.every((n) => n.hit), mode: "probe_offline", negatives, patch_binary: patchBinary };
}

// ── eval-подмога: изолированный каталог для цикла apply→rollback ──
const EVAL_TMP = "eval-edit-tmp";
export function editEvalTmpDir(): string { return join(SB_ROOT, EVAL_TMP); }
