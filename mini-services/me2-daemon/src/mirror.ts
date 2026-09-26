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
  history: Me2Event[]; // last MIRROR_SYNC events from the local chain
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
