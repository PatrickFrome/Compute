/**
 * MOCK Colab GPU-узел — эмуляция Ollama за trycloudflare-туннелем для E2E-теста
 * интеграции Colab в рой (Task COLAB-20260929). Живёт на :3061, ответы каноничные.
 * ВАЖНО: это тестовый стенд, не прод-компонент.
 */
const started = Date.now();
Bun.serve({
  port: 3061,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/api/tags") {
      return Response.json({ models: [{ name: "mock-gpu-70b:latest", size: 4700000000 }] });
    }
    if (u.pathname === "/api/chat") {
      const body = (await req.json().catch(() => ({}))) as {
        model?: string; messages?: Array<{ role: string; content: string }>;
      };
      const last = body?.messages?.[body.messages.length - 1]?.content ?? "";
      await new Promise((r) => setTimeout(r, 120)); // имитация latency GPU
      return Response.json({
        model: body.model ?? "mock-gpu-70b",
        message: { role: "assistant", content: `[mock-colab] GPU-узел на связи. Эхо: ${String(last).slice(0, 100)}` },
        done: true,
      });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`[mock-colab] поднят :3061, uptime0=${started}`);
