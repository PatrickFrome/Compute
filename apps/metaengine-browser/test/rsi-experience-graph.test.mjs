import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiExperienceCase,
  verifyRsiExperienceCase,
  createRsiExperienceUtilityReceipt,
  verifyRsiExperienceUtilityReceipt,
  createRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  createRsiExperienceGraphQuery,
  verifyRsiExperienceGraphQuery,
  retrieveRsiExperienceGraph,
  verifyRsiExperienceGraphRetrieval,
  rsiExperienceGraphTrustRootSnapshot,
} from '../src/rsi-experience-graph.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;
const candidateId = (char) => `candidate_sha256_${char.repeat(64)}`;

function anchor(id, sig, family = 'COMMAND_LIVENESS', manifest = 'a') {
  return {
    task_id: id,
    task_signature_digest: d(sig),
    challenge_family: family,
    hidden_manifest_digest: d(manifest),
    external_writer: true,
    authored_by_candidate: false,
  };
}

function experienceCase({
  id,
  task = 'task.command-liveness',
  taskSig = '1',
  attempt = 1,
  candidate = '1',
  outcome = 'FAILURE',
  environment = 'WINDOWS_BROWSER',
  model = 'GPT_5_6_SOL',
  exec = '2',
  failures = ['AMBIGUOUS_RECEIPT'],
  mechanisms = ['RESULT_READBACK'],
  evidence = '3',
  lesson = [],
  attribution = [],
  transfer = [],
} = {}) {
  return createRsiExperienceCase({
    case_id: id,
    task_id: task,
    task_signature_digest: d(taskSig),
    attempt_index: attempt,
    candidate_id: candidateId(candidate),
    candidate_sha: sha(candidate),
    outcome,
    environment_fingerprint: environment,
    model_family: model,
    execution_signature_digest: d(exec),
    failure_codes: outcome === 'SUCCESS' ? [] : failures,
    mechanism_tags: mechanisms,
    lesson_digests: lesson,
    attribution_digests: attribution,
    transfer_receipt_digests: transfer,
    evidence_digest: d(evidence),
    evidence_refs: [`RUN_${id}`],
    external_writer: true,
    authored_by_candidate: false,
  });
}

function baseGraph({ utility = [] } = {}) {
  const failed = experienceCase({
    id: 'case.command.1',
    attempt: 1,
    candidate: '1',
    outcome: 'FAILURE',
    exec: '2',
    evidence: '3',
  });
  const fixed = experienceCase({
    id: 'case.command.2',
    attempt: 2,
    candidate: '2',
    outcome: 'SUCCESS',
    exec: '4',
    mechanisms: ['RESULT_READBACK', 'ONE_ATTEMPT_EFFECT'],
    evidence: '5',
    lesson: [d('6')],
    attribution: [d('7')],
  });
  return createRsiExperienceGraphSnapshot({
    graph_id: 'rsi.experience.graph.1',
    task_anchors: [anchor('task.command-liveness', '1')],
    cases: [failed, fixed],
    similarity_edges: [],
    correction_edges: [{
      from_case_id: failed.case_id,
      to_case_id: fixed.case_id,
      evidence_digest: d('8'),
      external_verifier: true,
      authored_by_candidate: false,
    }],
    utility_receipts: utility,
  });
}

test('experience case stores typed evidence only and rejects candidate-authored or raw payload smuggling', () => {
  const row = experienceCase({ id: 'case.typed.1' });
  verifyRsiExperienceCase(row);
  assert.equal(row.external_writer, true);
  assert.equal(row.authored_by_candidate, false);
  assert.equal(row.raw_trajectory_present, false);
  assert.equal(row.raw_page_text_present, false);
  assert.equal(row.raw_user_input_present, false);
  assert.equal(row.secret_material_present, false);
  assert.equal(row.model_narrative_is_authority, false);
  assert.equal(row.source_context_truth_is_portable, false);
  assert.equal(row.authority_effect, false);

  assert.throws(() => createRsiExperienceCase({
    case_id: 'case.bad.origin',
    task_id: 'task.command-liveness',
    task_signature_digest: d('1'),
    attempt_index: 1,
    candidate_id: candidateId('1'),
    candidate_sha: sha('1'),
    outcome: 'FAILURE',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    execution_signature_digest: d('2'),
    failure_codes: ['FAIL'],
    evidence_digest: d('3'),
    evidence_refs: ['RUN_BAD'],
    external_writer: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  assert.throws(() => verifyRsiExperienceCase({
    ...row,
    raw_page_text: 'private page payload',
  }), /case_fields_invalid/);
});

test('graph snapshot verifies task containment and a fixed_by edge only from earlier failure to later same-task success', () => {
  const graph = baseGraph();
  verifyRsiExperienceGraphSnapshot(graph);
  assert.equal(graph.task_anchor_count, 1);
  assert.equal(graph.case_count, 2);
  assert.equal(graph.contains_edges.length, 2);
  assert.equal(graph.correction_edge_count, 1);
  assert.equal(graph.candidate_can_write_graph, false);
  assert.equal(graph.append_only, true);
  assert.equal(graph.time_travel_by_snapshot_digest, true);

  const failed = experienceCase({ id: 'case.bad.fixed.from', attempt: 1, candidate: '3' });
  const alsoFailed = experienceCase({ id: 'case.bad.fixed.to', attempt: 2, candidate: '4', exec: '9', evidence: 'a' });
  assert.throws(() => createRsiExperienceGraphSnapshot({
    graph_id: 'rsi.experience.graph.bad',
    task_anchors: [anchor('task.command-liveness', '1')],
    cases: [failed, alsoFailed],
    correction_edges: [{
      from_case_id: failed.case_id,
      to_case_id: alsoFailed.case_id,
      evidence_digest: d('b'),
      external_verifier: true,
      authored_by_candidate: false,
    }],
  }), /correction_outcome_invalid/);
});

test('append-only extension creates a new exact snapshot epoch and forbids replacement of prior cases', () => {
  const previous = baseGraph();
  const nextAnchor = anchor('task.agent-design', '9', 'AGENT_DESIGN', 'b');
  const nextCase = experienceCase({
    id: 'case.agent.1',
    task: 'task.agent-design',
    taskSig: '9',
    candidate: '3',
    outcome: 'SUCCESS',
    attempt: 1,
    exec: 'a',
    evidence: 'b',
    mechanisms: ['CROSS_MODEL_TRANSFER'],
  });
  const next = extendRsiExperienceGraphSnapshot({
    previous_snapshot: previous,
    task_anchors: [nextAnchor],
    cases: [nextCase],
    similarity_edges: [{
      left_case_id: 'case.command.2',
      right_case_id: nextCase.case_id,
      similarity_score: 0.84,
      embedding_model_digest: d('c'),
      external_indexer: true,
      authored_by_candidate: false,
    }],
  });
  verifyRsiExperienceGraphSnapshot(next);
  assert.equal(next.epoch, previous.epoch + 1);
  assert.equal(next.predecessor_snapshot_digest, previous.snapshot_digest);
  assert.equal(next.case_count, 3);
  assert.equal(next.similarity_edge_count, 1);
  assert.notEqual(next.snapshot_digest, previous.snapshot_digest);

  assert.throws(() => extendRsiExperienceGraphSnapshot({
    previous_snapshot: previous,
    cases: [experienceCase({
      id: 'case.command.1',
      attempt: 3,
      candidate: '4',
      exec: 'd',
      evidence: 'e',
    })],
  }), /case_replacement_forbidden/);
});

test('exact task failure query follows fixed_by relation and ranks the successful correction first', () => {
  const graph = baseGraph();
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.command.failure',
    target_context_digest: d('d'),
    task_signature_digest: d('1'),
    challenge_family: 'COMMAND_LIVENESS',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    failure_codes: ['AMBIGUOUS_RECEIPT'],
    mechanism_tags: ['RESULT_READBACK'],
    bridge_case_ids: ['case.command.1'],
    external_query_context: true,
    authored_by_candidate: false,
  });
  verifyRsiExperienceGraphQuery(query);
  const result = retrieveRsiExperienceGraph({ snapshot: graph, query });
  verifyRsiExperienceGraphRetrieval(result, graph, query);

  assert.ok(result.items.length >= 2);
  assert.equal(result.items[0].case_id, 'case.command.2');
  assert.equal(result.items[0].corrective_trace_target, true);
  assert.equal(result.items[0].outcome, 'SUCCESS');
  assert.equal(result.items[0].source_context_truth_is_portable, false);
  assert.equal(result.items[0].external_transfer_validation_required, true);
  assert.equal(result.raw_trajectory_exposed, false);
  assert.equal(result.retrieval_is_execution_authority, false);
  assert.equal(result.authority_effect, false);
});

test('similarity diffusion can surface a cross-task case but never makes semantic similarity an authority signal', () => {
  const previous = baseGraph();
  const cross = experienceCase({
    id: 'case.transfer.1',
    task: 'task.transfer',
    taskSig: '9',
    candidate: '3',
    outcome: 'SUCCESS',
    attempt: 1,
    environment: 'LINUX_SANDBOX',
    model: 'GLM_5',
    exec: 'a',
    evidence: 'b',
    mechanisms: ['RESULT_READBACK', 'CROSS_MODEL_TRANSFER'],
    transfer: [d('c')],
  });
  const graph = extendRsiExperienceGraphSnapshot({
    previous_snapshot: previous,
    task_anchors: [anchor('task.transfer', '9', 'TRANSFER', 'd')],
    cases: [cross],
    similarity_edges: [{
      left_case_id: 'case.command.1',
      right_case_id: cross.case_id,
      similarity_score: 0.90,
      embedding_model_digest: d('e'),
      external_indexer: true,
      authored_by_candidate: false,
    }],
  });
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.cross-task',
    target_context_digest: d('f'),
    task_signature_digest: d('8'),
    challenge_family: 'TRANSFER',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    failure_codes: ['AMBIGUOUS_RECEIPT'],
    mechanism_tags: ['RESULT_READBACK'],
    bridge_case_ids: ['case.command.1'],
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiExperienceGraph({ snapshot: graph, query });
  const crossRow = result.items.find((row) => row.case_id === cross.case_id);
  assert.ok(crossRow);
  assert.ok(crossRow.graph_diffusion_score > 0);
  assert.equal(crossRow.exact_task_match, false);
  assert.equal(crossRow.external_transfer_validation_required, true);
  assert.equal(result.similarity_threshold, 0.70);
  assert.equal(result.max_diffusion_hops, 2);
  assert.equal(result.candidate_can_select_thresholds, false);
});

test('utility keeps exact-context dominance while verified cross-context evidence contributes only a discounted prior', () => {
  const context = d('f');
  const helpful = createRsiExperienceUtilityReceipt({
    receipt_id: 'utility.command.fixed.1',
    case_id: 'case.command.2',
    target_context_digest: context,
    outcome: 'HELPFUL',
    evidence_digest: d('1'),
    evidence_refs: ['TARGET_HOLDOUT_1'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  verifyRsiExperienceUtilityReceipt(helpful);
  const graph = baseGraph({ utility: [helpful] });
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.utility',
    target_context_digest: context,
    task_signature_digest: d('1'),
    challenge_family: 'COMMAND_LIVENESS',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    failure_codes: ['AMBIGUOUS_RECEIPT'],
    mechanism_tags: ['RESULT_READBACK'],
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiExperienceGraph({ snapshot: graph, query });
  const fixed = result.items.find((row) => row.case_id === 'case.command.2');
  assert.equal(fixed.contextual_utility.helpful, 1);
  assert.equal(fixed.contextual_utility.evidence_count, 1);
  assert.equal(fixed.contextual_utility.cross_context_evidence_count, 0);
  assert.ok(fixed.contextual_utility.posterior_mean > 0.5);

  const otherContext = createRsiExperienceGraphQuery({
    query_id: 'query.utility.other',
    target_context_digest: d('e'),
    task_signature_digest: d('1'),
    challenge_family: 'COMMAND_LIVENESS',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    external_query_context: true,
    authored_by_candidate: false,
  });
  const otherResult = retrieveRsiExperienceGraph({ snapshot: graph, query: otherContext });
  const otherFixed = otherResult.items.find((row) => row.case_id === 'case.command.2');
  assert.equal(otherFixed.contextual_utility.evidence_count, 0);
  assert.equal(otherFixed.contextual_utility.cross_context_helpful, 1);
  assert.equal(otherFixed.contextual_utility.cross_context_evidence_count, 1);
  assert.equal(otherFixed.contextual_utility.cross_context_discount_weight, 0.25);
  assert.equal(otherFixed.contextual_utility.exact_context_utility_dominates, true);
  assert.equal(otherFixed.contextual_utility.cross_context_utility_is_advisory_prior, true);
  assert.ok(otherFixed.contextual_utility.posterior_mean > 0.5);
  assert.ok(otherFixed.contextual_utility.posterior_mean < fixed.contextual_utility.posterior_mean);
});

test('candidate cannot forge utility or mutate retrieval thresholds by tampering with digested artifacts', () => {
  const graph = baseGraph();
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.tamper',
    target_context_digest: d('d'),
    task_signature_digest: d('1'),
    challenge_family: 'COMMAND_LIVENESS',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiExperienceGraph({ snapshot: graph, query });

  assert.throws(() => verifyRsiExperienceGraphQuery({
    ...query,
    candidate_can_select_similarity_threshold: true,
  }), /query_policy_invalid/);

  assert.throws(() => verifyRsiExperienceGraphSnapshot({
    ...graph,
    candidate_can_write_graph: true,
  }), /snapshot_policy_invalid/);

  assert.throws(() => verifyRsiExperienceGraphRetrieval({
    ...result,
    similarity_threshold: 0.1,
  }, graph, query), /retrieval_digest_mismatch|retrieval_items_mismatch/);
});

test('experience graph trust root fixes writer, portability, privacy and authority boundaries', () => {
  const root = rsiExperienceGraphTrustRootSnapshot();
  assert.equal(root.graph_is_append_only_snapshot_chain, true);
  assert.equal(root.task_anchor_nodes, true);
  assert.equal(root.case_nodes, true);
  assert.equal(root.correction_fixed_by_edges, true);
  assert.equal(root.contextual_utility_receipts, true);
  assert.equal(root.cross_context_utility_prior_enabled, true);
  assert.equal(root.cross_context_utility_discount_weight, 0.25);
  assert.equal(root.exact_context_utility_dominates, true);
  assert.equal(root.cross_context_utility_is_advisory_prior, true);
  assert.equal(root.source_context_truth_is_portable, false);
  assert.equal(root.external_transfer_validation_required, true);
  assert.equal(root.candidate_can_write_graph, false);
  assert.equal(root.candidate_can_edit_case, false);
  assert.equal(root.candidate_can_edit_utility, false);
  assert.equal(root.candidate_can_select_retrieval_thresholds, false);
  assert.equal(root.similarity_is_authority, false);
  assert.equal(root.raw_trajectory_stored, false);
  assert.equal(root.raw_page_text_stored, false);
  assert.equal(root.raw_user_input_stored, false);
  assert.equal(root.secret_material_stored, false);
  assert.equal(root.retrieval_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.graph_root_digest, /^sha256:[0-9a-f]{64}$/);
});


test('harmful cross-context utility decreases retrieval confidence without becoming global truth or authority', () => {
  const harmful = createRsiExperienceUtilityReceipt({
    receipt_id: 'utility.command.fixed.harmful.cross',
    case_id: 'case.command.2',
    target_context_digest: d('f'),
    outcome: 'HARMFUL',
    evidence_digest: d('2'),
    evidence_refs: ['POST_DEPLOY_REGRESSION_1'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const graph = baseGraph({ utility: [harmful] });
  const query = createRsiExperienceGraphQuery({
    query_id: 'query.utility.harmful.other',
    target_context_digest: d('e'),
    task_signature_digest: d('1'),
    challenge_family: 'COMMAND_LIVENESS',
    environment_fingerprint: 'WINDOWS_BROWSER',
    model_family: 'GPT_5_6_SOL',
    external_query_context: true,
    authored_by_candidate: false,
  });
  const result = retrieveRsiExperienceGraph({ snapshot: graph, query });
  const fixed = result.items.find((row) => row.case_id === 'case.command.2');
  assert.equal(fixed.contextual_utility.evidence_count, 0);
  assert.equal(fixed.contextual_utility.cross_context_harmful, 1);
  assert.equal(fixed.contextual_utility.cross_context_evidence_count, 1);
  assert.ok(fixed.contextual_utility.posterior_mean < 0.5);
  assert.equal(result.retrieval_is_execution_authority, false);
  assert.equal(result.retrieval_is_promotion_authority, false);
});
