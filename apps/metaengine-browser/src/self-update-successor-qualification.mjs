import { loadSelfUpdateSessionContinuity } from './self-update-session-continuity.mjs';
import { qualifyUpdatedSuccessor } from './self-update-handoff.mjs';
import { readSelfUpdateTransaction } from './self-update-transaction-journal.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function probeUpdatedSuccessorQualification({
  app,
  userDataPath = null,
  uptimeMs = () => Math.round(process.uptime() * 1000),
  minUptimeMs = 3000,
} = {}) {
  if (!app || typeof app.getVersion !== 'function' || typeof app.hasSingleInstanceLock !== 'function') {
    throw new Error('self_update_qualification_app_invalid');
  }
  const transaction = await readSelfUpdateTransaction(app);
  if (!transaction || transaction.state !== 'SUCCESSOR_BOOTED') {
    return { state: 'NOT_PENDING', transaction_state: transaction?.state || null, authority_effect: false };
  }
  const version = String(app.getVersion() || '');
  if (version !== transaction.target_version) throw new Error('self_update_qualification_target_mismatch');
  if (app.hasSingleInstanceLock() !== true) {
    return { state: 'PENDING_SINGLETON', target_version: version, authority_effect: false };
  }
  const age = Math.max(0, Number(uptimeMs()) || 0);
  if (age < Math.max(1000, Number(minUptimeMs) || 3000)) {
    return { state: 'PENDING_UPTIME', target_version: version, uptime_ms: age, authority_effect: false };
  }
  const userData = userDataPath || app.getPath?.('userData');
  if (!userData) throw new Error('self_update_qualification_user_data_missing');
  const continuity = await loadSelfUpdateSessionContinuity(userData);
  if (continuity) {
    return {
      state: 'PENDING_CONTINUITY',
      target_version: version,
      pending_tab_count: Array.isArray(continuity.tabs) ? continuity.tabs.length : null,
      authority_effect: false,
    };
  }
  const qualified = await qualifyUpdatedSuccessor(app, {
    primary_instance: true,
    persistent_profile: true,
    session_continuity_cleared: true,
    process_uptime_ms: age,
  });
  return { state: 'QUALIFIED', transaction: qualified, authority_effect: false };
}

export async function qualifyUpdatedSuccessorWhenHealthy({
  app,
  timeoutMs = 30_000,
  pollMs = 1000,
  minUptimeMs = 3000,
  uptimeMs = () => Math.round(process.uptime() * 1000),
} = {}) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30_000);
  let last = null;
  while (Date.now() <= deadline) {
    last = await probeUpdatedSuccessorQualification({ app, uptimeMs, minUptimeMs });
    if (last.state === 'QUALIFIED' || last.state === 'NOT_PENDING') return last;
    await sleep(Math.max(100, Number(pollMs) || 1000));
  }
  return { ...(last || {}), state: 'QUALIFICATION_PENDING_TIMEOUT', authority_effect: false };
}
