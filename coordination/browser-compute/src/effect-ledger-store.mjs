import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJsonWrite, readJson } from './security.mjs';
import {
  buildEffectEvent,
  EFFECT_LEDGER_FILE_SCHEMA,
  verifyLedgerChain
} from '../../browser-shared/effect-ledger.mjs';

const LEDGER_FILE = 'effect-ledger.json';

// B7-PRE1 — per-profile durable effect ledger store.
//
// Persistence model (v1): one JSON file per profile, atomic-replace writes,
// entries are strictly append-only (existing entries are never rewritten).
// The file carries a stored head ({seq, entry_sha256}) so tail truncation of
// the entries array without rewriting the head is detectable on load.
//
// Integrity model: the chain is verified on first load; a broken chain poisons
// the store — appends fail closed (an unverifiable history must never be
// silently extended), while reads keep serving the raw entries for diagnosis.
export class EffectLedgerStore {
  constructor({ profileDir } = {}) {
    if (!profileDir) throw new Error('effect_ledger_profile_dir_required');
    this.profileDir = profileDir;
    this._file = path.join(profileDir, LEDGER_FILE);
    this._cache = null;
    this._poisoned = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    const data = await readJson(this._file, null);
    let registry;
    if (!data || !Array.isArray(data.entries) || data.schema !== EFFECT_LEDGER_FILE_SCHEMA) {
      registry = { schema: EFFECT_LEDGER_FILE_SCHEMA, entries: [], head: { seq: 0, entry_sha256: '' }, updated_at: new Date().toISOString() };
    } else {
      registry = data;
    }
    const verification = verifyLedgerChain(registry.entries, {
      expectedHeadSeq: registry.head?.seq ?? registry.entries.length,
      expectedHeadSha256: registry.head?.entry_sha256 || null
    });
    if (!verification.ok) {
      // Keep a readable snapshot for diagnosis, then fail closed for writes.
      this._cache = registry;
      this._poisoned = verification;
      return registry;
    }
    this._poisoned = null;
    this._cache = registry;
    return registry;
  }

  async _save(registry) {
    const last = registry.entries[registry.entries.length - 1] || null;
    registry.head = last ? { seq: last.seq, entry_sha256: last.entry_sha256 } : { seq: 0, entry_sha256: '' };
    registry.updated_at = new Date().toISOString();
    await atomicJsonWrite(this._file, registry);
    this._cache = registry;
  }

  #assertWritable() {
    if (this._poisoned) {
      const reason = this._poisoned.reason || 'ledger_chain_broken';
      throw new Error(`effect_ledger_chain_broken:${reason}`);
    }
  }

  async append({ type, identity, payload = null } = {}) {
    const registry = await this._load();
    this.#assertWritable();
    const last = registry.entries[registry.entries.length - 1] || null;
    const entry = buildEffectEvent({
      seq: last ? last.seq + 1 : 1,
      prevEntrySha256: last ? last.entry_sha256 : null,
      type,
      identity,
      payload
    });
    registry.entries.push(entry);
    await this._save(registry);
    return entry;
  }

  async verify() {
    const registry = await this._load();
    return verifyLedgerChain(registry.entries, {
      expectedHeadSeq: registry.head?.seq ?? registry.entries.length,
      expectedHeadSha256: registry.head?.entry_sha256 || null
    });
  }

  async head() {
    const registry = await this._load();
    const last = registry.entries[registry.entries.length - 1] || null;
    return Object.freeze({
      seq: last ? last.seq : 0,
      entry_sha256: last ? last.entry_sha256 : '',
      type: last ? last.type : null,
      poisoned: Boolean(this._poisoned),
      poison_reason: this._poisoned?.reason || null
    });
  }

  async timeline({ actionId = null } = {}) {
    const registry = await this._load();
    const entries = actionId
      ? registry.entries.filter((entry) => entry.identity?.action_id === actionId)
      : registry.entries;
    return {
      schema: 'metaengine.a2-effect-ledger.timeline.v1',
      head: await this.head(),
      entries: entries.map((entry) => ({
        seq: entry.seq,
        type: entry.type,
        occurred_at: entry.occurred_at,
        identity: entry.identity,
        payload: entry.payload,
        entry_sha256: entry.entry_sha256
      }))
    };
  }

  async size() {
    const registry = await this._load();
    return registry.entries.length;
  }
}

export function createEffectLedgerStore({ profileDir } = {}) {
  return new EffectLedgerStore({ profileDir });
}
