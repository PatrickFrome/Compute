// Evidence auto-mirror (R83-MIRROR, 2026-09-26).
// Replicates the local hash-chained event log into Supabase
// `me2_event_mirror_h205f22`, CONTINUING the old seq space from the recovery
// anchor (seq 90013992, daemon v0.57.1) — the same ledger the pre-reset
// daemon wrote to. Backlog item since R81-PHASE0 ("operator anchor write →
// auto-mirror"); the anchor slot is now taken by this engine's first row
// (it binds RECOVERY_GENESIS and chains prev_hash to the anchor hash).
//
// MIRROR CONTRACT v1 (marker "me2-mirror-v1"):
//  - rows continue the anchor seq space: first row = anchor.seq + 1
//  - row.prev_hash = previous mirror row's hash (first row → anchor.hash):
//    the mirror is one continuous chain across the daemon-generation gap
//  - row.payload = JSON string {"mirror":"me2-mirror-v1","local_seq":N,
//    "local_hash":H,"event":<original payload>} stored as a jsonb string
//    scalar (donor v0.57.1 convention) — byte-exact on readback
//  - row.hash = sha256(JSON.stringify({seq, ts, type, actor, subject,
//    payload, prev_hash, daemon_version})) with ts canonicalized via
//    Date→toISOString — same formula family as the local eventHash; every
//    field round-trips exactly (payload is a string scalar, ts is parsed
//    back to the same instant and re-canonicalized by the verifier)
//  - cross-binding: payload.local_seq + payload.local_hash match each row to
//    a local chain event; the local hash already commits to the payload
//    content, so mirror rows never need to re-serialize jsonb objects
//  - FAIL-CLOSED: if the live tail diverges from local state (foreign rows
//    beyond our cursor, hash mismatch, truncation) the sync refuses to write
//    and surfaces mirror_diverged for the operator — never auto-repairs
//
// Protocol lessons honoured:
//  - R81-1 (event-log pollution): timer syncs that mirror fewer than
//    MIRROR_SYNC_MIN_EVENTS write NO local event — otherwise every sync
//    appends a MIRROR_SYNC that must itself be mirrored next cycle (infinite
//    1-event cascade). boot/operator syncs always leave evidence.
//  - R82-ATOMIC-SAVE: state file writes use unique tmp names + rename — a
//    crash never leaves a torn state file.
//  - single-flight: overlapping sync attempts (timer + operator) coalesce
//    into one run; the loser gets the winner's result.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpError } from "./errors";
import { Me2Event, MIRROR_ANCHOR, appendEvent, eventsSince, eventsOfType, lastSeq } from "./eventlog";
import { VERSION, ROUND } from "./version";
import { secretsClassFromError } from "./planes";

const ENV_FILE = "/home/z/.a2/supabase-cloud.env";
const DATA_DIR = join(import.meta.dir, "..", "data");
const STATE_FILE = join(DATA_DIR, "mirror-state.json");
const MIRROR_TABLE = "me2_event_mirror_h205f22";
export const MIRROR_MARKER = "me2-mirror-v1";

const SYNC_INTERVAL_MS = 120_000; // timer cadence
const BOOT_DELAY_MS = 15_000; // let control-plane caches warm up first
const BATCH_SIZE = 100; // rows per PostgREST insert
const STATE_TTL_CACHE_MS = 5_000; // /mirror route tail cache
const MIRROR_SYNC_MIN_EVENTS = 5; // anti-cascade threshold (lesson R81-1)

// ---------------------------------------------------------------- secrets --

function loadCreds(): { url: string; key: string } {
  if (!existsSync(ENV_FILE)) {
    throw new OpError("mirror_secrets_missing", `${ENV_FILE} not found`, 503);
  }
  const txt = readFileSync(ENV_FILE, "utf8");
  const url = /^SUPABASE_URL=(.+)$/m.exec(txt)?.[1]?.trim();
  const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(txt)?.[1]?.trim();
  if (!url || !key) throw new OpError("mirror_secrets_invalid", "SUPABASE_URL/SERVICE_ROLE_KEY missing", 503);
  return { url, key };
}

async function supa(path: string, init?: RequestInit): Promise<unknown> {
  const { url, key } = loadCreds();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const code = (body as { code?: string } | null)?.code ?? `http_${res.status}`;
    throw new OpError(`mirror_${code}`, JSON.stringify(body).slice(0, 300), 502);
  }
  return body;
}

// ------------------------------------------------------------------ state --

interface MirrorState {
  schema: "metaengine.mirror.state.v1";
  anchor: { seq: number; hash: string };
  last_mirror_seq: number; // last mirror row written by this engine (anchor if none)
  last_mirror_hash: string;
  mirrored_local_seq: number; // local events 1..mirrored_local_seq are mirrored
  last_sync_at: string | null;
  last_error: { code: string; message: string; at: string } | null;
  total_rows_synced: number;
  sync_count: number;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Canonical timestamp: identical on write and on verify (both sides parse the
// stored moment and re-emit ISO) — survives the timestamptz round-trip.
function canonTs(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toISOString();
}

// Row hash — documented contract formula (module header). Same field family
// as the local eventHash; payload is the exact JSON string stored in the
// jsonb string-scalar column, so readback recomputes byte-identically.
function rowHash(row: {
  seq: number;
  ts: string;
  type: string;
  actor: string;
  subject: string | null;
  payload: string;
  prev_hash: string;
  daemon_version: string;
}): string {
  return sha256(
    JSON.stringify({
      seq: row.seq,
      ts: row.ts,
      type: row.type,
      actor: row.actor,
      subject: row.subject,
      payload: row.payload,
      prev_hash: row.prev_hash,
      daemon_version: row.daemon_version,
    })
  );
}

let state: MirrorState | null = null;

function initialState(): MirrorState {
  return {
    schema: "metaengine.mirror.state.v1",
    anchor: { seq: MIRROR_ANCHOR.seq, hash: MIRROR_ANCHOR.hash },
    last_mirror_seq: MIRROR_ANCHOR.seq,
    last_mirror_hash: MIRROR_ANCHOR.hash,
    mirrored_local_seq: 0,
    last_sync_at: null,
    last_error: null,
    total_rows_synced: 0,
    sync_count: 0,
  };
}

function loadState(): MirrorState {
  if (state) return state;
  if (!existsSync(STATE_FILE)) {
    state = initialState();
    saveState(state);
    return state;
  }
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as MirrorState;
    if (parsed.schema !== "metaengine.mirror.state.v1" || typeof parsed.last_mirror_seq !== "number") {
      throw new Error("bad schema");
    }
    state = parsed;
  } catch {
    // torn/corrupt state is recoverable: the sync RECONCILES against the
    // live tail before writing, so a fresh state can never double-write.
    state = initialState();
  }
  return state;
}

// R82-ATOMIC-SAVE: unique tmp name + rename — concurrent saves never clobber.
// STALE-WRITER GUARD (hot-reload lesson): an orphaned generation holding an
// older cursor must never regress the durable state — if the file on disk is
// AHEAD of what we are about to write, the write is skipped (a newer
// generation owns the cursor now).
function saveState(s: MirrorState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(STATE_FILE)) {
    try {
      const disk = JSON.parse(readFileSync(STATE_FILE, "utf8")) as MirrorState;
      if (typeof disk.last_mirror_seq === "number" && disk.last_mirror_seq > s.last_mirror_seq) {
        state = disk; // adopt the newer cursor; our stale view is discarded
        return;
      }
    } catch {
      /* unreadable state file — proceed with the atomic overwrite */
    }
  }
  const tmp = join(DATA_DIR, `mirror-state-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, STATE_FILE);
  state = s;
}

function setState(patch: Partial<MirrorState>): void {
  const s = loadState();
  saveState({ ...s, ...patch });
}

// ------------------------------------------------------------ live tail ----

interface LiveRow {
  seq: number;
  hash: string;
  type: string | null;
  payload: unknown; // jsonb string scalar → JS string
  daemon_version: string;
}

let tailCache: { at: number; rows: LiveRow[] } | null = null;

async function liveTail(limit = 5, fresh = false): Promise<LiveRow[]> {
  if (!fresh && tailCache && Date.now() - tailCache.at < STATE_TTL_CACHE_MS) {
    return tailCache.rows;
  }
  const rows = (await supa(
    `/rest/v1/${MIRROR_TABLE}?select=seq,type,hash,payload,daemon_version&order=seq.desc&limit=${limit}`
  )) as LiveRow[];
  tailCache = { at: Date.now(), rows };
  return rows;
}

// ------------------------------------------------------ 24h DB aggregate ---

// R83-WATCH: read-only aggregate over the live mirror table for the last 24
// hours — fetched straight from PostgREST (select seq/type/ts only, never the
// payload) and aggregated client-side, so the stats never depend on the
// daemon's own bookkeeping. TTL-cached like the tail.
const STATS_TTL_CACHE_MS = 120_000;
const STATS_LIMIT = 2000; // rows fetched per aggregate (type distribution cap)
let statsCache: { at: number; data: MirrorStats24h } | null = null;

export async function mirrorStats24h(fresh = false): Promise<MirrorStats24h | null> {
  if (!fresh && statsCache && Date.now() - statsCache.at < STATS_TTL_CACHE_MS) return statsCache.data;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const path =
    `/rest/v1/${MIRROR_TABLE}?select=seq,type,ts&mirrored_at=gte.${encodeURIComponent(since)}` +
    `&order=seq.desc&limit=${STATS_LIMIT}`;
  const rows = (await supa(path)) as { seq?: number; type?: string | null; ts?: string | null }[];
  const seqs = rows.map((r) => (typeof r.seq === "number" ? r.seq : NaN)).filter(Number.isFinite);
  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = r.type == null || r.type === "" ? "(no type)" : String(r.type);
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const data: MirrorStats24h = {
    checked_at: new Date().toISOString(),
    rows: rows.length,
    capped: rows.length >= STATS_LIMIT,
    first_seq: seqs.length ? Math.min(...seqs) : null,
    last_seq: seqs.length ? Math.max(...seqs) : null,
    oldest_ts: rows.length ? (rows[rows.length - 1].ts ?? null) : null, // desc order → oldest last
    newest_ts: rows.length ? (rows[0].ts ?? null) : null,
    by_type: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count })),
    window_since: since,
  };
  statsCache = { at: Date.now(), data };
  return data;
}

// Parse the payload string scalar into the mirror binding (marker, local_seq,
// local_hash, event). Foreign/legacy rows (v0.57.1) return null binding.
function parseBinding(row: LiveRow): { local_seq: number; local_hash: string } | null {
  const p = row.payload;
  if (typeof p !== "string") return null;
  try {
    const obj = JSON.parse(p) as { mirror?: string; local_seq?: number; local_hash?: string };
    if (obj?.mirror === MIRROR_MARKER && typeof obj.local_seq === "number" && typeof obj.local_hash === "string") {
      return { local_seq: obj.local_seq, local_hash: obj.local_hash };
    }
  } catch {
    /* not ours */
  }
  return null;
}

// ------------------------------------------------------------------ sync ---

export interface MirrorSyncResult {
  ok: true;
  reason: string;
  synced: number;
  from_local_seq: number | null;
  to_local_seq: number | null;
  mirror_to_seq: number;
  pending_after: number;
  duration_ms: number;
  reconciled: string | null; // set when the live tail was adopted before writing
}

let inFlight: Promise<MirrorSyncResult> | null = null;

export async function syncMirror(reason: "boot" | "timer" | "operator"): Promise<MirrorSyncResult> {
  if (inFlight) return inFlight; // single-flight (timer + operator coalesce)
  inFlight = runSync(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(reason: string): Promise<MirrorSyncResult> {
  const t0 = Date.now();
  try {
    const s = loadState();
    const localLast = lastSeq();

    // ---- 1. reconcile against the live tail (fail-closed on divergence)
    const [top] = await liveTail(1, true);
    if (!top) {
      throw new OpError("mirror_empty", `${MIRROR_TABLE} returned no rows — expected the anchor tail`, 502);
    }
    let reconciled: string | null = null;
    if (top.seq === s.last_mirror_seq) {
      if (top.hash !== s.last_mirror_hash) {
        throw new OpError(
          "mirror_diverged",
          `live tail #${top.seq} hash ${top.hash.slice(0, 12)}… != state ${s.last_mirror_hash.slice(0, 12)}… (manual reconcile required)`,
          409
        );
      }
    } else if (top.seq > s.last_mirror_seq) {
      // rows exist beyond our cursor — ours (crash after insert, before state
      // save) or foreign. Adopt only rows with our marker + valid local
      // binding. Paged: a pathological crash could leave >1 page behind.
      let cursor = s.last_mirror_seq;
      let maxLocalSeq = s.mirrored_local_seq;
      const PAGE = 200;
      while (cursor < top.seq) {
        const rows = (await supa(
          `/rest/v1/${MIRROR_TABLE}?select=seq,type,hash,payload,daemon_version&seq=gt.${cursor}&order=seq.asc&limit=${PAGE}`
        )) as LiveRow[];
        if (!Array.isArray(rows) || rows.length === 0 || rows[0].seq !== cursor + 1) {
          throw new OpError("mirror_diverged_gap", `rows beyond #${cursor} unreadable or non-contiguous`, 409);
        }
        for (const r of rows) {
          const b = parseBinding(r);
          if (!b || b.local_seq > localLast) {
            throw new OpError(
              "mirror_diverged_foreign",
              `row #${r.seq} beyond cursor is not ours (marker/local binding missing) — operator reconcile required`,
              409
            );
          }
          maxLocalSeq = Math.max(maxLocalSeq, b.local_seq);
          cursor = r.seq;
        }
      }
      const [topAgain] = await liveTail(1, true); // authoritative head hash
      saveState({
        ...s,
        last_mirror_seq: cursor,
        last_mirror_hash: topAgain?.hash ?? s.last_mirror_hash,
        mirrored_local_seq: maxLocalSeq,
      });
      reconciled = `adopted #${s.last_mirror_seq + 1}..#${cursor} (crash-recovery)`;
      s.last_mirror_seq = cursor;
      s.last_mirror_hash = topAgain?.hash ?? s.last_mirror_hash;
      s.mirrored_local_seq = maxLocalSeq;
    } else {
      throw new OpError(
        "mirror_truncated",
        `live tail #${top.seq} behind state #${s.last_mirror_seq} (mirror rows lost?) — operator reconcile required`,
        409
      );
    }

    // ---- 2. collect pending local events
    const st = loadState();
    const pending = eventsSince(st.mirrored_local_seq);
    if (pending.length === 0) {
      setState({ last_sync_at: new Date().toISOString(), last_error: null });
      return {
        ok: true,
        reason,
        synced: 0,
        from_local_seq: null,
        to_local_seq: null,
        mirror_to_seq: st.last_mirror_seq,
        pending_after: 0,
        duration_ms: Date.now() - t0,
        reconciled,
      };
    }

    // ---- 3. batch-insert rows (mirror seq space continues from the cursor)
    let cursorSeq = st.last_mirror_seq;
    let cursorHash = st.last_mirror_hash;
    let written = 0;
    const fromLocal = pending[0].seq;
    const toLocal = pending[pending.length - 1].seq;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const rows: Record<string, unknown>[] = [];
      for (const ev of batch) {
        cursorSeq += 1;
        const payloadStr = JSON.stringify({
          mirror: MIRROR_MARKER,
          local_seq: ev.seq,
          local_hash: ev.hash,
          event: ev.payload ?? null,
        });
        const row = {
          seq: cursorSeq,
          ts: canonTs(ev.ts),
          type: ev.type,
          actor: ev.actor,
          subject: ev.subject,
          payload: payloadStr, // jsonb string scalar — byte-exact readback
          prev_hash: cursorHash,
          daemon_version: ev.daemon_version,
          mirrored_at: new Date().toISOString(),
        };
        cursorHash = rowHash(row);
        rows.push({ ...row, hash: cursorHash });
      }
      const res = (await supa(`/rest/v1/${MIRROR_TABLE}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      })) as unknown[];
      if (!Array.isArray(res) || res.length !== rows.length) {
        throw new OpError(
          "mirror_insert_unconfirmed",
          `batch ${fromLocal + i}..${fromLocal + i + rows.length - 1}: expected ${rows.length} rows back, got ${Array.isArray(res) ? res.length : typeof res}`,
          502
        );
      }
      written += rows.length;
      // advance the durable cursor AFTER each confirmed batch — a crash here
      // resumes exactly at the confirmed prefix (reconcile adopts the rest)
      saveState({
        ...loadState(),
        last_mirror_seq: cursorSeq,
        last_mirror_hash: cursorHash,
        mirrored_local_seq: batch[batch.length - 1].seq,
        last_sync_at: new Date().toISOString(),
        last_error: null,
        total_rows_synced: loadState().total_rows_synced + rows.length,
        sync_count: loadState().sync_count + 1,
      });
    }

    // ---- 4. evidence of the sync (anti-cascade: only big or explicit runs)
    if (written >= MIRROR_SYNC_MIN_EVENTS || reason !== "timer") {
      appendEvent("MIRROR_SYNC", "daemon", `mirror_${reason}`, {
        synced: written,
        from_local_seq: fromLocal,
        to_local_seq: toLocal,
        mirror_to_seq: cursorSeq,
        mirror_head: cursorHash.slice(0, 16),
        reason,
      });
    }

    const st2 = loadState();
    return {
      ok: true,
      reason,
      synced: written,
      from_local_seq: fromLocal,
      to_local_seq: toLocal,
      mirror_to_seq: cursorSeq,
      pending_after: eventsSince(st2.mirrored_local_seq).length,
      duration_ms: Date.now() - t0,
      reconciled,
    };
  } catch (e) {
    const code = e instanceof OpError ? e.code : "mirror_internal";
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    setState({ last_error: { code, message: msg, at: new Date().toISOString() } });
    throw e;
  }
}

// ------------------------------------------------------------ verify ----

// R83-VERIFY: the independent contract verifier, IN-PROCESS and callable from
// the console (one click — no shell needed). Port of scripts/verify-mirror.mjs
// (the promotion-gate-grade verifier), same four checks:
//   1. seq contiguity from anchor.seq + 1
//   2. prev_hash chaining: first row → anchor.hash, each row → previous
//   3. row-hash recomputation from the documented formula
//   4. cross-binding: payload.local_seq/local_hash vs the local chain
//      (hash + type/actor/subject + payload content + ts)
// Reads ALL rows paged ascending; never trusts the daemon's own state —
// the local log is loaded raw for binding comparison (its internal chain is
// verified separately by /eventlog/verify).
export interface MirrorVerifyResult {
  ok: boolean;
  schema: "metaengine.mirror.verify.v1";
  started_at: string;
  duration_ms: number;
  rows_checked: number;
  head_seq: number | null; // last contiguous row seq
  violations: number;
  first_broken_seq: number | null;
  checks: { seq_continuity: boolean; prev_hash_chain: boolean; row_hashes: boolean; bindings: boolean };
  samples: string[]; // first N violation descriptions (bounded)
  // R88-RESILIENCE: "secrets_missing" = проверка НЕ ВЫПОЛНИЛАСЬ (env-degraded,
  // amber) — нарушения НЕ найдены, потому что читать было нечего; любое другое
  // значение/отсутствие = обычная семантика ok/violations.
  error_class?: "secrets_missing" | "unknown";
}

const VERIFY_PAGE = 1000;
const VERIFY_MAX_ROWS = 20000; // safety cap (24h churn is ~450 rows; 20k = weeks)

let verifyInFlight: Promise<MirrorVerifyResult> | null = null;

// R83-AUTONOMY: auto-periodic verification — the contract check runs itself
// every 6 hours (backlog item from R83-VERIFY: "авто-периодический MIRROR_VERIFY
// (раз в 6ч, silent)"). Restart-safe BY CONSTRUCTION: the schedule is derived
// from the durable journal (last MIRROR_VERIFY event ts), never from process
// memory — a daemon restart picks up the countdown where it left off.
// Orphan-generation protection (lesson R83-MIRROR-1): a timer run refuses to
// execute when the journal shows a verify newer than interval − 5 min, so two
// hot-reload generations can never double-fire.
const AUTO_VERIFY_INTERVAL_MS = 6 * 3600_000;
const AUTO_VERIFY_MIN_GAP_MS = AUTO_VERIFY_INTERVAL_MS - 5 * 60_000;
let autoVerifyTimer: ReturnType<typeof setTimeout> | null = null;
let autoVerifyNextAt: number | null = null;

function lastVerifyAt(): number | null {
  const evs = eventsOfType("MIRROR_VERIFY");
  const ev = evs[evs.length - 1];
  if (!ev) return null;
  const t = Date.parse(ev.ts);
  return Number.isFinite(t) ? t : null;
}

function scheduleNextAutoVerify(delayMs: number): void {
  if (autoVerifyTimer) clearTimeout(autoVerifyTimer);
  autoVerifyNextAt = Date.now() + delayMs;
  autoVerifyTimer = setTimeout(() => {
    autoVerifyTimer = null;
    const last = lastVerifyAt();
    const since = last == null ? Infinity : Date.now() - last;
    if (since < AUTO_VERIFY_MIN_GAP_MS) {
      // someone verified recently (operator click or an orphaned generation's
      // timer) — skip this tick, keep the 6h cadence from that verify
      scheduleNextAutoVerify(Math.max(60_000, AUTO_VERIFY_INTERVAL_MS - since));
      return;
    }
    mirrorVerify("timer")
      .catch(() => {
        /* failures surface in the journal event + console alerting */
      })
      .finally(() => scheduleNextAutoVerify(AUTO_VERIFY_INTERVAL_MS));
  }, delayMs);
}

export function mirrorVerify(trigger: "operator" | "timer" = "operator"): Promise<MirrorVerifyResult> {
  if (verifyInFlight) return verifyInFlight;
  verifyInFlight = (async (): Promise<MirrorVerifyResult> => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const violations: string[] = []
    let firstBroken: number | null = null;
    const flags = { seq: true, prev: true, hash: true, bind: true };
    const note = (seq: number | null, msg: string): void => {
      if (firstBroken == null && seq != null) firstBroken = seq;
      if (violations.length < 12) violations.push(`${seq != null ? `#${seq}: ` : ""}${msg}`);
    };
    try {
      // local chain as raw seq→event map (loaded via eventsSince(0) — loads file)
      const localMap = new Map<number, Me2Event>();
      for (const e of eventsSince(0)) localMap.set(e.seq, e);

      // fetch ALL our rows, paged ascending from the anchor
      const rows: {
        seq: number; ts: string; type: string; actor: string; subject: string | null;
        payload: string; prev_hash: string; hash: string; daemon_version: string;
      }[] = [];
      let from = MIRROR_ANCHOR.seq;
      for (;;) {
        const page = (await supa(
          `/rest/v1/${MIRROR_TABLE}?select=seq,ts,type,actor,subject,payload,prev_hash,hash,daemon_version&seq=gt.${from}&order=seq.asc&limit=${VERIFY_PAGE}`
        )) as typeof rows;
        if (!Array.isArray(page) || page.length === 0) break;
        rows.push(...page);
        from = page[page.length - 1].seq;
        if (page.length < VERIFY_PAGE || rows.length >= VERIFY_MAX_ROWS) break;
      }

      let prevHash = MIRROR_ANCHOR.hash;
      let prevSeq = MIRROR_ANCHOR.seq;
      for (const r of rows) {
        if (r.seq !== prevSeq + 1) { flags.seq = false; note(r.seq, `seq-gap: expected ${prevSeq + 1}`); }
        if (r.prev_hash !== prevHash) { flags.prev = false; note(r.seq, "prev_hash mismatch"); }
        const recomputed = rowHash({ ...r, ts: canonTs(r.ts) });
        if (recomputed !== r.hash) {
          flags.hash = false;
          note(r.seq, `row-hash mismatch (stored ${String(r.hash).slice(0, 12)}… ≠ recomputed ${recomputed.slice(0, 12)}…)`);
        }
        // cross-binding via the payload string scalar
        let binding: { mirror?: string; local_seq?: number; local_hash?: string; event?: unknown } | null = null;
        if (typeof r.payload === "string") {
          try {
            const obj = JSON.parse(r.payload) as typeof binding;
            if (obj && obj.mirror === MIRROR_MARKER) binding = obj;
          } catch { /* not ours */ }
        }
        if (!binding) {
          flags.bind = false;
          note(r.seq, "no me2-mirror-v1 marker in payload");
        } else {
          const le = localMap.get(binding.local_seq ?? -1);
          if (!le) {
            flags.bind = false;
            note(r.seq, `local event #${binding.local_seq} missing`);
          } else {
            if (le.hash !== binding.local_hash) { flags.bind = false; note(r.seq, "local_hash mismatch"); }
            if (le.type !== r.type || le.actor !== r.actor || (le.subject ?? null) !== (r.subject ?? null)) {
              flags.bind = false;
              note(r.seq, `type/actor/subject mismatch (${le.type}/${r.type})`);
            }
            if (JSON.stringify(le.payload ?? null) !== JSON.stringify(binding.event ?? null)) {
              flags.bind = false;
              note(r.seq, "payload content mismatch");
            }
            if (canonTs(r.ts) !== canonTs(le.ts)) { flags.bind = false; note(r.seq, "ts mismatch"); }
          }
        }
        prevHash = r.hash;
        prevSeq = r.seq;
      }
      const ok = flags.seq && flags.prev && flags.hash && flags.bind;
      const out: MirrorVerifyResult = {
        ok,
        schema: "metaengine.mirror.verify.v1",
        started_at: startedAt,
        duration_ms: Date.now() - t0,
        rows_checked: rows.length,
        head_seq: rows.length ? rows[rows.length - 1].seq : null,
        violations: violations.length,
        first_broken_seq: firstBroken,
        checks: {
          seq_continuity: flags.seq,
          prev_hash_chain: flags.prev,
          row_hashes: flags.hash,
          bindings: flags.bind,
        },
        samples: violations,
      };
      // evidence: the verification run itself is an auditable fact. Operator
      // clicks and timer ticks both land in the chain (payload.trigger tells
      // them apart; the console toasts only operator runs — auto runs are the
      // silent 6h cadence by design)
      appendEvent("MIRROR_VERIFY", trigger === "timer" ? "daemon" : "operator", out.head_seq ? String(out.head_seq) : null, {
        ok,
        rows_checked: out.rows_checked,
        duration_ms: out.duration_ms,
        violations: out.violations,
        first_broken_seq: out.first_broken_seq,
        trigger,
        daemon_version: VERSION,
      });
      return out;
    } catch (e) {
      // R88-RESILIENCE: classify WHY the verify could not run — a missing
      // credentials file is env-degradation (amber), NOT a broken contract;
      // the console renders these differently and the journal keeps the class.
      const errMsg = String((e as Error)?.message ?? e).slice(0, 160);
      const errorClass = secretsClassFromError(errMsg);
      const out: MirrorVerifyResult = {
        ok: false,
        schema: "metaengine.mirror.verify.v1",
        started_at: startedAt,
        duration_ms: Date.now() - t0,
        rows_checked: 0,
        head_seq: null,
        violations: errorClass === "secrets_missing" ? 0 : 1,
        first_broken_seq: null,
        checks: { seq_continuity: false, prev_hash_chain: false, row_hashes: false, bindings: false },
        samples: [`verify failed: ${errMsg}`],
        error_class: errorClass,
      };
      appendEvent("MIRROR_VERIFY", trigger === "timer" ? "daemon" : "operator", null, {
        ok: false,
        error: out.samples[0],
        error_class: errorClass,
        trigger,
        daemon_version: VERSION,
      });
      return out;
    } finally {
      verifyInFlight = null;
    }
  })();
  return verifyInFlight;
}

// -------------------------------------------------------------- surface ----

export interface MirrorStatus {
  ok: true;
  schema: "metaengine.mirror.status.v1";
  daemon_version: string;
  round: string;
  fetched_at: string;
  contract: {
    marker: string;
    table: string;
    hash_formula: "sha256(JSON.stringify({seq,ts,type,actor,subject,payload,prev_hash,daemon_version}))";
    payload_shape: "{mirror, local_seq, local_hash, event}";
    continuity: "first row chains prev_hash to anchor #90013992 (v0.57.1 tail)";
    fail_closed: "divergence/truncation/foreign rows refuse to write";
  };
  state: MirrorState;
  local_last_seq: number;
  pending: number;
  auto_sync: { interval_ms: number; boot_delay_ms: number; running: boolean; next_in_ms: number | null };
  live: {
    checked_at: string | null;
    last_row: { seq: number; hash: string; daemon_version: string; ours: boolean } | null;
    matches_state: boolean | null; // null = live check pending
    tail: { seq: number; type: string | null; local_seq: number | null; ours: boolean; anchor: boolean }[];
  };
  // R83-WATCH: DB-side 24h aggregate read straight from PostgREST — the
  // console shows durability from the DATABASE's point of view, not the
  // daemon's word about its own writes (independent-verifier principle).
  // null when the aggregate could not be read (best-effort, like `live`).
  stats_24h: MirrorStats24h | null;
  // R83-VERIFY: the last verification run recorded in the journal (null if
  // the contract has never been verified in this chain) — surfaces as the
  // "last checked" line next to the verify button.
  last_verify: { at: string; ok: boolean; rows: number; duration_ms: number; violations: number; trigger: string | null } | null;
  // R83-AUTONOMY: the silent 6h self-check cadence — countdown derived from
  // the journal, so it survives restarts; a "due soon" surface for the console
  auto_verify: { interval_ms: number; last_at: string | null; next_in_ms: number | null; running: boolean };
  history: Me2Event[]; // last MIRROR_SYNC events from the local chain
}

export interface MirrorStats24h {
  checked_at: string;
  rows: number; // rows mirrored in the last 24h (capped by STATS_LIMIT)
  capped: boolean; // rows == limit → the true count is higher
  first_seq: number | null; // oldest seq in the window
  last_seq: number | null; // newest seq in the window
  oldest_ts: string | null; // ts of the oldest row
  newest_ts: string | null; // ts of the newest row
  by_type: { type: string; count: number }[]; // top types, desc
  window_since: string; // the 24h cutoff that was queried
}

let autoTimer: ReturnType<typeof setInterval> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let nextTickAt: number | null = null;

export function startAutoMirror(): void {
  if (autoTimer) return;
  nextTickAt = Date.now() + BOOT_DELAY_MS;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    nextTickAt = Date.now() + SYNC_INTERVAL_MS;
    syncMirror("boot").catch(() => {
      /* error surface lives in state.last_error */
    });
    autoTimer = setInterval(() => {
      nextTickAt = Date.now() + SYNC_INTERVAL_MS;
      syncMirror("timer").catch(() => {
        /* error surface lives in state.last_error */
      });
    }, SYNC_INTERVAL_MS);
  }, BOOT_DELAY_MS);
  // R83-AUTONOMY: auto-verify timer — the countdown starts from the journal's
  // last MIRROR_VERIFY (restart-safe); first run no sooner than 90s after boot
  // (lets the boot sync land first so the verify sees the fresh tail)
  if (!autoVerifyTimer) {
    const last = lastVerifyAt();
    const since = last == null ? Infinity : Date.now() - last;
    scheduleNextAutoVerify(since >= AUTO_VERIFY_INTERVAL_MS ? 90_000 : AUTO_VERIFY_INTERVAL_MS - since);
  }
}

export async function mirrorStatus(fresh = false): Promise<MirrorStatus> {
  const s = loadState();
  const localLast = lastSeq();
  const pending = Math.max(0, localLast - s.mirrored_local_seq);
  let live: MirrorStatus["live"] = { checked_at: null, last_row: null, matches_state: null, tail: [] };
  try {
    const rows = await liveTail(5, fresh);
    const [top] = rows;
    live = {
      checked_at: new Date().toISOString(),
      last_row: top
        ? { seq: top.seq, hash: top.hash, daemon_version: top.daemon_version, ours: !!parseBinding(top) }
        : null,
      matches_state: top ? top.seq === s.last_mirror_seq && top.hash === s.last_mirror_hash : false,
      tail: rows.map((r) => {
        const anchor = r.seq === MIRROR_ANCHOR.seq;
        const binding = parseBinding(r);
        return {
          seq: r.seq,
          type: r.type ?? (anchor ? MIRROR_ANCHOR.type : null),
          local_seq: binding?.local_seq ?? null,
          ours: !!binding,
          anchor,
        };
      }),
    };
  } catch {
    /* live check is best-effort in the status route; sync failures surface via last_error */
  }
  // R83-WATCH: DB-side 24h aggregate (best-effort — null surfaces in the UI)
  let stats: MirrorStats24h | null = null;
  try {
    stats = await mirrorStats24h(fresh);
  } catch {
    /* stats are evidence, not a gate */
  }
  return {
    ok: true,
    schema: "metaengine.mirror.status.v1",
    daemon_version: VERSION,
    round: ROUND,
    fetched_at: new Date().toISOString(),
    contract: {
      marker: MIRROR_MARKER,
      table: MIRROR_TABLE,
      hash_formula: "sha256(JSON.stringify({seq,ts,type,actor,subject,payload,prev_hash,daemon_version}))",
      payload_shape: "{mirror, local_seq, local_hash, event}",
      continuity: "first row chains prev_hash to anchor #90013992 (v0.57.1 tail)",
      fail_closed: "divergence/truncation/foreign rows refuse to write",
    },
    state: s,
    local_last_seq: localLast,
    pending,
    auto_sync: {
      interval_ms: SYNC_INTERVAL_MS,
      boot_delay_ms: BOOT_DELAY_MS,
      running: !!autoTimer || !!bootTimer,
      next_in_ms: nextTickAt ? Math.max(0, nextTickAt - Date.now()) : null,
    },
    live,
    stats_24h: stats,
    last_verify: (() => {
      const evs = eventsOfType("MIRROR_VERIFY");
      const ev = evs[evs.length - 1];
      if (!ev) return null;
      const p = (ev.payload ?? {}) as { ok?: boolean; rows_checked?: number; duration_ms?: number; violations?: number; trigger?: string; error_class?: string; error?: string };
      // R88-RESILIENCE: legacy journal events (pre-0.70.0) lack error_class —
      // derive it from the error string so an env-degraded PAST run never
      // renders as a broken contract after a daemon upgrade
      const errorClass = p.ok ? null : p.error_class ?? secretsClassFromError(p.error);
      return { at: ev.ts, ok: !!p.ok, rows: p.rows_checked ?? 0, duration_ms: p.duration_ms ?? 0, violations: p.violations ?? 0, trigger: p.trigger ?? null, error_class: errorClass };
    })(),
    auto_verify: {
      interval_ms: AUTO_VERIFY_INTERVAL_MS,
      last_at: (() => {
        const t = lastVerifyAt();
        return t == null ? null : new Date(t).toISOString();
      })(),
      next_in_ms: autoVerifyNextAt ? Math.max(0, autoVerifyNextAt - Date.now()) : null,
      running: !!autoVerifyTimer,
    },
    history: eventsOfType("MIRROR_SYNC").slice(-8).reverse(),
  };
}

// Health-plane summary (no network calls, no secrets).
export function mirrorHealth(): {
  last_mirror_seq: number;
  mirrored_local_seq: number;
  pending: number;
  last_sync_at: string | null;
  last_error: string | null;
  running: boolean;
} {
  const s = loadState();
  return {
    last_mirror_seq: s.last_mirror_seq,
    mirrored_local_seq: s.mirrored_local_seq,
    pending: Math.max(0, lastSeq() - s.mirrored_local_seq),
    last_sync_at: s.last_sync_at,
    last_error: s.last_error ? `${s.last_error.code}: ${s.last_error.message}` : null,
    running: !!autoTimer || !!bootTimer,
  };
}
