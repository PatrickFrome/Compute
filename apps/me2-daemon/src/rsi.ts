/**
 * ME8 RSI (R19) — порт механики M14 старой системы (recursive self-improvement: research queue,
 * skill lifecycle, operator-gated promotion). Старый RSI был CAVEAT: 91 модуль в браузер-сайде,
 * промоушен за оператор-гейтом (R9), evidence-gates + транзишн-пруфы.
 *
 * ME2 RSI — честный минимальный контур:
 *  - propose: evidence = уроки памяти (semantic/procedural top) + RH-вердикты; LLM-черновик
 *    {title, body_md} ИЛИ детерминированный fallback-шаблон (LLM не обязателен);
 *  - adopt/reject — ТОЛЬКО оператор (zero-authority: авто-промоушен запрещён);
 *  - adopt пишет артефакт skills/rsi/<id>.md; rollback удаляет (файл + статус);
 *  - всё event-sourced: RSI_PROPOSED / RSI_ADOPTED / RSI_REJECTED / RSI_ROLLED_BACK + спаны.
 */
import { db, emit, rid } from "../store";
import { recordSpan } from "./otel";
import { memSearch } from "./memory";
import { chat } from "../providers";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(process.cwd(), "skills", "rsi");

db.exec(`
CREATE TABLE IF NOT EXISTS rsi_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  artifact TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rsi_status ON rsi_proposals(status, created_at);
`);

export interface RsiProposal {
  id: string; title: string; body_md: string; source: string; evidence: string;
  status: string; artifact: string | null; created_at: number; decided_at: number | null;
}

function evidenceGather(): { lessons: string[]; rh: number } {
  const lessons = memSearch({ kind: "semantic", limit: 5 }).map((m) => m.content.slice(0, 160));
  const rhRows = memSearch({ kind: "semantic", limit: 50 }).filter((m) => m.key.startsWith("rh:"));
  return { lessons, rh: rhRows.length };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "p";
}

export async function rsiPropose(opts: { auto?: boolean; hint?: string } = {}): Promise<RsiProposal> {
  const t0 = Date.now();
  const ev = evidenceGather();
  const hint = String(opts.hint ?? "").slice(0, 300);
  let title = `Улучшение: ${hint || ev.lessons[0]?.slice(0, 60) || "системная дисциплина"}`;
  let body = [
    `## Предложение RSI (fallback-шаблон)`,
    ``,
    `**Источник:** ${opts.auto === false ? "operator" : "auto"}${hint ? ` · hint: ${hint}` : ""}`,
    `**Evidence:** уроков в памяти = ${ev.lessons.length}, RH-вердиктов = ${ev.rh}`,
    ``,
    `### Проблема`,
    ev.lessons[0] ?? "накопленных уроков недостаточно для точной формулировки",
    ``,
    `### Предложение`,
    hint || "зафиксировать повторяющийся урок как процедуру в skills/",
    ``,
    `### Шаги внедрения`,
    `1. Проверить применимость к daemon (47/47 инвариант не трогаем).`,
    `2. Внести изменение малым коммитом, прогнать REST-тесты.`,
    `3. Обновить worklog + skill me2-round.`,
  ].join("\n");

  if (ev.lessons.length || hint) {
    try {
      const raw = await chat("zai:default", [
        { role: "system", content: "Ты — RSI-контур ME2 OS. По evidence (уроки памяти, hint) предложи КОНКРЕТНОЕ улучшение системы. Верни СТРОГО JSON: {\"title\": \"короткий заголовок\", \"body_md\": \"markdown: Проблема/Предложение/Шаги внедрения/Риски\"}. Никаких изменений в коде не делаешь — только черновик для оператора." },
        { role: "user", content: JSON.stringify({ hint, lessons: ev.lessons, reward_hack_count: ev.rh }) },
      ], { temperature: 0.4, lane: "P2" }); // RSI — фон (G11)
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]) as { title?: string; body_md?: string };
        if (j.title) title = String(j.title).slice(0, 120);
        if (j.body_md) body = String(j.body_md).slice(0, 6000);
      }
    } catch { /* fallback-шаблон уже готов — RSI не ломается от недоступности LLM */ }
  }

  const id = rid("rsi");
  const row: RsiProposal = {
    id, title, body_md: body, source: opts.auto === false ? "operator" : "auto",
    evidence: JSON.stringify({ lessons: ev.lessons.length, reward_hack: ev.rh }),
    status: "PROPOSED", artifact: null, created_at: Date.now(), decided_at: null,
  };
  db.query(`INSERT INTO rsi_proposals (id,title,body_md,source,evidence,status,artifact,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,NULL)`)
    .run(row.id, row.title, row.body_md, row.source, row.evidence, row.status, row.artifact, row.created_at);
  emit("RSI_PROPOSED", { id, title, source: row.source });
  recordSpan("rsi.propose", { "me2.id": id, "me2.source": row.source }, t0);
  return row;
}

function getProposal(id: string): RsiProposal {
  const r = db.query(`SELECT * FROM rsi_proposals WHERE id=?`).get(id) as RsiProposal | undefined;
  if (!r) throw new Error("proposal_not_found");
  return r;
}

function decide(id: string, status: string): RsiProposal {
  const r = getProposal(id);
  db.query(`UPDATE rsi_proposals SET status=?, decided_at=? WHERE id=?`).run(status, Date.now(), id);
  return { ...r, status, decided_at: Date.now() };
}

export function rsiAdopt(id: string): RsiProposal & { artifact_path: string } {
  const t0 = Date.now();
  const r = getProposal(id);
  if (r.status !== "PROPOSED") throw new Error(`invalid_state_${r.status}`);
  mkdirSync(SKILLS_DIR, { recursive: true });
  const file = join(SKILLS_DIR, `rsi-${r.id}-${slugify(r.title)}.md`);
  writeFileSync(file, `# RSI ${r.id}: ${r.title}\n\n${r.body_md}\n`, "utf8");
  db.query(`UPDATE rsi_proposals SET status='ADOPTED', decided_at=?, artifact=? WHERE id=?`).run(Date.now(), file, id);
  emit("RSI_ADOPTED", { id, artifact: file });
  recordSpan("rsi.adopt", { "me2.id": id }, t0);
  return { ...r, status: "ADOPTED", decided_at: Date.now(), artifact: file, artifact_path: file };
}

export function rsiReject(id: string): RsiProposal {
  const t0 = Date.now();
  const r = decide(id, "REJECTED");
  emit("RSI_REJECTED", { id });
  recordSpan("rsi.reject", { "me2.id": id }, t0);
  return r;
}

export function rsiRollback(id: string): RsiProposal {
  const t0 = Date.now();
  const r = getProposal(id);
  if (r.status !== "ADOPTED") throw new Error(`invalid_state_${r.status}`);
  if (r.artifact && existsSync(r.artifact)) rmSync(r.artifact);
  const out = decide(id, "ROLLED_BACK");
  emit("RSI_ROLLED_BACK", { id });
  recordSpan("rsi.rollback", { "me2.id": id }, t0);
  return out;
}

export function rsiList() {
  const proposals = db.query(`SELECT * FROM rsi_proposals ORDER BY created_at DESC LIMIT 50`).all() as RsiProposal[];
  const stats = {
    total: proposals.length,
    proposed: proposals.filter((p) => p.status === "PROPOSED").length,
    adopted: proposals.filter((p) => p.status === "ADOPTED").length,
    rejected: proposals.filter((p) => p.status === "REJECTED").length,
    rolled_back: proposals.filter((p) => p.status === "ROLLED_BACK").length,
  };
  let artifacts = 0;
  try { if (existsSync(SKILLS_DIR)) artifacts = readdirSync(SKILLS_DIR).length; } catch { /* noop */ }
  return { ok: true, proposals, stats, artifacts_dir: "skills/rsi", artifacts };
}
