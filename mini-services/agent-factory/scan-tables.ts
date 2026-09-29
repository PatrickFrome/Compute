/**
 * Сканер таблиц Supabase (только таблицы, не RPC).
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

async function rest(path: string) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: JWT, Authorization: `Bearer ${JWT}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const spec = (await rest("/")) as {
  paths: Record<string, unknown>;
  definitions: Record<string, { properties: Record<string, { description?: string }> }>;
};

const tables = Object.keys(spec.paths)
  .filter((p) => p.startsWith("/") && !p.startsWith("/rpc/") && !p.includes("("))
  .map((p) => p.slice(1));

console.log(`ВСЕГО ТАБЛИЦ: ${tables.length}\n`);
for (const t of tables) {
  const cols = Object.keys(spec.definitions[t]?.properties ?? {});
  console.log(`• ${t}\n    [${cols.join(", ")}]`);
}
