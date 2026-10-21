// Diagnostic files survive an outer process deadline. They never grant
// admission, replace physical readback, or serialize private profile contents.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A 600s parent killed the qualifier before its existing 420s startup + 190s
// grace could finish, before counting probes, 72 activations and shutdown.
// These are outer ceilings only; all physical/latency assertions remain intact.
export const INSTALLED_LAUNCH_QUALIFIER_TIMEOUT_MS = 1_200_000;
export const INSTALLED_LAUNCH_FIXTURE_TIMEOUT_MS = 2_700_000;
export const INSTALLED_LAUNCH_PHASES = Object.freeze([
  'VERIFY_PACKAGE', 'OFFLINE_SUCCESSOR', 'FIRST_RUN', 'OWNED_UI_HOST',
  'OWNER_PREPARE', 'OWNER_STARTUP', 'OWNER_RUNTIME_READBACK', 'OWNER_CDP_READBACK',
  'OWNER_ACTIVATION_WAVE', 'OWNER_STARTUP_GRACE', 'OWNER_POST_GRACE',
  'OWNER_SHUTDOWN', 'VERIFY_FINAL_BYTES', 'COMPLETE',
]);
const states = new Set(['BOOT_STARTED', 'RUNTIME_IMPORT_OK', 'RUNTIME_IMPORT_FAILED',
  'RUNTIME_IMPORT_FAILED_HOST_ALIVE', 'APP_READY', 'PRIMARY_WINDOW_STABLE',
  'PRIMARY_WINDOW_STABLE_TIMEOUT', 'PRIMARY_WINDOW_OBSERVER_FAILED',
  'RUNTIME_FAILURE_PRESENTED', 'RUNTIME_FAILURE_PRESENTATION_FAILED',
  'BROWSER_BOOTSTRAP_BARRIER_RELEASED', 'HOST_RESILIENCE_BOOTSTRAPPED']);
const reasons = new Set(['installed_launch_normal_runtime_import_failed',
  'installed_launch_normal_primary_window_journal_failed',
  'installed_launch_owner_shutdown_signal_timeout', 'installed_launch_owner_shutdown_cleanup_timeout',
  'installed_launch_process_ended_before_readback', 'installed_launch_host_ready_timeout',
  'installed_launch_host_cleanup_unconfirmed', 'installed_launch_normal_primary_cdp_surface_unproven',
  'installed_launch_normal_primary_os_window_unproven', 'installed_launch_normal_ui_degraded',
  'installed_launch_second_instance_timeout', 'installed_launch_second_instance_exit_invalid',
  'installed_launch_normal_ui_contract_missing', 'installed_launch_owner_runtime_shutdown_status_unconfirmed',
  'owner_backed_activation_wave_activation_latency_budget_exceeded',
  'owner_backed_activation_wave_burst_budget_exceeded',
  'owner_backed_activation_wave_durable_activation_missing']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validPid = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const fail = () => { throw new Error('installed_launch_progress_arguments_invalid'); };

export function installedLaunchFailureCode(error) {
  const message = error?.message;
  if (reasons.has(message)) return message;
  if (typeof message === 'string' && message.startsWith('installed_launch_readback_timeout_')) return 'installed_launch_readback_timeout';
  return 'installed_launch_contract_unproven';
}

export function installedLaunchProgressSnapshot({ identity, phase, sequence, pid = null,
  journal = null, error = null, nowMs = Date.now() } = {}) {
  if (!/^[a-f0-9]{40}$/.test(identity?.source_head || '')
    || !/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(identity?.package_version || '')
    || !INSTALLED_LAUNCH_PHASES.includes(phase) || !Number.isSafeInteger(sequence) || sequence < 1
    || (pid !== null && !validPid(pid)) || !Number.isFinite(nowMs)) fail();
  let binding = journal === null ? 'UNOBSERVED' : 'MALFORMED', current = [];
  if (journal?.schema === 'metaengine.browser.startup-journal.v1' && journal.version === 1
    && journal.authority_effect === false && uuid.test(journal.current_boot_id || '')
    && Array.isArray(journal.events) && journal.events.length <= 128) {
    if (journal.current_pid !== pid) binding = 'OTHER_PID';
    else if (journal.current_version !== identity.package_version) binding = 'OTHER_VERSION';
    else {
      binding = 'BOUND';
      current = journal.events.filter(row => row?.boot_id === journal.current_boot_id
        && row.pid === pid && row.version === identity.package_version && states.has(row.state)
        && Number.isSafeInteger(row.sequence) && row.sequence > 0)
        .map(row => ({ state: row.state, sequence: row.sequence }));
    }
  }
  return Object.freeze({ schema: 'metaengine.browser.installed-launch-progress.v1',
    source_head: identity.source_head, package_version: identity.package_version,
    phase, sequence, recorded_at: new Date(nowMs).toISOString(), primary_pid: pid,
    state: error ? 'FAILED' : phase === 'COMPLETE' ? 'COMPLETE' : 'IN_PROGRESS',
    failure_code: error ? installedLaunchFailureCode(error) : null,
    startup_journal_binding: binding, startup_states: current,
    diagnostic_only: true, qualification_proven: false, automatic_retry_allowed: false,
    production_ready: false, promotion_authorized: false, authority_effect: false });
}

export function createInstalledLaunchProgressReporter({ directory, identity }) {
  if (!path.isAbsolute(directory || '')) fail();
  let phase = 'VERIFY_PACKAGE', sequence = 0, firstFailure = false;
  const persist = async (file, snapshot) => {
    const temporary = path.join(directory, file + '.' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, path.join(directory, file));
      return snapshot;
    } catch {
      // Diagnostics must never skip physical cleanup or replace its failure.
      await fs.unlink(temporary).catch(() => {});
      return null;
    }
  };
  return Object.freeze({
    async phase(next, context = {}) {
      if (!INSTALLED_LAUNCH_PHASES.includes(next)) fail();
      phase = next;
      return persist('installed-launch-progress.json', installedLaunchProgressSnapshot({
        identity, phase, sequence: ++sequence, pid: context.pid, journal: context.journal }));
    },
    async failure(error, context = {}) {
      if (firstFailure) return;
      firstFailure = true;
      return persist('installed-launch-failure.json', installedLaunchProgressSnapshot({
        identity, phase, sequence: ++sequence, pid: context.pid, journal: context.journal, error }));
    },
  });
}
