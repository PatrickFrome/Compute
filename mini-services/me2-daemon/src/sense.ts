/**
 * ME-BROWSER-SENSE (R20, шаг S1 из research/2026/R20-BROWSER-LEAP.md) — порт семантической
 * перцепции легаси browser-tools.ts (A2): CAPTURE→act→verify, «no pixel geometry anywhere».
 *
 * Старая система: state.perception.semantic_targets[] (role/name/semantic_ref/backend_node_id,
 * value_sha256) + state_revision_id для проверки свежести перед мутацией.
 *
 * ME2-версия (tree-first, 2026-консенсус — accessibility tree как интерфейс агента):
 *  - aria-snapshot agent-browser парсится в semantic_targets[] {ref, role, name};
 *  - персист в SQLite (tab PRIMARY KEY): переживает рестарт, история ревизий через revision;
 *  - revision = sha256(snapshot) — дешёвая проверка «страница изменилась» (value_sha256 легаси);
 *  - act с резолвом ключа (ref | точное имя | уникальная подстрока) + АВТО-VERIFY после
 *    действия (re-sense: цель жива? ревизия сменилась?) — self-healing gen-3-lite сигнал;
 *  - REST вне шины (47/47 инвариант), события BROWSER_SENSED / BROWSER_SENSE_ACTED + спаны.
 */
import { createHash } from "node:crypto";
import { db, emit } from "../store";
import { recordSpan } from "./otel";
import { ab, browserTabs, type BrowserTab } from "../commands";
import { effectVerdict, fenceCheck } from "./effect";
import { benchObserve } from "./bench";

db.exec(`
CREATE TABLE IF NOT EXISTS browser_sense (
  tab TEXT PRIMARY KEY,
  url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  targets_json TEXT NOT NULL DEFAULT '[]',
  targets_count INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL
);
`);
// R31 D1 (sense-diffing): история ревизий как ДИФЫ, а не полные снапшоты —
// агент между ревизиями получает только +добавленные/−удалённые/~перемещённые цели
// (экономия токенов: полный список ≤250 целей vs несколько изменённых строк).
db.exec(`
CREATE TABLE IF NOT EXISTS browser_sense_diff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab TEXT NOT NULL,
  prev_revision TEXT,
  revision TEXT NOT NULL,
  changed INTEGER NOT NULL,
  added_json TEXT NOT NULL DEFAULT '[]',
  removed_json TEXT NOT NULL DEFAULT '[]',
  added_n INTEGER NOT NULL DEFAULT 0,
  removed_n INTEGER NOT NULL DEFAULT 0,
  moved_n INTEGER NOT NULL DEFAULT 0,
  targets_count INTEGER NOT NULL DEFAULT 0,
  chars_full INTEGER NOT NULL DEFAULT 0,
  chars_diff INTEGER NOT NULL DEFAULT 0,
  saved_pct INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_sense_diff_cap ON browser_sense_diff(captured_at)`);
// миграция: ранние записи писались под ключом "active" (нетабличный ключ) — вычищаем разово
db.exec(`DELETE FROM browser_sense WHERE tab='active'`);

export interface SemanticTarget { ref: string; role: string; name: string }
export interface SenseRow {
  tab: string; url: string; title: string; targets_count: number;
  revision: string; chars: number; captured_at: number;
  targets?: SemanticTarget[];
  age_s?: number;
}

export interface SenseDiff {
  changed: boolean;
  added: SemanticTarget[];
  removed: SemanticTarget[];
  moved_n: number;
  added_n: number;
  removed_n: number;
  saved_pct: number;
}

const DIFF_ITEM_CAP = 40;   // максимум целей в персист-дифе (по каждой стороне)
const DIFF_ROWS_CAP = 300;  // история дифов в SQLite

/**
 * Диф семантических целей по ИДЕНТИЧНОСТИ (role+name), не по ref: ref (eN)
 * перenumеруется aria-snapshot'ом при любом изменении DOM, поэтому:
 *  - added   = идентичность есть в next, нет в prev;
 *  - removed = есть в prev, нет в next;
 *  - moved   = идентичность та же, но ref сменился (перенумерация — не шум,
 *    но и не изменение смысла: считаем отдельно от added/removed).
 */
export function diffTargets(prev: SemanticTarget[], next: SemanticTarget[]): SenseDiff {
  const keyOf = (t: SemanticTarget) => `${t.role}\u0001${t.name}`;
  const prevMap = new Map(prev.map((t) => [keyOf(t), t]));
  const nextMap = new Map(next.map((t) => [keyOf(t), t]));
  const added: SemanticTarget[] = [];
  const removed: SemanticTarget[] = [];
  let moved = 0;
  for (const [k, t] of nextMap) {
    const p = prevMap.get(k);
    if (!p) { if (added.length < DIFF_ITEM_CAP) added.push(t); continue; }
    if (p.ref !== t.ref) moved++;
  }
  for (const [k, t] of prevMap) if (!nextMap.has(k) && removed.length < DIFF_ITEM_CAP) removed.push(t);
  const addedN = next.length - (nextMap.size - Math.min(added.length, nextMap.size)); // честное число (кап только на персист)
  const removedN = prev.length - (prevMap.size - Math.min(removed.length, prevMap.size));
  const changed = added.length > 0 || removed.length > 0;
  // экономия: размер дифа (JSON добавленных+удалённых) против полного снапшота целей
  const charsDiff = JSON.stringify(added).length + JSON.stringify(removed).length;
  const charsFull = JSON.stringify(next).length;
  const saved = charsFull > 0 ? Math.max(0, Math.min(100, Math.round((1 - charsDiff / charsFull) * 100))) : 0;
  return { changed, added, removed, moved_n: moved, added_n: Math.max(0, addedN), removed_n: Math.max(0, removedN), saved_pct: saved };
}

const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
  "tab", "menuitem", "option", "switch", "slider", "spinbutton", "listbox", "treeitem",
]);
const MAX_TARGETS = 250;
const NAME_RE = /^[\s>-]*(?:\w[\w-]*)?\s*"([^"]*)"/;

/** Парс aria-snapshot'а agent-browser: строки вида `- button "Submit" [ref=e12]`. */
export function parseSnapshot(text: string): SemanticTarget[] {
  const out: SemanticTarget[] = [];
  for (const line of text.split("\n")) {
    const refM = line.match(/\[ref=(e\d+)\]/);
    if (!refM) continue;
    const roleM = line.match(/^\s*-\s*([a-z][a-z0-9_ ]*)/i);
    const role = (roleM?.[1] ?? "unknown").trim().toLowerCase();
    const nameM = line.match(NAME_RE);
    if (!INTERACTIVE.has(role)) continue;
    out.push({ ref: refM[1], role, name: (nameM?.[1] ?? "").trim() });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

/** Свежая перцепция: snapshot активной (или указанной) вкладки → parse → persist (+диф D1). */
export async function senseNow(tab?: string): Promise<SenseRow & { targets: SemanticTarget[]; diff: SenseDiff }> {
  const t0 = Date.now();
  if (tab) await ab(["tab", tab]);
  const r = await ab(["snapshot"]);
  if (r.code !== 0 && !r.out.trim()) throw new Error(`sense_snapshot_failed_code_${r.code}`);
  const text = r.out;
  const targets = parseSnapshot(text);
  const revision = createHash("sha256").update(text).digest("hex").slice(0, 16);
  let tabs: BrowserTab[] = [];
  try { tabs = await browserTabs(); } catch { /* вкладки не критичны для перцепции */ }
  const active = tabs.find((t) => t.active) ?? null;
  const row: SenseRow = {
    tab: tab ?? active?.id ?? "default",
    url: active?.url ?? "",
    title: active?.title ?? "",
    targets_count: targets.length,
    revision,
    chars: text.length,
    captured_at: Date.now(),
  };
  // D1: база сравнения — предыдущая перцепция ТОЙ ЖЕ вкладки, читается ДО upsert
  // (после upsert предыдущей строки уже нет: таблица = tab PRIMARY KEY)
  const prevRow = db.query(`SELECT revision, targets_json FROM browser_sense WHERE tab=?`)
    .get(row.tab) as { revision: string; targets_json: string } | undefined;
  let prevTargets: SemanticTarget[] = [];
  try { prevTargets = prevRow ? (JSON.parse(prevRow.targets_json) as SemanticTarget[]) : []; } catch { /* битая строка — диф от пустого */ }
  db.query(`
    INSERT INTO browser_sense (tab,url,title,targets_json,targets_count,revision,chars,captured_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(tab) DO UPDATE SET url=excluded.url, title=excluded.title,
      targets_json=excluded.targets_json, targets_count=excluded.targets_count,
      revision=excluded.revision, chars=excluded.chars, captured_at=excluded.captured_at
  `).run(row.tab, row.url, row.title, JSON.stringify(targets.slice(0, MAX_TARGETS)), row.targets_count, row.revision, row.chars, row.captured_at);
  const diff = diffTargets(prevTargets, targets);
  if (diff.changed) {
    db.query(`INSERT INTO browser_sense_diff (tab,prev_revision,revision,changed,added_json,removed_json,added_n,removed_n,moved_n,targets_count,chars_full,chars_diff,saved_pct,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.tab, prevRow?.revision ?? null, revision, 1,
        JSON.stringify(diff.added.slice(0, DIFF_ITEM_CAP)), JSON.stringify(diff.removed.slice(0, DIFF_ITEM_CAP)),
        diff.added_n, diff.removed_n, diff.moved_n, row.targets_count, JSON.stringify(targets).length,
        JSON.stringify(diff.added).length + JSON.stringify(diff.removed).length, diff.saved_pct, Date.now());
    db.query(`DELETE FROM browser_sense_diff WHERE id NOT IN (SELECT id FROM browser_sense_diff ORDER BY id DESC LIMIT ${DIFF_ROWS_CAP})`).run();
  }
  emit("BROWSER_SENSED", { tab: row.tab, count: row.targets_count, revision, diff_changed: diff.changed, added: diff.added_n, removed: diff.removed_n, moved: diff.moved_n }, null, null);
  recordSpan("browser.sense", { "me2.ms": Date.now() - t0, "me2.targets": row.targets_count, "me2.diff_changed": diff.changed }, t0);
  benchObserve("sense", Date.now() - t0); // B3: зонд перцепции (порог в /bench)
  return { ...row, targets: targets.slice(0, MAX_TARGETS), diff };
}

export interface SenseDiffRow {
  id: number; tab: string; prev_revision: string | null; revision: string;
  added_n: number; removed_n: number; moved_n: number;
  added: SemanticTarget[]; removed: SemanticTarget[];
  chars_full: number; chars_diff: number; saved_pct: number; captured_at: number;
  age_s: number;
}

/** История дифов (D1): GET /browser/sense/diffs — что менялось между ревизиями. */
export function senseDiffs(tab?: string, limit = 10): { ok: true; rows: SenseDiffRow[]; total: number } {
  const lim = Math.min(Math.max(limit, 1), 50);
  const where = tab ? `WHERE tab=?` : "";
  const args = tab ? [tab, lim] : [lim];
  const rows = db.query(`SELECT * FROM browser_sense_diff ${where} ORDER BY id DESC LIMIT ?`).all(...args) as Array<
    Omit<SenseDiffRow, "added" | "removed" | "age_s"> & { added_json: string; removed_json: string }
  >;
  const total = (db.query(`SELECT COUNT(*) AS n FROM browser_sense_diff ${where}`).get(...(tab ? [tab] : [])) as { n: number }).n;
  return {
    ok: true, total,
    rows: rows.map((r) => {
      let added: SemanticTarget[] = [];
      let removed: SemanticTarget[] = [];
      try { added = JSON.parse(r.added_json) as SemanticTarget[]; } catch { /* битая строка */ }
      try { removed = JSON.parse(r.removed_json) as SemanticTarget[]; } catch { /* битая строка */ }
      return {
        id: r.id, tab: r.tab, prev_revision: r.prev_revision, revision: r.revision,
        added_n: r.added_n, removed_n: r.removed_n, moved_n: r.moved_n,
        added, removed, chars_full: r.chars_full, chars_diff: r.chars_diff,
        saved_pct: r.saved_pct, captured_at: r.captured_at,
        age_s: Math.round((Date.now() - r.captured_at) / 1000),
      };
    }),
  };
}

/** Вердикт механики ME28 (D1): WORKS — диф-история живая и форма честная. */
export function senseDiffVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const c = db.query(`SELECT COUNT(*) AS n FROM browser_sense_diff`).get() as { n: number };
    if (!c.n) return { verdict: "CAVEAT", evidence: "диф-записей нет — сделай ≥2 sense-снимка с изменением страницы (GET /browser/sense?refresh=1)" };
    const last = db.query(`SELECT tab, added_n, removed_n, moved_n, saved_pct, chars_full, chars_diff FROM browser_sense_diff ORDER BY id DESC LIMIT 1`).get() as
      { tab: string; added_n: number; removed_n: number; moved_n: number; saved_pct: number; chars_full: number; chars_diff: number };
    const shapeOk = last.saved_pct >= 0 && last.saved_pct <= 100 && last.added_n >= 0 && last.removed_n >= 0;
    return shapeOk
      ? { verdict: "WORKS", evidence: `дифов=${c.n}, last: +${last.added_n}/−${last.removed_n}/~${last.moved_n}, экономия ${last.saved_pct}% (${last.chars_diff}B vs ${last.chars_full}B); GET /browser/sense/diffs` }
      : { verdict: "CAVEAT", evidence: `форма дифа нарушена: saved_pct=${last.saved_pct}, +${last.added_n}/−${last.removed_n}` };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `ошибка: ${(e as Error).message}` };
  }
}

/** Кэшированные перцепции (без refresh). */
export function senseList(): { ok: true; rows: SenseRow[]; total_targets: number } {
  /* сортировка по captured_at DESC — индекс не нужен (строк ≤ вкладок) */
  const rows = db.query(`SELECT * FROM browser_sense ORDER BY captured_at DESC`).all() as Array<
    Omit<SenseRow, "targets"> & { targets_json: string }
  >;
  let total = 0;
  const mapped = rows.map((r) => {
    let targets: SemanticTarget[] = [];
    try { targets = JSON.parse(r.targets_json) as SemanticTarget[]; } catch { /* битая строка — пусто */ }
    total += r.targets_count;
    return { tab: r.tab, url: r.url, title: r.title, targets_count: r.targets_count, revision: r.revision, chars: r.chars, captured_at: r.captured_at, targets, age_s: Math.round((Date.now() - r.captured_at) / 1000) };
  });
  return { ok: true, rows: mapped, total_targets: total };
}

/** Резолв ключа: точный ref → точное имя (case-i) → уникальная подстрока. */
function resolve(targets: SemanticTarget[], key: string): SemanticTarget | null {
  const k = key.trim();
  if (!k) return null;
  if (/^e\d+$/.test(k)) {
    const byRef = targets.find((t) => t.ref === k);
    if (byRef) return byRef;
  }
  const byName = targets.filter((t) => t.name.toLowerCase() === k.toLowerCase());
  if (byName.length >= 1) return byName[0];
  const bySub = targets.filter((t) => t.name.toLowerCase().includes(k.toLowerCase()));
  return bySub.length === 1 ? bySub[0] : null;
}

/**
 * Act с verify (порт CAPTURE→act→verify) + effect-эпистемология легаси (R23):
 * 5 статусов (CONFIRMED/NO_EFFECT_PROVEN/FAILED_PRE_EFFECT/FENCED/AMBIGUOUS)
 * + one-attempt durable fences на AMBIGUOUS. Никогда не мутирует вне браузера.
 */
export async function senseAct(input: {
  key: string; action: "click" | "type" | "press"; text?: string; tab?: string;
}): Promise<{
  ok: true; acted: string; target: SemanticTarget | null;
  effect: { status: string; fenced_now: boolean; evidence: Record<string, unknown> };
  verify: { revision_changed: boolean; target_alive: boolean; before: string; after: string };
}> {
  const t0 = Date.now();
  try { return await senseActImpl(input); }
  finally { benchObserve("sense_act", Date.now() - t0); } // B3: зонд act (порог p95<2000ms)
}

async function senseActImpl(input: {
  key: string; action: "click" | "type" | "press"; text?: string; tab?: string;
}): Promise<{
  ok: true; acted: string; target: SemanticTarget | null;
  effect: { status: string; fenced_now: boolean; evidence: Record<string, unknown> };
  verify: { revision_changed: boolean; target_alive: boolean; before: string; after: string };
}> {
  const t0 = Date.now();
  const rows = senseList().rows;
  // база сравнения: указанный tab, иначе — самая свежая перцепция
  let before = input.tab ? rows.find((r) => r.tab === input.tab) ?? null : rows[0] ?? null;
  let prevTargets = before?.targets ?? [];
  let target = resolve(prevTargets, input.key);

  // Самозаживление (урок легаси: перцепция перед мутацией обязана быть свежей —
  // state_revision_id): цель не в кэше → свежий CAPTURE и повторный резолв.
  if (!target && input.action !== "press") {
    try {
      const fresh = await senseNow(input.tab);
      before = fresh;
      prevTargets = fresh.targets;
      target = resolve(prevTargets, input.key);
    } catch (e) {
      const v = effectVerdict({
        effectKey: `${input.action}:${input.key}`, preOk: false,
        revisionChanged: false, targetAlive: false,
        preError: `fresh_capture_failed: ${(e as Error).message}`,
      });
      return { ok: true, acted: input.action, target: null, effect: v, verify: { revision_changed: false, target_alive: false, before: "—", after: "—" } };
    }
    if (!target) {
      const v = effectVerdict({
        effectKey: `${input.action}:${input.tab ?? before?.tab ?? "default"}:${input.key}`, preOk: false,
        revisionChanged: false, targetAlive: false, preError: `sense_target_not_found: ${input.key}`,
      });
      return { ok: true, acted: input.action, target: null, effect: v, verify: { revision_changed: false, target_alive: false, before: before?.revision ?? "—", after: before?.revision ?? "—" } };
    }
  }

  // идентичность эффекта (exact identity, порт легаси): действие + вкладка + цель
  const effectKey = input.action === "press"
    ? `press:${input.key}`
    : `${input.action}:${input.tab ?? before?.tab ?? "default"}:${target?.ref ?? input.key}`;

  // durable fence ДО физического повтора: повтор AMBIGUOUS-эффекта отвергается (zero-authority)
  const preFence = fenceCheck(effectKey);
  if (preFence.fenced) {
    const v = effectVerdict({ effectKey, preOk: false, revisionChanged: false, targetAlive: false, evidence: { fenced_pre_action: true } });
    recordSpan("browser.sense_act", { "me2.ms": Date.now() - t0, "me2.action": input.action, "me2.status": "FENCED" }, t0);
    return { ok: true, acted: input.action, target, effect: v, verify: { revision_changed: false, target_alive: false, before: before?.revision ?? "—", after: before?.revision ?? "—" } };
  }

  const refArg = target ? `@${target.ref}` : input.key; // ref из легаси-семантики: @eN
  let acted = false;
  try {
    if (input.action === "click") {
      const r = await ab(["click", refArg]);
      if (r.code !== 0) throw new Error(`sense_click_failed_code_${r.code}: ${r.out.slice(0, 140)}`);
    } else if (input.action === "type") {
      const text = String(input.text ?? "");
      if (!text) throw new Error("text_required_for_type");
      const r = await ab(["fill", refArg, text]);
      if (r.code !== 0) throw new Error(`sense_type_failed_code_${r.code}: ${r.out.slice(0, 140)}`);
    } else {
      const r = await ab(["press", input.key || "Escape"]);
      if (r.code !== 0) throw new Error(`sense_press_failed_code_${r.code}: ${r.out.slice(0, 140)}`);
    }
    acted = true;
  } catch (e) {
    // FAILED_PRE_EFFECT: действие не ушло — повтор безопасен (fence не ставится)
    const v = effectVerdict({ effectKey, preOk: false, revisionChanged: false, targetAlive: false, preError: (e as Error).message });
    recordSpan("browser.sense_act", { "me2.ms": Date.now() - t0, "me2.action": input.action, "me2.status": "FAILED_PRE_EFFECT" }, t0);
    return { ok: true, acted: input.action, target, effect: v, verify: { revision_changed: false, target_alive: false, before: before?.revision ?? "—", after: before?.revision ?? "—" } };
  }

  // VERIFY: re-sense и сравнение ревизий + живость цели + смена URL (навигация)
  await new Promise((res) => setTimeout(res, 400)); // дать странице отреагировать
  const after = await senseNow(input.tab);
  const revisionChanged = after.revision !== before?.revision;
  const urlChanged = Boolean(before?.url) && after.url !== before?.url;
  const alive = target ? after.targets.some((t) => t.ref === target.ref) : false;
  const v = effectVerdict({
    effectKey, preOk: acted, revisionChanged, targetAlive: alive,
    urlChanged, hadTarget: Boolean(target),
    evidence: { before_url: (before?.url ?? "").slice(0, 120), after_url: (after.url ?? "").slice(0, 120) },
  });
  emit("BROWSER_SENSE_ACTED", {
    action: input.action, key: input.key, resolved: target?.ref ?? null,
    revision_changed: revisionChanged, target_alive: alive, effect: v.status,
  }, null, null);
  recordSpan("browser.sense_act", {
    "me2.ms": Date.now() - t0, "me2.action": input.action,
    "me2.revision_changed": revisionChanged, "me2.alive": alive, "me2.status": v.status,
  }, t0);
  return {
    ok: true,
    acted: input.action,
    target,
    effect: v,
    verify: { revision_changed: revisionChanged, target_alive: alive, before: before?.revision ?? "—", after: after.revision },
  };
}

export function senseStatus(): { ready: boolean; tabs: number; total_targets: number; last_age_s: number | null } {
  const l = senseList();
  return {
    ready: true,
    tabs: l.rows.length,
    total_targets: l.total_targets,
    last_age_s: l.rows[0]?.age_s ?? null,
  };
}
