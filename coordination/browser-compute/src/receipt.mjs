import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJsonWrite, readJson } from './security.mjs';
import { RECEIPT_STATUS, validateReceipt, receiptSha256, canonicalReceiptBytes } from '../../browser-shared/receipt-contract.mjs';

const RECEIPTS_FILE = 'receipts.json';

export class ReceiptStore {
  constructor({ profileDir, sessionKey = '' } = {}) {
    this.profileDir = profileDir;
    this.sessionKey = String(sessionKey || '');
    this._file = profileDir ? path.join(profileDir, RECEIPTS_FILE) : null;
    this._cache = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    if (!this._file) return { schema: 'metaengine.a2-compute-browser.receipts.v1', receipts: [], updated_at: new Date().toISOString() };
    const data = await readJson(this._file, null);
    if (!data || !Array.isArray(data.receipts)) {
      this._cache = { schema: 'metaengine.a2-compute-browser.receipts.v1', receipts: [], updated_at: new Date().toISOString() };
    } else {
      this._cache = data;
    }
    return this._cache;
  }

  async _save(registry) {
    registry.updated_at = new Date().toISOString();
    if (this._file) {
      await atomicJsonWrite(this._file, registry);
    }
    this._cache = registry;
  }

  async append(receipt) {
    const validated = validateReceipt(receipt);
    if (!validated.ok) throw new Error(validated.reason);

    const registry = await this._load();
    if (registry.receipts.some((r) => r.receipt_id === receipt.receipt_id)) return receipt;

    registry.receipts.push(receipt);
    await this._save(registry);
    return receipt;
  }

  async get(receiptId) {
    const registry = await this._load();
    return registry.receipts.find((r) => r.receipt_id === receiptId) || null;
  }

  async latestForResource(targetId) {
    const registry = await this._load();
    const filtered = registry.receipts.filter((r) => r.resource_id === targetId);
    if (!filtered.length) return null;
    return filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  }

  async verify(receiptId) {
    const receipt = await this.get(receiptId);
    if (!receipt) return { ok: false, reason: 'receipt_not_found' };

    const validated = validateReceipt(receipt);
    if (!validated.ok) return validated;

    return { ok: true, receipt };
  }
}

export function emitReceipt({ lease, action, result, processIncarnationId, sessionKey } = {}) {
  const now = new Date().toISOString();

  const receipt = {
    schema: 'metaengine.a2-browser-operator.receipt.v1',
    receipt_id: crypto.randomUUID(),
    action_id: action?.action_id || '',
    lease_id: lease?.lease_id || '',
    resource_id: action?.target_id || '',
    profile_id: action?.profile_id || '',
    context_id: action?.context_id || '',
    process_incarnation_id: String(processIncarnationId || ''),
    kind: action?.kind || 'NAVIGATE',
    status: result?.status || 'FAILED_NO_EFFECT',
    effect_evidence: result?.effect_evidence || { dispatched: false },
    authority_effect: true,
    created_at: now,
    receipt_sha256: ''
  };

  receipt.receipt_sha256 = receiptSha256(receipt);

  return receipt;
}
