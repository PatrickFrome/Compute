'use client'

// ============================================================================
// ME2 OS · MISSION CONTROL — R81-PHASE0 recovery console
// Восстановлено после env-reset (2026-09-26): демон REST :3041 + WS :3040
// через gateway (?XTransformPort). Секреты не покидают backend.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, AlertTriangle, Bell, BellOff, Boxes, Camera, Check, ChevronDown, Cloud, Database, Download, ExternalLink, GitBranch, GitPullRequest, HeartPulse,
  Layers, ListChecks, Loader2, Radio, RefreshCw, Rocket, ShieldAlert, Stethoscope, Terminal, Trash2, TrendingUp, Zap,
} from 'lucide-react'

// ---------------------------------------------------------------- utils ----
const dpath = (p: string) => (p.includes('?') ? `${p}&XTransformPort=3041` : `${p}?XTransformPort=3041`)

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(dpath(path), { cache: 'no-store', ...init })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } } | null
    throw new Error(err?.error?.message ? `${err.error.message} [${err.error.code}]` : `HTTP ${res.status}`)
  }
  return data as T
}

function humanS(s: number | null | undefined): string {
  if (s == null || s < 0) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`
  return `${(s / 86400).toFixed(1)}d`
}

function hhmmss(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString('ru-RU', { hour12: false })
}

// ---------------------------------------------------------------- types ----
interface Me2Event {
  seq: number; ts: string; type: string; actor: string
  subject: string | null; payload: unknown; hash: string; daemon_version: string
}
interface Health {
  ok: boolean; version: string; round: string; uptime_s: number; started_at: string
  actions: { implemented: number; donor_registry: string }
  last_seq: number; head_hash: string; ws_port: number
  mirror_anchor: { seq: number; hash: string; daemon_version: string; mirrored_at: string }
}
interface Supervisor {
  client_id: string; last_seen_at: string; heartbeat_age_s: number
  extension_version: string; operator_runtime: string; supervisor_mode: string
  operator_mode: string; armed: boolean; compute_state: string
  sentinel: { lifecycle: string; worker_health: string; worker_heartbeat_age_ms: number }
  dev_plane: { state: string; ref: string; head: string }
  keepalive: {
    state: string; cycle_seq: number; last_completed_cycle_at: string | null
    stale_completed_s: number | null; rollover_reason: string | null
    ambiguous_history_count: number; queued_wake_count: number; updated_at: string
  }
  cognitive: {
    state: string; stream_id: string | null; sent_events: number
    acknowledged_through_sequence: number; resync_count: number; last_success_at: string | null
  }
  p0_flags: string[]
}
interface RoadmapItem {
  round: string; title: string; goal: string; exit_gate: string; status: string; evidence?: string
}
interface RoadmapData {
  roadmap: RoadmapItem[]
  release_authority: { repository: string; release_ref: string; release_sha: string; verified_via: string }
  donors: Record<string, { ref: string; sha: string }>
}
interface Worktree { path: string; head: string; branch: string | null }
interface Verdicts {
  boot_span_ms: number; uptime_ms: number; in_boot_span: boolean
  verdicts: { id: string; state: string; detail: string }[]
}
interface Recovery {
  env_reset_detected: boolean
  restored: { item: string; state: string }[]
  blocked: { item: string; reason: string }[]
  pending_next: string[]
}
interface MonitorSample {
  ts: string; uptime_ms: number; hb_age_s: number; cycle_seq: number
  stale_completed_s: number | null; resync_count: number
  ambiguous_history_count: number; keepalive_state: string
  cognitive_state: string; compute_state: string; p0_count: number
}
interface MonitorHistory {
  status: { running: boolean; started_at: string | null; interval_ms: number; capacity: number; sample_count: number; last_error: string | null }
  samples: MonitorSample[]
}
interface ExecResult {
  cmd: string[]; ok: boolean; exit_code: number | null
  stdout: string; stderr: string; elapsed_ms: number
}
interface ConvCheck { name: string; status: string; conclusion: string | null }
interface Convergence {
  fetched_at: string; repository: string; branch: string
  head: { sha: string; short: string; message: string; committed_at: string } | null
  pr: { number: number; state: string; draft: boolean; mergeable: boolean | null; mergeable_state: string; title: string; updated_at: string } | null
  checks: { total: number; success: number; failed: number; cancelled: number; skipped: number; pending: number; in_progress: number; items: ConvCheck[] }
  rollup_state: 'GREEN' | 'RED' | 'PENDING' | 'UNKNOWN'
  api: { token_present: boolean; rate_remaining: number | null }
}
interface DonorAction {
  action: string
  lane: 'READ_ONLY' | 'TAB_MUTATION' | 'GLOBAL_MUTATION' | 'EMERGENCY'
  cost: number
  desc: string
}
interface DonorRegistry {
  provenance: { source_ref: string; source_sha: string; donor_daemon_version: string; source_path?: string; legacy_surface?: string }
  lanes: { EMERGENCY: number; READ_ONLY: number; TAB_MUTATION: number; GLOBAL_MUTATION: number }
  total: number
  legacy_surface_count?: number
  budget?: { limit: number; windowMs: number }
  lane_priority?: Record<string, number>
  actions: DonorAction[]
  reconciliation: {
    counterparts: { donor: string; local: string; mode: 'full' | 'partial'; note: string }[]
    counterparts_count: number; full: number; partial: number; pending_count: number
    pending_by_lane?: Record<string, string[]>
    local_only_count: number; local_only: string[]; note: string
  }
}
interface R82Probe {
  tab_id: string | null; probed: boolean; blank: boolean; url: string | null
  element_count: number | null; composer_value_length: number | null
  draft_canary: 'OVERSIZED' | 'OK' | 'NO_COMPOSER' | 'UNKNOWN'; error?: string
}
interface R82Diag {
  fetched_at: string
  supervisor: Supervisor
  attempt: { attempt_id: string | null; started_at: string | null; ambiguous_at: string | null; ambiguous_reason: string | null; tab_id: string | null } | null
  attempt_tab_probe: R82Probe
  attempt_history_tail: { cycle_seq: number | null; ambiguous_reason: string | null; ambiguous_at: string | null; retired_reason: string | null }[]
  root_cause_chain: string[]
  operator_action: string
  fix: { pr: { number: number; url: string; state: string; head_sha: string; ci: { success: number; failed: number; cancelled: number; pending: number; total: number } } | null; branch: string }
}
interface EdgeWorker {
  id: string
  role: string
  modified_on: string | null
  versions_total: number | null
  latest_version: { id: string; number: number } | null
  live_sha256: string | null
  live_bytes: number | null
  bindings: string[]
  secret_bindings: string[]
  durable_object: string | null
  queue: string | null
  workflow: boolean
  source: { verdict: 'CONVERGED' | 'DRIFT' | 'NO_SOURCE_IN_REPO'; release_candidates: string[]; markers_checked: string[]; note: string }
}
interface EdgeStatus {
  fetched_at: string
  subdomain: string | null
  workers: EdgeWorker[]
  findings: string[]
  promotion_blockers: string[]
}

// R82-EXIT: readback watch (exit-gate stage machine)
interface ReadbackStage {
  stage: string; title: string; state: 'DONE' | 'ACTIVE' | 'PENDING' | 'BLOCKED'; detail: string
}
interface ReadbackDraftSample {
  ts: string; tab_id: string | null; chars: number | null
  canary: 'OVERSIZED' | 'OK' | 'NO_COMPOSER' | 'NO_TAB' | 'UNKNOWN'
  source?: 'periodic' | 'opportunistic'; error?: string
}
interface Readback {
  fetched_at: string
  baseline: { extension_version: string; dev_plane_head: string; merge_head: string; cycle_seq: number }
  release_ci: {
    head: { sha: string; short: string; message: string; committed_at: string } | null
    checks: { total: number; success: number; failed: number; cancelled: number; skipped: number; pending: number; in_progress: number; publish_manifest: string; failed_names: string[] }
    terminal: boolean; green: boolean
  } | null
  release_ci_error: string | null
  runtime: { extension_version: string; dev_plane_head: string; self_update_landed: boolean; version_transitions: { ts: string; from: string; to: string }[] }
  canary: { rollover_reason: string | null; new_code_active: boolean }
  draft: { samples: ReadbackDraftSample[]; last: ReadbackDraftSample | null; max_chars: number | null; cleared: boolean; cleared_at: string | null; threshold: number }
  // R82-HARDEN: rollover attempt churn in the monitor window — the live
  // retry-loop heartbeat (each attempt = fresh tab + draft hydrate + canary abort)
  attempts: {
    window_samples: number
    distinct_attempts: number
    current: { attempt_id: string; tab_id: string | null; started_at: string | null; ambiguous_reason: string | null } | null
    rollover_reason: string | null
  }
  cycle: { baseline: number; current: number; growth: number; monotonic_growth_observed: boolean; stale_completed_s: number | null; resumed_at: string | null }
  stages: ReadbackStage[]
  current_gate: string
  summary: string
}

// R83-IMPORT: source-tree import plan
interface ImportModulePlan {
  module_path: string; bytes: number; sha256_12: string; lines: number
  readable: boolean; bundle_sections: string[]
}
interface WorkerImportPlan {
  worker: string
  snapshot_available: boolean
  snapshot_sha256_12: string | null
  source_character: 'ORIGINAL_MODULES' | 'BUNDLED' | 'UNCLASSIFIED' | 'NO_SNAPSHOT'
  proposed_repo_prefix: string
  modules: ImportModulePlan[]
  wrangler_stub: { bindings: string[]; durable_object: string | null; queue: string | null; workflow: boolean; note: string } | null
  import_verdict: 'IMPORT_READY' | 'NEEDS_UNBUNDLING' | 'BLOCKED_NO_SNAPSHOT' | 'NOT_IN_REGISTRY'
  notes: string[]
}
interface EdgeImportPlan {
  fetched_at: string
  workers: WorkerImportPlan[]
  summary: string[]
}

// R83-IMPORT: import PR #982 live status
interface ImportCheck { name: string; status: string; conclusion: string | null }
interface EdgeImportStatus {
  fetched_at: string
  pr: {
    number: number; state: string; draft: boolean; merged: boolean; mergeable: boolean | null; mergeable_state: string
    title: string; url: string; head_branch: string; head_sha: string; base_branch: string
    updated_at: string; files: number; additions: number; deletions: number
  } | null
  pr_error: string | null
  ci: {
    total: number; success: number; failed: number; cancelled: number; skipped: number; pending: number; in_progress: number
    terminal: boolean; green: boolean; failed_names: string[]; checks: ImportCheck[]
  }
  digest_contract: { fabric_live_sha256: string; aop1_live_sha256: string; repo_tree_verified: boolean; verified_note: string }
  summary: string[]
}

// R83-MIRROR: evidence auto-mirror (local chain → Supabase me2_event_mirror)
interface MirrorState {
  schema: string
  anchor: { seq: number; hash: string }
  last_mirror_seq: number
  last_mirror_hash: string
  mirrored_local_seq: number
  last_sync_at: string | null
  last_error: { code: string; message: string; at: string } | null
  total_rows_synced: number
  sync_count: number
}
interface MirrorStatus {
  ok: boolean
  daemon_version: string
  round: string
  fetched_at: string
  contract: { marker: string; table: string; hash_formula: string; payload_shape: string; continuity: string; fail_closed: string }
  state: MirrorState
  local_last_seq: number
  pending: number
  auto_sync: { interval_ms: number; boot_delay_ms: number; running: boolean; next_in_ms: number | null }
  live: {
    checked_at: string | null
    last_row: { seq: number; hash: string; daemon_version: string; ours: boolean } | null
    matches_state: boolean | null
    tail: { seq: number; type: string | null; local_seq: number | null; ours: boolean; anchor: boolean }[]
  }
  stats_24h: {
    checked_at: string
    rows: number
    capped: boolean
    first_seq: number | null
    last_seq: number | null
    oldest_ts: string | null
    newest_ts: string | null
    by_type: { type: string; count: number }[]
    window_since: string
  } | null
  // R83-VERIFY: journal-recorded last contract-verification run
  last_verify: { at: string; ok: boolean; rows: number; duration_ms: number; violations: number; trigger: string | null } | null
  // R83-AUTONOMY: the silent 6h self-check cadence (journal-derived schedule)
  auto_verify: { interval_ms: number; last_at: string | null; next_in_ms: number | null; running: boolean } | null
  history: Me2Event[]
}

// R83-VERIFY: in-process independent contract check (POST /mirror/verify)
interface MirrorVerifyResult {
  ok: boolean
  started_at: string
  duration_ms: number
  rows_checked: number
  head_seq: number | null
  violations: number
  first_broken_seq: number | null
  checks: { seq_continuity: boolean; prev_hash_chain: boolean; row_hashes: boolean; bindings: boolean }
  samples: string[]
}

// R83-AUTONOMY: R82 before/after diff report (GET /r82/report) — poisoned
// baseline (live-verified at diagnosis) vs live-now, metric by metric +
// key-moment timeline. Release-readiness material for R89; fills in as the
// exit gate converges.
interface ReportMetric {
  name: string
  before: string
  after: string
  status: 'improved' | 'pending' | 'same' | 'regressed'
  note: string
}
interface ReportTimelineItem {
  at: string | null
  event: string
  source: 'github' | 'journal' | 'live' | 'pending'
  detail?: string
}
interface R82Report {
  ok: boolean
  generated_at: string
  daemon_version: string
  gate: { current: string; closed: boolean }
  before: {
    diagnosed_at: string
    keepalive_state: string
    rollover_reason: string
    cycle_seq: number
    last_completed_cycle_at: string
    stale_completed_s_approx: number
    ambiguous_history_count: number
    extension_version: string
    dev_plane_head: string
    draft_chars_first_probe: number
    cognitive_state: string
    resync_count_approx: number
    fix_state: string
    provenance: string
  }
  after: {
    fetched_at: string
    extension_version: string
    dev_plane_head: string
    keepalive_state: string
    rollover_reason: string | null
    cycle_seq: number
    stale_completed_s: number | null
    last_completed_cycle_at: string | null
    ambiguous_history_count: number
    draft: { canary: string | null; chars: number | null; max_chars: number | null; cleared: boolean }
    cognitive: { state: string; resync_count: number; sent_events: number; acked: number }
    fix_state: string
  }
  metrics: ReportMetric[]
  timeline: ReportTimelineItem[]
  verdict: string
}

// ---------------------------------------------------------- gap matrix ----
const GAP_MATRIX: { pri: 'P0' | 'P1'; title: string; status: string; live?: 'keepalive' | 'cognitive'; closed?: boolean }[] = [
  { pri: 'P0', title: 'Supervisor useful cycle', status: 'EXIT-GATE WATCH live: PR #981 слит (e7fccd08), release-CI терминален → manifest → self-update → ручная очистка драфта оператором → рост cycle_seq; смотрите карточку R82 EXIT GATE + Before/After diff (материал R89)', live: 'keepalive' },
  { pri: 'P0', title: 'DevOS maintenance liveness', status: 'idle-gate fix в source; live timeout сохраняется до installer' },
  { pri: 'P0', title: 'Edge convergence', status: 'R83-импорт РЕАЛИЗОВАН: PR #982 (23 файла +4631/−0 под edge/, digest-контракт верифицирован: fabric 9c55419e37b0 == LIVE, aop1 29b36254b0b4cb4f == LIVE) под ревью оператора; promotion-gate = tools/verify-digests.mjs; деплой только после ревью + ротации CF-токена' },
  { pri: 'P0', title: 'Desktop convergence', status: 'PR #967: 7 commits, behind release 21 — donor, не trunk' },
  { pri: 'P0', title: 'Full installer', status: 'R85 in-flight: standalone daemon payload + version unify (18 commits, CI re-qualifying @ 2c28aa85)' },
  { pri: 'P0', title: 'Closed task loop', status: 'seed_proven=0 · NO_ELIGIBLE_CONVERSATION — блокировано ТЕМ ЖЕ отравленным драфтом (общая причина с supervisor rollover)' },
  { pri: 'P0', title: 'Source authority', status: 'DB roadmap baseline b69f… ≠ release cf747…' },
  { pri: 'P0', title: 'Credentials (security)', status: 'raw credentials в chat export → ротация у оператора' },
  { pri: 'P0', title: 'Cognitive convergence', status: 'улучшилось: SUPPORTED · ack 64525 (застой 157 снят); hard gate до R87', live: 'cognitive' },
  { pri: 'P1', title: 'Branch audit', status: 'ЗАКРЫТО: 621/621 heads классифицированы, UNRELATED_HISTORY поддержан (SUCCESS @ 5a1c6178)', closed: true },
  { pri: 'P1', title: 'Version identity', status: 'закрывается R85-волной: unify versions @ 7ca55f7e (CI pending)' },
  { pri: 'P1', title: 'Durable backlog hygiene', status: '578 AMBIGUOUS / 572 FENCED требуют terminal reconciliation' },
  { pri: 'P1', title: 'Startup', status: 'executable_will_launch_at_login=false требует physical verification' },
  { pri: 'P1', title: 'Worklog', status: 'human log → structured append-only evidence ledger' },
]

// ------------------------------------------------------------- chips ------
function Chip({ tone, children, className }: { tone: 'ok' | 'warn' | 'p0' | 'info' | 'neutral'; children: React.ReactNode; className?: string }) {
  const tones = {
    ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    warn: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    p0: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    neutral: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/40',
  } as const
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${tones[tone]} ${className ?? ''}`}>
      {children}
    </span>
  )
}

function eventTypeTone(t: string): string {
  if (t.startsWith('DAEMON_') || t.startsWith('RECOVERY_')) return 'text-teal-400'
  if (t.startsWith('WORKTREE_')) return 'text-emerald-400'
  if (t.startsWith('SANDBOX_')) return 'text-amber-400'
  if (t.startsWith('ACTION_')) return 'text-cyan-300'
  if (t.startsWith('MIRROR_')) return 'text-rose-400'
  return 'text-zinc-400'
}

// -------------------------------------------------------------- card ------
function Panel({
  icon, title, chip, children, defaultOpen = true, actions,
}: {
  icon: React.ReactNode; title: string; chip?: React.ReactNode
  children: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-lg shadow-black/20 transition-colors hover:border-zinc-700/80">
        <div className="flex items-center gap-1 pr-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 rounded-t-xl">
            <span className="text-teal-400">{icon}</span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wider text-zinc-200" title={title}>{title}</h2>
            {chip}
            <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? '' : '-rotate-90'}`} />
          </CollapsibleTrigger>
          {actions}
        </div>
        <CollapsibleContent>
          <div className="border-t border-zinc-800 p-4">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function Stat({ label, value, tone, span, title }: { label: string; value: React.ReactNode; tone?: string; span?: string; title?: string }) {
  const autoTitle = typeof value === 'string' ? value : undefined
  const tip = title ?? autoTitle
  return (
    <div className={`min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 ${span ?? ''}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500" title={typeof label === 'string' ? label : undefined}>{label}</div>
      <div className={`truncate font-mono text-xs ${tone ?? 'text-zinc-200'}`} title={tip}>{value}</div>
    </div>
  )
}

const scrollCls = 'max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent'

// ------------------------------------------------------- sparkline -------
const TOOLTIP_STYLE = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11, color: '#e4e4e7', padding: '4px 8px' } as const

function Spark({ data, color, label, value }: { data: { t: string; v: number }[]; color: string; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 transition-colors hover:border-zinc-700">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="shrink-0 font-mono text-xs" style={{ color }}>{value}</span>
      </div>
      <div className="mt-1.5 h-14">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <RTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#a1a1aa' }} itemStyle={{ color }} cursor={{ stroke: '#3f3f46' }} />
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">накапливаем сэмплы…</div>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------- draft timeline chart ------
// R83-WATCH: full-size draft-chars timeline over the durable 24h history
// (backlog item since R82-STICKY: «график draft chars из durable-истории
// при >48 сэмплах (downsample)»). The canary state is ENCODED IN COLOR: rose
// points are OVERSIZED (poisoned draft), emerald points are OK (cleared),
// failed/UNKNOWN probes leave gaps (connectNulls=false — a failed probe never
// fakes a draft value). The dashed amber line is the 4000-char canary
// threshold. The rose→emerald drop is the operator-clear moment — the live
// visual proof the whole OPERATOR_CLEAR stage waits for.
function DraftTimeline({ samples, threshold, clearedAt, resumedAt }: { samples: ReadbackDraftSample[]; threshold: number; clearedAt: string | null; resumedAt?: string | null }) {
  const { data, counts, downsampledFrom, markerT, markerRT } = useMemo(() => {
    const MAX_POINTS = 140
    let used = samples
    let from: number | null = null
    if (samples.length > MAX_POINTS) {
      from = samples.length
      const step = Math.ceil(samples.length / MAX_POINTS)
      const buckets: ReadbackDraftSample[][] = []
      for (let i = 0; i < samples.length; i += step) buckets.push(samples.slice(i, i + step))
      // bucket-max when any OVERSIZED sample is present (worst case stays
      // visible — the poison level must never be averaged away), otherwise
      // the LAST sample of the bucket (state transitions preserved)
      used = buckets.map((b) => {
        const oversized = b.filter((s) => s.canary === 'OVERSIZED' && s.chars != null)
        if (oversized.length > 0) return oversized.reduce((m, s) => ((s.chars ?? 0) > (m.chars ?? 0) ? s : m))
        return b[b.length - 1]
      })
    }
    const data = used.map((s) => ({
      t: hhmmss(s.ts),
      full: s,
      oversize: s.canary === 'OVERSIZED' && s.chars != null ? s.chars : null,
      ok: s.canary === 'OK' && s.chars != null ? s.chars : null,
    }))
    const counts = {
      oversized: samples.filter((s) => s.canary === 'OVERSIZED').length,
      ok: samples.filter((s) => s.canary === 'OK').length,
      unknown: samples.filter((s) => s.chars == null).length,
      lastChars: samples.length ? samples[samples.length - 1].chars : null,
    }
    // R83-VERIFY: milestone marker — the x category of the FIRST sample at/after
    // the journal clear-moment (categorical axis needs an exact category hit;
    // a marker before all samples pins to the left edge, after all — right edge)
    let markerT: string | null = null
    if (clearedAt) {
      const clearedMs = Date.parse(clearedAt)
      const at = used.find((s) => Date.parse(s.ts) >= clearedMs) ?? used[used.length - 1]
      markerT = at ? hhmmss(at.ts) : null
    }
    // R83-AUTONOMY: cycle-resume marker (journal milestone R82_CYCLE_RESUMED)
    // — same categorical exact-hit mechanics, violet, second vertical line
    let markerRT: string | null = null
    if (resumedAt) {
      const resumedMs = Date.parse(resumedAt)
      const at = used.find((s) => Date.parse(s.ts) >= resumedMs) ?? used[used.length - 1]
      markerRT = at ? hhmmss(at.ts) : null
    }
    return { data, counts, downsampledFrom: from, markerT, markerRT }
  }, [samples, clearedAt, resumedAt])

  const maxChars = Math.max(threshold * 1.25, ...data.map((d) => d.oversize ?? d.ok ?? 0))

  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Timeline драфта · chars</span>
        <Chip tone={counts.ok > 0 ? 'ok' : counts.oversized > 0 ? 'p0' : 'neutral'}>{counts.oversized} OVERSIZED</Chip>
        <Chip tone={counts.ok > 0 ? 'ok' : 'neutral'}>{counts.ok} OK</Chip>
        {counts.unknown > 0 && <Chip tone="neutral">{counts.unknown} без чтения</Chip>}
        {downsampledFrom != null && <Chip tone="info" title={`downsample: ${downsampledFrom} сэмплов → ${data.length} точек (bucket-max для OVERSIZED — уровень отравления не усредняется)`}>↓{data.length}/{downsampledFrom}</Chip>}
      </div>
      <div className="h-44">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <RTooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#a1a1aa' }}
                cursor={{ stroke: '#3f3f46' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload as { full: ReadbackDraftSample }
                  const s = d?.full
                  if (!s) return null
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div className="font-mono text-[10px] text-zinc-400">{s.ts}</div>
                      <div className="font-mono text-[11px]">
                        <span className={s.canary === 'OVERSIZED' ? 'text-rose-300' : s.canary === 'OK' ? 'text-emerald-300' : 'text-zinc-400'}>{s.canary}</span>
                        {s.chars != null && <span className="text-zinc-300"> · {s.chars} chars</span>}
                      </div>
                      {s.error && <div className="max-w-56 text-[10px] text-rose-300/80" title={s.error}>{s.error}</div>}
                      <div className="text-[10px] text-zinc-500">{s.source === 'opportunistic' ? 'oppo-проба' : 'периодическая'}</div>
                    </div>
                  )
                }}
              />
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval={Math.max(0, Math.ceil(data.length / 6) - 1)} minTickGap={16} />
              <YAxis tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} width={44} domain={[0, Math.ceil(maxChars * 1.08)]} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <ReferenceLine y={threshold} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `порог ${threshold}`, fill: '#f59e0b', fontSize: 9, position: 'insideTopRight' }} />
              {markerT && (
                <ReferenceLine
                  x={markerT}
                  stroke="#34d399"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  label={{ value: 'драфт очищен', fill: '#34d399', fontSize: 9, position: 'insideTopLeft' }}
                />
              )}
              {markerRT && (
                <ReferenceLine
                  x={markerRT}
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  label={{ value: 'cycle растёт', fill: '#a78bfa', fontSize: 9, position: 'insideTopLeft' }}
                />
              )}
              <Line type="monotone" dataKey="oversize" stroke="#fb7185" strokeWidth={1.5} dot={{ r: 1.5, fill: '#fb7185', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} name="OVERSIZED" />
              <Line type="monotone" dataKey="ok" stroke="#34d399" strokeWidth={1.5} dot={{ r: 1.5, fill: '#34d399', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} name="OK" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">нужно ≥2 сэмпла с чтением — сэмплер работает (5 мин / oppo)</div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------- audio alerts ----
// R83-WATCH: subtle WebAudio cues for gate transitions, milestones and mirror
// divergence (backlog: «звук/тост при смене current_gate»). No audio assets,
// zero network — a lazily-created AudioContext with quiet sine notes.
// Respects the persisted mute toggle and never fires in a hidden tab.
// R83-VERIFY: three persisted volume levels (тихо/средне/громко) — the gain
// scales linearly; the level cycles from the header button next to the bell.
type BeepKind = 'gate' | 'milestone' | 'alert'
type SoundLevel = 'quiet' | 'medium' | 'loud'
const SOUND_LEVELS: { id: SoundLevel; label: string; gain: number }[] = [
  { id: 'quiet', label: 'тихо', gain: 0.018 },
  { id: 'medium', label: 'средне', gain: 0.045 },
  { id: 'loud', label: 'громко', gain: 0.09 },
]
function soundLevel(): SoundLevel {
  try { return (localStorage.getItem('me2-sound-level') as SoundLevel) ?? 'medium' } catch { return 'medium' }
}
let audioCtx: AudioContext | null = null
function beep(kind: BeepKind): void {
  try {
    if (typeof document !== 'undefined' && document.hidden) return
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!audioCtx) audioCtx = new AC()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const peak = SOUND_LEVELS.find((l) => l.id === soundLevel())?.gain ?? 0.045
    const t0 = audioCtx.currentTime
    const notes: [number, number][] = kind === 'gate'
      ? [[880, 0], [660, 0.09]]                      // soft descending pair — gate moved
      : kind === 'milestone'
        ? [[523, 0], [784, 0.1]]                     // rising pair — milestone landed
        : [[392, 0], [311, 0.12], [392, 0.24]]       // double low — divergence
    for (const [freq, at] of notes) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.11)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.13)
    }
  } catch {
    /* audio is a nicety, never a dependency */
  }
}

// ================================================================ page =====
export default function MissionControl() {
  const { toast } = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [events, setEvents] = useState<Me2Event[]>([])
  const [supervisor, setSupervisor] = useState<Supervisor | null>(null)
  const [supErr, setSupErr] = useState<string | null>(null)
  const [supLoading, setSupLoading] = useState(false)
  const [roadmap, setRoadmap] = useState<RoadmapData | null>(null)
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [verdicts, setVerdicts] = useState<Verdicts | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [execResult, setExecResult] = useState<ExecResult | null>(null)
  const [monitor, setMonitor] = useState<MonitorHistory | null>(null)
  const [conv, setConv] = useState<Convergence | null>(null)
  const [convErr, setConvErr] = useState<string | null>(null)
  const [convLoading, setConvLoading] = useState(false)
  const [r82, setR82] = useState<R82Diag | null>(null)
  const [r82Err, setR82Err] = useState<string | null>(null)
  const [r82Loading, setR82Loading] = useState(false)
  const [edge, setEdge] = useState<EdgeStatus | null>(null)
  const [edgeErr, setEdgeErr] = useState<string | null>(null)
  const [edgeLoading, setEdgeLoading] = useState(false)
  const [edgePlan, setEdgePlan] = useState<EdgeImportPlan | null>(null)
  const [edgeImport, setEdgeImport] = useState<EdgeImportStatus | null>(null)
  const [edgeImportLoading, setEdgeImportLoading] = useState(false)
  const [readback, setReadback] = useState<Readback | null>(null)
  const [readbackErr, setReadbackErr] = useState<string | null>(null)
  const [readbackLoading, setReadbackLoading] = useState(false)
  const [mirror, setMirror] = useState<MirrorStatus | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const [donorReg, setDonorReg] = useState<DonorRegistry | null>(null)
  const [donorLane, setDonorLane] = useState<'ALL' | DonorAction['lane']>('ALL')
  const [donorQuery, setDonorQuery] = useState('')
  const [donorSort, setDonorSort] = useState<'name' | 'cost-asc' | 'cost-desc'>('name')
  // R83-AUTONOMY: donor-browser limit — lanes start collapsed to their first
  // 8 action cards; «показать ещё N» expands per-lane (limit at full list)
  const [donorLaneOpen, setDonorLaneOpen] = useState<Record<string, boolean>>({})
  // R83-AUTONOMY: R82 before/after diff report (poller 120s — mostly cache hits)
  const [r82report, setR82Report] = useState<R82Report | null>(null)
  const [wtName, setWtName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [wsLive, setWsLive] = useState(false)
  // R83-WATCH: audio-cue toggle (persisted; muted state also persisted) —
  // gate transitions beep 'gate', milestone events beep 'milestone', mirror
  // divergence beeps 'alert'. The toggle is a header ghost-button.
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem('me2-sound') !== 'off' } catch { return true }
  })
  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      const next = !on
      try { localStorage.setItem('me2-sound', next ? 'on' : 'off') } catch { /* storage best-effort */ }
      return next
    })
  }, [])
  // R83-VERIFY: volume level cycles quiet → medium → loud (persisted)
  const [levelIdx, setLevelIdx] = useState(() => {
    try { return Math.max(0, SOUND_LEVELS.findIndex((l) => l.id === soundLevel())) } catch { return 1 }
  })
  const cycleLevel = useCallback(() => {
    setLevelIdx((i) => {
      const next = (i + 1) % SOUND_LEVELS.length
      try { localStorage.setItem('me2-sound-level', SOUND_LEVELS[next].id) } catch { /* storage best-effort */ }
      return next
    })
  }, [])
  // R83-VERIFY: in-process contract verification (POST /mirror/verify) —
  // result state here; the handler is defined after loadMirror (deps order)
  const [mirrorVerifyRes, setMirrorVerifyRes] = useState<MirrorVerifyResult | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(1000)
  const filterRef = useRef<HTMLInputElement | null>(null)
  const donorSearchRef = useRef<HTMLInputElement | null>(null)
  const activeStageRef = useRef<HTMLDivElement | null>(null)
  const prevGateRef = useRef<string | null>(null)

  // ---- 1s live clock for relative ages
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ---- pollers
  const loadHealth = useCallback(async () => {
    try { setHealth(await jfetch<Health>('/health')); setHealthErr(null) }
    catch (e) { setHealthErr((e as Error).message) }
  }, [])

  const loadSupervisor = useCallback(async (fresh = false) => {
    setSupLoading(true)
    try { setSupervisor(await jfetch<Supervisor>(`/control-plane/supervisor${fresh ? '?fresh=1' : ''}`)); setSupErr(null) }
    catch (e) { setSupErr((e as Error).message) }
    finally { setSupLoading(false) }
  }, [])

  const loadWorktrees = useCallback(async () => {
    try { const d = await jfetch<{ worktrees: Worktree[] }>('/worktrees'); setWorktrees(d.worktrees) }
    catch { /* non-fatal */ }
  }, [])

  const loadConvergence = useCallback(async (fresh = false) => {
    setConvLoading(true)
    try { setConv(await jfetch<Convergence>(`/convergence${fresh ? '?fresh=1' : ''}`)); setConvErr(null) }
    catch (e) { setConvErr((e as Error).message) }
    finally { setConvLoading(false) }
  }, [])

  const loadR82 = useCallback(async (fresh = false) => {
    setR82Loading(true)
    try { setR82(await jfetch<R82Diag>(`/r82${fresh ? '?fresh=1' : ''}`)); setR82Err(null) }
    catch (e) { setR82Err((e as Error).message) }
    finally { setR82Loading(false) }
  }, [])

  const loadEdge = useCallback(async (fresh = false, snapshot = false) => {
    setEdgeLoading(true)
    try { setEdge(await jfetch<EdgeStatus>(`/edge${fresh ? '?fresh=1' : ''}${snapshot ? (fresh ? '&' : '?') + 'snapshot=1' : ''}`)); setEdgeErr(null) }
    catch (e) { setEdgeErr((e as Error).message) }
    finally { setEdgeLoading(false) }
  }, [])

  const loadReadback = useCallback(async (fresh = false) => {
    setReadbackLoading(true)
    try { setReadback(await jfetch<Readback>(`/readback${fresh ? '?fresh=1' : ''}`)); setReadbackErr(null) }
    catch (e) { setReadbackErr((e as Error).message) }
    finally { setReadbackLoading(false) }
  }, [])

  const loadEdgeImport = useCallback(async (fresh = false) => {
    setEdgeImportLoading(true)
    try { setEdgeImport(await jfetch<EdgeImportStatus>(`/edge/import-status${fresh ? '?fresh=1' : ''}`)) }
    catch { /* non-critical card section */ }
    finally { setEdgeImportLoading(false) }
  }, [])

  const loadMirror = useCallback(async (fresh = false) => {
    setMirrorLoading(true)
    try { setMirror(await jfetch<MirrorStatus>(`/mirror${fresh ? '?fresh=1' : ''}`)) }
    catch { /* non-critical card */ }
    finally { setMirrorLoading(false) }
  }, [])

  // R83-VERIFY: run the in-process independent contract check; the result
  // renders in the Mirror card and the run lands in the hash-chain (MIRROR_VERIFY)
  const runMirrorVerify = useCallback(async () => {
    setBusy('mirror-verify')
    try {
      const r = await jfetch<MirrorVerifyResult>('/mirror/verify', { method: 'POST' })
      setMirrorVerifyRes(r)
      toast({
        title: r.ok ? `✓ Контракт зеркала держит: ${r.rows_checked} строк` : `✗ Нарушений: ${r.violations}`,
        description: r.ok
          ? `seq-непрерывность + prev_hash-цепь + hash-пересчёт + кросс-биндинги — всё OK · ${r.duration_ms}ms · хвост #${r.head_seq}`
          : `${r.samples.slice(0, 2).join(' · ') || 'первое нарушение см. в карточке'}`,
        variant: r.ok ? undefined : 'destructive',
      })
      loadMirror(true)
    } catch (e) {
      toast({ title: 'Верификация не удалась', description: (e as Error).message, variant: 'destructive' })
    } finally { setBusy(null) }
  }, [toast, loadMirror])

  const syncMirrorNow = async () => {
    if (!window.confirm('Синхронизировать зеркальную цепочку с Supabase (batch-запись pending-событий)?')) return
    setBusy('mirror-sync')
    try {
      const r = await jfetch<{ synced: number; mirror_to_seq: number; duration_ms: number }>('/mirror/sync', { method: 'POST' })
      toast({ title: `Mirror sync: ${r.synced} событий`, description: `mirror #${r.mirror_to_seq} · ${r.duration_ms}ms` })
      loadMirror(true)
    } catch (e) { toast({ title: 'Mirror sync отклонён', description: (e as Error).message, variant: 'destructive' }) }
    finally { setBusy(null) }
  }

  useEffect(() => {
    loadHealth(); loadSupervisor(); loadWorktrees(); loadConvergence(); loadR82(); loadEdge(); loadReadback()
    jfetch<RoadmapData>('/roadmap').then(setRoadmap).catch(() => {})
    jfetch<Recovery>('/recovery').then(setRecovery).catch(() => {})
    jfetch<MonitorHistory>('/control-plane/history').then(setMonitor).catch(() => {})
    jfetch<DonorRegistry>('/donor-registry').then(setDonorReg).catch(() => {})
    jfetch<EdgeImportPlan>('/edge/import-plan').then(setEdgePlan).catch(() => {})
    jfetch<R82Report>('/r82/report').then(setR82Report).catch(() => {})
    loadEdgeImport()
    loadMirror()
    const a = setInterval(loadHealth, 5000)
    const b = setInterval(() => loadSupervisor(false), 10000)
    const c = setInterval(() => { jfetch<Verdicts>('/verdicts').then(setVerdicts).catch(() => {}) }, 10000)
    const e = setInterval(() => { jfetch<MonitorHistory>('/control-plane/history').then(setMonitor).catch(() => {}) }, 15000)
    const f = setInterval(() => { loadConvergence(false) }, 30000)
    const g = setInterval(() => { loadR82(false) }, 60000)
    const h = setInterval(() => { loadEdge(false) }, 120000)
    const j = setInterval(() => { loadEdgeImport(false) }, 120000)
    const i = setInterval(() => { loadReadback(false) }, 60000)
    const k = setInterval(() => { loadMirror(false) }, 60000)
    // R83-AUTONOMY: the before/after report rides its own gentle cadence — the
    // daemon side reads cached supervisor/CI state, so this is a cheap call
    const m = setInterval(() => { jfetch<R82Report>('/r82/report').then(setR82Report).catch(() => {}) }, 120000)
    jfetch<Verdicts>('/verdicts').then(setVerdicts).catch(() => {})
    const d = setInterval(loadWorktrees, 30000)
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); clearInterval(d); clearInterval(e); clearInterval(f); clearInterval(g); clearInterval(h); clearInterval(i); clearInterval(j); clearInterval(k); clearInterval(m) }
  }, [loadHealth, loadSupervisor, loadWorktrees, loadConvergence, loadR82, loadEdge, loadReadback, loadEdgeImport, loadMirror])

  // ---- event filter keyboard navigation: '/' focuses the filter, Esc clears.
  // R83-WATCH: donor-registry navigation — Alt+1..5 switches scheduler lanes,
  // Alt+D jumps to the donor search (backlog R82-STICKY «keyboard-навигация
  // lane-фильтров донор-браузера»). Alt-combos are safe while typing.
  useEffect(() => {
    const LANES = ['ALL', 'READ_ONLY', 'TAB_MUTATION', 'GLOBAL_MUTATION', 'EMERGENCY'] as const
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (ev.key === '/' && !typing) {
        ev.preventDefault()
        filterRef.current?.focus()
      } else if (ev.key === 'Escape' && target === filterRef.current) {
        setFilter('')
        filterRef.current?.blur()
      } else if (ev.key === 'Escape' && target === donorSearchRef.current) {
        // R83-AUTONOMY: Esc in the donor search behaves like the journal filter
        // — clear + blur (QA-found inconsistency: journal filter had it, donor
        // search did not, so Esc silently did nothing and trapped the '/'-hint)
        setDonorQuery('')
        donorSearchRef.current?.blur()
      } else if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        if (ev.code === 'KeyD') {
          ev.preventDefault()
          donorSearchRef.current?.focus()
          donorSearchRef.current?.select()
        } else if (/^Digit[1-5]$/.test(ev.code)) {
          ev.preventDefault()
          const lane = LANES[Number(ev.code.slice(5)) - 1]
          if (lane) setDonorLane(lane)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- REST events poll (fallback) + WS live stream (primary)
  useEffect(() => {
    const load = () => jfetch<{ events: Me2Event[] }>('/events?limit=60')
      .then((d) => setEvents(d.events)).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  // ---- milestone toast: one-shot notification for milestone-grade hash-chain
  // events (exit-gate transitions, edge evidence, operator mirror). Baseline is
  // seeded silently on first load — only NEW milestones toast (no storm).
  const milestoneSeqRef = useRef<number>(-1)
  const MILESTONE_LABELS: Record<string, string> = {
    R82_SELF_UPDATE_LANDED: 'Self-update доставлен в runtime',
    R82_CANARY_CONFIRMED: 'Canary подтверждён — новый код живой',
    R82_DRAFT_CLEARED: 'Драфт очищен оператором',
    R82_CYCLE_RESUMED: 'cycle_seq пошёл — R82 закрыт',
    EDGE_SNAPSHOT: 'Edge-снапшот снят в evidence',
    MIRROR_ANCHOR: 'Operator anchor записан',
    MIRROR_SYNC: 'Evidence зеркалирован в Supabase',
    MIRROR_VERIFY: 'Контракт зеркала проверен',
  }
  useEffect(() => {
    // R83-AUTONOMY: timer-triggered MIRROR_VERIFY runs are the SILENT 6h
    // cadence — they update the «последняя проверка» line, but never toast
    // (payload.trigger distinguishes operator clicks from the daemon timer)
    const milestones = events.filter((e) =>
      MILESTONE_LABELS[e.type] != null
      && !(e.type === 'MIRROR_VERIFY' && (e.payload as { trigger?: string } | null)?.trigger === 'timer'))
    if (milestones.length === 0) return
    const top = Math.max(...milestones.map((m) => m.seq))
    if (milestoneSeqRef.current < 0) {
      milestoneSeqRef.current = top // silent baseline on first load
      return
    }
    const fresh = milestones.filter((m) => m.seq > milestoneSeqRef.current)
    if (fresh.length === 0) return
    milestoneSeqRef.current = top
    if (soundOn) beep('milestone')
    for (const m of fresh.slice(-3)) {
      toast({
        title: `Milestone · ${MILESTONE_LABELS[m.type]}`,
        description: `#${m.seq} · ${m.type}${m.subject ? ` · ${m.subject}` : ''}`,
      })
    }
  }, [events, toast, soundOn])

  // ---- R83-AUTONOMY: sound unlock on the first user gesture. Browsers keep a
  // freshly-created AudioContext suspended until a user gesture happens in the
  // page — the first milestone/gate beep could otherwise be swallowed. A
  // one-time pointerdown/keydown resumes the context so every later cue plays
  // instantly. Silent by design (no unlock tone — the cue itself stays rare).
  useEffect(() => {
    let done = false
    const unlock = () => {
      if (done) return
      done = true
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        if (!audioCtx) audioCtx = new AC()
        if (audioCtx.state === 'suspended') void audioCtx.resume()
      } catch {
        /* audio is a nicety, never a dependency */
      }
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // ---- R83-WATCH: mirror-divergence auto-alert (backlog R83-MIRROR-3
  // «авто-алерт в тост при mirror_diverged»). The mirror is the evidence
  // pipeline — if it diverges or fails, the console must SAY SO the moment
  // the poller sees it, not only via a chip in the card. Transitions are
  // edge-detected (null → error / true → false = destructive toast + 'alert'
  // beep; recovery = informative toast), first load is the silent baseline.
  // False-alarm guard: a sync landing BETWEEN the status call's state-read
  // and live-read shows live.seq > state — benign lag that converges on the
  // next poll; only REAL divergence toasts (live.seq < state = truncation /
  // rollback, or equal seq with hash mismatch = foreign writer).
  const mirrorErrRef = useRef<boolean | null>(null)
  const mirrorMatchRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!mirror) return
    const err = !!mirror.state.last_error
    const liveSeq = mirror.live.last_row?.seq ?? null
    const stateSeq = mirror.state.last_mirror_seq
    const match = mirror.live.matches_state
    const benignLag = match === false && liveSeq != null && liveSeq > stateSeq
    const realDivergence = match === false && !benignLag
    const prevErr = mirrorErrRef.current
    const prevMatch = mirrorMatchRef.current
    // baseline: first observation is recorded silently
    if (prevErr === null) mirrorErrRef.current = err
    if (prevMatch === null) mirrorMatchRef.current = !realDivergence
    if (prevErr === null && prevMatch === null) return
    if (prevErr !== null && prevErr !== err) {
      mirrorErrRef.current = err
      if (err) {
        const le = mirror.state.last_error
        if (soundOn) beep('alert')
        toast({
          title: '⚠ Mirror: ошибка синка',
          description: `${le?.code ?? '?'}: ${(le?.message ?? '').slice(0, 120)} — fail-closed, записи остановлены`,
        })
      } else {
        toast({ title: 'Mirror восстановлен', description: 'последний синк без ошибок — запись в Supabase продолжается' })
      }
    }
    if (prevMatch !== null && prevMatch !== !realDivergence) {
      mirrorMatchRef.current = !realDivergence
      if (realDivergence) {
        if (soundOn) beep('alert')
        toast({
          title: '⚠ Mirror: live tail ≠ state',
          description: `живой хвост #${liveSeq ?? '?'} против durable state #${stateSeq}${liveSeq != null && liveSeq < stateSeq ? ' — УСЕЧЕНИЕ/откат хвоста' : ' — hash-несовпадение на том же seq (чужая запись)'}; требуется reconcile оператора`,
        })
      } else {
        toast({ title: 'Mirror: live tail ≡ state', description: 'живой хвост Supabase совпал с durable-state демона' })
      }
    }
  }, [mirror, toast, soundOn])

  // ---- stage-machine auto-scroll: when the exit-gate current_gate CHANGES,
  // bring the ACTIVE/BLOCKED stage row into view once (never on every poll).
  // R83-WATCH: the change also plays the 'gate' cue (backlog: «звук при
  // смене current_gate») — R82 closing will be audible, not just visible.
  useEffect(() => {
    const gate = readback?.current_gate ?? null
    const prev = prevGateRef.current
    prevGateRef.current = gate
    if (!gate || gate === prev) return
    if (prev === null) return // first load: no scroll jump
    if (soundOn) beep('gate')
    const t = setTimeout(() => {
      activeStageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(t)
  }, [readback?.current_gate, soundOn])

  useEffect(() => {
    let closed = false
    let pingT: ReturnType<typeof setInterval> | undefined
    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/?XTransformPort=3040`)
      wsRef.current = ws
      ws.onopen = () => { setWsLive(true); backoffRef.current = 1000; pingT = setInterval(() => ws.send(JSON.stringify({ kind: 'ping' })), 25000) }
      ws.onmessage = (m) => {
        try {
          const f = JSON.parse(String(m.data)) as { kind: string; event?: Me2Event }
          if (f.kind === 'event' && f.event) {
            setEvents((prev) => [f.event as Me2Event, ...prev.filter((p) => p.seq !== f.event!.seq)].slice(0, 200))
          }
        } catch { /* ignore malformed frame */ }
      }
      ws.onclose = () => {
        setWsLive(false)
        if (pingT) clearInterval(pingT)
        if (!closed) { setTimeout(connect, backoffRef.current); backoffRef.current = Math.min(backoffRef.current * 2, 15000) }
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { closed = true; if (pingT) clearInterval(pingT); wsRef.current?.close() }
  }, [])

  // ---- actions
  const doExec = async (cmd: string[]) => {
    setBusy(`exec:${cmd.join(' ')}`)
    try {
      const r = await jfetch<ExecResult>('/sandbox/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }) })
      setExecResult(r)
      toast({ title: r.ok ? 'Sandbox exec OK' : 'Sandbox exec FAILED', description: `${cmd.join(' ')} · ${r.elapsed_ms}ms` })
    } catch (e) { toast({ title: 'Sandbox error', description: (e as Error).message, variant: 'destructive' }) }
    finally { setBusy(null) }
  }

  const createWt = async () => {
    setBusy('wt-create')
    try {
      await jfetch('/worktrees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: wtName }) })
      toast({ title: 'Worktree создан', description: `${wtName} → branch work/${wtName}` })
      setWtName(''); loadWorktrees()
    } catch (e) { toast({ title: 'Ошибка worktree', description: (e as Error).message, variant: 'destructive' }) }
    finally { setBusy(null) }
  }

  const removeWt = async (name: string) => {
    if (!window.confirm(`Удалить worktree ${name}?`)) return
    setBusy(`wt-rm:${name}`)
    try {
      await jfetch('/worktrees', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      toast({ title: 'Worktree удалён', description: name })
      loadWorktrees()
    } catch (e) { toast({ title: 'Ошибка удаления', description: (e as Error).message, variant: 'destructive' }) }
    finally { setBusy(null) }
  }

  const exportEvents = async () => {
    setBusy('export')
    try {
      const d = await jfetch<{ events: Me2Event[]; last_seq: number }>('/events?limit=500')
      const blob = new Blob([d.events.map((e) => JSON.stringify(e)).join('\n')], { type: 'application/x-ndjson' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `me2-events-seq${d.last_seq}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.jsonl`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Журнал экспортирован', description: `${d.events.length} событий (до seq #${d.last_seq}) · .jsonl` })
    } catch (e) { toast({ title: 'Экспорт не удался', description: (e as Error).message, variant: 'destructive' }) }
    finally { setBusy(null) }
  }

  // ---- derived
  const daemonUp = !!health && !healthErr
  const supLive = !!supervisor
  const hbAge = supervisor ? Math.max(0, supervisor.heartbeat_age_s - Math.floor((now - Date.parse(supervisor.last_seen_at)) / 1000) * 0) : null
  // recompute heartbeat age locally against last_seen_at for a live tick
  const hbAgeLive = supervisor ? Math.round((now - Date.parse(supervisor.last_seen_at)) / 1000) : null
  const ka = supervisor?.keepalive
  const staleLive = ka?.last_completed_cycle_at ? Math.round((now - Date.parse(ka.last_completed_cycle_at)) / 1000) : null
  // R83-VERIFY: event-class quick filters (multi-select chips above the text
  // filter) — classes combine with the text query (AND). Counts are live.
  const EV_CLASSES: { id: string; label: string; title: string; match: (t: string) => boolean }[] = [
    { id: 'milestone', label: 'milestone', title: 'milestone-события exit-gate: R82_* и якорь зеркала', match: (t) => t.startsWith('R82_') || t === 'MIRROR_ANCHOR' },
    { id: 'evidence', label: 'evidence', title: 'доказательные операции: MIRROR_SYNC · MIRROR_VERIFY · EDGE_SNAPSHOT', match: (t) => t === 'MIRROR_SYNC' || t === 'MIRROR_VERIFY' || t === 'EDGE_SNAPSHOT' },
    { id: 'lifecycle', label: 'lifecycle', title: 'жизненный цикл демона: DAEMON_BOOT · BUS_CLIENT_*', match: (t) => t === 'DAEMON_BOOT' || t.startsWith('BUS_CLIENT_') },
    { id: 'ops', label: 'ops', title: 'операторские операции: SANDBOX_EXEC · ACTION_INVOKED · WORKTREE_* · RECOVERY_*', match: (t) => t === 'SANDBOX_EXEC' || t === 'ACTION_INVOKED' || t.startsWith('WORKTREE_') || t.startsWith('RECOVERY_') },
  ]
  const [evClasses, setEvClasses] = useState<string[]>([])
  const toggleEvClass = useCallback((id: string) => {
    setEvClasses((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]))
  }, [])
  const filtered = useMemo(
    () => events.filter((e) => {
      if (filter && !e.type.toLowerCase().includes(filter.toLowerCase())) return false
      if (evClasses.length > 0) {
        const cls = EV_CLASSES.find((c) => c.match(e.type))
        if (!cls || !evClasses.includes(cls.id)) return false
      }
      return true
    }),
    [events, filter, evClasses]
  )
  const mSamples = monitor?.samples ?? []
  const mLast = mSamples.length ? mSamples[mSamples.length - 1] : null
  const mkSeries = (get: (s: MonitorSample) => number | null) =>
    mSamples.filter((s) => get(s) != null).map((s) => ({ t: hhmmss(s.ts), v: get(s) as number }))

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 selection:bg-teal-500/30">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-teal-500/60 via-cyan-500/30 to-transparent" />
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/10 font-mono text-sm font-bold text-teal-400">M2</div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">ME2 OS · MISSION CONTROL</div>
              <div className="text-[11px] text-zinc-500">METAENGINE development swarm · control plane</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <Chip tone="warn">{health?.round ?? 'R83'} · AUTONOMY</Chip>
            <Chip tone={daemonUp ? 'ok' : 'p0'}>
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${daemonUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {daemonUp ? `daemon ${health?.version ?? ''}` : 'daemon OFFLINE'}
            </Chip>
            <Chip tone={wsLive ? 'info' : 'neutral'}>
              <Radio className="h-3 w-3" /> bus {wsLive ? 'live' : 'rest-only'}
            </Chip>
            <Button
              variant="ghost" size="sm"
              className="h-8 w-8 p-0 text-zinc-400 hover:text-teal-400"
              onClick={toggleSound}
              aria-label={soundOn ? 'Выключить звук оповещений' : 'Включить звук оповещений'}
              title={soundOn ? 'звук оповещений включён: смена exit-gate · milestone-события · расхождение mirror (клик — выкл)' : 'звук оповещений выключен (клик — вкл) — WebAudio, без внешних ассетов'}
            >
              {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-8 w-8 p-0 font-mono text-[10px] font-bold text-zinc-400 hover:text-teal-400"
              onClick={() => { cycleLevel(); if (soundOn) beep('milestone') }}
              aria-label={`Громкость оповещений: ${SOUND_LEVELS[levelIdx].label} (клик — следующая)`}
              title={`громкость: ${SOUND_LEVELS[levelIdx].label} (клик — переключает тихо→средне→громко; звучит пробный сигнал)`}
            >
              {SOUND_LEVELS[levelIdx].id === 'quiet' ? '◦' : SOUND_LEVELS[levelIdx].id === 'medium' ? '◦◦' : '◦◦◦'}
            </Button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ main */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        {/* ------------------------------------------------- DAEMON card */}
        <Panel
          icon={<HeartPulse className="h-4 w-4" />}
          title="Демон · ME2 daemon"
          chip={<Chip tone={daemonUp ? 'ok' : 'p0'}>{daemonUp ? 'UP' : 'DOWN'}</Chip>}
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" onClick={loadHealth} aria-label="Обновить health">
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        >
          {healthErr && !health ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">daemon недоступен: {healthErr}</div>
          ) : health ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="version" value={health.version} tone="text-teal-400" span="col-span-2" />
                <Stat label="uptime" value={humanS(health.uptime_s)} />
                <Stat label="last_seq" value={health.last_seq} tone="text-cyan-300" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-mono">head {health.head_hash.slice(0, 16)}…</span>
                <Chip tone="neutral">anchor mirror #{health.mirror_anchor.seq} · v{health.mirror_anchor.daemon_version}</Chip>
                <Chip tone="neutral">WS :{health.ws_port}</Chip>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Verdicts (cold-start safe)</div>
                <div className="flex flex-wrap gap-1.5">
                  {(verdicts?.verdicts ?? []).map((v) => (
                    <Chip key={v.id} tone={v.state === 'PASS' ? 'ok' : v.state === 'BOOT' ? 'warn' : 'p0'} title={v.detail}>
                      {v.id}:{v.state}
                    </Chip>
                  ))}
                  {!verdicts && <span className="text-xs text-zinc-600">загрузка…</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {donorReg ? (
                  <>
                    <Chip tone="ok">donor {donorReg.total} @ {donorReg.provenance.source_sha.slice(0, 8)}</Chip>
                    <Chip tone="info">counterparts {donorReg.reconciliation.counterparts_count} ({donorReg.reconciliation.full} full / {donorReg.reconciliation.partial} partial)</Chip>
                    <Chip tone="warn">pending {donorReg.reconciliation.pending_count} → R84–R86</Chip>
                    <Chip tone="neutral">{donorReg.lanes.READ_ONLY} RO · {donorReg.lanes.TAB_MUTATION} TAB · {donorReg.lanes.GLOBAL_MUTATION} GM · {donorReg.lanes.EMERGENCY} EMG</Chip>
                  </>
                ) : (
                  <Chip tone="neutral">donor-registry загрузка…</Chip>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Реестр: <span className="font-mono text-cyan-300">{health.actions.implemented} действий</span> реализовано локально. Donor-манифест восстановлен дословно из {donorReg?.provenance.source_ref ?? 'sandbox/me2-os'} (v{donorReg?.provenance.donor_daemon_version ?? '0.57.1'}): 4-lane scheduler, budget 24/60s; полная реализация bus — вместе с Browser control plane.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>

        {/* ---------------------------------------------- DONOR REGISTRY card */}
        <Panel
          icon={<Layers className="h-4 w-4" />}
          title="Донор-реестр · 57 действий"
          chip={donorReg ? <Chip tone="info">{donorReg.total} · {donorReg.reconciliation.counterparts_count}/{donorReg.total} local</Chip> : <Chip tone="neutral">…</Chip>}
        >
          {donorReg ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="donor actions" value={String(donorReg.total)} tone="text-cyan-300" />
                <Stat label="counterparts" value={`${donorReg.reconciliation.counterparts_count} (${donorReg.reconciliation.full}f/${donorReg.reconciliation.partial}p)`} tone="text-emerald-400" />
                <Stat label="pending → R84–R86" value={String(donorReg.reconciliation.pending_count)} tone="text-amber-400" />
                <Stat label="local-only" value={String(donorReg.reconciliation.local_only_count)} tone="text-zinc-300" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'READ_ONLY', 'TAB_MUTATION', 'GLOBAL_MUTATION', 'EMERGENCY'] as const).map((lane) => {
                  const n = lane === 'ALL' ? donorReg.total : donorReg.lanes[lane]
                  const active = donorLane === lane
                  const laneTone = lane === 'READ_ONLY' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : lane === 'TAB_MUTATION' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : lane === 'GLOBAL_MUTATION' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : lane === 'EMERGENCY' ? 'border-red-500/50 bg-red-500/15 text-red-300' : 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                  return (
                    <button
                      key={lane}
                      onClick={() => setDonorLane(lane)}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 ${active ? laneTone : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}
                      title={lane === 'ALL' ? 'все лены' : `lane priority: ${donorReg.lane_priority?.[lane] ?? '—'}`}
                    >
                      {lane === 'ALL' ? 'все' : lane === 'READ_ONLY' ? 'RO' : lane === 'TAB_MUTATION' ? 'TAB' : lane === 'GLOBAL_MUTATION' ? 'GM' : 'EMG'} · {n}
                    </button>
                  )
                })}
                <div className="relative min-w-[140px] flex-1 sm:max-w-[220px]">
                  <Input
                    ref={donorSearchRef}
                    value={donorQuery}
                    onChange={(e) => setDonorQuery(e.target.value)}
                    placeholder="поиск действия… (Alt+D)"
                    aria-label="Поиск по донор-реестру"
                    className="h-8 border-zinc-700 bg-zinc-950/60 pr-7 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-teal-500/40"
                  />
                  {donorQuery && (
                    <button onClick={() => setDonorQuery('')} aria-label="Сбросить поиск" className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">×</button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Сортировка донор-реестра">
                  <span className="mr-1 hidden text-[10px] text-zinc-600 sm:inline" title="Alt+1 — все · Alt+2 — READ_ONLY · Alt+3 — TAB_MUTATION · Alt+4 — GLOBAL_MUTATION · Alt+5 — EMERGENCY · Alt+D — поиск">Alt+1–5 · D</span>
                  {([['name', 'A→Z'], ['cost-asc', 'cost ↑'], ['cost-desc', 'cost ↓']] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setDonorSort(mode)}
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 ${donorSort === mode ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-zinc-700 bg-zinc-800/40 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'}`}
                      title={mode === 'name' ? 'сортировка по имени' : mode === 'cost-asc' ? 'сортировка по scheduler cost (дешёвые сначала)' : 'сортировка по scheduler cost (дорогие сначала)'}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const cpMap = new Map(donorReg.reconciliation.counterparts.map((c) => [c.donor, c]))
                const q = donorQuery.trim().toLowerCase()
                const matches = (a: DonorAction) => {
                  if (donorLane !== 'ALL' && a.lane !== donorLane) return false
                  if (!q) return true
                  const cp = cpMap.get(a.action)
                  return a.action.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q) || (cp ? `${cp.local} ${cp.note}`.toLowerCase().includes(q) : false)
                }
                const lanesShown = (donorLane === 'ALL' ? ['EMERGENCY', 'GLOBAL_MUTATION', 'TAB_MUTATION', 'READ_ONLY'] as const : [donorLane] as const)
                const laneMeta: Record<string, { label: string; cls: string; pri: string }> = {
                  EMERGENCY: { label: 'EMERGENCY', cls: 'text-red-300 border-red-500/40 bg-red-500/10', pri: '0' },
                  GLOBAL_MUTATION: { label: 'GLOBAL_MUTATION', cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10', pri: '2' },
                  TAB_MUTATION: { label: 'TAB_MUTATION', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10', pri: '4' },
                  READ_ONLY: { label: 'READ_ONLY', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', pri: '9' },
                }
                const shown = donorReg.actions.filter(matches).length
                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>показано <span className="font-mono text-zinc-300">{shown}</span> из <span className="font-mono">{donorReg.total}</span></span>
                      {donorQuery && <span>· фильтр: <span className="font-mono text-cyan-300">{donorQuery}</span></span>}
                      <span className="font-mono text-zinc-600">sort: {donorSort}</span>
                      <span className="ml-auto font-mono text-zinc-600">cost: ●=1 · budget {donorReg.budget?.limit ?? 24}/{Math.round((donorReg.budget?.windowMs ?? 60000) / 1000)}s</span>
                    </div>
                    <div className={`max-h-96 space-y-2.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-zinc-800/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600`}>
                      {lanesShown.map((lane) => {
                        const acts = donorReg.actions.filter((a) => a.lane === lane && matches(a))
                        if (acts.length === 0) return null
                        const sorted = [...acts].sort((a, b) =>
                          donorSort === 'name' ? a.action.localeCompare(b.action)
                          : donorSort === 'cost-asc' ? a.cost - b.cost || a.action.localeCompare(b.action)
                          : b.cost - a.cost || a.action.localeCompare(b.action)
                        )
                        // R83-AUTONOMY: limit at full list — each lane renders its
                        // first 8 cards until expanded (57 cards → ~32 rendered).
                        // A SEARCH QUERY BYPASSES the limit: matches hidden inside
                        // a collapsed lane would be silently unfindable otherwise
                        // (QA-found: «mirror» missed MIRROR_SYNC/MIRROR_VERIFY)
                        const LANE_LIMIT = 8
                        const expanded = donorLaneOpen[lane] || q.length > 0
                        const visible = expanded ? sorted : sorted.slice(0, LANE_LIMIT)
                        const meta = laneMeta[lane]
                        return (
                          <div key={lane}>
                            <div className="sticky top-0 z-[1] -mx-1 mb-1.5 flex items-center gap-2 bg-zinc-900/95 px-1 py-1 backdrop-blur-sm">
                              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.cls}`}>{meta.label}</span>
                              <span className="font-mono text-[10px] text-zinc-500">{acts.length}</span>
                              {!expanded && sorted.length > LANE_LIMIT && (
                                <span className="font-mono text-[9px] text-zinc-600" title={`первые ${LANE_LIMIT} из ${sorted.length} — «показать ещё» развернёт lane`}>показано {LANE_LIMIT}</span>
                              )}
                              <span className="ml-auto font-mono text-[9px] text-zinc-600">priority {meta.pri}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {visible.map((a) => {
                                const cp = cpMap.get(a.action)
                                return (
                                  <div key={a.action} className="group rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-zinc-200" title={a.action}>{a.action}</span>
                                      <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-500" title={`scheduler cost: ${a.cost}`}>{a.cost > 0 ? '●'.repeat(a.cost) : '·'}</span>
                                    </div>
                                    <div className="mt-0.5 text-[10px] leading-snug text-zinc-500" title={a.desc}>{a.desc}</div>
                                    <div className="mt-1 flex items-center gap-1.5">
                                      {cp ? (
                                        <span className={`inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] ${cp.mode === 'full' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`} title={`локальный аналог: ${cp.local} — ${cp.note}`}>
                                          {cp.mode === 'full' ? '✓' : '◐'} <span className="truncate">{cp.local}</span>
                                        </span>
                                      ) : (
                                        <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500" title="требует installed Browser control plane (R84–R86) — не может быть честно заявлена из песочницы">pending</span>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            {!expanded && sorted.length > LANE_LIMIT && (
                              <button
                                onClick={() => setDonorLaneOpen((prev) => ({ ...prev, [lane]: true }))}
                                className="mt-1.5 w-full rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 transition-colors hover:border-teal-600/50 hover:bg-teal-500/10 hover:text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
                                title={`развернуть lane ${meta.label}: ещё ${sorted.length - LANE_LIMIT} действий (сейчас скрыты)`}
                              >
                                показать ещё {sorted.length - LANE_LIMIT} из {sorted.length} · {meta.label}
                              </button>
                            )}
                          </div>
                        )
                      })}
                      {shown === 0 && <div className="py-6 text-center text-[11px] text-zinc-600">ничего не найдено — ослабьте фильтр или запрос</div>}
                    </div>
                  </div>
                )
              })()}
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="neutral" title={donorReg.provenance.source_path}>источник: {donorReg.provenance.source_ref} @ {donorReg.provenance.source_sha.slice(0, 8)}</Chip>
                <Chip tone="neutral">donor v{donorReg.provenance.donor_daemon_version}</Chip>
                {donorReg.legacy_surface_count && <Chip tone="neutral" title={donorReg.provenance.legacy_surface}>legacy surface: {donorReg.legacy_surface_count}</Chip>}
                <Chip tone="neutral">priorities EMG 0 · GM 2 · TAB 4 · RO 9</Chip>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Манифест восстановлен дословно из donor-линии. Браузер показывает все {donorReg.total} действий с lane-фильтром и поиском: <span className="text-emerald-300">✓</span> — локальный аналог реализован, <span className="text-amber-300">◐</span> — частично, <span className="text-zinc-400">pending</span> — требует Browser control plane (R84–R86). Полная реализация bus — вместе с R84–R86, не из песочницы.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка донор-реестра…</div>
          )}
        </Panel>

        {/* ------------------------------------------ CONTROL PLANE card */}
        <Panel
          icon={<Database className="h-4 w-4" />}
          title="Control Plane · Supabase live"
          chip={supErr ? <Chip tone="p0">ERR</Chip> : supLive ? <Chip tone={supervisor!.p0_flags.length ? 'p0' : 'ok'}>{supervisor!.p0_flags.length ? `${supervisor!.p0_flags.length} P0` : 'CLEAN'}</Chip> : <Chip tone="neutral">…</Chip>}
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={supLoading} onClick={() => loadSupervisor(true)} aria-label="Свежий снапшот">
              <RefreshCw className={`h-4 w-4 ${supLoading ? 'animate-spin' : ''}`} />
            </Button>
          }
        >
          {supErr && !supervisor ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">control plane: {supErr}</div>
          ) : supervisor ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="browser" value={supervisor.extension_version} tone="text-teal-400" span="col-span-2" />
                <Stat label="runtime" value={supervisor.operator_runtime} span="col-span-2" />
                <Stat label="client" value={supervisor.client_id.slice(0, 13) + '…'} />
                <Stat label="heartbeat" value={`${hbAgeLive ?? hbAge ?? '—'}s ago`} tone={(hbAgeLive ?? 99) < 30 ? 'text-emerald-400' : 'text-rose-400'} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={supervisor.compute_state === 'HEALTHY' ? 'ok' : 'p0'}>compute {supervisor.compute_state}</Chip>
                <Chip tone={supervisor.sentinel.worker_health === 'HEALTHY' ? 'ok' : 'p0'}>sentinel {supervisor.sentinel.lifecycle}/{supervisor.sentinel.worker_health}</Chip>
                <Chip tone={supervisor.dev_plane.state === 'READY' ? 'ok' : 'warn'}>dev-plane {supervisor.dev_plane.state}</Chip>
                <Chip tone="neutral">{supervisor.operator_mode} · armed={String(supervisor.armed)}</Chip>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Supervisor keepalive</span>
                  <Chip tone={ka!.state === 'ACTIVE' ? 'ok' : 'p0'}>{ka!.state}</Chip>
                  <Chip tone="neutral">cycle_seq {ka!.cycle_seq}</Chip>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="last useful cycle" value={staleLive != null ? `${humanS(staleLive)} назад` : '—'} tone={(staleLive ?? 0) > 3600 ? 'text-rose-400' : 'text-emerald-400'} />
                  <Stat label="ambiguous_hist" value={ka!.ambiguous_history_count} tone="text-amber-400" />
                  <Stat label="queued_wakes" value={ka!.queued_wake_count} />
                  <Stat label="rollover_reason" value={ka!.rollover_reason ?? '—'} tone="text-rose-400" span="col-span-2 sm:col-span-3" />
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Cognitive transport</span>
                  <Chip tone={supervisor.cognitive.state === 'CONVERGED' ? 'ok' : 'warn'}>{supervisor.cognitive.state}</Chip>
                  <Chip tone="neutral">resync #{supervisor.cognitive.resync_count}</Chip>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="stream" value={(supervisor.cognitive.stream_id ?? '—').slice(0, 13) + '…'} />
                  <Stat label="sent_events" value={supervisor.cognitive.sent_events} />
                  <Stat label="ack_through_seq" value={supervisor.cognitive.acknowledged_through_sequence} />
                  <Stat label="last_success" value={supervisor.cognitive.last_success_at ? hhmmss(supervisor.cognitive.last_success_at) : '—'} />
                </div>
              </div>
              {supervisor.p0_flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {supervisor.p0_flags.map((f) => <Chip key={f} tone="p0"><ShieldAlert className="h-3 w-3" />{f}</Chip>)}
                </div>
              )}
              <p className="text-[11px] text-zinc-500">
                Source authority (live read model): <span className="font-mono text-zinc-400">{supervisor.dev_plane.head.slice(0, 12)}</span> @ {supervisor.dev_plane.ref.replace('refs/heads/', '')}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>

        {/* ------------------------------------------ R81 CONVERGENCE (GitHub) */}
        <Panel
          icon={<GitPullRequest className="h-4 w-4" />}
          title="R81 Convergence · GitHub live"
          chip={
            convErr ? <Chip tone="p0">ERR</Chip>
              : conv ? (
                <Chip tone={conv.rollup_state === 'GREEN' ? 'ok' : conv.rollup_state === 'RED' ? 'p0' : conv.rollup_state === 'PENDING' ? 'warn' : 'neutral'}>
                  CI {conv.rollup_state}
                </Chip>
              ) : <Chip tone="neutral">…</Chip>
          }
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={convLoading} onClick={() => loadConvergence(true)} aria-label="Свежий GitHub-статус">
              <RefreshCw className={`h-4 w-4 ${convLoading ? 'animate-spin' : ''}`} />
            </Button>
          }
        >
          {convErr && !conv ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">GitHub: {convErr}</div>
          ) : conv ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="PR #968" value={conv.pr ? `${conv.pr.state}${conv.pr.draft ? ' · draft' : ''}` : '—'} tone="text-teal-400" span="col-span-2" />
                <Stat label="mergeable" value={conv.pr ? (conv.pr.mergeable == null ? '—' : conv.pr.mergeable ? 'yes' : 'no') : '—'} tone={conv.pr?.mergeable ? 'text-emerald-400' : 'text-amber-400'} span="col-span-2" />
                <Stat label="head" value={conv.head?.short ?? '—'} tone="text-cyan-300" />
                <Stat label="committed" value={conv.head?.committed_at ? hhmmss(conv.head.committed_at) : '—'} />
                <Stat label="checks" value={`${conv.checks.success}/${conv.checks.total}`} tone={conv.rollup_state === 'GREEN' ? 'text-emerald-400' : 'text-amber-400'} span="col-span-2" />
              </div>
              {conv.head && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 font-mono text-[11px] leading-snug text-zinc-400">
                  <span className="text-teal-400">{conv.head.short}</span> {conv.head.message}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={conv.rollup_state === 'GREEN' ? 'ok' : conv.rollup_state === 'RED' ? 'p0' : 'warn'}>CI {conv.rollup_state}</Chip>
                <Chip tone="ok">success {conv.checks.success}</Chip>
                {conv.checks.pending > 0 && <Chip tone="warn">pending {conv.checks.pending} · in_progress {conv.checks.in_progress}</Chip>}
                {conv.checks.failed > 0 && <Chip tone="p0">failed {conv.checks.failed}</Chip>}
                {conv.checks.cancelled > 0 && <Chip tone="neutral">cancelled {conv.checks.cancelled}</Chip>}
                <Chip tone="neutral">total {conv.checks.total}</Chip>
                {conv.api.rate_remaining != null && <Chip tone="neutral">rate {conv.api.rate_remaining}</Chip>}
              </div>
              <div className={`space-y-1 ${scrollCls} pr-1`}>
                {conv.checks.items.map((c, i) => {
                  const tone: 'ok' | 'warn' | 'p0' | 'neutral' = c.status !== 'completed'
                    ? 'warn'
                    : c.conclusion === 'success' ? 'ok' : (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required') ? 'p0' : 'neutral'
                  return (
                    <div key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 hover:border-zinc-700">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300" title={c.name}>{c.name}</span>
                      <Chip tone={tone}>{c.status === 'completed' ? (c.conclusion ?? '—') : c.status}</Chip>
                    </div>
                  )
                })}
                {conv.checks.items.length === 0 && <div className="py-4 text-center text-xs text-zinc-600">check-runs пусты — CI ещё не стартовал</div>}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Read-only GitHub-клиент демона (PAT только серверно в /home/z/.a2). Rollup честный: cancelled ≠ green — терминальный повтор обязателен.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка GitHub-статуса…</div>
          )}
        </Panel>

        {/* ------------------------------------------ R82 LIVE DIAGNOSIS */}
        <Panel
          icon={<Stethoscope className="h-4 w-4" />}
          title="R82 · Supervisor live-диагноз"
          chip={
            r82Err ? <Chip tone="p0">ERR</Chip>
              : r82 ? (
                <Chip tone={r82.attempt_tab_probe.draft_canary === 'OVERSIZED' ? 'p0' : r82.supervisor.keepalive.state === 'ACTIVE' ? 'ok' : 'warn'}>
                  {r82.attempt_tab_probe.draft_canary === 'OVERSIZED' ? 'DRAFT POISONED' : r82.supervisor.keepalive.state}
                </Chip>
              ) : <Chip tone="neutral">…</Chip>
          }
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={r82Loading} onClick={() => loadR82(true)} aria-label="Свежая R82-диагностика">
              <RefreshCw className={`h-4 w-4 ${r82Loading ? 'animate-spin' : ''}`} />
            </Button>
          }
        >
          {r82Err && !r82 ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">R82: {r82Err}</div>
          ) : r82 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="keepalive" value={r82.supervisor.keepalive.state} tone="text-amber-300" span="col-span-2" />
                <Stat label="cycle_seq" value={String(r82.supervisor.keepalive.cycle_seq)} tone="text-amber-300" span="col-span-2" />
                <Stat label="attempt tab" value={r82.attempt_tab_probe.tab_id ? r82.attempt_tab_probe.tab_id.slice(0, 14) + '…' : '—'} />
                <Stat label="tab state" value={r82.attempt_tab_probe.blank ? 'BLANK ZOMBIE' : r82.attempt_tab_probe.probed ? (r82.attempt_tab_probe.url || '—') : 'нет активной'} tone={r82.attempt_tab_probe.blank ? 'text-rose-400' : 'text-zinc-200'} />
                <Stat label="draft, chars" value={r82.attempt_tab_probe.composer_value_length != null ? String(r82.attempt_tab_probe.composer_value_length) : '—'} tone={r82.attempt_tab_probe.draft_canary === 'OVERSIZED' ? 'text-rose-400' : 'text-emerald-400'} />
                <Stat label="draft canary" value={r82.attempt_tab_probe.draft_canary} tone={r82.attempt_tab_probe.draft_canary === 'OVERSIZED' ? 'text-rose-400' : r82.attempt_tab_probe.draft_canary === 'OK' ? 'text-emerald-400' : 'text-zinc-400'} />
              </div>
              {/* probe error surface (R82 card backlog) */}
              {r82.attempt_tab_probe.error && (
                <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 font-mono text-[10px] text-amber-200/80">probe error: {r82.attempt_tab_probe.error}</div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="info">runtime = release head cf747798</Chip>
                {r82.fix.pr && (
                  <>
                    <Chip tone={r82.fix.pr.state === 'open' ? 'warn' : 'ok'}>PR #{r82.fix.pr.number} {r82.fix.pr.state}</Chip>
                    <Chip tone={r82.fix.pr.ci.failed > 0 ? 'p0' : r82.fix.pr.ci.success === r82.fix.pr.ci.total && r82.fix.pr.ci.total > 0 ? 'ok' : 'warn'}>
                      CI {r82.fix.pr.ci.success}/{r82.fix.pr.ci.total}{r82.fix.pr.ci.pending > 0 ? ` · ${r82.fix.pr.ci.pending} pending` : ''}
                    </Chip>
                  </>
                )}
                {r82.attempt && <Chip tone="neutral">attempt {r82.attempt.attempt_id ? r82.attempt.attempt_id.slice(0, 18) + '…' : '—'}</Chip>}
              </div>
              <div className={`space-y-1 ${scrollCls} pr-1`}>
                <div className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Причинная цепочка (live-proven 2026-09-26)</div>
                {r82.root_cause_chain.map((c) => (
                  <div key={c} className="rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-zinc-400 hover:border-zinc-700">
                    {c}
                  </div>
                ))}
              </div>
              {r82.attempt_history_tail.length > 0 && (
                <div className={`space-y-1 ${scrollCls} pr-1`}>
                  <div className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Хвост ambiguous_history</div>
                  {r82.attempt_history_tail.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 hover:border-zinc-700">
                      <span className="font-mono text-[11px] text-amber-300">#{h.cycle_seq ?? '—'}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400" title={h.ambiguous_reason ?? ''}>{h.ambiguous_reason ?? '—'}</span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-600">{h.ambiguous_at ? hhmmss(h.ambiguous_at) : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
                <span className="font-semibold uppercase tracking-wider">Действие оператора:</span> {r82.operator_action}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Пробы только READ-ONLY (CAPTURE через command fastlane) — урок R82: каждая вставка в отравленный root-композер растит общий account-draft. Диагностика никогда не мутирует наблюдаемую поверхность.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> live-проба tab'а супервизора…</div>
          )}
        </Panel>

        {/* ------------------------------------------ R82 EXIT GATE WATCH */}
        <Panel
          icon={<Rocket className="h-4 w-4" />}
          title="R82 EXIT GATE · SELF-UPDATE WATCH"
          chip={
            readbackErr ? <Chip tone="p0">ERR</Chip>
              : readback ? (
                <Chip tone={readback.current_gate === 'R82_CLOSED' ? 'ok' : readback.stages.find((s) => s.state === 'BLOCKED') ? 'p0' : 'warn'}>
                  {readback.current_gate}
                </Chip>
              ) : <Chip tone="neutral">…</Chip>
          }
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={readbackLoading} onClick={() => loadReadback(true)} aria-label="Свежий readback">
              <RefreshCw className={`h-4 w-4 ${readbackLoading ? 'animate-spin' : ''}`} />
            </Button>
          }
        >
          {readbackErr && !readback ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">readback: {readbackErr}</div>
          ) : readback ? (
            <div className="space-y-3">
              {/* stage machine */}
              <div className="space-y-0">
                {readback.stages.map((s, i) => {
                  const icon =
                    s.state === 'DONE' ? <span className="text-emerald-400">✓</span>
                      : s.state === 'ACTIVE' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                        : s.state === 'BLOCKED' ? <span className="text-rose-400">✗</span>
                          : <span className="text-zinc-600">•</span>
                  const rowCls =
                    s.state === 'DONE' ? 'border-emerald-500/25 bg-emerald-500/5'
                      : s.state === 'ACTIVE' ? 'border-amber-500/40 bg-amber-500/5'
                        : s.state === 'BLOCKED' ? 'border-rose-500/30 bg-rose-500/5'
                          : 'border-zinc-800 bg-zinc-950/60'
                  return (
                    <div key={s.stage} data-stage={s.stage} ref={s.state === 'ACTIVE' ? activeStageRef : undefined} className="relative flex gap-2.5">
                      {i < readback.stages.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-8px)] w-px bg-zinc-800" />}
                      <div className={`z-10 mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${rowCls}`}>{icon}</div>
                      <div className={`mb-1.5 min-w-0 flex-1 rounded-lg border px-2.5 py-2 ${rowCls}`}>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{i + 1}. {s.stage}</span>
                          <span className={`text-xs font-semibold ${s.state === 'DONE' ? 'text-emerald-300' : s.state === 'ACTIVE' ? 'text-amber-300' : s.state === 'BLOCKED' ? 'text-rose-300' : 'text-zinc-400'}`}>{s.title}</span>
                          <Chip tone={s.state === 'DONE' ? 'ok' : s.state === 'ACTIVE' ? 'warn' : s.state === 'BLOCKED' ? 'p0' : 'neutral'} className="ml-auto shrink-0">{s.state}</Chip>
                        </div>
                        <div className="mt-0.5 break-words font-mono text-[10px] leading-snug text-zinc-500">{s.detail}</div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* release CI + runtime identity */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="release head" value={readback.release_ci?.head?.short ?? '—'} tone="text-cyan-300" span="col-span-2" />
                <Stat label="release CI" value={readback.release_ci ? `${readback.release_ci.checks.success}/${readback.release_ci.checks.total}${readback.release_ci.terminal ? '' : ' ↻'}` : '—'} tone={readback.release_ci?.green ? 'text-emerald-400' : readback.release_ci?.terminal ? 'text-rose-400' : 'text-amber-400'} span="col-span-2" />
                <Stat label="runtime сейчас" value={readback.runtime.extension_version} tone={readback.runtime.self_update_landed ? 'text-emerald-400' : 'text-zinc-400'} span="col-span-2" />
                <Stat label="baseline (до фикса)" value={readback.baseline.extension_version} tone="text-zinc-600" span="col-span-2" />
                <Stat label="manifest rail" value={readback.release_ci?.checks.publish_manifest ?? '—'} tone={readback.release_ci?.checks.publish_manifest === 'SUCCESS' ? 'text-emerald-400' : 'text-amber-400'} />
                <Stat label="cycle_seq" value={`${readback.cycle.current}${readback.cycle.growth > 0 ? ` (+${readback.cycle.growth})` : ''}`} tone={readback.cycle.growth > 0 ? 'text-emerald-400' : 'text-zinc-400'} />
                <Stat label="rollover-попытки (окно монитора)" value={`${readback.attempts?.distinct_attempts ?? '—'}`} tone={readback.attempts?.distinct_attempts ? 'text-amber-400' : 'text-zinc-400'} title="Сколько свежих rollover-попыток стартовал супервизор в окне монитора (~1ч): каждая = новый таб + гидрация драфта + canary-аборт — живой пульс retry-цикла" />
                <Stat label="текущая попытка" value={readback.attempts?.current ? readback.attempts.current.attempt_id.slice(9, 17) : '—'} tone={readback.attempts?.current ? 'text-cyan-300' : 'text-zinc-400'} title={readback.attempts?.current ? `${readback.attempts.current.attempt_id}\nstart: ${readback.attempts.current.started_at ?? '—'}\nreason: ${readback.attempts.current.ambiguous_reason ?? '—'}\ntab: ${readback.attempts.current.tab_id ?? '—'}` : 'нет активной rollover-попытки'} />
              </div>

              {/* version transitions */}
              {readback.runtime.version_transitions.length > 0 && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300">Переходы версии runtime (monitor history)</div>
                  {readback.runtime.version_transitions.map((t, i) => (
                    <div key={i} className="break-all font-mono text-[10px] text-emerald-200/90">
                      {hhmmss(t.ts)}: {t.from} → <span className="font-bold">{t.to}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* R82-HARDEN: canary proof chain — observed machine-readable reasons */}
              {readback.canary?.observed_reasons && readback.canary.observed_reasons.length > 0 && (
                <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">Canary-доказательства (sticky — исторический факт)</span>
                    <Chip tone="ok" className="ml-auto">{readback.canary.confirmed_source ?? '—'}</Chip>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {readback.canary.observed_reasons.map((r) => (
                      <span key={r} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200" title="machine-readable rollover-причина, которую старый код не мог породить — доказательство, что фиксы PR #981 физически исполняются">{r}</span>
                    ))}
                  </div>
                  {readback.canary.confirmed_at && <div className="mt-1.5 font-mono text-[9px] text-zinc-600">подтверждено: {readback.canary.confirmed_at.slice(11, 19)}Z · источник: {readback.canary.confirmed_source}</div>}
                </div>
              )}

              {/* R83-AUTONOMY: before/after diff report — the R89 release-readiness
                  material. Fills in live as the gate converges: every metric row
                  shows poisoned-baseline → live-now with a status badge. */}
              {r82report && (
                <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-violet-300" title={`до: живоверифицированный отравленный baseline при диагностике R82 (${r82report.before.diagnosed_at}) · после: live сейчас (${r82report.after.fetched_at}) — ${r82report.before.provenance}`}>Before / After · diff R82</span>
                    <Chip tone={r82report.gate.closed ? 'ok' : 'warn'}>{r82report.gate.closed ? 'ЗАКРЫТ' : r82report.gate.current}</Chip>
                    <Chip tone="neutral" title="метрик improved / всего">{r82report.metrics.filter((mm) => mm.status === 'improved').length}/{r82report.metrics.length} improved</Chip>
                    <span className="ml-auto font-mono text-[9px] text-zinc-600" title={r82report.generated_at}>обновлён {hhmmss(r82report.generated_at)}Z</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-left">
                      <thead>
                        <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                          <th className="w-[26%] pb-1 pr-2 font-medium">метрика</th>
                          <th className="w-[30%] pb-1 pr-2 font-medium">до (диагноз)</th>
                          <th className="w-[32%] pb-1 pr-2 font-medium">после (live)</th>
                          <th className="pb-1 font-medium">статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r82report.metrics.map((mm) => (
                          <tr key={mm.name} className="border-t border-zinc-800/60 align-top">
                            <td className="py-1.5 pr-2 text-[11px] font-medium text-zinc-300" title={mm.note}>{mm.name}</td>
                            <td className="py-1.5 pr-2 font-mono text-[10px] text-zinc-500" title={mm.before}>{mm.before}</td>
                            <td className="py-1.5 pr-2 font-mono text-[10px] text-zinc-200" title={mm.after}>{mm.after}</td>
                            <td className="py-1.5">
                              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                                mm.status === 'improved' ? 'bg-emerald-500/15 text-emerald-300'
                                  : mm.status === 'pending' ? 'bg-amber-500/15 text-amber-300'
                                    : mm.status === 'regressed' ? 'bg-rose-500/15 text-rose-300'
                                      : 'bg-zinc-500/15 text-zinc-400'}`}
                                title={mm.note}>
                                {mm.status === 'improved' ? '↑ improved' : mm.status === 'pending' ? '… pending' : mm.status === 'regressed' ? '↓ regressed' : '= same'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2.5 space-y-1">
                    <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">Ключевые моменты (durable: journal + GitHub)</div>
                    {r82report.timeline.map((t, idx) => (
                      <div key={idx} className="flex items-baseline gap-2 font-mono text-[10px]">
                        <span className={`w-[64px] shrink-0 ${t.at ? 'text-zinc-400' : 'text-zinc-700'}`}>{t.at ? hhmmss(t.at) : 'pending'}</span>
                        <span className={`shrink-0 rounded px-1 text-[8px] font-bold uppercase ${
                          t.source === 'journal' ? 'bg-teal-500/15 text-teal-300'
                            : t.source === 'github' ? 'bg-cyan-500/15 text-cyan-300'
                              : t.source === 'live' ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-zinc-700/40 text-zinc-500'}`}
                          title={t.source === 'journal' ? 'hash-chain журнал демона' : t.source === 'github' ? 'GitHub check-runs / commit metadata' : t.source === 'live' ? 'живой readback' : 'ещё не произошло — ожидаем'}>
                          {t.source}
                        </span>
                        <span className={`min-w-0 flex-1 ${t.at ? 'text-zinc-300' : 'text-zinc-600'}`} title={t.detail ?? t.event}>{t.event}{t.detail ? ` — ${t.detail}` : ''}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 border-t border-zinc-800/60 pt-2 text-[10px] leading-relaxed text-zinc-500">{r82report.verdict}</p>
                </div>
              )}

              {/* draft history */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500" title="durable-история: data/draft-history.jsonl, до 24 ч (288 проб), переживает рестарты демона">История драфта (READ-ONLY: периодический 5 мин + oppo-сэмплер · durable 24 ч)</span>
                  <Chip tone={readback.draft.cleared ? 'ok' : readback.draft.last?.canary === 'OVERSIZED' ? 'p0' : 'neutral'}>
                    {readback.draft.cleared ? 'CLEARED' : readback.draft.last?.canary ?? '…'}
                  </Chip>
                  {readback.draft.max_chars != null && <Chip tone="neutral">max {readback.draft.max_chars} chars</Chip>}
                  <Chip tone="neutral">порог {readback.draft.threshold}</Chip>
                  {(() => {
                    const oppo = readback.draft.samples.filter((s) => s.source === 'opportunistic').length
                    return oppo > 0 ? <Chip tone="info">oppo-проб {oppo}</Chip> : null
                  })()}
                </div>
                <DraftTimeline samples={readback.draft.samples} threshold={readback.draft.threshold} clearedAt={readback.draft.cleared_at} resumedAt={readback.cycle.resumed_at} />
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Последние пробы</div>
                  <div className="max-h-24 space-y-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700">
                    {readback.draft.samples.slice(-8).reverse().map((s, i) => (
                      <div key={i} className="flex items-baseline gap-2 font-mono text-[10px]">
                        <span className="text-zinc-600">{hhmmss(s.ts)}</span>
                        {s.source === 'opportunistic' && <span className="shrink-0 rounded bg-cyan-500/15 px-1 text-[9px] font-bold uppercase text-cyan-300" title="оппортунистическая проба — снята в момент старта новой rollover-попытки, пока attempt-таб жив">oppo</span>}
                        <span className={s.canary === 'OVERSIZED' ? 'text-rose-400' : s.canary === 'OK' ? 'text-emerald-400' : 'text-zinc-500'}>{s.canary}</span>
                        <span className="ml-auto truncate text-zinc-400" title={`${s.ts} · ${s.canary}${s.chars != null ? ` · ${s.chars} chars` : ''}${s.error ? ` · ${s.error}` : ''} · ${s.source === 'opportunistic' ? 'оппортунистическая проба' : 'периодическая проба'}`}>{s.chars != null ? `${s.chars} chars` : s.error ? s.error.slice(0, 40) : '—'}</span>
                      </div>
                    ))}
                    {readback.draft.samples.length === 0 && <div className="py-2 text-center text-[10px] text-zinc-600">сэмплер разогревается (первый сэмпл ~1 мин)…</div>}
                  </div>
                </div>
              </div>

              {readback.release_ci_error && (
                <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 font-mono text-[10px] text-amber-200/80">release CI: {readback.release_ci_error}</div>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Gate-машина верифицирует каждый этап против живых данных: release CI на merge-head {readback.baseline.merge_head} → публикация manifest (publish-exact-verified-target) → смена версии runtime (baseline {readback.baseline.extension_version}) → канарей ROOT_DRAFT_OVERSIZED → ручная очистка драфта → монотонный рост cycle_seq от {readback.cycle.baseline}. Драфт-пробы строго READ-ONLY (CAPTURE); milestone-события пишутся в hash-chain однократно при переходе.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> сборка exit-gate снимка…</div>
          )}
        </Panel>

        {/* -------------------------------------------- R83 EDGE CONVERGENCE */}
        <Panel
          icon={<Cloud className="h-4 w-4" />}
          title="R83 · Edge convergence · Cloudflare live"
          chip={
            edgeErr ? <Chip tone="p0">ERR</Chip>
              : edge ? (
                <Chip tone={edge.workers.some((w) => w.source.verdict === 'NO_SOURCE_IN_REPO' && w.live_bytes && w.live_bytes > 1000) ? 'p0' : 'ok'}>
                  {edge.workers.filter((w) => w.source.verdict === 'NO_SOURCE_IN_REPO' && w.live_bytes && w.live_bytes > 1000).length}/2 NO SOURCE
                </Chip>
              ) : <Chip tone="neutral">…</Chip>
          }
          actions={
            <div className="flex items-center">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={edgeLoading} onClick={() => loadEdge(true, true)} aria-label="Снять live-снапшот воркеров" title="Свежая квалификация + снапшот живых скриптов в evidence">
                <Camera className={`h-4 w-4 ${edgeLoading ? 'animate-pulse' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" disabled={edgeLoading} onClick={() => loadEdge(true)} aria-label="Свежий Edge-статус">
                <RefreshCw className={`h-4 w-4 ${edgeLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        >
          {edgeErr && !edge ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">Edge: {edgeErr}</div>
          ) : edge ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="info">{edge.subdomain ?? '—'}.workers.dev</Chip>
                <Chip tone="neutral">{edge.workers.length} workers</Chip>
                {edge.workers.map((w) => (
                  <Chip key={w.id} tone={w.source.verdict === 'NO_SOURCE_IN_REPO' ? (w.live_bytes && w.live_bytes > 1000 ? 'p0' : 'neutral') : w.source.verdict === 'DRIFT' ? 'warn' : 'ok'}>
                    {w.id.replace('metaengine-', '').replace('metaengine-fabric-worker-h205f21r4', 'fabric')} · {w.source.verdict === 'NO_SOURCE_IN_REPO' ? 'NO SRC' : w.source.verdict}
                  </Chip>
                ))}
              </div>
              <div className={`space-y-2 ${scrollCls} pr-1`}>
                {edge.workers.map((w) => (
                  <div key={w.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 break-all font-mono text-xs text-teal-300">{w.id}</span>
                      <span className="ml-auto flex items-center gap-1.5">
                        {w.durable_object && <Chip tone="warn">DO {w.durable_object}</Chip>}
                        {w.queue && <Chip tone="neutral">queue {w.queue}</Chip>}
                        {w.workflow && <Chip tone="neutral">workflow</Chip>}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">{w.role}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label="versions" value={w.versions_total != null ? `${w.versions_total} (latest v${w.latest_version?.number ?? '—'})` : '—'} />
                      <Stat label="live digest" value={w.live_sha256 ?? '—'} tone="text-cyan-300" />
                      <Stat label="live size" value={w.live_bytes != null ? `${(w.live_bytes / 1024).toFixed(1)} KiB` : '—'} />
                      <Stat label="source in repo" value={w.source.verdict} tone={w.source.verdict === 'NO_SOURCE_IN_REPO' ? 'text-rose-400' : w.source.verdict === 'DRIFT' ? 'text-amber-400' : 'text-emerald-400'} />
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-zinc-500">
                      <span className="text-zinc-400">binding:</span> {w.source.note}
                      {w.secret_bindings.length > 0 && (
                        <>
                          <br />
                          <span className="text-zinc-400">secrets (имена, значения не возвращаются API):</span> {w.secret_bindings.join(', ')}
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              <div className={`space-y-1 ${scrollCls} pr-1`}>
                <div className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Находки квалификации</div>
                {edge.findings.map((f) => (
                  <div key={f} className="rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-400 hover:border-zinc-700">
                    {f}
                  </div>
                ))}
                <div className="px-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Блокеры промоушна</div>
                {edge.promotion_blockers.map((b) => (
                  <div key={b} className="rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-rose-200/90">
                    {b}
                  </div>
                ))}
              </div>
              {/* import plan (R83-import) */}
              {edgePlan && (
                <div className={`space-y-2 ${scrollCls} pr-1`}>
                  <div className="flex flex-wrap items-center gap-2 px-0.5">
                    <Layers className="h-3.5 w-3.5 text-cyan-300" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">Импорт-план source-дерева (R83-import)</span>
                    {edgePlan.workers.filter((w) => w.import_verdict === 'IMPORT_READY').length > 0 && (
                      <Chip tone="ok">{edgePlan.workers.filter((w) => w.import_verdict === 'IMPORT_READY').length} IMPORT_READY</Chip>
                    )}
                    {edgePlan.workers.filter((w) => w.import_verdict === 'NEEDS_UNBUNDLING').length > 0 && (
                      <Chip tone="warn">{edgePlan.workers.filter((w) => w.import_verdict === 'NEEDS_UNBUNDLING').length} NEEDS_UNBUNDLING</Chip>
                    )}
                  </div>
                  {edgePlan.workers.map((w) => (
                    <div key={w.worker} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="min-w-0 break-all font-mono text-[11px] text-teal-300">{w.worker}</span>
                        <Chip tone={w.import_verdict === 'IMPORT_READY' ? 'ok' : w.import_verdict === 'NEEDS_UNBUNDLING' ? 'warn' : 'p0'} className="ml-auto shrink-0">{w.import_verdict}</Chip>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="снапшот" value={w.snapshot_sha256_12 ?? '—'} tone="text-cyan-300" />
                        <Stat label="характер" value={w.source_character} tone={w.source_character === 'ORIGINAL_MODULES' ? 'text-emerald-400' : 'text-amber-400'} />
                        <Stat label="модулей" value={String(w.modules.length)} />
                        <Stat label="в репо" value={w.proposed_repo_prefix} tone="text-zinc-400" />
                      </div>
                      {w.modules.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {w.modules.map((m) => (
                            <div key={m.module_path} className="flex items-baseline gap-2 rounded border border-zinc-800/60 bg-zinc-950/40 px-2 py-1 font-mono text-[10px] hover:border-zinc-700">
                              <span className="min-w-0 flex-1 truncate text-zinc-300" title={m.module_path}>{m.module_path}</span>
                              <span className="shrink-0 text-zinc-600">{m.lines}L · {(m.bytes / 1024).toFixed(1)}KiB</span>
                              <span className="shrink-0 text-cyan-300/70">{m.sha256_12}</span>
                              {m.bundle_sections.length > 0 && <span className="shrink-0 text-amber-300/80" title={m.bundle_sections.join('\n')}>{m.bundle_sections.length} src-секций</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {w.wrangler_stub && (
                        <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
                          <span className="text-zinc-400">wrangler stub (bindings):</span> {w.wrangler_stub.bindings.join(', ')}
                        </p>
                      )}
                      {w.notes.map((n) => (
                        <p key={n} className="mt-1 text-[10px] leading-snug text-zinc-500">— {n}</p>
                      ))}
                    </div>
                  ))}
                  {edgePlan.summary.map((s) => (
                    <div key={s} className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1.5 text-[10px] leading-snug text-cyan-200/80">{s}</div>
                  ))}
                </div>
              )}
              {/* import PR live status (R83-import deliverable) */}
              {edgeImport && (
                <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <GitPullRequest className="h-3.5 w-3.5 text-emerald-300" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">Импорт-PR · source-of-truth в репо</span>
                    {edgeImport.pr && (
                      <Chip tone={edgeImport.pr.merged ? 'ok' : edgeImport.pr.state === 'open' ? (edgeImport.ci.terminal && !edgeImport.ci.green ? 'p0' : 'warn') : 'neutral'}>
                        PR #{edgeImport.pr.number} {edgeImport.pr.merged ? 'MERGED' : edgeImport.pr.state.toUpperCase()}
                      </Chip>
                    )}
                    {edgeImport.pr && (
                      <Chip tone={edgeImport.ci.terminal ? (edgeImport.ci.green ? 'ok' : 'p0') : 'warn'}>
                        CI {edgeImport.ci.success}/{edgeImport.ci.total}{!edgeImport.ci.terminal && ' ↻'}
                      </Chip>
                    )}
                    {edgeImport.digest_contract.repo_tree_verified && <Chip tone="ok">digest == LIVE</Chip>}
                    <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-zinc-400 hover:text-teal-400" disabled={edgeImportLoading} onClick={() => loadEdgeImport(true)} aria-label="Свежий статус импорт-PR" title="Свежий статус PR #982 (edge.import-status)">
                      <RefreshCw className={`h-3.5 w-3.5 ${edgeImportLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  {edgeImport.pr && (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="ветка" value={edgeImport.pr.head_branch} tone="text-cyan-300" span="col-span-2" />
                        <Stat label="head" value={edgeImport.pr.head_sha.slice(0, 10)} tone="text-cyan-300" />
                        <Stat label="mergeable" value={edgeImport.pr.mergeable == null ? '—' : edgeImport.pr.mergeable ? 'yes' : String(edgeImport.pr.mergeable_state)} tone={edgeImport.pr.mergeable ? 'text-emerald-400' : 'text-amber-400'} />
                        <Stat label="файлы" value={`${edgeImport.pr.files} (+${edgeImport.pr.additions}/−${edgeImport.pr.deletions})`} tone="text-emerald-400" span="col-span-2" />
                        <Stat label="base" value={edgeImport.pr.base_branch} tone="text-zinc-400" span="col-span-2" />
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px]">
                        <span className="text-zinc-500">digest contract:</span>
                        <span className="text-cyan-300/80">fabric {edgeImport.digest_contract.fabric_live_sha256}</span>
                        <span className="text-cyan-300/80">aop1 {edgeImport.digest_contract.aop1_live_sha256}</span>
                      </div>
                      {edgeImport.ci.checks.length > 0 && (
                        <div className="space-y-0.5">
                          {edgeImport.ci.checks.map((c, i) => (
                            <div key={`${c.name}-${i}`} className="flex items-baseline gap-2 rounded border border-zinc-800/60 bg-zinc-950/40 px-2 py-1 font-mono text-[10px]">
                              <span className="min-w-0 flex-1 truncate text-zinc-300" title={c.name}>{c.name}</span>
                              <span className={`shrink-0 ${c.conclusion === 'success' ? 'text-emerald-400' : c.conclusion ? 'text-rose-400' : 'text-amber-400'}`}>{c.conclusion ?? c.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <a href={edgeImport.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-baseline gap-1 text-[11px] text-teal-300 underline decoration-teal-500/40 hover:text-teal-200">
                        открыть PR #{edgeImport.pr.number} на GitHub
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                  {edgeImport.pr_error && (
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 font-mono text-[10px] text-amber-200/80">import-status: {edgeImport.pr_error}</div>
                  )}
                  {edgeImport.summary.map((s) => (
                    <div key={s} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[10px] leading-snug text-emerald-200/80">{s}</div>
                  ))}
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Read-only CF-клиент демона (токен только серверно в /home/z/.a2/cloudflare.env). Кнопка-камера снимает живые скрипты в evidence (data/edge/ + hash-chained EDGE_SNAPSHOT события). Импорт source РЕАЛИЗОВАН — PR #982 несёт verbatim-дерево с digest-контрактом; промоушн (deploy-from-repo) только после ревью оператора + re-verify + ротации CF-токена.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> квалификация Cloudflare Edge…</div>
          )}
        </Panel>

        {/* -------------------------------------------- CONVERGENCE MONITOR */}
        <Panel
          icon={<TrendingUp className="h-4 w-4" />}
          title="Монитор конвергенции · R82"
          chip={
            monitor ? (
              <Chip tone={mLast && mLast.keepalive_state === 'ACTIVE' ? 'ok' : 'p0'}>
                {mLast ? mLast.keepalive_state : '…'}
              </Chip>
            ) : (
              <Chip tone="neutral">…</Chip>
            )
          }
          defaultOpen
        >
          {monitor ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <Spark label="heartbeat, s" color="#34d399" value={mLast ? `${mLast.hb_age_s}s` : '—'} data={mkSeries((s) => s.hb_age_s)} />
                <Spark label="cycle_seq" color="#fbbf24" value={mLast ? String(mLast.cycle_seq) : '—'} data={mkSeries((s) => s.cycle_seq)} />
                <Spark label="resync_count" color="#22d3ee" value={mLast ? String(mLast.resync_count) : '—'} data={mkSeries((s) => s.resync_count)} />
                <Spark label="stale cycle, h" color="#fb7185" value={mLast && mLast.stale_completed_s != null ? `${(mLast.stale_completed_s / 3600).toFixed(1)}h` : '—'} data={mkSeries((s) => (s.stale_completed_s != null ? +(s.stale_completed_s / 3600).toFixed(2) : null))} />
                <Spark label="ambiguous hist" color="#f97316" value={mLast ? String(mLast.ambiguous_history_count) : '—'} data={mkSeries((s) => s.ambiguous_history_count)} />
                <Spark label="p0 flags" color="#e879f9" value={mLast ? String(mLast.p0_count) : '—'} data={mkSeries((s) => s.p0_count)} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="neutral">интервал {Math.round(monitor.status.interval_ms / 1000)}с</Chip>
                <Chip tone="neutral">сэмплов {monitor.status.sample_count}/{monitor.status.capacity}</Chip>
                <Chip tone={monitor.status.last_error ? 'p0' : 'ok'}>{monitor.status.last_error ? 'sampler error' : 'sampler ok'}</Chip>
                {mLast && <Chip tone="neutral">cognitive {mLast.cognitive_state}</Chip>}
                {mLast && <Chip tone="neutral">compute {mLast.compute_state}</Chip>}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Критерий успеха R82: <span className="text-amber-300">cycle_seq</span> начинает расти монотонно, а <span className="text-rose-300">stale cycle</span> сбрасывается в секунды. Графики накапливаются в ring-buffer демона (1 час, silent-сэмплинг без записи в evidence log). История драфта — durable (data/draft-history.jsonl, 24 ч, переживает рестарты демона).
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка монитора…</div>
          )}
        </Panel>

        {/* ------------------------------------------------- GAP MATRIX */}
        <Panel icon={<ShieldAlert className="h-4 w-4" />} title="P0/P1 разрывы · release gap matrix" chip={<Chip tone="p0">BLOCKED</Chip>}>
          <div className={`space-y-1.5 ${scrollCls} pr-1`}>
            {GAP_MATRIX.map((g) => {
              const liveTone = g.live === 'keepalive' ? (ka?.state === 'ACTIVE' ? 'ok' : 'p0') : g.live === 'cognitive' ? (supervisor?.cognitive.state === 'CONVERGED' ? 'ok' : 'warn') : undefined
              return (
                <div key={g.title} className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${g.closed ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/60'}`}>
                  <Chip tone={g.closed ? 'ok' : g.pri === 'P0' ? 'p0' : 'warn'} className="mt-0.5 shrink-0">{g.closed ? '✓' : g.pri}</Chip>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-200">{g.title}</span>
                      {liveTone && <Chip tone={liveTone}>LIVE</Chip>}
                    </div>
                    <div className={`mt-0.5 break-words font-mono text-[11px] leading-snug ${g.closed ? 'text-emerald-300/70' : 'text-zinc-500'}`}>{g.status}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* ---------------------------------------------------- ROADMAP */}
        <Panel icon={<ListChecks className="h-4 w-4" />} title="Роадмап R81 → R90 · convergence" chip={<Chip tone="info">{roadmap ? `${roadmap.roadmap.filter((r) => r.status === 'IN_PROGRESS').length}/10 active` : '…'}</Chip>}>
          {roadmap ? (
            <div className="space-y-3">
              {/* progress rail */}
              <div className="relative pt-1 pb-2">
                <div className="absolute left-0 right-0 top-[11px] h-0.5 bg-zinc-800" />
                <div className="absolute left-0 top-[11px] h-0.5 bg-gradient-to-r from-amber-500/70 to-amber-500/20" style={{ width: `${(roadmap.roadmap.findIndex((r) => r.status === 'IN_PROGRESS') + 1) * 10}%` }} />
                <div className="relative flex justify-between">
                  {roadmap.roadmap.map((r) => {
                    const active = r.status === 'IN_PROGRESS'
                    return (
                      <div key={r.round} className="flex flex-col items-center gap-1" title={`${r.round} · ${r.title}`}>
                        <span className={`h-2.5 w-2.5 rounded-full border ${active ? 'border-amber-400 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse' : 'border-zinc-600 bg-zinc-800'}`} />
                        <span className={`font-mono text-[9px] ${active ? 'text-amber-300' : 'text-zinc-600'}`}>{r.round.slice(1)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">Release authority (verified live)</div>
                <div className="mt-1 break-all font-mono text-[11px] text-zinc-300">
                  {roadmap.release_authority.release_sha.slice(0, 12)} @ {roadmap.release_authority.release_ref}
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">{roadmap.release_authority.repository}</div>
              </div>
              <div className={`space-y-2 ${scrollCls} pr-1`}>
                {roadmap.roadmap.map((r) => (
                  <div key={r.round} className={`rounded-lg border p-3 ${r.status === 'IN_PROGRESS' ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-800 bg-zinc-950/60'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-sm font-bold ${r.status === 'IN_PROGRESS' ? 'text-amber-400' : 'text-zinc-400'}`}>{r.round}</span>
                      <span className="text-xs font-semibold text-zinc-200">{r.title}</span>
                      <Chip tone={r.status === 'IN_PROGRESS' ? 'warn' : 'neutral'} className="ml-auto">{r.status === 'IN_PROGRESS' ? 'IN PROGRESS' : 'PENDING'}</Chip>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{r.goal}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-600"><span className="text-zinc-500">exit gate:</span> {r.exit_gate}</p>
                    {r.evidence && <p className="mt-1.5 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">{r.evidence}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>

        {/* -------------------------------------------------- EVENT LOG */}
        <Panel
          icon={<Activity className="h-4 w-4" />}
          title={`Журнал событий · hash-chain${events.length ? ` · #${events[0].seq}` : ''}`}
          chip={<Chip tone={wsLive ? 'ok' : 'neutral'}>{wsLive ? 'ws live' : 'poll 5s'}</Chip>}
          actions={
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" onClick={exportEvents} disabled={busy === 'export'} aria-label="Экспорт журнала в .jsonl">
              {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
          }
          defaultOpen
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {EV_CLASSES.map((c) => {
                const n = events.filter((e) => c.match(e.type)).length
                const active = evClasses.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleEvClass(c.id)}
                    aria-pressed={active}
                    title={`${c.title} · событий в буфере: ${n}`}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 ${active ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}
                  >
                    {c.label} · {n}
                  </button>
                )
              })}
              {evClasses.length > 0 && (
                <button onClick={() => setEvClasses([])} className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-[10px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300" title="снять все class-фильтры">
                  × классы
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                ref={filterRef}
                value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="фильтр по типу… (нажмите /)"
                className="h-11 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-teal-500/50"
                aria-label="Фильтр событий по типу (клавиша / — фокус, Esc — очистка)"
              />
              {filter && (
                <Button variant="ghost" size="sm" className="h-11 shrink-0 px-3 text-zinc-400 hover:text-teal-400" onClick={() => { setFilter(''); filterRef.current?.focus() }} aria-label="Очистить фильтр">
                  сброс
                </Button>
              )}
              <span className="shrink-0 text-[11px] text-zinc-500">{filtered.length}/{events.length}</span>
            </div>
            <div className={`space-y-1 ${scrollCls} pr-1`}>
              {filtered.map((e) => (
                <div key={e.seq} className="flex items-baseline gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px] hover:border-zinc-700">
                  <span className="w-10 shrink-0 text-right text-cyan-300/80">#{e.seq}</span>
                  <span className={`w-44 shrink-0 truncate font-semibold ${eventTypeTone(e.type)}`} title={e.type}>{e.type}</span>
                  <span className="hidden w-16 shrink-0 text-zinc-600 sm:inline">{e.actor}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500" title={JSON.stringify(e.payload)}>
                    {e.subject ?? JSON.stringify(e.payload).slice(0, 80)}
                  </span>
                  <span className="shrink-0 text-zinc-600">{hhmmss(e.ts)}</span>
                </div>
              ))}
              {filtered.length === 0 && <div className="py-6 text-center text-xs text-zinc-600">событий нет — daemon молчит или фильтр пуст</div>}
            </div>
          </div>
        </Panel>

        {/* ----------------------------------------------- EVIDENCE MIRROR */}
        <Panel
          icon={<Database className="h-4 w-4" />}
          title="Mirror · Supabase evidence"
          chip={
            mirror ? (
              <Chip tone={mirror.state.last_error ? 'p0' : mirror.pending > 20 ? 'warn' : 'ok'}>
                {mirror.state.last_error ? 'error' : mirror.pending === 0 ? 'in sync' : `lag ${mirror.pending}`}
              </Chip>
            ) : (
              <Chip tone="neutral">…</Chip>
            )
          }
          actions={
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-teal-400" onClick={() => loadMirror(true)} disabled={mirrorLoading} aria-label="Свежий статус mirror">
                {mirrorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          }
        >
          {mirror ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="mirror tail" value={`#${mirror.state.last_mirror_seq}`} tone="text-cyan-300" title={`последняя зеркальная строка · head ${mirror.state.last_mirror_hash.slice(0, 16)}…`} />
                <Stat label="локальная цепь" value={`#${mirror.local_last_seq}`} tone="text-teal-400" title="last_seq локального hash-chain журнала" />
                <Stat label="отзеркалировано" value={`${mirror.state.mirrored_local_seq}`} title={`total_rows_synced ${mirror.state.total_rows_synced} за ${mirror.state.sync_count} синк-батчей`} />
                <Stat
                  label="lag (pending)"
                  value={mirror.pending === 0 ? '0' : `${mirror.pending}`}
                  tone={mirror.pending === 0 ? 'text-emerald-400' : mirror.pending > 20 ? 'text-amber-400' : 'text-zinc-300'}
                  title="события, ещё не записанные в Supabase (таймер подхватит в пределах 2 мин)"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <Chip tone="neutral">anchor #{mirror.state.anchor.seq} · v0.57.1 tail</Chip>
                <Chip tone={mirror.live.matches_state === true ? 'ok' : mirror.live.matches_state === false ? 'p0' : 'neutral'} title="живой хвост Supabase совпадает с durable-state демона">
                  live tail {mirror.live.matches_state === true ? '≡ state' : mirror.live.matches_state === false ? '≠ state' : '…'}
                </Chip>
                <Chip tone={mirror.auto_sync.running ? 'ok' : 'warn'} title={`boot ${mirror.auto_sync.boot_delay_ms / 1000}с задержка · далее каждые ${mirror.auto_sync.interval_ms / 1000}с`}>
                  auto-sync {mirror.auto_sync.running ? 'on' : 'off'}
                </Chip>
                {mirror.state.last_sync_at && (
                  <span title={mirror.state.last_sync_at}>последний синк {humanS(Math.round((now - Date.parse(mirror.state.last_sync_at)) / 1000))} назад</span>
                )}
              </div>
              {mirror.state.last_error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300" title={`${mirror.state.last_error.code}: ${mirror.state.last_error.message}`}>
                  <span className="font-mono">{mirror.state.last_error.code}</span>: {mirror.state.last_error.message}
                  <div className="mt-1 text-[10px] text-rose-400/70">fail-closed: sync отказался писать — ручной reconcile оператора</div>
                </div>
              )}
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Живой хвост me2_event_mirror_h205f22</span>
                  <span className="text-[10px] text-zinc-600">(последние {mirror.live.tail.length})</span>
                </div>
                <div className="space-y-1">
                  {mirror.live.tail.map((t) => (
                    <div key={t.seq} className="flex items-baseline gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px]">
                      <span className="w-20 shrink-0 text-right text-cyan-300/80">#{t.seq}</span>
                      <span className={`min-w-0 flex-1 truncate font-semibold ${t.anchor ? 'text-amber-400/90' : 'text-zinc-300'}`} title={t.anchor ? 'recovery anchor — хвост ledger старого daemon v0.57.1' : `локальное событие #${t.local_seq ?? '?'}`}>
                        {t.anchor ? `⚓ ${t.type}` : t.type ?? '—'}
                      </span>
                      {t.anchor ? (
                        <span className="shrink-0 text-[10px] text-amber-500/70">v0.57.1</span>
                      ) : (
                        <span className={`shrink-0 text-[10px] ${t.ours ? 'text-emerald-500/80' : 'text-rose-400/80'}`}>{t.ours ? `→ #${t.local_seq}` : 'foreign'}</span>
                      )}
                    </div>
                  ))}
                  {mirror.live.tail.length === 0 && <div className="py-4 text-center text-xs text-zinc-600">живой хвост недоступен (Supabase?)</div>}
                </div>
              </div>
              {mirror.history.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">История синков (MIRROR_SYNC из локальной цепи)</div>
                  <div className={`space-y-1 ${scrollCls} pr-1`}>
                    {mirror.history.map((h) => {
                      const p = h.payload as { synced?: number; from_local_seq?: number; to_local_seq?: number; mirror_to_seq?: number; reason?: string } | null
                      return (
                        <div key={h.seq} className="flex items-baseline gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px]">
                          <span className="w-16 shrink-0 text-right text-cyan-300/70">#{p?.mirror_to_seq ?? '—'}</span>
                          <span className="min-w-0 flex-1 truncate text-zinc-400" title={JSON.stringify(h.payload)}>
                            {p?.synced ?? '?'} событий · local #{p?.from_local_seq ?? '?'}..#{p?.to_local_seq ?? '?'} · {p?.reason ?? '—'}
                          </span>
                          <span className="shrink-0 text-zinc-600">{hhmmss(h.ts)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {mirror.stats_24h && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500" title={`агрегат читается прямо из PostgREST (select seq,type,ts, без payload) за окно с ${hhmmss(mirror.stats_24h.window_since)} — взгляд на durability со стороны БД, а не со слов демона`}>24 ч в Supabase · глазами БД</span>
                    {mirror.stats_24h.capped && <Chip tone="warn" title={`строк в окне больше лимита выборки — показанный счёт ${mirror.stats_24h.rows}+`}>capped</Chip>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="строк за 24 ч" value={String(mirror.stats_24h.rows)} tone="text-cyan-300" title="строки me2_event_mirror_h205f22, записанные за последние 24 ч (по mirrored_at, читается из БД)" />
                    <Stat label="seq-диапазон" value={mirror.stats_24h.first_seq != null ? `#${mirror.stats_24h.first_seq}…#${mirror.stats_24h.last_seq}` : '—'} title="минимальный…максимальный seq в 24ч-окне" />
                    <Stat label="старейшая" value={mirror.stats_24h.oldest_ts ? hhmmss(mirror.stats_24h.oldest_ts) : '—'} title={mirror.stats_24h.oldest_ts ?? '—'} />
                    <Stat label="свежайшая" value={mirror.stats_24h.newest_ts ? hhmmss(mirror.stats_24h.newest_ts) : '—'} title={mirror.stats_24h.newest_ts ?? '—'} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {mirror.stats_24h.by_type.map((t) => (
                      <Chip key={t.type} tone={t.type === 'MIRROR_SYNC' ? 'ok' : t.type.startsWith('R82') ? 'info' : 'neutral'} title={`${t.type}: ${t.count} строк за 24 ч`}>
                        {t.type} · {t.count}
                      </Chip>
                    ))}
                    {mirror.stats_24h.by_type.length === 0 && <span className="text-[10px] text-zinc-600">за 24 ч ничего не записано (окно пусто)</span>}
                  </div>
                </div>
              )}
              {/* R83-VERIFY: independent in-process contract check — port of
                  verify-mirror.mjs as POST /mirror/verify; one click, no shell */}
              {mirrorVerifyRes && (
                <div className={`rounded-lg border p-3 ${mirrorVerifyRes.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/10'}`}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold ${mirrorVerifyRes.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {mirrorVerifyRes.ok ? '✓ Контракт держит' : `✗ Нарушений: ${mirrorVerifyRes.violations}`}
                    </span>
                    <Chip tone="neutral" title="строк прочитано из Supabase (paged, ascending) и проверено">{mirrorVerifyRes.rows_checked} строк</Chip>
                    <Chip tone="neutral" title="последний seq непрерывной цепи от якоря">хвост #{mirrorVerifyRes.head_seq ?? '?'}</Chip>
                    <Chip tone="neutral">{mirrorVerifyRes.duration_ms}ms</Chip>
                    <span className="text-[10px] text-zinc-500" title={mirrorVerifyRes.started_at}>{hhmmss(mirrorVerifyRes.started_at)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {([
                      ['seq-непрерывность', mirrorVerifyRes.checks.seq_continuity, 'каждая строка = prev+1 от якоря #90013992'],
                      ['prev_hash-цепь', mirrorVerifyRes.checks.prev_hash_chain, 'первая строка биндится к hash якоря, каждая — к предыдущей'],
                      ['hash-пересчёт', mirrorVerifyRes.checks.row_hashes, 'sha256(seq·ts·type·actor·subject·payload·prev_hash·daemon_version) пересчитан для каждой строки'],
                      ['кросс-биндинги', mirrorVerifyRes.checks.bindings, 'payload.local_seq/local_hash ↔ локальная цепь: hash + тип/актор/subject + payload + ts'],
                    ] as const).map(([label, ok, hint]) => (
                      <div key={label} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] ${ok ? 'border-emerald-500/25 text-emerald-300/90' : 'border-rose-500/30 text-rose-300'}`} title={hint}>
                        {ok ? <Check className="h-3 w-3 shrink-0" /> : <AlertTriangle className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{label}</span>
                      </div>
                    ))}
                  </div>
                  {mirrorVerifyRes.samples.length > 0 && (
                    <div className={`mt-2 space-y-0.5 ${scrollCls} pr-1`}>
                      {mirrorVerifyRes.samples.map((s, i) => (
                        <div key={i} className="font-mono text-[10px] text-rose-300/90" title={s}>{s.slice(0, 120)}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mirror?.last_verify && !mirrorVerifyRes && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  <span className="text-zinc-600">последняя проверка:</span>
                  <Chip tone={mirror.last_verify.ok ? 'ok' : 'p0'} title={`журнальное событие MIRROR_VERIFY: ${mirror.last_verify.ok ? 'контракт держит' : `${mirror.last_verify.violations} нарушений`} · ${mirror.last_verify.rows} строк · ${mirror.last_verify.duration_ms}ms${mirror.last_verify.trigger ? ` · источник: ${mirror.last_verify.trigger === 'timer' ? 'авто-таймер 6ч' : 'оператор'}` : ''}`}>
                    {mirror.last_verify.ok ? '✓ держит' : '✗ нарушен'} · {mirror.last_verify.rows} строк{mirror.last_verify.trigger === 'timer' ? ' · авто' : ''}
                  </Chip>
                  <span title={mirror.last_verify.at}>{humanS(Math.round((now - Date.parse(mirror.last_verify.at)) / 1000))} назад</span>
                </div>
              )}
              {/* R83-AUTONOMY: the silent 6h self-check cadence — journal-derived
                  schedule (restart-safe), surfaced as live countdown chips */}
              {mirror?.auto_verify && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={mirror.auto_verify.running ? 'ok' : 'warn'} title="тихая само-проверка контракта каждые 6 ч: расписание выводится из durable journal (последний MIRROR_VERIFY), не из памяти — переживает рестарты демона; таймерные прогоны не тостят (silent by design)">
                    авто 6ч {mirror.auto_verify.running ? 'жив' : 'выкл'}
                  </Chip>
                  {mirror.auto_verify.next_in_ms != null && (
                    <Chip tone="neutral" title="до следующей авто-проверки контракта зеркала">след. через {humanS(Math.round(mirror.auto_verify.next_in_ms / 1000))}</Chip>
                  )}
                  {mirror.last_verify?.trigger === 'timer' && (
                    <Chip tone="info" title="последняя проверка исполнена авто-таймером демона — тост не показывался (silent cadence)">последняя — авто</Chip>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={syncMirrorNow} disabled={busy === 'mirror-sync' || mirror.pending === 0}
                  variant="outline" className="h-11 border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
                >
                  {busy === 'mirror-sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  <span className="ml-1.5">синхронизировать сейчас{mirror.pending > 0 ? ` (${mirror.pending})` : ''}</span>
                </Button>
                <Button
                  onClick={runMirrorVerify} disabled={busy === 'mirror-verify'}
                  variant="outline" className="h-11 border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                  title="Независимая проверка контракта me2-mirror-v1: читает ВСЕ строки из Supabase (paged) и проверяет seq-непрерывность, prev_hash-цепь, пересчёт hash и кросс-биндинги к локальной цепи. Порт verify-mirror.mjs в демоне — без shell. Прогон пишется в hash-chain как MIRROR_VERIFY."
                >
                  {busy === 'mirror-verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                  <span className="ml-1.5">проверить контракт</span>
                </Button>
                <span className="text-[10px] leading-snug text-zinc-600">
                  авто: boot+15с → каждые 2 мин · контракт <span className="font-mono text-zinc-500">{mirror.contract.marker}</span>: payload {'{mirror, local_seq, local_hash, event}'}, hash = sha256(seq·ts·type·actor·subject·payload·prev_hash·daemon_version), fail-closed на расхождении
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>

        {/* ------------------------------------------- WORKTREES/SANDBOX */}
        <Panel icon={<GitBranch className="h-4 w-4" />} title="Worktrees · Песочница" chip={<Chip tone="neutral">{worktrees.length} wt</Chip>}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={wtName} onChange={(e) => setWtName(e.target.value)} placeholder="wt-<имя> (напр. wt-r82-supervisor)"
                className="h-11 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-teal-500/50"
                aria-label="Имя нового worktree"
              />
              <Button
                onClick={createWt} disabled={busy === 'wt-create' || !wtName}
                className="h-11 shrink-0 border-teal-500/40 bg-teal-600/90 text-xs font-semibold text-white hover:bg-teal-500"
              >
                {busy === 'wt-create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">создать</span>
              </Button>
            </div>
            <div className="space-y-1">
              {worktrees.map((w) => {
                const name = w.path.split('/').pop() ?? w.path
                const isMain = w.path === '/home/z/my-project'
                return (
                  <div key={w.path} className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-2">
                    <Boxes className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{name}</span>
                    <span className="hidden shrink-0 font-mono text-[10px] text-zinc-600 sm:inline">{w.branch?.replace('refs/heads/', '') ?? 'detached'}</span>
                    {!isMain && (
                      <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0 text-zinc-500 hover:text-rose-400" onClick={() => removeWt(name)} aria-label={`Удалить ${name}`} disabled={busy === `wt-rm:${name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="border-t border-zinc-800 pt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Sandbox (prlimit-isolated, whitelist)</span>
                <Terminal className="h-3.5 w-3.5 text-zinc-500" />
              </div>
              <div className="flex flex-wrap gap-2">
                {[['bun', '--version'], ['git', 'status', '--short'], ['git', 'log', '--oneline', '-5']].map((cmd) => (
                  <Button
                    key={cmd.join(' ')} onClick={() => doExec(cmd)} disabled={busy !== null}
                    variant="outline" className="h-11 border-zinc-700 bg-zinc-950 font-mono text-[11px] text-zinc-300 hover:border-teal-500/40 hover:text-teal-300"
                  >
                    {busy === `exec:${cmd.join(' ')}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">{cmd.join(' ')}</span>
                  </Button>
                ))}
              </div>
              {execResult && (
                <pre className={`mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border p-2.5 font-mono text-[11px] ${execResult.ok ? 'border-zinc-800 bg-zinc-950/80 text-zinc-300' : 'border-rose-500/30 bg-rose-500/5 text-rose-300'}`}>
                  {`$ ${execResult.cmd.join(' ')}  (${execResult.elapsed_ms}ms, exit ${execResult.exit_code})\n${execResult.stdout || execResult.stderr || '(no output)'}`}
                </pre>
              )}
            </div>
          </div>
        </Panel>

        {/* -------------------------------------------------- RECOVERY */}
        <Panel icon={<AlertTriangle className="h-4 w-4" />} title="Восстановление после env-reset" chip={<Chip tone="warn">R81-PHASE0</Chip>} defaultOpen>
          {recovery ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400">Restored</div>
                  <ul className="space-y-1">
                    {recovery.restored.map((r) => (
                      <li key={r.item} className="flex items-start gap-1.5 text-[11px] text-zinc-300">
                        <span className="mt-0.5 text-emerald-500">✓</span><span className="break-words">{r.item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-rose-400">Blocked</div>
                  <ul className="space-y-1.5">
                    {recovery.blocked.map((b) => (
                      <li key={b.item} className="text-[11px] text-zinc-300">
                        <div className="flex items-start gap-1.5"><span className="mt-0.5 text-rose-500">✗</span><span className="break-words">{b.item}</span></div>
                        <div className="ml-3 break-words text-[10px] text-zinc-600">{b.reason}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-cyan-300">Pending next</div>
                <ul className="space-y-1">
                  {recovery.pending_next.map((p) => (
                    <li key={p} className="flex items-start gap-1.5 text-[11px] text-zinc-300">
                      <span className="mt-0.5 text-cyan-400">→</span><span className="break-words">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3">
                <Check className="h-4 w-4 shrink-0 text-cyan-400" />
                <span className="text-[11px] leading-snug text-zinc-300">
                  Ручная anchor-запись (#90013993) больше не нужна — слот занят авто-зеркалом: первая строка контракта me2-mirror-v0.66 привязывает RECOVERY_GENESIS к хвосту v0.57.1. Дальнейшая репликация — карточка «Mirror · Supabase evidence».
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-teal-500/50" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${daemonUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            daemon {daemonUp ? 'online' : 'offline'}
          </span>
          <span>·</span>
          <span>supabase {supLive ? 'live' : supErr ? 'error' : '…'}</span>
          <span>·</span>
          <span>bus {wsLive ? 'ws' : 'poll'}</span>
          <span>·</span>
          <span className="font-mono">seq #{events[0]?.seq ?? health?.last_seq ?? 0}</span>
          {mirror && (
            <span className={`font-mono ${mirror.pending === 0 && !mirror.state.last_error ? 'text-cyan-400/80' : mirror.pending > 20 || mirror.state.last_error ? 'text-amber-400/80' : 'text-zinc-500'}`} title={`evidence mirror me2_event_mirror_h205f22 · зеркальный хвост #${mirror.state.last_mirror_seq} · отзеркалировано ${mirror.state.mirrored_local_seq}/${mirror.local_last_seq}${mirror.state.last_error ? ` · ${mirror.state.last_error.code}` : ''}`}>
            · mirror #{mirror.state.last_mirror_seq}{mirror.pending > 0 ? ` (+${mirror.pending})` : ' ✓'}
          </span>
          )}
          {conv && (
            <span className={`font-mono ${conv.rollup_state === 'GREEN' ? 'text-emerald-400' : conv.rollup_state === 'RED' ? 'text-rose-400' : conv.rollup_state === 'PENDING' ? 'text-amber-400/80' : 'text-zinc-500'}`} title={`PR #${conv.pr?.number ?? 968} (${conv.pr?.state ?? '?'}${conv.pr?.draft ? ', draft' : ''}) — R84/R85 волна оператора · CI: ${conv.checks.success}/${conv.checks.total} success, ${conv.checks.failed} failed, ${conv.checks.pending} pending`}>
            PR#{conv.pr?.number ?? 968} CI {conv.rollup_state}
          </span>
          )}
          <span className="ml-auto font-mono text-zinc-600">{health?.round ?? 'R83'} · {readback ? `exit gate: ${readback.current_gate}` : 'release readiness: BLOCKED (см. gap matrix)'}</span>
        </div>
      </footer>
    </div>
  )
}
