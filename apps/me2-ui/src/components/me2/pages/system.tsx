"use client";
// ── ME2 · PAGE 10: SYSTEM (R74) — порт из legacy-mission-control.tsx.txt ────────
// VAULT·TOKENS (tl-tokens L4294-4338) · POLICY T0/T1/T2 · SELF-UPDATE (L3239-3253) ·
// ME-МАТРИЦА (L2800-2823) · CONTRACT/CAPABILITIES (/state) · ОПАСНАЯ ЗОНА.
// Секреты никогда не рендерятся: наружу только маски; значение set-формы уходит
// напрямую в daemon (POST /tokens) и не логируется.

import { useCallback, useEffect, useRef, useState } from "react";
import { GitMerge, KeyRound, RefreshCw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { sendCommand, me2Fetch, hhmmss } from "@/lib/me2-bus";
import { PageHeader, Sec, Chip, StateBadge, type SysState } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useClientRuntimeStatus, refreshClientRuntimeStatus } from "@/hooks/use-client-runtime-status";
import { capabilityLabel } from "@/lib/client-readiness-labels";

// ── типы ответов daemon (по живым маршрутам v0.57.1) ────────────────────────────
type TokensT = {
  ok: boolean;
  tokens: Array<{ name: string; tier: string; known: boolean; desc: string; source: string; masked: string; updated_at: string; updated_by: string }>;
  status: { total: number; known_total: number; known_missing: string[]; by_tier: Record<string, number>; last_ops: Array<{ at: string; op: string; name: string; by: string; ok: boolean }> };
};
type PolicyT = {
  ok: boolean;
  policy: {
    version: number;
    tiers: Record<string, { who: string; tools: string[]; schedule: boolean; objective_any: boolean; admin: boolean }>;
    caps: Record<string, number>;
    classifier: { enabled: boolean; llm_enabled: boolean; timeout_ms: number; queue_max: number; model: string };
    sandbox: { auto_sandbox: boolean; net: string; strict: boolean; tmp_size: string; extra_hide: string[] };
  };
  source: string; load_error: string | null;
  counters: { denied: number; by_tier: Record<string, number> };
  last_denials: Array<{ at: string; tier: string; tool: string; subject: string; reason: string }>;
};
type SuT = {
  ok: boolean;
  check: { ok: boolean; verdict: string; local_head: string | null; remote_head: string | null; behind: number | null; ahead: number | null; dirty_files: number; version: string; error?: string };
  journal: Array<{ id: number; op: string; result: string; detail: string | null; at: number }>;
};
type GuardianStatusT = {
  schema: "metaengine.browser-guardian.machine-bootstrap-launcher.v1";
  state: "READY" | "ACTIVATION_REQUIRED" | "OWNER_ENROLLMENT_REQUIRED" | "HOLD" | "AMBIGUOUS" | "UNAVAILABLE" | "NO_EFFECT_PROVEN";
  reason: string;
  ready: boolean;
  guardian_service_ready?: boolean;
  owner_binding_proven?: boolean;
  device_binding_proven?: boolean;
  source_head?: string;
  package_version?: string;
  error?: string;
  uac_consent_required?: boolean;
  automatic_retry_allowed: false;
  authority_effect: false;
};
const suState = (v: string): SysState =>
  v === "UP_TO_DATE" ? "Completed" : v === "DIVERGED" ? "Failed" : "Degraded";
const SHORT7 = (h: string | null) => (h ? h.slice(0, 7) : "—");

const ADVANCED_SURFACES: ReadonlyArray<{ page: PageKey; label: string; description: string }> = [
  { page: "tasks", label: "Tasks", description: "Plan, queue and task details" },
  { page: "code", label: "Code", description: "Repository and development workspace" },
  { page: "supervisor", label: "Supervisor", description: "Coordination, readiness and recovery" },
  { page: "memory", label: "Memory", description: "Learning history and knowledge" },
  { page: "observability", label: "Evidence", description: "Events, results and runtime health" },
];

const SETTINGS_AREAS = [
  { id: "tools", label: "Tools" }, { id: "runtime", label: "Runtime" },
  { id: "access", label: "Access" }, { id: "policy", label: "Policy" },
  { id: "recovery", label: "Recovery" },
] as const;
type SettingsArea = typeof SETTINGS_AREAS[number]["id"];

export function SystemPage() {
  const nativeRuntime = useClientRuntimeStatus();
  const workReadiness = nativeRuntime.readback?.work;
  const { toast } = useToast();
  const setDialog = useMe2((s) => s.setDialog);
  const setPage = useMe2((s) => s.setPage);
  const [area, setArea] = useState<SettingsArea>("tools");
  const [loadState, setLoadState] = useState<"LOADING" | "LIVE" | "UNAVAILABLE">("LIVE");
  const readsInFlight = useRef(new Set<SettingsArea>());
  const activeArea = useRef(area);
  useEffect(() => { activeArea.current = area; }, [area]);

  const [tokensData, setTokensData] = useState<TokensT | null>(null);
  const [tokensBusy, setTokensBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [tName, setTName] = useState("");
  const [tValue, setTValue] = useState("");
  const [tTier, setTTier] = useState("T2");

  const [policy, setPolicy] = useState<PolicyT | null>(null);
  const [su, setSu] = useState<SuT | null>(null);
  const [suBusy, setSuBusy] = useState(false);
  const [guardian, setGuardian] = useState<GuardianStatusT | null>(null);
  const [guardianBusy, setGuardianBusy] = useState(false);

  // ── загрузчики ──
  const loadTokens = useCallback(async () => {
    const r = await me2Fetch<TokensT>("/tokens?XTransformPort=3041"); setTokensData(r?.ok ? r : null); return r?.ok === true;
  }, []);
  const loadPolicy = useCallback(async () => {
    const r = await me2Fetch<PolicyT>("/policy?XTransformPort=3041"); setPolicy(r?.ok ? r : null); return r?.ok === true;
  }, []);
  const loadSu = useCallback(async () => {
    const r = await me2Fetch<SuT>("/selfupdate?XTransformPort=3041"); setSu(r?.ok ? r : null); return r?.ok === true;
  }, []);
  const loadGuardian = useCallback(async () => {
    const bridge = (window as Window & { metaengineClient?: {
      guardianStatus?: () => Promise<GuardianStatusT>;
    } }).metaengineClient;
    if (!bridge?.guardianStatus) { setGuardian(null); return false; }
    try {
      const next = await bridge.guardianStatus();
      setGuardian(next);
      return next?.schema === "metaengine.browser-guardian.machine-bootstrap-launcher.v1";
    } catch {
      setGuardian(null);
      return false;
    }
  }, []);
  // Hidden areas neither mount their controls nor poll their resources.
  const loadCurrent = useCallback(async () => {
    if (readsInFlight.current.has(area)) return;
    readsInFlight.current.add(area);
    setLoadState("LOADING");
    try {
      const loaders = area === "access" ? [loadTokens] : area === "policy" ? [loadPolicy]
        : area === "recovery" ? [loadSu] : area === "runtime" ? [loadGuardian] : [];
      const results = await Promise.all(loaders.map((load) => load()));
      if (activeArea.current === area) setLoadState(results.every(Boolean) ? "LIVE" : "UNAVAILABLE");
    } catch {
      if (activeArea.current === area) setLoadState("UNAVAILABLE");
    } finally { readsInFlight.current.delete(area); }
  }, [area, loadGuardian, loadPolicy, loadSu, loadTokens]);
  useEffect(() => {
    let current = true;
    const load = () => { if (current && document.visibilityState === "visible") void loadCurrent(); };
    load();
    const timer = area === "tools" || area === "runtime" ? null : window.setInterval(load, 60_000);
    return () => { current = false; if (timer !== null) window.clearInterval(timer); };
  }, [area, loadCurrent]);

  // ── vault-операции (T0-плоскость оператора; значение не логируется) ──
  const tokenSetOp = useCallback(async () => {
    const name = tName.trim();
    const value = tValue.trim();
    if (!name || !value) {
      toast({ title: "tokens set ✗", description: "нужны имя и значение токена (значение уйдёт в daemon и не логируется)", variant: "destructive" });
      return;
    }
    setTokensBusy(true);
    try {
      const r = await me2Fetch<{ ok?: boolean; error?: string }>("/tokens?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "set", name, value, tier: tTier, by: "operator-ui" }),
      });
      if (r?.ok) {
        toast({ title: `токен ${name} записан в БД vault'а ✓`, description: `ярус ${tTier} · наружу — только маска` });
        setTName(""); setTValue(""); setFormOpen(false);
        await loadTokens();
      } else toast({ title: `tokens set ✗ ${String(r?.error ?? "ошибка").slice(0, 60)}`, variant: "destructive" });
    } finally { setTokensBusy(false); }
  }, [tName, tValue, tTier, loadTokens, toast]);

  const tokenDeleteOp = useCallback(async (name: string) => {
    if (!window.confirm(`Удалить токен ${name} из vault'а БД? Потребители (selfupdate/evidence/gateway) потеряют доступ немедленно.`)) return;
    setTokensBusy(true);
    try {
      const r = await me2Fetch<{ ok?: boolean; error?: string }>("/tokens?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "delete", name, by: "operator-ui" }),
      });
      if (r?.ok) { toast({ title: `токен ${name} удалён из БД ✓` }); await loadTokens(); }
      else toast({ title: `tokens delete ✗ ${String(r?.error ?? "ошибка").slice(0, 60)}`, variant: "destructive" });
    } finally { setTokensBusy(false); }
  }, [loadTokens, toast]);

  // ── policy reload ──
  const policyReload = useCallback(async () => {
    const r = await me2Fetch<{ ok?: boolean; error?: string }>("/policy?XTransformPort=3041", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "reload" }),
    });
    if (r?.ok) { toast({ title: "policy: reload ✓", description: "policy.json перечитан daemon'ом" }); await loadPolicy(); }
    else toast({ title: `policy reload ✗ ${String(r?.error ?? "ошибка").slice(0, 60)}`, variant: "destructive" });
  }, [loadPolicy, toast]);

  // Source inspection only; package update remains owned by native Browser.
  const suOp = useCallback(async (op: "check") => {
    setSuBusy(true);
    try {
      const res = await fetch("/selfupdate?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const j = await res.json().catch(() => null) as { ok?: boolean; error?: string; check?: SuT["check"]; result?: string } | null;
      if (res.ok && j?.ok) {
          const c = j.check;
          toast({ title: "проверка обновлений выполнена", description: c ? `${c.verdict} · local ${SHORT7(c.local_head)} · remote ${SHORT7(c.remote_head)} · dirty ${c.dirty_files}` : undefined });
        await loadSu();
      } else toast({ title: `selfupdate ${op} ✗ ${String(j?.error ?? res.statusText).slice(0, 70)}`, variant: "destructive" });
    } catch {
      toast({ title: `selfupdate ${op} ✗ daemon недоступен`, variant: "destructive" });
    } finally { setSuBusy(false); }
  }, [loadSu, toast]);

  const activateGuardian = useCallback(async () => {
    const bridge = (window as Window & { metaengineClient?: {
      activateGuardian?: () => Promise<GuardianStatusT>;
    } }).metaengineClient;
    if (!bridge?.activateGuardian) {
      toast({ title: "Guardian недоступен", description: "Этот Browser не предоставляет защищённый bootstrap bridge.", variant: "destructive" });
      return;
    }
    setGuardianBusy(true);
    try {
      const next = await bridge.activateGuardian();
      setGuardian(next);
      if (next.state === "READY") {
        toast({ title: "Guardian готов", description: "Служба и owner/device binding подтверждены независимым readback." });
      } else if (next.state === "AMBIGUOUS") {
        toast({ title: "Результат Guardian неоднозначен", description: "Повтор эффекта заблокирован. Обновите статус после независимого readback.", variant: "destructive" });
      } else {
        toast({ title: "Guardian не готов", description: next.reason, variant: "destructive" });
      }
      await refreshClientRuntimeStatus().catch(() => {});
    } catch (error) {
      toast({ title: "Guardian activation failed", description: String(error instanceof Error ? error.message : error).slice(0, 120), variant: "destructive" });
    } finally {
      setGuardianBusy(false);
    }
  }, [toast]);

  // ── опасная зона ──
  const budgetFlushOp = useCallback(async () => {
    if (!window.confirm("Сбросить очередь команд шины (BUDGET_FLUSH, полоса EMERGENCY)? Все отложенные команды будут сняты.")) return;
    await sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-system" data-panel-system>
      <PageHeader title="Settings" sub="Tools and client configuration" />
      <div role="tablist" aria-label="Settings areas" className="mb-4 flex shrink-0 flex-wrap gap-1 border-b border-zinc-800" data-testid="settings-areas">
        {SETTINGS_AREAS.map((item, index) => <button key={item.id} type="button" role="tab" id={`settings-tab-${item.id}`}
          aria-selected={area === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={area === item.id ? 0 : -1}
          onClick={() => setArea(item.id)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % SETTINGS_AREAS.length
              : event.key === "ArrowLeft" ? (index + SETTINGS_AREAS.length - 1) % SETTINGS_AREAS.length
              : event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_AREAS.length - 1 : null;
            if (next === null) return; event.preventDefault();
            const target = SETTINGS_AREAS[next]; setArea(target.id); document.getElementById(`settings-tab-${target.id}`)?.focus();
          }} className={`min-h-9 border-b-2 px-4 text-[13px] ${area === item.id ? "border-cyan-400 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-100"}`}>{item.label}</button>)}
      </div>
      <div id={`settings-panel-${area}`} role="tabpanel" aria-labelledby={`settings-tab-${area}`} className="mc-scroll min-h-0 flex-1 overflow-y-auto">
      {area === "tools" ? <div className="mx-auto max-w-[960px]" data-testid="settings-advanced-surfaces">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div>
            <strong className="text-[14px] font-medium text-zinc-200">Development tools</strong>
            <p className="mt-1 text-[12px] text-zinc-400">Open a tool here or find it with Ctrl+K.</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-zinc-800 border-y border-zinc-800">
          {ADVANCED_SURFACES.map((surface) => (
            <button
              key={surface.page}
              type="button"
              onClick={() => setPage(surface.page)}
              data-testid={`settings-open-${surface.page}`}
              className="flex w-full items-center justify-between gap-4 px-3 py-4 text-left hover:bg-zinc-900"
              title={surface.description}
            >
              <span><strong className="block text-[13px] font-medium text-zinc-200">{surface.label}</strong>
                <span className="mt-1 block text-[12px] text-zinc-400">{surface.description}</span></span>
              <span className="text-[12px] text-zinc-400">Open</span>
            </button>
          ))}
        </div>
      </div> : null}
      {area !== "tools" && area !== "runtime" ? <div className="mx-auto mb-3 flex max-w-[960px] items-center justify-between gap-3 text-[12px]" role="status">
        <span className={loadState === "UNAVAILABLE" ? "text-amber-300" : "text-zinc-400"}>
          {loadState === "LOADING" ? "Reading diagnostic data…" : loadState === "UNAVAILABLE" ? "Compatibility diagnostics are unavailable. Native execution status is shown separately." : "Diagnostic data received"}
        </span><button type="button" onClick={() => void loadCurrent()} className="h-8 shrink-0 border border-zinc-700 px-3 text-zinc-200">Refresh</button>
      </div> : null}
      <div className="mx-auto flex max-w-[960px] flex-col gap-3">

        {/* ── КОЛОНКА 1 ── */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* R47: VAULT·TOKENS */}
          {area === "access" ? <Sec id="sys-tokens" title="Access tokens" icon={KeyRound} tone="emerald"
            right={
              <span className="flex items-center gap-1">
                <button type="button" data-testid="tokens-add" onClick={() => setFormOpen((o) => !o)} disabled={tokensBusy || !tokensData || loadState !== "LIVE"}
                  title="записать/ротировать токен в БД (POST /tokens {op:set} — значение уходит в daemon, не логируется)"
                  className="rounded border border-emerald-900/60 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300 transition hover:bg-emerald-950/60 disabled:opacity-40">
                  ＋ токен
                </button>
                <button type="button" onClick={() => void loadTokens()} aria-label="Обновить vault" className="rounded border border-zinc-800 px-1 py-0.5 text-zinc-500 transition hover:text-zinc-200">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                </button>
              </span>
            }
          >
            <div className="space-y-1.5">
              <div data-testid="tokens-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                <Chip label="total" value={tokensData ? `${tokensData.status.total}/${tokensData.status.known_total}` : "—"}
                  title="токенов в БД / известных слотов реестра" />
                {tokensData && Object.entries(tokensData.status.by_tier).map(([t, n]) => (
                  <Chip key={t} label={t} value={`×${n}`} tone={t === "T1" ? "amber" : "violet"} title={`${t}: токенов в vault'е`} />
                ))}
                {tokensData && tokensData.status.known_missing.length > 0 && (
                  <Chip label="нет" value={tokensData.status.known_missing.length} tone="rose"
                    title={`известные слоты без значения: ${tokensData.status.known_missing.join(", ")}`} />
                )}
              </div>

              {formOpen && tokensData && (
                <div className="space-y-1.5 rounded-md border border-emerald-900/40 bg-emerald-950/10 p-2">
                  <div className="flex gap-1.5">
                    <Input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="ИМЯ (A-Z_0-9)" aria-label="Имя токена"
                      className="h-7 w-40 border-zinc-800 bg-zinc-900 font-mono text-[11px]" />
                    <Input value={tValue} onChange={(e) => setTValue(e.target.value)} placeholder="значение…" type="password" aria-label="Значение токена (не логируется)"
                      className="h-7 min-w-0 flex-1 border-zinc-800 bg-zinc-900 font-mono text-[11px]" />
                    <select value={tTier} onChange={(e) => setTTier(e.target.value)} aria-label="Ярус токена"
                      className="h-7 rounded border border-zinc-800 bg-zinc-900 px-1 font-mono text-[11px] text-zinc-300">
                      <option value="T1">T1</option>
                      <option value="T2">T2</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void tokenSetOp()} disabled={tokensBusy || !tokensData || loadState !== "LIVE"}
                      className="rounded border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 font-mono text-[9px] text-emerald-300 transition hover:bg-emerald-950/70 disabled:opacity-40">
                      записать
                    </button>
                    <span className="font-mono text-[9px] text-zinc-600">значение уходит в daemon (POST /tokens) и не логируется</span>
                  </div>
                </div>
              )}

              <div data-testid="tokens-list" className="max-h-44 space-y-0.5 overflow-y-auto pr-1 mc-scroll" role="list" aria-label="Токены в БД (маскированные)">
                {(tokensData?.tokens ?? []).map((t) => (
                  <div key={t.name} role="listitem" className="group flex items-center gap-1.5 rounded px-1 py-0.5 font-mono text-[9px] transition hover:bg-zinc-900/60"
                    title={`${t.desc}\nисточник: ${t.source} · обновлён ${t.updated_at.slice(0, 19)} (${t.updated_by || "—"})`}>
                    <span className={`shrink-0 rounded border px-0.5 ${t.tier === "T1" ? "border-amber-900/60 text-amber-400" : "border-violet-900/60 text-violet-400"}`}>{t.tier}</span>
                    <span className="shrink-0 text-zinc-300">{t.name}</span>
                    {t.known && <span className="shrink-0 text-emerald-400/80" title="слот известен реестру">✓</span>}
                    <span className="min-w-0 flex-1 truncate text-zinc-600" title={t.desc}>{t.desc}</span>
                    <span className="shrink-0 text-zinc-500" title="маска — raw-значения наружу не выходят никогда">{t.masked}</span>
                    <span className="hidden shrink-0 text-zinc-700 md:inline">{t.source.startsWith("file:") ? "из файла" : t.source === "operator" ? "оператор" : t.source}</span>
                    <button type="button" onClick={() => void tokenDeleteOp(t.name)} aria-label={`Удалить ${t.name}`}
                      className="shrink-0 rounded p-0.5 text-zinc-700 opacity-0 transition group-hover:opacity-100 hover:bg-rose-950/40 hover:text-rose-300"
                      title="удалить из vault'а (POST /tokens {op:delete})">
                      <svg aria-hidden viewBox="0 0 14 14" className="h-3 w-3"><path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5 4 12h6l.5-8.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                    </button>
                  </div>
                ))}
                {tokensData && tokensData.tokens.length === 0 && (
                  <p className="px-1 font-mono text-[9px] text-rose-300" role="alert">vault пуст — токены не обнаружены (поставь через «＋ токен»)</p>
                )}
                {!tokensData && <p className="px-1 font-mono text-[9px] text-zinc-600">vault недоступен (daemon офлайн)</p>}
              </div>

              {tokensData && tokensData.status.last_ops.length > 0 && (
                <p data-testid="tokens-last-op" className="truncate font-mono text-[9px] text-zinc-500"
                  title={tokensData.status.last_ops.slice(0, 5).map((o) => `${o.at.slice(11, 19)} ${o.op} · ${o.name} · ${o.by}`).join("\n")}>
                  {tokensData.status.last_ops[0].at.slice(11, 19)} {tokensData.status.last_ops[0].op} · {tokensData.status.last_ops[0].name} · {tokensData.status.last_ops[0].by}
                </p>
              )}
            </div>
          </Sec> : null}

          {/* POLICY T0/T1/T2 */}
          {area === "policy" ? <Sec id="sys-policy" title="Execution policy" icon={SlidersHorizontal} tone="amber"
            right={
              <button type="button" onClick={() => void policyReload()} disabled={!policy || loadState !== "LIVE"} title="перечитать policy.json (POST /policy {op:reload})"
                className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800">
                reload
              </button>
            }
          >
            <div className="space-y-1.5" data-testid="policy-card">
              {policy ? (
                <>
                  <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                    <Chip label="ver" value={`v${policy.policy.version}`} />
                    <Chip label="sandbox" value={`${policy.policy.sandbox.net}${policy.policy.sandbox.strict ? " · strict" : ""}`}
                      tone={policy.policy.sandbox.net === "deny" ? "emerald" : "amber"} title={`auto_sandbox=${policy.policy.sandbox.auto_sandbox} · tmp ${policy.policy.sandbox.tmp_size}`} />
                    <Chip label="classifier" value={policy.policy.classifier.enabled ? (policy.policy.classifier.llm_enabled ? "llm" : "rules") : "off"}
                      title={`таймаут ${policy.policy.classifier.timeout_ms}ms · очередь ${policy.policy.classifier.queue_max} · модель ${policy.policy.classifier.model}`} />
                    <Chip label="denied" value={policy.counters.denied} tone={policy.counters.denied > 0 ? "rose" : "zinc"} title="отказов policy-классификатора" />
                    {Object.entries(policy.counters.by_tier).map(([t, n]) => (
                      <Chip key={t} label={t} value={`×${n}`} tone="rose" title={`отказов на ярусе ${t}`} />
                    ))}
                  </div>
                  <div className="space-y-0.5 font-mono text-[9px]">
                    {Object.entries(policy.policy.tiers).map(([t, tier]) => (
                      <div key={t} className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-0.5" title={`${tier.who} · tools: ${tier.tools.join(", ")}`}>
                        <span className={`w-6 shrink-0 font-semibold ${t === "T0" ? "text-rose-300" : t === "T1" ? "text-amber-300" : "text-zinc-300"}`}>{t}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-500">{tier.who}</span>
                        <span className="shrink-0 text-zinc-600">tools {tier.tools.length}</span>
                        <span className={`shrink-0 ${tier.admin ? "text-rose-400" : "text-zinc-700"}`} title="admin-инструменты">{tier.admin ? "admin" : "—"}</span>
                      </div>
                    ))}
                  </div>
                  <p className="truncate font-mono text-[9px] text-zinc-600" title={policy.source}>source: {policy.source}{policy.load_error ? ` · ⚠ ${policy.load_error}` : ""}</p>
                  {policy.last_denials.slice(0, 4).map((d, i) => (
                    <p key={`${d.at}-${i}`} className="truncate rounded border border-rose-900/40 bg-rose-950/20 px-1.5 py-0.5 font-mono text-[9px] text-rose-300/90"
                      title={`${d.reason} · ${d.subject}`}>
                      {hhmmss(d.at)} {d.tier} ✗ {d.tool} — {d.reason.slice(0, 60)}
                    </p>
                  ))}
                </>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">Policy data is not available.</div>
              )}
            </div>
          </Sec> : null}

          {/* ME7 legacy daemon source synchronizer — not the Browser package updater */}
          {area === "recovery" ? <Sec id="sys-selfupdate" title="DAEMON SOURCE SYNC" icon={GitMerge} tone="amber" defaultOpen={false}>
            <div className="space-y-1.5" data-testid="selfupdate-card">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500" title="Development-only ff sync из sandbox/me2-os. Это НЕ Browser/Sentinel package self-update.">
                  <GitMerge className="h-3 w-3" aria-hidden /> git
                </span>
                <StateBadge state={suState(su?.check.verdict ?? "")} size="xs" />
                <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                  <Chip label="local" value={SHORT7(su?.check.local_head ?? null)} title={`local head: ${su?.check.local_head ?? "—"}`} />
                  <Chip label="remote" value={SHORT7(su?.check.remote_head ?? null)} title={`remote head: ${su?.check.remote_head ?? "—"}`} />
                  <Chip label="behind" value={su?.check.behind ?? "—"} tone={(su?.check.behind ?? 0) > 0 ? "amber" : "zinc"} />
                  <Chip label="ahead" value={su?.check.ahead ?? "—"} tone={(su?.check.ahead ?? 0) > 0 ? "amber" : "zinc"} />
                  <Chip label="dirty" value={su?.check.dirty_files ?? "—"} tone={(su?.check.dirty_files ?? 0) > 0 ? "amber" : "zinc"} title="dirty-файлы блокируют ff (барьер apply)" />
                  <Chip label="ver" value={su?.check.version ?? "—"} title="версия daemon" />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => void suOp("check")} disabled={suBusy || !su || loadState !== "LIVE"}
                  title="git ls-remote + fetch + rev-list"
                  className="rounded border border-zinc-700 px-2 py-1 font-mono text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">check</button>
                <p className="text-[12px] text-zinc-400">Source inspection only. Installed Browser updates use the native updater.</p>
                <span className="ml-auto self-center font-mono text-[9px] text-zinc-600" title="журнал обновлений (transactional journal v8)">
                  {su ? `journal: ${su.journal.length}` : ""}{su?.check.error ? ` · ⚠ ${su.check.error.slice(0, 40)}` : ""}
                </span>
              </div>
            </div>
          </Sec> : null}
        </div>

        {/* ── КОЛОНКА 2 ── */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* ME-МАТРИЦА */}
          {area === "runtime" ? <section className="border border-zinc-800 p-3" data-testid="native-work-readiness" aria-labelledby="native-work-readiness-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="native-work-readiness-title" className="text-[13px] font-medium text-zinc-200">Execution readiness</h2>
              <button type="button" onClick={() => void refreshClientRuntimeStatus()} className="h-7 border border-zinc-700 px-2 text-[12px] text-zinc-300">Refresh status</button>
            </div>
            <p role="status" className={`mt-2 text-[13px] ${workReadiness?.continuous_autonomy_ready === true ? "text-emerald-300" : "text-amber-200"}`}>
              {workReadiness?.label || "Status unavailable"}
            </p>
            <p className="mt-1 text-[12px] text-zinc-400">{workReadiness?.detail || "Waiting for a current readback from the Native Supervisor."}</p>
            <dl className="mt-3 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-zinc-500">Admin connection</dt><dd>{nativeRuntime.readback?.connection.admin_ready === true ? "Connected" : "Unavailable"}</dd>
              {([['chat_dispatch', 'Chat dispatch'], ['coding_execution', 'Coding environment'], ['host_continuity', 'Host continuity'], ['continuous_autonomy', 'Continuous autonomy']] as const).map(([key, name]) => (
                <div key={key} className="contents" data-testid={`readiness-${key}`}>
                  <dt className="text-zinc-500">{name}</dt><dd className="break-words">{capabilityLabel(workReadiness, key)}</dd>
                </div>
              ))}
              <dt className="text-zinc-500">Verified improvement</dt><dd>Awaiting evaluated evidence</dd>
              <dt className="text-zinc-500">Supervisor</dt><dd>{workReadiness?.supervisor_state || "Unavailable"}</dd>
              <dt className="text-zinc-500">Verified agents</dt><dd>{workReadiness?.proven_agent_count ?? "Unavailable"}</dd>
              <dt className="text-zinc-500">Ambiguous agents</dt><dd>{workReadiness?.ambiguous_agent_count ?? "Unavailable"}</dd>
              <dt className="text-zinc-500">Generation</dt><dd>{workReadiness ? `${workReadiness.generation_floor ?? "?"} / profile ${workReadiness.local_generation_floor ?? "?"}` : "Unavailable"}</dd>
            </dl>
          </section> : null}
          {area === "runtime" ? <section className="border border-zinc-800 p-3" data-testid="guardian-runtime-status" aria-labelledby="guardian-runtime-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="guardian-runtime-title" className="text-[13px] font-medium text-zinc-200">Machine Guardian</h2>
                <p className="mt-1 text-[12px] text-zinc-400">Privileged recovery/update service. Activation always requires an explicit user action; paths and arguments are fixed by the packaged Browser.</p>
              </div>
              <button type="button" onClick={() => void loadGuardian()} disabled={guardianBusy}
                className="h-7 shrink-0 border border-zinc-700 px-2 text-[12px] text-zinc-300 disabled:opacity-40">Read status</button>
            </div>
            <p role="status" className={`mt-3 text-[13px] ${guardian?.state === "READY" ? "text-emerald-300" : guardian?.state === "AMBIGUOUS" ? "text-rose-300" : "text-amber-200"}`}>
              {guardian?.state || "UNAVAILABLE"} · {guardian?.reason || "No Guardian readback yet"}
            </p>
            <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-zinc-500">Service</dt><dd>{guardian?.guardian_service_ready === true ? "Reachable" : guardian?.state === "ACTIVATION_REQUIRED" ? "Not installed / not reachable" : "Unproven"}</dd>
              <dt className="text-zinc-500">Owner binding</dt><dd>{guardian?.owner_binding_proven === true ? "Proven" : "Not proven"}</dd>
              <dt className="text-zinc-500">Device binding</dt><dd>{guardian?.device_binding_proven === true ? "Proven" : "Not proven"}</dd>
              <dt className="text-zinc-500">Package</dt><dd className="font-mono">{guardian?.package_version || "—"}{guardian?.source_head ? ` · ${guardian.source_head.slice(0, 10)}…` : ""}</dd>
            </dl>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="guardian-activate"
                disabled={guardianBusy
                  || nativeRuntime.readback?.connection.admin_ready !== true
                  || !guardian
                  || !["ACTIVATION_REQUIRED", "OWNER_ENROLLMENT_REQUIRED"].includes(guardian.state)}
                onClick={() => void activateGuardian()}
                className="min-h-8 border border-cyan-700 bg-cyan-950/30 px-3 text-[12px] text-cyan-200 hover:bg-cyan-950/60 disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
              >
                {guardianBusy ? "Waiting for readback…"
                  : guardian?.state === "ACTIVATION_REQUIRED" ? "Activate Guardian (Windows UAC)"
                  : guardian?.state === "OWNER_ENROLLMENT_REQUIRED" ? "Bind approved device"
                  : guardian?.state === "READY" ? "Guardian ready"
                  : guardian?.state === "AMBIGUOUS" ? "Blocked: readback required"
                  : "Activation unavailable"}
              </button>
              <span className="text-[11px] text-zinc-500">
                {nativeRuntime.readback?.connection.admin_ready === true ? "ADMIN device connected" : "ADMIN connection required"}
              </span>
            </div>
            {guardian?.state === "AMBIGUOUS" ? <p className="mt-2 text-[11px] text-rose-300">No automatic retry is allowed after an ambiguous owner/bootstrap effect. Use Read status after independent machine readback.</p> : null}
          </section> : null}
          {/* ОПАСНАЯ ЗОНА */}
          {area === "recovery" ? <Sec id="sys-danger" title="Recovery actions" icon={TriangleAlert} tone="rose" defaultOpen={false}>
            <div className="space-y-1.5 rounded-md border border-rose-900/50 bg-rose-950/20 p-2" data-testid="danger-zone">
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void budgetFlushOp()}
                  title="BUDGET_FLUSH: снять всю очередь команд (полоса EMERGENCY)"
                  className="rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1 font-mono text-[9px] text-rose-300 transition hover:bg-rose-950/70">
                  BUDGET_FLUSH · EMERGENCY
                </button>
                <button type="button" onClick={() => setDialog("reset")}
                  title="ENVIRONMENT_RESET: глобальный диалог сброса среды (полоса EMERGENCY)"
                  className="rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1 font-mono text-[9px] text-rose-300 transition hover:bg-rose-950/70">
                  ENVIRONMENT_RESET · EMERGENCY
                </button>
              </div>
              <p className="font-mono text-[9px] leading-relaxed text-rose-300/80" role="note">
                Recovery can cancel queued work or reset the environment. Inspect current tasks and save needed artifacts before confirming.
              </p>
            </div>
          </Sec> : null}

        </div>
      </div>
      </div>
    </div>
  );
}
