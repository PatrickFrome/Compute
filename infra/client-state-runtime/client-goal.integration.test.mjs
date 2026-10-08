import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createIsolatedGoalFixture, goalFixtureConfig } from './test/isolated-goal-fixture.mjs';
import { createClientGoalJournalFileStore } from '../../apps/metaengine-browser/src/client-goal-journal-file-store.mjs';
import { normalizeClientGoalSubmissionReadback, normalizeClientGoalProgressReadback,
  normalizeClientGoalExecutionProofReadback } from '../../apps/metaengine-browser/src/client-control-contract.mjs';

const config = goalFixtureConfig();
const PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
const MARKER = '/a2-browser-native-supervisor-v1';
const sha = value => createHash('sha256').update(value).digest('hex');

test('signed synthetic client goals survive complete local runtime restart without dispatch', { skip: !config, timeout: 240000 }, async () => {
  const owned = await createIsolatedGoalFixture(config);
  const probes = [];
  let success = false;
  let failure;
  let submitRequests = 0;
  let restartReceipt;
  try {
    const clientId = 'synthetic-goal-test-' + randomUUID();
    const deviceId = randomUUID();
    const pairing = randomBytes(32).toString('hex');
    const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const exported = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
    const publicJwk = { crv: exported.crv, ext: true, key_ops: ['verify'], kty: exported.kty, x: exported.x, y: exported.y };
    await owned.sql.begin(async tx => {
      await tx.unsafe('INSERT INTO public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash,label) VALUES($1,$2)', [pairing, clientId]);
      await tx.unsafe(`INSERT INTO public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
        VALUES($1::uuid,$2,$3::jsonb,$4,$5)`, [deviceId, clientId, owned.sql.json(publicJwk), sha(JSON.stringify(publicJwk)), pairing]);
    });
    const signed = async (route, body, { nonce = randomBytes(24).toString('base64url') } = {}) => {
      const text = JSON.stringify(body);
      const timestamp = new Date().toISOString();
      const bodyHash = sha(text);
      const material = [PROFILE, `device_id:${deviceId}`, 'method:POST', `path:${MARKER}${route}`, `timestamp:${timestamp}`, `nonce:${nonce}`, `body_sha256:${bodyHash}`].join('\n');
      const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, Buffer.from(material))).toString('base64url');
      return { method: 'POST', body: text, signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
        'x-a2-chat-bridge-client': clientId, 'x-a2-device-profile': PROFILE, 'x-a2-device-id': deviceId,
        'x-a2-device-timestamp': timestamp, 'x-a2-device-nonce': nonce, 'x-a2-device-body-sha256': bodyHash, 'x-a2-device-signature': signature } };
    };
    const invoke = async (route, body, expectedStatus, probe) => {
      if (route === '/v1/meta/client-goal-submit') submitRequests += 1;
      const response = await fetch(owned.runtime.endpoint + route, await signed(route, body));
      const value = await response.json();
      assert.equal(response.status, expectedStatus, probe + ':' + String(value.error || value.reason || 'unexpected_status'));
      probes.push({ probe, status: response.status });
      return value;
    };
    const progress = async (requestId, receipt = null, probe = 'exact_goal_progress') => normalizeClientGoalProgressReadback(
      await invoke('/v1/meta/client-goal-progress', { request_id: requestId }, 200, probe), requestId, receipt);
    const proof = async (requestId, receipt = null, probe = 'unexecuted_goal_has_no_result_proof') => normalizeClientGoalExecutionProofReadback(
      await invoke('/v1/meta/client-goal-execution-proof', { request_id: requestId }, 200, probe), requestId, receipt);
    const absentId = randomUUID();
    assert.equal((await progress(absentId, null, 'missing_request_has_no_progress')).found, false);
    assert.equal((await proof(absentId, null, 'missing_request_has_no_execution_proof')).found, false);
    const overridden = await invoke('/v1/meta/client-goal-progress', { request_id: absentId, workspace_id: randomUUID() }, 400, 'workspace_override_fenced');
    assert.equal(overridden.error, 'workspace_override_forbidden');
    const malformed = await invoke('/v1/meta/client-goal-progress', { request_id: 'not-a-uuid' }, 400, 'invalid_request_id_fenced');
    assert.equal(malformed.error, 'client_goal_request_id_invalid');
    await owned.sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET admin_scopes=$1::jsonb WHERE device_id=$2::uuid', [owned.sql.json(['DIAGNOSTICS']), deviceId]);
    const denied = await invoke('/v1/meta/client-goal-progress', { request_id: absentId }, 401, 'admin_scope_fenced');
    assert.equal(denied.reason, 'ADMIN_GRANT_REQUIRED');
    await owned.sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET admin_scopes=$1::jsonb WHERE device_id=$2::uuid', [owned.sql.json(['CONTROL_PLANE', 'DEVOS', 'FLEET', 'DIAGNOSTICS']), deviceId]);

    const store = createClientGoalJournalFileStore(owned.journalDirectory);
    await store.journal.load();
    const firstId = randomUUID();
    const firstGoal = 'Synthetic local goal one';
    await store.journal.begin({ request_id: firstId, goal: firstGoal });
    const receipt = normalizeClientGoalSubmissionReadback(await invoke('/v1/meta/client-goal-submit', { request_id: firstId, objective: firstGoal }, 200,
      'signed_goal_atomic_submission'), firstGoal, firstId);
    assert.equal(receipt.plan_generation, 1);
    assert.equal(receipt.automatic_retry_allowed, false);
    await store.journal.recordSubmission(receipt);
    const observed = await progress(firstId, receipt);
    assert.equal(observed.task_state, 'READY');
    assert.equal(observed.terminal, false);
    assert.equal(observed.lease_generation, 0);
    await store.journal.recordProgress(observed);
    const unexecuted = await proof(firstId, receipt);
    assert.equal(unexecuted.user_goal_to_agent_readback, false);
    assert.equal(unexecuted.user_goal_to_result_readback, false);
    await store.journal.recordExecutionProof(unexecuted);
    const reloaded = createClientGoalJournalFileStore(owned.journalDirectory);
    await reloaded.journal.load();
    assert.equal(reloaded.journal.get(firstId).state, 'READY');
    assert.equal(reloaded.journal.get(firstId).receipt.task_id, receipt.task_id);
    assert.equal(reloaded.journal.get(firstId).execution_proof.user_goal_to_result_readback, false);
    probes.push({ probe: 'durable_client_journal_reload', status: 'PASS' });

    // Discard one accepted transport response; recovery reads the prewritten ID and never resubmits.
    const lostId = randomUUID();
    const lostGoal = 'Synthetic local goal two';
    await reloaded.journal.begin({ request_id: lostId, goal: lostGoal });
    const discarded = await fetch(owned.runtime.endpoint + '/v1/meta/client-goal-submit', await signed('/v1/meta/client-goal-submit', { request_id: lostId, objective: lostGoal }));
    submitRequests += 1;
    assert.equal(discarded.status, 200, 'second_synthetic_goal_submit');
    await discarded.arrayBuffer();
    await reloaded.journal.markReconcileRequired(lostId, new Error('synthetic_response_discarded'));
    const restart = createClientGoalJournalFileStore(owned.journalDirectory);
    await restart.journal.load();
    assert.equal(restart.journal.get(lostId).state, 'RECONCILE_REQUIRED');
    const recovered = await progress(lostId, null, 'response_loss_reconciled_without_resubmit');
    assert.equal(recovered.found, true);
    assert.equal(recovered.task_state, 'READY');
    assert.equal(recovered.plan_generation, 2);
    await restart.journal.recordProgress(recovered);
    const recoveredProof = await proof(lostId, null, 'response_loss_does_not_infer_execution');
    assert.equal(recoveredProof.user_goal_to_agent_readback, false);
    assert.equal(recoveredProof.user_goal_to_result_readback, false);
    await restart.journal.recordExecutionProof(recoveredProof);
    assert.equal(submitRequests, 2);
    const original = await progress(firstId, receipt, 'first_goal_progress_survives_plan_retirement');
    assert.equal(original.task_id, receipt.task_id);
    assert.equal(original.plan_generation, 1);

    const collision = await invoke('/v1/meta/client-goal-submit', { request_id: firstId, objective: 'Synthetic different intent' }, 409, 'request_collision_does_not_add_goal');
    assert.equal(collision.error, 'client_goal_submit_fenced');

    const persistentTables = ['destruktion_meta.client_v1_goal_request_h205f22', 'destruktion_meta.devos_fleet_task_h205f22',
      'destruktion_meta.meta_orchestrator_plan_state_h205f22', 'destruktion_meta.metaengine_devos_roadmap_authority_h205f22',
      'public.compute_fabric_a2_browser_device_h205f22', 'public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22'];
    const nonceTable = 'public.compute_fabric_a2_browser_device_nonce_h205f22';
    const exactRows = async tables => {
      const rows = {};
      for (const table of tables) {
        const [value] = await owned.sql.unsafe(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb) AS rows FROM ${table} t`);
        rows[table] = value.rows;
      }
      return rows;
    };
    const replayRoute = '/v1/meta/client-goal-progress';
    const replayRequest = await signed(replayRoute, { request_id: firstId });
    const admittedNonce = await fetch(owned.runtime.endpoint + replayRoute, replayRequest);
    assert.equal(admittedNonce.status, 200);
    await admittedNonce.arrayBuffer();
    const databaseBeforeRestart = await exactRows([...persistentTables, nonceTable]);
    const journalBeforeRestart = await readFile(restart.target);
    const oldApiHealthProbe = owned.captureApiHealthProbe();
    const previousApi = await oldApiHealthProbe();
    assert.equal(previousApi.status, 200);
    await previousApi.arrayBuffer();
    const submissionsBeforeRestart = submitRequests;
    restartReceipt = await owned.restart();
    assert.equal(restartReceipt.complete_stop_observed, true);
    assert.equal(restartReceipt.api_key_rotated, true);
    assert.notEqual(restartReceipt.before_instance_id, restartReceipt.after_instance_id);
    assert.deepEqual(await exactRows([...persistentTables, nonceTable]), databaseBeforeRestart, 'all goal, plan, task, device and nonce rows survive complete process restart');
    assert.deepEqual(await readFile(restart.target), journalBeforeRestart, 'client journal bytes survive complete process restart');
    probes.push({ probe: 'complete_postgres_api_edge_restart_preserves_exact_rows_and_journal', status: 'PASS' });
    const previousCredential = await oldApiHealthProbe();
    assert.equal(previousCredential.status, 401);
    await previousCredential.arrayBuffer();
    const currentCredential = await owned.captureApiHealthProbe()();
    assert.equal(currentCredential.status, 200);
    const apiHealth = await currentCredential.json();
    assert.equal(apiHealth.instance_id, owned.runtime.instanceId);
    probes.push({ probe: 'old_api_key_rejected_fresh_api_key_accepted', statuses: [401, 200] });
    // Re-sign with a current timestamp so a slow restart cannot turn this
    // durable ledger probe into a timestamp-window rejection.
    const freshReplayRequest = await signed(replayRoute, { request_id: firstId }, { nonce: replayRequest.headers['x-a2-device-nonce'] });
    const replayedNonce = await fetch(owned.runtime.endpoint + replayRoute, freshReplayRequest);
    assert.equal(replayedNonce.status, 401);
    const replayFence = await replayedNonce.json();
    assert.equal(replayFence.reason, 'NONCE_REPLAY');
    assert.deepEqual(await exactRows([nonceTable]), { [nonceTable]: databaseBeforeRestart[nonceTable] });
    probes.push({ probe: 'durable_nonce_replay_rejected_after_whole_runtime_restart', status: 401, fence: 'NONCE_REPLAY' });
    const rebootedJournal = createClientGoalJournalFileStore(owned.journalDirectory);
    await rebootedJournal.journal.load();
    assert.deepEqual(rebootedJournal.journal.snapshot(), restart.journal.snapshot());
    for (const [requestId, expectedReceipt, expectedProgress, expectedProof] of [
      [firstId, receipt, original, unexecuted], [lostId, null, recovered, recoveredProof],
    ]) {
      const afterProgress = await progress(requestId, expectedReceipt, 'fresh_signed_goal_progress_after_restart');
      const afterProof = await proof(requestId, expectedReceipt, 'fresh_signed_goal_proof_after_restart');
      assert.deepEqual(afterProgress, expectedProgress);
      assert.deepEqual(afterProof, expectedProof);
      await rebootedJournal.journal.recordProgress(afterProgress);
      await rebootedJournal.journal.recordExecutionProof(afterProof);
      assert.equal(rebootedJournal.journal.get(requestId).state, 'READY');
      assert.equal(rebootedJournal.journal.get(requestId).execution_proof.user_goal_to_result_readback, false);
    }
    assert.equal(submitRequests, submissionsBeforeRestart, 'restart recovery must never resubmit a goal');
    assert.deepEqual(await exactRows(persistentTables), Object.fromEntries(persistentTables.map(table => [table, databaseBeforeRestart[table]])));
    restartReceipt = { ...restartReceipt, exact_goal_task_plan_device_rows_preserved: true, exact_nonce_ledger_preserved_before_recovery: true,
      exact_client_journal_preserved: true, persisted_nonce_replay_rejected: true, fresh_signed_readback_recovered: true,
      recovery_goal_submissions: 0, recovery_effect_requests: 0, goal_execution_proven: false };
    probes.push({ probe: 'fresh_signed_goal_recovery_has_zero_resubmission_or_execution', status: 'PASS' });

    const tasks = await owned.sql.unsafe('SELECT state, lease_generation, lease_agent_id, lease_tab_id, lease_target_id, lease_agent_generation_epoch FROM destruktion_meta.devos_fleet_task_h205f22');
    assert.equal(tasks.length, 2);
    for (const task of tasks) {
      assert.equal(task.state, 'READY');
      assert.equal(Number(task.lease_generation), 0);
      for (const key of ['lease_agent_id', 'lease_tab_id', 'lease_target_id', 'lease_agent_generation_epoch']) assert.equal(task[key], null);
    }
    for (const table of ['destruktion_meta.devos_fleet_claim_h205f22', 'destruktion_meta.devos_fleet_runtime_control_h205f22',
      'public.compute_fabric_a2_browser_supervisor_state_h205f22', 'public.compute_fabric_a2_browser_supervisor_command_h205f22']) {
      const [row] = await owned.sql.unsafe('SELECT count(*)::int AS count FROM ' + table);
      assert.equal(row.count, 0, 'no_dispatch_side_effects:' + table);
    }
    const [requests] = await owned.sql.unsafe('SELECT count(*)::int AS count FROM destruktion_meta.client_v1_goal_request_h205f22');
    assert.equal(requests.count, 2);
    const plans = await owned.sql.unsafe('SELECT state FROM destruktion_meta.meta_orchestrator_plan_state_h205f22 ORDER BY plan_generation');
    assert.deepEqual(plans.map(row => row.state), ['SUPERSEDED', 'ACTIVE']);
    probes.push({ probe: 'two_owned_ready_tasks_zero_claims_commands_or_control_changes', status: 'PASS' });
    success = true;
  } catch (error) { failure = error; }
  finally {
    await owned.stop();
    const reportPath = process.env.LOCAL_STATE_TEST_GOAL_REPORT_PATH;
    if (reportPath) {
      assert.ok(path.isAbsolute(reportPath));
      const relative = path.relative(path.resolve(import.meta.dirname, '../..'), reportPath);
      assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'private_report_must_be_outside_repository');
      await writeFile(reportPath, JSON.stringify({ schema: 'compute.synthetic-client-goal-verification.v1', verified_at: new Date().toISOString(),
        status: success && !failure ? 'PASS' : 'FAIL', evidence_level: 'ISOLATED_SCHEMA_FIXTURE_SMOKE', ...owned.fixture,
        probes, whole_runtime_restart: restartReceipt || null, owned_fixture_removed: true, signed_transport: true, source_data_restored: false, hosted_requests: false,
        installed_profile_changed: false, goal_execution_proven: false, complete_acceptance_proven: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
  }
  if (failure) {
    if (failure.code && !String(failure.code).startsWith('ERR_ASSERTION')) throw new Error('synthetic_goal_verification_failed:' + failure.code);
    throw failure;
  }
});
