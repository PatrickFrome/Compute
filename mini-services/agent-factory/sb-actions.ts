// Full action + lane vocabulary from both command tables.
import { SB, KEY } from "./sb-env";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const T = (n) => `${n}_h205f22`;

async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const t = await r.text();
  try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t.slice(0, 300) }; }
}

const tally = (rows, k) => {
  const m = {};
  for (const r of rows) m[r[k] ?? "null"] = (m[r[k] ?? "null"] ?? 0) + 1;
  return m;
};

// supervisor commands: all actions + lanes (full scan via pagination)
let all = [];
let from = 0;
for (;;) {
  const r = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_command")}?select=action,command_lane,status,issued_by,leased_at&order=leased_at.desc.nullslast&limit=1000&offset=${from}`);
  if (!Array.isArray(r.d) || r.d.length === 0) break;
  all = all.concat(r.d);
  if (r.d.length < 1000) break;
  from += 1000;
}
console.log("supervisor commands total:", all.length);
console.log("ACTIONS:", JSON.stringify(tally(all, "action")));
console.log("LANES:", JSON.stringify(tally(all, "command_lane")));
console.log("STATUS:", JSON.stringify(tally(all, "status")));
console.log("ISSUED_BY:", JSON.stringify(tally(all, "issued_by")));

// chat bridge commands
let cb = [];
from = 0;
for (;;) {
  const r = await j(`${SB}/rest/v1/${T("compute_fabric_a2_chat_bridge_remote_command")}?select=*&order=created_at.desc&limit=1000&offset=${from}`);
  if (!Array.isArray(r.d) || r.d.length === 0) break;
  cb = cb.concat(r.d);
  if (r.d.length < 1000) break;
  from += 1000;
}
console.log("\nchat_bridge total:", cb.length);
if (cb.length) {
  console.log("BRIDGE SAMPLE:", JSON.stringify(cb[0]).slice(0, 900));
  const m = {};
  for (const r of cb) m[r.execution_class ?? r.progress_status ?? "null"] = (m[r.execution_class ?? r.progress_status ?? "null"] ?? 0) + 1;
  console.log("BRIDGE exec_class:", JSON.stringify(m));
  const m2 = {};
  for (const r of cb) m2[r.result_status ?? "null"] = (m2[r.result_status ?? "null"] ?? 0) + 1;
  console.log("BRIDGE result_status:", JSON.stringify(m2));
}

// latest 3 supervisor commands compact (action/payload/receipt keys only)
const last = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_command")}?select=action,payload,receipt,status,command_lane,issued_by&order=leased_at.desc.nullslast&limit=8`);
console.log("\nLAST COMMANDS:");
for (const c of last.d ?? []) {
  console.log(`- ${c.action} lane=${c.command_lane} by=${c.issued_by} st=${c.status} payload=${JSON.stringify(c.payload)?.slice(0, 140)} receipt_keys=${c.receipt ? Object.keys(c.receipt).join(",") : "null"}`);
}
console.log("\nDONE");
