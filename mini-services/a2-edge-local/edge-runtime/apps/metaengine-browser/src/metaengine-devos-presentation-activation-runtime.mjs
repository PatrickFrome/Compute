import { planDevOSPresentationActivation } from './metaengine-devos-presentation-activation.mjs';

export const METAENGINE_DEVOS_PRESENTATION_ACTIVATION_RESULT_SCHEMA = 'metaengine.devos.presentation-activation-result.v1';

function zeroAuthorityContract() {
  return Object.freeze({
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

function snapshotOrNull(presentationFocus) {
  try {
    return typeof presentationFocus?.snapshot === 'function' ? presentationFocus.snapshot() : null;
  } catch {
    return null;
  }
}

function result({ activation, applied = false, reason = null, browserPerformed = false, presentationFocus = null }) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_PRESENTATION_ACTIVATION_RESULT_SCHEMA,
    valid: activation?.valid === true,
    applied: applied === true,
    reason: String(reason || activation?.reason || 'PRESENTATION_ACTIVATION_NOT_APPLIED').slice(0, 240),
    intent: activation?.intent || 'UNKNOWN',
    activation: activation || null,
    presentation_focus: presentationFocus,
    browser_activation_requested: activation?.browser_activation_required === true,
    browser_activation_performed: browserPerformed === true,
    target_tab_id: activation?.target_tab_id || null,
    surface_selection_required: activation?.surface_selection_required === true,
    session_only: activation?.session_only === true,
    explicit_user_intent_required: true,
    browser_selection_is_session_focus_authority: false,
    ...zeroAuthorityContract(),
  });
}

function boundedError(error, fallback) {
  const message = String(error?.message || error || fallback || 'unknown').trim();
  return message.replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 160) || String(fallback || 'unknown');
}

export function applyDevOSPresentationActivation({
  devos,
  request,
  presentationFocus,
  selectBrowserTab,
} = {}) {
  const activation = planDevOSPresentationActivation(devos, request || {});
  const before = snapshotOrNull(presentationFocus);
  if (!activation.valid || activation.presentation_focus_mutation_allowed !== true) {
    return result({ activation, reason: activation.reason, presentationFocus: before });
  }

  const focusMethod = activation.intent === 'SURFACE' ? presentationFocus?.selectSurface : presentationFocus?.selectSession;
  if (typeof focusMethod !== 'function') {
    return result({ activation, reason: 'PRESENTATION_FOCUS_MUTATOR_UNAVAILABLE', presentationFocus: before });
  }
  if (activation.browser_activation_required && typeof selectBrowserTab !== 'function') {
    return result({ activation, reason: 'BROWSER_ACTIVATOR_UNAVAILABLE', presentationFocus: before });
  }

  let browserPerformed = false;
  if (activation.browser_activation_required) {
    try {
      selectBrowserTab(activation.target_tab_id);
      browserPerformed = true;
    } catch (error) {
      return result({
        activation,
        reason: `BROWSER_ACTIVATION_FAILED:${boundedError(error, 'unknown')}`,
        browserPerformed: false,
        presentationFocus: before,
      });
    }
  }

  try {
    const next = activation.intent === 'SURFACE'
      ? presentationFocus.selectSurface(activation.focus_session_id, activation.focus_surface_id)
      : presentationFocus.selectSession(activation.focus_session_id);
    return result({
      activation,
      applied: true,
      reason: activation.reason,
      browserPerformed,
      presentationFocus: next,
    });
  } catch (error) {
    return result({
      activation,
      reason: `PRESENTATION_FOCUS_MUTATION_FAILED:${boundedError(error, 'unknown')}`,
      browserPerformed,
      presentationFocus: snapshotOrNull(presentationFocus) || before,
    });
  }
}
