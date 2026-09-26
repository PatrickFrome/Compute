// Hash-chained append-only event log (ME2 evidence plane).
// Continuity: the previous daemon (v0.57.1) mirrored events to Supabase
// `me2_event_mirror_h205f22`; the last mirrored tail is the recovery anchor.
// New local chain starts at seq 1 with a GENESIS event referencing the anchor —
// we do NOT fake continuation of the old seq space (no false-green).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { VERSION } from "./version";

export interface Me2Event {
  seq: number;
  ts: string;
  type: string;
  actor: string;
  subject: string | null;
  payload: unknown;
  prev_hash: string;
  hash: string;
  daemon_version: string;
}

// Recovery anchor — verified live from Supabase on 2026-09-26 (R81-PHASE0 audit).
export const MIRROR_ANCHOR = {
  seq: 90013992,
  ts: "2026-09-24T23:19:17.986+00:00",
  type: "TASK_PARKED",
  hash: "77330b9f779a4a60041cfe19d49b9f6b9a63952cf318693b34b062e18dcd8eb1",
  daemon_version: "0.57.1",
  mirrored_at: "2026-09-24T23:19:35.551605+00:00",
} as const;

export class ChainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const DATA_DIR = join(import.meta.dir, "..", "data");
const DATA_FILE = join(DATA_DIR, "events.jsonl");

type Listener = (e: Me2Event) => void;
const listeners = new Set<Listener>();

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function eventHash(e: Omit<Me2Event, "hash">): string {
  return sha256(
    JSON.stringify({
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      actor: e.actor,
      subject: e.subject,
      payload: e.payload,
      prev_hash: e.prev_hash,
      daemon_version: e.daemon_version,
    })
  );
}

function genesisEvent(): Me2Event {
  const base: Omit<Me2Event, "hash"> = {
    seq: 1,
    ts: new Date().toISOString(),
    type: "RECOVERY_GENESIS",
    actor: "daemon",
    subject: null,
    payload: {
      note: "R81-PHASE0 env-reset recovery: local event log rebuilt; anchored to Supabase mirror tail",
      mirror_anchor: MIRROR_ANCHOR,
    },
    prev_hash: "0".repeat(64),
    daemon_version: VERSION,
  };
  return { ...base, hash: eventHash(base) };
}

let events: Me2Event[] = [];
let loaded = false;

export function loadEventLog(): void {
  if (loaded) return;
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    events = [genesisEvent()];
    appendFileSync(DATA_FILE, JSON.stringify(events[0]) + "\n");
    loaded = true;
    return;
  }
  const parsed: Me2Event[] = [];
  const rawLines: string[] = [];
  for (const line of readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Me2Event;
    try {
      obj = JSON.parse(t) as Me2Event;
    } catch {
      throw new ChainError("eventlog_line_invalid_json", `unparsable line in ${DATA_FILE}`);
    }
    rawLines.push(t);
    parsed.push(obj);
  }
  if (parsed.length === 0) {
    events = [genesisEvent()];
    appendFileSync(DATA_FILE, JSON.stringify(events[0]) + "\n");
    loaded = true;
    return;
  }
  // R88-RESILIENCE (env-reset #2 live incident, boot-stage race): two daemon
  // generations booted simultaneously right after the sandbox reset and BOTH
  // wrote RECOVERY_GENESIS — the file then held a BYTE-IDENTICAL duplicate
  // line and every later boot failed closed on eventlog_seq_gap. An identical
  // duplicate carries zero new information (same seq, same hash, same ts) —
  // it is the boot-race signature and is skipped idempotently. Any duplicate
  // with DIFFERENT content stays a hard ChainError (real corruption).
  const deduped: Me2Event[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (i > 0 && rawLines[i] === rawLines[i - 1]) continue; // identical boot-race twin
    if (deduped.length > 0) {
      const prevEv = deduped[deduped.length - 1];
      if (parsed[i].seq === prevEv.seq && rawLines[i] !== rawLines[i - 1]) {
        throw new ChainError("eventlog_seq_duplicate", `seq ${parsed[i].seq} appears twice with different content — manual reconcile required`);
      }
    }
    deduped.push(parsed[i]);
  }
  // fail-closed integrity check of the persisted chain
  let prev = "0".repeat(64);
  for (let i = 0; i < deduped.length; i++) {
    const e = deduped[i];
    if (e.seq !== i + 1) {
      throw new ChainError("eventlog_seq_gap", `expected seq ${i + 1}, got ${e.seq}`);
    }
    if (e.prev_hash !== prev) {
      throw new ChainError("eventlog_prev_hash_mismatch", `at seq ${e.seq}`);
    }
    const recomputed = eventHash(e);
    if (recomputed !== e.hash) {
      throw new ChainError("eventlog_hash_mismatch", `at seq ${e.seq}`);
    }
    prev = e.hash;
  }
  events = deduped;
  loaded = true;
}

const TYPE_RE = /^[A-Z][A-Z0-9_]{2,47}$/;
const ACTOR_RE = /^[a-z0-9_][a-z0-9_.:-]{0,63}$/;

// HOT-RELOAD SAFETY (R83-MIRROR lesson): bun --hot re-evaluates edited
// modules while orphaned timers from PREVIOUS generations may still fire —
// two module generations then hold separate in-memory `events` arrays and
// race-append duplicate seqs to the file (observed 2026-09-26: duplicate seq
// 399/401 lines). Guard: before EVERY append, re-read the file tail; if the
// file is ahead of our memory (a foreign/older generation appended), reload
// the whole file (fail-closed) so this append chains onto the true tail.
function syncFromDisk(): void {
  if (!existsSync(DATA_FILE)) return;
  let fd: number | null = null;
  try {
    fd = openSync(DATA_FILE, "r");
    const size = fstatSync(fd).size;
    if (size === 0) return;
    const readLen = Math.min(size, 65_536);
    const buf = Buffer.alloc(readLen);
    readSync(fd, buf, 0, readLen, size - readLen);
    const txt = buf.toString("utf8");
    const lastLine = txt.slice(txt.indexOf("\n") + 1).trimEnd().split("\n").pop() ?? "";
    if (!lastLine) return;
    const obj = JSON.parse(lastLine) as Me2Event;
    const mine = events[events.length - 1];
    if (!mine || obj.seq > mine.seq) {
      // foreign appends ahead: adopt them via a full fail-closed reload
      const keep = events;
      events = [];
      loaded = false;
      try {
        loadEventLog();
      } catch (e) {
        events = keep; // restore our view; the corruption surfaces on next
        // append attempt or restart — never silently continue past it
        loaded = true;
        throw new ChainError(
          "eventlog_foreign_corruption",
          `file tail #${obj.seq} ahead of memory #${mine?.seq ?? 0} and reload failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`
        );
      }
    }
  } catch (e) {
    if (e instanceof ChainError) throw e;
    // read/parse problems on the tail: ignore (append will chain from memory;
    // a torn last line is caught by the next full load)
  } finally {
    if (fd != null) try { closeSync(fd) } catch { /* already closed */ }
  }
}

export function appendEvent(
  type: string,
  actor: string,
  subject: string | null,
  payload: unknown
): Me2Event {
  if (!loaded) loadEventLog();
  if (!TYPE_RE.test(type)) {
    throw new ChainError("event_type_invalid", `type must match ${TYPE_RE}`);
  }
  if (!ACTOR_RE.test(actor)) {
    throw new ChainError("event_actor_invalid", `actor must match ${ACTOR_RE}`);
  }
  if (subject !== null && subject.length > 128) {
    throw new ChainError("event_subject_too_long", "subject > 128 chars");
  }
  const s = JSON.stringify(payload ?? null);
  if (s.length > 262144) {
    throw new ChainError("event_payload_too_large", "payload > 256 KiB");
  }
  syncFromDisk(); // hot-reload safety: chain onto the TRUE file tail
  const prev = events[events.length - 1];
  const base: Omit<Me2Event, "hash"> = {
    seq: prev.seq + 1,
    ts: new Date().toISOString(),
    type,
    actor,
    subject,
    payload: payload ?? null,
    prev_hash: prev.hash,
    daemon_version: VERSION,
  };
  const ev: Me2Event = { ...base, hash: eventHash(base) };
  appendFileSync(DATA_FILE, JSON.stringify(ev) + "\n");
  events.push(ev);
  for (const l of listeners) {
    try {
      l(ev);
    } catch {
      /* listener errors must never break the log */
    }
  }
  return ev;
}

export function tail(limit: number): Me2Event[] {
  if (!loaded) loadEventLog();
  const n = Math.max(1, Math.min(Math.floor(limit) || 50, 500));
  return events.slice(-n).reverse();
}

// R82-HARDEN: durable milestone dedupe — the log IS the source of truth for
// "has this milestone fired". In-process flags reset on daemon restart, which
// duplicated R82_SELF_UPDATE_LANDED (seq 298 + 316). Callers gate one-shot
// milestone appends on eventsOfType(type).length === 0.
export function eventsOfType(type: string): Me2Event[] {
  if (!loaded) loadEventLog();
  return events.filter((e) => e.type === type);
}

// R83-MIRROR: pending set for the evidence auto-mirror — all events strictly
// after afterSeq. The local chain is the source; the mirror is the durable
// remote replica (see src/mirror.ts for the contract).
export function eventsSince(afterSeq: number): Me2Event[] {
  if (!loaded) loadEventLog();
  return events.filter((e) => e.seq > afterSeq);
}

export function verifyChain(): { valid: boolean; count: number; head_hash: string } {
  if (!loaded) loadEventLog();
  let prev = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1 || e.prev_hash !== prev || eventHash(e) !== e.hash) {
      return { valid: false, count: events.length, head_hash: events[events.length - 1]?.hash ?? "" };
    }
    prev = e.hash;
  }
  return { valid: true, count: events.length, head_hash: prev };
}

export function lastSeq(): number {
  if (!loaded) loadEventLog();
  return events[events.length - 1]?.seq ?? 0;
}

export function headHash(): string {
  if (!loaded) loadEventLog();
  return events[events.length - 1]?.hash ?? "";
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
