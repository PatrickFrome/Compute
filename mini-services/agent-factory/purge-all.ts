/**
 * PURGE-ALL: полностью чистая среда.
 * Фаза A (браузер): FLEET_RECONCILE(0) + CLOSE_TAB всех вкладок кроме keepalive-корня супервизора.
 * Фаза B (БД): DELETE всех задач/команд/биндингов/leases/курсоров/peers из облачного Supabase.
 * Порядок важен: сначала браузер (команды должны дойти до таблицы и отработать), затем стирание таблиц.
 *
 * Запуск: bun run purge-all.ts [--keep-tabs]   (без флагов — оба этапа)
 */
const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
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
const args = process.argv.slice(2);
const doBrowser = args.includes("--keep-tabs") ? false : true;
const doDb = args.includes("--keep-tabs") ? true : true; // db always unless --no-db
const skipDb = args.includes("--no-db");
const skipBrowser = args.includes("--no-browser");

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function getSupervisorState(): Promise<{ state: Record<string, unknown>; last_seen_at: string } | null> {
  const r = await fetch(`${URL}/rest/v1/${STATE_TBL}?client_id=eq.${CLIENT_ID}&select=state,last_seen_at`, { headers: H });
  const rows = (await r.json()) as Array<{ state: Record<string, unknown>; last_seen_at: string }>;
  return rows[0] ?? null;
}

type Tab = { tab_id: string; url: string; title?: string };
function tabsOf(st: Record<string, unknown> | null | undefined): Tab[] {
  const raw = (st?.tabs ?? []) as Tab[];
  return Array.isArray(raw) ? raw : [];
}
function fleetAgentIds(st: Record<string, unknown> | null | undefined): string[] {
  const agents = ((st?.fleet as Record<string, unknown>)?.agents ?? []) as Array<{ agent_id?: string; agentId?: string }>;
  return agents.map((a) => String(a.agent_id ?? a.agentId ?? "")).filter(Boolean);
}

/** issue native command via cloud RPC */
async function issue(action: string, payload: Record<string, unknown>, ttl = 90): Promise<string> {
  const idem = `purge:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`${URL}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      p_client_id: CLIENT_ID,
      p_action: action,
      p_payload: payload,
      p_ttl_seconds: ttl,
      p_issued_by: "AGENT_FACTORY_PURGE",
      p_idempotency_key: idem,
    }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`issue ${action}: ${r.status} ${t.slice(0, 200)}`);
  const j = JSON.parse(t) as { command_id?: string } | Array<{ command_id?: string }>;
  const row = Array.isArray(j) ? j[0] : j;
  return String(row?.command_id ?? "");
}

async function waitTerminal(commandId: string, deadlineMs = 30000): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(`${URL}/rest/v1/${CMD_TBL}?command_id=eq.${commandId}&select=status`, { headers: H });
    const rows = (await r2.json()) as Array<{ status: string }>;
    const s = rows[0]?.status;
    if (s && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED", "REJECTED"].includes(s)) return s;
  }
  return "TIMEOUT";
}

async function countRows(table: string, keyCol: string): Promise<number> {
  const r = await fetch(`${URL}/rest/v1/${table}?select=${keyCol}&limit=1`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = r.headers.get("content-range") ?? "";
  const m = cr.match(/\/(\d+)/);
  return m ? Number(m[1]) : -1;
}

/** DELETE всех строк таблицы (фильтр not.is.null по ключу). Возвращает остаток. */
async function deleteAll(table: string, keyCol: string): Promise<{ before: number; after: number; status: number }> {
  const before = await countRows(table, keyCol);
  const r = await fetch(`${URL}/rest/v1/${table}?${keyCol}=not.is.null`, {
    method: "DELETE",
    headers: H,
  });
  const after = r.ok ? await countRows(table, keyCol) : -1;
  return { before, after, status: r.status };
}

// ─────────────────────────────────────────────────────────────
async function main() {
  const st0 = await getSupervisorState();
  if (!st0) throw new Error("supervisor state row not found");
  const lc = (st0.state.supervisor_lifecycle ?? {}) as Record<string, unknown>;
  const ka = (lc.keepalive ?? {}) as Record<string, unknown>;
  const keepTabId = String(ka.tab_id ?? "");
  const keepUrl = String(ka.conversation_url ?? "");
  const tabs = tabsOf(st0.state);
  const agents = fleetAgentIds(st0.state);
  log(`state: ${tabs.length} tabs, ${agents.length} fleet agents, keepalive tab=${keepTabId} (${keepUrl})`);

  // ── Фаза A: браузер ──────────────────────────────────────
  if (doBrowser && !skipBrowser) {
    // A1. FLEET_RECONCILE(0) — распустить всех агентов
    if (agents.length > 0) {
      log(`FLEET_RECONCILE(target=0, retire ${agents.length})...`);
      const cid = await issue("FLEET_RECONCILE", { active: true, target_agents: 0, retire_agent_ids: agents }, 120);
      const s = await waitTerminal(cid, 45000);
      log(`  reconcile ${cid.slice(0, 8)} → ${s}`);
    } else {
      log("fleet already empty, skip reconcile");
    }

    // A2. CLOSE_TAB всех вкладок кроме keepalive-корня
    const toClose = tabs.filter((t) => t.tab_id !== keepTabId);
    log(`closing ${toClose.length} tabs (keep: ${keepTabId})...`);
    const closeIds: string[] = [];
    for (const t of toClose) {
      try {
        closeIds.push(await issue("CLOSE_TAB", { tab_id: t.tab_id }, 90));
      } catch (e) {
        log(`  issue CLOSE_TAB ${t.tab_id}: ${e}`);
      }
    }
    // параллельно ждём терминальных статусов
    const settled = await Promise.all(closeIds.map((id) => waitTerminal(id, 40000)));
    const ok = settled.filter((s) => s === "COMPLETED").length;
    log(`  closed: ${ok}/${closeIds.length} (statuses: ${settled.join(",")})`);

    // A3. проверка остатка
    await new Promise((r) => setTimeout(r, 3000));
    const st1 = await getSupervisorState();
    const remaining = tabsOf(st1?.state);
    log(`tabs after: ${remaining.length} → ${remaining.map((t) => t.tab_id.slice(0, 14)).join(", ")}`);
    const fleetLeft = fleetAgentIds(st1?.state);
    log(`fleet after: ${fleetLeft.length} agents`);
  }

  // A4. сброс локального манифеста (иначе cleanup-роут защищает устаревшие вкладки)
  const manifestPath = "/home/z/my-project/.a2/agent-factory-manifest.json";
  try {
    const m = JSON.parse(await Bun.file(manifestPath).text());
    const had = m.agents?.length ?? 0;
    await Bun.write(manifestPath, JSON.stringify({ ...m, agents: [], purgedAt: new Date().toISOString() }, null, 2));
    log(`manifest reset (removed ${had} agents)`);
  } catch {
    log("manifest: none (skip)");
  }

  // ── Фаза B: БД ───────────────────────────────────────────
  if (!skipDb) {
    // дождаться терминальности всех активных команд перед стиранием
    const active = await fetch(
      `${URL}/rest/v1/${CMD_TBL}?status=in.(PENDING,LEASED)&select=command_id,status&limit=50`,
      { headers: H },
    );
    const act = (await active.json()) as Array<{ command_id: string; status: string }>;
    if (act.length) {
      log(`waiting for ${act.length} active commands to settle...`);
      await Promise.all(act.map((c) => waitTerminal(c.command_id, 60000)));
    }

    log("wiping DB task plane...");
    const tables: Array<[string, string]> = [
      [CMD_TBL, "command_id"],
      ["compute_fabric_a2_chat_bridge_remote_command_h205f22", "command_id"],
      ["compute_fabric_a2_supervisor_mesh_instance_h205f22", "supervisor_instance_id"],
      ["compute_fabric_a2_workspace_binding_h205f22", "binding_id"],
      ["compute_fabric_a2_supervisor_actuation_lease_h205f22", "lease_id"],
      ["compute_fabric_a2_browser_cognitive_cursor_h205f22", "workspace_id"],
      ["compute_fabric_a2_chat_bridge_remote_peer_h205f22", "platform"],
      ["metaengine_peer_health_h205f22", "peer_id"],
    ];
    for (const [tbl, key] of tables) {
      const res = await deleteAll(tbl, key);
      log(`  ${tbl}: ${res.before} → ${res.after} (HTTP ${res.status})`);
    }
  }

  // ── Финальная сверка ─────────────────────────────────────
  const stF = await getSupervisorState();
  const tabsF = tabsOf(stF?.state);
  const fleetF = fleetAgentIds(stF?.state);
  log("── FINAL ──");
  log(`tabs: ${tabsF.length} [${tabsF.map((t) => t.url.slice(0, 40)).join(" | ")}]`);
  log(`fleet: ${fleetF.length} agents`);
  const cmdLeft = await countRows(CMD_TBL, "command_id");
  log(`commands left in DB: ${cmdLeft}`);
}

await main().catch((e) => {
  console.error("PURGE FAILED:", e);
  process.exit(1);
});
