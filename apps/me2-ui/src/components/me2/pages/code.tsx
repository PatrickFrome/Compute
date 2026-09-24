"use client";
// ── ME2 PAGE: CODE — код · exec · edit · review · песочницы · граф кода (R74) ────
// Порт 1:1 из legacy МИССИЯ кол.3 (docs/legacy-mission-control.tsx.txt L3291–3998):
// cgOpen (L3291) · sbOpen (L3508) · exOpen (L3661) · rvOpen (L3787) · sbxOpen (L3884).
// Честность R74: SANDBOXES PLANE read-only — второй POST-хендлер /sandbox (op-switch
// create/exec/snapshot/restore/destroy) в daemon v0.57.1 МЁРТВ (перехватывается первым
// хендлером probe/run/config); кнопки операций отключены с честным тултипом, exec-попытка
// показывает реальную ошибку daemon'а (bad_op).

import { useCallback, useEffect, useState } from "react";
import { Boxes, GitBranch, Lock, Network, RefreshCw, ShieldCheck, Terminal } from "lucide-react";
import { me2Fetch } from "@/lib/me2-bus";
import { Chip, PageHeader, Sec } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";

// ── типы (зеркало daemon, перенос из legacy 1:1) ────────────────────────────────
type CGData = { ok: boolean; tier: string; generatedAt: string; scanMs: number; files: number; symbols: number; edges: number; externalImports: number; orphans: string[]; topFanIn: { path: string; inbound: number }[]; topFanOut: { path: string; outbound: number }[]; externalTop: { pkg: string; n: number }[]; truncated: boolean };
type CGImpact = { ok: boolean; file: string; found: boolean; direct: string[]; transitive: string[]; inboundRoot: number; note?: string };
type OtelData = { ok: boolean; spans: number; dropped: number; ringCap: number; stats: { name: string; n: number; err: number; avgMs: number; maxMs: number }[] };
type VDData = { ok: boolean; count: number; verdicts: { seq: number; task_id: string | null; at: string; reasons?: string[] }[] };
type WorktreeData = { ok: boolean; head: string; branch: string; worktrees: { worktrees: { name: string; branch: string; head: string; managed: boolean }[] }; rerere: { enabled: boolean | null; autoUpdate: boolean; cacheEntries: number; inConflict: boolean; remaining: string[] } };
// SANDBOXES PLANE (legacy SandboxData #1, L63) — worktree-песочницы
type PlaneData = { ok: boolean; sandboxes: { id: string; status: string; provider: string; createdAt: string; head: string; cmds: number; lastCmd: string | null; lastExit: number | null; diskKb?: number }[]; providers: Record<string, string>; snapshots: { file: string; sandboxId: string; bytes: number; sha256: string; createdAt: string }[] };
type SandboxRun = { id: string; cmd: string; exitCode: number; ok: boolean; ms: number; stdout: string; stderr: string; truncated: boolean; limit: string };
// EXEC/EDIT (legacy ExecData/FileData/ToolVerdict)
type ExecData = { ok: boolean; allowlist: string[]; roots: string[]; deny_rules: string[]; caps: { prlimit: boolean; timeout_max_ms: number; cmd_max_len: number; substitution: string }; counters: { runs: number; denied: number }; recent: { id: number; cmd: string; ok: boolean; exit: number | null; reason: string | null; ms: number | null; source: string }[] };
type FileData = { ok: boolean; counters: { applied: number; denied: number; rollbacks: number }; recent: { id: number; path: string; op: string; ok: boolean; reason: string | null; hunks: number | null; rollback_done: boolean; has_backup: boolean }[] };
type ToolVerdict = { ok: boolean; exit?: number | null; stdout_tail?: string; stderr_tail?: string; duration?: number; sandboxed?: boolean; limit?: string; reason?: string; detail?: string; rollback_at?: number | null; hunks?: number; applied?: boolean };
// REVIEW (legacy ReviewData)
type ReviewData = { ok: boolean; config: { enabled: boolean; llm_enabled: boolean; timeout_ms: number; queue_max: number; model: string }; stats_24h: Record<string, number>; queue: { pending: { id: number; cmd: string; cwd: string; reason: string; engine: string; created_at: number }[]; recent: { id: number; cmd: string; status: string; verdict: string; engine: string; run_ok: number | null; run_exit: number | null }[] } };
// SANDBOX OS (legacy SandboxData #2 — OS-конфайнмент, L70 — берём эту из двух деклараций)
type SandboxOSData = { ok: boolean; caps: { landlock_abi: number; userns_max: number; unshare_bin: boolean; seccomp_mode: number; fs_confinement: string; layers_available: string[]; verdict: string }; config: { auto_sandbox: boolean; net: string; strict: boolean; tmp_size: string }; counters: { runs: number; failed: number; escapes: number }; recent: { id: number; cmd: string; ok: boolean; exit: number | null; reason: string | null; ms: number | null }[] };
type SandboxProbeT = { ok: boolean; escape: boolean; ms: number; checks: { write_inside: { ok: boolean; detail: string }; write_outside_denied: { ok: boolean; detail: string }; net_denied: { ok: boolean; detail: string }; net_allow_control: { ok: boolean; detail: string } } };

// legacy L66 — demo-дифф петли edit→run→green
const EXEC_DEFAULT_DIFF = `--- /dev/null\n+++ p0a-demo.js\n@@ -0,0 +1,2 @@\n+console.log("me2-p0a: edit-run-green");\n+console.log("agent loop live");\n`;
// Честность R74: op-switch плоскости песочниц недостижим (первый /sandbox POST-хендлер отвечает probe/run/config)
const PLANE_LOCKED = "плоскость недоступна в daemon v0.57.1 (мёртвый маршрут /sandbox op-switch) — read-only";

export function CodePage() {
  const { toast } = useToast();

  // ── ГРАФ КОДА (legacy cgOpen L3291) ──
  const [cg, setCg] = useState<CGData | null>(null);
  const [cgBusy, setCgBusy] = useState(false);
  const [cgQuery, setCgQuery] = useState("");
  const [cgImpact, setCgImpact] = useState<CGImpact | null>(null);
  const [otel, setOtel] = useState<OtelData | null>(null);
  const [wt, setWt] = useState<WorktreeData | null>(null);
  const [vd, setVd] = useState<VDData | null>(null);
  const loadCg = useCallback(async (force = false) => {
    setCgBusy(true);
    try {
      const g = await me2Fetch<CGData>(`/codegraph?XTransformPort=3041${force ? "&force=1" : ""}`);
      if (g?.ok) setCg(g);
      const [o, w, v] = await Promise.all([
        me2Fetch<OtelData>("/spans?XTransformPort=3041"),
        me2Fetch<WorktreeData>("/worktrees?XTransformPort=3041"),
        me2Fetch<VDData>("/verdicts?XTransformPort=3041"),
      ]);
      if (o?.ok) setOtel(o);
      if (w?.ok) setWt(w);
      if (v?.ok) setVd(v);
    } finally { setCgBusy(false); }
  }, []);
  const runImpact = useCallback(async () => {
    const q = cgQuery.trim();
    if (!q) return;
    setCgBusy(true);
    try {
      const r = await me2Fetch<CGImpact>(`/codegraph/impact?XTransformPort=3041&file=${encodeURIComponent(q)}`);
      setCgImpact(r);
    } finally { setCgBusy(false); }
  }, [cgQuery]);
  const enableRerere = useCallback(async () => {
    setCgBusy(true);
    try {
      await fetch("/worktrees/rerere?XTransformPort=3041", { method: "POST" });
      const w = await me2Fetch<WorktreeData>("/worktrees?XTransformPort=3041");
      if (w?.ok) {
        setWt(w);
        toast({ title: "rerere включён", description: "git будет переиспользовать записанные разрешения конфликтов (M4)" });
      }
    } catch {
      toast({ title: "rerere ✗", description: "daemon недоступен", variant: "destructive" });
    } finally { setCgBusy(false); }
  }, [toast]);

  // ── EXEC/EDIT (legacy exOpen L3661) ──
  const [ex, setEx] = useState<ExecData | null>(null);
  const [fx, setFx] = useState<FileData | null>(null);
  const [exBusy, setExBusy] = useState(false);
  const [exCmd, setExCmd] = useState("node --version");
  const [exCwd, setExCwd] = useState("");
  const [exOut, setExOut] = useState<string | null>(null);
  const [exOk, setExOk] = useState<boolean | null>(null);
  const loadEx = useCallback(async () => {
    const [e, f] = await Promise.all([
      me2Fetch<ExecData>("/exec?XTransformPort=3041"),
      me2Fetch<FileData>("/file?XTransformPort=3041"),
    ]);
    if (e?.ok) setEx(e);
    if (f?.ok) setFx(f);
  }, []);
  const exRun = useCallback(async (cmd: string, cwd: string, label: string) => {
    setExBusy(true); setExOut(null);
    try {
      const v = await fetch("/exec?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "run", cmd, cwd }),
      }).then((r) => r.json()) as ToolVerdict;
      if (v?.ok) {
        setExOk(true);
        setExOut(`exit ${v.exit} · ${v.duration}мс · ${v.limit}\n${v.stdout_tail || "(stdout пуст)"}${v.stderr_tail ? `\n[stderr] ${v.stderr_tail}` : ""}`);
        toast({ title: label });
      } else {
        setExOk(false);
        setExOut(`отказ: ${v?.reason}${v?.detail ? `\n${v.detail}` : ""}`);
        toast({ title: `${label} ✗ · ${v?.reason}`, description: v?.detail, variant: "destructive" });
      }
      await loadEx();
      return v;
    } catch {
      setExOk(false); setExOut("daemon недоступен");
      toast({ title: "exec ✗", description: "daemon недоступен", variant: "destructive" });
      return null;
    } finally { setExBusy(false); }
  }, [loadEx, toast]);
  const fileApply = useCallback(async (path: string, diff: string, label: string) => {
    setExBusy(true);
    try {
      const v = await fetch("/file?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "apply", path, diff }),
      }).then((r) => r.json()) as ToolVerdict;
      if (v?.ok) { toast({ title: `${label} · hunks ${v.hunks ?? "—"}` }); await loadEx(); return v; }
      toast({ title: `${label} ✗ · ${v?.reason}`, description: v?.detail, variant: "destructive" });
      return null;
    } catch { toast({ title: "file ✗", description: "daemon недоступен", variant: "destructive" }); return null; }
    finally { setExBusy(false); }
  }, [loadEx, toast]);
  const fileRollback = useCallback(async (editId: number) => {
    setExBusy(true);
    try {
      const v = await fetch("/file?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "rollback", edit_id: editId }),
      }).then((r) => r.json()) as ToolVerdict;
      if (v?.ok) { toast({ title: "rollback выполнен (байт-в-байт из журнала)" }); await loadEx(); }
      else toast({ title: `rollback ✗ · ${v?.reason}`, description: v?.detail, variant: "destructive" });
    } catch { toast({ title: "rollback ✗", description: "daemon недоступен", variant: "destructive" }); }
    finally { setExBusy(false); }
  }, [loadEx, toast]);
  const exDemo = useCallback(async () => {
    const cwd = exCwd.trim();
    if (!cwd) { toast({ title: "нужен cwd (управляемый корень)", description: "каталог внутри песочницы или worktree", variant: "destructive" }); return; }
    const fname = `p0a-demo-${Date.now().toString(36)}.js`;
    const diff = EXEC_DEFAULT_DIFF.replace("p0a-demo.js", fname);
    const applied = await fileApply(`${cwd}/${fname}`, diff, "FILE_EDIT create");
    if (!applied) return;
    const run = await exRun(`bun ${fname}`, cwd, "TERMINAL_RUN bun");
    if (run?.ok) toast({ title: "edit→run→green ✓", description: applied.rollback_at ? `rollback доступен (edit_id ${applied.rollback_at})` : undefined });
  }, [exCwd, fileApply, exRun, toast]);

  // ── RUN MODES / REVIEW (legacy rvOpen L3787) ──
  const [rv, setRv] = useState<ReviewData | null>(null);
  const [rvBusy, setRvBusy] = useState(false);
  const loadRv = useCallback(async () => {
    const r = await me2Fetch<ReviewData>("/review?XTransformPort=3041");
    if (r?.ok) setRv(r);
  }, []);
  const rvDecide = useCallback(async (op: "approve" | "deny", id: number) => {
    setRvBusy(true);
    try {
      const v = await fetch("/review?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, id }),
      }).then((r) => r.json()) as ToolVerdict & { approved?: boolean; denied?: boolean; run?: ToolVerdict };
      if (v?.ok) {
        if (op === "approve" && v.run) {
          const r = v.run;
          toast({ title: r.ok ? `одобрено · exit ${r.exit} · ${r.duration}мс` : `одобрено, прогон не удался: ${r.reason ?? "?"}`, description: r.ok ? (r.stdout_tail || undefined)?.slice(0, 120) : r.detail, variant: r.ok ? "default" : "destructive" });
        } else {
          toast({ title: `#${id} отклонено` });
        }
      } else {
        toast({ title: "review ✗", description: String(v?.reason ?? v?.detail ?? "ошибка"), variant: "destructive" });
      }
      await loadRv();
      await loadEx();
    } catch { toast({ title: "review ✗", description: "daemon недоступен", variant: "destructive" }); }
    finally { setRvBusy(false); }
  }, [loadRv, loadEx, toast]);

  // ── SANDBOX OS (legacy sbxOpen L3884 — OS-конфайнмент ns+seccomp) ──
  const [sbx, setSbx] = useState<SandboxOSData | null>(null);
  const [sbxProbeRes, setSbxProbeRes] = useState<SandboxProbeT | null>(null);
  const [sbxBusy, setSbxBusy] = useState(false);
  const [sbxCmd, setSbxCmd] = useState("echo sandbox-ok");
  const [sbxCwd, setSbxCwd] = useState("");
  const loadSbx = useCallback(async () => {
    const r = await me2Fetch<SandboxOSData>("/sandbox?XTransformPort=3041");
    if (r?.ok) setSbx(r);
  }, []);
  const sbxAction = useCallback(async (op: "probe" | "run", cmd?: string, cwd?: string) => {
    setSbxBusy(true);
    try {
      const body = op === "probe" ? { op: "probe" } : { op: "run", cmd, cwd };
      const v = await fetch("/sandbox?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()) as SandboxProbeT & ToolVerdict & { sandbox?: { strict_ok: boolean; net: string; layers: Record<string, string | boolean> } };
      if (op === "probe") {
        setSbxProbeRes(v as SandboxProbeT);
        toast({ title: (v as SandboxProbeT).ok ? "probe: конфайнмент подтверждён (4/4)" : (v as SandboxProbeT).escape ? "probe: ЭСКАПИРОВАНО!" : "probe: есть провалы — смотри детали", variant: (v as SandboxProbeT).ok ? "default" : "destructive" });
      } else {
        const strictFail = v.sandbox && v.sandbox.strict_ok === false;
        toast({ title: strictFail ? "sandbox_failed — команда НЕ исполнена" : v.ok ? `sandbox run ok · exit ${v.exit} · ${v.duration}мс` : `прогон в сандбоксе: exit ${v.exit}`, description: (v.stdout_tail || v.stderr_tail || "").slice(0, 140) || v.detail, variant: strictFail ? "destructive" : v.ok ? "default" : "destructive" });
      }
      await loadSbx();
    } catch { toast({ title: "sandbox ✗", description: "daemon недоступен", variant: "destructive" }); }
    finally { setSbxBusy(false); }
  }, [loadSbx, toast]);

  // ── SANDBOXES PLANE (legacy sbOpen L3508; R74 честность: op-switch мёртв) ──
  const [sb, setSb] = useState<PlaneData | null>(null);
  const [sbBusy, setSbBusy] = useState(false);
  const [sbCmd, setSbCmd] = useState("");
  const [sbRun, setSbRun] = useState<SandboxRun | null>(null);
  const loadSb = useCallback(async () => {
    const r = await me2Fetch<PlaneData>("/sandboxes?XTransformPort=3041");
    if (r?.ok) setSb(r);
  }, []);
  const sbExec = useCallback(async (id: string, cmd: string) => {
    setSbBusy(true);
    try {
      // попытка честного exec: op-switch в daemon мёртв — ожидаем bad_op и показываем это
      const r = await fetch("/sandbox?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "exec", id, cmd, timeoutSec: 30 }),
      });
      const res = (await r.json().catch(() => null)) as ({ ok: boolean; run?: SandboxRun; error?: string; allowed?: string[] } | null);
      if (res?.ok && res.run) setSbRun(res.run);
      else {
        setSbRun(null);
        toast({
          title: "sandbox exec ✗",
          description: res?.error ? `${res.error}${res.allowed ? ` (allowed: ${res.allowed.join(" | ")}) — маршрут мёртв` : ""}` : `HTTP ${r.status} — ${PLANE_LOCKED}`,
          variant: "destructive",
        });
      }
      await loadSb();
    } catch { toast({ title: "sandbox exec ✗", description: `daemon недоступен — ${PLANE_LOCKED}`, variant: "destructive" }); }
    finally { setSbBusy(false); }
  }, [loadSb, toast]);

  // ── поллинги (cleanup при размонтировании страницы) ──
  useEffect(() => { void loadCg(); }, [loadCg]);
  useEffect(() => {
    void loadEx();
    const iv = setInterval(() => void loadEx(), 15_000);
    return () => clearInterval(iv);
  }, [loadEx]);
  useEffect(() => {
    void loadRv();
    const iv = setInterval(() => void loadRv(), 12_000);
    return () => clearInterval(iv);
  }, [loadRv]);
  useEffect(() => {
    void loadSbx();
    const iv = setInterval(() => void loadSbx(), 15_000);
    return () => clearInterval(iv);
  }, [loadSbx]);
  useEffect(() => {
    void loadSb();
    const iv = setInterval(() => void loadSb(), 10_000);
    return () => clearInterval(iv);
  }, [loadSb]);

  const refreshBtn = (onClick: () => void, busy: boolean, label: string) => (
    <button type="button" onClick={onClick} disabled={busy} title={label} aria-label={label}
      className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40">
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-code" data-panel-code>
      <PageHeader title="CODE" sub="exec · edit · review · песочницы · worktrees · граф кода" />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2">
        {/* кол.1: граф кода · exec/edit · review */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="code-codegraph" title="ГРАФ КОДА" icon={Network} tone="teal"
            right={<>
              {cg && <span className="font-mono text-[10px] text-zinc-500" title={`regex-tier v1 · детерминированный скан src/ + me2-daemon · сгенерирован ${new Date(cg.generatedAt).toLocaleTimeString("ru-RU", { hour12: false })}`}>{cg.symbols} эксп · {cg.edges} рёбер</span>}
              {refreshBtn(() => void loadCg(true), cgBusy, "Пересканировать репозиторий (force=1)")}
            </>}>
            <div data-testid="codegraph" className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Метрики графа кода">
                <Chip label="files" value={cg?.files ?? "—"} tone="teal" />
                <Chip label="symbols" value={cg?.symbols ?? "—"} />
                <Chip label="edges" value={cg?.edges ?? "—"} />
                <Chip label="scanMs" value={cg?.scanMs ?? "—"} />
                <Chip label="tier" value={cg?.tier ?? "—"} title="regex-tier v1 · tree-sitter — drop-in v2" />
                <Chip label="ext-imports" value={cg?.externalImports ?? "—"} />
                <Chip label="orphans" value={cg?.orphans.length ?? "—"} tone={(cg?.orphans.length ?? 0) > 0 ? "amber" : "zinc"} title={cg?.orphans.slice(0, 12).join("\n") || "нет файлов без входящих рёбер"} />
              </div>

              <form onSubmit={(e) => { e.preventDefault(); void runImpact(); }} className="flex gap-2">
                <input value={cgQuery} onChange={(e) => setCgQuery(e.target.value)} placeholder="impact: src/lib/db или src/app/page.tsx" aria-label="Файл для impact-анализа"
                  className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900" />
                <button type="submit" disabled={cgBusy} className="h-7 shrink-0 rounded border border-zinc-700 px-2 font-mono text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">кто зависит</button>
              </form>
              {cgImpact && (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px]" aria-live="polite">
                  {cgImpact.found ? (
                    <>
                      <div className="mb-1 text-zinc-300">{cgImpact.file} · входящих рёбер {cgImpact.inboundRoot}</div>
                      <div className="max-h-28 overflow-y-auto text-zinc-500">
                        <div>прямые: {cgImpact.direct.length ? cgImpact.direct.join(", ") : "—"}</div>
                        <div className="mt-1">транзитивно ({cgImpact.transitive.length}): {cgImpact.transitive.slice(0, 40).join(", ")}{cgImpact.transitive.length > 40 ? "…" : ""}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-amber-500/80">{cgImpact.note}</div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">top fan-in</div>
                  <ul className="space-y-0.5 font-mono text-[10px] text-zinc-400">
                    {(cg?.topFanIn ?? []).slice(0, 5).map((f) => (
                      <li key={f.path} className="flex justify-between gap-2"><span className="truncate" title={f.path}>{f.path}</span><span className="shrink-0 text-teal-400">{f.inbound}</span></li>
                    ))}
                    {!cg && <li className="text-zinc-600">—</li>}
                  </ul>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">top fan-out</div>
                  <ul className="space-y-0.5 font-mono text-[10px] text-zinc-400">
                    {(cg?.topFanOut ?? []).slice(0, 5).map((f) => (
                      <li key={f.path} className="flex justify-between gap-2"><span className="truncate" title={f.path}>{f.path}</span><span className="shrink-0 text-amber-400/90">{f.outbound}</span></li>
                    ))}
                    {!cg && <li className="text-zinc-600">—</li>}
                  </ul>
                </div>
              </div>

              {(cg?.externalTop.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5" title="внешние пакеты (npm) по числу импортов">
                  {(cg?.externalTop ?? []).slice(0, 6).map((x) => (
                    <Chip key={x.pkg} label={x.pkg} value={x.n} />
                  ))}
                </div>
              )}

              {wt && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-[10px] text-zinc-500">
                  <GitBranch className="h-3 w-3 shrink-0 text-fuchsia-400" aria-hidden />
                  <span>worktrees {wt.worktrees.worktrees.length} · HEAD {wt.head}</span>
                  <span className={wt.rerere.enabled ? "text-emerald-400" : "text-amber-500/80"} title="rerere — переиспользование записанных разрешений конфликтов (M4)">
                    rerere {wt.rerere.enabled ? "on" : "off"} · cache {wt.rerere.cacheEntries}
                  </span>
                  {!wt.rerere.enabled && (
                    <button type="button" onClick={() => void enableRerere()} disabled={cgBusy}
                      className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">
                      включить
                    </button>
                  )}
                </div>
              )}

              {otel && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500"
                  title="OTel-lite: спаны команд шины и задач; OTLP-JSON на /spans/otlp (совместимо с Perfetto-конвертерами)">
                  <span className="uppercase tracking-wider text-zinc-600">otel-lite</span>
                  <span>спанов {otel.spans}/{otel.ringCap}</span>
                  {vd && (
                    <span className={vd.count > 0 ? "text-rose-400/90" : "text-zinc-600"}
                      title="Reward-hacking вердикты (tier-1): finish без реальной работы. Подозрение не меняет статус задачи — решает оператор (/verdicts)">
                      вердиктов RH: {vd.count}
                    </span>
                  )}
                  {(otel.stats ?? []).slice(0, 3).map((s) => (
                    <span key={s.name} className={s.err ? "text-rose-400/80" : ""}>{s.name} ×{s.n} · ⌀{s.avgMs}ms{s.err ? ` · err ${s.err}` : ""}</span>
                  ))}
                </div>
              )}
            </div>
          </Sec>

          <Sec id="code-exec" title="EXEC · EDIT" icon={Terminal} tone="emerald"
            right={<>
              {ex && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="белый список бинарей по сегментам · prlimit as=4GiB/nofile=256/core=0 · cwd только в песочницах/worktrees">run {ex.counters.runs} · отказ {ex.counters.denied}{fx ? ` · edit ${fx.counters.applied}` : ""}</span>}
              {refreshBtn(() => void loadEx(), exBusy, "Обновить статус exec/edit-плоскостей")}
            </>}>
            <div data-testid="exec-log" className="space-y-2.5">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-zinc-600" title="Enforcement-цепочка P0-a: allowlist по сегментам → prlimit → таймаут → env-белый-список">
                <span className={ex?.caps.prlimit ? "text-emerald-500/80" : "text-rose-400"}>prlimit {ex?.caps.prlimit ? "✓ as=4GiB·nofile=256·core=0" : "✗"}</span>
                <span>timeout ≤ {ex ? ex.caps.timeout_max_ms / 1000 : "?"}с</span>
                <span>подстановки $() {ex?.caps.substitution === "denied" ? "запрещены" : "?"}</span>
                <span className="hidden sm:inline" title={(ex?.allowlist ?? []).join(", ")}>allowlist {ex?.allowlist.length ?? "—"}</span>
                <span className="hidden sm:inline" title={(ex?.roots ?? []).join("\n")}>roots {ex?.roots.length ?? "—"}</span>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); const cmd = exCmd.trim(); const cwd = exCwd.trim(); if (cmd && cwd) void exRun(cmd, cwd, "TERMINAL_RUN"); }} className="space-y-1.5">
                <input value={exCmd} onChange={(e) => setExCmd(e.target.value)} placeholder="команда: git status | bun test (curl/bash/$() отклоняются)" aria-label="Команда TERMINAL_RUN (белый список бинарей)"
                  className="h-7 w-full rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-emerald-900" />
                <div className="flex gap-2">
                  <input value={exCwd} onChange={(e) => setExCwd(e.target.value)} placeholder="cwd: управляемый корень (roots)" aria-label="Рабочий каталог (управляемый корень)" list="exec-roots"
                    className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-emerald-900" />
                  <datalist id="exec-roots">
                    {(ex?.roots ?? []).map((r) => <option key={r} value={r} />)}
                  </datalist>
                  <button type="submit" disabled={exBusy} className="h-7 shrink-0 rounded border border-zinc-700 px-2 font-mono text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">▶ run</button>
                  <button type="button" disabled={exBusy} onClick={() => void exDemo()} title="FILE_EDIT создаёт p0a-demo.js → TERMINAL_RUN bun → зелёный вывод (петля Cursor edit→run→green)"
                    className="h-7 shrink-0 rounded border border-zinc-700 px-2 font-mono text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">demo</button>
                </div>
              </form>

              {exOut !== null && (
                <div className={`rounded-md border p-2 font-mono text-[10px] ${exOk ? "border-zinc-800 bg-zinc-950/60" : "border-rose-900/50 bg-rose-950/20"}`} aria-live="polite">
                  <pre tabIndex={0} role="region" aria-label="Вывод команды" className={`max-h-28 overflow-y-auto mc-scroll whitespace-pre-wrap font-mono ${exOk ? "text-zinc-500" : "text-rose-400/80"}`}>{exOut}</pre>
                </div>
              )}

              {(ex?.recent.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600">последние прогоны (журнал exec_runs)</div>
                  <div tabIndex={0} role="region" aria-label="Журнал прогонов" className="max-h-24 space-y-1 overflow-y-auto mc-scroll">
                    {ex?.recent.slice(0, 6).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px]">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? "bg-emerald-400" : "bg-rose-500"}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-zinc-500" title={r.cmd}>$ {r.cmd}</span>
                        <span className="shrink-0 text-zinc-600">{r.ok ? `exit ${r.exit}` : r.reason} · {r.ms}мс</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(fx?.recent.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600">правки (журнал file_edits · durable rollback)</div>
                  <div tabIndex={0} role="region" aria-label="Журнал правок" className="max-h-24 space-y-1 overflow-y-auto mc-scroll">
                    {fx?.recent.slice(0, 6).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px]">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? (r.rollback_done ? "bg-zinc-500" : "bg-cyan-400") : "bg-rose-500"}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-zinc-500" title={r.path}>{r.path.split("/").pop()}</span>
                        <span className="shrink-0 text-zinc-600">{r.op}{r.hunks ? ` · ${r.hunks}h` : ""}{r.ok && !r.rollback_done && r.op === "apply" ? (r.has_backup ? " · backup жив" : " · создание (без бэкапа)") : r.rollback_done ? " · откачено" : ""}</span>
                        {r.ok && r.op === "apply" && !r.rollback_done && r.has_backup && (
                          <button type="button" onClick={() => void fileRollback(r.id)} disabled={exBusy} title="Восстановить исходное содержимое байт-в-байт из журнала (durable-rollback)"
                            className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">↩ откат</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Sec>

          <Sec id="code-review" title="RUN MODES / REVIEW" icon={ShieldCheck} tone="amber"
            right={<>
              {rv && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="канон Cursor D02: allowlist → prlimit → classifier; классификатор НЕ security boundary; ask ждёт оператора">ask {rv.stats_24h.CLASSIFIER_ASK ?? 0} · block {rv.stats_24h.CLASSIFIER_BLOCK ?? 0} · ✓{rv.stats_24h.CLASSIFIER_APPROVED ?? 0} ✗{rv.stats_24h.CLASSIFIER_DENIED ?? 0}</span>}
              {refreshBtn(() => void loadRv(), rvBusy, "Обновить статус классификатора и очереди одобрений")}
            </>}>
            <div data-testid="review-queue" className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5" title="Канон Cursor Auto-review (корпус R61 D02): вердикты allow/ask/block; эвристика детерминированная; LLM — opt-in (policy.json classifier), таймаут → ask (fail-closed)">
                <Chip label="тир-3" value={rv ? (rv.config.enabled ? "вкл" : "выкл (policy)") : "—"} tone={rv?.config.enabled ? "emerald" : "zinc"} />
                <Chip label="LLM" value={rv ? (rv.config.llm_enabled ? `вкл (${rv.config.model})` : "выкл (эвристика)") : "—"} tone={rv?.config.llm_enabled ? "violet" : "zinc"} title={rv ? `таймаут ≤ ${rv.config.timeout_ms}мс` : undefined} />
                <Chip label="queue ≤" value={rv?.config.queue_max ?? "—"} />
                <Chip label="граница" value="не security" tone="amber" title="Cursor: «explicitly NOT a security boundary»; security = tier-1 allowlist + prlimit + P0-2" />
              </div>

              {(rv?.queue.pending.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-amber-500/80">ждут оператора (ask → одобрение; канон Approvals UI Cursor)</div>
                  <div tabIndex={0} role="region" aria-label="Очередь одобрений" className="max-h-28 space-y-1 overflow-y-auto mc-scroll">
                    {rv?.queue.pending.map((p) => (
                      <div key={p.id} className="rounded border border-amber-900/40 bg-amber-950/10 px-2 py-1.5 font-mono text-[9px]">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-zinc-400" title={p.cmd}>$ {p.cmd}</span>
                          <button type="button" onClick={() => void rvDecide("approve", p.id)} disabled={rvBusy} title="Исполнить команду (POST /review op:approve — tier-1 остаётся)"
                            className="shrink-0 rounded border border-emerald-800/60 px-1.5 py-0.5 text-[9px] text-emerald-400 transition hover:bg-emerald-950/40 disabled:opacity-40">✓</button>
                          <button type="button" onClick={() => void rvDecide("deny", p.id)} disabled={rvBusy} title="Отклонить команду (POST /review op:deny)"
                            className="shrink-0 rounded border border-rose-900/60 px-1.5 py-0.5 text-[9px] text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-40">✗</button>
                        </div>
                        <div className="mt-0.5 truncate text-zinc-600" title={p.reason}>{p.engine} · {p.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5 font-mono text-[9px] text-zinc-600">
                  очередь пуста — команды ask из /exec попадают сюда на одобрение; block отказывается сразу (CLASSIFIER_BLOCK в hash-chain)
                </div>
              )}

              {(rv?.queue.recent.filter((r) => r.status !== "pending").length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600">разрешения (журнал review_queue)</div>
                  <div tabIndex={0} role="region" aria-label="Журнал очереди" className="max-h-24 space-y-1 overflow-y-auto mc-scroll">
                    {rv?.queue.recent.filter((r) => r.status !== "pending").slice(0, 6).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px]">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.status === "executed" ? "bg-emerald-400" : r.status === "denied" ? "bg-rose-500" : "bg-zinc-500"}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-zinc-500" title={r.cmd}>$ {r.cmd}</span>
                        <span className="shrink-0 text-zinc-600">{r.status}{r.status === "executed" ? ` · exit ${r.run_exit}` : ""} · {r.engine}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Sec>
        </div>

        {/* кол.2: sandbox OS · sandboxes plane */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="code-sandbox-os" title="SANDBOX OS" icon={Lock} tone="teal"
            right={<>
              {sbx && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="слои R64: ns (userns+mountns: ro-root, rw-rebind, hide-секретов) + seccomp (deny-лист + net=deny); Landlock ≥5.13 — честный skip на 5.10; strict fail-closed">слои {sbx.caps.layers_available.join("+")} · net {sbx.config.net} · runs {sbx.counters.runs}</span>}
              {refreshBtn(() => void loadSbx(), sbxBusy, "Обновить статус сандбокса")}
            </>}>
            <div data-testid="sandbox-probe" className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5" title="Landlock появился в ядре 5.13 — здесь 5.10 → честный skip; конфайнмент несёт ns+seccomp; strict: обязательные слои не применились → команда НЕ исполнена">
                <Chip label="landlock ABI" value={sbx?.caps.landlock_abi ?? "—"} />
                <Chip label="userns" value={sbx?.caps.userns_max ?? "—"} />
                <Chip label="seccomp" value={sbx?.caps.seccomp_mode ?? "—"} />
                <Chip label="fs" value={sbx?.caps.fs_confinement ?? "—"} />
                <Chip label="verdict" value={sbx?.caps.verdict ?? "—"} tone={sbx?.caps.verdict === "sandboxable" ? "emerald" : "amber"} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip label="auto_sandbox" value={sbx ? (sbx.config.auto_sandbox ? "вкл" : "выкл") : "—"} tone={sbx?.config.auto_sandbox ? "teal" : "zinc"} title="канон D02: tier-2 sandbox-ability резолвит fs-риски до classifier" />
                <Chip label="net" value={sbx?.config.net ?? "—"} />
                <Chip label="strict" value={sbx ? (sbx.config.strict ? "вкл" : "выкл") : "—"} tone={sbx?.config.strict ? "emerald" : "amber"} title="strict fail-closed" />
                <Chip label="runs" value={sbx?.counters.runs ?? "—"} />
                <Chip label="failed" value={sbx?.counters.failed ?? "—"} tone={(sbx?.counters.failed ?? 0) > 0 ? "amber" : "zinc"} />
                <Chip label="escape" value={sbx?.counters.escapes ?? "—"} tone={(sbx?.counters.escapes ?? 0) > 0 ? "rose" : "zinc"} />
              </div>

              {sbxProbeRes && (
                <div className={`rounded border px-2 py-1.5 font-mono text-[9px] ${sbxProbeRes.ok ? "border-teal-900/50 bg-teal-950/20 text-teal-300/90" : "border-rose-900/50 bg-rose-950/20 text-rose-300/90"}`}>
                  probe {sbxProbeRes.ok ? "✓ 4/4" : "✗"}{sbxProbeRes.escape ? " · ЭСКАПИРОВАНО!" : ""} · {sbxProbeRes.ms}мс ·{" "}
                  <span title={sbxProbeRes.checks.write_inside.detail}>внутрь {sbxProbeRes.checks.write_inside.ok ? "✓" : "✗"}</span> ·{" "}
                  <span title={sbxProbeRes.checks.write_outside_denied.detail}>секреты {sbxProbeRes.checks.write_outside_denied.ok ? "скрыты ✓" : "✗"}</span> ·{" "}
                  <span title={sbxProbeRes.checks.net_denied.detail}>сеть {sbxProbeRes.checks.net_denied.ok ? "EPERM ✓" : "✗"}</span> ·{" "}
                  <span title={sbxProbeRes.checks.net_allow_control.detail}>контроль {sbxProbeRes.checks.net_allow_control.ok ? "✓" : "✗"}</span>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex gap-1.5">
                  <input value={sbxCmd} onChange={(e) => setSbxCmd(e.target.value)} placeholder="команда (белый список)…" aria-label="Команда для запуска в сандбоксе"
                    className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900" />
                  <input value={sbxCwd} onChange={(e) => setSbxCwd(e.target.value)} placeholder="cwd…" aria-label="cwd в управляемом корне" list="exec-roots"
                    className="w-28 shrink-0 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900 sm:w-40" />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => void sbxAction("run", sbxCmd, sbxCwd)} disabled={sbxBusy || !sbxCmd || !sbxCwd}
                    title="Запуск в сандбоксе: tier-1 план → unshare userns+mountns → ro-root/rw-rebind/hide → seccomp net=deny (POST /sandbox op:run)"
                    className="rounded border border-teal-800/60 px-2 py-1 text-[10px] text-teal-300 transition hover:bg-teal-950/40 disabled:opacity-40">В сандбоксе</button>
                  <button type="button" onClick={() => void sbxAction("probe")} disabled={sbxBusy}
                    title="Живая верификация: запись внутрь ok · запись в секреты отказ · сеть EPERM · контроль net=allow (POST /sandbox op:probe)"
                    className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">Probe</button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[9px] uppercase tracking-wider text-zinc-600">sandbox-прогоны (exec_runs sandboxed=1)</div>
                <div tabIndex={0} role="region" aria-label="Журнал sandbox-прогонов" className="max-h-24 space-y-1 overflow-y-auto mc-scroll">
                  {(sbx?.recent ?? []).map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px]">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? "bg-teal-400" : "bg-rose-500"}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-zinc-500" title={r.cmd}>$ {r.cmd}</span>
                      <span className="shrink-0 text-zinc-600">{r.ok ? `exit ${r.exit}` : r.reason || "fail"} · {r.ms ?? 0}мс</span>
                    </div>
                  ))}
                  {(sbx?.recent.length ?? 0) === 0 && (
                    <div className="rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5 font-mono text-[9px] text-zinc-600">
                      прогов ещё не было — Probe верифицирует конфайнмент живыми негативами (секреты/сеть)
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Sec>

          <Sec id="code-sandboxes-plane" title="SANDBOXES PLANE" icon={Boxes} tone="cyan"
            right={<>
              {sb && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="local: git worktree + prlimit + tar.gz sha256 · vercel: нужен SANDBOX_VERCEL_TOKEN">{sb.sandboxes.length} шт · local:{sb.providers.local === "READY" ? "✓" : "?"}</span>}
              {refreshBtn(() => void loadSb(), sbBusy, "Обновить список песочниц")}
            </>}>
            <div data-testid="sandboxes-plane" className="space-y-2.5">
              <div className="rounded border border-amber-900/40 bg-amber-950/10 px-2 py-1.5 font-mono text-[9px] text-amber-300/80">
                read-only: операции create/exec/snapshot/restore/destroy шли через POST /sandbox op-switch — в daemon v0.57.1 этот хендлер МЁРТВ (перехватывается первым /sandbox-хендлером probe/run/config). Кнопки отключены честно; exec-попытка показывает ошибку daemon'а.
              </div>

              <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                <input disabled placeholder="имя: r18-fix (a-z0-9._-)" aria-label="Имя новой песочницы (недоступно)" title={PLANE_LOCKED}
                  className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/40 px-2 font-mono text-[11px] text-zinc-500 placeholder:text-zinc-700" />
                <button type="submit" disabled title={`create: ${PLANE_LOCKED}`}
                  className="h-7 shrink-0 rounded border border-zinc-800 px-2 font-mono text-[10px] text-zinc-600 disabled:opacity-40">+ создать</button>
              </form>

              <div className="space-y-1.5" aria-label="Активные песочницы">
                {(sb?.sandboxes ?? []).map((s) => (
                  <div key={s.id} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "READY" ? "bg-emerald-400" : s.status === "RESTORED" ? "bg-cyan-400" : "bg-rose-500"}`} aria-hidden />
                      <span className="shrink-0 font-semibold text-zinc-300">{s.id}</span>
                      <span className="text-zinc-600">{s.provider}</span>
                      <span className="text-zinc-600" title={`HEAD ${s.head} · ${s.status} · создана ${s.createdAt}`}>{s.head.slice(0, 7)}</span>
                      <span className="text-zinc-600">· cmds {s.cmds}</span>
                      {typeof s.diskKb === "number" && <span className="text-zinc-600">· {(s.diskKb / 1024).toFixed(1)} МБ</span>}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <button type="button" disabled title={`снапшот (tar.gz + sha256): ${PLANE_LOCKED}`} aria-label={`Снапшот песочницы ${s.id} (недоступно)`}
                          className="rounded border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-600 disabled:opacity-40">снап</button>
                        <button type="button" disabled title={`destroy (git worktree remove): ${PLANE_LOCKED}`} aria-label={`Уничтожить песочницу ${s.id} (недоступно)`}
                          className="rounded border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-600 disabled:opacity-40">✕</button>
                      </span>
                    </div>
                    {s.lastCmd && <div className="mt-0.5 truncate pl-3.5 font-mono text-[9px] text-zinc-600" title={`last: ${s.lastCmd} · exit ${s.lastExit ?? "—"}`}>$ {s.lastCmd} · exit {s.lastExit ?? "—"}</div>}
                  </div>
                ))}
                {sb && sb.sandboxes.length === 0 && (
                  <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">
                    пусто — создание недоступно (мёртвый op-switch), существующие песочницы видны здесь
                  </div>
                )}
              </div>

              {(sb?.sandboxes.length ?? 0) > 0 && (
                <form onSubmit={(e) => { e.preventDefault(); const id = sb?.sandboxes[0]?.id; const cmd = sbCmd.trim(); if (id && cmd) { void sbExec(id, cmd); setSbCmd(""); } }} className="flex gap-2">
                  <input value={sbCmd} onChange={(e) => setSbCmd(e.target.value)} placeholder={`exec в ${sb?.sandboxes[0].id}: bun run lint | git status | … (ожидаем честный отказ daemon'а)`} aria-label="Команда для исполнения в первой песочнице"
                    className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-cyan-900" />
                  <button type="submit" disabled={sbBusy} title='POST /sandbox {op:"exec", id, cmd} — op-switch мёртв: покажем реальную ошибку daemon&#39;а'
                    className="h-7 shrink-0 rounded border border-zinc-700 px-2 font-mono text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">▶ run</button>
                </form>
              )}

              {sbRun && (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px]" aria-live="polite">
                  <div className="mb-1 flex items-center gap-2 text-zinc-400">
                    <span className={sbRun.ok ? "text-emerald-400" : "text-rose-400"}>exit {sbRun.exitCode}</span>
                    <span className="text-zinc-600">· {sbRun.ms}мс · {sbRun.limit}</span>
                  </div>
                  <div className="max-h-28 overflow-y-auto mc-scroll whitespace-pre-wrap text-zinc-500">
                    {sbRun.stdout || "(stdout пуст)"}
                    {sbRun.stderr && <div className="mt-1 text-rose-400/70">{sbRun.stderr}</div>}
                  </div>
                </div>
              )}

              {(sb?.snapshots.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600">снапшоты (durable, read-only)</div>
                  {(sb?.snapshots ?? []).slice(0, 4).map((sn) => (
                    <div key={sn.file} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px] text-zinc-500">
                      <span className="min-w-0 flex-1 truncate" title={`${sn.file} · sha256 ${sn.sha256}`}>{sn.file.split("/").pop()}</span>
                      <span className="shrink-0 text-zinc-600">{(sn.bytes / 1048576).toFixed(1)} МБ</span>
                      <span className="shrink-0 text-zinc-600" title={`sha256 ${sn.sha256}`}>{sn.createdAt ? new Date(sn.createdAt).toLocaleDateString("ru-RU") : ""}</span>
                      <button type="button" disabled title={`restore (распаковать в новую песочницу): ${PLANE_LOCKED}`}
                        className="shrink-0 rounded border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-600 disabled:opacity-40">restore</button>
                    </div>
                  ))}
                </div>
              )}

              {sb && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-zinc-600" title="Провайдеры плоскости">
                  {Object.entries(sb.providers).map(([k, v]) => (
                    <span key={k}><span className="text-zinc-500">{k}</span> = {v}</span>
                  ))}
                </div>
              )}
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
