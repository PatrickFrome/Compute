import { issue } from "./cloud-cmd.ts";
const TAB = "tab_673d338f-04de-445d-9a15-efc47dddc47d";
interface Tgt { role: string; name: string | null; semantic_ref: unknown; }
const cap = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
const frame = cap.result as { url?: string; semantic_targets?: Tgt[] } | null;
const box = (frame?.semantic_targets ?? []).find((t) => t?.role === "textbox");
console.log("composer:", box?.name);
const typed = await issue("SEMANTIC_TYPE", {
  role: "textbox", tab_id: TAB, semantic_ref: box?.semantic_ref, accessible_name: box?.name,
  text: "METAENGINE AGENT MODE PROBE v1: Do not use any tools. Reply with a single word READY and stop.",
  replace_existing: true, submit_after_type: true,
  platform: "GLM_ZAI",
}, 120, 30000, "GLM_ZAI");
console.log("status:", typed.status, "| error:", typed.error ?? "none");
console.log("result:", JSON.stringify(typed.result ?? {}).slice(0, 500));
await Bun.sleep(9000);
const cap2 = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
const f2 = cap2.result as { url?: string; semantic_targets?: Tgt[] } | null;
console.log("url-after:", f2?.url);
const btns = (f2?.semantic_targets ?? []).filter((t) => t?.role === "button").map((t) => t?.name);
console.log("buttons:", JSON.stringify(btns.slice(0, 12)));
