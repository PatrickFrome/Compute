import {
  planDevOSSessionFocus,
  planDevOSSurfaceFocus,
} from './metaengine-devos-session-focus.mjs';

export const METAENGINE_DEVOS_PRESENTATION_ACTIVATION_SCHEMA = 'metaengine.devos.presentation-activation.v1';

function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    renderer_selection_authority: false,
    renderer_routing_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function invalidActivation(reason, intent = 'UNKNOWN', plan = null) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_PRESENTATION_ACTIVATION_SCHEMA,
    valid: false,
    reason: String(reason || 'PRESENTATION_INTENT_INVALID').slice(0, 200),
    intent,
    requested_session_id: plan?.requested_session_id || null,
    requested_surface_id: plan?.requested_surface_id || null,
    focus_session_id: null,
    focus_surface_id: null,
    target_tab_id: null,
    browser_activation_required: false,
    surface_selection_required: false,
    session_only: false,
    presentation_focus_mutation_allowed: false,
    exact_browser_target_required: true,
    explicit_user_intent_required: true,
    browser_selection_is_session_focus_authority: false,
    plan,
    ...zeroAuthorityContract(),
  });
}

function activationFromPlan(intent, plan) {
  if (!plan?.valid) return invalidActivation(plan?.reason || 'PRESENTATION_PLAN_INVALID', intent, plan || null);
  const isSurface = intent === 'SURFACE';
  const targetTabId = plan.target_tab_id == null ? null : String(plan.target_tab_id);
  return Object.freeze({
    schema: METAENGINE_DEVOS_PRESENTATION_ACTIVATION_SCHEMA,
    valid: true,
    reason: String(plan.reason || 'PRESENTATION_INTENT_ADMITTED').slice(0, 200),
    intent,
    requested_session_id: plan.requested_session_id || null,
    requested_surface_id: plan.requested_surface_id || null,
    focus_session_id: plan.target_session_id || null,
    // Selecting a Session does not silently convert an inferred/admissible Browser
    // target into explicit Surface focus. Surface focus is only created by an
    // explicit Surface intent.
    focus_surface_id: isSurface ? (plan.target_surface_id || null) : null,
    target_tab_id: targetTabId,
    browser_activation_required: Boolean(targetTabId && plan.shell_navigation_required === true),
    surface_selection_required: plan.surface_selection_required === true,
    session_only: plan.session_only === true,
    presentation_focus_mutation_allowed: true,
    exact_browser_target_required: true,
    explicit_user_intent_required: true,
    browser_selection_is_session_focus_authority: false,
    plan,
    ...zeroAuthorityContract(),
  });
}

export function planDevOSPresentationActivation(devos, request = {}) {
  const intent = String(request?.intent || '').trim().toUpperCase();
  if (intent === 'SESSION') {
    return activationFromPlan('SESSION', planDevOSSessionFocus(devos, {
      session_id: request?.session_id,
    }));
  }
  if (intent === 'SURFACE') {
    return activationFromPlan('SURFACE', planDevOSSurfaceFocus(devos, {
      session_id: request?.session_id,
      surface_id: request?.surface_id,
    }));
  }
  return invalidActivation('PRESENTATION_INTENT_UNSUPPORTED', intent || 'UNKNOWN');
}
