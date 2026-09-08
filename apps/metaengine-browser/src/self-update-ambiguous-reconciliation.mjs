import {
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from './self-update-transaction-journal.mjs';
import { readExpectedPreInstallReceipt } from './self-update-handoff.mjs';

export const SELF_UPDATE_AMBIGUOUS_RECONCILIATION_VERSION = '1.0.0';
export const SELF_UPDATE_SUPERSEDED_REASON = 'SUPERSEDED_BY_PROVEN_NEWER_INSTALL';
const STARTUP_RECONCILIATION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEV_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-dev(?:\.(\d+(?:\.\d+)*))$/;

function parseDevVersion(value) {
  const match = String(value || '').trim().match(DEV_VERSION_RE);
  if (!match) return null;
  return {
    base: match.slice(1, 4).map((part) => BigInt(part)),
    dev: match[4].split('.').map((part) => BigInt(part)),
  };
}

function compareTuple(left, right) {
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function compareMetaengineDevVersions(left, right) {
  const a = parseDevVersion(left);
  const b = parseDevVersion(right);
  if (!a || !b) return null;
  const base = compareTuple(a.base, b.base);
  return base === 0 ? compareTuple(a.dev, b.dev) : base;
}

function result(state, details = {}) {
  return Object.freeze({
    schema: 'metaengine.self-update.ambiguous-reconciliation.v1',
    version: SELF_UPDATE_AMBIGUOUS_RECONCILIATION_VERSION,
    state,
    automatic_retry_allowed: false,
    installer_effect_allowed: false,
    authority_effect: false,
    ...details,
  });
}

function exactReceiptBinding(receipt, journal) {
  if (!receipt || !journal) return false;
  if (receipt.schema !== 'metaengine.self-update.pre-install-receipt.v1') return false;
  if (String(receipt.version || '') !== String(journal.target_version || '')) return false;
  if (String(receipt.available_version || '') !== String(journal.target_version || '')) return false;
  if (receipt.metadata_verified !== true || receipt.restart_gate_safe !== true || receipt.authority_effect !== false) return false;
  const journalSha = String(journal.resolved_git_sha || '').trim().toLowerCase();
  const receiptSha = String(receipt.resolved_git_sha || '').trim().toLowerCase();
  if (journalSha || receiptSha) return Boolean(journalSha && receiptSha && journalSha === receiptSha);
  return true;
}

export async function reconcileAmbiguousSelfUpdateWithProvenNewerInstall(app, {
  clock = () => Date.now(),
} = {}) {
  if (!app || app.isPackaged !== true || typeof app.getVersion !== 'function' || typeof app.getPath !== 'function') {
    return result('NOT_APPLICABLE', { reason: 'packaged_app_required' });
  }

  let journal;
  try {
    journal = await readSelfUpdateTransaction(app);
  } catch (error) {
    return result('HELD', { reason: `transaction_unreadable:${String(error?.message || error).slice(0, 160)}` });
  }
  if (!journal || journal.state !== 'AMBIGUOUS_INSTALL') {
    return result('NOT_APPLICABLE', {
      reason: journal ? `transaction_state:${journal.state}` : 'transaction_missing',
      transaction_state: journal?.state || null,
    });
  }

  const currentVersion = String(app.getVersion() || '').trim();
  const targetVersion = String(journal.target_version || '').trim();
  const comparison = compareMetaengineDevVersions(currentVersion, targetVersion);
  if (comparison !== 1) {
    return result('HELD', {
      reason: comparison == null ? 'version_order_unproven' : 'current_version_not_newer',
      current_version: currentVersion,
      target_version: targetVersion,
      transaction_state: journal.state,
    });
  }

  let expected;
  try {
    expected = await readExpectedPreInstallReceipt(app, {
      maxAgeMs: STARTUP_RECONCILIATION_MAX_AGE_MS,
      clock,
    });
  } catch (error) {
    return result('HELD', {
      reason: `pre_install_receipt_unreadable:${String(error?.message || error).slice(0, 160)}`,
      current_version: currentVersion,
      target_version: targetVersion,
      transaction_state: journal.state,
    });
  }
  if (!expected || !exactReceiptBinding(expected.receipt, journal)) {
    return result('HELD', {
      reason: expected ? 'pre_install_receipt_binding_mismatch' : 'pre_install_receipt_missing',
      current_version: currentVersion,
      target_version: targetVersion,
      transaction_state: journal.state,
    });
  }

  const superseded = await transitionSelfUpdateTransaction(app, 'SUPERSEDED', {
    requireTargetVersion: targetVersion,
    clock,
    evidence: {
      terminal_reason: SELF_UPDATE_SUPERSEDED_REASON,
      superseding_version: currentVersion,
      prior_state: journal.state,
      packaged_runtime_proven: true,
      pre_install_receipt_sha256: expected.sha256,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });

  return result(SELF_UPDATE_SUPERSEDED_REASON, {
    reason: SELF_UPDATE_SUPERSEDED_REASON,
    current_version: currentVersion,
    target_version: targetVersion,
    transaction_state: superseded.state,
    transaction_id: superseded.transaction_id,
    pre_install_receipt_sha256: expected.sha256,
    new_install_transaction_admissible: true,
  });
}
