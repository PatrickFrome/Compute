import { issue } from "./cloud-cmd.ts";

// 1) fresh tab
const nt = await issue("NEW_TAB", { url: "https://chat.z.ai/", select: true }, 90, 30000);
const TAB = String((nt.result as { tab_id?: string } | null)?.tab_id ?? "");
console.log("NEW_TAB:", nt.status, "tab:", TAB.slice(4, 12));
if (!TAB) process.exit(1);

interface Tgt { role: string; name: string | null; semantic_ref: unknown; }
const capture = async () => {
  const r = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
  return (r.result ?? null) as { url?: string; semantic_targets?: Tgt[] } | null;
};

// 2) wait for hydration + capture
let frame: { url?: string; semantic_targets?: Tgt[] } | null = null;
let agentBtn: Tgt | undefined;
for (let i = 0; i < 6; i++) {
  await Bun.sleep(2000);
  frame = await capture();
  agentBtn = (frame?.semantic_targets ?? []).find((t) => t?.role === "button" && (t?.name ?? "").trim().toLowerCase() === "agent");
  if (agentBtn?.semantic_ref) break;
}
if (!agentBtn?.semantic_ref) { console.log("NO AGENT BTN; textboxes:", JSON.stringify((frame?.semantic_targets ?? []).filter(t=>t?.role==="textbox").map(t=>({n:t?.name,len:(t as unknown as {value_length?:number})?.value_length})))); process.exit(1); }
console.log("agent btn ok; composer before click:", JSON.stringify((frame?.semantic_targets ?? []).filter(t=>t?.role==="textbox").map(t=>({n:t?.name,len:(t as unknown as {value_length?:number})?.value_length}))));

// 3) click Agent
const click = await issue("TYPED_CLICK", { role: "button", tab_id: TAB, semantic_ref: agentBtn.semantic_ref, accessible_name: agentBtn.name }, 90, 16000);
console.log("click Agent:", click.status);
await Bun.sleep(2000);

// 4) type bootstrap + submit (GLM_ZAI platform)
frame = await capture();
const box = (frame?.semantic_targets ?? []).find((t) => t?.role === "textbox");
console.log("composer after mode switch:", JSON.stringify({ n: box?.name, len: (box as unknown as { value_length?: number })?.value_length }));
if (!box?.semantic_ref) { console.log("NO COMPOSER"); process.exit(1); }
const MSG = "METAENGINE AGENT MODE PROBE v1: Do not use any tools and do not browse. Reply with the single word READY and stop.";
const typed = await issue("SEMANTIC_TYPE", {
  role: "textbox", tab_id: TAB, semantic_ref: box.semantic_ref, accessible_name: box.name,
  text: MSG, replace_existing: true, submit_after_type: true,
}, 120, 30000, "GLM_ZAI");
console.log("type+submit:", typed.status, "| err:", typed.error ?? "none", "| result:", JSON.stringify(typed.result ?? {}).slice(0, 400));

// 5) observe task surface
for (const delay of [6000, 8000]) {
  await Bun.sleep(delay);
  frame = await capture();
  console.log(`url(+${delay / 1000}s):`, frame?.url);
  const roles = (frame?.semantic_targets ?? []).reduce((acc: Record<string, number>, t) => { acc[t?.role ?? "?"] = (acc[t?.role ?? "?"] ?? 0) + 1; return acc; }, {});
  console.log("roles:", JSON.stringify(roles));
  const btns = (frame?.semantic_targets ?? []).filter((t) => t?.role === "button").map((t) => t?.name);
  console.log("buttons:", JSON.stringify(btns.slice(0, 10)));
}
console.log("FINAL TAB:", TAB);
