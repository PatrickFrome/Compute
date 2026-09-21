/**
 * ME2 Providers — LLM-слой, модель-агностичный (урок OpenCode: 75+ провайдеров).
 * Формат "provider:model":
 *   zai:<model>         — z-ai-web-dev-sdk (нативный, sandbox backend)
 *   gateway:<model>     — Vercel AI Gateway (OpenAI-совместимый; ключ из Supabase RPC)
 * Пустой суффикс = дефолт провайдера.
 */
import ZAI from "z-ai-web-dev-sdk";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// ── Vercel AI Gateway key (секрет лежит в Supabase — подтверждено 2026-09-21) ──
let gatewayKey: string | null = null;
let gatewayKeyTried = false;

async function loadGatewayKey(): Promise<string | null> {
  if (gatewayKey) return gatewayKey;
  if (gatewayKeyTried) return null;
  gatewayKeyTried = true;
  try {
    const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
    const env = Object.fromEntries(
      envRaw.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
        const i = l.indexOf("=");
        let k = l.slice(0, i).trim();
        if (k.startsWith("export ")) k = k.slice(7).trim();
        return [k, l.slice(i + 1).trim().replace(/^"|"$/g, "")];
      }),
    );
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/h205f22_aop1_vercel_gateway_runtime_secret_v1`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_JWT, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_JWT}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.ok) {
      const j = (await r.json()) as { vercel_ai_gateway_api_key?: string };
      if (j.vercel_ai_gateway_api_key) {
        gatewayKey = j.vercel_ai_gateway_api_key;
        console.log("[providers] Vercel AI Gateway key loaded from Supabase");
      }
    }
  } catch (e) {
    console.log(`[providers] gateway key load failed: ${String(e).slice(0, 120)}`);
  }
  return gatewayKey;
}

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function zai() {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  return zaiInstance;
}

export async function listProviders(): Promise<Record<string, { ready: boolean; note: string }>> {
  const key = await loadGatewayKey();
  return {
    zai: { ready: true, note: "z-ai-web-dev-sdk (native)" },
    gateway: { ready: Boolean(key), note: key ? "Vercel AI Gateway (key from Supabase)" : "no key (Supabase RPC unavailable)" },
  };
}

/** Единая точка вызова LLM. Возвращает текст ответа. */
export async function chat(model: string, messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<string> {
  const sep = model.indexOf(":");
  const provider = sep === -1 ? "zai" : model.slice(0, sep);
  const modelId = sep === -1 ? "" : model.slice(sep + 1);

  if (provider === "gateway") {
    const key = await loadGatewayKey();
    if (!key) throw new Error("gateway_no_key");
    const url = "https://ai.gateway.vercel.dev/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId || "zai/glm-4.6",
        messages,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`gateway HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? "";
  }

  // default: zai
  const z = await zai();
  const response = await z.chat.completions.create({
    messages: messages as never,
    stream: false,
    thinking: { type: "disabled" },
  });
  return response.choices?.[0]?.message?.content ?? "";
}
