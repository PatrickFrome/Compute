import { issue } from "./cloud-cmd.ts";

const live = await (await fetch("http://localhost:3000/api/live")).json();
const tabs = live?.live?.tabs?.items ?? [];
const root = tabs.find((t: { url: string }) => !/\/c\/[a-z0-9-]+/.test(t.url)) ?? tabs[0];
const TAB = root.tabId;
console.log("tab:", TAB, root.url);

interface Tgt { role: string; name: string | null; semantic_ref: unknown; }
const capture = async () => {
  const r = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
  return (r.result ?? null) as { url?: string; semantic_targets?: Tgt[] } | null;
};

// 1) find exact "Agent" button
let frame = await capture();
const agentBtn = (frame?.semantic_targets ?? []).find((t) => t?.role === "button" && (t?.name ?? "").trim().toLowerCase() === "agent");
if (!agentBtn?.semantic_ref) { console.log("NO AGENT BUTTON — buttons:", (frame?.semantic_targets ?? []).filter(t=>t?.role==="button").map(t=>t?.name)); process.exit(1); }
console.log("Agent button ref found");

// 2) click it
const click = await issue("TYPED_CLICK", {
  role: "button", tab_id: TAB, semantic_ref: agentBtn.semantic_ref, accessible_name: agentBtn.name,
}, 90, 18000);
console.log("click:", click.status, click.error ?? "");

// 3) capture after
await Bun.sleep(2500);
frame = await capture();
console.log("after-click url:", frame?.url);
const tbs = (frame?.semantic_targets ?? []).filter((t) => t?.role === "textbox");
console.log("textboxes:", JSON.stringify(tbs.map((t) => ({ name: t.name, len: (t as unknown as { value_length?: number }).value_length ?? null }))));
const btns = (frame?.semantic_targets ?? []).filter((t) => t?.role === "button").map((t) => t?.name);
console.log("buttons:", JSON.stringify(btns.slice(0, 16)));
