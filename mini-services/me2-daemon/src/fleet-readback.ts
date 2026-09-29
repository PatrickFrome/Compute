/**
 * FLEET-READBACK ADAPTER (фаза 2 §3-миграции, Job 419718 @15:15) —
 * замена model-API пути для консьюмеров daemon (review/agentchat/eval/rsi/reviewer).
 *
 * Канал (физически доказан contract-test'ом 2026-09-28: r419718-1515-contract.py,
 * VERDICT CONTRACT-PASS / REPLY-CONFIRMED):
 *   consumer → fleet-task (Supabase command table, T1 lease)
 *   → live browser GLM_CHAT composer (CAPTURE ref → SEMANTIC_FOCUS → SEMANTIC_TYPE
 *     → PRESS_KEY Enter) → generation wait → READ_TRANSCRIPT → standalone-reply assert
 *   → text → consumer
 *
 * Контракт директивы:
 *  - НИКАКОГО silent fallback: любой отказ канала = явная ошибка наверх
 *    (fleet_channel_unavailable / fleet_reply_timeout), вызывающий паркует (L4) retry-able.
 *  - AMBIGUOUS (LEASED/EXPIRED/пустой readback) → reconciliation: re-poll ТОГО ЖЕ
 *    command_id (readback, не новая команда); blind retry ЗАПРЕЩЁН (§4).
 *  - Каждый шаг с readback receipt; proof хранится в evidence.
 *  - Anti-self-deception: маркер-ответ засчитывается ТОЛЬКО как standalone-строка
 *    (сам-промпт содержит тот же токен внутри предложения — contract-test ловит это).
 *
 * Zero-authority: адаптер НЕ создаёт табы вне scratch-протокола и НЕ трогает
 * табы флит-агентов (только собственный NEW_TAB → CLOSE_TAB lifecycle).
 * §10 (ME2-TICK-20260928-2001): reuse-пул = ТОЛЬКО собственные NEW_TAB-приёмки
 * (провенанс-реестр state/fleet-scratch-tabs.json); чужие USER-табы без
 * провенанса не переиспользуются никогда; release_signal=PHYSICAL_TAB_CLOSED
 * (реклейм чужих) остаётся swarm/owner-уровнем.
 */
import { tokenGet } from "./tokens";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SUP_TABLE = "compute_fabric_a2_browser_supervisor_command_h205f22";
const WS_DEFAULT = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
const TGT_DEFAULT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
/** межкомандная пауза (budget 24pts/60s, mut cost 4): 16s << 15-20s окна */
const MUT_GAP_MS = 16_000;
const POLL_TIMEOUT_MS = 60_000;
const LEASED_RECONCILE_MS = 75_000;
const GENERATION_WAIT_MS = 22_000;

export interface FleetReadbackResult {
  ok: boolean;
  text: string;
  /** изолированный ответ агента (reply-зона между маркер-строкой и промптом); "" если изолировать не удалось */
  reply: string;
  reply_isolated: boolean;
  tab_id: string;
  command_ids: string[];
  standalone_reply: boolean;
  ms: number;
}

export class FleetChannelError extends Error {
  constructor(public code: "fleet_channel_unavailable" | "fleet_reply_timeout" | "fleet_ambiguous", msg: string) {
    super(msg);
  }
}

interface CmdRow { command_id: string; status: string; error?: string | null; receipt?: { result?: unknown } | null; }

function suBase(): string {
  const b = tokenGet("SUPABASE_URL");
  if (!b) throw new FleetChannelError("fleet_channel_unavailable", "SUPABASE_URL отсутствует в vault — канал не конфигурирован");
  return b.replace(/\/$/, "");
}

function suJwt(): string {
  const j = tokenGet("SUPABASE_SERVICE_ROLE_JWT");
  if (!j) throw new FleetChannelError("fleet_channel_unavailable", "SUPABASE_SERVICE_ROLE_JWT отсутствует в vault");
  return j;
}

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${suBase()}${path}`, {
    ...init,
    headers: { apikey: suJwt(), Authorization: `Bearer ${suJwt()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new FleetChannelError("fleet_channel_unavailable", `Supabase REST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (r.status === 204 ? null : await r.json()) as T;
}

const iso = (d: Date) => d.toISOString().replace(/Z$/, "").replace(/\.\d{3}/, (m) => m.slice(0, 4) + "00");

async function enqueue(action: string, payload: Record<string, unknown>, ttl = 75): Promise<string> {
  const cid = crypto.randomUUID();
  const now = new Date();
  const exp = new Date(now.getTime() + ttl * 1000);
  const rows = await rest<unknown[]>(`/rest/v1/${SUP_TABLE}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      command_id: cid,
      workspace_id: tokenGet("ME2_WS_ID") || WS_DEFAULT,
      target_client_id: tokenGet("ME2_CLIENT_ID") || TGT_DEFAULT,
      issued_by: "me2-daemon-fleet-readback",
      action, platform: "GLM_ZAI",
      payload, status: "PENDING",
      issued_at: iso(now), expires_at: iso(exp),
      idempotency_key: `fleet-readback-${cid}`,
    }]),
  });
  if (!Array.isArray(rows) || !rows.length) {
    throw new FleetChannelError("fleet_channel_unavailable", "enqueue не вернул строку команды");
  }
  return cid;
}

async function poll(cid: string, timeoutMs = POLL_TIMEOUT_MS): Promise<CmdRow> {
  const t0 = Date.now();
  for (;;) {
    const rows = await rest<CmdRow[]>(`/rest/v1/${SUP_TABLE}?command_id=eq.${cid}&select=status,receipt,error`);
    const row = rows?.[0];
    if (row && ["COMPLETED", "FAILED", "EXPIRED"].includes(row.status)) return row;
    if (Date.now() - t0 > timeoutMs + LEASED_RECONCILE_MS) {
      throw new FleetChannelError("fleet_ambiguous",
        `команда ${cid} не достигла терминала (${row?.status ?? "POLL_TIMEOUT"}) — reconciliation исчерпан`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

function resultOf(row: CmdRow): Record<string, unknown> {
  return ((row.receipt ?? {}) as { result?: Record<string, unknown> }).result ?? {};
}

/** djb2-хэш → 8 hex: детерминированный маркер протокола ответа (anti-self-deception: строка). */
function replyMarker(goal: string): string {
  let h = 5381;
  for (let i = 0; i < goal.length; i++) h = ((h * 33) ^ goal.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

// L25 (ME2-TICK-20260928-1724): receipt-shape drift — CAPTURE несёт semantic_targets
// (старая форма) ИЛИ interaction_tree (форма 1645-диагностики: узлы name/role/frame_id/
// semantic_ref[dict]/backend_node_id). Органический прогон tk_mul16t3yckrxpm честно упал
// «textbox не найден», т.к. discovery читал только semantic_targets. Экстрактор shape-агностик:
// recursive walk по interaction_tree (любые контейнеры-дети), fallback — semantic_targets;
// cap 20k узлов от патологических деревьев.
function findComposer(res: unknown): { role?: string; semantic_ref?: unknown } | null {
  let visited = 0;
  const walk = (node: unknown): { role?: string; semantic_ref?: unknown } | null => {
    if (!node || typeof node !== "object" || visited > 20_000) return null;
    visited++;
    const o = node as Record<string, unknown>;
    if (o.role === "textbox" && o.semantic_ref) return o as { role?: string; semantic_ref?: unknown };
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) {
        for (const it of v) { const hit = walk(it); if (hit) return hit; }
      } else if (v && typeof v === "object") {
        const hit = walk(v);
        if (hit) return hit;
      }
    }
    return null;
  };
  const r = res as Record<string, unknown> | null;
  const fromTree = r ? walk(r.interaction_tree) : null;
  if (fromTree) return fromTree;
  const targets = r?.semantic_targets;
  if (Array.isArray(targets)) {
    const hit = targets.find(
      (t) => !!t && typeof t === "object" &&
        (t as Record<string, unknown>).role === "textbox" && !!(t as Record<string, unknown>).semantic_ref,
    );
    if (hit) return hit as { role?: string; semantic_ref?: unknown };
  }
  return null;
}

// §7/§13 (ME2-TICK-20260928-1739): глобальный storm-guard канала — ЕДИНАЯ backpressure-точка.
// Детерминированные инфраструктурные отказы (tab_capacity_exceeded /
// supervisor_failure_circuit_open / supervisor_action_budget_exceeded) не ретраятся
// активно: экспоненциальный storm-бэкофф для ВСЕХ ask'ов (паттерн G11 governor.ts).
// Инцидент 09:32-09:42Z: крон-консьюмеры × 3-ретрай = ~6 NEW_TAB/мин при полной
// ёмкости 48/48 → supervisor-circuit открылся → блокирует и CLOSE_TAB-уборку
// (лайвлок). §3-чисто: честный fail-fast без fallback; success сбрасывает streak.
let stormUntil = 0;
let stormStreak = 0;
const STORM_BASE_MS = 60_000;
const STORM_CAP_MS = 600_000;
const STORM_PAT = /tab_capacity|circuit_open|budget_exceeded/i;

// §10 (ME2-TICK-20260928-2001): scratch-пул (BrowserCell reuse) — персистентный реестр
// СОБСТВЕННЫХ scratch-табов адаптера: id попадает сюда только через NEW_TAB-приёмку
// этого модуля (чистый провенанс). Success-путь канала исторически оставлял таб открытым
// (CLOSE только в error-ветке — источник утечки L12): теперь эти табы = reuse-пул.
// При табличной стене (deterministic tab_capacity, release_signal=PHYSICAL_TAB_CLOSED)
// ask деградирует на переиспользование ЖИВОГО своего таба (CAPTURE-evidence → composer)
// вместо NEW_TAB; пустой/мёртвый пул = честный capacity-отказ наверх (storm-guard,
// без fallback-маскировки §3, без blind retry §4 — каждый кандидат со свежим evidence).
interface ScratchMeta { created_at: string; last_used?: string; last_outcome?: string }
const SCRATCH_REG_PATH = `${import.meta.dir}/../state/fleet-scratch-tabs.json`;
const SCRATCH_REG_CAP = 64;
const scratchReg = new Map<string, ScratchMeta>(
  (() => { try { return Object.entries(JSON.parse(readFileSync(SCRATCH_REG_PATH, "utf8"))) as [string, ScratchMeta][]; } catch { return []; } })(),
);
const scratchInFlight = new Set<string>();
function saveScratchReg(): void {
  try {
    mkdirSync(`${import.meta.dir}/../state`, { recursive: true });
    // bounded storage: держим SCRATCH_REG_CAP самых свежих (§11-дисциплина)
    const entries = [...scratchReg.entries()]
      .sort((a, b) => (b[1].last_used ?? b[1].created_at).localeCompare(a[1].last_used ?? a[1].created_at))
      .slice(0, SCRATCH_REG_CAP);
    scratchReg.clear();
    for (const [k, v] of entries) scratchReg.set(k, v);
    writeFileSync(SCRATCH_REG_PATH, JSON.stringify(Object.fromEntries(scratchReg), null, 1));
  } catch { /* реестр не критичен для исполнения ask */ }
}

export async function fleetReadbackAsk(goal: string, opts: { timeout_ms?: number; max_chars?: number } = {}): Promise<FleetReadbackResult> {
  const t0 = Date.now();
  if (Date.now() < stormUntil) {
    const waitS = Math.ceil((stormUntil - Date.now()) / 1000);
    throw new FleetChannelError("fleet_channel_unavailable",
      `channel_backpressure: storm-guard ${waitS}s (ёмкость/circuit — ask честно припаркован, NEW_TAB не сожжён)`);
  }
  // max_chars (419718-1645): worker-исполнителю нужен полный протокол (~3k) — дефолт 1500
  // не тронут (reviewer/классификатор/RSI совместимы), удлинение — явно опционально
  const cap = Math.max(200, opts.max_chars ?? 1500);
  const text = String(goal ?? "").trim().slice(0, cap);
  if (!text) throw new FleetChannelError("fleet_channel_unavailable", "goal_required");
  const mk = `ME2REPLY:${replyMarker(text)}`;
  // протокол ответа: первая строка ответа = маркер (standalone), затем содержимое;
  // маркер встречается и в промпте — засчитываем ТОЛЬКО standalone-строку (L19)
  const prompt = `${text}\n\n(Протокол ME2: первой строкой ответа выведи ровно ${mk}, затем — сам ответ.)`;
  // L20 (E2E 15:30): newline в SEMANTIC_TYPE ломает посткондицию композера
  // (postcondition_not_confirmed:AMBIGUOUS) — typing однострочный, переносы схлопываем;
  // это НЕ ломает протокол: standalone-маркер ассертится в ОТВЕТЕ агента, не в промпте
  const promptFlat = prompt.replace(/\s*\n\s*/g, " ");
  const promptSha = createHash("sha256").update(promptFlat, "utf8").digest("hex");
  const cids: string[] = [];
  const mut = async <T>(action: string, payload: Record<string, unknown>, extract: (r: CmdRow) => T, pacing = true): Promise<T> => {
    const cid = await enqueue(action, payload);
    cids.push(cid);
    const row = await poll(cid, opts.timeout_ms ?? POLL_TIMEOUT_MS);
    if (row.status !== "COMPLETED") {
      // L21 (E2E 15:30): evidence-based resolution — SEMANTIC_TYPE FAILED
      // postcondition_not_confirmed, НО receipt доказывает эффект
      // (value_sha256_after === prompt_sha256, replace_verified: true): вторичная
      // реверификация поймала гонку за композером (флот сам тайтс брифы в новые табы,
      // L12). Эффект доказан receipt'ом → принимаем, это НЕ blind retry.
      const res = (row.receipt ?? {}).result ?? {};
      if (String(row.error ?? "").includes("postcondition_not_confirmed")) {
        // typed-эффект доказан: поле содержит ровно наш текст, ИЛИ
        // отправка уже произошла и композер очистился (before>0 → after=0)
        const typed = action === "SEMANTIC_TYPE" && row.status === "FAILED" &&
          ((res.value_sha256_after === promptSha && res.replace_verified === true) ||
           (Number(res.value_length_before ?? 0) > 0 && Number(res.value_length_after ?? -1) === 0));
        // FOCUS: посткондиция (re-read фокуса) неверифицируема при чурне флот-ревизий;
        // принимаем факт ДОСТИЖЕНИЯ цели — receipt.target несёт semantic_ref (dict,
        // форма 1645-диагностики) ИЛИ semantic_ref_id (прежняя форма) — реальный гейт
        // следующий TYPE+SUBMIT: если фокус не встал, TYPE упадёт честно (sha/clear)
        const ftgt = ((res.target ?? {}) as Record<string, unknown>);
        const focused = action === "SEMANTIC_FOCUS" &&
          Boolean(ftgt.semantic_ref ?? ftgt.semantic_ref_id);
        if (typed || focused) return res as T;
      }
      throw new FleetChannelError("fleet_ambiguous", `${action} → ${row.status}: ${String(row.error ?? "")}`);
    }
    await new Promise((r) => setTimeout(r, pacing ? MUT_GAP_MS : 0));
    return extract(row);
  };

  // §10: acquire scratch-таба — канонический NEW_TAB; при детерминированной табличной
  // стене — переиспользование живого таба из СОБСТВЕННОГО пула (см. блок scratch-пула).
  const acquireScratchTab = async (): Promise<{ tabId: string; reused: boolean; composer: unknown }> => {
    try {
      const id = await mut("NEW_TAB", {}, (r) => String(resultOf(r).tab_id ?? ""));
      if (!id) throw new FleetChannelError("fleet_ambiguous", "NEW_TAB без tab_id — reconciliation");
      scratchReg.set(id, { created_at: new Date().toISOString() });
      saveScratchReg();
      return { tabId: id, reused: false, composer: null };
    } catch (e) {
      if (!/tab_capacity/i.test(String(e instanceof Error ? e.message : e))) throw e;
      // стена: TAB_CENSUS (READ_ONLY 0pts) → защищённый набор → свои живые кандидаты
      const census: Record<string, unknown> = await mut("TAB_CENSUS", {}, resultOf, false).catch(() => ({} as Record<string, unknown>));
      const protectedIds = new Set([
        ...((census.fleet_tab_ids as string[] | undefined) ?? []),
        ...((census.supervisor_tab_ids as string[] | undefined) ?? []),
      ]);
      const candidates = [...scratchReg.entries()]
        .filter(([id, m]) => !protectedIds.has(id) && !scratchInFlight.has(id) && m.last_outcome !== "closed")
        .sort((a, b) => (b[1].last_used ?? b[1].created_at).localeCompare(a[1].last_used ?? a[1].created_at))
        .slice(0, 3);
      for (const [id, meta] of candidates) {
        scratchInFlight.add(id);
        try {
          const hit = findComposer(await mut("CAPTURE", { tab_id: id }, resultOf, false));
          if (hit) {
            meta.last_used = new Date().toISOString();
            meta.last_outcome = "reused";
            saveScratchReg();
            return { tabId: id, reused: true, composer: hit };
          }
          scratchReg.delete(id); // CAPTURE честно не нашёл таб/композер — evidence мёртв
          saveScratchReg();
        } finally {
          scratchInFlight.delete(id);
        }
      }
      throw e; // пул пуст/мёртв — исходная capacity-ошибка честно наверх (storm-guard)
    }
  };

  // Один цикл ask = СВЕЖИЙ scratch-таб от NEW_TAB до READ_TRANSCRIPT (419718-1645),
  // либо reuse собственного живого таба при табличной стене (§10, 2001-тик).
  const attemptOnce = async (): Promise<FleetReadbackResult> => {
  // 1) scratch-чат: NEW_TAB (канон) или reuse собственного пула при стене (§10)
  const acq = await acquireScratchTab();
  const tabId = acq.tabId;

  try {
    // 2) CAPTURE → composer semantic_ref (read — без pacing).
    // L25-fix (1724): bounded re-CAPTURE (3 попытки, пауза 4s, READ_ONLY 0pts) против
    // load-churn свежего таба (load_pending в NEW_TAB receipt) + drift-толерантный экстрактор
    // (semantic_targets ИЛИ interaction_tree). Только после 3 пустых попыток — честный отказ.
    type ComposerRef = { role?: string; semantic_ref?: unknown };
    const tb = await (async (): Promise<ComposerRef> => {
      if (acq.composer) return acq.composer as ComposerRef; // reuse: свежий CAPTURE уже в acquire (§10)
      for (let i = 0; i < 3; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 4_000));
        const hit = findComposer(await mut("CAPTURE", { tab_id: tabId }, resultOf, false));
        if (hit) return hit;
      }
      throw new FleetChannelError("fleet_channel_unavailable", "композер недоступен после 3 CAPTURE (semantic_targets и interaction_tree без textbox semantic_ref — L25)");
    })();

    // 3) FOCUS (ref из capture#1) + свежий CAPTURE#2 непосредственно перед TYPE
    // (L16/L23: state_revision фенс протухает — флот ревизует табы, окно <5s;
    // CAPTURE = READ_ONLY 0pts, бюджет не тратит)
    const ref = { tab_id: tabId, role: "textbox", semantic_ref: tb.semantic_ref };
    await mut("SEMANTIC_FOCUS", ref, resultOf);
    // свежий CAPTURE#2 непосредственно перед TYPE (L16/L23: state_revision фенс протухает —
    // флот ревизует табы, окно <5s; CAPTURE = READ_ONLY 0pts, бюджет не тратит)
    // — тем же drift-толерантным экстрактором (L25), 2 попытки
    const tb2 = await (async (): Promise<ComposerRef> => {
      for (let i = 0; i < 2; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 4_000));
        const hit = findComposer(await mut("CAPTURE", { tab_id: tabId }, resultOf, false));
        if (hit) return hit;
      }
      throw new FleetChannelError("fleet_channel_unavailable", "композер исчез ко второму CAPTURE (2 попытки — L25)");
    })();
    // 4) TYPE+SUBMIT атомарно (L22: отдельный PRESS_KEY = лишнее окно гонки —
    // receipt PRESS_KEY не несёт evidence: target:null; submit_after_type=true — верификация клиента внутри команды)
    const ref2 = { tab_id: tabId, role: "textbox", semantic_ref: tb2.semantic_ref };
    await mut("SEMANTIC_TYPE", { ...ref2, text: promptFlat, submit_after_type: true, replace_existing: true }, resultOf);

    // 6) generation wait (не команда) — масштабируется по длине промпта:
    // длинный транскрипт → дольше генерация GLM-таба (базовые 22s для ≤1500 симв.,
    // +1s за каждые 100 символов сверху, потолок +60s — честный компромисс латентности)
    const genWaitMs = GENERATION_WAIT_MS +
      Math.min(60_000, Math.floor(Math.max(0, promptFlat.length - 1500) / 100) * 1_000);
    await new Promise((r) => setTimeout(r, genWaitMs));

    // 7) READ_TRANSCRIPT + standalone-marker assert + reply-зона
    const rb = await mut("READ_TRANSCRIPT", { tab_id: tabId, limit: 12 }, resultOf, false);
    const transcript = String(rb.text ?? "");
    const lines = transcript.split("\n").map((l: string) => l.trim());
    const markerIdx = lines.indexOf(mk); // standalone (ровно строка маркера)
    if (markerIdx < 0) {
      throw new FleetChannelError("fleet_reply_timeout",
        `маркер-ответ ${mk} не найден как standalone-строка (len=${transcript.length}) — park-and-resume, повтор НЕ выполняется. TAIL: ${transcript.slice(-500).replace(/\s+/g, " ")}`);
    }
    // reply-зона: между маркером и строкой промпта (транскрипт реверс-хронологичен —
    // контракт-тест 1515: [title, Thought Process, REPLY, PROMPT]); пустая зона = ответ
    // состоял только из маркера (это валидный reply)
    const promptPrefix = lines.find((l: string) => l.startsWith(text.slice(0, 48)));
    const promptIdx = promptPrefix ? lines.indexOf(promptPrefix) : -1;
    let reply = "";
    let isolated = false;
    if (promptIdx > markerIdx) {
      reply = lines.slice(markerIdx + 1, promptIdx).join("\n");
      isolated = true;
    }
    if (acq.reused) {
      const m = scratchReg.get(tabId);
      if (m) { m.last_outcome = "asked"; saveScratchReg(); }
    }
    return { ok: true, text: transcript, reply, reply_isolated: isolated, tab_id: tabId, command_ids: cids, standalone_reply: true, ms: Date.now() - t0 };
  } catch (e) {
    if (acq.reused) {
      // reuse-таб НЕ закрывается: дефицитный ресурс пула при стене (§10)
      const m = scratchReg.get(tabId);
      if (m) { m.last_outcome = "ask_failed"; saveScratchReg(); }
      throw e;
    }
    // уборка scratch-таба best-effort (не маскирует исходную ошибку)
    try {
      const cid = await enqueue("CLOSE_TAB", { tab_id: tabId });
      cids.push(cid);
      const crow = await poll(cid);
      if (crow.status === "COMPLETED") { scratchReg.delete(tabId); saveScratchReg(); }
    } catch { /* уборка не важнее исходного отказа */ }
    throw e;
  }
  };

  // BOUNDED FRESH-CYCLE RETRY (419718-1645, под нагрузкой роя): composer не мгновенен
  // на свежем табе (load_pending), FOCUS ловит контенцию ревизий (L23) — каждая
  // попытка = НОВАЯ вкладка-цель с полным readback receipt (не blind retry той же
  // команды — §4 соблюдён: dispatch ≤1 на цель, evidence читается каждый раз);
  // конфигурационные отказы (нет vault-кредов) не жгут циклы.
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await attemptOnce();
      stormStreak = 0; stormUntil = 0; // успех — канал здоров, backpressure снят
      return out;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      // детерминированный отказ инфраструктуры: arm storm-бэкофф на ВСЕ ask'и,
      // наверх без ×3-дожигания NEW_TAB (не blind retry, §4)
      if (STORM_PAT.test(msg)) {
        stormStreak++;
        const ms = Math.min(STORM_BASE_MS * 2 ** Math.min(stormStreak - 1, 4), STORM_CAP_MS);
        stormUntil = Date.now() + ms;
        throw e;
      }
      const cfgErr = e instanceof FleetChannelError && e.code === "fleet_channel_unavailable" &&
        /vault|SUPABASE|конфигур/i.test(String(e.message));
      if (cfgErr || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 8_000 * attempt));
    }
  }
}
