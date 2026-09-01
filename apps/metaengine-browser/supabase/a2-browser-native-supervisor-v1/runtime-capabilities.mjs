export const NATIVE_SUPERVISOR_RUNTIME_CAPABILITY_SCHEMA = 'metaengine.native-browser-supervisor.capabilities.v1';
export const NATIVE_SUPERVISOR_PROTOCOL_GENERATION = 2;

export const NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES = Object.freeze({
  schema: NATIVE_SUPERVISOR_RUNTIME_CAPABILITY_SCHEMA,
  protocol_generation: NATIVE_SUPERVISOR_PROTOCOL_GENERATION,
  features: Object.freeze({
    signed_device_auth_v1: true,
    typed_commands_only_v1: true,
    devos_cycle_v1: true,
    devos_ambiguity_reconcile_v2: true,
    devos_transport_promotion_v1: true,
    devos_scheduler_capacity_v1: true,
    meta_orchestrator_superstep_v1: true,
    meta_orchestrator_controller_lease_v1: true,
    meta_atomic_frontier_v2: true,
    post_lock_transport_revalidation_v1: true,
  }),
  ambiguity_recovery_classes: Object.freeze(['PRE_EFFECT_ABORTED', 'EFFECT_PROVEN']),
  scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
  second_scheduler_loop: false,
  automatic_retry_allowed: false,
  arbitrary_eval: false,
  page_model_text_authority: false,
  authority_effect: false,
});
