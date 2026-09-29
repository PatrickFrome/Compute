// ws-probe.ts — BROWSER-TEST: socket.io клиент к рою :3047, слушает swarm_event 8с.
import { io } from "socket.io-client";

const URL = process.env.WS_URL ?? "http://127.0.0.1:3047";
const s = io(URL, { path: "/", timeout: 6000, reconnection: false });
let count = 0;
const seen = new Set<string>();
s.on("connect", () => console.log("WS CONNECT ok, sid=" + s.id));
s.on("swarm_event", (e: { type?: string }) => {
  count++;
  seen.add(e?.type ?? "?");
});
s.on("connect_error", (e: Error) => { console.log("WS CONNECT_ERROR: " + e.message); process.exit(1); });
setTimeout(() => {
  console.log(`WS EVENTS received=${count} types=[${[...seen].join(",")}]`);
  process.exit(count > 0 ? 0 : 2);
}, 8000);
