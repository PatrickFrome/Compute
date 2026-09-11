import { reconcileMetaOrchestrator } from './meta-orchestrator-core.mjs';

const SHA40_RE = /^[a-f0-9]{40}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;
const CHECKPOINT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,255}$/;
const KNOWN_TASK_STATES = new Set([
  'READY', 'LEASED', 'RUNNING', 'RESULT_READY', 'BLOCKED', 'AMBIGUOUS',
  'COMPLETED', 'FAILED', 'CANCELLED', 'FENCED',
]);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`meta_snapshot_${name}_invalid`);
  return value;
}

function bounded(value, name, max = 256) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max) throw new Error(`meta_snapshot_${name}_invalid`);
  return out;
}

function positiveInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`meta_snapshot_${name}_invalid`);
  return out;
}

function nonNegativeInt(value, name, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`meta_snapshot_${name}_invalid`);
  return out;
}

function sha(value, name = 'baseline_sha') {
  const out = bounded(value, name, 40).toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`meta_snapshot_${name}_invalid`);
  return out;
}

function point(value, name = 'point_id') {
  const out = bounded(value, name, 192).toLowerCase();
  if (!POINT_RE.test(out)) throw new Error(`meta_snapshot_${name}_invalid`);
  return out;
}

function safeTime(value) {
  const out = String(value || '');
  return Number.isFinite(Date.parse(out)) ? out : null;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    task_content_authority: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

export function projectMetaRoadmapAuthority(row = {}) {
  object(row, 'roadmap_authority');
  const authorityKey = bounded(row.authority_key, 'authority_key', 160).toUpperCase();
  if (authorityKey !== 'METAENGINE_DEVOS') throw new Error('meta_snapshot_authority_key_untrusted');
  return zeroAuthority({
    schema: 'metaengine.meta-orchestrator.roadmap-authority-snapshot.v1',
    authority_key: authorityKey,
    roadmap_id: bounded(row.roadmap_id, 'roadmap_id', 160),
    active_milestone_key: bounded(row.active_milestone_key, 'active_milestone_key', 160),
    integration_line: bounded(row.integration_line, 'integration_line', 240),
    baseline_sha: sha(row.baseline_sha),
    alignment_epoch: positiveInt(row.alignment_epoch, 'alignment_epoch'),
    updated_at: safeTime(row.updated_at),
  });
}

function planNodeMap(plan) {
  object(plan, 'plan');
  if (plan.schema !== 'metaengine.meta-orchestrator.plan.v1' || !Array.isArray(plan.nodes)) throw new Error('meta_snapshot_plan_schema_invalid');
  return new Map(plan.nodes.map((node) => [String(node.point_id || '').toLowerCase(), node]));
}

function matchingMetaTask(task, plan) {
  const meta = task?.task_spec?.meta_orchestrator;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  if (String(meta.roadmap_id || '') !== String(plan.roadmap_id || '')) return null;
  if (Number(meta.alignment_epoch) !== Number(plan.alignment_epoch)) return null;
  if (Number(meta.plan_generation) !== Number(plan.plan_generation)) return null;
  return meta;
}

export function projectDevosTasksForMetaPlan(tasks = [], { plan } = {}) {
  if (!Array.isArray(tasks)) throw new Error('meta_snapshot_tasks_invalid');
  const byPoint = planNodeMap(plan);
  const projected = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
    const meta = matchingMetaTask(task, plan);
    if (!meta) continue;

    let taskPoint;
    let parentPoint;
    try {
      taskPoint = point(task.point_id);
      parentPoint = point(meta.parent_plan_point, 'parent_plan_point');
    } catch {
      continue;
    }
    const parentNode = byPoint.get(parentPoint);
    if (!parentNode) continue;
    const exactPoint = taskPoint === parentPoint;
    const companionPoint = taskPoint.startsWith(`${parentPoint}.`) && meta.parent_point_id === parentPoint;
    if (!exactPoint && !companionPoint) continue;

    const observedState = String(task.state || '').toUpperCase();
    const stateKnown = KNOWN_TASK_STATES.has(observedState);
    const observedBase = String(task.base_sha || '').toLowerCase();
    const baseMatches = SHA40_RE.test(observedBase) && observedBase === String(parentNode.base_sha || '').toLowerCase();
    const authoritySafe = task.authority_effect !== true;
    const projectedState = stateKnown && baseMatches && authoritySafe ? observedState : 'FENCED';

    projected.push(Object.freeze({
      point_id: taskPoint,
      parent_plan_point: parentPoint,
      state: projectedState,
      observed_state: stateKnown ? observedState : 'UNKNOWN',
      base_sha: baseMatches ? observedBase : null,
      lease_generation: nonNegativeInt(task.lease_generation ?? 0, 'lease_generation'),
      updated_at: safeTime(task.updated_at),
      task_spec_included: false,
      result_summary_included: false,
      scheduler_identity_included: false,
      page_model_worker_text_authority: false,
      authority_effect: false,
    }));
  }
  return Object.freeze(projected);
}

function evidenceKind(stepKind) {
  const raw = String(stepKind || '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-');
  if (!raw) throw new Error('meta_snapshot_evidence_kind_invalid');
  return `roadmap_receipt:${raw}`.slice(0, 128);
}

export function projectVerifiedRoadmapReceipts(receipts = [], { plan } = {}) {
  if (!Array.isArray(receipts)) throw new Error('meta_snapshot_receipts_invalid');
  const byPoint = planNodeMap(plan);
  const out = [];
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) continue;
    if (String(receipt.roadmap_id || '') !== String(plan.roadmap_id || '')) continue;
    if (String(receipt.status || '').toUpperCase() !== 'VERIFIED') continue;
    const checkpoint = String(receipt.result_checkpoint_id || '').trim();
    if (!CHECKPOINT_RE.test(checkpoint)) continue;
    let pointId;
    try { pointId = point(receipt.milestone_key); } catch { continue; }
    if (!byPoint.has(pointId)) continue;
    out.push(Object.freeze({
      point_id: pointId,
      kind: evidenceKind(receipt.step_kind),
      verified: true,
      verification_source: 'ROADMAP_STEP_RECEIPT',
      checkpoint_id: checkpoint,
      receipt_id: Number.isSafeInteger(Number(receipt.receipt_id)) ? Number(receipt.receipt_id) : null,
      verified_at: safeTime(receipt.created_at),
      summary_included: false,
      evidence_blob_included: false,
      page_model_worker_text_authority: false,
      authority_effect: false,
    }));
  }
  return Object.freeze(out);
}

export function buildMetaAuthoritativeSnapshot({
  roadmapAuthority,
  plan,
  observedPlanGeneration,
  tasks = [],
  roadmapReceipts = [],
  capacity = {},
  workerObserver = null,
} = {}) {
  const authority = projectMetaRoadmapAuthority(roadmapAuthority);
  planNodeMap(plan);
  const observedGeneration = positiveInt(observedPlanGeneration, 'observed_plan_generation');
  const availableSlots = nonNegativeInt(capacity?.available_slots ?? 0, 'available_slots', 4096);
  const capacitySource = capacity?.source == null ? 'UNSPECIFIED_FAIL_CLOSED' : String(capacity.source).toUpperCase();
  if (!['DEVOS_SCHEDULER_SNAPSHOT', 'SIGNED_BROWSER_FLEET', 'UNSPECIFIED_FAIL_CLOSED'].includes(capacitySource)) {
    throw new Error('meta_snapshot_capacity_source_invalid');
  }
  const safeAvailableSlots = capacitySource === 'UNSPECIFIED_FAIL_CLOSED' ? 0 : availableSlots;
  const taskRows = projectDevosTasksForMetaPlan(tasks, { plan });
  const evidenceRows = projectVerifiedRoadmapReceipts(roadmapReceipts, { plan });

  return zeroAuthority({
    schema: 'metaengine.meta-orchestrator.authoritative-snapshot.v1',
    authority,
    observed_alignment_epoch: authority.alignment_epoch,
    observed_plan_generation: observedGeneration,
    tasks: taskRows,
    evidence: evidenceRows,
    capacity: Object.freeze({
      available_slots: safeAvailableSlots,
      source: capacitySource,
      worker_observer_contribution: 0,
      authority_effect: false,
    }),
    worker_observer: workerObserver ? Object.freeze({
      present: true,
      telemetry_only: true,
      capacity_contribution: 0,
      evidence_contribution: 0,
      scheduler_authority: false,
      authority_effect: false,
    }) : null,
    raw_task_spec_included: false,
    raw_result_summary_included: false,
    raw_receipt_evidence_included: false,
  });
}

export function reconcileMetaAuthoritativeSnapshot({ plan, snapshot, leader = {}, policy = {} } = {}) {
  object(snapshot, 'authoritative_snapshot');
  if (snapshot.schema !== 'metaengine.meta-orchestrator.authoritative-snapshot.v1') throw new Error('meta_snapshot_schema_invalid');
  return reconcileMetaOrchestrator({
    plan,
    observed_alignment_epoch: snapshot.observed_alignment_epoch,
    observed_plan_generation: snapshot.observed_plan_generation,
    leader,
    tasks: snapshot.tasks,
    evidence: snapshot.evidence,
    capacity: snapshot.capacity,
    policy,
  });
}
