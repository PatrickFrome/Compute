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
import {
  Activity, AlertTriangle, Boxes, ChevronDown, Database, GitBranch, HeartPulse,
  ListChecks, Loader2, Radio, RefreshCw, ShieldAlert, Terminal, Trash2, Zap,
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
  round: string; title: string; goal: string; exit_gate: string; status: string
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
interface ExecResult {
  cmd: string[]; ok: boolean; exit_code: number | null
  stdout: string; stderr: string; elapsed_ms: number
}

// ---------------------------------------------------------- gap matrix ----
const GAP_MATRIX: { pri: 'P0' | 'P1'; title: string; status: string; live?: 'keepalive' | 'cognitive' }[] = [
  { pri: 'P0', title: 'Supervisor useful cycle', status: 'ROLLOVER_AMBIGUOUS · composer_not_unique · cycle 2109 застыл', live: 'keepalive' },
  { pri: 'P0', title: 'DevOS maintenance liveness', status: 'live native_supervisor_idle_maintenance_wait_timeout' },
  { pri: 'P0', title: 'Edge convergence', status: 'production v13 ≠ release source cf747… (v14 canary активен)' },
  { pri: 'P0', title: 'Desktop convergence', status: 'PR #967: 7 commits, behind release 21 — donor, не trunk' },
  { pri: 'P0', title: 'Full installer', status: 'apps/me2-daemon не бандлится в extraResources' },
  { pri: 'P0', title: 'Closed task loop', status: 'seed_proven=0 · NO_ELIGIBLE_CONVERSATION · fresh E2E не доказан' },
  { pri: 'P0', title: 'Source authority', status: 'DB roadmap baseline b69f… ≠ release cf747…' },
  { pri: 'P0', title: 'Credentials (security)', status: 'raw credentials в chat export → ротация у оператора' },
  { pri: 'P0', title: 'Cognitive convergence', status: 'cloud cursor стоит против живого локального bus', live: 'cognitive' },
  { pri: 'P1', title: 'Branch audit', status: '80/618 веток выпадают из аудита; unrelated history ломает merge-base' },
  { pri: 'P1', title: 'Version identity', status: 'daemon runtime 0.57.1 vs package 0.43.0' },
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
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-lg shadow-black/20">
        <div className="flex items-center gap-1 pr-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 rounded-t-xl">
            <span className="text-teal-400">{icon}</span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wider text-zinc-200">{title}</h2>
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

function Stat({ label, value, tone, span }: { label: string; value: React.ReactNode; tone?: string; span?: string }) {
  const title = typeof value === 'string' ? value : undefined
  return (
    <div className={`min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 ${span ?? ''}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`truncate font-mono text-xs ${tone ?? 'text-zinc-200'}`} title={title}>{value}</div>
    </div>
  )
}

const scrollCls = 'max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent'

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
  const [wtName, setWtName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [wsLive, setWsLive] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(1000)

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

  useEffect(() => {
    loadHealth(); loadSupervisor(); loadWorktrees()
    jfetch<RoadmapData>('/roadmap').then(setRoadmap).catch(() => {})
    jfetch<Recovery>('/recovery').then(setRecovery).catch(() => {})
    const a = setInterval(loadHealth, 5000)
    const b = setInterval(() => loadSupervisor(false), 10000)
    const c = setInterval(() => { jfetch<Verdicts>('/verdicts').then(setVerdicts).catch(() => {}) }, 10000)
    jfetch<Verdicts>('/verdicts').then(setVerdicts).catch(() => {})
    const d = setInterval(loadWorktrees, 30000)
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); clearInterval(d) }
  }, [loadHealth, loadSupervisor, loadWorktrees])

  // ---- REST events poll (fallback) + WS live stream (primary)
  useEffect(() => {
    const load = () => jfetch<{ events: Me2Event[] }>('/events?limit=60')
      .then((d) => setEvents(d.events)).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

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

  const writeAnchor = async () => {
    if (!window.confirm('Записать recovery-anchor в Supabase evidence mirror (seq 90013993)?')) return
    setBusy('anchor')
    try {
      const r = await jfetch<{ written: boolean }>('/control-plane/mirror-anchor', { method: 'POST' })
      toast({ title: r.written ? 'Anchor записан в mirror' : 'Mirror ответ без подтверждения', description: 'me2_event_mirror_h205f22 · seq 90013993' })
    } catch (e) { toast({ title: 'Mirror write отклонён', description: (e as Error).message, variant: 'destructive' }) }
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
  const filtered = useMemo(
    () => events.filter((e) => !filter || e.type.toLowerCase().includes(filter.toLowerCase())),
    [events, filter]
  )

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 selection:bg-teal-500/30">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/10 font-mono text-sm font-bold text-teal-400">M2</div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">ME2 OS · MISSION CONTROL</div>
              <div className="text-[11px] text-zinc-500">METAENGINE development swarm · control plane</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <Chip tone="warn">{health?.round ?? 'R81-PHASE0'} · RECOVERY</Chip>
            <Chip tone={daemonUp ? 'ok' : 'p0'}>
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${daemonUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {daemonUp ? `daemon ${health?.version ?? ''}` : 'daemon OFFLINE'}
            </Chip>
            <Chip tone={wsLive ? 'info' : 'neutral'}>
              <Radio className="h-3 w-3" /> bus {wsLive ? 'live' : 'rest-only'}
            </Chip>
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
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Реестр: <span className="font-mono text-cyan-300">{health.actions.implemented} действий</span> реализовано. Donor-реестр 47 действий (v0.57.1, sandbox/me2-os) не заявлен — ждёт восстановления через GitHub.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
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

        {/* ------------------------------------------------- GAP MATRIX */}
        <Panel icon={<ShieldAlert className="h-4 w-4" />} title="P0/P1 разрывы · release gap matrix" chip={<Chip tone="p0">BLOCKED</Chip>}>
          <div className={`space-y-1.5 ${scrollCls} pr-1`}>
            {GAP_MATRIX.map((g) => {
              const liveTone = g.live === 'keepalive' ? (ka?.state === 'ACTIVE' ? 'ok' : 'p0') : g.live === 'cognitive' ? (supervisor?.cognitive.state === 'CONVERGED' ? 'ok' : 'warn') : undefined
              return (
                <div key={g.title} className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <Chip tone={g.pri === 'P0' ? 'p0' : 'warn'} className="mt-0.5 shrink-0">{g.pri}</Chip>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-200">{g.title}</span>
                      {liveTone && <Chip tone={liveTone}>LIVE</Chip>}
                    </div>
                    <div className="mt-0.5 break-words font-mono text-[11px] leading-snug text-zinc-500">{g.status}</div>
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
          defaultOpen
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="фильтр по типу…"
                className="h-11 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-teal-500/50"
                aria-label="Фильтр событий по типу"
              />
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={writeAnchor} disabled={busy === 'anchor'}
                  variant="outline" className="h-11 border-amber-500/40 bg-amber-500/10 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                >
                  {busy === 'anchor' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  <span className="ml-1.5">записать mirror-anchor (#90013993)</span>
                </Button>
                <span className="text-[10px] leading-snug text-zinc-600">одна якорная запись в me2_event_mirror — продолжение ledger старого daemon v0.57.1</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> загрузка…</div>
          )}
        </Panel>
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] text-zinc-500">
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
          <span className="ml-auto font-mono text-zinc-600">R81-PHASE0 · release readiness: BLOCKED (см. gap matrix)</span>
        </div>
      </footer>
    </div>
  )
}
