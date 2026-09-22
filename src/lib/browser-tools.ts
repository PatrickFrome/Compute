/**
 * browser-tools — geometry-independent browser control via the canonical
 * cloud command plane (h205f22_a2_browser_supervisor_issue_native_v1).
 *
 * Flow for every mutation: SELECT_TAB → wait for fresh perception push →
 * read state.perception.semantic_targets[] → SEMANTIC_TYPE / TYPED_CLICK /
 * PRESS_KEY with the semantic_ref. No pixel geometry anywhere.
 *
 * Parallelism: the supervisor scheduler accepts max_batch=64 with
 * read_concurrency=64 — batchIssue() fires many commands at once and then
 * collects receipts concurrently (per-tab TAB_MUTATION lanes run in parallel).
 *
 * Server-side ONLY (service_role JWT behind this module).
 */
import {
  cloudCommandReceipt,
  cloudIssueCommand,
  cloudLatestState,
  LIVE_BROWSER_CLIENT_ID,
} from "@/lib/cloud";

export interface SemanticTarget {
  name: string;
  role: string;
  disabled?: boolean;
  frame_id?: string;
  backend_node_id?: number;
  semantic_ref?: Record<string, unknown>;
  value_sha256?: string | null;
}

export interface Perception {
  url?: string;
  title?: string;
  tab_id?: string;
  text_excerpt?: string;
  semantic_targets?: SemanticTarget[];
  state_revision_id?: string;
  captured_at?: string;
  semantic_target_count?: number;
  [k: string]: unknown;
}

export interface TabInfo {
  tab_id: string;
  url: string;
  kind?: string;
  title?: string;
  selected?: boolean;
}

export interface FleetAgent {
  role: string;
  agent_id: string;
  tab_id: string;
  ownership?: string;
  lifecycle_state?: string;
  created_at?: string;
}

export interface SupervisorState {
  last_seen_at?: string;
  armed?: boolean;
  tabs?: TabInfo[];
  fleet?: { agents?: FleetAgent[]; [k: string]: unknown };
  perception?: Perception;
  active_tab?: TabInfo;
  supervisor_mode?: string;
  shell_version?: string;
  [k: string]: unknown;
}

export async function readSupervisorState(): Promise<SupervisorState | null> {
  const row = await cloudLatestState();
  if (!row) return null;
  return {
    last_seen_at: row.last_seen_at,
    ...(row.state as Record<string, unknown> | null),
  } as SupervisorState;
}

export interface IssueResult {
  ok: boolean;
  action: string;
  commandId: string;
  status: string;
  result: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  error?: string | null;
}

const TERMINAL = new Set(["COMPLETED", "EXPIRED", "FAILED"]);

/** Issue one command and wait (bounded) for its receipt. */
export async function issueCommand(opts: {
  action: string;
  payload: Record<string, unknown>;
  ttlSeconds?: number;
  issuedBy?: string;
  waitMs?: number;
  idempotencyKey?: string;
  platform?: string;
}): Promise<IssueResult> {
  const idempotencyKey =
    opts.idempotencyKey ??
    `mc-tools:${opts.action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const issued = await cloudIssueCommand({
    action: opts.action,
    payload: opts.payload,
    ttlSeconds: opts.ttlSeconds ?? 90,
    issuedBy: opts.issuedBy ?? "MISSION_CONTROL_CONSOLE",
    idempotencyKey,
    platform: opts.platform,
  });
  const commandId = String(issued.command_id ?? "");
  if (!commandId) {
    return { ok: false, action: opts.action, commandId: "", status: "NO_ID", result: null, receipt: null, error: "no_command_id" };
  }
  const deadline = Date.now() + (opts.waitMs ?? 20000);
  let rec = await cloudCommandReceipt(commandId);
  while (rec && !TERMINAL.has(rec.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    rec = await cloudCommandReceipt(commandId);
  }
  return {
    ok: rec?.status === "COMPLETED",
    action: opts.action,
    commandId,
    status: rec?.status ?? "PENDING",
    result: (rec?.receipt?.result ?? null) as Record<string, unknown> | null,
    receipt: rec?.receipt ?? null,
    error: rec?.receipt?.error ?? null,
  };
}

/** Fire many commands at once (scheduler max_batch=64), collect receipts in parallel. */
export async function batchIssue(
  commands: { action: string; payload: Record<string, unknown>; platform?: string }[],
  opts: { ttlSeconds?: number; issuedBy?: string; waitMs?: number } = {},
): Promise<IssueResult[]> {
  const issued = await Promise.all(
    commands.map((c) =>
      cloudIssueCommand({
        action: c.action,
        payload: c.payload,
        ttlSeconds: opts.ttlSeconds ?? 120,
        issuedBy: opts.issuedBy ?? "MISSION_CONTROL_CONSOLE",
        idempotencyKey: `mc-batch:${c.action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        platform: c.platform,
      }).catch((e) => ({ command_id: "", __error: String(e) })),
    ),
  );
  const ids = issued.map((i) => String(i.command_id ?? ""));
  const deadline = Date.now() + (opts.waitMs ?? 30000);
  const receipts = await Promise.all(
    ids.map(async (id) => {
      if (!id) return null;
      let rec = await cloudCommandReceipt(id);
      while (rec && !TERMINAL.has(rec.status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1100));
        rec = await cloudCommandReceipt(id);
      }
      return rec;
    }),
  );
  return issued.map((i, idx) => {
    const rec = receipts[idx];
    const err = (i as { __error?: string }).__error;
    return {
      ok: rec?.status === "COMPLETED",
      action: commands[idx].action,
      commandId: ids[idx],
      status: err ? "ISSUE_ERROR" : rec?.status ?? "PENDING",
      result: (rec?.receipt?.result ?? null) as Record<string, unknown> | null,
      receipt: rec?.receipt ?? null,
      error: err ?? rec?.receipt?.error ?? null,
    };
  });
}

/** SELECT_TAB and wait until the perception push refreshes for that tab. */
export async function selectTabAndWaitPerception(
  tabId: string,
  waitMs = 3500,
): Promise<Perception | null> {
  const sel = await issueCommand({ action: "SELECT_TAB", payload: { tab_id: tabId }, waitMs: 8000 });
  if (!sel.ok) return null;
  // perception push cadence ~1-2s; poll state for a fresh capture on the tab
  const deadline = Date.now() + waitMs;
  let latest: SupervisorState | null = null;
  let best: Perception | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    latest = await readSupervisorState();
    const p = latest?.perception;
    if (p && p.tab_id === tabId) {
      best = p;
      // fresh enough if captured after our select call
      if (p.captured_at && Date.now() - new Date(p.captured_at).getTime() < 12000) break;
    }
  }
  return best;
}

export function findSemanticTarget(
  perception: Perception | null,
  match: { name?: string | RegExp; role?: string },
): SemanticTarget | null {
  if (!perception?.semantic_targets) return null;
  for (const t of perception.semantic_targets) {
    if (t.disabled) continue;
    if (match.role && t.role !== match.role) continue;
    if (match.name) {
      const ok =
        typeof match.name === "string"
          ? t.name?.toLowerCase().includes(match.name.toLowerCase())
          : match.name.test(t.name ?? "");
      if (!ok) continue;
    }
    return t;
  }
  return null;
}

function semrefPayload(t: SemanticTarget, tabId: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    role: t.role,
    tab_id: tabId,
    semantic_ref: t.semantic_ref,
    accessible_name: t.name,
    ...extra,
  };
}

/**
 * CAPTURE the tab directly (READ_ONLY command) and return its semantic frame.
 * The realtime perception push only refreshes for the selected tab on a slow
 * cadence — freshly provisioned tabs never showed up in time, so all factory
 * addressing now goes through on-demand CAPTURE (same payload shape).
 */
export async function captureFrame(
  tabId: string,
  waitMs = 20000,
): Promise<{ url?: string; semantic_targets: SemanticTarget[] } | null> {
  const r = await issueCommand({ action: "CAPTURE", payload: { tab_id: tabId }, waitMs });
  const res = r.result as { url?: string; semantic_targets?: SemanticTarget[] } | null;
  if (!res?.semantic_targets?.length) return null;
  return { url: res.url, semantic_targets: res.semantic_targets };
}

/** SELECT_TAB, then resolve a semantic target by name/role from a fresh CAPTURE (perception push as fallback). */
async function selectTabAndFindTarget(
  tabId: string,
  match: { name?: string | RegExp; role?: string },
  waitMs = 3500,
): Promise<{ target: SemanticTarget | null; url?: string }> {
  const sel = await issueCommand({ action: "SELECT_TAB", payload: { tab_id: tabId }, waitMs: 12000 });
  if (!sel.ok) return { target: null };
  // the select lands fast; give the surface a beat to settle, then capture
  await new Promise((r) => setTimeout(r, Math.min(waitMs, 1500)));
  let frame = await captureFrame(tabId);
  let t = frame ? findSemanticTarget(frame as unknown as Perception, match) : null;
  // bounded retry — fresh tabs hydrate asynchronously
  for (let attempt = 0; attempt < 3 && (!t || t.disabled); attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    frame = await captureFrame(tabId);
    t = frame ? findSemanticTarget(frame as unknown as Perception, match) : null;
  }
  return { target: t ?? null, url: frame?.url };
}

/** Type text into a semantic target (finds it fresh, then SEMANTIC_TYPE). */
export async function typeInto(opts: {
  tabId: string;
  match: { name?: string | RegExp; role?: string };
  text: string;
  replaceExisting?: boolean;
  submitAfterType?: boolean;
  issuedBy?: string;
  platform?: string;
}): Promise<IssueResult & { perceptionUrl?: string }> {
  const { target: t, url } = await selectTabAndFindTarget(opts.tabId, opts.match);
  if (!t || !t.semantic_ref) {
    return { ok: false, action: "SEMANTIC_TYPE", commandId: "", status: "NO_TARGET", result: null, receipt: null, error: `target_not_found:${String(opts.match.name)}` };
  }
  const payload = semrefPayload(t, opts.tabId, {
    text: opts.text,
    replace_existing: opts.replaceExisting ?? true,
    submit_after_type: opts.submitAfterType ?? false,
  });
  const r = await issueCommand({
    action: "SEMANTIC_TYPE",
    payload,
    issuedBy: opts.issuedBy ?? "AGENT_FACTORY",
    waitMs: 20000,
    platform: opts.platform,
  });
  return { ...r, perceptionUrl: url };
}

/** Click a semantic target by accessible name/role (CAPTURE-addressed). */
export async function clickByName(opts: {
  tabId: string;
  match: { name?: string | RegExp; role?: string };
  issuedBy?: string;
}): Promise<IssueResult> {
  const { target: t } = await selectTabAndFindTarget(opts.tabId, opts.match);
  if (!t || !t.semantic_ref) {
    return { ok: false, action: "TYPED_CLICK", commandId: "", status: "NO_TARGET", result: null, receipt: null, error: `target_not_found:${String(opts.match.name)}` };
  }
  const payload = semrefPayload(t, opts.tabId, {});
  return issueCommand({ action: "TYPED_CLICK", payload, issuedBy: opts.issuedBy ?? "AGENT_FACTORY", waitMs: 16000 });
}

/** Read the visible transcript/text of a tab. */
export async function readTranscript(tabId: string, waitMs = 14000): Promise<IssueResult> {
  return issueCommand({ action: "READ_TRANSCRIPT", payload: { tab_id: tabId }, waitMs });
}

/** Trim the browser fleet to N agents (browser-side reconciliation). */
export async function fleetReconcile(targetAgents: number, retireAgentIds?: string[]): Promise<IssueResult> {
  const payload: Record<string, unknown> = { active: true, target_agents: targetAgents };
  if (retireAgentIds?.length) payload.retire_agent_ids = retireAgentIds;
  return issueCommand({ action: "FLEET_RECONCILE", payload, waitMs: 22000 });
}

/**
 * Close all tabs except the protected set. Parallel CLOSE_TAB batch.
 * Protected by default: the supervisor rollover tab + up to `keepAgentTabs` GLM_CHAT tabs.
 */
export async function closeExtraTabs(opts: {
  keepTabIds: string[];
  issuedBy?: string;
}): Promise<{ closed: number; results: IssueResult[] }> {
  const st = await readSupervisorState();
  const tabs = st?.tabs ?? [];
  const keep = new Set(opts.keepTabIds);
  const toClose = tabs.filter((t) => !keep.has(t.tab_id)).map((t) => t.tab_id);
  if (!toClose.length) return { closed: 0, results: [] };
  const results = await batchIssue(
    toClose.map((tab_id) => ({ action: "CLOSE_TAB", payload: { tab_id } })),
    { issuedBy: opts.issuedBy ?? "AGENT_FACTORY", waitMs: 25000 },
  );
  return { closed: results.filter((r) => r.ok).length, results };
}
