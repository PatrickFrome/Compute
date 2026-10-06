import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createMetaSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/meta-routes.mjs';

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const requestId = '11111111-1111-4111-8111-111111111111';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';

const sql = await readFile(
  new URL('../supabase/client-v1-c5-useful-work-readback-v1.sql', import.meta.url),
  'utf8',
);
const native = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

const sha = (char) => char.repeat(64);

function usefulWork(overrides = {}) {
  return {
    schema: 'metaengine.client-v1.useful-work-proof.v1',
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 4,
    alignment_epoch: 3,
    baseline_sha: 'b'.repeat(40),
    plan_sha256: sha('c'),
    point_id: 'obj.ship-useful-work.v1',
    task_id: taskId,
    task_spec_sha256: sha('d'),
    lease_generation: 2,
    result_sha256: sha('1'),
    claim_sha256: sha('2'),
    conversation_url_sha256: sha('a'),
    evidence_class: 'LIVE',
    evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
    repository: {
      repository_identity_sha256: sha('3'),
      checkout_sha: 'b'.repeat(40),
      source_snapshot_sha256: sha('4'),
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: sha('5'),
      changed_file_manifest_sha256: sha('6'),
      changed_file_count: 1,
      materialized_edit_operations: 2,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: sha('7'),
      pre_repair_receipt_sha256: sha('8'),
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: sha('9'),
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: sha('e'),
      artifact_bytes: 4096,
      artifact_subject_sha256: sha('e'),
      provenance_sha256: sha('f'),
      verification_receipt_sha256: sha('0'),
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: sha('1'),
      independent_verifier: true,
      accepted: true,
      accepted_artifact_sha256: sha('e'),
      authority_effect: false,
    },
    serial_loop_end_to_end: true,
    user_goal_to_verified_artifact_readback: true,
    client_c5_useful_work_verified: true,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

function req(method = 'POST') {
  return { method };
}

test('PREPARE_ONLY SQL is service-role-only and deliberately outside migration history', () => {
  assert.match(sql, /PREPARE_ONLY Client V1 C5 useful-work readback contract/);
  assert.match(sql, /intentionally NOT a migration/);
  assert.match(sql, /supabase migration new/);
  assert.match(
    sql,
    /revoke all on function public\.client_v1_goal_useful_work_proof_v1\(uuid,uuid\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.client_v1_goal_useful_work_proof_v1\(uuid,uuid\)\s+to service_role;/,
  );
});

test('SQL derives execution identity from existing proof and useful-work acceptance from a separate trusted verifier event', () => {
  assert.match(
    sql,
    /v_execution := public\.client_v1_goal_execution_proof_v1\(p_workspace_id, p_request_id\)/,
  );
  assert.match(sql, /event_type = 'TASK_USEFUL_WORK_VERIFIED'/);
  assert.match(sql, /proof_contract','METAENGINE_USEFUL_WORK_VERIFIED_V1'/);
  assert.match(sql, /verifier_origin','TRUSTED_SERVER_VERIFIER'/);
  assert.match(sql, /e\.workspace_id = p_workspace_id/);
  assert.match(sql, /e\.task_id = v_task_id/);
  assert.match(sql, /e\.point_id = v_execution->>'point_id'/);
  assert.match(sql, /e\.base_sha = v_execution->>'baseline_sha'/);
  assert.match(sql, /e\.lease_generation = v_lease_generation/);
  assert.match(sql, /result_sha256.*result_proof,result_sha256/s);
  assert.match(sql, /claim_sha256.*result_proof,claim_sha256/s);
  assert.match(sql, /conversation_url_sha256.*agent_origin_proof,conversation_url_sha256/s);

  const functionBody = sql.slice(sql.indexOf('as $$') + 5, sql.indexOf('$$;', sql.indexOf('as $$')));
  assert.doesNotMatch(functionBody, /v_task\.result_summary|payload->>'result_summary'/i);
  assert.doesNotMatch(functionBody, /devos_emit_event_h205f22/i);
  assert.doesNotMatch(functionBody, /\binsert\s+into\b|\bupdate\s+destruktion_meta\b|\bdelete\s+from\b/i);
});

test('SQL output is digest-only LIVE evidence with no canonical promotion authority', () => {
  assert.match(sql, /'evidence_class','LIVE'/);
  assert.match(sql, /'evidence_origin','SIGNED_SUPERVISOR_READBACK'/);
  assert.match(sql, /'client_c5_useful_work_verified',true/);
  assert.match(sql, /'canonical_c2_promotion_authorized',false/);
  assert.match(sql, /'automatic_retry_allowed',false/);
  assert.match(sql, /'scheduler_authority',false/);
  assert.match(sql, /'browser_authority',false/);
  assert.match(sql, /'release_authority',false/);
  assert.match(sql, /'authority_effect',false/);
  assert.match(sql, /'raw_patch_included'\)::boolean,true\) is not false/);
  assert.match(sql, /'raw_logs_included'\)::boolean,true\) is not false/);
  assert.match(sql, /'model_output_included'\)::boolean,true\) is not false/);
  assert.match(sql, /'page_content_included'\)::boolean,true\) is not false/);
});

test('Edge useful-work route fixes workspace server-side and calls exact service RPC', async () => {
  const calls = [];
  const routes = createMetaSupervisorRoutes({
    workspaceId,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'client_v1_goal_useful_work_proof_v1') return usefulWork();
      throw new Error('unexpected_rpc');
    },
  });

  const response = await routes({
    req: req(),
    path: '/v1/meta/client-goal-useful-work-proof',
    body: { request_id: requestId },
    clientId: 'device-a',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.client_c5_useful_work_verified, true);
  assert.equal(body.canonical_c2_promotion_authorized, false);
  assert.deepEqual(calls, [{
    name: 'client_v1_goal_useful_work_proof_v1',
    args: { p_workspace_id: workspaceId, p_request_id: requestId },
  }]);
});

test('Edge useful-work route rejects workspace override and extra caller fields before RPC', async () => {
  let calls = 0;
  const routes = createMetaSupervisorRoutes({
    workspaceId,
    rpc: async () => {
      calls += 1;
      throw new Error('must_not_call');
    },
  });

  const workspaceOverride = await routes({
    req: req(),
    path: '/v1/meta/client-goal-useful-work-proof',
    body: { request_id: requestId, workspace_id: workspaceId },
    clientId: 'device-a',
  });
  assert.equal(workspaceOverride.status, 400);

  const extra = await routes({
    req: req(),
    path: '/v1/meta/client-goal-useful-work-proof',
    body: { request_id: requestId, retry: true },
    clientId: 'device-a',
  });
  assert.equal(extra.status, 400);
  assert.equal(calls, 0);
});

test('Edge useful-work route preserves explicit absence as a non-claim', async () => {
  const routes = createMetaSupervisorRoutes({
    workspaceId,
    rpc: async () => ({
      schema: 'metaengine.client-v1.useful-work-proof.v1',
      found: false,
      request_id: requestId,
      workspace_id: workspaceId,
      user_goal_to_verified_artifact_readback: false,
      client_c5_useful_work_verified: false,
      canonical_c2_promotion_authorized: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    }),
  });

  const response = await routes({
    req: req(),
    path: '/v1/meta/client-goal-useful-work-proof',
    body: { request_id: requestId },
    clientId: 'device-a',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.found, false);
  assert.equal(body.client_c5_useful_work_verified, false);
  assert.equal(body.canonical_c2_promotion_authorized, false);
});

test('Edge validator refuses raw patch/log/model/page material even from service-role RPC output', async () => {
  for (const [field, value] of [
    ['patch', 'raw patch'],
    ['stdout', 'raw log'],
    ['model_output', 'raw model output'],
    ['page_content', 'raw page content'],
  ]) {
    const routes = createMetaSupervisorRoutes({
      workspaceId,
      rpc: async () => {
        const proof = usefulWork();
        proof.review = { ...proof.review, [field]: value };
        return proof;
      },
    });
    await assert.rejects(
      () => routes({
        req: req(),
        path: '/v1/meta/client-goal-useful-work-proof',
        body: { request_id: requestId },
        clientId: 'device-a',
      }),
      /client_goal_useful_work_raw_field_forbidden/,
      field,
    );
  }
});

test('Edge validator rejects forged LIVE classification or artifact/provenance drift', async () => {
  for (const proof of [
    usefulWork({ evidence_origin: 'CONTROLLED_FIXTURE' }),
    (() => {
      const row = usefulWork();
      row.artifact = { ...row.artifact, artifact_subject_sha256: sha('d') };
      return row;
    })(),
    (() => {
      const row = usefulWork();
      row.review = { ...row.review, independent_verifier: false };
      return row;
    })(),
  ]) {
    const routes = createMetaSupervisorRoutes({
      workspaceId,
      rpc: async () => proof,
    });
    await assert.rejects(
      () => routes({
        req: req(),
        path: '/v1/meta/client-goal-useful-work-proof',
        body: { request_id: requestId },
        clientId: 'device-a',
      }),
      /client_goal_useful_work_proof_/,
    );
  }
});

test('native Client exposes one signed read method with no retry or mutation fallback', () => {
  const start = native.indexOf('async clientGoalUsefulWorkProof');
  const end = native.indexOf('setControlState', start);
  assert.ok(start >= 0 && end > start);
  const method = native.slice(start, end);
  assert.match(method, /#signedRequest\('\/v1\/meta\/client-goal-useful-work-proof'/);
  assert.match(method, /request_id: String\(request_id \?\? ''\)/);
  assert.doesNotMatch(method, /clientGoalSubmit|submitClientGoal|retry|setTimeout|setInterval/);
});

test('PREPARE_ONLY contract has no main-process consumer before migration and trusted verifier writer exist', () => {
  assert.doesNotMatch(main, /clientGoalUsefulWorkProof/);
  assert.doesNotMatch(main, /client-goal-useful-work-proof/);
});
