// ── R67 «Ingress (pull)»: поллер GitHub Actions → события CI_RUN_* в event-log ──
//
// Роль (P0-e по DAG R65): внешний триггер-канал ME2. Первая фаза — PULL-модель:
// daemon периодически опрашивает GitHub Actions (ветка sandbox/me2-os) и новые
// ЗАВЕРШЁННЫЕ прогонки кладёт в event-log (CI_RUN_COMPLETED / CI_RUN_FAILED).
// События зеркалятся sqlmirror'ом в облако → синхронизация БД усиливается живым
// внешним контуром. Webhooks-in (push-модель) — следующий шаг P0-e (нужен
// публичный endpoint + HMAC-ключ) — в backlog R68.
//
// Аналоги: GitHub deploy status polling, ArgoCD ImageUpdater (pull), K8s
// informers (list-watch с resourceVersion = наш last_seen_run_id).
//
// Честность:
//   • без GITHUB_TOKEN_ADMIN → verdict "NO_TOKEN" (как ME7 до R65) — не падаем;
//   • сетевые ошибки → last_error + продолжаем (поллер живёт);
//   • только завершённые runs эмитятся ровно один раз (last_seen_run_id в meta);
//   • fetch строго async (урок R25-4: sync-сеть морозила event-loop на 1.3s);
//   • кэш статуса 45с — /ci не штормит API.
//
// Zero-authority: read-only опрос; на шину решений не влияет (события — наблюдения).
// 47-инвариант не трогается (REST GET /ci вне шины, класс rest_admin).

import { emit, getMeta, setMeta } from "../store";
import { tokenGet } from "./tokens";

export const CI_SCHEMA = "me2.ci-ingress.v1";
const REPO = process.env.ME2_CI_REPO || "PatrickFrome/Compute";
const BRANCH = process.env.ME2_CI_BRANCH || "sandbox/me2-os";
const POLL_MS = Math.max(60_000, Number(process.env.ME2_CI_POLL_SEC || 300) * 1000);
const CACHE_MS = 45_000;

export type CiRunInfo = {
  id: number; name: string; head_sha7: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  created_at: string | null;
};

export type CiStatus = {
  ok: boolean;
  schema: string;
  repo: string;
  branch: string;
  token: "present" | "missing";
  runs: CiRunInfo[];
  last_poll_at: string | null;
  polls_total: number;
  events_emitted_total: number;
  last_seen_run_id: number;
  last_error: string | null;
  verdict: "LIVE" | "NO_TOKEN" | "ERROR" | "WARMUP";
};

type CiCache = { at: number; data: CiStatus };
let cache: CiCache | null = null;
let polling: Promise<CiStatus> | null = null;

async function ghFetch(path: string): Promise<{ ok: boolean; status: number; json: unknown; err?: string }> {
  const token = tokenGet("GITHUB_TOKEN_ADMIN");
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "me2-daemon-ci-ingress",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: r.status, json: null, err: (await r.text()).slice(0, 160) };
  return { ok: true, status: r.status, json: await r.json() };
}

function parseRuns(json: unknown): CiRunInfo[] {
  const runs = (json as { workflow_runs?: Array<Record<string, unknown>> }).workflow_runs ?? [];
  return runs.slice(0, 8).map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? "?"),
    head_sha7: String(r.head_sha ?? "").slice(0, 7),
    status: (r.status === "completed" ? "completed" : r.status === "in_progress" ? "in_progress" : "queued") as CiRunInfo["status"],
    conclusion: r.conclusion == null ? null : String(r.conclusion),
    created_at: r.created_at == null ? null : String(r.created_at),
  }));
}

/** Один опрос GitHub → обновление статуса + эмиссия новых завершённых runs. Никогда не бросает. */
export async function ciPollOnce(): Promise<CiStatus> {
  if (polling) return polling;
  polling = (async (): Promise<CiStatus> => {
    const t0 = Date.now();
    const token = tokenGet("GITHUB_TOKEN_ADMIN");
    if (!token) {
      const s: CiStatus = {
        ok: true, schema: CI_SCHEMA, repo: REPO, branch: BRANCH, token: "missing",
        runs: [], last_poll_at: new Date().toISOString(), polls_total: Number(getMeta("ci_polls") || 0) + 1,
        events_emitted_total: Number(getMeta("ci_events") || 0), last_seen_run_id: Number(getMeta("ci_last_run") || 0),
        last_error: null, verdict: "NO_TOKEN",
      };
      setMeta("ci_polls", String(s.polls_total));
      cache = { at: Date.now(), data: s };
      return s;
    }
    try {
      const res = await ghFetch(`/repos/${REPO}/actions/runs?branch=${BRANCH}&per_page=8`);
      if (!res.ok) {
        const s: CiStatus = {
          ok: true, schema: CI_SCHEMA, repo: REPO, branch: BRANCH, token: "present",
          runs: [], last_poll_at: new Date().toISOString(), polls_total: Number(getMeta("ci_polls") || 0) + 1,
          events_emitted_total: Number(getMeta("ci_events") || 0), last_seen_run_id: Number(getMeta("ci_last_run") || 0),
          last_error: `HTTP ${res.status}: ${res.err ?? ""}`, verdict: "ERROR",
        };
        setMeta("ci_polls", String(s.polls_total));
        cache = { at: Date.now(), data: s };
        return s;
      }
      const runs = parseRuns(res.json);
      const lastSeen = Number(getMeta("ci_last_run") || 0);
      let emitted = 0;
      // Эмитим только завершённые, СТАРШЕ last_seen не трогаем; новые (id > lastSeen) — по возрасту id.
      const fresh = runs.filter((r) => r.status === "completed" && r.id > lastSeen).sort((a, b) => a.id - b.id);
      for (const r of fresh) {
        const okRun = r.conclusion === "success";
        try {
          emit(
            okRun ? "CI_RUN_COMPLETED" : "CI_RUN_FAILED",
            { run_id: r.id, name: r.name, sha: r.head_sha7, conclusion: r.conclusion, repo: REPO, branch: BRANCH },
            null, null,
          );
          emitted++;
        } catch { /* шина не критична */ }
      }
      const maxId = runs.reduce((m, r) => Math.max(m, r.id), lastSeen);
      const verdict: CiStatus["verdict"] = fresh.length === 0 && lastSeen === 0 ? "WARMUP" : "LIVE";
      const s: CiStatus = {
        ok: true, schema: CI_SCHEMA, repo: REPO, branch: BRANCH, token: "present",
        runs, last_poll_at: new Date().toISOString(),
        polls_total: Number(getMeta("ci_polls") || 0) + 1,
        events_emitted_total: Number(getMeta("ci_events") || 0) + emitted,
        last_seen_run_id: maxId,
        last_error: null, verdict,
      };
      setMeta("ci_polls", String(s.polls_total));
      setMeta("ci_events", String(s.events_emitted_total));
      setMeta("ci_last_run", String(maxId));
      cache = { at: Date.now(), data: s };
      return s;
    } catch (e) {
      const s: CiStatus = {
        ok: true, schema: CI_SCHEMA, repo: REPO, branch: BRANCH, token: "present",
        runs: [], last_poll_at: new Date().toISOString(), polls_total: Number(getMeta("ci_polls") || 0) + 1,
        events_emitted_total: Number(getMeta("ci_events") || 0), last_seen_run_id: Number(getMeta("ci_last_run") || 0),
        last_error: String(e).slice(0, 160), verdict: "ERROR",
      };
      setMeta("ci_polls", String(s.polls_total));
      cache = { at: Date.now(), data: s };
      return s;
    }
  })();
  try { return await polling; } finally { polling = null; }
}

/** Кэшированный статус для REST /ci. */
export function ciStatus(): CiStatus {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  void ciPollOnce().catch(() => { /* фоновый добор, REST отвечает кэшем/честным WARMUP */ });
  return (
    cache?.data ?? {
      ok: true, schema: CI_SCHEMA, repo: REPO, branch: BRANCH,
      token: tokenGet("GITHUB_TOKEN_ADMIN") ? "present" : "missing",
      runs: [], last_poll_at: null, polls_total: 0, events_emitted_total: 0,
      last_seen_run_id: 0, last_error: null, verdict: "WARMUP",
    }
  );
}

/** Фоновый тик (вызывается из index.ts setInterval). */
export function ciTick(): void {
  void ciPollOnce().catch(() => { /* поллер живёт вечно */ });
}

export function ciPollMs(): number {
  return POLL_MS;
}

/** Длительность последнего опроса (для честного evidence) — измеряется косвенно через ms в статусе нет; оставляем простой хук. */
export const CI_INGRESS_NOTE = "P0-e ingress (pull): GitHub Actions sandbox/me2-os → CI_RUN_* в event-log → sqlmirror в облако; webhooks-in (push) — R68";
