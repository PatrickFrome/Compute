
const SLOTS = new Set(['C0','C1','C2','C3','C4','C5','C6','C7']);
const EMPIRICAL_SLOTS = new Set(['C1','C2','C4']);
const FALSE_DECLARATIONS = Object.freeze({
  integration: false,
  worker_execution: false,
  production_activation: false,
  canonical_head_changed: false,
  epoch_closed: false,
});

function requiredString(value, name, max = 512) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(`${name} invalid`);
  return value;
}

export function normalizeWake(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('wake invalid');
  const slot_id = requiredString(input.slot_id, 'slot_id', 2);
  if (!SLOTS.has(slot_id)) throw new Error('slot_id invalid');
  const dispatch_hash = requiredString(input.dispatch_hash, 'dispatch_hash', 128);
  const queue_msg_id = Number(input.queue_msg_id);
  if (!Number.isSafeInteger(queue_msg_id) || queue_msg_id < 0) throw new Error('queue_msg_id invalid');
  const trace_id = input.trace_id == null ? null : requiredString(input.trace_id, 'trace_id', 128);
  return { slot_id, dispatch_hash, queue_msg_id, trace_id };
}

export function workflowId(wake) {
  const w = normalizeWake(wake);
  return `h205f21-${w.slot_id.toLowerCase()}-${w.dispatch_hash.slice(0,64)}`;
}

export function executionClass(run) {
  if (!run || typeof run !== 'object') throw new Error('run invalid');
  const slot = requiredString(run.slot_id, 'slot_id', 2);
  if (!SLOTS.has(slot)) throw new Error('slot_id invalid');
  return EMPIRICAL_SLOTS.has(slot) ? 'SANDBOX_REQUIRED' : 'AI_ONLY';
}

export function blockedResult(run, code, reason, evidence = {}) {
  if (!run?.task_envelope?.schema) throw new Error('task_envelope.schema required');
  return {
    schema: run.task_envelope.schema,
    task_hash: requiredString(run.task_hash, 'task_hash', 128),
    session_id: requiredString(run.session_id, 'session_id', 256),
    assignment_id: requiredString(run.assignment_id, 'assignment_id', 128),
    lease_generation: Number(run.lease_generation),
    canonical_change_allowed: false,
    promotion_allowed: false,
    status: 'BLOCKED',
    blocker: { code: requiredString(code, 'blocker.code', 128), reason: requiredString(reason, 'blocker.reason', 1024) },
    evidence,
    declarations: { ...FALSE_DECLARATIONS },
  };
}

export function validateFinalResult(run, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('result invalid');
  const checks = [
    ['schema', run?.task_envelope?.schema],
    ['task_hash', run?.task_hash],
    ['session_id', run?.session_id],
    ['assignment_id', run?.assignment_id],
    ['lease_generation', Number(run?.lease_generation)],
  ];
  for (const [key, expected] of checks) {
    if (result[key] !== expected) throw new Error(`${key} mismatch`);
  }
  if (result.canonical_change_allowed !== false) throw new Error('canonical_change_allowed must be false');
  if (result.promotion_allowed !== false) throw new Error('promotion_allowed must be false');
  const d = result.declarations;
  if (!d || typeof d !== 'object') throw new Error('declarations required');
  for (const [key, expected] of Object.entries(FALSE_DECLARATIONS)) {
    if (d[key] !== expected) throw new Error(`declarations.${key} must be false`);
  }
  if ('result_sha256' in result) throw new Error('result_sha256 must be server-derived');
  return result;
}

export function normalizeAiFinalResult(run, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('result invalid');
  if (result.status === 'BLOCKED') {
    try {
      return validateFinalResult(run, result);
    } catch {
      const code = typeof result?.blocker?.code === 'string' && result.blocker.code.length
        ? result.blocker.code
        : 'AI_REPORTED_BLOCKED';
      const reason = typeof result?.blocker?.reason === 'string' && result.blocker.reason.length
        ? result.blocker.reason
        : (typeof result.reason === 'string' && result.reason.length ? result.reason : 'AI reported blocked');
      return validateFinalResult(run, blockedResult(run, code, reason, { ai_result: result }));
    }
  }
  return validateFinalResult(run, result);
}

export function safeWorkspacePath(path) {
  const p = requiredString(path, 'path', 1024);
  if (!p.startsWith('/workspace/')) throw new Error('path outside /workspace');
  if (p.includes('/../') || p.endsWith('/..')) throw new Error('path traversal');
  return p;
}

export function parseAiAction(value) {
  const obj = typeof value === 'string' ? JSON.parse(value) : value;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('AI action invalid');
  if (!['exec','read_file','write_file','final'].includes(obj.action)) throw new Error('AI action unsupported');
  if (obj.action === 'exec') requiredString(obj.command, 'command', 8192);
  if (obj.action === 'read_file') safeWorkspacePath(obj.path);
  if (obj.action === 'write_file') { safeWorkspacePath(obj.path); requiredString(obj.content, 'content', 200000); }
  if (obj.action === 'final' && (!obj.result || typeof obj.result !== 'object')) throw new Error('final result required');
  return obj;
}

export function slotAllowed(slot, csv) {
  if (!SLOTS.has(slot)) return false;
  if (typeof csv !== 'string') return false;
  const allowed = new Set(csv.split(',').map((x) => x.trim()).filter(Boolean));
  return allowed.has(slot);
}
