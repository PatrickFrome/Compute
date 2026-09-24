"use client";

/**
 * ME2 · R54/R57 — панель «SQL-ЗЕРКАЛО (SUPABASE)» для консоли Mission Control :3000.
 * Честные состояния канала чтения (по приоритету daemon'а):
 *   publishable / anon_registered — RLS-гейт канонический (токен публичен по дизайну);
 *   gotrue                        — настоящий GoTrue access_token (authenticated, кэш+refresh в daemon);
 *   service_proxy                 — читает сам daemon (legacy service-ключ не покидает сервер);
 *   mint                          — облако отвергает сам-минт (доказано пробами R54);
 * состояние зеркала: OFF / WARMUP (ждёт DDL) / LIVE / DEGRADED; auth_channel — gotrue-дополнение (R57).
 * Read-only: 2 GET-запроса каждые 30с, вне шины (47-инвариант не тронут). Секретов не показывает.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, ShieldCheck, ShieldAlert, Clock } from "lucide-react";

type MirrorStatus = {
  ok?: boolean;
  state?: string;
  table?: string;
  configured?: boolean;
  last_sent_seq?: number;
  pending?: number;
  batches_ok?: number;
  batches_err?: number;
  last_error?: string | null;
};

type UiToken = {
  ok?: boolean;
  channel?: string;
  note?: string;
  reason?: string;
  mirror_state?: string;
  auth_channel?: string;
  auth_ttl?: number;
  auth?: { configured?: boolean; cached?: boolean; expires_in?: number; last_error?: string | null };
};

type FeedRow = { seq: number; ts: string; type: string; actor?: string; subject?: string | null };

type Feed = { ok?: boolean; rows?: FeedRow[]; error?: string; http?: number };

const REST = "?XTransformPort=3041";

function stateBadge(state?: string) {
  const s = state || "OFF";
  const map: Record<string, { cls: string; label: string }> = {
    LIVE: { cls: "bg-emerald-950 text-emerald-300 border-emerald-800", label: "LIVE" },
    WARMUP: { cls: "bg-amber-950 text-amber-300 border-amber-800", label: "WARMUP · ждёт DDL" },
    DEGRADED: { cls: "bg-red-950 text-red-300 border-red-800", label: "DEGRADED" },
    OFF: { cls: "bg-zinc-800 text-zinc-400 border-zinc-700", label: "OFF" },
  };
  const m = map[s] ?? map.OFF;
  return <Badge variant="outline" className={`text-[10px] font-medium ${m.cls}`}>{m.label}</Badge>;
}

function channelNote(ch?: string) {
  switch (ch) {
    case "publishable":
      return { icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />, text: "RLS-гейт канонический: публичный read-ключ (роль anon), видимость строк диктует RLS" };
    case "anon_registered":
      return { icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />, text: "RLS-гейт канонический: зарегистрированный legacy anon-ключ (роль anon)" };
    case "gotrue":
      return { icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />, text: "настоящий GoTrue access_token сервис-аккаунта (кэш+refresh в daemon, ttl ~1ч) — authenticated-чтение по RLS канонически" };
    case "service_proxy":
      return { icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />, text: "читает сам daemon — ключ не покидает сервер; RLS-демонстрация ждёт sb_publishable / legacy anon (vault SUPABASE_ANON_JWT)" };
    case "mint":
      return { icon: <ShieldAlert className="h-3.5 w-3.5 text-red-400" />, text: "сам-минт: облако принимает только точные строки зарегистрированных ключей — ожидаем честный 401" };
    default:
      return { icon: <ShieldAlert className="h-3.5 w-3.5 text-zinc-500" />, text: "канал чтения недоступен (no_read_channel)" };
  }
}

export default function MirrorPanel() {
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [token, setToken] = useState<UiToken | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, f] = await Promise.all([
        fetch(`/sqlmirror${REST}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(`/sqlmirror/ui-token${REST}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(`/sqlmirror/feed${REST}&limit=12`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (!alive.current) return;
      setStatus(s);
      setToken(t);
      setFeed(f);
      setUpdatedAt(new Date().toLocaleTimeString());
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const iv = setInterval(() => void load(), 30000);
    return () => { alive.current = false; clearInterval(iv); };
  }, [load]);

  const note = channelNote(token?.channel);
  const rows = Array.isArray(feed?.rows) ? feed!.rows! : [];

  return (
    <Card className="flex min-h-0 flex-col border-zinc-800 bg-zinc-900/40 card-lift" data-testid="mirror-panel">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
          <Database className="h-3.5 w-3.5" />
          SQL-ЗЕРКАЛО · SUPABASE
          {stateBadge(status?.state)}
        </CardTitle>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="hidden text-[10px] text-zinc-500 sm:inline">{updatedAt}</span>}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} aria-label="Обновить зеркало" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-zinc-300" : "text-zinc-500"}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 max-h-64 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
        {!status && <div className="text-xs text-zinc-500">daemon недоступен — статус зеркала неизвестен</div>}
        {status && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
              <span className="font-mono text-zinc-300">{status.table || "—"}</span>
              <span>seq: <span className="font-mono text-zinc-300">{status.last_sent_seq ?? "—"}</span></span>
              <span>pending: <span className="font-mono text-amber-300">{status.pending ?? 0}</span></span>
              <span>пакеты: <span className="font-mono text-emerald-300">{status.batches_ok ?? 0}</span>/<span className="font-mono text-red-300">{status.batches_err ?? 0}</span></span>
            </div>
            {status.state === "WARMUP" && (
              <div className="rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] leading-snug text-amber-200/90">
                Таблицы ещё нет в облаке — миграции <span className="font-mono">sql/0001..0003</span> ждут применения оператором
                (psql $DATABASE_URL -f). Зеркалирование стартует автоматически (WARMUP → LIVE), перепроба без штормов.
              </div>
            )}
            {status.last_error && status.state === "DEGRADED" && (
              <div className="rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 font-mono text-[10px] text-red-300/90">
                {String(status.last_error).slice(0, 160)}
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-400">
              {note.icon}
              <span>
                <span className="text-zinc-300">канал {token?.channel || "n/a"}:</span> {note.text}
                {token?.auth_channel === "gotrue" && (
                  <span className="text-emerald-400/90"> · auth: gotrue (ttl {token?.auth_ttl ?? 0}с) — authenticated читает строки по политике</span>
                )}
                {token?.auth_channel !== "gotrue" && token?.auth?.configured && token?.auth?.last_error && (
                  <span className="text-amber-400/90"> · auth: gotrue недоступен ({token.auth.last_error}) — честная деградация</span>
                )}
                {token?.ok === false && token?.reason && <span className="text-zinc-500"> · {token.reason}</span>}
              </span>
            </div>
            <div className="border-t border-zinc-800/80 pt-2">
              {feed?.ok === true && rows.length === 0 && (
                <div className="text-[11px] text-zinc-500">зеркало живо, строк пока нет</div>
              )}
              {feed?.ok === true && rows.length > 0 && (
                <div className="space-y-1">
                  {rows.slice(0, 12).map((r) => (
                    <div key={r.seq} className="flex items-baseline gap-2 text-[11px]">
                      <span className="w-10 shrink-0 text-right font-mono text-zinc-600">{r.seq}</span>
                      <span className="truncate font-mono text-zinc-300">{r.type}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
                        <Clock className="h-2.5 w-2.5" />
                        {r.ts ? new Date(r.ts).toLocaleTimeString() : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {feed && feed.ok === false && (
                <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-[11px] text-zinc-500">
                  {feed.error === "table_missing_ddl_pending"
                    ? "чтение честно вернуло пусто: таблицы нет (DDL оператора) — канал при этом жив"
                    : `feed недоступен: ${String(feed.error || "?").slice(0, 120)}`}
                </div>
              )}
              {!feed && <div className="text-[11px] text-zinc-500">feed-прокси недоступен</div>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
