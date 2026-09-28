
import { blockedResult, executionClass, normalizeAiFinalResult } from './core.mjs';
import { heartbeat, publishEvent, pullDispatch, runtimeFail } from './gateway.js';
import { planAction } from './ai.js';

function leasedRun(lease) {
  if (!lease || Number(lease.leased_count) < 1 || !Array.isArray(lease.items)) return null;
  const item = lease.items.find((x) => x?.status === 'LEASED' && x?.run);
  return item?.run ?? null;
}

async function publishBlocked(env, run, traceId, code, reason, evidence = {}) {
  const result = blockedResult(run, code, reason, evidence);
  await publishEvent(env, run.run_id, 'BLOCKER', { code, reason, evidence });
  const finalReceipt = await publishEvent(env, run.run_id, 'FINAL_SEMANTIC_RESULT', result);
  return { status: 'BLOCKED', final_receipt: finalReceipt };
}

export async function runFabricWorkflow(env, event, step, sandboxRunner = null) {
  const traceId = event.payload.trace_id ?? event.instanceId;
  const lease = await step.do(
    'lease-dispatch',
    { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '30 seconds' },
    async () => await pullDispatch(env, event.payload.slot_id),
  );
  const run = leasedRun(lease);
  if (!run) return { status: 'NO_WORK' };

  await step.do('publish-leased-progress', async () => {
    return await publishEvent(env, run.run_id, 'PROGRESS', { phase: 'RUN_LEASED', runtime: 'CLOUDFLARE_WORKFLOW' });
  });

  const mode = executionClass(run);
  if (mode === 'SANDBOX_REQUIRED' && !sandboxRunner) {
    return await step.do('fail-closed-no-sandbox', async () =>
      await publishBlocked(env, run, traceId, 'SANDBOX_REQUIRED', 'Task requires ACTUAL execution evidence but Cloudflare Sandbox is not enabled.'),
    );
  }

  const receipts = [];
  const maxTurns = Math.min(Math.max(Number(env.MAX_AGENT_TURNS ?? 8), 1), 16);
  try {
    for (let i = 0; i < maxTurns; i += 1) {
      await step.do(`heartbeat-${i}`, async () => await heartbeat(env, run.run_id, 1800));
      const action = await step.do(
        `ai-plan-${i}`,
        { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '5 minutes' },
        async () => await planAction(env, run, receipts, mode),
      );

      if (action.action === 'final') {
        const final = normalizeAiFinalResult(run, action.result);
        const finalReceipt = await step.do('publish-final', async () =>
          await publishEvent(env, run.run_id, 'FINAL_SEMANTIC_RESULT', final),
        );
        return { status: 'FINAL_PUBLISHED', final_receipt: finalReceipt };
      }

      if (!sandboxRunner) {
        return await step.do('fail-closed-action-without-sandbox', async () =>
          await publishBlocked(env, run, traceId, 'EXECUTION_SUBSTRATE_UNAVAILABLE', `AI requested ${action.action} but Sandbox is not enabled.`),
        );
      }

      const receipt = await step.do(
        `sandbox-action-${i}`,
        { retries: { limit: 1, delay: '2 seconds', backoff: 'constant' }, timeout: '20 minutes' },
        async () => await sandboxRunner(run, action, i),
      );
      receipts.push(receipt);
      await step.do(`publish-trace-${i}`, async () =>
        await publishEvent(env, run.run_id, 'TRACE', { phase: 'TOOL_RECEIPT', turn: i, receipt }),
      );
    }

    return await step.do('fail-closed-max-turns', async () =>
      await publishBlocked(env, run, traceId, 'MAX_AGENT_TURNS', `Worker reached ${maxTurns} turns without a valid final result.`, { receipts: receipts.slice(-8) }),
    );
  } catch (error) {
    await step.do('runtime-fail-requeue', async () =>
      await runtimeFail(env, run.run_id, error instanceof Error ? error.message : String(error), true),
    );
    throw error;
  }
}
