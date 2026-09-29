/**
 * ME2 CHAT-SWARM v1.0.0 — API-прокси к рою (REST :3046).
 * Канонический путь /api/swarm/* → mini-services/agent-swarm. Без кэша, без лимитов.
 */
import { NextRequest, NextResponse } from "next/server";

const SWARM_REST = "http://127.0.0.1:3046";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const target = `${SWARM_REST}/${path.join("/")}${req.nextUrl.search}`;
  try {
    const init: RequestInit = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.text();
    }
    const r = await fetch(target, init);
    const body = await r.text();
    return new NextResponse(body, {
      status: r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `swarm unreachable: ${String(e).slice(0, 120)}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
