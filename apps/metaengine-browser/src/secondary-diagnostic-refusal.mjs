// A diagnostic probe may report primary-owned state only after its own
// Electron process acquires the singleton. A secondary must not exit 0:
// that can be mistaken for successful qualification of a new installer.
export const SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA = 'metaengine.browser.secondary-diagnostic-refusal.v1';
export const SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE = 6;

const DIAGNOSTIC_FLAGS = Object.freeze([
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-client-goal-journal-probe',
  '--metaengine-single-instance-probe',
]);

export function secondaryDiagnosticRefusal({ argv, version } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const requested = DIAGNOSTIC_FLAGS.filter((flag) => args.includes(flag));
  if (requested.length !== 1 || typeof version !== 'string' || version.length < 1 || version.length > 120) {
    throw new Error('secondary_diagnostic_request_invalid');
  }
  return Object.freeze({
    schema: SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA,
    state: 'PRIMARY_INSTANCE_REQUIRED',
    requested_probe: requested[0],
    process_version: version,
    primary_instance: false,
    original_primary_terminated: false,
    browser_runtime_started: false,
    network_started: false,
    owner_bootstrap_started: false,
    submit_effect_attempted: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
