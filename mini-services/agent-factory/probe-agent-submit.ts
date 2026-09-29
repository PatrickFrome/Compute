import { issue } from "./cloud-cmd.ts";

const TAB = process.argv[2] ?? "tab_673d338f-04de-445d-9a15-efc47dddc47d";
interface Tgt { role: string; name: string | null; semantic_ref: unknown; }
const capture = async () => {
  const r = await issue("CAPTURE", { tab_id: TAB }, 90, 20000);
  return (r.result ?? null) as { url?: string; semantic_targets?: Tgt[] } | null;
};

let frame = await capture();
const box = (frame?.semantic_targets ?? []).find((t) => t?.role === "textbox" && (t?.name ?? "") === "Send a Message");
if (!box?.semantic_ref) { console.log("NO AGENT COMPOSER"); process.exit(1); }
console.log("agent composer found, typing probe + Enter...");

const MSG = "METAENGINE AGENT MODE PROBE v1: Do not use any tools. Reply with a single word READY and stop.";
const typed = await issue("SEMANTIC_TYPE", {
  role: "textbox", tab_id: TAB, semantic_ref: box.semantic_ref, accessible_name: box.name,
  text: MSG, replace_existing: true, submit_after_type: true,
}, 120, 30000);
console.log("type+submit:", typed.status, JSON.stringify(typed.result ?? {}).slice(0, 300), typed.error ?? "");

// observe: url + surface after 8s
await Bun.sleep(8000);
frame = await capture();
console.log("url-after:", frame?.url);
const btns = (frame?.semantic_targets ?? []).filter((t) => t?.role === "button").map((t) => t?.name);
console.log("buttons:", JSON.stringify(btns.slice(0, 14)));
const roles = (frame?.semantic_targets ?? []).reduce((acc: Record<string, number>, t) => { acc[t?.role ?? "?"] = (acc[t?.role ?? "?"] ?? 0) + 1; return acc; }, {});
console.log("roles:", JSON.stringify(roles));
