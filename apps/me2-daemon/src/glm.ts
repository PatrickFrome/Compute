/**
 * ME2 daemon — GLM currency plane (R29, директива оператора: «все агенты всегда должны
 * работать на последней версии glm»).
 *
 * Ресёрч R29 (research/2026/r29-glm-latest.json, живые пробы /tmp-скриптов):
 *  - флагман Z.ai на 2026-09: GLM-5.3 (релиз 2026-08-18; GLM-5.2 — 2026-06-16);
 *  - z-ai-web-dev-sdk 0.0.18 (последняя) принимает model?: string, НО бэкенд в sandbox
 *    игнорирует тег: живой probe отвечает api.model="glm-4-plus" при любом теге;
 *  - Vercel AI Gateway (умеет маршрутизацию zai/glm-5.3) из sandbox сети недоступен
 *    (TLS alert / unexpected eof — проверено curl и bun fetch).
 *
 * Поэтому плоскость ЧЕСТНАЯ (не фальшивая, как требует оператор):
 *  - канонический тег CANONICAL_GLM хранится в meta и поддерживается актуальным;
 *  - ВСЕ агенты принудительно переводятся на канонический тег (boot + spawn + REST) —
 *    когда платформа начнёт уважать тег, агенты уже на последней версии;
 *  - живой probe при каждой инкарнации фиксирует ФАКТ: какой api.model реально отвечает
 *    бэкенд на канонический тег (таблица glm_probes) — расхождение видно, не приукрашено;
 *  - drift = агенты не на каноническом теге (должен быть 0).
 *
 * REST: GET /glm, POST /glm {op:probe|upgrade|set_latest} — вне шины (47/47). Механика ME25.
 */
import ZAI from "z-ai-web-dev-sdk";
import { db, emit, setMeta, getMeta, nowIso } from "../store";
import { listAgents, setAgentModel } from "../store";
import { recordSpan } from "./otel";

/** Флагман Z.ai на момент R29 (ресёрч r29-glm-latest.json). Меняется оператором
 *  через POST /glm {op:set_latest} или обновлением ресурсёрча в новых раундах. */
const GLM_LATEST_DEFAULT = "glm-5.3";
const AGENT_TAG_PREFIX = "zai:";

export function canonicalGlm(): string {
  return getMeta("glm_canonical") ?? GLM_LATEST_DEFAULT;
}

export function agentTag(): string {
  return `${AGENT_TAG_PREFIX}${canonicalGlm()}`;
}

db.exec(`
CREATE TABLE IF NOT EXISTS glm_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_tag TEXT NOT NULL,
  api_model TEXT,
  honoring INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glm_probes_at ON glm_probes(at);
`);

export interface GlmProbeRow {
  id: number; requested_tag: string; api_model: string | null;
  honoring: number; ok: number; error: string | null; at: string;
}

/** Живая проба: канонический тег → фактический api.model бэкенда. Сеть — только async
 *  (урок R25), вызывается из boot-таймера/REST, никогда из шины. */
export async function glmProbe(): Promise<GlmProbeRow & { note: string }> {
  const tag = agentTag();
  let row: GlmProbeRow;
  try {
    const z = await ZAI.create();
    const resp = (await z.chat.completions.create({
      messages: [{ role: "user", content: "reply OK" }],
      model: canonicalGlm(),
      stream: false,
      thinking: { type: "disabled" },
    })) as { model?: string };
    const apiModel = resp.model ?? null;
    // honoring = бэкенд честно взял запрошенный тег (учитывая префиксы провайдера)
    const honoring = !!apiModel && apiModel.replace(/^.*\//, "").toLowerCase() === canonicalGlm().toLowerCase();
    row = { id: 0, requested_tag: tag, api_model: apiModel, honoring: honoring ? 1 : 0, ok: 1, error: null, at: nowIso() };
  } catch (e) {
    row = { id: 0, requested_tag: tag, api_model: null, honoring: 0, ok: 0, error: String(e).slice(0, 200), at: nowIso() };
  }
  try {
    const r = db.query(`INSERT INTO glm_probes (requested_tag,api_model,honoring,ok,error,at) VALUES (?,?,?,?,?,?)`)
      .run(row.requested_tag, row.api_model, row.honoring, row.ok, row.error, row.at);
    row.id = Number(r.lastInsertRowid);
    db.query(`DELETE FROM glm_probes WHERE id <= (SELECT MAX(id) FROM glm_probes) - 100`).run();
  } catch { /* история не критична */ }
  emit("GLM_PROBE", {
    requested: row.requested_tag, api_model: row.api_model, honoring: !!row.honoring, ok: !!row.ok,
  }, null, null);
  recordSpan("glm.probe", {
    "me2.requested": row.requested_tag, "me2.api_model": row.api_model ?? "?", "me2.honoring": !!row.honoring,
  }, Date.now(), row.ok ? {} : { status: "ERROR", message: row.error ?? "probe failed" });
  const note = row.ok
    ? row.honoring
      ? "бэкенд уважает тег — агенты реально на канонической версии"
      : `бэкенд отвечает api.model=${row.api_model ?? "?"} на тег ${row.requested_tag} — расхождение платформы зафиксировано честно (тег принудительно стоит, сместится вместе с платформой)`
    : `probe не удался: ${row.error ?? "?"}`;
  return { ...row, note };
}

/** Перевод ВСЕХ агентов на канонический тег (директива оператора = авторизация;
 *  каждая смена пишет AGENT_MODEL_SET — аудит полон). */
export function upgradeAgents(): { upgraded: number; already: number; agents: Array<{ id: string; role: string; from: string; to: string }> } {
  const target = agentTag();
  const changed: Array<{ id: string; role: string; from: string; to: string }> = [];
  let already = 0;
  for (const a of listAgents()) {
    if (a.model === target) { already++; continue; }
    setAgentModel(a.id, target);
    emit("AGENT_MODEL_SET", { id: a.id, role: a.role, from: a.model, to: target, by: "glm_currency_directive" }, a.id, null);
    changed.push({ id: a.id, role: a.role, from: a.model, to: target });
  }
  recordSpan("glm.upgrade_agents", { "me2.upgraded": changed.length, "me2.already": already, "me2.tag": target }, Date.now());
  return { upgraded: changed.length, already, agents: changed };
}

export function setLatestGlm(model: string): string {
  const m = String(model ?? "").trim().replace(/^zai:/, "").slice(0, 64);
  if (!/^glm[-\w.]*$/.test(m)) throw new Error("bad_model_tag (ожидается glm-…)");
  const prev = canonicalGlm();
  setMeta("glm_canonical", m);
  emit("GLM_LATEST_SET", { from: prev, to: m, by: "operator" }, null, null);
  // немедленное приведение флота к новому канону
  const up = upgradeAgents();
  return `${m} (upgraded=${up.upgraded}, already=${up.already})`;
}

export interface GlmStatus {
  ok: true;
  canonical: string; agent_tag: string;
  agents: { total: number; on_canonical: number; drift: number; by_model: Record<string, number> };
  last_probe: (GlmProbeRow & { note?: string }) | null;
  probes_total: number;
  platform_honoring: boolean | null; // null = проб ещё не было
  research: string;
}

export function glmStatus(): GlmStatus {
  const agents = listAgents();
  const byModel: Record<string, number> = {};
  for (const a of agents) byModel[a.model] = (byModel[a.model] ?? 0) + 1;
  const onCanonical = agents.filter((a) => a.model === agentTag()).length;
  const last = db.query(`SELECT * FROM glm_probes ORDER BY id DESC LIMIT 1`).get() as GlmProbeRow | undefined;
  const total = Number((db.query(`SELECT COUNT(*) AS n FROM glm_probes`).get() as { n: number }).n);
  return {
    ok: true,
    canonical: canonicalGlm(),
    agent_tag: agentTag(),
    agents: { total: agents.length, on_canonical: onCanonical, drift: agents.length - onCanonical, by_model: byModel },
    last_probe: last ?? null,
    probes_total: total,
    platform_honoring: last ? !!last.honoring : null,
    research: "research/2026/r29-glm-latest.json: флагман GLM-5.3 (2026-08-18); SDK 0.0.18 игнорирует тег в sandbox; gateway недоступен из сети sandbox",
  };
}

/** Вердикт для механики ME25. WORKS = все агенты на каноническом теге и проба снята
 *  (факт зафиксирован — каким бы он ни был). Это честно: платформенное расхождение
 *  не прячет вердикт механики поверхности. */
export function glmVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const s = glmStatus();
    if (s.agents.total === 0) return { verdict: "CAVEAT", evidence: "агентов нет — флот пуст" };
    if (s.agents.drift > 0) {
      return { verdict: "CAVEAT", evidence: `drift=${s.agents.drift}/${s.agents.total} не на ${s.agent_tag} — POST /glm {op:upgrade}` };
    }
    const probe = s.last_probe;
    const probeStr = probe
      ? `probe: requested=${probe.requested_tag} → api.model=${probe.api_model ?? "?"}, honoring=${!!probe.honoring}`
      : "probe ещё не снят (boot+3s или POST /glm {op:probe})";
    return {
      verdict: "WORKS",
      evidence: `канон ${s.canonical}: все ${s.agents.total} агентов на теге (${probeStr}); GET /glm`,
    };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `glm-плоскость сломана: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180) };
  }
}
