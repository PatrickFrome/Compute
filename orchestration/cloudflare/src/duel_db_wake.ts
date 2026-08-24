import type { AopWake, JsonObject } from "./types";

async function safeEqual(a: string, b: string): Promise<boolean> {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyDbDuelWake(request: Request, secret: string): Promise<AopWake> {
  if (!secret) throw new Error("duel_db_wake_secret_missing");
  const signature = request.headers.get("x-metaengine-duel-signature-256") ?? "";
  if (!signature.startsWith("sha256=")) throw new Error("duel_db_wake_signature_missing");
  const raw = await request.text();
  const parsed = JSON.parse(raw) as Partial<AopWake>;
  const payload = parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload) ? parsed.payload as JsonObject : {};
  const id = typeof parsed.id === "string" ? parsed.id : "";
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";
  const source = typeof parsed.source === "string" ? parsed.source : "";
  const duelId = typeof payload.duel_id === "string" ? payload.duel_id : "";
  const checkpoint = typeof payload.checkpoint_sha256 === "string" ? payload.checkpoint_sha256 : "";
  if (reason !== "DUEL_DB_INSERT" || source !== "supabase-pg-net") throw new Error("duel_db_wake_contract_invalid");
  if (!/^[0-9a-f-]{36}$/.test(duelId) || !/^[0-9a-f]{64}$/.test(checkpoint)) throw new Error("duel_db_wake_binding_invalid");
  const expectedId = `duel:${duelId}:${checkpoint}`;
  if (id !== expectedId) throw new Error("duel_db_wake_id_mismatch");
  const message = [id, reason, duelId, checkpoint].join("|");
  const expected = `sha256=${await hmacHex(secret, message)}`;
  if (!(await safeEqual(signature, expected))) throw new Error("duel_db_wake_signature_invalid");
  return { id, reason, source, payload };
}
