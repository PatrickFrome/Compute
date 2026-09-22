// generic RPC caller
const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
let url = "", jwt = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (m[1] === "SUPABASE_URL") url = v;
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") jwt = v;
}
const H = { apikey: jwt, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
const name = process.argv[2];
const body = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(body) });
const text = await r.text();
console.log("status:", r.status);
try { console.log(JSON.stringify(JSON.parse(text), null, 1).slice(0, 3000)); } catch { console.log(text.slice(0, 500)); }
