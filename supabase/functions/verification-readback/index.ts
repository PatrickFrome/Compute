/**
 * verification-readback — H205F22 persisted DB readback layer (F1-GPT-003/004 fix).
 *
 * Emits STRICT TYPED readback receipts for canonical
 * destruktion_meta.compute_fabric_provider_signature_verification_h205f22 rows.
 *
 * Design (GPT option 1 from review 5002048810): the receipt is emitted by
 * THIS layer with source=SUPABASE_PERSISTED_READBACK + table identity +
 * verification_id + row digest + evaluated_at. The python registration
 * layer verifies the digest against the row bytes and NEVER accepts
 * caller-supplied row data.
 *
 * Fail-closed laws:
 * - No dedicated read RPC => READBACK_UNAVAILABLE (never fabricates rows).
 * - Row absent => ROW_NOT_FOUND.
 * - authority_effect=false always; this layer grants nothing.
 */

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const READ_RPC = "h205f22_provider_signature_verification_readback_v1";

const SCHEMA = "metaengine.compute.f1-verification-readback.h205f22.v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed", detail: "POST only" }, 405);
  }
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = Deno.env.get("F1_READBACK_TOKEN") ?? "";
  // Caller must hold the F1 readback token; this is NOT authority —
  // it only gates who may request receipts (Law: readback is observation).
  let diff = 0;
  if (!expected || token.length !== expected.length) {
    return json({ error: "unauthorized", detail: "F1 readback token required" }, 401);
  }
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
    return json({ error: "unauthorized", detail: "F1 readback token required" }, 401);
  }

  let body: { provider_id?: string; external_execution_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const providerId = String(body.provider_id ?? "");
  const execId = String(body.external_execution_id ?? "");
  if (!providerId || !execId) {
    return json({ error: "bad_request", detail: "provider_id and external_execution_id required" }, 400);
  }

  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${READ_RPC}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_provider_id: providerId, p_external_execution_id: execId }),
    });
    if (res.status === 404) {
      return json({
        schema: SCHEMA,
        source: "SUPABASE_PERSISTED_READBACK",
        status: "READBACK_UNAVAILABLE",
        detail: "dedicated read RPC not deployed; refusing to fabricate rows (fail-closed per F1-GPT-003)",
        authority_effect: false,
      });
    }
    if (!res.ok) {
      return json({ error: "readback_rpc_failed", status: res.status, authority_effect: false }, 502);
    }
    const row = await res.json();
    if (!row || typeof row !== "object" || Object.keys(row).length === 0) {
      return json({
        schema: SCHEMA,
        source: "SUPABASE_PERSISTED_READBACK",
        status: "ROW_NOT_FOUND",
        authority_effect: false,
      });
    }
    const evaluatedAt = new Date().toISOString();
    const rowText = JSON.stringify(row);
    const rowDigest = await sha256Text(rowText);
    return json({
      schema: SCHEMA,
      source: "SUPABASE_PERSISTED_READBACK",
      table: "destruktion_meta.compute_fabric_provider_signature_verification_h205f22",
      status: "ROW_PRESENT",
      verification_id: (row as Record<string, unknown>).verification_id,
      row: row,
      row_digest_sha256: rowDigest,
      row_serialization: "json-exact-as-received",
      evaluated_at: evaluatedAt,
      authority_effect: false,
    });
  } catch (e) {
    return json({ error: "readback_error", detail: String(e), authority_effect: false }, 500);
  }
});
