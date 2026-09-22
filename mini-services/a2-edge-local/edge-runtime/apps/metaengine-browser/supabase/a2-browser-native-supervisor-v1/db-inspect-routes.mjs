// Bounded read-only database digest (2026-09-19 operator directive: all
// agents must have access to all databases — as a read lane). The route
// aggregates whitelisted count/recent-state queries into a compact textual
// digest that the browser's devos task cycle embeds in every agent prompt.
// No secrets, no row bodies, no writes, no authority.

const DB_INSPECT_SCHEMA = 'metaengine.devos.db-inspect.v1';
const DIGEST_MAX_CHARS = 1200;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const SUPABASE_TABLES = [
  ['tasks', 'destruktion_meta.devos_fleet_task_h205f22'],
  ['claims', 'destruktion_meta.devos_fleet_claim_h205f22'],
  ['runtime_control', 'destruktion_meta.devos_fleet_runtime_control_h205f22'],
  ['supervisor_states', 'public.compute_fabric_a2_browser_supervisor_state_h205f22'],
  ['supervisor_commands', 'public.compute_fabric_a2_browser_supervisor_command_h205f22'],
  ['devices', 'public.compute_fabric_a2_browser_device_h205f22'],
  ['claim_ledger', 'destruktion_meta.claim_ledger'],
  ['checkpoint_ledger', 'destruktion_meta.checkpoint_ledger'],
  ['artifact_ledger', 'destruktion_meta.artifact_ledger'],
  ['evidence', 'destruktion_meta.compute_engine_historical_evidence_h205f22'],
  ['continuity_objects', 'destruktion_meta.compute_continuity_object_h205f22'],
  ['roadmap_releases', 'public.compute_fabric_roadmap_release_h205f22'],
  ['canonical_releases', 'public.compute_fabric_canonical_roadmap_release_h205f22'],
];

async function safeCount(sql, table) {
  try {
    const rows = await sql.unsafe(`select count(*)::int as n from ${table}`);
    return Number(rows?.[0]?.n ?? 0);
  } catch {
    return null;
  }
}

async function taskStateBreakdown(sql) {
  try {
    const rows = await sql.unsafe(
      'select state, count(*)::int as n from destruktion_meta.devos_fleet_task_h205f22 group by state order by 2 desc',
    );
    return (rows || []).map((row) => `${String(row.state).toLowerCase()}:${Number(row.n)}`).join(',');
  } catch {
    return null;
  }
}

async function recentCommandHealth(sql) {
  try {
    const rows = await sql.unsafe(
      `select status, count(*)::int as n from public.compute_fabric_a2_browser_supervisor_command_h205f22
       where leased_at > now() - interval '1 hour' group by status order by 2 desc`,
    );
    return (rows || []).map((row) => `${String(row.status).toLowerCase()}:${Number(row.n)}`).join(',');
  } catch {
    return null;
  }
}

export function createDbInspectRoutes({ sql, json: jsonImpl = json } = {}) {
  if (typeof sql?.unsafe !== 'function') throw new Error('db_inspect_sql_required');
  return async function dbInspectRoutes({ req, path }) {
    if (req?.method !== 'POST' || path !== '/v1/db/inspect') return null;
    const parts = [];
    const counted = [];
    for (const [label, table] of SUPABASE_TABLES) {
      const n = await safeCount(sql, table);
      if (n != null) { counted.push(`${label}=${n}`); }
    }
    if (counted.length) parts.push(`db_counts ${counted.join(' ')}`);
    const tasks = await taskStateBreakdown(sql);
    if (tasks) parts.push(`db_tasks ${tasks}`);
    const commands = await recentCommandHealth(sql);
    if (commands) parts.push(`db_commands_1h ${commands}`);
    const digest = parts.join('\n').slice(0, DIGEST_MAX_CHARS);
    return jsonImpl(200, {
      schema: DB_INSPECT_SCHEMA,
      digest,
      tables_inspected: SUPABASE_TABLES.length,
      tables_counted: counted.length,
      row_bodies_exposed: false,
      secrets_exposed: false,
      writes_allowed: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  };
}
