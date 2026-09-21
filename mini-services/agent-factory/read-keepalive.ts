/** Читать supervisor state JSON из облака (keepalive/rollover/fleet). */
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
const r = await fetch(
  `${URL}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?client_id=eq.2a60d6a2-c7c2-4dcc-b4c9-99de768443c9&select=state,last_seen_at,extension_version`,
  { headers: { apikey: JWT, Authorization: `Bearer ${JWT}` } },
);
const rows = (await r.json()) as Array<{ state: Record<string, unknown>; last_seen_at: string }>;
const st = rows[0]?.state ?? {};
const lc = (st.supervisor_lifecycle ?? {}) as Record<string, unknown>;
const keepalive = (lc.keepalive ?? {}) as Record<string, unknown>;
const out = {
  last_seen: rows[0]?.last_seen_at,
  keepalive: {
    bound_tab_id: keepalive.tab_id,
    conversation_url: keepalive.conversation_url,
    state: keepalive.state,
    rollover_attempt_tab: (keepalive.rollover_attempt as { tab_id?: string } | null)?.tab_id ?? null,
  },
  fleet_keys: Object.keys((st.fleet as Record<string, unknown>) ?? {}),
  desired_agents: (st.fleet as Record<string, unknown>)?.desired_agents,
  top_keys: Object.keys(st),
};
console.log(JSON.stringify(out, null, 2));
