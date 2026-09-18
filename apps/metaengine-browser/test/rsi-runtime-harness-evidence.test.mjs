
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  createRsiHarnessComponentRegistry,
  createRsiHarnessTraceIr,
  createRsiHarnessFlawRecord,
  createRsiHarnessRepairSpec,
  createRsiHarnessRepairOutcome,
} from '../src/rsi-trace-guided-harness-repair.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const OTHER_SHA = 'b0af13c0640fffb4b6d5da1645220e32786b5ec1';
const d = (c) => `sha256:${c.repeat(64)}`;

function registry(sourceSha = SOURCE_SHA) {
  return createRsiHarnessComponentRegistry({
    registry_id: 'registry.runtime.harness.1',
    source_sha: sourceSha,
    components: [
      {
        component_id: 'comp.tools',
        path: 'apps/metaengine-browser/src/tool-router.mjs',
        layer: 'TOOLS',
        component_digest: d('1'),
        editable: true,
        revertible: true,
        authority_root: false,
      },
      {
        component_id: 'comp.governance',
        path: 'apps/metaengine-browser/src/governance-root.mjs',
        layer: 'GOVERNANCE',
        component_digest: d('2'),
        editable: false,
        revertible: false,
        authority_root: true,
      },
    ],
    external_registry_builder: true,
    authored_by_candidate: false,
  });
}

function failedTrace(reg = registry(), id = 'trace.runtime.1') {
  return createRsiHarnessTraceIr({
    trace_id: id,
    source_sha: reg.source_sha,
    task_id: 'task.runtime.harness.1',
    environment_family: 'WINDOWS_BROWSER',
    outcome: 'FAIL',
    registry: reg,
    evaluator_root_digest: d('a'),
    steps: [
      {
        step_id: 'step.tool',
        kind: 'TOOL_REQUEST',
        component_id: 'comp.tools',
        predecessor_step_ids: [],
        event_code: 'TOOL_REQUESTED',
        result_code: 'ROUTING_MISS',
        payload_digest: d('3'),
        provenance_digest: d('4'),
      },
    ],
    evidence_refs: ['RUN_RUNTIME_HARNESS_1'],
    external_trace_compiler: true,
    authored_by_candidate: false,
  });
}

function bundle(sourceSha = SOURCE_SHA) {
  const reg = registry(sourceSha);
  const trace = failedTrace(reg);
  const flaw = createRsiHarnessFlawRecord({
    flaw_id: 'flaw.runtime.tool-routing.1',
    registry: reg,
    traces: [trace],
    responsible_component_id: 'comp.tools',
    failure_code: 'TOOL_ROUTING_MISS',
    evidence_step_ids: ['STEP.TOOL'],
    repair_operator: 'TOOL_CONTRACT_REPAIR',
    external_diagnostician: true,
    authored_by_candidate: false,
  });
  const spec = createRsiHarnessRepairSpec({
    repair_id: 'repair.runtime.tool-routing.1',
    flaw_record: flaw,
    registry: reg,
    source_sha: sourceSha,
    predicted_failure_code_reduction: 'TOOL_ROUTING_MISS',
    predicted_objective_codes: ['TASK_SUCCESS_UP'],
    regression_guard_codes: ['NO_AUTHORITY_REGRESSION'],
    heldout_suite_digest: d('c'),
    matched_budget_digest: d('d'),
    external_repair_planner: true,
    authored_by_candidate: false,
  });
  const outcome = createRsiHarnessRepairOutcome({
    repair_spec: spec,
    target_failure_count_before: 10,
    target_failure_count_after: 4,
    matched_budget_baseline_delta: 0.08,
    heldout_delta: 0.02,
    unacceptable_regression_count: 0,
    objective_deltas: [{ code: 'TASK_SUCCESS', delta: 0.08 }],
    evidence_refs: ['HELDOUT_RUNTIME_1', 'MATCHED_RUNTIME_1'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  return { reg, trace, flaw, spec, outcome };
}

test('runtime persists only verified harness evidence summaries and keeps zero authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-harness-evidence-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await runtime.start();
    const { reg, trace, flaw, spec, outcome } = bundle();

    const a = await runtime.recordHarnessTrace({ registry: reg, trace });
    const b = await runtime.recordHarnessFlaw({ registry: reg, flaw_record: flaw });
    const c = await runtime.recordHarnessRepairSpec({ repair_spec: spec });
    const e = await runtime.recordHarnessRepairOutcome({ repair_spec: spec, repair_outcome: outcome });

    for (const row of [a, b, c, e]) {
      assert.equal(row.already_recorded, false);
      assert.equal(row.authority_effect, false);
      assert.match(row.evidence_digest, /^sha256:[0-9a-f]{64}$/);
    }

    const snapshot = runtime.snapshot();
    assert.equal(snapshot.harness_evidence_count, 4);
    assert.equal(snapshot.harness_evidence_capacity, 1024);
    assert.equal(snapshot.harness_evidence_mode, 'VERIFIED_DIGEST_SUMMARY_ONLY');
    assert.equal(snapshot.execution_authority, false);
    assert.equal(snapshot.scheduler_authority, false);
    assert.equal(snapshot.promotion_authority, false);
    assert.equal(snapshot.self_update_authority, false);

    const events = snapshot.ledger.event_count;
    assert.ok(events >= 5);
    const rows = runtime.snapshot().ledger;
    assert.equal(rows.raw_page_text_allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('identical harness evidence is durable-idempotent and does not append a second event', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-harness-idempotent-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await runtime.start();
    const { reg, trace } = bundle();

    const first = await runtime.recordHarnessTrace({ registry: reg, trace });
    const before = runtime.snapshot().ledger.event_count;
    const second = await runtime.recordHarnessTrace({ registry: reg, trace });
    const after = runtime.snapshot().ledger.event_count;

    assert.equal(first.already_recorded, false);
    assert.equal(second.already_recorded, true);
    assert.equal(second.evidence_digest, first.evidence_digest);
    assert.equal(after, before);
    assert.equal(runtime.snapshot().harness_evidence_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('restart replays harness evidence digests before accepting duplicate evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-harness-restart-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const { reg, trace, flaw, spec, outcome } = bundle();
    const first = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await first.start();
    await first.recordHarnessTrace({ registry: reg, trace });
    await first.recordHarnessFlaw({ registry: reg, flaw_record: flaw });
    await first.recordHarnessRepairSpec({ repair_spec: spec });
    await first.recordHarnessRepairOutcome({ repair_spec: spec, repair_outcome: outcome });

    const second = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await second.start();
    const before = second.snapshot().ledger.event_count;
    const duplicate = await second.recordHarnessRepairOutcome({ repair_spec: spec, repair_outcome: outcome });
    const after = second.snapshot().ledger.event_count;

    assert.equal(second.snapshot().harness_evidence_count, 4);
    assert.equal(duplicate.already_recorded, true);
    assert.equal(after, before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime rejects harness evidence from a different exact source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-harness-source-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await runtime.start();
    const other = bundle(OTHER_SHA);

    await assert.rejects(
      () => runtime.recordHarnessTrace({ registry: other.reg, trace: other.trace }),
      /harness_trace_source_mismatch/,
    );
    await assert.rejects(
      () => runtime.recordHarnessFlaw({ registry: other.reg, flaw_record: other.flaw }),
      /harness_flaw_source_or_registry_mismatch/,
    );
    await assert.rejects(
      () => runtime.recordHarnessRepairSpec({ repair_spec: other.spec }),
      /harness_repair_source_mismatch/,
    );
    await assert.rejects(
      () => runtime.recordHarnessRepairOutcome({ repair_spec: other.spec, repair_outcome: other.outcome }),
      /harness_outcome_source_or_repair_mismatch/,
    );
    assert.equal(runtime.snapshot().harness_evidence_count, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
