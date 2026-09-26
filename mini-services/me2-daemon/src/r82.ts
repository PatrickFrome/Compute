// R82 live supervisor diagnosis via the native command fastlane.
// READ-ONLY by design: CAPTURE probes only — never types, never navigates.
// The R82 live lesson: every insert into a poisoned root composer grows the
// shared account draft, so diagnosis must never mutate the surface it probes.
import { readFileSync, existsSync } from "node:fs";
import { OpError } from "./errors";
import { supervisorSnapshot, type SupervisorSnapshot } from "./controlplane";
import { VERSION } from "./version";

const SUPA_ENV = "/home/z/.a2/supabase-cloud.env";
const GH_ENV = "/home/z/.a2/.github.env";
export const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
export const ROOT_DRAFT_MAX_CHARS = 4000;

type Any = Record<string, any>;

function supaCreds(): { url: string; key: string } {
  if (!existsSync(SUPA_ENV)) throw new OpError("r82_secrets_missing", `${SUPA_ENV} not found`, 503);
  const txt = readFileSync(SUPA_ENV, "utf8");
  const url = /^SUPABASE_URL=(.+)$/m.exec(txt)?.[1]?.trim();
  const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(txt)?.[1]?.trim();
  if (!url || !key) throw new OpError("r82_secrets_invalid", "SUPABASE_URL/SERVICE_ROLE_KEY missing", 503);
  return { url, key };
}

async function supa(path: string, init?: RequestInit): Promise<Any> {
  const { url, key } = supaCreds();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as Any;
  if (!res.ok) {
    const code = body?.code ?? `http_${res.status}`;
    throw new OpError(`r82_${code}`, JSON.stringify(body).slice(0, 240), 502);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Command fastlane (issue_native_v1 → PENDING → LEASED → terminal + receipt)
// ---------------------------------------------------------------------------

async function issueCommand(action: string, payload: Any, ttlSeconds = 60): Promise<string> {
  const key = `r82-diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const out = (await supa("/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1", {
    method: "POST",
    body: JSON.stringify({
      p_client_id: CLIENT_ID,
      p_action: action,
      p_payload: payload,
      p_ttl_seconds: ttlSeconds,
      p_issued_by: "R82_SANDBOX_DIAGNOSIS",
      p_idempotency_key: key,
    }),
  })) as Any;
  if (!out?.command_id) {
    throw new OpError("r82_issue_failed", JSON.stringify(out).slice(0, 240), 502);
  }
  return String(out.command_id);
}

async function waitCommand(commandId: string, timeoutMs = 50_000): Promise<Any> {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new OpError("r82_command_timeout", `${commandId} not terminal`, 504);
    await new Promise((r) => setTimeout(r, 2500));
    const rows = (await supa(
      `/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.${commandId}&select=status,error,receipt`
    )) as Any[];
    const row = rows?.[0];
    if (!row) continue;
    if (row.status !== "PENDING" && row.status !== "LEASED") {
      if (row.status === "FAILED") {
        throw new OpError("r82_command_failed", String(row.error ?? "unknown"), 502);
      }
      return (row.receipt ?? {}) as Any;
    }
  }
}

export async function captureTab(tabId: string): Promise<Any> {
  const receipt = await waitCommand(await issueCommand("CAPTURE", { tab_id: tabId }));
  return (receipt.result ?? {}) as Any;
}

// ---------------------------------------------------------------------------
// R82-EXIT: lightweight READ-ONLY draft probe for the periodic readback
// sampler. Reuses the command fastlane (CAPTURE only — never types, never
// navigates; R82 lesson: diagnosis must never mutate the observed surface).
// ---------------------------------------------------------------------------

export interface DraftProbe {
  ts: string;
  tab_id: string | null;
  url: string | null;
  chars: number | null;
  canary: "OVERSIZED" | "OK" | "NO_COMPOSER" | "NO_TAB" | "UNKNOWN";
  error?: string;
}

export async function probeDraft(): Promise<DraftProbe> {
  const out: DraftProbe = {
    ts: new Date().toISOString(),
    tab_id: null,
    url: null,
    chars: null,
    canary: "UNKNOWN",
  };
  try {
    const rows = (await supa(
      "/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&order=last_seen_at.desc&limit=1"
    )) as Any[];
    const keepalive = rows?.[0]?.state?.supervisor_lifecycle?.keepalive ?? {};
    const attempt = keepalive.rollover_attempt ?? null;
    out.tab_id = attempt?.tab_id ? String(attempt.tab_id) : null;
    if (!out.tab_id) {
      out.canary = "NO_TAB";
      return out;
    }
    const frame = await captureTab(out.tab_id);
    out.url = frame?.url ? String(frame.url) : "";
    const composer = (frame?.semantic_targets ?? []).find((t: Any) => t?.role === "textbox");
    if (composer && Number.isFinite(Number(composer?.value_length))) {
      out.chars = Number(composer.value_length);
      out.canary = out.chars > ROOT_DRAFT_MAX_CHARS ? "OVERSIZED" : "OK";
    } else {
      out.canary = out.url === "" ? "UNKNOWN" : "NO_COMPOSER";
    }
  } catch (e) {
    out.error = String((e as Error)?.message ?? e).slice(0, 160);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export interface AttemptTabProbe {
  tab_id: string | null;
  probed: boolean;
  blank: boolean;
  url: string | null;
  element_count: number | null;
  composer_value_length: number | null;
  draft_canary: "OVERSIZED" | "OK" | "NO_COMPOSER" | "UNKNOWN";
  error?: string;
}

export interface R82FixPr {
  number: number;
  url: string;
  state: string;
  head_sha: string;
  ci: { success: number; failed: number; cancelled: number; pending: number; total: number };
}

export interface R82Diagnosis {
  ok: true;
  schema: "metaengine.r82.diagnosis.v1";
  fetched_at: string;
  daemon_version: string;
  supervisor: SupervisorSnapshot;
  attempt: Any | null;
  attempt_tab_probe: AttemptTabProbe;
  attempt_history_tail: Any[];
  root_cause_chain: string[];
  operator_action: string;
  fix: { pr: R82FixPr | null; branch: string };
}

async function fetchFixPr(): Promise<R82FixPr | null> {
  if (!existsSync(GH_ENV)) return null;
  const token = /^GITHUB_TOKEN_ADMIN=(.+)$/m.exec(readFileSync(GH_ENV, "utf8"))?.[1]?.trim();
  if (!token) return null;
  const res = await fetch("https://api.github.com/repos/PatrickFrome/Compute/pulls/981", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const pr = (await res.json()) as Any;
  const headSha = String(pr?.head?.sha ?? "");
  let ci = { success: 0, failed: 0, cancelled: 0, pending: 0, total: 0 };
  if (headSha) {
    const runs = await fetch(
      `https://api.github.com/repos/PatrickFrome/Compute/actions/runs?head_sha=${headSha}&per_page=50`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(12_000) }
    );
    if (runs.ok) {
      const list = ((await runs.json()) as Any)?.workflow_runs ?? [];
      for (const r of list) {
        ci.total += 1;
        if (r.status !== "completed") ci.pending += 1;
        else if (r.conclusion === "success") ci.success += 1;
        else if (r.conclusion === "cancelled") ci.cancelled += 1;
        else ci.failed += 1;
      }
    }
  }
  return {
    number: 981,
    url: String(pr?.html_url ?? "https://github.com/PatrickFrome/Compute/pull/981"),
    state: String(pr?.state ?? "UNKNOWN"),
    head_sha: headSha.slice(0, 12),
    ci,
  };
}

let cache: { at: number; data: R82Diagnosis } | null = null;
const CACHE_TTL_MS = 30_000;

export async function r82Diagnosis(fresh = false): Promise<R82Diagnosis> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const supervisor = await supervisorSnapshot(true);
  // Read the FULL keepalive row (attempt + history) straight from the state
  // table — the curated snapshot intentionally curates these away.
  const rows = (await supa(
    "/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&order=last_seen_at.desc&limit=1"
  )) as Any[];
  const keepalive = rows?.[0]?.state?.supervisor_lifecycle?.keepalive ?? {};
  const attempt = keepalive.rollover_attempt ?? null;
  const history: Any[] = Array.isArray(keepalive.ambiguous_history) ? keepalive.ambiguous_history : [];

  const probe: AttemptTabProbe = {
    tab_id: attempt?.tab_id ? String(attempt.tab_id) : null,
    probed: false,
    blank: false,
    url: null,
    element_count: null,
    composer_value_length: null,
    draft_canary: "UNKNOWN",
  };
  if (probe.tab_id) {
    try {
      const frame = await captureTab(probe.tab_id);
      probe.probed = true;
      probe.url = frame?.url ? String(frame.url) : "";
      probe.element_count = Number(
        frame?.interaction_tree?.element_count ?? (frame?.interaction_tree?.elements ?? []).length ?? 0
      );
      probe.blank = probe.url === "" && probe.element_count === 0;
      const composer = (frame?.semantic_targets ?? []).find((t: Any) => t?.role === "textbox");
      if (composer && Number.isFinite(Number(composer?.value_length))) {
        probe.composer_value_length = Number(composer.value_length);
        probe.draft_canary =
          probe.composer_value_length > ROOT_DRAFT_MAX_CHARS ? "OVERSIZED" : "OK";
      } else {
        probe.draft_canary = probe.blank ? "UNKNOWN" : "NO_COMPOSER";
      }
    } catch (e) {
      probe.error = String((e as Error)?.message ?? e).slice(0, 160);
    }
  }

  const fixPr = await fetchFixPr().catch(() => null);

  const diagnosis: R82Diagnosis = {
    ok: true,
    schema: "metaengine.r82.diagnosis.v1",
    fetched_at: new Date().toISOString(),
    daemon_version: VERSION,
    supervisor,
    attempt: attempt
      ? {
          attempt_id: attempt.attempt_id ?? null,
          started_at: attempt.started_at ?? null,
          ambiguous_at: attempt.ambiguous_at ?? null,
          ambiguous_reason: attempt.ambiguous_reason ?? null,
          tab_id: attempt.tab_id ?? null,
          supervisor_epoch: attempt.supervisor_epoch ?? null,
        }
      : null,
    attempt_tab_probe: probe,
    attempt_history_tail: history.slice(-8).map((h: Any) => ({
      cycle_seq: h.cycle_seq ?? null,
      ambiguous_reason: h.ambiguous_reason ?? null,
      ambiguous_at: h.ambiguous_at ?? null,
      retired_reason: h.retired_reason ?? null,
    })),
    root_cause_chain: [
      "1. Bound conversation e1ec5063 is length-capped → composer is GONE → rollover requested (2026-09-24 22:35Z).",
      "2. Every rollover opens a fresh root tab; chat.z.ai restores an account-synced draft (28,708+ chars since 2026-09-19).",
      "3. Root composer ignores synthetic editing keys → replace stays unverified (live-probe 2026-09-26).",
      "4. Enter silently refuses oversized prompts on the root surface (live-probe: AMBIGUOUS_AFTER_ENTER).",
      "5. The site's 'New Chat' button preserves the poisoned draft (live-probe: click COMPLETED, draft unchanged).",
      "6. Every seed append GROWS the shared draft (+202 chars live-observed between probes 4 min apart).",
      "7. Some rollover NEW_TABs never commit navigation (blank url:'' 0 DOM — zombie webcontents, live: :68).",
      "8. D-C7 close-by-proof cannot retire blank tabs (no URL to prove) → zombie accumulation.",
      "9. Atomic-save rename race (un-awaited requestRollover save vs next cycle save) can abort cycles pre-dispatch.",
    ],
    operator_action:
      "Open chat.z.ai on the live host, focus the new-chat composer, Ctrl+A + Delete once. Synthetic clearing is provably impossible (keys ignored / Enter refused / New Chat preserves). After the manual clear, the existing rollover retry loop converges on its own; with PR #981 the runtime additionally reports ROOT_DRAFT_OVERSIZED instead of looping, closes blank tabs and never grows the draft.",
    fix: { pr: fixPr, branch: "work/r82-supervisor-rollover-draft-hardening-v1" },
  };
  cache = { at: Date.now(), data: diagnosis };
  return diagnosis;
}
