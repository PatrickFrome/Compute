import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  createRsiOperatorConsole,
  RSI_OPERATOR_CONSOLE_ACTIONS,
  RSI_OPERATOR_CONSOLE_SCHEMA,
} from '../src/rsi-operator-console.mjs';

async function buildRuntime() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-console-'));
  const sourceSha = crypto.randomBytes(20).toString('hex');
  const runtime = new RsiRuntimeService({
    source_sha: sourceSha,
    ledgerPath: path.join(dir, 'rsi-ledger.jsonl'),
  });
  await runtime.start();
  return runtime;
}

test('operator console requires a runtime provider and rejects unknown actions', async () => {
  assert.throws(() => createRsiOperatorConsole({}), /rsi_operator_console_runtime_provider_required/);
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  await assert.rejects(() => console_.execute('RSI_UNKNOWN', {}), /rsi_operator_console_action_invalid/);
  await assert.rejects(() => console_.execute('', {}), /rsi_operator_console_command_invalid/);
});

test('operator console projection reports the runtime state with zero authority fences', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  const projection = await console_.projection();
  assert.equal(projection.schema, RSI_OPERATOR_CONSOLE_SCHEMA);
  assert.equal(projection.runtime_state, 'READY');
  assert.equal(projection.shadow_only, true);
  assert.equal(projection.candidate_count, 0);
  assert.equal(typeof projection.trust_root_count, 'number');
  assert.ok(projection.browser_outcome_ingest);
  assert.equal(projection.browser_outcome_ingest.outcome_count, 0);
  assert.ok(projection.command_attribution);
  assert.ok(projection.runtime_experience_store);
  for (const fence of ['scheduler_authority', 'execution_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    assert.equal(projection[fence], false, `${fence} must stay false`);
  }
});

test('operator console projection fails closed when the runtime is unavailable', async () => {
  const console_ = createRsiOperatorConsole({
    ensureRuntime: async () => {
      throw new Error('rsi_runtime_exact_source_sha_unavailable');
    },
  });
  const projection = await console_.projection();
  assert.equal(projection.runtime_state, 'UNAVAILABLE');
  assert.match(projection.reason, /rsi_runtime_exact_source_sha_unavailable/);
  assert.equal(projection.authority_effect, false);
  await assert.rejects(() => console_.execute('RSI_STATUS', {}), /rsi_operator_console_runtime_unavailable|rsi_runtime_exact_source_sha_unavailable/);
});

test('RSI_STATUS returns the bounded projection with the operator action list', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  const status = await console_.execute('RSI_STATUS', {});
  assert.equal(status.schema, RSI_OPERATOR_CONSOLE_SCHEMA);
  assert.equal(status.runtime_state, 'READY');
  assert.deepEqual([...status.operator_actions], [...RSI_OPERATOR_CONSOLE_ACTIONS]);
  assert.equal(status.authority_effect, false);
});

test('RSI_CANDIDATES returns the bounded shadow candidate list', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  const result = await console_.execute('RSI_CANDIDATES', {});
  assert.equal(result.schema, 'metaengine.rsi.operator-console.candidates.v1');
  assert.equal(result.candidate_count, 0);
  assert.deepEqual([...result.candidates], []);
  assert.equal(result.shadow_only, true);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.authority_effect, false);
});

test('RSI_EXPERIENCE returns the empty experience graph shape before the river flows', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  const result = await console_.execute('RSI_EXPERIENCE', {});
  assert.equal(result.schema, 'metaengine.rsi.operator-console.experience.v1');
  assert.equal(result.graph_present, false);
  assert.equal(result.case_count, 0);
  assert.deepEqual([...result.cases], []);
  assert.equal(result.candidate_can_write_graph, false);
  assert.equal(result.authority_effect, false);
});

test('RSI_SKILLS returns the skill lifecycle surfaces without a replacement path', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  const result = await console_.execute('RSI_SKILLS', {});
  assert.equal(result.schema, 'metaengine.rsi.operator-console.skills.v1');
  assert.ok(result.runtime_skill_lifecycle);
  assert.ok(result.runtime_skill_router);
  assert.equal(result.direct_library_replacement_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('RSI_NOMINATE_PROMOTION requires bounded inputs and delegates to the runtime', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  await assert.rejects(() => console_.execute('RSI_NOMINATE_PROMOTION', {}), /rsi_operator_console_candidate_id_invalid/);
  await assert.rejects(
    () => console_.execute('RSI_NOMINATE_PROMOTION', { candidate_id: 'x' }),
    /rsi_operator_console_qualification_digest_invalid/,
  );
  // A nonexistent candidate must fail with the runtime's own contract error.
  await assert.rejects(
    () => console_.execute('RSI_NOMINATE_PROMOTION', {
      candidate_id: 'candidate.new.nonexistent',
      qualification_digest: `sha256:${'a'.repeat(64)}`,
    }),
    /rsi_candidate_not_found|rsi_runtime_candidate_not_found|rsi_runtime_candidate_not_shadow_qualified/,
  );
});

test('RSI_ADMISSION_ATTEMPT requires an attempt id and exposes no prepare/execute path', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  await assert.rejects(() => console_.execute('RSI_ADMISSION_ATTEMPT', {}), /rsi_operator_console_attempt_id_invalid/);
  await assert.rejects(
    () => console_.execute('RSI_ADMISSION_ATTEMPT', { attempt_id: 'not-an-attempt' }),
    /rsi_operator_console_admission_attempt_not_found/,
  );
  assert.equal(RSI_OPERATOR_CONSOLE_ACTIONS.includes('RSI_ADMISSION_PREPARE'), false);
  assert.equal(RSI_OPERATOR_CONSOLE_ACTIONS.includes('RSI_ADMISSION_EXECUTE'), false);
});

test('operator console carries no authority of its own', async () => {
  const runtime = await buildRuntime();
  const console_ = createRsiOperatorConsole({ ensureRuntime: async () => runtime });
  assert.equal(console_.schema, RSI_OPERATOR_CONSOLE_SCHEMA);
  assert.equal(console_.authority_effect, false);
  assert.deepEqual([...console_.actions], [...RSI_OPERATOR_CONSOLE_ACTIONS]);
});
