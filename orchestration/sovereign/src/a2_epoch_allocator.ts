import pg from "pg";

const { Client } = pg;
const DATABASE_URL = req("DATABASE_URL");
const WORKSPACE_ID = req("A2_WORKSPACE_ID");
const AGENT = req("A2_AGENT").toUpperCase();
if (!(["GPT", "GLM"] as string[]).includes(AGENT)) throw new Error("A2_AGENT_invalid");

function req(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

const client = new Client({ connectionString: DATABASE_URL });
try {
  await client.connect();
  const result = await client.query<{ next_epoch: string }>(
    `select (coalesce(max(capability_epoch),0)+1)::text next_epoch
       from destruktion_meta.compute_fabric_a2_peer_session_h205f22
      where workspace_id=$1 and agent=$2`,
    [WORKSPACE_ID, AGENT],
  );
  const epoch = Number(result.rows[0]?.next_epoch || 0);
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 1_000_000) {
    throw new Error("a2_capability_epoch_exhausted");
  }
  process.stdout.write(String(epoch));
} finally {
  await client.end().catch(() => undefined);
}
