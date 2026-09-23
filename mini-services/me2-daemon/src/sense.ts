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
// миграция: ранние записи писались под ключом "active" (нетабличный ключ) — вычищаем разово
db.exec(`DELETE FROM browser_sense WHERE tab='active'`);

export interface SemanticTarget { ref: string; role: string; name: string }
export interface SenseRow {
  tab: string; url: string; title: string; targets_count: number;
  revision: string; chars: number; captured_at: number;
  targets?: SemanticTarget[];
  age_s?: number;
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

/** Свежая перцепция: snapshot активной (или указанной) вкладки → parse → persist. */
export async function senseNow(tab?: string): Promise<SenseRow & { targets: SemanticTarget[] }> {
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
  db.query(`
    INSERT INTO browser_sense (tab,url,title,targets_json,targets_count,revision,chars,captured_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(tab) DO UPDATE SET url=excluded.url, title=excluded.title,
      targets_json=excluded.targets_json, targets_count=excluded.targets_count,
      revision=excluded.revision, chars=excluded.chars, captured_at=excluded.captured_at
  `).run(row.tab, row.url, row.title, JSON.stringify(targets.slice(0, MAX_TARGETS)), row.targets_count, row.revision, row.chars, row.captured_at);
  emit("BROWSER_SENSED", { tab: row.tab, count: row.targets_count, revision }, null, null);
  recordSpan("browser.sense", { "me2.ms": Date.now() - t0, "me2.targets": row.targets_count }, t0);
  return { ...row, targets: targets.slice(0, MAX_TARGETS) };
}

/** Кэшированные перцепции (без refresh). */
export function senseList(): { ok: true; rows: SenseRow[]; total_targets: number } {
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
