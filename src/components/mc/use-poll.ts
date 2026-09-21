"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

/** Polling hook with interval, pause and manual refresh. */
export function usePoll<T>(url: string, intervalMs: number | null, enabled = true): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as T & { ok?: boolean; error?: string };
      if (!mounted.current) return;
      if (json.ok === false) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setData(json);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setLastUpdated(new Date());
      }
    }
  }, [url, enabled]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!intervalMs || !enabled) return;
    const id = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, refresh, enabled]);

  return { data, error, loading, lastUpdated, refresh };
}

/** Relative time formatter ("2m ago"). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "ahead";
  if (abs < 1000) return "now";
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`;
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`;
}

export function shortId(id: string | null | undefined, keep = 8): string {
  if (!id) return "—";
  return id.length <= keep + 4 ? id : `${id.slice(0, keep)}…${id.slice(-4)}`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
