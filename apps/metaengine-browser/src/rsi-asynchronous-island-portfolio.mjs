import crypto from 'node:crypto';

export const RSI_ISLAND_MEMBER_SCHEMA = 'metaengine.rsi.island-member.v1';
export const RSI_ISLAND_STATE_SCHEMA = 'metaengine.rsi.island-state.v1';
export const RSI_ISLAND_PORTFOLIO_SCHEMA = 'metaengine.rsi.island-portfolio.v1';
export const RSI_ISLAND_MIGRATION_PLAN_SCHEMA = 'metaengine.rsi.island-migration-plan.v1';
export const RSI_ISLAND_MIGRATION_RECEIPT_SCHEMA = 'metaengine.rsi.island-migration-receipt.v1';
export const RSI_ISLAND_WORK_PROPOSAL_SCHEMA = 'metaengine.rsi.island-work-proposal.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_ISLANDS = 32;
const MAX_MEMBERS_PER_ISLAND = 512;
const MAX_FEATURES = 16;
const MAX_MIGRANTS_PER_ISLAND = 8;
const MAX_WORK_PROPOSALS = 64;

const MEMBER_STATES = new Set(['PARETO_ELITE', 'STEPPING_STONE', 'NICHE_ELITE', 'ARCHIVE_ACTIVE']);
const ISLAND_HEALTH = new Set(['READY', 'DEGRADED', 'PAUSED']);
const MIGRATION_OUTCOMES = new Set(['TARGET_VALIDATED', 'TARGET_REJECTED', 'TARGET_EVIDENCE_INSUFFICIENT']);
const WORK_KINDS = new Set(['PROPOSE_EXPANSION', 'PROPOSE_EVALUATION']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_island_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_island_${label}_sha_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_island_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_island_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_island_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_island_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_island_${label}_invalid`);
  return out;
}

function boundedScore(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_island_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_island_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_island_${label}_automatic_retry_invalid`);
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalizeFeatures(value) {
  if (!plainObject(value)) throw new Error('rsi_island_features_invalid');
  const keys = Object.keys(value).sort();
  if (keys.length < 1 || keys.length > MAX_FEATURES) throw new Error('rsi_island_feature_count_invalid');
  const out = {};
  for (const key of keys) {
    const name = boundedToken(key, 'feature_name');
    const raw = Number(value[key]);
    if (!Number.isFinite(raw)) throw new Error('rsi_island_feature_value_invalid');
    out[name] = raw;
  }
  return Object.freeze(out);
}

function normalizeDescriptor(value) {
  if (!plainObject(value)) throw new Error('rsi_island_descriptor_invalid');
  return Object.freeze({
    mutation_surface: boundedToken(value.mutation_surface, 'mutation_surface'),
    model_family: boundedToken(value.model_family, 'model_family'),
    environment_family: boundedToken(value.environment_family, 'environment_family'),
    niche_id: boundedId(value.niche_id, 'niche_id'),
  });
}

function seededTie(seed, value) {
  return crypto.createHash('sha256').update(`${seed}:${value}`, 'utf8').digest('hex');
}

export function createRsiIslandMember({
  member_id,
  candidate_id,
  candidate_sha,
  source_archive_digest,
  evaluator_root_digest,
  state,
  quality_score,
  novelty_score,
  features,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_island_member_external_origin_required');
  const memberState = boundedToken(state, 'member_state');
  if (!MEMBER_STATES.has(memberState)) throw new Error('rsi_island_member_state_invalid');
  const core = {
    schema: RSI_ISLAND_MEMBER_SCHEMA,
    version: 1,
    member_id: boundedId(member_id, 'member_id'),
    candidate_id: exactCandidateId(candidate_id, 'member'),
    candidate_sha: exactSha(candidate_sha, 'member'),
    source_archive_digest: exactDigest(source_archive_digest, 'source_archive'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    state: memberState,
    quality_score: boundedScore(quality_score, 'quality_score'),
    novelty_score: boundedScore(novelty_score, 'novelty_score'),
    features: normalizeFeatures(features),
    external_evaluator: true,
    authored_by_candidate: false,
    member_is_scheduler_authority: false,
    member_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, member_digest: digest(core) });
}

export function verifyRsiIslandMember(member) {
  if (!plainObject(member) || member.schema !== RSI_ISLAND_MEMBER_SCHEMA || member.version !== 1) throw new Error('rsi_island_member_invalid');
  assertZeroAuthority(member, 'member');
  if (
    member.external_evaluator !== true
    || member.authored_by_candidate !== false
    || member.member_is_scheduler_authority !== false
    || member.member_is_promotion_authority !== false
  ) throw new Error('rsi_island_member_policy_invalid');
  const canonical = createRsiIslandMember({
    member_id: member.member_id,
    candidate_id: member.candidate_id,
    candidate_sha: member.candidate_sha,
    source_archive_digest: member.source_archive_digest,
    evaluator_root_digest: member.evaluator_root_digest,
    state: member.state,
    quality_score: member.quality_score,
    novelty_score: member.novelty_score,
    features: member.features,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.member_digest !== exactDigest(member.member_digest, 'member')) throw new Error('rsi_island_member_digest_mismatch');
  return canonical;
}

export function createRsiIslandState({
  island_id,
  epoch,
  descriptor,
  members,
  health = 'READY',
  local_generation = 1,
  completed_evaluations = 0,
  pending_external_evaluations = 0,
  work_budget_units = 16,
  external_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_owner !== true || authored_by_candidate !== false) throw new Error('rsi_island_state_external_origin_required');
  const islandHealth = boundedToken(health, 'health');
  if (!ISLAND_HEALTH.has(islandHealth)) throw new Error('rsi_island_health_invalid');
  if (!Array.isArray(members) || members.length < 1 || members.length > MAX_MEMBERS_PER_ISLAND) throw new Error('rsi_island_members_invalid');
  const checkedMembers = members.map(verifyRsiIslandMember);
  const ids = new Set();
  const candidates = new Set();
  const evaluatorRoots = new Set();
  for (const member of checkedMembers) {
    if (ids.has(member.member_id)) throw new Error('rsi_island_member_id_duplicate');
    if (candidates.has(member.candidate_id)) throw new Error('rsi_island_candidate_duplicate');
    ids.add(member.member_id);
    candidates.add(member.candidate_id);
    evaluatorRoots.add(member.evaluator_root_digest);
  }
  if (evaluatorRoots.size !== 1) throw new Error('rsi_island_evaluator_root_mismatch');

  const core = {
    schema: RSI_ISLAND_STATE_SCHEMA,
    version: 1,
    island_id: boundedId(island_id, 'island_id'),
    epoch: positiveInt(epoch, 'epoch', 1_000_000),
    descriptor: normalizeDescriptor(descriptor),
    members: checkedMembers.slice().sort((a, b) => a.candidate_id.localeCompare(b.candidate_id)),
    member_count: checkedMembers.length,
    health: islandHealth,
    local_generation: positiveInt(local_generation, 'local_generation', 1_000_000),
    completed_evaluations: nonNegativeInt(completed_evaluations, 'completed_evaluations', 1_000_000_000),
    pending_external_evaluations: nonNegativeInt(pending_external_evaluations, 'pending_external_evaluations', 1_000_000),
    work_budget_units: positiveInt(work_budget_units, 'work_budget_units', 1_000_000),
    evaluator_root_digest: [...evaluatorRoots][0],
    external_owner: true,
    authored_by_candidate: false,
    independent_progress_allowed: true,
    global_generation_barrier_required: false,
    scheduler_owned_by_island: false,
    candidate_can_edit_island_state: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, state_digest: digest(core) });
}

export function verifyRsiIslandState(state) {
  if (!plainObject(state) || state.schema !== RSI_ISLAND_STATE_SCHEMA || state.version !== 1) throw new Error('rsi_island_state_invalid');
  assertZeroAuthority(state, 'state');
  if (
    state.external_owner !== true
    || state.authored_by_candidate !== false
    || state.independent_progress_allowed !== true
    || state.global_generation_barrier_required !== false
    || state.scheduler_owned_by_island !== false
    || state.candidate_can_edit_island_state !== false
  ) throw new Error('rsi_island_state_policy_invalid');
  const canonical = createRsiIslandState({
    island_id: state.island_id,
    epoch: state.epoch,
    descriptor: state.descriptor,
    members: state.members,
    health: state.health,
    local_generation: state.local_generation,
    completed_evaluations: state.completed_evaluations,
    pending_external_evaluations: state.pending_external_evaluations,
    work_budget_units: state.work_budget_units,
    external_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.state_digest !== exactDigest(state.state_digest, 'state')) throw new Error('rsi_island_state_digest_mismatch');
  return canonical;
}

export function createRsiIslandPortfolio({
  portfolio_id,
  epoch,
  islands,
  migration_interval = 32,
  migration_rate = 0.1,
  external_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_owner !== true || authored_by_candidate !== false) throw new Error('rsi_island_portfolio_external_origin_required');
  if (!Array.isArray(islands) || islands.length < 2 || islands.length > MAX_ISLANDS) throw new Error('rsi_island_portfolio_islands_invalid');
  const checked = islands.map(verifyRsiIslandState).sort((a, b) => a.island_id.localeCompare(b.island_id));
  const ids = new Set();
  for (const island of checked) {
    if (ids.has(island.island_id)) throw new Error('rsi_island_portfolio_island_duplicate');
    ids.add(island.island_id);
  }
  const rate = Number(migration_rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 0.2) throw new Error('rsi_island_migration_rate_invalid');
  const evaluatorRoots = new Set(checked.map((island) => island.evaluator_root_digest));
  if (evaluatorRoots.size !== 1) throw new Error('rsi_island_portfolio_evaluator_root_mismatch');

  const core = {
    schema: RSI_ISLAND_PORTFOLIO_SCHEMA,
    version: 1,
    portfolio_id: boundedId(portfolio_id, 'portfolio_id'),
    epoch: positiveInt(epoch, 'portfolio_epoch', 1_000_000),
    islands: checked,
    island_count: checked.length,
    migration_interval: positiveInt(migration_interval, 'migration_interval', 1_000_000),
    migration_rate: rate,
    migration_topology: 'DETERMINISTIC_RING',
    evaluator_root_digest: [...evaluatorRoots][0],
    asynchronous_islands: true,
    global_generation_barrier_required: false,
    one_existing_scheduler_required: true,
    second_scheduler_allowed: false,
    bounded_migration: true,
    target_validation_required_after_migration: true,
    migration_is_promotion: false,
    candidate_can_edit_portfolio: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, portfolio_digest: digest(core) });
}

export function verifyRsiIslandPortfolio(portfolio) {
  if (!plainObject(portfolio) || portfolio.schema !== RSI_ISLAND_PORTFOLIO_SCHEMA || portfolio.version !== 1) throw new Error('rsi_island_portfolio_invalid');
  assertZeroAuthority(portfolio, 'portfolio');
  if (
    portfolio.migration_topology !== 'DETERMINISTIC_RING'
    || portfolio.asynchronous_islands !== true
    || portfolio.global_generation_barrier_required !== false
    || portfolio.one_existing_scheduler_required !== true
    || portfolio.second_scheduler_allowed !== false
    || portfolio.bounded_migration !== true
    || portfolio.target_validation_required_after_migration !== true
    || portfolio.migration_is_promotion !== false
    || portfolio.candidate_can_edit_portfolio !== false
  ) throw new Error('rsi_island_portfolio_policy_invalid');
  const canonical = createRsiIslandPortfolio({
    portfolio_id: portfolio.portfolio_id,
    epoch: portfolio.epoch,
    islands: portfolio.islands,
    migration_interval: portfolio.migration_interval,
    migration_rate: portfolio.migration_rate,
    external_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.portfolio_digest !== exactDigest(portfolio.portfolio_digest, 'portfolio')) throw new Error('rsi_island_portfolio_digest_mismatch');
  return canonical;
}

function migrationCount(island, rate) {
  return Math.max(1, Math.min(MAX_MIGRANTS_PER_ISLAND, Math.floor(island.member_count * rate)));
}

function eligibleMigrants(island, seed) {
  return island.members
    .filter((member) => member.state !== 'ARCHIVE_ACTIVE' || member.quality_score >= 0)
    .slice()
    .sort((a, b) =>
      b.novelty_score - a.novelty_score
      || b.quality_score - a.quality_score
      || seededTie(seed, a.candidate_id).localeCompare(seededTie(seed, b.candidate_id))
    );
}

export function createRsiIslandMigrationPlan({
  portfolio,
  migration_round,
} = {}) {
  const checked = verifyRsiIslandPortfolio(portfolio);
  const round = positiveInt(migration_round, 'migration_round', 1_000_000);
  if (round % checked.migration_interval !== 0) {
    return zeroAuthority({
      schema: RSI_ISLAND_MIGRATION_PLAN_SCHEMA,
      version: 1,
      portfolio_id: checked.portfolio_id,
      portfolio_digest: checked.portfolio_digest,
      migration_round: round,
      state: 'NO_MIGRATION_DUE',
      routes: [],
      route_count: 0,
      deterministic_ring: true,
      migration_due: false,
      target_validation_required: true,
      scheduler_action_authorized: false,
      second_scheduler_allowed: false,
      plan_digest: digest({
        portfolio_digest: checked.portfolio_digest,
        migration_round: round,
        state: 'NO_MIGRATION_DUE',
      }),
    });
  }

  const seed = digest({ portfolio_digest: checked.portfolio_digest, migration_round: round });
  const routes = [];
  for (let index = 0; index < checked.islands.length; index += 1) {
    const source = checked.islands[index];
    const target = checked.islands[(index + 1) % checked.islands.length];
    if (source.health === 'PAUSED' || target.health === 'PAUSED') continue;
    const count = migrationCount(source, checked.migration_rate);
    const selected = eligibleMigrants(source, `${seed}:${source.island_id}`).slice(0, count);
    for (const member of selected) {
      routes.push(Object.freeze({
        route_id: `migration_${digest({ source: source.island_id, target: target.island_id, member: member.member_digest, round }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
        source_island_id: source.island_id,
        source_island_epoch: source.epoch,
        source_state_digest: source.state_digest,
        target_island_id: target.island_id,
        target_island_epoch: target.epoch,
        target_state_digest: target.state_digest,
        candidate_id: member.candidate_id,
        candidate_sha: member.candidate_sha,
        member_digest: member.member_digest,
        source_quality_score: member.quality_score,
        source_novelty_score: member.novelty_score,
        state: 'PROPOSE_MIGRATION_FOR_TARGET_VALIDATION',
        target_validation_required: true,
        migrant_becomes_parent_before_validation: false,
        migration_is_promotion: false,
        scheduler_action_authorized: false,
      }));
    }
  }

  const core = {
    schema: RSI_ISLAND_MIGRATION_PLAN_SCHEMA,
    version: 1,
    portfolio_id: checked.portfolio_id,
    portfolio_digest: checked.portfolio_digest,
    migration_round: round,
    state: 'MIGRATION_DUE',
    routes,
    route_count: routes.length,
    deterministic_ring: true,
    migration_due: true,
    target_validation_required: true,
    scheduler_action_authorized: false,
    second_scheduler_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, plan_digest: digest(core) });
}

export function verifyRsiIslandMigrationPlan(plan, portfolio) {
  const checked = verifyRsiIslandPortfolio(portfolio);
  if (!plainObject(plan) || plan.schema !== RSI_ISLAND_MIGRATION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_island_migration_plan_invalid');
  assertZeroAuthority(plan, 'migration_plan');
  if (
    plan.portfolio_digest !== checked.portfolio_digest
    || plan.deterministic_ring !== true
    || plan.target_validation_required !== true
    || plan.scheduler_action_authorized !== false
    || plan.second_scheduler_allowed !== false
  ) throw new Error('rsi_island_migration_plan_policy_invalid');
  if (!Array.isArray(plan.routes) || plan.route_count !== plan.routes.length) throw new Error('rsi_island_migration_routes_invalid');
  const islandById = new Map(checked.islands.map((island) => [island.island_id, island]));
  for (const route of plan.routes) {
    const source = islandById.get(route.source_island_id);
    const target = islandById.get(route.target_island_id);
    if (!source || !target) throw new Error('rsi_island_migration_route_island_missing');
    if (
      route.source_island_epoch !== source.epoch
      || route.target_island_epoch !== target.epoch
      || route.source_state_digest !== source.state_digest
      || route.target_state_digest !== target.state_digest
      || route.target_validation_required !== true
      || route.migrant_becomes_parent_before_validation !== false
      || route.migration_is_promotion !== false
      || route.scheduler_action_authorized !== false
    ) throw new Error('rsi_island_migration_route_fence_invalid');
    const member = source.members.find((row) => row.candidate_id === route.candidate_id);
    if (!member || member.member_digest !== route.member_digest || member.candidate_sha !== route.candidate_sha) {
      throw new Error('rsi_island_migration_route_member_mismatch');
    }
  }
  const clone = structuredClone(plan);
  delete clone.plan_digest;
  if (exactDigest(plan.plan_digest, 'migration_plan') !== digest(clone)) throw new Error('rsi_island_migration_plan_digest_mismatch');
  return plan;
}

export function createRsiIslandMigrationReceipt({
  plan,
  portfolio,
  route_id,
  outcome,
  target_holdout_digest,
  target_evaluator_root_digest,
  target_quality_score,
  target_novelty_score,
  target_hard_invariants_pass,
  external_target_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPlan = verifyRsiIslandMigrationPlan(plan, portfolio);
  if (external_target_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_island_migration_receipt_external_origin_required');
  const route = checkedPlan.routes.find((row) => row.route_id === String(route_id || ''));
  if (!route) throw new Error('rsi_island_migration_receipt_route_invalid');
  const normalizedOutcome = boundedToken(outcome, 'migration_outcome');
  if (!MIGRATION_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_island_migration_outcome_invalid');
  const hardPass = target_hard_invariants_pass === true;
  if (normalizedOutcome === 'TARGET_VALIDATED' && !hardPass) throw new Error('rsi_island_migration_validated_without_hard_invariants');
  const core = {
    schema: RSI_ISLAND_MIGRATION_RECEIPT_SCHEMA,
    version: 1,
    plan_digest: checkedPlan.plan_digest,
    route_id: route.route_id,
    source_island_id: route.source_island_id,
    source_island_epoch: route.source_island_epoch,
    target_island_id: route.target_island_id,
    target_island_epoch: route.target_island_epoch,
    candidate_id: route.candidate_id,
    candidate_sha: route.candidate_sha,
    member_digest: route.member_digest,
    outcome: normalizedOutcome,
    target_holdout_digest: exactDigest(target_holdout_digest, 'target_holdout'),
    target_evaluator_root_digest: exactDigest(target_evaluator_root_digest, 'target_evaluator_root'),
    target_quality_score: boundedScore(target_quality_score, 'target_quality_score'),
    target_novelty_score: boundedScore(target_novelty_score, 'target_novelty_score'),
    target_hard_invariants_pass: hardPass,
    external_target_evaluator: true,
    authored_by_candidate: false,
    eligible_for_target_parent_pool: normalizedOutcome === 'TARGET_VALIDATED',
    migration_is_promotion: false,
    scheduler_action_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiIslandMigrationReceipt(receipt, plan, portfolio) {
  if (!plainObject(receipt) || receipt.schema !== RSI_ISLAND_MIGRATION_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_island_migration_receipt_invalid');
  assertZeroAuthority(receipt, 'migration_receipt');
  if (
    receipt.external_target_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.migration_is_promotion !== false
    || receipt.scheduler_action_authorized !== false
  ) throw new Error('rsi_island_migration_receipt_policy_invalid');
  const canonical = createRsiIslandMigrationReceipt({
    plan,
    portfolio,
    route_id: receipt.route_id,
    outcome: receipt.outcome,
    target_holdout_digest: receipt.target_holdout_digest,
    target_evaluator_root_digest: receipt.target_evaluator_root_digest,
    target_quality_score: receipt.target_quality_score,
    target_novelty_score: receipt.target_novelty_score,
    target_hard_invariants_pass: receipt.target_hard_invariants_pass,
    external_target_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'migration_receipt')) throw new Error('rsi_island_migration_receipt_digest_mismatch');
  return canonical;
}

export function createRsiIslandWorkProposals({
  portfolio,
  proposal_round,
  max_proposals = 16,
} = {}) {
  const checked = verifyRsiIslandPortfolio(portfolio);
  const round = positiveInt(proposal_round, 'proposal_round', 1_000_000);
  const max = positiveInt(max_proposals, 'max_proposals', MAX_WORK_PROPOSALS);
  const seed = digest({ portfolio_digest: checked.portfolio_digest, proposal_round: round });
  const proposals = [];
  for (const island of checked.islands) {
    if (island.health === 'PAUSED') continue;
    const remaining = Math.max(0, island.work_budget_units - island.pending_external_evaluations);
    if (remaining < 1) continue;
    const ranked = island.members.slice().sort((a, b) =>
      (b.quality_score + b.novelty_score) - (a.quality_score + a.novelty_score)
      || seededTie(seed, a.candidate_id).localeCompare(seededTie(seed, b.candidate_id))
    );
    const leader = ranked[0];
    if (!leader) continue;
    const workKind = island.pending_external_evaluations > island.completed_evaluations
      ? 'PROPOSE_EVALUATION'
      : 'PROPOSE_EXPANSION';
    if (!WORK_KINDS.has(workKind)) throw new Error('rsi_island_work_kind_invalid');
    proposals.push(zeroAuthority({
      schema: RSI_ISLAND_WORK_PROPOSAL_SCHEMA,
      version: 1,
      proposal_id: `island_work_${digest({ island: island.state_digest, member: leader.member_digest, round, workKind }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
      portfolio_digest: checked.portfolio_digest,
      island_id: island.island_id,
      island_epoch: island.epoch,
      island_state_digest: island.state_digest,
      local_generation: island.local_generation,
      candidate_id: leader.candidate_id,
      candidate_sha: leader.candidate_sha,
      member_digest: leader.member_digest,
      work_kind: workKind,
      proposed_budget_units: Math.min(remaining, 4),
      proposal_round: round,
      global_generation_barrier_required: false,
      existing_scheduler_admission_required: true,
      scheduler_action_authorized: false,
      second_scheduler_allowed: false,
      work_proposal_is_task: false,
      work_proposal_is_lease: false,
    }));
  }
  proposals.sort((a, b) => a.island_id.localeCompare(b.island_id));
  const selected = proposals.slice(0, max);
  const core = {
    schema: 'metaengine.rsi.island-work-portfolio.v1',
    version: 1,
    portfolio_digest: checked.portfolio_digest,
    proposal_round: round,
    proposals: selected,
    proposal_count: selected.length,
    asynchronous_islands: true,
    global_generation_barrier_required: false,
    existing_scheduler_admission_required: true,
    scheduler_action_authorized: false,
    second_scheduler_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, work_portfolio_digest: digest(core) });
}

export function rsiAsynchronousIslandTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.asynchronous-island-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-asynchronous-island-portfolio.mjs',
    asynchronous_islands: true,
    map_elites_compatible_members: true,
    deterministic_ring_migration: true,
    bounded_migration_rate_max: 0.2,
    target_validation_required_after_migration: true,
    global_generation_barrier_required: false,
    one_existing_scheduler_required: true,
    second_scheduler_allowed: false,
    scheduler_action_authorized: false,
    migration_is_promotion: false,
    candidate_can_edit_portfolio: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, island_root_digest: digest(root) });
}
