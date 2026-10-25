const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TRANSPORT = new Set(['health_timeout', 'health_connection_refused', 'health_network_failed']);
const FAILURE_CODES = new Set([
  ...TRANSPORT, 'health_http_failed', 'health_response_invalid', 'health_not_ready',
  'health_capability_unattested', 'health_capability_rpc_unavailable', 'health_capability_runtime_not_deployed',
  'health_capability_attestation_timeout', 'health_capability_source_mismatch', 'health_capability_db_read_failed', 'health_instance_mismatch',
  'postgres_identity_mismatch', 'postgres_cluster_identity_mismatch', 'postgres_data_directory_mismatch',
  'postgres_owned_pid_mismatch', 'postgres_incarnation_mismatch', 'postgres_identity_invalid', 'postgres_pid_file_invalid',
  'postgres_inspection_failed', 'postgres_process_verification_failed', 'postgres_inspection_timeout',
  'postgres_inspection_spawn_failed', 'postgres_inspection_query_failed', 'postgres_inspection_output_limit',
  'postgres_inspection_stderr_limit', 'postgres_inspection_auth_failed', 'postgres_inspection_permission_denied',
  'postgres_inspection_row_security_denied', 'postgres_inspection_connection_refused', 'postgres_inspection_server_unavailable',
  'postgres_inspection_query_timeout', 'postgres_inspection_database_missing',
]);
const fields = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => fields(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function finiteRuntimeRecoveryHealthFailure(value) {
  if (!exact(value, ['schema', 'code', 'component', 'consecutive_failures', 'http_status', 'authority_effect'])
    || value.schema !== 'metaengine.client-state.health-failure.v1' || !FAILURE_CODES.has(value.code)
    || !['api', 'edge', 'postgres'].includes(value.component)
    || value.code.startsWith('postgres_') !== (value.component === 'postgres')
    || value.code.startsWith('health_capability_') && value.component !== 'edge'
    || !Number.isSafeInteger(value.consecutive_failures) || value.consecutive_failures < 1 || value.consecutive_failures > 3
    || (value.code === 'health_http_failed') !== (value.http_status !== null)
    || value.http_status !== null && (!Number.isSafeInteger(value.http_status) || value.http_status < 100 || value.http_status > 599)
    || value.authority_effect !== false) return null;
  return Object.freeze({...value});
}

// An eligibility decision is read-only data. Only the separately protected
// main-owned transaction may cross a relaunch effect barrier.
export function evaluateRuntimeRecoveryEligibility(value) {
  const hold = reason => Object.freeze({schema: 'metaengine.browser.runtime-recovery-eligibility.v1',
    state: 'HOLD', reason, eligible: false, fresh_browser_required: true,
    automatic_retry_allowed: false, authority_effect: false});
  if (!fields(value) || value.schema !== 'metaengine.browser.runtime-host-generation.v1'
    || !UUID.test(value.launch_nonce || '') || !Number.isSafeInteger(value.host_pid) || value.host_pid < 1
    || !UUID.test(value.instance_id || '') || value.authority_effect !== false) return hold('GENERATION_UNBOUND');
  if (value.ever_ready !== true) return hold('INITIAL_BOOTSTRAP_UNPROVEN');
  if (value.stopping === true) return hold('DELIBERATE_SHUTDOWN');
  if (value.exited !== true || value.cleanup_confirmed !== true || value.terminal_rejected === true) return hold('OLD_CLEANUP_UNCONFIRMED');
  const terminal = value.terminal;
  if (!exact(terminal, ['schema','launch_nonce','host_pid','instance_id','state','children_stopped','ownership_released','reason','authority_effect'])
    || terminal.schema !== 'compute.runtime-host-terminal.v1' || terminal.launch_nonce !== value.launch_nonce
    || terminal.host_pid !== value.host_pid || terminal.instance_id !== value.instance_id
    || terminal.state !== 'STOPPED' || terminal.children_stopped !== true || terminal.ownership_released !== true
    || terminal.authority_effect !== false) return hold('OLD_TERMINAL_UNPROVEN');
  if (terminal.reason !== 'runtime_health_failed') return hold('TERMINAL_REASON_NOT_TRANSIENT');
  const witness = value.health_witness;
  const failure = finiteRuntimeRecoveryHealthFailure(witness?.failure);
  if (!fields(witness) || witness.schema !== 'metaengine.browser.runtime-recovery-health-witness.v1'
    || witness.host_pid !== value.host_pid || witness.instance_id !== value.instance_id || witness.launch_nonce !== value.launch_nonce
    || !HASH.test(witness.status_sha256 || '') || !HASH.test(witness.bundle_sha256 || '')
    || !Number.isFinite(Date.parse(witness.stopped_at)) || witness.authority_effect !== false || !failure) return hold('HEALTH_WITNESS_UNBOUND');
  if (!TRANSPORT.has(failure.code) || !['api', 'edge'].includes(failure.component)
    || failure.consecutive_failures !== 3 || failure.http_status !== null) return hold('HEALTH_REASON_NOT_TRANSIENT');
  return Object.freeze({schema: 'metaengine.browser.runtime-recovery-eligibility.v1', state: 'ELIGIBLE',
    reason: 'CONFIRMED_RUNTIME_TRANSPORT_FAILURE', eligible: true, fresh_browser_required: true,
    automatic_retry_allowed: false, authority_effect: false});
}
