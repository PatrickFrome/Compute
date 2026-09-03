const REQUIRED_FEATURES = Object.freeze([
  'signed_device_auth_v1',
  'typed_commands_only_v1',
  'devos_cycle_v1',
  'devos_ambiguity_reconcile_v2',
  'devos_transport_promotion_v1',
  'devos_scheduler_capacity_v1',
  'meta_orchestrator_superstep_v1',
  'meta_orchestrator_controller_lease_v1',
  'meta_atomic_frontier_v2',
  'post_lock_transport_revalidation_v1',
]);
const REQUIRED_RECOVERY_CLASSES = Object.freeze(['PRE_EFFECT_ABORTED', 'EFFECT_PROVEN']);
const CAPABILITY_SCHEMA = 'metaengine.native-browser-supervisor.capabilities.v1';
const HEALTH_SCHEMA = 'metaengine.native-browser-supervisor.health.v1';
const MIN_PROTOCOL_GENERATION = 2;

function zero(extra = {}) {
  return Object.freeze({
    schema: 'metaengine.devos.runtime-compatibility.v1',
    state: 'SERVER_RUNTIME_SKEW',
    reason: 'UNSPECIFIED',
    protocol_generation: 0,
    missing_features: Object.freeze([]),
    missing_recovery_classes: Object.freeze([]),
    devos_cycle_allowed: false,
    physical_dispatch_allowed: false,
    ambiguity_recovery_allowed: false,
    transport_promotion_allowed: false,
    meta_orchestrator_allowed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function invalid(reason) {
  return zero({ state: 'INVALID_SERVER_CAPABILITY', reason });
}

export function evaluateDevosRuntimeCompatibility(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) return invalid('HEALTH_INVALID');
  if (health.schema !== HEALTH_SCHEMA || health.ok !== true) return invalid('HEALTH_CONTRACT_INVALID');
  if (health.arbitrary_eval !== false || health.typed_commands_only !== true) return invalid('HEALTH_SAFETY_CONTRACT_INVALID');

  const capabilities = health.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return zero({
      state: 'LEGACY_SERVER_CAPABILITY_INCOMPLETE',
      reason: 'CAPABILITIES_MISSING',
    });
  }
  if (capabilities.schema !== CAPABILITY_SCHEMA) return invalid('CAPABILITY_SCHEMA_INVALID');
  if (capabilities.authority_effect !== false
      || capabilities.second_scheduler_loop !== false
      || capabilities.automatic_retry_allowed !== false
      || capabilities.arbitrary_eval !== false
      || capabilities.page_model_text_authority !== false) {
    return invalid('CAPABILITY_SAFETY_CONTRACT_INVALID');
  }

  const generation = Number(capabilities.protocol_generation || 0);
  if (!Number.isSafeInteger(generation) || generation < 1) return invalid('PROTOCOL_GENERATION_INVALID');
  const features = capabilities.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return invalid('FEATURE_MAP_INVALID');
  const recovery = Array.isArray(capabilities.ambiguity_recovery_classes)
    ? new Set(capabilities.ambiguity_recovery_classes.map((value) => String(value).toUpperCase()))
    : new Set();
  const missingFeatures = REQUIRED_FEATURES.filter((name) => features[name] !== true);
  const missingRecoveryClasses = REQUIRED_RECOVERY_CLASSES.filter((name) => !recovery.has(name));

  if (generation < MIN_PROTOCOL_GENERATION || missingFeatures.length || missingRecoveryClasses.length) {
    return zero({
      state: 'SERVER_RUNTIME_SKEW',
      reason: generation < MIN_PROTOCOL_GENERATION ? 'PROTOCOL_GENERATION_TOO_OLD' : (missingFeatures.length ? 'REQUIRED_FEATURE_MISSING' : 'RECOVERY_CLASS_MISSING'),
      protocol_generation: generation,
      missing_features: Object.freeze(missingFeatures),
      missing_recovery_classes: Object.freeze(missingRecoveryClasses),
    });
  }

  return zero({
    state: 'COMPATIBLE',
    reason: 'EXACT_REQUIRED_CAPABILITIES_PRESENT',
    protocol_generation: generation,
    missing_features: Object.freeze([]),
    missing_recovery_classes: Object.freeze([]),
    devos_cycle_allowed: true,
    physical_dispatch_allowed: true,
    ambiguity_recovery_allowed: true,
    transport_promotion_allowed: true,
    meta_orchestrator_allowed: true,
  });
}

export const DEVOS_REQUIRED_SERVER_FEATURES = REQUIRED_FEATURES;
export const DEVOS_REQUIRED_AMBIGUITY_RECOVERY_CLASSES = REQUIRED_RECOVERY_CLASSES;
