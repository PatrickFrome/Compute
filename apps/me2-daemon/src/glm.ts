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
import { db, getMeta, nowIso } from "../store";
import { listAgents } from "../store";

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
  // Compatibility API only. No request is sent to ZAI/GLM after the
  // ChatGPT/OpenAI migration; callers receive an explicit non-authoritative
  // disabled observation.
  const row: GlmProbeRow = {
    id: 0,
    requested_tag: agentTag(),
    api_model: null,
    honoring: 0,
    ok: 0,
    error: "glm_legacy_read_only",
    at: nowIso(),
  };
  const note = "GLM/ZAI active probing is disabled; historical probe rows remain readable";
  return { ...row, note };
}

/** Legacy mutation surface retained only so old imports fail closed. */
export function upgradeAgents(): never {
  throw new Error("glm_legacy_read_only");
}

export function setLatestGlm(_model: string): never {
  throw new Error("glm_legacy_read_only");
}

export interface GlmStatus {
  ok: true;
  canonical: string; agent_tag: string;
  agents: { total: number; on_canonical: number; drift: number; by_model: Record<string, number> };
  last_probe: (GlmProbeRow & { note?: string }) | null;
  probes_total: number;
  platform_honoring: boolean | null; // null = проб ещё не было
  research: string;
  legacy_read_only?: boolean;
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
    research: "historical R29 GLM evidence retained for compatibility; active inference migrated to OpenAI/ChatGPT on 2026-10-04",
    legacy_read_only: true,
  };
}

/** Вердикт для механики ME25. WORKS = все агенты на каноническом теге и проба снята
 *  (факт зафиксирован — каким бы он ни был). Это честно: платформенное расхождение
 *  не прячет вердикт механики поверхности. */
export function glmVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  const s = glmStatus();
  return {
    verdict: "CAVEAT",
    evidence: `legacy GLM plane is read-only; historical agents=${s.agents.total}, active routing disabled; use /inference for OpenAI authority`,
  };
}
