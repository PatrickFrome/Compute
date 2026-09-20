// RSI operator console — the operator-facing control surface of the RSI runtime.
//
// Purpose: the RSI runtime (R9–R14) is shadow-verified with zero authority, and
// until now the only operator surface was aggregate counters inside the
// supervisor heartbeat. This module gives the Quantum Console a bounded,
// testable command surface so the operator can act as the external trainer of
// the system: watch the outcome river flow (browser outcome ingest + command
// attribution + experience graph), inspect shadow candidates and the verified
// skill library, and nominate a shadow-qualified candidate for promotion.
//
// Invariants:
// - Read-only except the two EXPLICIT operator actions that already exist on
//   the runtime: nominatePromotion (ledger append, requires
//   external_promotion_gate, grants nothing) and the anytime library
//   admission attempt snapshot (prepare/execute stay on the runtime service
//   and are NOT exposed here — they require external owner identity digests).
// - No new authority: every projection repeats the runtime's zero-authority
//   fences. A missing runtime fails closed with rsi_operator_console_* errors.
// - Bounded output: candidate lists and experience cases are capped by the
//   runtime accessors themselves.

export const RSI_OPERATOR_CONSOLE_SCHEMA = 'metaengine.rsi.operator-console.v1';
export const RSI_OPERATOR_CONSOLE_ACTIONS = Object.freeze([
  'RSI_STATUS',
  'RSI_CANDIDATES',
  'RSI_EXPERIENCE',
  'RSI_SKILLS',
  'RSI_NOMINATE_PROMOTION',
  'RSI_ADMISSION_ATTEMPT',
]);

function boundedNonEmptyString(value, label, max = 256) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > max) throw new Error(`rsi_operator_console_${label}_invalid`);
  return normalized;
}

function unavailableRuntimeProjection(reason) {
  return Object.freeze({
    schema: RSI_OPERATOR_CONSOLE_SCHEMA,
    runtime_state: 'UNAVAILABLE',
    reason,
    shadow_only: true,
    candidate_effect_executor_exposed: false,
    physical_effect_replay_allowed: false,
    direct_promotion_enabled: false,
    direct_self_update_enabled: false,
    scheduler_authority: false,
    execution_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    authority_effect: false,
  });
}

export function createRsiOperatorConsole({ ensureRuntime } = {}) {
  if (typeof ensureRuntime !== 'function') throw new Error('rsi_operator_console_runtime_provider_required');

  async function readyRuntime() {
    const runtime = await ensureRuntime();
    if (!runtime || typeof runtime !== 'object') throw new Error('rsi_operator_console_runtime_unavailable');
    const state = runtime.snapshot?.()?.state;
    if (state !== 'READY') throw new Error('rsi_operator_console_runtime_not_ready');
    return runtime;
  }

  // Bounded steady-state projection for the shell snapshot. Keeps the full
  // runtime snapshot out of the per-render path; lists are pulled on demand
  // via RSI_CANDIDATES / RSI_EXPERIENCE.
  function projection(runtime) {
    const snapshot = runtime.snapshot();
    return Object.freeze({
      schema: RSI_OPERATOR_CONSOLE_SCHEMA,
      runtime_state: snapshot.state,
      mode: snapshot.mode,
      source_sha: snapshot.source_sha,
      trust_root_count: snapshot.trust_root_count,
      trust_root_set_digest: snapshot.trust_root_set_digest,
      candidate_count: snapshot.candidate_count,
      candidate_state_counts: snapshot.candidate_state_counts,
      promotion_nomination_count: snapshot.promotion_nomination_count,
      last_observation_at: snapshot.last_observation_at,
      observation_persistence_mode: snapshot.observation_persistence_mode,
      skill_revision_reliability: snapshot.skill_revision_reliability,
      browser_outcome_ingest: snapshot.browser_outcome_ingest,
      command_attribution: snapshot.command_attribution,
      runtime_experience_store: snapshot.runtime_experience_store,
      runtime_skill_router: snapshot.runtime_skill_router,
      experience_gate: snapshot.experience_gate,
      shadow_only: snapshot.shadow_only,
      candidate_effect_executor_exposed: snapshot.candidate_effect_executor_exposed,
      physical_effect_replay_allowed: snapshot.physical_effect_replay_allowed,
      direct_promotion_enabled: snapshot.direct_promotion_enabled,
      direct_self_update_enabled: snapshot.direct_self_update_enabled,
      scheduler_authority: false,
      execution_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      authority_effect: false,
    });
  }

  async function currentProjection() {
    try {
      const runtime = await readyRuntime();
      return projection(runtime);
    } catch (error) {
      return unavailableRuntimeProjection(String(error?.message || error || 'RUNTIME_UNAVAILABLE').slice(0, 240));
    }
  }

  async function execute(command, payload = {}) {
    const action = boundedNonEmptyString(command, 'command', 64).toUpperCase();
    if (!RSI_OPERATOR_CONSOLE_ACTIONS.includes(action)) throw new Error('rsi_operator_console_action_invalid');

    if (action === 'RSI_STATUS') {
      const runtime = await readyRuntime();
      return { ...projection(runtime), operator_actions: [...RSI_OPERATOR_CONSOLE_ACTIONS] };
    }

    if (action === 'RSI_CANDIDATES') {
      const runtime = await readyRuntime();
      const candidates = runtime.shadowCandidates();
      return Object.freeze({
        schema: 'metaengine.rsi.operator-console.candidates.v1',
        candidate_count: candidates.length,
        candidates,
        shadow_only: true,
        promotion_authority: false,
        authority_effect: false,
      });
    }

    if (action === 'RSI_EXPERIENCE') {
      const runtime = await readyRuntime();
      const graph = runtime.experienceGraph();
      return Object.freeze({
        ...graph,
        schema: 'metaengine.rsi.operator-console.experience.v1',
        candidate_can_write_graph: false,
        authority_effect: false,
      });
    }

    if (action === 'RSI_SKILLS') {
      const runtime = await readyRuntime();
      const snapshot = runtime.snapshot();
      return Object.freeze({
        schema: 'metaengine.rsi.operator-console.skills.v1',
        runtime_skill_lifecycle: snapshot.runtime_skill_lifecycle,
        runtime_skill_router: snapshot.runtime_skill_router,
        runtime_skill_curation: snapshot.runtime_skill_curation,
        skill_revision_frontier: snapshot.skill_revision_frontier,
        skill_revision_integrity: snapshot.skill_revision_integrity,
        skill_revision_reliability_ledger: snapshot.skill_revision_reliability_ledger,
        revision_scope_admission: snapshot.revision_scope_admission,
        verified_library_snapshot: runtime.verifiedLibrarySnapshot() || null,
        direct_library_replacement_allowed: false,
        authority_effect: false,
      });
    }

    if (action === 'RSI_NOMINATE_PROMOTION') {
      const runtime = await readyRuntime();
      const candidateId = boundedNonEmptyString(payload?.candidate_id, 'candidate_id');
      const qualificationDigest = boundedNonEmptyString(payload?.qualification_digest, 'qualification_digest');
      const nomination = await runtime.nominatePromotion({
        candidate_id: candidateId,
        qualification_digest: qualificationDigest,
      });
      return Object.freeze({
        schema: 'metaengine.rsi.operator-console.nominate-promotion.v1',
        nomination,
        requires_external_promotion_gate: true,
        direct_promotion_enabled: false,
        authority_effect: false,
      });
    }

    // RSI_ADMISSION_ATTEMPT — read-only snapshot of an anytime library
    // admission attempt (the external confirmation gate surface). Preparing or
    // executing an attempt requires the external library owner identity and is
    // deliberately NOT routed through the console.
    const runtime = await readyRuntime();
    const attemptId = boundedNonEmptyString(payload?.attempt_id, 'attempt_id');
    const attempt = runtime.anytimeLibraryAdmissionAttemptSnapshot(attemptId);
    if (!attempt) throw new Error('rsi_operator_console_admission_attempt_not_found');
    return Object.freeze({
      schema: 'metaengine.rsi.operator-console.admission-attempt.v1',
      attempt,
      prepare_or_execute_exposed: false,
      authority_effect: false,
    });
  }

  return Object.freeze({
    schema: RSI_OPERATOR_CONSOLE_SCHEMA,
    actions: [...RSI_OPERATOR_CONSOLE_ACTIONS],
    projection: currentProjection,
    execute,
    authority_effect: false,
  });
}
