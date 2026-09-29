"use client";
// ── ME2 PAGE: SUPERVISOR (R74) — control-plane оркестрации ─────────────────────
// Порт legacy (docs/legacy-mission-control.tsx.txt): OBJECTIVES/WORKGRAPH (L2925-2980),
// HANDOFFS (L2983-3046), GLM·REVIEWS (L3049-3095), APPROVALS (L3098-3138), BRAIN (L3191-3217),
// ROADMAP M1–M7 (L3437-3507), GOVERNOR·G11 + АВТОПИЛОТ·G10 (L4261-4293).
// Payload'ы POST сверены с daemon 1:1. Поллинги: wg/ho 15s · glm/rev/appr 20s ·
// governor/demand 30s · brain/roadmap 60s (все с cleanup).

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight, Brain, Cpu, Gauge, ListChecks, Network, Plus, Radar, RefreshCw, ScanEye, ShieldCheck, Target,
} from "lucide-react";
import { hhmmss, me2Fetch } from "@/lib/me2-bus";
import { useMe2 } from "@/components/me2/store";
import { Chip, PageHeader, Sec, StateBadge } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── типы (порт legacy 1:1) ──────────────────────────────────────────────────────
type WorkGraphData = {
  ok: boolean; fails_closed: boolean;
  objectives: Array<{ id: string; title: string; spec: string; status: string; priority: number; derived_state: string; attention: string | null; counts: { total: number; active: number; done: number; failed: number } }>;
  orphan_tasks: Array<{ id: string; title: string; status: string }>;
  stats: { objectives_total: number; objectives_active: number; objectives_achieved: number; objectives_failed: number; objectives_parked: number; attention_objectives: number; tasks_linked: number; tasks_orphan: number; agents_total: number; edges: number; handoffs: number };
};
type HandoffData = {
  ok: boolean;
  handoffs: Array<{
    id: string; from_task: string; to_task: string; from_role: string | null; to_role: string | null;
    reason: string; by: string; created_at: string;
    protocol_parsed: { done?: string; in_flight?: string; next: string; context?: string; open_questions?: string; artifacts?: string };
    from_title: string | null; to_title: string | null; to_status: string | null;
  }>;
  stats: { total: number; last_24h: number; by_to_role: Record<string, number>; last: { id: string; to_role: string | null; created_at: string } | null };
};
type GlmData = {
  ok: boolean; canonical: string; agent_tag: string;
  agents: { total: number; on_canonical: number; drift: number; by_model: Record<string, number> };
  last_probe: { requested_tag: string; api_model: string | null; honoring: number; ok: number; error: string | null; at: string } | null;
  probes_total: number; platform_honoring: boolean | null; research: string;
};
type ReviewsData = {
  ok: boolean;
  reviews: Array<{ task_id: string; title: string; status: string; review: { verdict: "real" | "suspect" | "empty"; reasons: string[]; checked_at: string; evidence: { steps: number; writes: number; tool_calls: number; result_len: number; reward_hack: boolean } } }>;
  stats: { total: number; by_verdict: Record<string, number>; last: { task_id: string; verdict: string; at: string } | null };
};
type ApprovalsData = {
  ok: boolean;
  policies: Array<{ gate: string; mode: string; updated_at: number; updated_by: string }>;
  pending: Array<{ id: string; gate: string; subject: string; label: string; requested_by: string; created_at: number }>;
  recent: Array<{ id: string; gate: string; subject: string; label: string; status: "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED"; decided_at: number | null }>;
  stats: { total: number; pending: number; approved: number; denied: number; consumed: number; expired: number };
};
type GovernorT = {
  ok: boolean;
  breaker: { state: "CLOSED" | "OPEN" | "HALF_OPEN"; trips: number; opened_at: string | null; open_until_ms: number; cooldown_ms: number };
  lanes: Array<{ lane: "P0" | "P1" | "P2"; capacity: number; refill_per_min: number; tokens: number; admitted: number; rejected_bucket: number; waited_ms_total: number }>;
  admitted_total: number; rejected_total: number;
  recent: Array<{ ts: string; kind: string; lane: string; detail: string }>;
};
type DemandT = {
  ok: boolean;
  config: { enabled: boolean; max: number };
  ticks: number;
  last_decision: { ts: string; action: string; signal: string | null; role: string | null; session_id: string | null; detail: string } | null;
  decisions: Array<{ ts: string; action: string; signal: string | null; role: string | null; session_id: string | null; detail: string }>;
  snapshot: { ready_count: number; ready_research: number; pool_leases: number; pool_max: number; fails_15m: number; active_chats: number; breaker_open: boolean };
};
type BrainData = { ok: boolean; thoughts: { key: string; content: string; at: number }[]; probe: { eventloop_ms: number; db_probe_ms: number; memory_rows: number } };
type ThoughtT = { goal: string; summary: string; steps: string[]; risks: string[]; ms: number; memory_used: number[] };
type RoadmapData = { ok: boolean; verdict: string; done: number; total: number; closedAt: string | null; milestones: { key: string; title: string; status: string; evidence: string; checks: { name: string; pass: boolean }[]; verifiedAt: string }[] };

// ── PAGE ────────────────────────────────────────────────────────────────────────
export function SupervisorPage() {
  const { toast } = useToast();
  const snap = useMe2((s) => s.snap);

  // ── данные (REST-опросы локальны странице — перф-паттерн legacy) ──
  const [wg, setWg] = useState<WorkGraphData | null>(null);
  const [hoData, setHoData] = useState<HandoffData | null>(null);
  const [glmData, setGlmData] = useState<GlmData | null>(null);
  const [revData, setRevData] = useState<ReviewsData | null>(null);
  const [apprData, setApprData] = useState<ApprovalsData | null>(null);
  const [governor, setGovernor] = useState<GovernorT | null>(null);
  const [demand, setDemand] = useState<DemandT | null>(null);
  const [brain, setBrain] = useState<BrainData | null>(null);
  const [thought, setThought] = useState<ThoughtT | null>(null);
  const [rm, setRm] = useState<RoadmapData | null>(null);
  const [mcxBusy, setMcxBusy] = useState(false);

  // ── формы ──
  const [objTitle, setObjTitle] = useState("");
  const [objSpec, setObjSpec] = useState("");
  const [hoTask, setHoTask] = useState("");
  const [hoRole, setHoRole] = useState("IMPLEMENTER");
  const [hoReason, setHoReason] = useState("");
  const [hoNext, setHoNext] = useState("");
  const [hoDone, setHoDone] = useState("");
  const [brainGoal, setBrainGoal] = useState("");

  // ── loaders (порт legacy) ──
  const loadWg = useCallback(async () => {
    const r = await me2Fetch<WorkGraphData>("/workgraph?XTransformPort=3041");
    if (r?.ok) setWg(r);
  }, []);
  const loadHo = useCallback(async () => {
    const r = await me2Fetch<HandoffData>("/handoffs?XTransformPort=3041");
    if (r?.ok) setHoData(r);
  }, []);
  const loadGlm = useCallback(async () => {
    const r = await me2Fetch<GlmData>("/glm?XTransformPort=3041");
    if (r?.ok) setGlmData(r);
  }, []);
  const loadRev = useCallback(async () => {
    const r = await me2Fetch<ReviewsData>("/reviews?XTransformPort=3041");
    if (r?.ok) setRevData(r);
  }, []);
  const loadAppr = useCallback(async () => {
    const r = await me2Fetch<ApprovalsData>("/approvals?XTransformPort=3041");
    if (r?.ok) setApprData(r);
  }, []);
  const loadGovernor = useCallback(async () => {
    const r = await me2Fetch<GovernorT>("/governor?XTransformPort=3041");
    if (r?.ok) setGovernor(r);
  }, []);
  const loadDemand = useCallback(async () => {
    const r = await me2Fetch<DemandT>("/demand?XTransformPort=3041");
    if (r?.ok) setDemand(r);
  }, []);
  const loadBrain = useCallback(async () => {
    const r = await me2Fetch<BrainData>("/brain?XTransformPort=3041");
    if (r?.ok) setBrain(r);
  }, []);
  const loadRm = useCallback(async () => {
    const r = await me2Fetch<RoadmapData>("/roadmap?XTransformPort=3041");
    if (r?.ok) setRm(r);
  }, []);

  // ── поллинги (монтируются условно со страницей — cleanup обязателен) ──
  useEffect(() => { void loadWg(); const iv = setInterval(() => void loadWg(), 15_000); return () => clearInterval(iv); }, [loadWg]);
  useEffect(() => { void loadHo(); const iv = setInterval(() => void loadHo(), 15_000); return () => clearInterval(iv); }, [loadHo]);
  useEffect(() => { void loadGlm(); void loadRev(); const iv = setInterval(() => { void loadGlm(); void loadRev(); }, 20_000); return () => clearInterval(iv); }, [loadGlm, loadRev]);
  useEffect(() => { void loadAppr(); const iv = setInterval(() => void loadAppr(), 20_000); return () => clearInterval(iv); }, [loadAppr]);
  useEffect(() => { void loadGovernor(); const iv = setInterval(() => void loadGovernor(), 30_000); return () => clearInterval(iv); }, [loadGovernor]);
  useEffect(() => { void loadDemand(); const iv = setInterval(() => void loadDemand(), 30_000); return () => clearInterval(iv); }, [loadDemand]);
  useEffect(() => { void loadBrain(); const iv = setInterval(() => void loadBrain(), 60_000); return () => clearInterval(iv); }, [loadBrain]);
  useEffect(() => { void loadRm(); const iv = setInterval(() => void loadRm(), 60_000); return () => clearInterval(iv); }, [loadRm]);

  // ── мутации: POST ?XTransformPort=3041 (порт legacy mcxOp L1918-1935) ──
  const mcxOp = useCallback(async (path: string, body: Record<string, unknown>, okMsg: string, after?: () => Promise<void>) => {
    setMcxBusy(true);
    try {
      const res = await fetch(`/${path}?XTransformPort=3041`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()) as Record<string, unknown> | null;
      if (res?.ok !== false) {
        toast({ title: okMsg });
        if (after) await after();
        return res;
      }
      toast({ title: `${path} ✗`, description: String(res?.error ?? "ошибка"), variant: "destructive" });
    } catch {
      toast({ title: `${path} ✗`, description: "daemon недоступен", variant: "destructive" });
    } finally { setMcxBusy(false); }
    return null;
  }, [toast]);

  // R27 C1: цели (exact legacy payload формы: {op:"create", title, spec} — priority дефолтится daemon'ом)
  const createObjective = useCallback(async () => {
    if (!objTitle.trim()) return;
    await mcxOp("objectives", { op: "create", title: objTitle.trim(), spec: objSpec.trim() }, "цель создана", loadWg);
    setObjTitle(""); setObjSpec("");
  }, [objTitle, objSpec, mcxOp, loadWg]);
  const objStatus = useCallback(async (id: string, status: string, okMsg: string) => {
    await mcxOp("objectives", { op: "status", id, status }, okMsg, loadWg);
  }, [mcxOp, loadWg]);
  const deleteObjective = useCallback(async (o: { id: string; title: string }) => {
    await mcxOp("objectives", { op: "delete", id: o.id }, "цель удалена", loadWg);
  }, [mcxOp, loadWg]);

  // R28 C2: передача задачи (exact legacy payload: to_role/reason/protocol{next,done} → POST /tasks/{id}/handoff)
  const doHandoff = useCallback(async () => {
    if (!hoTask.trim() || !hoReason.trim() || !hoNext.trim()) {
      toast({ title: "handoff ✗", description: "нужны задача, причина и protocol.next — передача без «что дальше» бессмысленна (fails-closed)", variant: "destructive" });
      return;
    }
    const ok = await mcxOp(`tasks/${hoTask.trim()}/handoff`, {
      to_role: hoRole, reason: hoReason.trim(),
      protocol: { next: hoNext.trim(), done: hoDone.trim() || undefined },
    }, "задача передана: протокол записан, continuation в очереди", async () => { await loadHo(); await loadWg(); });
    if (ok) { setHoReason(""); setHoNext(""); setHoDone(""); }
  }, [hoTask, hoReason, hoNext, hoDone, hoRole, mcxOp, loadHo, loadWg, toast]);

  // R29: GLM probe/upgrade + ручной запуск антифальшь-ревью (POST /reviews/run {task_id})
  const glmOp = useCallback(async (op: "probe" | "upgrade") => {
    await mcxOp("glm", { op }, op === "probe" ? "probe GLM снята — факт в /glm" : "флот переведён на канонический тег GLM", loadGlm);
  }, [mcxOp, loadGlm]);
  const runReview = useCallback(async () => {
    const id = window.prompt("task_id задачи для ревью (POST /reviews/run):", "");
    if (!id?.trim()) return;
    await mcxOp("reviews/run", { task_id: id.trim() }, "ревью поставлено в очередь — вердикт появится в TASK_REVIEWED и /reviews", loadRev);
  }, [mcxOp, loadRev]);

  // R30 C4: approvals — approve/deny заявок + переключение политик
  const apprOp = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
    await mcxOp("approvals", body, okMsg, loadAppr);
  }, [mcxOp, loadAppr]);
  const apprPolicy = useCallback(async (gate: string, mode: "require_approval" | "auto_approve") => {
    await mcxOp("approvals", { op: "policy", gate, mode }, `политика ${gate} → ${mode === "auto_approve" ? "auto_approve (гейт снят)" : "require_approval (гейт активен)"}`, loadAppr);
  }, [mcxOp, loadAppr]);

  // R43 G10: автопилот спроса — toggle (exact legacy payload {op:"config", enabled}) + tick {op:"tick"}
  const demandToggle = useCallback(async (v: boolean) => {
    setMcxBusy(true);
    try {
      const r = await fetch("/demand?XTransformPort=3041", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "config", enabled: v }) }).then((x) => x.json()) as { ok?: boolean; config?: { enabled: boolean; max: number } } | null;
      if (r?.ok) toast({ title: `автопилот спроса: ${r.config?.enabled ? "включен" : "выключен"} (max ${r.config?.max})` });
    } catch { /* daemon недоступен */ }
    finally { setMcxBusy(false); }
    await loadDemand();
  }, [loadDemand, toast]);
  const demandTick = useCallback(async () => {
    await mcxOp("demand", { op: "tick" }, "тик автопилота выполнен — решение в /demand", loadDemand);
  }, [mcxOp, loadDemand]);

  // ME5: brain/think → мысль {summary, steps, risks}
  const thinkGoal = useCallback(async () => {
    const goal = brainGoal.trim();
    if (!goal) return;
    setMcxBusy(true);
    try {
      const r = await fetch("/brain/think?XTransformPort=3041", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) }).then((x) => x.json()) as { ok?: boolean; thought?: ThoughtT; error?: string } | null;
      if (r?.ok && r.thought) { setThought(r.thought); toast({ title: "мысль зафиксирована в памяти" }); }
      else toast({ title: "brain/think ✗", description: String(r?.error ?? "ошибка"), variant: "destructive" });
    } catch { toast({ title: "brain/think ✗", description: "daemon недоступен", variant: "destructive" }); }
    finally { setMcxBusy(false); }
    setBrainGoal("");
  }, [brainGoal, toast]);

  const handoffTasks = (snap?.tasks ?? []).filter((t) => ["READY", "RUNNING", "FAILED", "CANCELLED"].includes(t.status)).slice(0, 50);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-supervisor" data-panel-supervisor>
      <PageHeader title="SUPERVISOR" sub="control-plane · цели · handoffs · governor" />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-3">
        {/* ══ колонка 1: OBJECTIVES + WORKGRAPH ══ */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="sup-objectives" title="OBJECTIVES" icon={Target} tone="violet"
            right={
              <span data-testid="wg-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title={`цели: active=${wg?.stats.objectives_active ?? 0}, achieved=${wg?.stats.objectives_achieved ?? 0}, failed=${wg?.stats.objectives_failed ?? 0}, parked=${wg?.stats.objectives_parked ?? 0}`}>цели {wg?.stats.objectives_total ?? "—"}</span>
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="задачи, привязанные к целям, и рёбра objective→task→agent">задачи {wg?.stats.tasks_linked ?? "—"} · рёбра {wg?.stats.edges ?? "—"}</span>
                {(wg?.stats.attention_objectives ?? 0) > 0 && <span className="rounded border border-amber-900 bg-amber-950/40 px-1 py-0.5 text-amber-300" title="цели со stalled/empty — ждут оператора (fails-closed: система не закрывает сама)">внимание {wg?.stats.attention_objectives}</span>}
                {(wg?.stats.tasks_orphan ?? 0) > 0 && <span className="rounded border border-amber-900 bg-amber-950/40 px-1 py-0.5 text-amber-300" title="READY/RUNNING задачи вне целей">orphan {wg?.stats.tasks_orphan}</span>}
              </span>
            }
          >
            <form
              onSubmit={(e) => { e.preventDefault(); void createObjective(); }}
              className="mb-1.5 space-y-1"
            >
              <Input value={objTitle} onChange={(e) => setObjTitle(e.target.value)} placeholder="новая цель: заголовок…" className="h-7 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Заголовок новой цели" />
              <div className="flex gap-1.5">
                <Input value={objSpec} onChange={(e) => setObjSpec(e.target.value)} placeholder="критерии успеха (spec)…" className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Критерии успеха цели" />
                <Button type="submit" size="sm" variant="outline" disabled={mcxBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]"><Plus className="mr-1 h-3 w-3" aria-hidden /> цель</Button>
              </div>
            </form>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700" role="list" aria-label="Цели и их производные состояния">
              {(wg?.objectives ?? []).map((o) => (
                <div key={o.id} role="listitem" className="rounded bg-zinc-900/50 px-1.5 py-1" title={`${o.spec ? `spec: ${o.spec}` : "без spec"} · priority ${o.priority} · ${o.id}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1 text-[8px] ${o.status === "ACTIVE" ? "bg-emerald-950/60 text-emerald-300" : o.status === "ACHIEVED" ? "bg-lime-950/60 text-lime-300" : o.status === "FAILED" ? "bg-rose-950/60 text-rose-300" : "bg-zinc-800 text-zinc-400"}`}>{o.status.toLowerCase()}</span>
                    <span className={`shrink-0 rounded px-1 text-[8px] ${o.derived_state === "on_track" ? "bg-cyan-950/60 text-cyan-300" : o.derived_state === "stalled" || o.derived_state === "empty" ? "bg-amber-950/60 text-amber-300" : "bg-zinc-800 text-zinc-500"}`}>{o.derived_state}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-300">{o.title}</span>
                    <span className="shrink-0 font-mono text-[9px] text-zinc-600" title={`задачи: всего ${o.counts.total}, активных ${o.counts.active}, готово ${o.counts.done}, упало ${o.counts.failed}`}>{o.counts.done}/{o.counts.total}</span>
                  </div>
                  {o.attention && <div className="mt-0.5 font-mono text-[9px] text-amber-300/80">⚠ {o.attention}</div>}
                  {o.status === "ACTIVE" && (
                    <div className="mt-1 flex gap-1">
                      <button type="button" onClick={() => void objStatus(o.id, "ACHIEVED", "цель закрыта как достигнутая")} disabled={mcxBusy} className="rounded border border-lime-900 px-1.5 py-0.5 font-mono text-[9px] text-lime-300 transition hover:bg-lime-950/40">достигнута</button>
                      <button type="button" onClick={() => void objStatus(o.id, "PARKED", "цель отложена")} disabled={mcxBusy} className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800">парк</button>
                      <button type="button" onClick={() => void objStatus(o.id, "FAILED", "цель закрыта как провальная")} disabled={mcxBusy} className="rounded border border-rose-900 px-1.5 py-0.5 font-mono text-[9px] text-rose-300 transition hover:bg-rose-950/40">провал</button>
                      <button type="button" onClick={() => void deleteObjective(o)} disabled={mcxBusy} aria-label={`Удалить цель ${o.title}`} className="ml-auto text-zinc-600 transition hover:text-rose-400">✕</button>
                    </div>
                  )}
                </div>
              ))}
              {wg && wg.objectives.length === 0 && (
                <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">целей нет — создай первую (задачи привязываются через objective_id при постановке)</div>
              )}
              {!wg && (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка work_graph…</div>
              )}
            </div>
          </Sec>

          <Sec id="sup-workgraph" title="WORKGRAPH · ПРОЕКЦИЯ" icon={Network} tone="cyan">
            <div className="flex flex-wrap gap-1" data-testid="wg-projection">
              <Chip label="задачи связаны" value={wg?.stats.tasks_linked ?? "—"} tone="cyan" title="READY/RUNNING задачи, привязанные к целям" />
              <Chip label="orphan" value={wg?.stats.tasks_orphan ?? "—"} tone={(wg?.stats.tasks_orphan ?? 0) > 0 ? "amber" : "zinc"} title="активные задачи вне целей (fails-closed видит их явно)" />
              <Chip label="агентов" value={wg?.stats.agents_total ?? "—"} tone="zinc" title="агентов в проекции цели→задачи→агент" />
              <Chip label="рёбер" value={wg?.stats.edges ?? "—"} tone="zinc" title="рёбра objective→task→agent" />
              <Chip label="handoffs" value={wg?.stats.handoffs ?? "—"} tone="violet" title="передач в проекции" />
              <Chip label="active" value={wg?.stats.objectives_active ?? "—"} tone="emerald" title="активных целей" />
              <Chip label="achieved" value={wg?.stats.objectives_achieved ?? "—"} tone="lime" title="достигнутых целей" />
              <Chip label="parked" value={wg?.stats.objectives_parked ?? "—"} tone="zinc" title="отложенных целей" />
            </div>
            {(wg?.orphan_tasks.length ?? 0) > 0 && (
              <div className="mt-1.5 rounded border border-amber-900/50 bg-amber-950/20 px-1.5 py-1" title="незакреплённые за целями активные задачи — fails-closed видит их явно">
                <div className="font-mono text-[9px] text-amber-300/90">orphan-задачи (вне целей):</div>
                {wg?.orphan_tasks.slice(0, 5).map((t) => <div key={t.id} className="truncate font-mono text-[9px] text-zinc-500">· {t.title} [{t.status}]</div>)}
              </div>
            )}
            {!wg && <div className="mt-1.5 rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">проекция загрузится с /workgraph…</div>}
          </Sec>
        </div>

        {/* ══ колонка 2: HANDOFFS + GLM·REVIEWS + APPROVALS ══ */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="sup-handoffs" title="HANDOFFS" icon={ArrowLeftRight} tone="violet"
            right={
              <span data-testid="ho-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title={`всего передач; за 24ч: ${hoData?.stats.last_24h ?? 0}`}>передач {hoData?.stats.total ?? "—"}</span>
                {hoData?.stats.last && (
                  <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title={`последняя передача ${hoData.stats.last.id} в ${hhmmss(hoData.stats.last.created_at)}`}>last →{hoData.stats.last.to_role ?? "любой"}</span>
                )}
              </span>
            }
          >
            <form onSubmit={(e) => { e.preventDefault(); void doHandoff(); }} className="mb-1.5 space-y-1">
              <div className="flex gap-1.5">
                <Select value={hoTask || undefined} onValueChange={setHoTask}>
                  <SelectTrigger className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[10px] text-zinc-300" aria-label="Задача для передачи">
                    <SelectValue placeholder="задача (READY/RUNNING/FAILED)…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56 font-mono text-[10px]">
                    {handoffTasks.map((t) => (
                      <SelectItem key={t.id} value={t.id} title={t.title}>{t.status.slice(0, 4)} · {t.title.slice(0, 44)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={hoRole} onValueChange={setHoRole}>
                  <SelectTrigger className="h-7 w-[86px] shrink-0 border-zinc-800 bg-zinc-950/60 font-mono text-[10px] text-zinc-300" aria-label="Роль получателя">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="font-mono text-[10px]">
                    {["IMPLEMENTER", "DEBUGGER", "RESEARCHER", "OPERATOR"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input value={hoReason} onChange={(e) => setHoReason(e.target.value)} placeholder="причина передачи (обязательно)…" className="h-7 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Причина передачи задачи" />
              <Textarea value={hoNext} onChange={(e) => setHoNext(e.target.value)} placeholder="protocol.next — что делать дальше (обязательно; получатель читает как бриф)…" rows={2} className="min-h-[38px] border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Что делать дальше (protocol.next)" />
              <div className="flex gap-1.5">
                <Input value={hoDone} onChange={(e) => setHoDone(e.target.value)} placeholder="protocol.done — что уже сделано (опц.)…" className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Что уже сделано (protocol.done)" />
                <Button type="submit" size="sm" variant="outline" disabled={mcxBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]"><ArrowLeftRight className="mr-1 h-3 w-3" aria-hidden /> передать</Button>
              </div>
            </form>
            <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700" role="list" aria-label="Последние передачи задач" data-testid="handoffs-list">
              {(hoData?.handoffs ?? []).slice(0, 5).map((h) => (
                <div key={h.id} role="listitem" className="rounded bg-zinc-900/50 px-1.5 py-1" title={`${h.id}: ${h.reason} · next: ${h.protocol_parsed.next} · by ${h.by} · ${h.created_at}`}>
                  <div className="flex items-center gap-1.5 font-mono text-[9px]">
                    <span className="shrink-0 text-violet-300" aria-hidden>⇄</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{h.from_role ?? "?"} → {h.to_role ?? "любой"}: {h.reason}</span>
                    <span className={`shrink-0 rounded px-1 text-[8px] ${h.to_status === "COMPLETED" ? "bg-emerald-950/60 text-emerald-300" : h.to_status === "HANDED_OFF" ? "bg-violet-950/60 text-violet-300" : "bg-amber-950/60 text-amber-300"}`} title="статус continuation-задачи">{(h.to_status ?? "?").toLowerCase()}</span>
                    <span className="shrink-0 text-zinc-600">{hhmmss(h.created_at)}</span>
                  </div>
                  {h.protocol_parsed.next && (
                    <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500" title={h.protocol_parsed.next}>next: {h.protocol_parsed.next}</div>
                  )}
                </div>
              ))}
              {hoData && hoData.handoffs.length === 0 && (
                <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">передач ещё не было — выбери задачу, причину и protocol.next</div>
              )}
              {!hoData && (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка передач…</div>
              )}
            </div>
          </Sec>

          <Sec id="sup-reviews" title="GLM · REVIEWS" icon={Cpu} tone="cyan"
            right={
              <span data-testid="glm-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title={`канонический тег: ${glmData?.agent_tag ?? "—"};probe'ов снято: ${glmData?.probes_total ?? 0}`}>canon {glmData?.canonical ?? "—"}</span>
                <span className={`rounded border px-1 py-0.5 ${(glmData?.agents.drift ?? 0) === 0 ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-rose-900 bg-rose-950/40 text-rose-300"}`} title={`агентов на каноне: ${glmData?.agents.on_canonical ?? 0}/${glmData?.agents.total ?? 0}; drift>0 = есть агенты на старых тегах`}>drift {glmData?.agents.drift ?? "—"}</span>
              </span>
            }
          >
            <div className="mb-1.5 flex gap-1.5">
              <button type="button" onClick={() => void glmOp("probe")} disabled={mcxBusy} aria-label="Снять живую пробу GLM" className="rounded border border-cyan-900 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 transition hover:bg-cyan-950/40">probe</button>
              <button type="button" onClick={() => void glmOp("upgrade")} disabled={mcxBusy} aria-label="Перевести флот на канонический тег GLM" className="rounded border border-cyan-900 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 transition hover:bg-cyan-950/40">upgrade флот</button>
              <button type="button" onClick={() => void runReview()} disabled={mcxBusy} aria-label="Запустить антифальшь-ревью задачи" data-testid="reviews-run" className="rounded border border-cyan-900 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 transition hover:bg-cyan-950/40">запустить ревью</button>
              <button type="button" onClick={() => { void loadGlm(); void loadRev(); }} disabled={mcxBusy} aria-label="Обновить GLM и ревью" className="ml-auto text-zinc-600 transition hover:text-zinc-300"><RefreshCw className={`h-3 w-3 ${mcxBusy ? "animate-spin" : ""}`} aria-hidden /></button>
            </div>
            {glmData?.last_probe && (
              <div className="mb-1.5 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`probe: ${glmData.last_probe.at} · requested=${glmData.last_probe.requested_tag}`}>
                <span className={glmData.last_probe.ok ? "text-cyan-300" : "text-rose-300"}>probe:</span> <span className="text-zinc-400">запрошен {glmData.last_probe.requested_tag} → бэкенд {glmData.last_probe.api_model ?? `ошибка: ${glmData.last_probe.error ?? "?"}`}</span>
              </div>
            )}
            <div className="mb-0.5 flex items-center gap-1.5" title="ME26: ревью COMPLETED-задач — сверка результата со спеком и телеметрией lease; suspect/empty уходят в память с высоким весом">
              <ScanEye className="h-3 w-3 text-cyan-400" aria-hidden />
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">антифальшь-ревью</span>
              <span className="font-mono text-[9px] text-zinc-500">{revData ? `real ${revData.stats.by_verdict.real ?? 0} · suspect ${revData.stats.by_verdict.suspect ?? 0} · empty ${revData.stats.by_verdict.empty ?? 0}` : ""}</span>
            </div>
            <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700" role="list" aria-label="Последние антифальшь-ревью" data-testid="reviews-list">
              {(revData?.reviews ?? []).slice(0, 4).map((r) => (
                <div key={r.task_id} role="listitem" className="rounded bg-zinc-900/50 px-1.5 py-1" title={`${r.task_id} · ${r.review.checked_at} · телеметрия: шагов=${r.review.evidence.steps}, вызовов=${r.review.evidence.tool_calls}${r.review.evidence.reward_hack ? ", tier-1 reward-hack" : ""}`}>
                  <div className="flex items-center gap-1.5 font-mono text-[9px]">
                    <span className={`shrink-0 rounded px-1 text-[8px] ${r.review.verdict === "real" ? "bg-emerald-950/60 text-emerald-300" : r.review.verdict === "empty" ? "bg-zinc-800 text-zinc-400" : "bg-amber-950/60 text-amber-300"}`}>{r.review.verdict}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{r.title}</span>
                    <span className="shrink-0 text-zinc-600">{hhmmss(r.review.checked_at)}</span>
                  </div>
                  {r.review.reasons[0] && <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500" title={r.review.reasons.join("; ")}>· {r.review.reasons[0]}</div>}
                </div>
              ))}
              {revData && revData.reviews.length === 0 && (
                <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">ревью ещё не было — появятся после выполнения задач (кнопка «запустить ревью» → POST /reviews/run {`{task_id}`})</div>
              )}
              {!revData && (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка ревью…</div>
              )}
            </div>
          </Sec>

          <Sec id="sup-approvals" title="APPROVALS" icon={ShieldCheck} tone="amber"
            right={
              <span data-testid="appr-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className={`rounded border px-1 py-0.5 ${(apprData?.stats.pending ?? 0) > 0 ? "border-amber-900 bg-amber-950/40 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title="заявок ждёт решения оператора">pending {apprData?.stats.pending ?? "—"}</span>
                {(apprData?.stats.consumed ?? 0) > 0 && <span className="rounded border border-emerald-900 bg-emerald-950/40 px-1 py-0.5 text-emerald-300" title="согласий израсходовано — один approve = одно исполнение">used {apprData?.stats.consumed}</span>}
                {(apprData?.stats.denied ?? 0) > 0 && <span className="rounded border border-rose-900 bg-rose-950/40 px-1 py-0.5 text-rose-300" title="заявок отклонено">denied {apprData?.stats.denied}</span>}
              </span>
            }
          >
            <div className="mb-1.5 space-y-1" role="list" aria-label="Политики гейтов мутирующих операций" data-testid="appr-policies">
              {(apprData?.policies ?? []).map((p) => (
                <div key={p.gate} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-900/50 px-1.5 py-1" title={`гейт ${p.gate}: mode=${p.mode} (обновил ${p.updated_by})`}>
                  <span className="font-mono text-[9px] text-zinc-300">{p.gate}</span>
                  <span className={`rounded px-1 text-[8px] ${p.mode === "auto_approve" ? "bg-zinc-800 text-zinc-400" : "bg-amber-950/60 text-amber-300"}`}>{p.mode === "auto_approve" ? "auto" : "gate"}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[8px] text-zinc-600" title={p.gate === "fence_clear" ? "снятие durable fence (ME19)" : p.gate === "rsi_adopt" ? "принятие RSI-предложения в skills/ (ME8)" : "authority-операции: selfupdate apply — смена живого кода"}>{p.gate === "fence_clear" ? "снятие fence" : p.gate === "rsi_adopt" ? "RSI adopt" : "selfupdate apply"}</span>
                  <button type="button" onClick={() => void apprPolicy(p.gate, p.mode === "auto_approve" ? "require_approval" : "auto_approve")} disabled={mcxBusy} aria-label={`Переключить политику ${p.gate} на ${p.mode === "auto_approve" ? "require_approval" : "auto_approve"}`} className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800">{p.mode === "auto_approve" ? "включить гейт" : "отключить"}</button>
                </div>
              ))}
              {!apprData && <div className="rounded-md border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[10px] text-zinc-600">загрузка политик…</div>}
            </div>
            <div className="max-h-32 space-y-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700" role="list" aria-label="Заявки на согласование" data-testid="appr-pending">
              {(apprData?.pending ?? []).map((a) => (
                <div key={a.id} role="listitem" className="rounded border border-amber-950/60 bg-amber-950/20 px-1.5 py-1">
                  <div className="flex items-center gap-1.5 font-mono text-[9px]">
                    <span className="shrink-0 rounded bg-amber-950/60 px-1 text-[8px] text-amber-300">{a.gate}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-300" title={`${a.subject} · от ${a.requested_by}`}>{a.label}</span>
                    <span className="shrink-0 text-zinc-600">{hhmmss(new Date(a.created_at).toISOString())}</span>
                  </div>
                  <div className="mt-0.5 flex gap-1">
                    <button type="button" onClick={() => void apprOp({ op: "approve", id: a.id }, "согласие выдано: один approve = одно исполнение (токен TTL 15м)")} disabled={mcxBusy} aria-label={`Одобрить заявку ${a.gate}`} className="rounded border border-emerald-900 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300 transition hover:bg-emerald-950/40">approve</button>
                    <button type="button" onClick={() => void apprOp({ op: "deny", id: a.id }, "заявка отклонена — операция останется под гейтом")} disabled={mcxBusy} aria-label={`Отклонить заявку ${a.gate}`} className="rounded border border-rose-900 px-1.5 py-0.5 font-mono text-[9px] text-rose-300 transition hover:bg-rose-950/40">deny</button>
                  </div>
                </div>
              ))}
              {apprData && apprData.pending.length === 0 && (
                <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">нет заявок — гейты молчат, пока операции не пытаются пройти</div>
              )}
            </div>
            {(apprData?.recent.length ?? 0) > 0 && (
              <div className="mt-1.5 space-y-0.5" role="list" aria-label="Недавние решения по гейтам" data-testid="appr-recent">
                {apprData?.recent.slice(0, 3).map((r) => (
                  <div key={r.id} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[9px]" title={`${r.gate}: ${r.label} · ${r.status}`}>
                    <span className={`shrink-0 rounded px-1 text-[8px] ${r.status === "DENIED" ? "bg-rose-950/60 text-rose-300" : r.status === "EXPIRED" ? "bg-zinc-800 text-zinc-400" : "bg-emerald-950/60 text-emerald-300"}`}>{r.status.toLowerCase()}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">{r.label}</span>
                  </div>
                ))}
              </div>
            )}
          </Sec>
        </div>

        {/* ══ колонка 3: GOVERNOR + АВТОПИЛОТ + BRAIN + ROADMAP ══ */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="sup-governor" title="GOVERNOR · G11" icon={Gauge}
            tone={(governor?.breaker.state ?? "CLOSED") === "CLOSED" ? "emerald" : (governor?.breaker.state ?? "") === "OPEN" ? "rose" : "amber"}
            right={
              <span data-testid="governor-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className={`rounded border px-1 py-0.5 ${governor ? (governor.breaker.state === "CLOSED" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : governor.breaker.state === "HALF_OPEN" ? "border-amber-900/60 bg-amber-950/30 text-amber-300" : "border-rose-900/60 bg-rose-950/30 text-rose-300 animate-pulse") : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title={governor ? `circuit breaker: ${governor.breaker.state}, срабатываний=${governor.breaker.trips}, cooldown=${Math.round(governor.breaker.cooldown_ms / 1000)}с, открыт: ${governor.breaker.opened_at ?? "—"}` : "состояние breaker"}>{governor ? governor.breaker.state : "—"}</span>
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="всего пропущено / отклонено Governor (breaker+bucket)">⌁ {governor ? `${governor.admitted_total}/${governor.rejected_total}` : "—"}</span>
              </span>
            }
          >
            <div className="mb-1.5 flex items-center gap-2">
              <StateBadge
                state={governor ? (governor.breaker.state === "CLOSED" ? "LIVE" : governor.breaker.state === "HALF_OPEN" ? "Recovering" : "Failed") : "Idle"}
              />
              <span className="font-mono text-[9px] text-zinc-500" title="срабатываний breaker (3 исчерпанных 429/5xx за 120с → OPEN)">
                trips {governor?.breaker.trips ?? "—"} · cooldown {governor ? `${Math.round(governor.breaker.cooldown_ms / 1000)}с` : "—"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(governor?.lanes ?? []).map((l) => (
                <span key={l.lane} className={`rounded border px-1 py-0.5 font-mono text-[9px] ${l.lane === "P0" ? "border-violet-900/60 bg-violet-950/30 text-violet-300" : l.lane === "P1" ? "border-zinc-700 bg-zinc-900/60 text-zinc-300" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`} title={`полоса ${l.lane}: токенов ${l.tokens}/${l.capacity}, refill ${l.refill_per_min}/мин, прошло=${l.admitted}, откл. бакетом=${l.rejected_bucket}, ожидание сумм=${Math.round(l.waited_ms_total / 1000)}с`}>{l.lane} {l.tokens}/{l.capacity}·{l.refill_per_min}/м</span>
              ))}
              {!governor && <span className="rounded-md border border-dashed border-zinc-800 px-2 py-1.5 font-mono text-[10px] text-zinc-600">загрузка /governor…</span>}
            </div>
            {(governor?.recent.length ?? 0) > 0 && (
              <div className="mt-1.5 space-y-0.5" role="list" aria-label="Недавние решения governor">
                {governor?.recent.slice(0, 4).map((r, i) => (
                  <div key={`${r.ts}-${i}`} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[9px]" title={`${r.kind}: ${r.detail}`}>
                    <span className="shrink-0 text-zinc-600">{r.ts.slice(11, 19)}</span>
                    <span className="shrink-0 text-zinc-400">{r.lane}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </Sec>

          <Sec id="sup-demand" title="АВТОПИЛОТ · G10" icon={Radar} tone={demand?.config.enabled ? "amber" : "zinc"}
            right={
              <span className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5">
                  <Switch checked={!!demand?.config.enabled} onCheckedChange={(v) => void demandToggle(v)} disabled={mcxBusy} aria-label="Переключить автопилот спроса" data-testid="demand-toggle" />
                  <span className={demand?.config.enabled ? "text-amber-300" : "text-zinc-500"}>{demand ? (demand.config.enabled ? "вкл" : "выкл") : "—"}</span>
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title={`кап автопилота=${demand?.config.max ?? "—"}, тиков=${demand?.ticks ?? "—"}`}>max {demand?.config.max ?? "—"}</span>
                <button type="button" onClick={() => void demandTick()} disabled={mcxBusy} aria-label="Выполнить тик автопилота спроса" className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">tick</button>
              </span>
            }
          >
            <div className="flex flex-wrap gap-1">
              <Chip label="ready" value={demand?.snapshot.ready_count ?? "—"} tone="zinc" title="READY-бэклог — живой спрос на мощности" />
              <Chip label="leases" value={`${demand?.snapshot.pool_leases ?? "—"}/${demand?.snapshot.pool_max ?? "—"}`} tone="cyan" title="lease'ов пула / капа пула" />
              <Chip label="fails 15м" value={demand?.snapshot.fails_15m ?? "—"} tone={(demand?.snapshot.fails_15m ?? 0) > 0 ? "amber" : "zinc"} title="шторм отказов за 15 минут" />
              <Chip label="breaker" value={demand?.snapshot.breaker_open ? "OPEN" : "closed"} tone={demand?.snapshot.breaker_open ? "rose" : "emerald"} title="при OPEN breaker создание чата отложено — новый чат без LLM мёртв" />
              <Chip label="research" value={demand?.snapshot.ready_research ?? "—"} tone="zinc" title="RESEARCH-голод среди READY-задач" />
              <Chip label="chats" value={demand?.snapshot.active_chats ?? "—"} tone="zinc" title="активных чатов" />
            </div>
            {demand?.last_decision && (
              <p data-testid="demand-last" className={`mt-1.5 truncate rounded bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px] ${demand.last_decision.action === "created" ? "text-emerald-300" : demand.last_decision.action === "suppressed" ? "text-amber-300" : "text-zinc-400"}`} title={demand.decisions.slice(0, 5).map((d) => `${d.ts.slice(11, 19)} ${d.action}${d.signal ? ` [${d.signal}]` : ""}: ${d.detail}`).join("\n")}>
                {demand.last_decision.ts.slice(11, 19)} {demand.last_decision.action}{demand.last_decision.signal ? ` · ${demand.last_decision.signal}` : ""}{demand.last_decision.role ? ` · ${demand.last_decision.role}` : ""} — {demand.last_decision.detail}
              </p>
            )}
            {!demand && <div className="mt-1.5 rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка /demand…</div>}
          </Sec>

          <Sec id="sup-brain" title={`BRAIN${brain ? ` · мыслей ${brain.thoughts.length}` : ""}`} icon={Brain} tone="violet"
            right={<span className="font-mono text-[9px] text-zinc-600" title="self-probe: латентность event-loop + БД">{brain ? `loop ${brain.probe.eventloop_ms}мс · db ${brain.probe.db_probe_ms}мс` : ""}</span>}
          >
            <form onSubmit={(e) => { e.preventDefault(); void thinkGoal(); }} className="mb-1.5 flex gap-1.5">
              <Input value={brainGoal} onChange={(e) => setBrainGoal(e.target.value)} placeholder="цель для brain: план с учётом памяти…" className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]" aria-label="Цель для brain" />
              <Button type="submit" size="sm" variant="outline" disabled={mcxBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]">думать</Button>
            </form>
            {thought && (
              <div className="mb-1.5 rounded border border-fuchsia-900/40 bg-fuchsia-950/20 p-1.5 font-mono text-[9px]" aria-live="polite">
                <div className="mb-0.5 text-zinc-400" title={thought.goal}>{thought.summary}</div>
                {thought.steps.slice(0, 4).map((s, i) => (
                  <div key={i} className="flex gap-1 text-zinc-500"><span className="shrink-0 text-fuchsia-400/70">{i + 1}.</span><span className="min-w-0 flex-1 truncate">{s}</span></div>
                ))}
                {thought.risks.length > 0 && (
                  <div className="mt-0.5 text-amber-300/80" title={thought.risks.join("; ")}>⚠ риски: {thought.risks.slice(0, 2).join(" · ")}</div>
                )}
                <div className="mt-0.5 text-zinc-600">{thought.ms}мс · памяти использовано: {thought.memory_used.length}</div>
              </div>
            )}
            <div className="max-h-16 space-y-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
              {(brain?.thoughts ?? []).slice(0, 4).map((t) => (
                <div key={t.key} className="truncate rounded bg-zinc-900/50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500" title={t.content}>{t.content}</div>
              ))}
              {!brain && <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка /brain…</div>}
            </div>
          </Sec>

          <Sec id="sup-roadmap" title={`РОАДМАП M1–M7${rm ? ` · ${rm.done}/${rm.total}` : ""}`} icon={ListChecks} tone="emerald"
            right={
              <span className="flex shrink-0 items-center gap-1.5">
                {rm && (
                  <span className={`font-mono text-[10px] ${rm.done === rm.total ? "text-emerald-400" : "text-amber-400/90"}`} title="Вердикт вычисляется из живых подсистем (bus/codegraph/src-tauri/rerere/sandbox/worker/otel)">
                    {rm.done === rm.total ? "ЗАКРЫТ" : "в работе"}
                  </span>
                )}
                <button type="button" onClick={() => void loadRm()} disabled={mcxBusy} title="Перевычислить вердикт" aria-label="Перевычислить вердикт роадмапа" className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                </button>
              </span>
            }
          >
            <div className="space-y-1.5" role="list" aria-label="Фазы роадмапа M1–M7">
              {(rm?.milestones ?? []).map((m) => (
                <div key={m.key} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5" role="listitem">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.status === "DONE" ? "bg-emerald-400" : m.status === "PARTIAL" ? "bg-amber-400" : "bg-rose-500"}`} aria-hidden />
                    <span className="shrink-0 font-mono text-[10px] font-semibold text-zinc-300">{m.key}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400" title={m.title}>{m.title}</span>
                    <span className={`shrink-0 font-mono text-[9px] uppercase ${m.status === "DONE" ? "text-emerald-500/90" : m.status === "PARTIAL" ? "text-amber-500/90" : "text-rose-400"}`}>
                      {m.status}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-3.5 font-mono text-[9px] leading-relaxed text-zinc-600" title={m.evidence}>
                    {m.evidence}
                  </div>
                  {m.checks.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 pl-3.5" title={`проверено: ${m.verifiedAt}`}>
                      {m.checks.map((c) => (
                        <span key={c.name} className={`font-mono text-[9px] ${c.pass ? "text-emerald-500/80" : "text-rose-400/90"}`}>{c.pass ? "✓" : "✗"} {c.name}</span>
                      ))}
                    </div>
                  )}
                  <div className="pl-3.5 font-mono text-[8px] text-zinc-700" title={`verifiedAt: ${m.verifiedAt}`}>verified {m.verifiedAt ? hhmmss(m.verifiedAt) : "—"}</div>
                </div>
              ))}
              {!rm && (
                <div className="px-2 py-3 text-center font-mono text-[10px] text-zinc-600">загрузка вердикта…</div>
              )}
              {rm?.closedAt && (
                <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-2 py-1.5 text-center font-mono text-[10px] text-emerald-400">
                  ✓ РОАДМАП ЗАКРЫТ · {new Date(rm.closedAt).toLocaleString("ru-RU")}
                </div>
              )}
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
