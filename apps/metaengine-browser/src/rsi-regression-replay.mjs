import crypto from 'node:crypto';

export const RSI_MASTERY_ANCHOR_SCHEMA = 'metaengine.rsi.mastery-anchor.v1';
export const RSI_MASTERY_LEDGER_SCHEMA = 'metaengine.rsi.mastery-ledger.v1';
export const RSI_RETENTION_REPLAY_PLAN_SCHEMA = 'metaengine.rsi.retention-replay-plan.v1';
export const RSI_RETENTION_REPLAY_RECEIPT_SCHEMA = 'metaengine.rsi.retention-replay-receipt.v1';
export const RSI_RETENTION_GATE_SCHEMA = 'metaengine.rsi.retention-gate.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_ANCHORS = 4096;
const MAX_REPLAY_TASKS = 128;
const MAX_EVIDENCE_REFS = 32;
const MIN_REPLAY_ATTEMPTS = 8;

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_retention_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_retention_${label}_sha_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_retention_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_retention_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_retention_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_retention_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_retention_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_retention_${label}_invalid`);
  return out;
}

function iso(value, label) {
  const out = String(value || '');
  if (!Number.isFinite(Date.parse(out))) throw new Error(`rsi_retention_${label}_invalid`);
  return new Date(out).toISOString();
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_retention_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_retention_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
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

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_retention_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_retention_${label}_automatic_retry_invalid`);
}

export function createRsiMasteryAnchor({
  anchor_id,
  capability_family,
  challenge_digest,
  benchmark_admission_digest,
  baseline_candidate_id,
  baseline_candidate_sha,
  mastered_generation,
  mastered_at,
  baseline_success_rate,
  minimum_retained_success_rate,
  historical_regression_count = 0,
  safety_critical = false,
  external_mastery_verifier = false,
  authored_by_candidate = true,
  contamination_resistant_evidence = false,
  hidden_holdout = false,
  evidence_refs,
} = {}) {
  if (external_mastery_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_retention_mastery_external_origin_required');
  if (contamination_resistant_evidence !== true || hidden_holdout !== true) throw new Error('rsi_retention_mastery_independent_evidence_required');
  const baselineRate = unitInterval(baseline_success_rate, 'baseline_success_rate');
  const floor = unitInterval(minimum_retained_success_rate, 'minimum_retained_success_rate');
  if (floor > baselineRate) throw new Error('rsi_retention_mastery_floor_above_baseline');
  const core = {
    schema: RSI_MASTERY_ANCHOR_SCHEMA,
    version: 1,
    anchor_id: boundedId(anchor_id, 'anchor_id'),
    capability_family: boundedToken(capability_family, 'capability_family'),
    challenge_digest: exactDigest(challenge_digest, 'challenge'),
    benchmark_admission_digest: exactDigest(benchmark_admission_digest, 'benchmark_admission'),
    baseline_candidate_id: exactCandidateId(baseline_candidate_id, 'baseline'),
    baseline_candidate_sha: exactSha(baseline_candidate_sha, 'baseline'),
    mastered_generation: positiveInt(mastered_generation, 'mastered_generation', 1_000_000),
    mastered_at: iso(mastered_at, 'mastered_at'),
    baseline_success_rate: baselineRate,
    minimum_retained_success_rate: floor,
    historical_regression_count: nonNegativeInt(historical_regression_count, 'historical_regression_count', 1_000_000),
    safety_critical: safety_critical === true,
    external_mastery_verifier: true,
    authored_by_candidate: false,
    contamination_resistant_evidence: true,
    hidden_holdout: true,
    raw_task_content_present: false,
    candidate_can_delete_anchor: false,
    candidate_can_lower_retention_floor: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    evidence_refs: evidenceRefs(evidence_refs),
  };
  return Object.freeze({ ...core, anchor_digest: digest(core) });
}

export function verifyRsiMasteryAnchor(anchor) {
  if (!plainObject(anchor) || anchor.schema !== RSI_MASTERY_ANCHOR_SCHEMA || anchor.version !== 1) throw new Error('rsi_retention_mastery_anchor_invalid');
  assertZeroAuthority(anchor, 'mastery_anchor');
  if (
    anchor.external_mastery_verifier !== true
    || anchor.authored_by_candidate !== false
    || anchor.contamination_resistant_evidence !== true
    || anchor.hidden_holdout !== true
    || anchor.raw_task_content_present !== false
    || anchor.candidate_can_delete_anchor !== false
    || anchor.candidate_can_lower_retention_floor !== false
  ) throw new Error('rsi_retention_mastery_anchor_policy_invalid');
  const canonical = createRsiMasteryAnchor({
    anchor_id: anchor.anchor_id,
    capability_family: anchor.capability_family,
    challenge_digest: anchor.challenge_digest,
    benchmark_admission_digest: anchor.benchmark_admission_digest,
    baseline_candidate_id: anchor.baseline_candidate_id,
    baseline_candidate_sha: anchor.baseline_candidate_sha,
    mastered_generation: anchor.mastered_generation,
    mastered_at: anchor.mastered_at,
    baseline_success_rate: anchor.baseline_success_rate,
    minimum_retained_success_rate: anchor.minimum_retained_success_rate,
    historical_regression_count: anchor.historical_regression_count,
    safety_critical: anchor.safety_critical,
    external_mastery_verifier: true,
    authored_by_candidate: false,
    contamination_resistant_evidence: true,
    hidden_holdout: true,
    evidence_refs: anchor.evidence_refs,
  });
  if (canonical.anchor_digest !== exactDigest(anchor.anchor_digest, 'anchor')) throw new Error('rsi_retention_mastery_anchor_digest_mismatch');
  return canonical;
}

export function createRsiMasteryLedger({ ledger_id, anchors } = {}) {
  if (!Array.isArray(anchors) || anchors.length < 1 || anchors.length > MAX_ANCHORS) throw new Error('rsi_retention_ledger_anchors_invalid');
  const checked = anchors.map(verifyRsiMasteryAnchor).sort((a, b) => a.anchor_id.localeCompare(b.anchor_id));
  const ids = new Set();
  const challenges = new Set();
  for (const anchor of checked) {
    if (ids.has(anchor.anchor_id)) throw new Error('rsi_retention_ledger_anchor_id_duplicate');
    if (challenges.has(anchor.challenge_digest)) throw new Error('rsi_retention_ledger_challenge_duplicate');
    ids.add(anchor.anchor_id);
    challenges.add(anchor.challenge_digest);
  }
  const familyCounts = {};
  for (const anchor of checked) familyCounts[anchor.capability_family] = (familyCounts[anchor.capability_family] || 0) + 1;
  const core = {
    schema: RSI_MASTERY_LEDGER_SCHEMA,
    version: 1,
    ledger_id: boundedId(ledger_id, 'ledger_id'),
    anchors: checked,
    anchor_count: checked.length,
    family_counts: Object.fromEntries(Object.entries(familyCounts).sort(([a], [b]) => a.localeCompare(b))),
    distinct_family_count: Object.keys(familyCounts).length,
    append_only: true,
    candidate_can_delete_anchors: false,
    candidate_can_rewrite_baselines: false,
    candidate_can_lower_retention_floors: false,
    hidden_holdout_content_exposed: false,
    raw_task_content_present: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, ledger_digest: digest(core) });
}

export function verifyRsiMasteryLedger(ledger) {
  if (!plainObject(ledger) || ledger.schema !== RSI_MASTERY_LEDGER_SCHEMA || ledger.version !== 1) throw new Error('rsi_retention_ledger_invalid');
  assertZeroAuthority(ledger, 'ledger');
  if (
    ledger.append_only !== true
    || ledger.candidate_can_delete_anchors !== false
    || ledger.candidate_can_rewrite_baselines !== false
    || ledger.candidate_can_lower_retention_floors !== false
    || ledger.hidden_holdout_content_exposed !== false
    || ledger.raw_task_content_present !== false
  ) throw new Error('rsi_retention_ledger_policy_invalid');
  const canonical = createRsiMasteryLedger({ ledger_id: ledger.ledger_id, anchors: ledger.anchors });
  if (canonical.ledger_digest !== exactDigest(ledger.ledger_digest, 'ledger')) throw new Error('rsi_retention_ledger_digest_mismatch');
  return canonical;
}

function tie(seed, anchorId) {
  return crypto.createHash('sha256').update(`${seed}:${anchorId}`, 'utf8').digest('hex');
}

function priority(anchor, familyCount, generation) {
  const age = Math.max(0, generation - anchor.mastered_generation);
  const regression = anchor.historical_regression_count;
  const safety = anchor.safety_critical ? 1000 : 0;
  const rarity = 100 / Math.max(1, familyCount);
  return safety + regression * 25 + age + rarity;
}

export function createRsiRetentionReplayPlan({
  ledger,
  current_candidate_id,
  current_candidate_sha,
  current_generation,
  max_replay_tasks = 16,
} = {}) {
  const checked = verifyRsiMasteryLedger(ledger);
  const candidateId = exactCandidateId(current_candidate_id, 'current');
  const candidateSha = exactSha(current_candidate_sha, 'current');
  const generation = positiveInt(current_generation, 'current_generation', 1_000_000);
  const limit = positiveInt(max_replay_tasks, 'max_replay_tasks', MAX_REPLAY_TASKS);
  const seed = digest({
    ledger_digest: checked.ledger_digest,
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    generation,
    limit,
  });
  const familyCounts = checked.family_counts;
  const ranked = checked.anchors
    .map((anchor) => ({
      anchor,
      priority: priority(anchor, familyCounts[anchor.capability_family], generation),
      tie: tie(seed, anchor.anchor_id),
    }))
    .sort((a, b) => b.priority - a.priority || a.tie.localeCompare(b.tie));

  const selected = [];
  const seenFamilies = new Set();
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (seenFamilies.has(row.anchor.capability_family)) continue;
    selected.push(row);
    seenFamilies.add(row.anchor.capability_family);
  }
  for (const row of ranked) {
    if (selected.length >= Math.min(limit, ranked.length)) break;
    if (selected.some((existing) => existing.anchor.anchor_id === row.anchor.anchor_id)) continue;
    selected.push(row);
  }

  const tasks = selected.map((row, index) => Object.freeze({
    replay_index: index + 1,
    anchor_id: row.anchor.anchor_id,
    anchor_digest: row.anchor.anchor_digest,
    capability_family: row.anchor.capability_family,
    challenge_digest: row.anchor.challenge_digest,
    benchmark_admission_digest: row.anchor.benchmark_admission_digest,
    baseline_success_rate: row.anchor.baseline_success_rate,
    minimum_retained_success_rate: row.anchor.minimum_retained_success_rate,
    safety_critical: row.anchor.safety_critical,
    historical_regression_count: row.anchor.historical_regression_count,
    mastered_generation: row.anchor.mastered_generation,
    priority_score: row.priority,
    selected_by_candidate: false,
  }));

  const core = {
    schema: RSI_RETENTION_REPLAY_PLAN_SCHEMA,
    version: 1,
    ledger_id: checked.ledger_id,
    ledger_digest: checked.ledger_digest,
    current_candidate_id: candidateId,
    current_candidate_sha: candidateSha,
    current_generation: generation,
    max_replay_tasks: limit,
    tasks,
    task_count: tasks.length,
    selected_family_count: new Set(tasks.map((row) => row.capability_family)).size,
    diversity_first_sampling: true,
    safety_critical_priority: true,
    staleness_priority: true,
    historical_regression_priority: true,
    candidate_can_select_replay_tasks: false,
    candidate_can_skip_safety_critical_anchor: false,
    replay_is_promotion_authority: false,
    hidden_holdout_content_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, plan_digest: digest(core) });
}

export function verifyRsiRetentionReplayPlan(plan, ledger) {
  const checkedLedger = verifyRsiMasteryLedger(ledger);
  if (!plainObject(plan) || plan.schema !== RSI_RETENTION_REPLAY_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_retention_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.ledger_digest !== checkedLedger.ledger_digest
    || plan.diversity_first_sampling !== true
    || plan.safety_critical_priority !== true
    || plan.staleness_priority !== true
    || plan.historical_regression_priority !== true
    || plan.candidate_can_select_replay_tasks !== false
    || plan.candidate_can_skip_safety_critical_anchor !== false
    || plan.replay_is_promotion_authority !== false
    || plan.hidden_holdout_content_exposed !== false
  ) throw new Error('rsi_retention_plan_policy_invalid');
  const canonical = createRsiRetentionReplayPlan({
    ledger: checkedLedger,
    current_candidate_id: plan.current_candidate_id,
    current_candidate_sha: plan.current_candidate_sha,
    current_generation: plan.current_generation,
    max_replay_tasks: plan.max_replay_tasks,
  });
  if (canonical.plan_digest !== exactDigest(plan.plan_digest, 'plan')) throw new Error('rsi_retention_plan_digest_mismatch');
  return canonical;
}

export function createRsiRetentionReplayReceipt({
  plan,
  ledger,
  anchor_id,
  replay_attempts,
  replay_successes,
  hard_invariants_pass,
  evaluator_root_digest,
  environment_fingerprint,
  external_replay_evaluator = false,
  authored_by_candidate = true,
  evidence_refs,
} = {}) {
  const checkedPlan = verifyRsiRetentionReplayPlan(plan, ledger);
  if (external_replay_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_retention_receipt_external_origin_required');
  const task = checkedPlan.tasks.find((row) => row.anchor_id === String(anchor_id || ''));
  if (!task) throw new Error('rsi_retention_receipt_anchor_not_planned');
  const attempts = positiveInt(replay_attempts, 'replay_attempts', 100_000);
  if (attempts < MIN_REPLAY_ATTEMPTS) throw new Error('rsi_retention_receipt_min_attempts');
  const successes = nonNegativeInt(replay_successes, 'replay_successes', attempts);
  const rate = successes / attempts;
  const hardPass = hard_invariants_pass === true;
  const retained = hardPass && rate >= task.minimum_retained_success_rate;
  const state = !hardPass
    ? 'DEGRADED_HARD_INVARIANT'
    : retained
      ? 'RETAINED'
      : 'DEGRADED_CAPABILITY';
  const core = {
    schema: RSI_RETENTION_REPLAY_RECEIPT_SCHEMA,
    version: 1,
    plan_digest: checkedPlan.plan_digest,
    current_candidate_id: checkedPlan.current_candidate_id,
    current_candidate_sha: checkedPlan.current_candidate_sha,
    anchor_id: task.anchor_id,
    anchor_digest: task.anchor_digest,
    capability_family: task.capability_family,
    challenge_digest: task.challenge_digest,
    benchmark_admission_digest: task.benchmark_admission_digest,
    baseline_success_rate: task.baseline_success_rate,
    minimum_retained_success_rate: task.minimum_retained_success_rate,
    replay_attempts: attempts,
    replay_successes: successes,
    current_success_rate: rate,
    success_rate_delta_from_baseline: rate - task.baseline_success_rate,
    hard_invariants_pass: hardPass,
    safety_critical: task.safety_critical,
    state,
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    environment_fingerprint: boundedId(environment_fingerprint, 'environment_fingerprint'),
    external_replay_evaluator: true,
    authored_by_candidate: false,
    candidate_can_self_certify_retention: false,
    replay_result_is_promotion_authority: false,
    no_statistical_alpha_spent: true,
    evidence_refs: evidenceRefs(evidence_refs),
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiRetentionReplayReceipt(receipt, plan, ledger) {
  if (!plainObject(receipt) || receipt.schema !== RSI_RETENTION_REPLAY_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_retention_receipt_invalid');
  assertZeroAuthority(receipt, 'receipt');
  if (
    receipt.external_replay_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.candidate_can_self_certify_retention !== false
    || receipt.replay_result_is_promotion_authority !== false
    || receipt.no_statistical_alpha_spent !== true
  ) throw new Error('rsi_retention_receipt_policy_invalid');
  const canonical = createRsiRetentionReplayReceipt({
    plan,
    ledger,
    anchor_id: receipt.anchor_id,
    replay_attempts: receipt.replay_attempts,
    replay_successes: receipt.replay_successes,
    hard_invariants_pass: receipt.hard_invariants_pass,
    evaluator_root_digest: receipt.evaluator_root_digest,
    environment_fingerprint: receipt.environment_fingerprint,
    external_replay_evaluator: true,
    authored_by_candidate: false,
    evidence_refs: receipt.evidence_refs,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'receipt')) throw new Error('rsi_retention_receipt_digest_mismatch');
  return canonical;
}

export function finalizeRsiRetentionGate({ plan, ledger, receipts } = {}) {
  const checkedPlan = verifyRsiRetentionReplayPlan(plan, ledger);
  if (!Array.isArray(receipts) || receipts.length !== checkedPlan.tasks.length) throw new Error('rsi_retention_gate_receipt_set_incomplete');
  const byAnchor = new Map();
  for (const receipt of receipts) {
    const checked = verifyRsiRetentionReplayReceipt(receipt, checkedPlan, ledger);
    if (byAnchor.has(checked.anchor_id)) throw new Error('rsi_retention_gate_receipt_duplicate');
    byAnchor.set(checked.anchor_id, checked);
  }
  const rows = checkedPlan.tasks.map((task) => {
    const receipt = byAnchor.get(task.anchor_id);
    if (!receipt) throw new Error('rsi_retention_gate_receipt_missing');
    return receipt;
  });
  const degradedHard = rows.filter((row) => row.state === 'DEGRADED_HARD_INVARIANT');
  const degradedCapability = rows.filter((row) => row.state === 'DEGRADED_CAPABILITY');
  const safetyCriticalDegraded = rows.filter((row) => row.safety_critical && row.state !== 'RETAINED');
  const pass = degradedHard.length === 0 && degradedCapability.length === 0;
  const blockers = [
    ...(degradedHard.length > 0 ? ['HARD_INVARIANT_REGRESSION'] : []),
    ...(safetyCriticalDegraded.length > 0 ? ['SAFETY_CRITICAL_CAPABILITY_REGRESSION'] : []),
    ...(degradedCapability.length > 0 ? ['CAPABILITY_REGRESSION'] : []),
  ].sort();
  const core = {
    schema: RSI_RETENTION_GATE_SCHEMA,
    version: 1,
    plan_digest: checkedPlan.plan_digest,
    ledger_digest: checkedPlan.ledger_digest,
    current_candidate_id: checkedPlan.current_candidate_id,
    current_candidate_sha: checkedPlan.current_candidate_sha,
    replay_receipt_digests: rows.map((row) => row.receipt_digest).sort(),
    replay_task_count: rows.length,
    retained_count: rows.filter((row) => row.state === 'RETAINED').length,
    degraded_capability_count: degradedCapability.length,
    degraded_hard_invariant_count: degradedHard.length,
    safety_critical_degraded_count: safetyCriticalDegraded.length,
    state: pass ? 'RETENTION_GATE_PASS_FOR_EXTERNAL_REVIEW' : 'RETENTION_GATE_HELD',
    blockers,
    retention_gate_pass: pass,
    existing_promotion_gate_still_required: true,
    statistical_confirmation_still_required: true,
    full_hidden_holdout_still_required: true,
    regression_memory_must_be_retained: !pass,
    held_candidate_may_remain_nonpromotable_stepping_stone: !pass,
    retention_gate_is_promotion_authority: false,
    direct_promotion_authorized: false,
    promotion_token: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, gate_digest: digest(core) });
}

export function verifyRsiRetentionGate(gate, plan, ledger, receipts) {
  if (!plainObject(gate) || gate.schema !== RSI_RETENTION_GATE_SCHEMA || gate.version !== 1) throw new Error('rsi_retention_gate_invalid');
  assertZeroAuthority(gate, 'gate');
  if (
    gate.existing_promotion_gate_still_required !== true
    || gate.statistical_confirmation_still_required !== true
    || gate.full_hidden_holdout_still_required !== true
    || gate.retention_gate_is_promotion_authority !== false
    || gate.direct_promotion_authorized !== false
    || gate.promotion_token !== null
  ) throw new Error('rsi_retention_gate_policy_invalid');
  const canonical = finalizeRsiRetentionGate({ plan, ledger, receipts });
  if (canonical.gate_digest !== exactDigest(gate.gate_digest, 'gate')) throw new Error('rsi_retention_gate_digest_mismatch');
  return canonical;
}

export function rsiRegressionReplayTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.regression-replay-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-regression-replay.mjs',
    mastery_requires_external_verifier: true,
    mastery_requires_contamination_resistant_evidence: true,
    mastery_requires_hidden_holdout: true,
    mastery_ledger_append_only: true,
    diversity_first_replay_sampling: true,
    safety_critical_priority: true,
    staleness_priority: true,
    historical_regression_priority: true,
    minimum_replay_attempts: MIN_REPLAY_ATTEMPTS,
    candidate_can_select_replay_tasks: false,
    candidate_can_self_certify_retention: false,
    candidate_can_delete_mastery_anchors: false,
    candidate_can_lower_retention_floor: false,
    retention_gate_is_promotion_authority: false,
    full_hidden_holdout_still_required: true,
    statistical_confirmation_still_required: true,
    existing_promotion_gate_still_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, retention_root_digest: digest(root) });
}
