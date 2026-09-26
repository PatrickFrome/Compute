// R81-PHASE1: read-only GitHub client for the release-convergence line.
// Protocol invariants honoured:
//  - token lives ONLY in /home/z/.a2/.github.env (perms 600); never in tree,
//    never in responses (surface only token_present + rate budget)
//  - strictly read-only surface (pulls / branches / check-runs) — the sandbox
//    never mutates the Browser repo through this client
//  - TTL cache 30s + single-flight + fresh=1 bypass; machine-coded errors
import { readFileSync } from "node:fs";
import { OpError } from "./errors";

const API = "https://api.github.com";
const REPO = "PatrickFrome/Compute";
export const CONVERGENCE_BRANCH = "work/r81-browser-release-convergence-v1";
export const CONVERGENCE_PR = 968;
const TOKEN_FILE = "/home/z/.a2/.github.env";
const TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface ConvCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ConvergenceSnapshot {
  fetched_at: string;
  repository: string;
  branch: string;
  head: { sha: string; short: string; message: string; committed_at: string } | null;
  pr: {
    number: number;
    state: string;
    draft: boolean;
    mergeable: boolean | null;
    mergeable_state: string;
    title: string;
    updated_at: string;
  } | null;
  checks: {
    total: number;
    success: number;
    failed: number;
    cancelled: number;
    skipped: number;
    pending: number;
    in_progress: number;
    items: ConvCheck[];
  };
  rollup_state: "GREEN" | "RED" | "PENDING" | "UNKNOWN";
  api: { token_present: boolean; rate_remaining: number | null };
}

function githubToken(): string | null {
  try {
    const raw = readFileSync(TOKEN_FILE, "utf8");
    const m = raw.match(/^GITHUB_TOKEN_ADMIN=([^\s]+)$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// R82-EXIT: exported for the readback watch (release-branch CI rollup) — the
// daemon's single GitHub read path (token stays server-side, machine-coded errors).
export async function ghGet<T>(path: string): Promise<{ data: T; rateRemaining: number | null }> {
  const token = githubToken();
  if (!token) throw new OpError("github_no_token", "/home/z/.a2/.github.env: GITHUB_TOKEN_ADMIN отсутствует", 503);
  return gh<T>(path, token);
}

async function gh<T>(path: string, token: string): Promise<{ data: T; rateRemaining: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "me2-daemon-r81-phase1",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OpError("github_unreachable", String((e as Error)?.message ?? e).slice(0, 200), 504);
  }
  const rateRaw = res.headers.get("x-ratelimit-remaining");
  const rateRemaining = rateRaw == null ? null : Number(rateRaw);
  if (res.status === 401 || res.status === 403) {
    if (rateRemaining === 0) throw new OpError("github_rate_limited", "GitHub API rate budget exhausted", 503);
    throw new OpError("github_forbidden", `GitHub API ${res.status} (token scope?)`, 502);
  }
  if (res.status === 404) throw new OpError("github_not_found", `GitHub API 404: ${path}`, 502);
  if (!res.ok) throw new OpError("github_api_error", `GitHub API ${res.status} on ${path}`, 502);
  return { data: (await res.json()) as T, rateRemaining };
}

let cache: { snap: ConvergenceSnapshot; at: number } | null = null;
let inflight: Promise<ConvergenceSnapshot> | null = null;

export async function convergenceStatus(fresh = false): Promise<ConvergenceSnapshot> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.snap;
  if (!fresh && inflight) return inflight;

  const job = (async (): Promise<ConvergenceSnapshot> => {
    const token = githubToken();
    if (!token) throw new OpError("github_no_token", "/home/z/.a2/.github.env: GITHUB_TOKEN_ADMIN отсутствует", 503);

    // 1) PR #968 (draft convergence PR)
    // QA-фикс (R82-HARDEN): gh() возвращает { data, rateRemaining } — PR-поля
    // читаются из prReq.data (ранее prReq.state → все поля пустые строки, карточка
    // R81 показывала «mergeable —» при живом PR)
    const prReq = await gh<Record<string, unknown>>(`/repos/${REPO}/pulls/${CONVERGENCE_PR}`, token).catch((e: unknown) => {
      if (e instanceof OpError && e.code === "github_not_found") return null;
      throw e;
    });
    const prData = prReq ? (prReq.data as Record<string, unknown>) : null;
    const pr = prData
      ? {
          number: CONVERGENCE_PR,
          state: String(prData.state ?? ""),
          draft: prData.draft === true,
          mergeable: typeof prData.mergeable === "boolean" ? (prData.mergeable as boolean) : null,
          mergeable_state: String(prData.mergeable_state ?? ""),
          title: String(prData.title ?? ""),
          updated_at: String(prData.updated_at ?? ""),
        }
      : null;

    // 2) branch head
    const br = await gh<{
      commit?: { sha?: string; commit?: { message?: string; committer?: { date?: string } } };
    }>(`/repos/${REPO}/branches/${encodeURIComponent(CONVERGENCE_BRANCH)}`, token);
    const head = br.data.commit
      ? {
          sha: String(br.data.commit.sha ?? ""),
          short: String(br.data.commit.sha ?? "").slice(0, 10),
          message: (String(br.data.commit.commit?.message ?? "").split("\n")[0] ?? "").slice(0, 140),
          committed_at: String(br.data.commit.commit?.committer?.date ?? ""),
        }
      : null;

    // 3) check-run rollup for the head sha
    let checks: ConvergenceSnapshot["checks"] = {
      total: 0, success: 0, failed: 0, cancelled: 0, skipped: 0, pending: 0, in_progress: 0, items: [],
    };
    let rateRemaining: number | null = br.rateRemaining;
    if (head?.sha) {
      const cr = await gh<{
        total_count?: number;
        check_runs?: { name?: string; status?: string; conclusion?: string | null }[];
      }>(`/repos/${REPO}/commits/${head.sha}/check-runs?per_page=100`, token);
      rateRemaining = cr.rateRemaining;
      const items: ConvCheck[] = (cr.data.check_runs ?? []).map((r) => ({
        name: String(r.name ?? ""),
        status: String(r.status ?? ""),
        conclusion: r.conclusion == null ? null : String(r.conclusion),
      }));
      const c = { total: items.length, success: 0, failed: 0, cancelled: 0, skipped: 0, pending: 0, in_progress: 0, items };
      for (const it of items) {
        if (it.status !== "completed") {
          c.pending++;
          if (it.status === "in_progress") c.in_progress++;
        } else if (it.conclusion === "success") c.success++;
        else if (it.conclusion === "failure" || it.conclusion === "timed_out" || it.conclusion === "action_required") c.failed++;
        else if (it.conclusion === "cancelled") c.cancelled++;
        else c.skipped++;
      }
      checks = c;
    }

    // rollup: honest — cancelled checks need a re-run, so they are NOT green
    const rollup: ConvergenceSnapshot["rollup_state"] =
      checks.total === 0
        ? "UNKNOWN"
        : checks.failed > 0
          ? "RED"
          : checks.pending > 0 || checks.cancelled > 0
            ? "PENDING"
            : "GREEN";

    const snap: ConvergenceSnapshot = {
      fetched_at: new Date().toISOString(),
      repository: REPO,
      branch: CONVERGENCE_BRANCH,
      head,
      pr,
      checks,
      rollup_state: rollup,
      api: { token_present: true, rate_remaining: rateRemaining },
    };
    cache = { snap, at: Date.now() };
    return snap;
  })();

  inflight = job;
  try {
    return await job;
  } finally {
    inflight = null;
  }
}
