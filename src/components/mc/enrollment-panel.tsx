"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import {
  KeyRound, UserCheck, UserX, Zap, Copy, Fingerprint, MonitorSmartphone, Clock,
} from "lucide-react";

interface EnrollmentData {
  requests: {
    requestId: string; clientId: string; profile: string | null; fingerprint: string | null;
    status: string; requestedAt: string | null; approvedAt: string | null; expiresAt: string | null;
    jwkKty: string | null; jwkCrv: string | null;
  }[];
  devices: {
    deviceId: string; clientId: string; active: boolean; fingerprint: string | null;
    createdAt: string | null; revokedAt: string | null; lastSeenAt: string | null;
  }[];
}

export function EnrollmentPanel({ poll, refresh }: { poll: PollState<EnrollmentData>; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState<{ clientId: string; token: string; deviceId?: string } | null>(null);

  const d = poll.data;
  const pending = d?.requests.filter((r) => r.status === "PENDING") ?? [];
  const decided = d?.requests.filter((r) => r.status !== "PENDING") ?? [];

  async function act(requestId: string, action: "approve" | "reject" | "activate") {
    setBusy(requestId + action);
    try {
      const res = await fetch("/api/enrollment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const json = (await res.json()) as {
        ok: boolean; error?: string; newStatus?: string;
        accepted?: boolean; reason?: string | null; pairingToken?: string | null; deviceId?: string | null;
      };
      if (!json.ok) {
        toast.error(`Gate ${action} failed`, { description: json.error ?? `HTTP ${res.status}` });
        return;
      }
      if (action === "activate") {
        if (json.accepted) {
          setToken({ clientId: pending.find((p) => p.requestId === requestId)?.clientId ?? "?", token: json.pairingToken ?? "", deviceId: json.deviceId ?? undefined });
          toast.success("Device activated", { description: "pairing token issued (shown once)" });
        } else {
          toast.warning("Activation refused", { description: json.reason ?? "RPC returned accepted=false" });
        }
      } else {
        toast.success(`Request ${json.newStatus}`, { description: shortId(requestId, 10) });
      }
      await refresh();
    } catch (e) {
      toast.error("Network error", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="enrollment-panel">
      {/* pending gate */}
      <Card className="border-amber-900/60 bg-gradient-to-b from-amber-950/20 to-zinc-900/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-amber-300">
            <Fingerprint className="h-4 w-4" aria-hidden />
            Operator Gate — pending requests
            {pending.length > 0 && (
              <Badge className="border-amber-500/50 bg-amber-500/20 text-amber-200 font-mono">{pending.length}</Badge>
            )}
          </CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-500">
            zero-authority store · service_role cannot write · approval is a human decision
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {poll.loading && <Skeleton className="h-20 w-full bg-zinc-800" />}
          {!poll.loading && pending.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 p-4 text-zinc-500">
              <UserCheck className="h-4 w-4" aria-hidden />
              <span className="text-sm">No pending enrollment requests — gate clear.</span>
            </div>
          )}
          {pending.map((r) => (
            <div
              key={r.requestId}
              data-testid={`pending-request-${r.clientId}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 transition-colors hover:border-amber-500/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-zinc-200">{r.clientId}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                    fp:{r.fingerprint ? `${r.fingerprint.slice(0, 16)}…` : "—"} · {r.jwkKty ?? "?"}/{r.jwkCrv ?? "?"} · requested {timeAgo(r.requestedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm" variant="outline" data-testid={`approve-${r.clientId}`}
                    disabled={busy !== null}
                    onClick={() => act(r.requestId, "approve")}
                    className="h-7 border-emerald-500/40 px-2 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
                  >
                    <UserCheck className="mr-1 h-3 w-3" /> Approve
                  </Button>
                  <Button
                    size="sm" variant="outline" data-testid={`activate-${r.clientId}`}
                    disabled={busy !== null}
                    onClick={() => act(r.requestId, "activate")}
                    className="h-7 border-violet-500/40 px-2 text-violet-300 hover:bg-violet-500/15 hover:text-violet-200"
                  >
                    <Zap className="mr-1 h-3 w-3" /> Approve+Activate
                  </Button>
                  <Button
                    size="sm" variant="outline" data-testid={`reject-${r.clientId}`}
                    disabled={busy !== null}
                    onClick={() => act(r.requestId, "reject")}
                    className="h-7 border-rose-500/40 px-2 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                  >
                    <UserX className="mr-1 h-3 w-3" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* decision history */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Decision History</CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">latest {Math.min(decided.length, 25)} decided requests</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-72 pr-2 mc-scroll">
              <div className="space-y-1.5">
                {decided.slice(0, 25).map((r) => (
                  <div key={r.requestId} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-zinc-300">{r.clientId}</p>
                      <p className="font-mono text-[9px] text-zinc-600">approved {timeAgo(r.approvedAt)}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
                {decided.length === 0 && !poll.loading && (
                  <p className="py-3 text-center font-mono text-xs text-zinc-600">no decided requests yet</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* registered devices */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <MonitorSmartphone className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Registered Devices
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              {d?.devices.filter((x) => x.active).length ?? 0} active / {d?.devices.length ?? 0} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-72 pr-2 mc-scroll">
              <div className="space-y-1.5">
                {d?.devices.map((x) => (
                  <div key={x.deviceId} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-zinc-300">{x.clientId}</p>
                      <p className="font-mono text-[9px] text-zinc-600">
                        seen {timeAgo(x.lastSeenAt)}{x.revokedAt ? ` · revoked ${timeAgo(x.revokedAt)}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={`font-mono text-[9px] ${x.active ? "border-emerald-500/40 text-emerald-300" : "border-zinc-700 text-zinc-500"}`}>
                      {x.active ? "ACTIVE" : x.revokedAt ? "REVOKED" : "INACTIVE"}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* pairing token dialog */}
      <Dialog open={token !== null} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent className="border-emerald-900/60 bg-zinc-950 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              <KeyRound className="h-4 w-4 text-emerald-400" aria-hidden /> Pairing token issued
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Device <span className="font-mono text-emerald-300">{token?.clientId}</span> activated.
              This one-time token is displayed <span className="text-amber-300">only now</span> — only its sha256 lives in the DB.
            </DialogDescription>
          </DialogHeader>
          <Separator className="bg-zinc-800" />
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="max-h-32 break-all font-mono text-[11px] leading-4 text-emerald-200" data-testid="pairing-token">
              {token?.token}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
              <Clock className="h-3 w-3" /> deliver to device out-of-band
            </span>
            <Button
              size="sm" onClick={() => {
                if (token) void navigator.clipboard.writeText(token.token);
                toast.success("Token copied to clipboard");
              }}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
