/**
 * Фаза зачистки №2: retire всех агентов + последовательное закрытие вкладок (кроме keepalive).
 * Бюджет супервизора: не более 2-3 команд в очередь, пауза 3s.
 * Запуск: bun run purge-phase2.ts
 */
const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(
  envRaw.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    let k = l.slice(0, i).trim();
    if (k.startsWith("export ")) k = k.slice(7).trim();
    return [k, l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }),
);
const URL = env.SUPABASE_URL;
const JWT = env.SUPABASE_SERVICE_ROLE_JWT;
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const H = { apikey: JWT, Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" } as const;
const STATE_TBL = "compute_fabric_a2_browser_supervisor_state_h205f22";
const CMD_TBL = "compute_fabric_a2_browser_supervisor_command_h205f22";
const KEEPALIVE_TAB = "tab_455dec21-fd38-4bac-827b-c0ec0fdda276";

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function getState() {
  const r = await fetch(`${URL}/rest/v1/${STATE_TBL}?client_id=eq.${CLIENT_ID}&select=state,last_seen_at`, { headers: H });
  const rows = (await r.json()) as Array<{ state: Record<string, unknown> }>;
  return rows[0]?.state ?? null;
}
function tabsOf(st: Record<string, unknown> | null): Array<{ tab_id: string; url: string }> {
  const t = (st?.tabs ?? []) as Array<{ tab_id: string; url: string }>;
  return Array.isArray(t) ? t : [];
}
function agentsOf(st: Record<string, unknown> | null): string[] {
  const a = ((st?.fleet as Record<string, unknown>)?.agents ?? []) as Array<{ agent_id?: string; agentId?: string; lifecycle_state?: string; lifecycleState?: string }>;
  return a
    .filter((x) => {
      const s = String(x.lifecycle_state ?? x.lifecycleState ?? "");
      return s !== "LOST";
    })
    .map((x) => String(x.agent_id ?? x.agentId ?? ""))
    .filter(Boolean);
}

async function issue(action: string, payload: Record<string, unknown>, ttl = 90): Promise<string> {
  const idem = `purge2:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`${URL}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      p_client_id: CLIENT_ID, p_action: action, p_payload: payload, p_ttl_seconds: ttl,
      p_issued_by: "AGENT_FACTORY_PURGE", p_idempotency_key: idem,
    }),
  });
  if (!r.ok) throw new Error(`issue ${action}: ${r.status} ${(await r.text()).slice(0, 150)}`);
  const j = JSON.parse(await r.text()) as { command_id?: string } | Array<{ command_id?: string }>;
  const row = Array.isArray(j) ? j[0] : j;
  return String(row?.command_id ?? "");
}

async function waitTerminal(commandId: string, deadlineMs = 40000): Promise<{ status: string; error: unknown }> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const r2 = await fetch(`${URL}/rest/v1/${CMD_TBL}?command_id=eq.${commandId}&select=status,error`, { headers: H });
    const rows = (await r2.json()) as Array<{ status: string; error: unknown }>;
    const row = rows[0];
    if (row && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED", "REJECTED"].includes(row.status)) {
      return { status: row.status, error: row.error };
    }
  }
  return { status: "TIMEOUT", error: null };
}

const st = await getState();
const tabs = tabsOf(st);
const live = agentsOf(st);
log(`state: ${tabs.length} tabs, ${live.length} live agents`);

// 1. Retire всех живых агентов (не LOST)
if (live.length) {
  log(`FLEET_RECONCILE(0, retire ${live.length}: ${live.map((a) => a.slice(6, 14)).join(",")})`);
  const cid = await issue("FLEET_RECONCILE", { active: true, target_agents: 0, retire_agent_ids: live }, 120);
  const res = await waitTerminal(cid, 60000);
  log(`  reconcile → ${res.status}`);
} else {
  log("no live agents");
}

// 2. Последовательное закрытие вкладок кроме keepalive
const toClose = tabs.filter((t) => t.tab_id !== KEEPALIVE_TAB);
log(`closing ${toClose.length} tabs sequentially...`);
for (const t of toClose) {
  try {
    const cid = await issue("CLOSE_TAB", { tab_id: t.tab_id }, 60);
    const res = await waitTerminal(cid, 25000);
    log(`  ${t.tab_id.slice(0, 16)} ${t.url.slice(0, 46)} → ${res.status}${res.error ? ` (${String(res.error).slice(0, 60)})` : ""}`);
  } catch (e) {
    log(`  ${t.tab_id.slice(0, 16)} issue failed: ${String(e).slice(0, 80)}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

// 3. Итог
await new Promise((r) => setTimeout(r, 4000));
const st2 = await getState();
const left = tabsOf(st2);
log(`tabs left: ${left.length} → ${left.map((t) => t.tab_id.slice(0, 16)).join(", ")}`);
log(`live agents left: ${agentsOf(st2).length}`);
