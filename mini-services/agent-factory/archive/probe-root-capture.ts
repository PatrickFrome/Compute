import { issue } from "./cloud-cmd.ts";
const live = await (await fetch("http://localhost:3000/api/live")).json();
const tabs = live?.live?.tabs?.items ?? [];
const root = tabs.find((t: { url: string }) => !/\/c\/[a-z0-9-]+/.test(t.url)) ?? tabs[0];
console.log("probing tab:", root.tabId, root.url);
const r = await issue("CAPTURE", { tab_id: root.tabId }, 90, 25000);
console.log("status:", r.status, "err:", r.error);
const result = r.result as { url?: string; semantic_targets?: { role: string; name: string | null; semantic_ref: string | null; value_length?: number }[] } | null;
if (result?.semantic_targets) {
  console.log("url:", result.url);
  const tbs = result.semantic_targets.filter((t) => t?.role === "textbox");
  console.log("textboxes:", JSON.stringify(tbs.map((t) => ({ name: t.name ?? null, ref: t.semantic_ref ? String(t.semantic_ref).slice(0, 24) : null, len: t.value_length ?? 0 }))));
  const roles = result.semantic_targets.reduce((acc: Record<string, number>, t) => { acc[t?.role ?? "?"] = (acc[t?.role ?? "?"] ?? 0) + 1; return acc; }, {});
  console.log("roles:", JSON.stringify(roles));
  console.log("buttons:", JSON.stringify(result.semantic_targets.filter((t) => t?.role === "button").map((t) => t?.name).slice(0, 12)));
} else {
  console.log("RAW:", JSON.stringify(r.result).slice(0, 1200));
}
