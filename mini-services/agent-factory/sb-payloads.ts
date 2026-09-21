// Sample payload/receipt shapes for key geometry-independent actions.
const SB = "https://xpeibufgzjknrhbhpffp.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZWlidWZnemprbnJoYmhwZmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5MDAxMiwiZXhwIjoyMTAyNzY2MDEyfQ.GwPUwfFLebOQFDKJWl_NmExp_Pgww4x8xsVsgxiO8Gc";
const CMD = "compute_fabric_a2_browser_supervisor_command_h205f22";

async function j(url) {
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t.slice(0, 200); }
}

const ACTIONS = [
  "SEMANTIC_TYPE", "TYPED_CLICK", "NEW_TAB", "NAVIGATE", "READ_TRANSCRIPT",
  "SELECT_TAB", "SEMANTIC_FOCUS", "PRESS_KEY", "SCROLL", "CAPTURE_VIEW",
  "TAB_CENSUS", "FLEET_STATUS", "RESOLVE_PROMPT",
];
for (const a of ACTIONS) {
  const rows = await j(
    `${SB}/rest/v1/${CMD}?select=action,payload,status,receipt,error&order=leased_at.desc.nullslast&limit=200`,
  );
  if (!Array.isArray(rows)) { console.log(`### ${a}: ERR ${JSON.stringify(rows).slice(0, 160)}`); continue; }
  const matches = rows.filter((r) => r.action === a).slice(0, 2);
  console.log(`\n### ${a} (in last 200: ${rows.filter((r) => r.action === a).length})`);
  for (const r of matches) {
    const rec = r.receipt ?? {};
    console.log(
      JSON.stringify(
        {
          payload: r.payload,
          status: r.status,
          result: rec.result ?? null,
          effect_outcome: rec.effect_outcome ?? null,
          error: r.error,
        },
        null,
        1,
      ).slice(0, 1000),
    );
  }
}
console.log("\nDONE");
