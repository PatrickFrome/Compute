
import { parseAiAction } from './core.mjs';

function extractText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.response === 'string') return value.response;
  if (value && typeof value.result === 'string') return value.result;
  if (value && Array.isArray(value.choices) && typeof value.choices[0]?.message?.content === 'string') return value.choices[0].message.content;
  throw new Error('Workers AI response did not contain text');
}

function stripFence(text) {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export async function planAction(env, run, receipts, mode) {
  const task = run.task_envelope ?? {};
  const system = [
    'You are a MetaEngine Compute Fabric worker.',
    'Return ONLY one JSON object. No markdown.',
    'Never claim a command, test, benchmark, network call, artifact, or runtime observation that is absent from provided tool receipts.',
    'Authority changes are forbidden: canonical_change_allowed=false, promotion_allowed=false, all declarations false.',
    mode === 'AI_ONLY'
      ? 'This job has no execution substrate. Return action=final with a semantic result or a truthful BLOCKED result.'
      : 'Choose one action: exec, read_file, write_file, or final. Use the sandbox for empirical claims.',
  ].join('\n');
  const prompt = JSON.stringify({
    run_binding: {
      task_hash: run.task_hash,
      session_id: run.session_id,
      assignment_id: run.assignment_id,
      lease_generation: run.lease_generation,
      slot_id: run.slot_id,
      required_result_schema: task.schema,
    },
    task_envelope: task,
    tool_receipts: receipts.slice(-10),
    output_contract: mode === 'AI_ONLY'
      ? { action: 'final', result: '<exact semantic result object>' }
      : {
          action: 'exec|read_file|write_file|final',
          command: 'required for exec',
          path: '/workspace/... for file actions',
          content: 'required for write_file',
          result: 'required for final',
        },
  });
  const out = await env.AI.run(env.AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
  });
  return parseAiAction(JSON.parse(stripFence(extractText(out))));
}
