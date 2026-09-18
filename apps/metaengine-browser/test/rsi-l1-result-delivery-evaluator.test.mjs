import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA,
  evaluateResultDeliveryCandidate,
  verifyCandidateSourceContract,
} from '../scripts/rsi-l1-result-delivery-evaluator.mjs';

const COMPLIANT = `
export const RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA = 'metaengine.rsi.result-delivery-transport.v1';
export function createRsiResultDeliveryTransport({sendReceipt,readReceipt,sleep,deadlineMs,attempts,backoffMs}) {
  if(typeof sendReceipt!=='function'||typeof readReceipt!=='function'||typeof sleep!=='function') throw new Error('transport_callbacks_required');
  const sendOnce = async (payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('result_delivery_deadline')), deadlineMs);
    try { return await sendReceipt({payload,signal:controller.signal}); }
    finally { clearTimeout(timer); }
  };
  return Object.freeze({
    async deliver({commandId,effectKey,payload}) {
      let lastError = null;
      for(let attempt=1;attempt<=attempts;attempt+=1) {
        try {
          const response = await sendOnce(payload);
          if(response?.ok===true) return Object.freeze({state:'DELIVERED',command_id:commandId,effect_key:effectKey,receipt_replay_count:attempt-1,physical_effect_replay_allowed:false,automatic_effect_retry_allowed:false,authority_effect:false});
          lastError = new Error('result_delivery_rejected');
        } catch (error) { lastError = error; }
        const observed = await readReceipt({commandId,effectKey});
        if(observed?.terminal===true) return Object.freeze({state:'RECONCILED',command_id:commandId,effect_key:effectKey,receipt_replay_count:attempt-1,physical_effect_replay_allowed:false,automatic_effect_retry_allowed:false,authority_effect:false});
        if(attempt<attempts) await sleep(backoffMs[Math.min(attempt-1,backoffMs.length-1)]||0);
      }
      return Object.freeze({state:'AMBIGUOUS',command_id:commandId,effect_key:effectKey,error:String(lastError?.message||lastError||'unknown'),receipt_replay_count:Math.max(0,attempts-1),physical_effect_replay_allowed:false,automatic_effect_retry_allowed:false,authority_effect:false});
    }
  });
}
`;

const LEGACY_UNBOUNDED = `
export const RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA = 'metaengine.rsi.result-delivery-transport.v1';
export function createRsiResultDeliveryTransport({sendReceipt}) {
  return Object.freeze({
    async deliver({commandId,effectKey,payload}) {
      const response=await sendReceipt({payload});
      return Object.freeze({state:response?.ok===true?'DELIVERED':'AMBIGUOUS',command_id:commandId,effect_key:effectKey,physical_effect_replay_allowed:false,automatic_effect_retry_allowed:false,authority_effect:false});
    }
  });
}
`;

async function withModule(source, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-l1-eval-'));
  const modulePath = path.join(dir, 'result-delivery-transport.mjs');
  try {
    await fs.writeFile(modulePath, source, 'utf8');
    return await fn(modulePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('candidate source contract rejects project/process/network/effect authority surfaces', () => {
  assert.equal(verifyCandidateSourceContract(COMPLIANT).ok, true);
  for (const forbidden of [
    `${COMPLIANT}\nimport fs from 'node:fs';`,
    `${COMPLIANT}\nprocess.exit(0);`,
    `${COMPLIANT}\nfetch('https://example.com');`,
    `${COMPLIANT}\nconst executeCommand=()=>{};`,
  ]) {
    assert.throws(() => verifyCandidateSourceContract(forbidden), /candidate_source_forbidden/);
  }
});

test('compliant helper passes five repeated timeout/readback/healthy-control episodes with zero effect authority', async () => {
  await withModule(COMPLIANT, async (modulePath) => {
    const result = await evaluateResultDeliveryCandidate({ modulePath, repetitions: 5, deadlineMs: 20, attempts: 3, outerMs: 140 });
    assert.equal(result.schema, RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA);
    assert.equal(result.passed, true);
    assert.equal(result.summary.result_delivery_wall_clock_bounded, true);
    assert.equal(result.summary.durable_receipt_reconciliation_required, true);
    assert.equal(result.summary.absent_receipt_remains_ambiguous, true);
    assert.equal(result.summary.command_cycle_progress_recovers, true);
    assert.equal(result.summary.duplicate_irreversible_effect_count, 0);
    assert.equal(result.summary.physical_effect_execution_count, 0);
    assert.equal(result.effect_executor_available, false);
    assert.equal(result.browser_actuation_available, false);
    assert.equal(result.authority_effect, false);
    for (const run of result.runs) {
      assert.equal(run.lost.send_count, 1);
      assert.deepEqual(run.lost.events.slice(0, 2), ['SEND:1', 'READ:1']);
      assert.equal(run.absent.send_count, 3);
      assert.equal(run.absent.read_count, 3);
      assert.equal(run.healthy.read_count, 0);
    }
  });
});

test('legacy unbounded result delivery is falsified instead of hanging the evaluator', async () => {
  await withModule(LEGACY_UNBOUNDED, async (modulePath) => {
    const result = await evaluateResultDeliveryCandidate({ modulePath, repetitions: 5, deadlineMs: 20, attempts: 2, outerMs: 70 });
    assert.equal(result.passed, false);
    assert.equal(result.summary.result_delivery_wall_clock_bounded, false);
    assert.ok(result.runs.some((run) => /outer_timeout/.test(String(run.lost.error || ''))));
    assert.equal(result.effect_executor_available, false);
    assert.equal(result.authority_effect, false);
  });
});
