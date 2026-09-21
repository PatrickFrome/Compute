import { issue } from "./cloud-cmd.ts";
const TAB = "tab_673d338f-04de-445d-9a15-efc47dddc47d";
interface Tgt { role: string; name: string | null; semantic_ref: unknown; }
const cap = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
const frame = cap.result as { url?: string; semantic_targets?: Tgt[] } | null;
const box = (frame?.semantic_targets ?? []).find((t) => t?.role === "textbox");
console.log("composer:", JSON.stringify({ name: box?.name, len: (box as unknown as { value_length?: number })?.value_length }));
const typed = await issue("SEMANTIC_TYPE", {
  role: "textbox", tab_id: TAB, semantic_ref: box?.semantic_ref, accessible_name: box?.name,
  text: "METAENGINE AGENT MODE PROBE v1: Do not use any tools. Reply with a single word READY and stop.",
  replace_existing: true, submit_after_type: true,
}, 120, 30000);
console.log("FULL RECEIPT:", JSON.stringify(typed, null, 2).slice(0, 2200));
