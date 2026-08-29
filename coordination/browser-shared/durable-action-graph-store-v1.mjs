import crypto from 'node:crypto';
import { constants as C } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ACTION_GRAPH_LEGACY_VERSION,
  ACTION_GRAPH_LIMITS,
  ACTION_GRAPH_VERSION,
  ACTION_GRAPH_ZERO_HASH,
  ActionGraphError,
  ActionGraphState,
  canonicalActionGraphJson,
} from './durable-action-graph-core-v1.mjs';

const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const MAX_HEAD_BYTES = 16 * 1024;
const ACCEPTED_HEAD_VERSIONS = new Set([ACTION_GRAPH_LEGACY_VERSION, ACTION_GRAPH_VERSION]);

async function privateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700).catch(() => {});
}

async function openRegularNoFollow(file, flags, mode = 0o600) {
  const h = await fs.open(file, flags | (C.O_NOFOLLOW ?? 0), mode);
  try {
    const s = await h.stat();
    if (!s.isFile()) throw new ActionGraphError('action_graph_store_file_not_regular');
    if (typeof s.nlink === 'number' && s.nlink !== 1) throw new ActionGraphError('action_graph_store_hardlink_forbidden');
    return h;
  } catch (error) {
    await h.close().catch(() => {});
    throw error;
  }
}

async function boundedRead(file, maxBytes) {
  let h;
  try { h = await openRegularNoFollow(file, C.O_RDONLY); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  try {
    const s = await h.stat();
    if (s.size > maxBytes) throw new ActionGraphError('action_graph_store_file_too_large');
    return await h.readFile('utf8');
  } finally { await h.close(); }
}

async function syncDir(dir) {
  if (process.platform === 'win32') return;
  const h = await fs.open(dir, C.O_RDONLY);
  try { await h.sync(); } finally { await h.close(); }
}

async function writeHeadAtomic(headPath, head) {
  const dir = path.dirname(headPath);
  const temp = `${headPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const h = await fs.open(temp, C.O_CREAT | C.O_EXCL | C.O_WRONLY, 0o600);
  try { await h.writeFile(`${canonicalActionGraphJson(head)}\n`, 'utf8'); await h.sync(); }
  finally { await h.close(); }
  try {
    await fs.rename(temp, headPath);
    if (process.platform !== 'win32') await fs.chmod(headPath, 0o600).catch(() => {});
    await syncDir(dir);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

function makeHead(graphId, seq, eventHash) {
  return Object.freeze({ version: ACTION_GRAPH_VERSION, graph_id: graphId, seq, event_hash: eventHash });
}

function parseJournal(text) {
  if (text === null || text.length === 0) return [];
  if (!text.endsWith('\n')) throw new ActionGraphError('action_graph_journal_truncated');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > ACTION_GRAPH_LIMITS.maxEvents) throw new ActionGraphError('action_graph_event_limit_exceeded');
  return lines.map((line) => {
    try { return JSON.parse(line); }
    catch { throw new ActionGraphError('action_graph_journal_json_invalid'); }
  });
}

function validateHead(raw, state, events) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ActionGraphError('action_graph_head_invalid');
  if (Object.keys(raw).sort().join(',') !== 'event_hash,graph_id,seq,version') throw new ActionGraphError('action_graph_head_fields_invalid');
  if (!ACCEPTED_HEAD_VERSIONS.has(raw.version) || raw.graph_id !== state.graphId) throw new ActionGraphError('action_graph_head_identity_mismatch');
  if (!Number.isSafeInteger(raw.seq) || raw.seq < 0 || raw.seq > state.eventCount) throw new ActionGraphError('action_graph_head_sequence_invalid');
  const expected = raw.seq === 0 ? ACTION_GRAPH_ZERO_HASH : events[raw.seq - 1]?.event_hash;
  if (raw.event_hash !== expected) throw new ActionGraphError('action_graph_head_history_mismatch');
}

export class DurableActionGraphStore {
  #state;
  #journalPath;
  #headPath;
  #tail = Promise.resolve();
  #poisoned = false;

  constructor(token, { state, journalPath, headPath }) {
    if (token !== DurableActionGraphStore) throw new ActionGraphError('action_graph_use_open');
    this.#state = state;
    this.#journalPath = journalPath;
    this.#headPath = headPath;
  }

  static async open({ graphId, journalPath, headPath = `${journalPath}.head.json` }) {
    if (!path.isAbsolute(journalPath) || !path.isAbsolute(headPath) || journalPath === headPath || path.dirname(journalPath) !== path.dirname(headPath)) {
      throw new ActionGraphError('action_graph_store_path_invalid');
    }
    await privateDir(path.dirname(journalPath));
    const events = parseJournal(await boundedRead(journalPath, MAX_JOURNAL_BYTES));
    const state = new ActionGraphState(graphId).replay(events);
    const headText = await boundedRead(headPath, MAX_HEAD_BYTES);
    let head = null;
    if (headText !== null) {
      try { head = JSON.parse(headText); } catch { throw new ActionGraphError('action_graph_head_json_invalid'); }
      validateHead(head, state, events);
    }
    if (!head || head.seq !== state.eventCount || head.version !== ACTION_GRAPH_VERSION) {
      await writeHeadAtomic(headPath, makeHead(state.graphId, state.eventCount, state.lastHash));
    }
    return new DurableActionGraphStore(DurableActionGraphStore, { state, journalPath, headPath });
  }

  snapshot() { return this.#state.snapshot(); }
  declareAction(input) { return this.#enqueue(() => this.#persist(this.#state.prepareDeclared(input))); }
  sealEffectIntent(input) { return this.#enqueue(() => this.#persist(this.#state.prepareSeal(input))); }
  commitEffect(input) { return this.#enqueue(() => this.#persist(this.#state.prepareCommit(input))); }
  markNoEffect(input) { return this.#enqueue(() => this.#persist(this.#state.prepareNoEffect(input))); }
  markAmbiguous(input) { return this.#enqueue(() => this.#persist(this.#state.prepareAmbiguous(input))); }
  abortAction(input) { return this.#enqueue(() => this.#persist(this.#state.prepareAbort(input))); }

  async #persist(event) {
    if (this.#poisoned) throw new ActionGraphError('action_graph_store_reopen_required', { recoveryRequired: true });
    let h = null;
    try {
      h = await openRegularNoFollow(this.#journalPath, C.O_CREAT | C.O_APPEND | C.O_WRONLY, 0o600);
      await h.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
      await h.sync();
    } catch {
      this.#poisoned = true;
      throw new ActionGraphError('action_graph_journal_write_ambiguous', { recoveryRequired: true });
    } finally {
      await h?.close().catch(() => {});
    }

    try {
      await writeHeadAtomic(this.#headPath, makeHead(this.#state.graphId, event.seq, event.event_hash));
    } catch {
      this.#poisoned = true;
      throw new ActionGraphError('action_graph_head_seal_failed', { recoveryRequired: true });
    }
    return this.#state.acceptPrepared(event);
  }

  #enqueue(fn) {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.catch(() => {});
    return run;
  }
}
