/**
 * ME7 SELF-UPDATE (R19) — порт механики M15 старой системы (hint→discovery→barrier→rollback,
 * transactional journal v8). Старая система обновляла Electron-браузер; ME2 обновляет сам себя
 * из git (remote sandbox/me2-os → local main).
 *
 * Барьеры (fail-closed, урок «timeout ≠ NO_EFFECT_PROVEN»):
 *  - check: ls-remote + fetch + rev-list → UP_TO_DATE | BEHIND | AHEAD | DIVERGED | NO_TOKEN;
 *  - apply: ТОЛЬКО fast-forward (--ff-only). Dirty tree / diverged / not-behind → отказ без
 *    изменений (ff-only атомарен: либо применился, либо ничего — rollback by construction);
 *  - journal в SQLite (порт transactional journal v8) + событие SELFUPDATE_APPLIED + span;
 *  - bounded re-probe: check кэшируется 30s, apply можно повторять (урок 13.5h-тупика
 *    одноразового окна квалификации);
 *  - токен читается ТОЛЬКО из /home/z/.a2/.github.env и маскируется во всех выводах.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { db, emit } from "../store";
import { recordSpan } from "./otel";

const REPO_ROOT = "/home/z/my-project";
const ENV_FILE = "/home/z/.a2/.github.env";
const REMOTE_URL_BASE = "https://github.com/PatrickFrome/Compute.git";
const REMOTE_REF = "sandbox/me2-os";
const GIT_TIMEOUT_MS = 20_000;
const CHECK_TTL_MS = 30_000;

db.exec(`
CREATE TABLE IF NOT EXISTS selfupdate_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  from_sha TEXT,
  to_sha TEXT,
  result TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
`);

function readToken(): string | null {
  try {
    const txt = readFileSync(ENV_FILE, "utf8");
    const m = txt.match(/^GITHUB_TOKEN_ADMIN=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

function mask(s: string, token: string | null): string {
  if (!token) return s;
  return s.split(token).join("***");
}

function git(args: string[]): { ok: boolean; out: string; err: string } {
  const p = spawnSync("git", args, {
    cwd: REPO_ROOT, timeout: GIT_TIMEOUT_MS, encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { ok: p.status === 0, out: p.stdout ?? "", err: p.stderr ?? "" };
}

function remoteUrl(token: string): string {
  // токен в URL — только в argv spawn, никогда не в ответах/логах (mask на выходе)
  return `https://${token}@github.com/PatrickFrome/Compute.git`;
}

/**
 * R25/B3-урок: spawnSync-«git ls-remote/fetch» — это СЕТЕВЫЙ вызов (1-3s), который
 * блокировал весь event-loop daemon'а (REST+WS+bus замерзали на старте; бейслайн
 * /bench поймал p95=1.3s). Сетевые git-операции — только async (Bun.spawn),
 * локальные (rev-parse/status/rev-list, <5ms) остаются sync.
 */
async function gitRemote(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const p = Bun.spawn(["git", ...args], {
    cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const timer = setTimeout(() => { try { p.kill(); } catch { /* уже мёртв */ } }, GIT_TIMEOUT_MS);
  try {
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
    ]);
    return { ok: code === 0, out, err };
  } finally { clearTimeout(timer); }
}

export interface SuCheck {
  ok: boolean; verdict: "UP_TO_DATE" | "BEHIND" | "AHEAD" | "DIVERGED" | "NO_TOKEN" | "ERROR";
  local_head: string | null; remote_head: string | null; branch: string;
  behind: number | null; ahead: number | null; dirty_files: number;
  version: string; checked_at: number; error?: string;
}

let checkCache: { at: number; data: SuCheck } | null = null;

/** Кэш без сети (для /mechanics — проверка не должна блокировать матрицу на 20s ls-remote). */
export function suCached(): SuCheck | null {
  return checkCache && Date.now() - checkCache.at < 10 * 60_000 ? checkCache.data : null;
}

export function suCheck(version: string, force = false): SuCheck {
  if (!force && checkCache && Date.now() - checkCache.at < CHECK_TTL_MS) return checkCache.data;
  const t0 = Date.now();
  const data = suCheckInner(version);
  recordSpan("selfupdate.check", { "me2.verdict": data.verdict, "me2.ms": Date.now() - t0 }, t0,
    data.verdict === "ERROR" || data.verdict === "NO_TOKEN" ? { status: "ERROR", message: data.error ?? data.verdict } : {});
  checkCache = { at: Date.now(), data };
  return data;
}

/** Async-проверка (R25): сетевые ls-remote/fetch без блокировки event-loop. */
export async function suCheckAsync(version: string, force = false): Promise<SuCheck> {
  if (!force && checkCache && Date.now() - checkCache.at < CHECK_TTL_MS) return checkCache.data;
  const t0 = Date.now();
  const data = await suCheckAsyncInner(version);
  recordSpan("selfupdate.check", { "me2.verdict": data.verdict, "me2.ms": Date.now() - t0 }, t0,
    data.verdict === "ERROR" || data.verdict === "NO_TOKEN" ? { status: "ERROR", message: data.error ?? data.verdict } : {});
  checkCache = { at: Date.now(), data };
  return data;
}

async function suCheckAsyncInner(version: string): Promise<SuCheck> {
  const token = readToken();
  const head = git(["rev-parse", "HEAD"]);
  const localHead = head.ok ? head.out.trim() : null;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  const dirtyFiles = dirty.ok ? dirty.out.split("\n").filter((l) => l.trim()).length : -1;
  const base: SuCheck = {
    ok: false, verdict: "ERROR", local_head: localHead, remote_head: null,
    branch: branch.ok ? branch.out.trim() : "?", behind: null, ahead: null,
    dirty_files: dirtyFiles, version, checked_at: Date.now(),
  };
  if (!token) return { ...base, verdict: "NO_TOKEN", error: "no GITHUB_TOKEN_ADMIN in /home/z/.a2/.github.env" };
  if (!localHead) return { ...base, error: mask(head.err, token).slice(0, 200) || "git_rev_parse_failed" };

  const url = remoteUrl(token);
  const ls = await gitRemote(["ls-remote", url, `refs/heads/${REMOTE_REF}`]);
  if (!ls.ok) return { ...base, error: mask(ls.err, token).slice(0, 200) || "ls_remote_failed" };
  const remoteHead = ls.out.trim().split(/\s+/)[0] ?? "";
  if (!remoteHead) return { ...base, error: `remote ref ${REMOTE_REF} not found` };

  const fetch = await gitRemote(["fetch", url, REMOTE_REF]);
  if (!fetch.ok) return { ...base, remote_head: remoteHead, error: mask(fetch.err, token).slice(0, 200) || "fetch_failed" };

  const behind = git(["rev-list", "--count", `HEAD..FETCH_HEAD`]);
  const ahead = git(["rev-list", "--count", `FETCH_HEAD..HEAD`]);
  if (!behind.ok || !ahead.ok) return { ...base, remote_head: remoteHead, error: "rev_list_failed" };
  const b = Number(behind.out.trim() || 0);
  const a = Number(ahead.out.trim() || 0);
  let verdict: SuCheck["verdict"];
  if (b === 0 && a === 0) verdict = "UP_TO_DATE";
  else if (b > 0 && a === 0) verdict = "BEHIND";
  else if (b === 0 && a > 0) verdict = "AHEAD";
  else verdict = "DIVERGED";
  return { ...base, ok: true, verdict, remote_head: remoteHead, behind: b, ahead: a };
}

function suCheckInner(version: string): SuCheck {
  const token = readToken();
  const head = git(["rev-parse", "HEAD"]);
  const localHead = head.ok ? head.out.trim() : null;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  const dirtyFiles = dirty.ok ? dirty.out.split("\n").filter((l) => l.trim()).length : -1;
  const base: SuCheck = {
    ok: false, verdict: "ERROR", local_head: localHead, remote_head: null,
    branch: branch.ok ? branch.out.trim() : "?", behind: null, ahead: null,
    dirty_files: dirtyFiles, version, checked_at: Date.now(),
  };
  if (!token) return { ...base, verdict: "NO_TOKEN", error: "no GITHUB_TOKEN_ADMIN in /home/z/.a2/.github.env" };
  if (!localHead) return { ...base, error: mask(head.err, token).slice(0, 200) || "git_rev_parse_failed" };

  const url = remoteUrl(token);
  const ls = spawnSync("git", ["ls-remote", url, `refs/heads/${REMOTE_REF}`], {
    cwd: REPO_ROOT, timeout: GIT_TIMEOUT_MS, encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (ls.status !== 0) return { ...base, error: mask(ls.stderr ?? "", token).slice(0, 200) || "ls_remote_failed" };
  const remoteHead = (ls.stdout ?? "").trim().split(/\s+/)[0] ?? "";
  if (!remoteHead) return { ...base, error: `remote ref ${REMOTE_REF} not found` };

  const fetch = git(["fetch", url, REMOTE_REF]);
  if (!fetch.ok) return { ...base, remote_head: remoteHead, error: mask(fetch.err, token).slice(0, 200) || "fetch_failed" };

  const behind = git(["rev-list", "--count", `HEAD..FETCH_HEAD`]);
  const ahead = git(["rev-list", "--count", `FETCH_HEAD..HEAD`]);
  if (!behind.ok || !ahead.ok) return { ...base, remote_head: remoteHead, error: "rev_list_failed" };
  const b = Number(behind.out.trim() || 0);
  const a = Number(ahead.out.trim() || 0);
  let verdict: SuCheck["verdict"];
  if (b === 0 && a === 0) verdict = "UP_TO_DATE";
  else if (b > 0 && a === 0) verdict = "BEHIND";
  else if (b === 0 && a > 0) verdict = "AHEAD";
  else verdict = "DIVERGED";
  return { ...base, ok: true, verdict, remote_head: remoteHead, behind: b, ahead: a };
}

export interface SuApply {
  ok: boolean; applied: boolean; from: string | null; to: string | null;
  reason: string; journal_id: number | null; recheck_in_s: number;
}

export function suApply(version: string): SuApply {
  const t0 = Date.now();
  const chk = suCheck(version, true);
  const fail = (reason: string): SuApply => {
    db.query(`INSERT INTO selfupdate_journal (op,from_sha,to_sha,result,detail,at) VALUES ('apply',?,?,?, ?,?)`)
      .run(chk.local_head, chk.remote_head, "REFUSED", reason, Date.now());
    recordSpan("selfupdate.apply", { "me2.result": "REFUSED", "me2.reason": reason }, t0, { status: "ERROR", message: reason });
    return { ok: false, applied: false, from: chk.local_head, to: chk.remote_head, reason, journal_id: null, recheck_in_s: 30 };
  };
  if (!chk.ok || !chk.local_head || !chk.remote_head) return fail(chk.error ?? chk.verdict);
  if (chk.verdict === "UP_TO_DATE") return fail("nothing_to_do: up_to_date");
  if (chk.verdict === "DIVERGED") return fail("refused_diverged: ff-only impossible, operator merge required");
  if (chk.verdict !== "BEHIND") return fail(`refused_verdict_${chk.verdict}`);
  if (chk.dirty_files > 0) return fail(`refused_dirty_tree: ${chk.dirty_files} uncommitted files`);

  const token = readToken();
  if (!token) return fail("no_token");
  const merge = git(["merge", "--ff-only", "FETCH_HEAD"]);
  const merged = merge.ok && !/Already up to date/i.test(merge.out + merge.err);
  if (!merge.ok) return fail(mask(merge.err, token).slice(0, 200) || "ff_merge_failed");
  const to = chk.remote_head;
  db.query(`INSERT INTO selfupdate_journal (op,from_sha,to_sha,result,detail,at) VALUES ('apply',?,?,?,?,?)`)
    .run(chk.local_head, to, "APPLIED", `ff-only ${REMOTE_REF}`, Date.now());
  emit("SELFUPDATE_APPLIED", { from: chk.local_head.slice(0, 8), to: to.slice(0, 8), behind: chk.behind });
  recordSpan("selfupdate.apply", { "me2.result": "APPLIED", "me2.from": chk.local_head.slice(0, 8), "me2.to": to.slice(0, 8) }, t0);
  checkCache = null;
  return {
    ok: true, applied: merged, from: chk.local_head, to,
    reason: merged ? "fast-forward applied; RESTART daemon (start.sh) to load new code" : "already up to date after re-check",
    journal_id: null, recheck_in_s: 30,
  };
}

export function selfupdateStatus(version: string) {
  const chk = suCheck(version);
  const journal = db.query(`SELECT * FROM selfupdate_journal ORDER BY at DESC LIMIT 10`).all() as Array<{
    id: number; op: string; from_sha: string | null; to_sha: string | null; result: string; detail: string | null; at: number;
  }>;
  return { ok: true, check: chk, journal };
}
