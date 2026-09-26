"use client";
// ── ME2 · PAGE 10: SYSTEM (R74) — порт из legacy-mission-control.tsx.txt ────────
// VAULT·TOKENS (tl-tokens L4294-4338) · POLICY T0/T1/T2 · SELF-UPDATE (L3239-3253) ·
// ME-МАТРИЦА (L2800-2823) · CONTRACT/CAPABILITIES (/state) · ОПАСНАЯ ЗОНА.
// Секреты никогда не рендерятся: наружу только маски; значение set-формы уходит
// напрямую в daemon (POST /tokens) и не логируется.

import { useCallback, useEffect, useState } from "react";
import { FileJson, GitMerge, KeyRound, ListChecks, RefreshCw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMe2 } from "@/components/me2/store";
import { sendCommand, me2Fetch, hhmmss } from "@/lib/me2-bus";
import { PageHeader, Sec, Chip, StateBadge, type SysState } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

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
type MechT = {
  ok: boolean; verdict: string; version: string;
  mechanics: Array<{ id: string; name: string; verdict: string; evidence: string; cursor_ref?: string; parity?: string }>;
  gaps: Array<{ id: string; title: string; status: string; closure: string }>;
};
type StateT = {
  ok: boolean; ts: string;
  meta: { version: string; boot: string };
  contract?: string;
  capabilities?: {
    ops: string[]; transport: Record<string, unknown>;
    rest: { read: string[]; write: string[] };
    memory?: unknown; ui?: string;
    compat: Record<string, unknown>;
  };
};

const suState = (v: string): SysState =>
  v === "UP_TO_DATE" ? "Completed" : v === "DIVERGED" ? "Failed" : "Degraded";
const mechState = (v: string): SysState => (v === "WORKS" ? "Completed" : v === "CAVEAT" ? "Degraded" : "Failed");
const SHORT7 = (h: string | null) => (h ? h.slice(0, 7) : "—");

export function SystemPage() {
  const { toast } = useToast();
  const setDialog = useMe2((s) => s.setDialog);

  const [tokensData, setTokensData] = useState<TokensT | null>(null);
  const [tokensBusy, setTokensBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [tName, setTName] = useState("");
  const [tValue, setTValue] = useState("");
  const [tTier, setTTier] = useState("T2");

  const [policy, setPolicy] = useState<PolicyT | null>(null);
  const [su, setSu] = useState<SuT | null>(null);
  const [suBusy, setSuBusy] = useState(false);
  const [mech, setMech] = useState<MechT | null>(null);
  const [stateData, setStateData] = useState<StateT | null>(null);

  // ── загрузчики ──
  const loadTokens = useCallback(async () => {
    const r = await me2Fetch<TokensT>("/tokens?XTransformPort=3041"); if (r?.ok) setTokensData(r);
  }, []);
  const loadPolicy = useCallback(async () => {
    const r = await me2Fetch<PolicyT>("/policy?XTransformPort=3041"); if (r?.ok) setPolicy(r);
  }, []);
  const loadSu = useCallback(async () => {
    const r = await me2Fetch<SuT>("/selfupdate?XTransformPort=3041"); if (r?.ok) setSu(r);
  }, []);
  const loadMech = useCallback(async () => {
    const r = await me2Fetch<MechT>("/mechanics?XTransformPort=3041"); if (r?.ok) setMech(r);
  }, []);
  const loadState = useCallback(async () => {
    const r = await me2Fetch<StateT>("/state?XTransformPort=3041"); if (r?.ok) setStateData(r);
  }, []);

  // ── поллинги (mount + интервал, cleanup) ──
  useEffect(() => { void loadTokens(); const iv = setInterval(() => void loadTokens(), 60_000); return () => clearInterval(iv); }, [loadTokens]);
  useEffect(() => { void loadPolicy(); const iv = setInterval(() => void loadPolicy(), 60_000); return () => clearInterval(iv); }, [loadPolicy]);
  useEffect(() => { void loadSu(); const iv = setInterval(() => void loadSu(), 60_000); return () => clearInterval(iv); }, [loadSu]);
  useEffect(() => { void loadMech(); const iv = setInterval(() => void loadMech(), 60_000); return () => clearInterval(iv); }, [loadMech]);
  useEffect(() => { void loadState(); const iv = setInterval(() => void loadState(), 60_000); return () => clearInterval(iv); }, [loadState]);

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

  // ── selfupdate: check / apply-ff (403 authority_effect — честный toast) ──
  const suOp = useCallback(async (op: "check" | "apply") => {
    if (op === "apply" && !window.confirm("Применить fast-forward обновление из sandbox/me2-os? После — рестарт daemon (start.sh).")) return;
    setSuBusy(true);
    try {
      const res = await fetch("/selfupdate?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const j = await res.json().catch(() => null) as { ok?: boolean; error?: string; check?: SuT["check"]; result?: string } | null;
      if (res.status === 403) {
        toast({ title: "apply ff ✗ 403 · гейт authority_effect", description: "смена живого кода daemon требует живого согласия: оформи approval (один approve = один apply) и повтори", variant: "destructive" });
      } else if (res.ok && j?.ok) {
        if (op === "check") {
          const c = j.check;
          toast({ title: "проверка обновлений выполнена", description: c ? `${c.verdict} · local ${SHORT7(c.local_head)} · remote ${SHORT7(c.remote_head)} · dirty ${c.dirty_files}` : undefined });
        } else toast({ title: "ff-only применён — рестартуйте daemon (start.sh)", description: String(j?.result ?? "") });
        await loadSu();
      } else toast({ title: `selfupdate ${op} ✗ ${String(j?.error ?? res.statusText).slice(0, 70)}`, variant: "destructive" });
    } catch {
      toast({ title: `selfupdate ${op} ✗ daemon недоступен`, variant: "destructive" });
    } finally { setSuBusy(false); }
  }, [loadSu, toast]);

  // ── опасная зона ──
  const budgetFlushOp = useCallback(async () => {
    if (!window.confirm("Сбросить очередь команд шины (BUDGET_FLUSH, полоса EMERGENCY)? Все отложенные команды будут сняты.")) return;
    await sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" });
  }, []);

  // контракт → монокроп JSON
  const caps = stateData?.capabilities;
  const contractJson = caps ? JSON.stringify({
    contract: stateData?.contract ?? "—",
    daemon_version: stateData?.meta.version ?? "—",
    boot: stateData?.meta.boot ?? "—",
    ops: { count: caps.ops.length, list: caps.ops },
    transport: caps.transport,
    rest: { read_count: caps.rest.read.length, write_count: caps.rest.write.length },
    memory: caps.memory ?? "—",
    ui: caps.ui ?? "—",
    compat: caps.compat,
  }, null, 1) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-system" data-panel-system>
      <PageHeader title="SYSTEM" sub="vault · policy · self-update · матрица · контракт" />
      <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto lg:grid-cols-2 mc-scroll items-start">

        {/* ── КОЛОНКА 1 ── */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* R47: VAULT·TOKENS */}
          <Sec id="sys-tokens" title="VAULT·TOKENS" icon={KeyRound} tone="emerald"
            right={
              <span className="flex items-center gap-1">
                <button type="button" data-testid="tokens-add" onClick={() => setFormOpen((o) => !o)} disabled={tokensBusy}
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

              {formOpen && (
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
                    <button type="button" onClick={() => void tokenSetOp()} disabled={tokensBusy}
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
          </Sec>

          {/* POLICY T0/T1/T2 */}
          <Sec id="sys-policy" title="POLICY T0/T1/T2" icon={SlidersHorizontal} tone="amber"
            right={
              <button type="button" onClick={() => void policyReload()} title="перечитать policy.json (POST /policy {op:reload})"
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
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка политики…</div>
              )}
            </div>
          </Sec>

          {/* ME7: SELF-UPDATE */}
          <Sec id="sys-selfupdate" defaultOpen title="SELF-UPDATE" icon={GitMerge} tone="amber">
            <div className="space-y-1.5" data-testid="selfupdate-card">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500" title="ME7: ff-only из sandbox/me2-os; барьеры dirty/diverged; 403 = гейт authority_effect">
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
                <button type="button" onClick={() => void suOp("check")} disabled={suBusy}
                  title="git ls-remote + fetch + rev-list"
                  className="rounded border border-zinc-700 px-2 py-1 font-mono text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">check</button>
                <button type="button" onClick={() => void suOp("apply")} disabled={suBusy}
                  title="барьеры: dirty-tree/diverged → отказ; ff-only; 403 = гейт authority_effect"
                  className="rounded border border-amber-800/60 px-2 py-1 font-mono text-[9px] text-amber-300/90 transition hover:bg-zinc-800 disabled:opacity-40">apply ff</button>
                <span className="ml-auto self-center font-mono text-[9px] text-zinc-600" title="журнал обновлений (transactional journal v8)">
                  {su ? `journal: ${su.journal.length}` : ""}{su?.check.error ? ` · ⚠ ${su.check.error.slice(0, 40)}` : ""}
                </span>
              </div>
            </div>
          </Sec>
        </div>

        {/* ── КОЛОНКА 2 ── */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* ME-МАТРИЦА */}
          <Sec id="sys-mech" title="ME·МАТРИЦА" icon={ListChecks} tone="emerald"
            right={mech ? (
              <span className={`font-mono text-[9px] ${mech.mechanics.every((m) => m.verdict === "WORKS") ? "text-emerald-400" : "text-amber-400"}`}
                title="живые пробы механик · порт M1–M18">{mech.verdict}</span>
            ) : undefined}
          >
            <div className="space-y-1.5" data-testid="me-matrix">
              <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1 mc-scroll" role="list" aria-label="Реестр механик ME1–ME30">
                {(mech?.mechanics ?? []).map((m) => (
                  <div key={m.id} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px]"
                    title={`${m.name} — ${m.evidence}${m.cursor_ref ? ` · Cursor: ${m.cursor_ref}` : ""}`}>
                    <span className="w-9 shrink-0 font-semibold text-zinc-400">{m.id}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">{m.name}</span>
                    {m.parity && (
                      <span className={`hidden shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide sm:inline ${m.parity === "PARITY" ? "bg-emerald-500/15 text-emerald-400" : m.parity === "PARTIAL" ? "bg-amber-500/15 text-amber-400" : m.parity === "MISSING" ? "bg-rose-500/15 text-rose-400" : m.parity === "SUPERIOR" ? "bg-cyan-500/15 text-cyan-300" : "bg-zinc-500/15 text-zinc-500"}`}
                        title={`Cursor: ${m.cursor_ref ?? "—"} · перенос из корпуса R61`}>{m.parity}</span>
                    )}
                    <StateBadge state={mechState(m.verdict)} size="xs" />
                  </div>
                ))}
                {!mech && <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка матрицы…</div>}
              </div>
              {(mech?.gaps ?? []).length > 0 && (
                <div className="space-y-0.5">
                  {mech!.gaps.map((g) => (
                    <p key={g.id} className="truncate rounded border border-amber-900/40 bg-amber-950/20 px-1.5 py-0.5 font-mono text-[9px] text-amber-300/90"
                      title={`${g.title} · ${g.status} — ${g.closure}`}>
                      gap {g.id}: {g.title} · {g.status}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </Sec>

          {/* CONTRACT·CAPABILITIES */}
          <Sec id="sys-contract" title="CONTRACT·CAPABILITIES" icon={FileJson} tone="cyan"
            right={stateData ? <Chip label="daemon" value={stateData.meta.version} title={`boot ${hhmmss(stateData.meta.boot)}`} /> : undefined}
          >
            <div className="space-y-1.5">
              {contractJson ? (
                <>
                  <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                    <Chip label="ops" value={caps!.ops.length} title={`каталог ops: ${caps!.ops.join(", ")}`} />
                    <Chip label="rest.read" value={caps!.rest.read.length} />
                    <Chip label="rest.write" value={caps!.rest.write.length} />
                    <Chip label="transport" value={String((caps!.transport as { socket?: string })?.socket ?? "—")} title="agentchat: мутации только через socket ack" />
                    <Chip label="ui" value={typeof caps!.ui === "string" ? caps!.ui : "—"} />
                  </div>
                  <pre className="max-h-64 overflow-auto rounded bg-zinc-950/80 p-2 font-mono text-[9px] leading-relaxed text-zinc-400 mc-scroll">{contractJson}</pre>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка контракта (/state)…</div>
              )}
            </div>
          </Sec>

          {/* ОПАСНАЯ ЗОНА */}
          <Sec id="sys-danger" title="ОПАСНАЯ ЗОНА" icon={TriangleAlert} tone="rose">
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
                перед опасными операциями сделай бэкап: SQLite daemon (data/*.db + WAL) и env-файлы — reset пересоздаёт среду исполнения и отменяет незавершённые задачи.
              </p>
            </div>
          </Sec>

        </div>
      </div>
    </div>
  );
}
