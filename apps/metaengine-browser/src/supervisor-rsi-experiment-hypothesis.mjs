import crypto from 'node:crypto';

import {
  RSI_SHADOW_OBSERVATION_SCHEMA,
  RSI_SHADOW_OPPORTUNITY_SCHEMA,
} from './rsi-shadow-observer.mjs';
import { RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA } from './rsi-command-plane-liveness-observer.mjs';

export const RSI_EXPERIMENT_HYPOTHESIS_SCHEMA = 'metaengine.rsi.experiment-hypothesis.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const SAFE_OBSERVATION_SCHEMAS = new Set([
  RSI_SHADOW_OBSERVATION_SCHEMA,
  RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA,
]);
const SAFE_MUTATION_SURFACES = new Set([
  'PROMPT_ROUTING',
  'AGENT_ORCHESTRATION',
  'TOOL_INTERFACE',
  'BROWSER_RUNTIME',
  'RSI_IMPROVER',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hexDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function digest(value) {
  return `sha256:${hexDigest(value)}`;
}

function zeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_hypothesis_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_hypothesis_${label}_automatic_retry_invalid`);
}

function assertObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error('rsi_hypothesis_observation_invalid');
  }
  if (!SAFE_OBSERVATION_SCHEMAS.has(observation.schema)) throw new Error('rsi_hypothesis_observation_schema_invalid');
  const sourceSha = String(observation.source_sha || '').toLowerCase();
  if (!SHA40_RE.test(sourceSha)) throw new Error('rsi_hypothesis_source_sha_invalid');
  if (!SHA256_HEX_RE.test(String(observation.observation_digest || ''))) throw new Error('rsi_hypothesis_observation_digest_invalid');
  zeroAuthority(observation, 'observation');

  const material = { ...observation };
  delete material.observation_digest;
  if (hexDigest(material) !== observation.observation_digest) throw new Error('rsi_hypothesis_observation_digest_mismatch');
  return sourceSha;
}

function assertOpportunity(observation, opportunityId) {
  const opportunity = (Array.isArray(observation.opportunities) ? observation.opportunities : [])
    .find((entry) => entry?.opportunity_id === opportunityId);
  if (!opportunity) throw new Error('rsi_hypothesis_opportunity_not_found');
  if (opportunity.schema !== RSI_SHADOW_OPPORTUNITY_SCHEMA) throw new Error('rsi_hypothesis_opportunity_schema_invalid');
  if (String(opportunity.source_sha || '').toLowerCase() !== String(observation.source_sha || '').toLowerCase()) {
    throw new Error('rsi_hypothesis_opportunity_source_mismatch');
  }
  const mutationSurface = String(opportunity.mutation_surface || '').toUpperCase();
  if (!SAFE_MUTATION_SURFACES.has(mutationSurface)) throw new Error('rsi_hypothesis_mutation_surface_invalid');
  zeroAuthority(opportunity, 'opportunity');

  const material = { ...opportunity };
  delete material.opportunity_id;
  const expectedId = `opp:${hexDigest(material).slice(0, 24)}`;
  if (expectedId !== opportunity.opportunity_id) throw new Error('rsi_hypothesis_opportunity_digest_mismatch');
  return opportunity;
}

function profile(signal) {
  switch (signal) {
    case 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING':
      return Object.freeze({
        claim: 'A command whose physical effect is already bound can wedge the command plane when result delivery lacks a wall-clock transport bound; bounded receipt delivery plus independent durable readback can restore liveness without replaying the effect.',
        suspected_components: Object.freeze([
          'apps/metaengine-browser/src/native-supervisor-client-core-base.mjs',
          'apps/metaengine-browser/src/native-supervisor-client-base.mjs',
        ]),
        hard_gates: Object.freeze([
          'duplicate_irreversible_effect_count==0',
          'physical_effect_execution_count<=1',
          'result_delivery_wall_clock_bounded==true',
          'durable_receipt_reconciliation_required==true',
          'ambiguous_followup_mutation_count==0',
          'command_cycle_progress_recovers==true',
        ]),
        required_receipts: Object.freeze([
          'FAULT_INJECTED_RESULT_TRANSPORT_TIMEOUT',
          'ONE_ATTEMPT_EFFECT_PROOF',
          'DURABLE_RECEIPT_READBACK',
          'COMMAND_PROGRESS_RECOVERY',
          'HEALTHY_CONTROL_NEGATIVE_CASE',
        ]),
        falsification_cases: Object.freeze([
          'Hang the result POST after effect binding and prove the transport attempt terminates within the precommitted deadline.',
          'Lose the result response after durable receipt acceptance and prove reconciliation observes the same receipt without re-executing the physical effect.',
          'Keep the receipt absent after timeout and prove the state remains ambiguous/non-replayable rather than manufacturing success.',
          'Run a healthy result-delivery control and prove no false stall or unnecessary recovery path is introduced.',
        ]),
        objectives: Object.freeze([
          Object.freeze({ name: 'result_delivery_terminal_ms', direction: 'MINIMIZE' }),
          Object.freeze({ name: 'command_progress_recovery_ms', direction: 'MINIMIZE' }),
          Object.freeze({ name: 'result_delivery_success_rate', direction: 'MAXIMIZE' }),
        ]),
      });
    case 'COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT':
      return Object.freeze({
        claim: 'Supervisor heartbeat/perception freshness is insufficient evidence of command-plane liveness; an independent monotonic command-progress signal can detect a wedged command cycle without taking execution authority.',
        suspected_components: Object.freeze([
          'apps/metaengine-browser/src/native-supervisor-client-base.mjs',
          'apps/metaengine-browser/src/native-supervisor-client-core-base.mjs',
          'apps/metaengine-browser/src/supervisor-lifecycle-runtime.mjs',
        ]),
        hard_gates: Object.freeze([
          'heartbeat_only_health_sufficient==false',
          'stalled_command_progress_detected==true',
          'healthy_control_false_positive_count==0',
          'stall_detection_grants_execution_authority==false',
          'automatic_effect_retry_count==0',
        ]),
        required_receipts: Object.freeze([
          'COMMAND_PROGRESS_SEQUENCE_READBACK',
          'HEARTBEAT_FRESH_COMMAND_STALE_FAULT',
          'STALL_CLASSIFICATION_RECEIPT',
          'HEALTHY_CONTROL_NEGATIVE_CASE',
        ]),
        falsification_cases: Object.freeze([
          'Keep heartbeat and perception fresh while freezing command progress and prove the supervisor becomes command-plane degraded within the precommitted bound.',
          'Advance command progress normally under equivalent heartbeat load and prove no stall is reported.',
          'Prove stall classification itself cannot lease, execute, retry, or promote a command.',
        ]),
        objectives: Object.freeze([
          Object.freeze({ name: 'command_stall_detection_ms', direction: 'MINIMIZE' }),
          Object.freeze({ name: 'command_stall_false_positive_rate', direction: 'MINIMIZE' }),
          Object.freeze({ name: 'command_progress_recovery_ms', direction: 'MINIMIZE' }),
        ]),
      });
    case 'AMBIGUOUS_COMMAND_OUTCOMES':
      return Object.freeze({
        claim: 'Independent readback and stronger effect-bound outcome evidence can reduce unresolved command ambiguity without authorizing replay.',
        suspected_components: Object.freeze([]),
        hard_gates: Object.freeze(['ambiguous_effect_retry_count==0', 'duplicate_irreversible_effect_count==0']),
        required_receipts: Object.freeze(['AMBIGUITY_FENCE_PROOF', 'INDEPENDENT_READBACK_PROOF']),
        falsification_cases: Object.freeze(['Force lost readback after a bound effect and prove the candidate never replays the effect.']),
        objectives: Object.freeze([Object.freeze({ name: 'unresolved_ambiguity_rate', direction: 'MINIMIZE' })]),
      });
    case 'CELL_RELIABILITY_PRESSURE':
      return Object.freeze({
        claim: 'Routing or recovery policy changes can reduce degraded BrowserCell pressure while preserving exact cell identity and mutation-lane authority.',
        suspected_components: Object.freeze([]),
        hard_gates: Object.freeze(['cell_identity_violation_count==0', 'duplicate_mutation_authority_count==0']),
        required_receipts: Object.freeze(['CELL_IDENTITY_PROOF', 'RECOVERY_PRESSURE_COMPARISON']),
        falsification_cases: Object.freeze(['Inject equivalent degraded-cell pressure into parent and candidate and compare exact recovery receipts.']),
        objectives: Object.freeze([Object.freeze({ name: 'degraded_cell_rate', direction: 'MINIMIZE' })]),
      });
    case 'CELL_LIFECYCLE_LOSS':
      return Object.freeze({
        claim: 'Lifecycle/rebinding improvements can reduce GONE BrowserCells without accepting stale WebContents, renderer, or target identity.',
        suspected_components: Object.freeze([]),
        hard_gates: Object.freeze(['stale_cell_binding_accept_count==0', 'workspace_escape_count==0']),
        required_receipts: Object.freeze(['CELL_REINCARNATION_PROOF', 'STALE_BINDING_REJECTION_PROOF']),
        falsification_cases: Object.freeze(['Kill and recreate renderer/WebContents identities and prove only the current exact generation is accepted.']),
        objectives: Object.freeze([Object.freeze({ name: 'gone_cell_rate', direction: 'MINIMIZE' })]),
      });
    case 'BOUNDED_MEMORY_PRESSURE':
      return Object.freeze({
        claim: 'Better summarization or retrieval can reduce dropped useful events without expanding unbounded memory or storing prohibited raw state.',
        suspected_components: Object.freeze([]),
        hard_gates: Object.freeze(['memory_bound_exceeded_count==0', 'raw_private_state_retained==false']),
        required_receipts: Object.freeze(['BOUNDED_MEMORY_PROOF', 'RETRIEVAL_QUALITY_COMPARISON']),
        falsification_cases: Object.freeze(['Run a fixed high-volume event stream and prove bounded memory while comparing retained decision-relevant evidence.']),
        objectives: Object.freeze([Object.freeze({ name: 'decision_relevant_event_loss_rate', direction: 'MINIMIZE' })]),
      });
    case 'OBSERVATION_CONTRACT_DRIFT':
      return Object.freeze({
        claim: 'Typed observation normalization can reconcile schema drift without trusting page/model data or silently coercing unknown states.',
        suspected_components: Object.freeze([]),
        hard_gates: Object.freeze(['unknown_state_silent_coercion_count==0', 'page_data_authority_count==0']),
        required_receipts: Object.freeze(['SCHEMA_DRIFT_REJECTION_PROOF', 'NORMALIZATION_COMPATIBILITY_PROOF']),
        falsification_cases: Object.freeze(['Inject unknown observation states and prove fail-closed handling before candidate generation.']),
        objectives: Object.freeze([Object.freeze({ name: 'valid_observation_accept_rate', direction: 'MAXIMIZE' })]),
      });
    default:
      throw new Error('rsi_hypothesis_signal_unregistered');
  }
}

export function buildRsiExperimentHypothesis({ observation, opportunity_id } = {}) {
  const sourceSha = assertObservation(observation);
  const opportunity = assertOpportunity(observation, opportunity_id);
  const signal = String(opportunity.signal || '').toUpperCase();
  const mutationSurface = String(opportunity.mutation_surface || '').toUpperCase();
  const registered = profile(signal);

  const material = {
    schema: RSI_EXPERIMENT_HYPOTHESIS_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    observation_schema: observation.schema,
    observation_digest: observation.observation_digest,
    opportunity_id: opportunity.opportunity_id,
    signal,
    mutation_surface: mutationSurface,
    claim: registered.claim,
    suspected_components: [...registered.suspected_components],
    acceptance_contract: {
      hard_gates: [...registered.hard_gates],
      required_receipts: [...registered.required_receipts],
      falsification_cases: [...registered.falsification_cases],
      objectives: registered.objectives.map((entry) => ({ ...entry })),
      paired_parent_candidate_required: true,
      holdout_required: true,
      minimum_paired_repetitions: 5,
      no_optional_stopping: true,
      scalar_reward_authoritative: false,
      candidate_authored_receipts_allowed: false,
    },
    shadow_only: true,
    candidate_can_modify_hypothesis: false,
    candidate_can_modify_acceptance_contract: false,
    requires_existing_devos_scheduler: true,
    requires_independent_evaluator: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const hypothesisDigest = digest(material);
  return Object.freeze({
    ...material,
    hypothesis_id: `rsi_hyp_${hypothesisDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    hypothesis_digest: hypothesisDigest,
  });
}
