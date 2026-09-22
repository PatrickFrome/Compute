/**
 * Фаза зачистки №3: дренаж task-plane через devos_environment_reset_v1.
 * Стратегия ×2: попытка #1 ставит supervisor_admission fence (даже при отказе),
 * mesh протухает за 45s; leases/claims истекают сами. Луп попыток до успеха.
 * Запуск: bun run purge-phase3-reset.ts
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
const secRaw = await Bun.file("/home/z/.a2/agent-factory-secrets.env").text();
const sec = Object.fromEntries(
  secRaw.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    let k = l.slice(0, i).trim();
    if (k.startsWith("export ")) k = k.slice(7).trim();
    return [k, l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }),
);
const WS = sec.AGENT_FACTORY_WORKSPACE_ID;
const URL = env.SUPABASE_URL;
const JWT = env.SUPABASE_SERVICE_ROLE_JWT;
const H = { apikey: JWT, Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" } as const;

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ status: number; json: T | null; text: string }> {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const text = await r.text();
  let json: T | null = null;
  try { json = JSON.parse(text) as T; } catch { /* error body */ }
  return { status: r.status, json, text };
}

type Snapshot = {
  active_tasks?: Array<{ task_id: string; state: string; role: string; lease_expires_at?: string | null }>;
  active_claims?: Array<{ claim_id: number; state: string; expires_at: string; task_id: string }>;
};

async function census(): Promise<{ tasks: Record<string, number>; liveLeases: number; liveClaims: number; nextExpire: number | null }> {
  const s = await rpc<Snapshot>("devos_fleet_snapshot_v1", { p_workspace: WS });
  const tasks = s.json?.active_tasks ?? [];
  const claims = s.json?.active_claims ?? [];
  const byState: Record<string, number> = {};
  for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const now = Date.now();
  const liveLeases = tasks.filter((t) => ["LEASED", "RUNNING"].includes(t.state) && t.lease_expires_at && Date.parse(t.lease_expires_at) > now).length;
  const liveClaims = claims.filter((c) => c.state === "ACTIVE" && Date.parse(c.expires_at) > now).length;
  const expiries = [
    ...tasks.filter((t) => ["LEASED", "RUNNING"].includes(t.state)).map((t) => (t.lease_expires_at ? Date.parse(t.lease_expires_at) : Infinity)),
    ...claims.filter((c) => c.state === "ACTIVE").map((c) => Date.parse(c.expires_at)),
  ].filter((x) => Number.isFinite(x));
  return { tasks: byState, liveLeases, liveClaims, nextExpire: expiries.length ? Math.max(...expiries) : null };
}

// 0. Ценз перед стартом
const c0 = await census();
log(`census: tasks=${JSON.stringify(c0.tasks)} liveLeases=${c0.liveLeases} liveClaims=${c0.liveClaims} nextExpire=${c0.nextExpire ? new Date(c0.nextExpire).toISOString() : "-"}`);

// 1. Луп reset-попыток (первая ставит fence и почти наверняка откажется по живой mesh)
const MAX_ATTEMPTS = 14;
let success = false;
for (let i = 1; i <= MAX_ATTEMPTS && !success; i++) {
  const r = await rpc<{ schema?: string; deleted_nonterminal_tasks?: number; deleted_claims?: number; deleted_actuation_leases?: number; deleted_mesh_instances?: number; generation_floor?: number; supervisor_admission_enabled?: boolean }>(
    "devos_environment_reset_v1",
    { p_workspace: WS, p_reason: "CLEAN_SLATE_AGENT_FACTORY_PURGE" },
  );
  if (r.status === 200 && r.json) {
    log(`RESET SUCCESS on attempt ${i}: ${JSON.stringify(r.json)}`);
    success = true;
    break;
  }
  const m = r.text.match(/devos_environment_reset_refused_live_execution:[^"]*/);
  log(`attempt ${i}: HTTP ${r.status} ${m ? m[0] : r.text.slice(0, 140)}`);
  if (i < MAX_ATTEMPTS) await new Promise((res) => setTimeout(res, 45000));
}

if (!success) {
  log("RESET FAILED after all attempts — census:");
  const c = await census();
  log(JSON.stringify(c));
  process.exit(2);
}

// 2. Верификация после reset
await new Promise((r) => setTimeout(r, 3000));
const st = await rpc<{ refill_enabled?: boolean; supervisor_admission_enabled?: boolean; generation_floor?: number; reset_reason?: string }>("devos_environment_state_v1", { p_workspace: WS });
log(`environment_state: ${JSON.stringify(st.json)}`);
const c1 = await census();
log(`census after: tasks=${JSON.stringify(c1.tasks)} liveLeases=${c1.liveLeases} liveClaims=${c1.liveClaims}`);
