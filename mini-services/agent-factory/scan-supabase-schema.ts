/**
 * Сканер схемы облачного Supabase: ищем таблицы с токенами/секретами/сессиями.
 * Запуск: bun run scan-supabase-schema.ts
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
    headers: {
      apikey: JWT,
      Authorization: `Bearer ${JWT}`,
    },
  });
  if (!r.ok) {
    throw new Error(`${r.status} ${await r.text()}`);
  }
  return r.json();
}

const spec = (await rest("/")) as {
  paths: Record<string, unknown>;
  definitions: Record<string, { properties: Record<string, { description?: string; format?: string }> }>;
};

const tables = Object.keys(spec.paths)
  .filter((p) => p.startsWith("/"))
  .map((p) => p.slice(1))
  .filter((t) => !t.includes("("));

console.log(`ВСЕГО ТАБЛИЦ: ${tables.length}\n`);

const interesting = tables.filter((t) =>
  /token|secret|credential|vault|key|session|auth|cookie|account|identity|config|setting|env|storage|memory|agent|worker|node|device|register|enroll|onboard|licen/i.test(
    t,
  ),
);

console.log("=== КАНИДИДАТЫ (по имени) ===");
for (const t of interesting) {
  const cols = Object.keys(spec.definitions[t]?.properties ?? {});
  console.log(`\n• ${t}`);
  console.log(`  cols: ${cols.join(", ")}`);
}

console.log("\n\n=== ОСТАЛЬНЫЕ ===");
for (const t of tables.filter((t) => !interesting.includes(t))) {
  const cols = Object.keys(spec.definitions[t]?.properties ?? {});
  console.log(`• ${t}  [${cols.slice(0, 8).join(", ")}${cols.length > 8 ? " ..." : ""}]`);
}
