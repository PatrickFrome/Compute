import crypto from 'node:crypto';

export const AGENT_RESULT_PROTOCOL_SCHEMA = 'metaengine.agent-result-claim.v1';
export const AGENT_RESULT_CLAIM_MARKER = 'RESULT_CLAIM_V1';
export const AGENT_RESULT_FENCE = 'result';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const PRIMARY_DISPOSITIONS = new Set(['READY','BLOCKED','FAILED']);
const VERIFIER_DISPOSITIONS = new Set(['ACCEPT','REJECT','BLOCKED']);
const VERIFIER_ROLES = new Set(['CRITIC','FALSIFIER']);
const MAX_BLOCK_CHARS = 8192;
const MAX_REFS = 16;
const MAX_REF_CHARS = 240;

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function refs(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_REFS) throw new Error(`agent_result_${label}_invalid`);
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (!text || text.length > MAX_REF_CHARS || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`agent_result_${label}_invalid`);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function parseBlocks(text) {
  const source = String(text || '');
  const blocks = [];
  const re = new RegExp(`\\`\\`\\`${AGENT_RESULT_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\\`\\`\\``, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    const block = match[1];
    if (block.length <= MAX_BLOCK_CHARS) blocks.push(block);
    if (blocks.length > 64) break;
  }
  return blocks;
}

function normalizeClaim(raw, { task_id, lease_generation, role, expected_subject_task_id = null, expected_subject_result_sha256 = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('agent_result_payload_invalid');
  const allowed = new Set([
    'task_id','lease_generation','disposition','summary',
    'deliverable_refs','evidence_refs','subject_task_id','subject_result_sha256',
  ]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`agent_result_field_forbidden:${key}`);

  const expectedTask = String(task_id || '').toLowerCase();
  const expectedGeneration = Number(lease_generation);
  const claimTask = String(raw.task_id || '').toLowerCase();
  const claimGeneration = Number(raw.lease_generation);
  const normalizedRole = String(role || '').toUpperCase();
  const verifier = VERIFIER_ROLES.has(normalizedRole);
  const disposition = String(raw.disposition || '').toUpperCase();

  if (!UUID_RE.test(expectedTask) || claimTask !== expectedTask) throw new Error('agent_result_task_binding_invalid');
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1 || claimGeneration !== expectedGeneration) throw new Error('agent_result_generation_binding_invalid');
  if (!(verifier ? VERIFIER_DISPOSITIONS : PRIMARY_DISPOSITIONS).has(disposition)) throw new Error('agent_result_disposition_invalid');

  const summary = String(raw.summary || '').trim();
  if (!summary || summary.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(summary)) throw new Error('agent_result_summary_invalid');

  let subjectTaskId = null;
  let subjectResultSha256 = null;
  if (verifier) {
    subjectTaskId = String(raw.subject_task_id || '').toLowerCase();
    subjectResultSha256 = String(raw.subject_result_sha256 || '').toLowerCase();
    const expectedSubjectTask = String(expected_subject_task_id || '').toLowerCase();
    const expectedSubjectSha = String(expected_subject_result_sha256 || '').toLowerCase();
    if (!UUID_RE.test(subjectTaskId) || !UUID_RE.test(expectedSubjectTask) || subjectTaskId !== expectedSubjectTask) throw new Error('agent_result_subject_task_binding_invalid');
    if (!HASH_RE.test(subjectResultSha256) || !HASH_RE.test(expectedSubjectSha) || subjectResultSha256 !== expectedSubjectSha) throw new Error('agent_result_subject_digest_binding_invalid');
  } else if (raw.subject_task_id != null || raw.subject_result_sha256 != null) {
    throw new Error('agent_result_subject_forbidden_for_primary');
  }

  const normalized = {
    schema: AGENT_RESULT_PROTOCOL_SCHEMA,
    task_id: expectedTask,
    lease_generation: expectedGeneration,
    role: normalizedRole,
    disposition,
    summary,
    deliverable_refs: refs(raw.deliverable_refs, 'deliverable_refs'),
    evidence_refs: refs(raw.evidence_refs, 'evidence_refs'),
    subject_task_id: subjectTaskId,
    subject_result_sha256: subjectResultSha256,
    model_claim_authority: false,
    page_data_authority: false,
    authority_effect: false,
  };
  const claim_sha256 = sha256(JSON.stringify(stable(normalized)));
  return Object.freeze({ ...normalized, claim_sha256 });
}

export function parseAgentResultClaim(text, bindings = {}) {
  const matches = [];
  const invalid = [];
  for (const block of parseBlocks(text)) {
    const lines = block.split(/\r?\n/);
    if (String(lines[0] || '').trim() !== AGENT_RESULT_CLAIM_MARKER) continue;
    const jsonText = lines.slice(1).join('\n').trim();
    if (!jsonText || jsonText.length > MAX_BLOCK_CHARS) { invalid.push('payload_missing'); continue; }
    try {
      const parsed = JSON.parse(jsonText);
      matches.push(normalizeClaim(parsed, bindings));
    } catch (error) {
      invalid.push(String(error?.message || error).slice(0,160));
    }
  }
  if (matches.length > 1) {
    return Object.freeze({ schema: AGENT_RESULT_PROTOCOL_SCHEMA, state: 'AMBIGUOUS', claim: null, invalid: Object.freeze(invalid.slice(0,8)), matching_claims: matches.length, authority_effect: false });
  }
  if (matches.length === 1) {
    return Object.freeze({ schema: AGENT_RESULT_PROTOCOL_SCHEMA, state: 'CLAIM_BOUND', claim: matches[0], invalid: Object.freeze(invalid.slice(0,8)), matching_claims: 1, authority_effect: false });
  }
  return Object.freeze({ schema: AGENT_RESULT_PROTOCOL_SCHEMA, state: 'MISSING', claim: null, invalid: Object.freeze(invalid.slice(0,8)), matching_claims: 0, authority_effect: false });
}

export function renderAgentResultProtocol({ task_id, lease_generation, role, verification_subject = null } = {}) {
  const verifier = VERIFIER_ROLES.has(String(role || '').toUpperCase());
  const subject = verification_subject && typeof verification_subject === 'object' && !Array.isArray(verification_subject) ? verification_subject : null;
  const dispositions = verifier ? 'ACCEPT|REJECT|BLOCKED' : 'READY|BLOCKED|FAILED';
  const example = {
    task_id: String(task_id || ''),
    lease_generation: Number(lease_generation) || 1,
    disposition: verifier ? 'ACCEPT' : 'READY',
    summary: verifier ? 'bounded independent verdict rationale' : 'bounded result summary',
    deliverable_refs: [],
    evidence_refs: [],
    ...(verifier ? {
      subject_task_id: String(subject?.task_id || ''),
      subject_result_sha256: String(subject?.result_sha256 || ''),
    } : {}),
  };
  return [
    `RESULT PROTOCOL ${AGENT_RESULT_CLAIM_MARKER}`,
    'Your final answer for this task MUST contain exactly one fenced result block bound to this exact task and lease generation.',
    `allowed_disposition=${dispositions}`,
    'The claim is treated as untrusted model output until Browser/DB readback and independent evidence verify it.',
    `\`\`\`${AGENT_RESULT_FENCE}`,
    AGENT_RESULT_CLAIM_MARKER,
    JSON.stringify(example),
    '\`\`\`',
  ].join('\n');
}

export function agentResultProtocolSnapshot() {
  return Object.freeze({
    schema: AGENT_RESULT_PROTOCOL_SCHEMA,
    marker: AGENT_RESULT_CLAIM_MARKER,
    fence: AGENT_RESULT_FENCE,
    primary_dispositions: [...PRIMARY_DISPOSITIONS],
    verifier_dispositions: [...VERIFIER_DISPOSITIONS],
    exact_task_binding_required: true,
    exact_lease_generation_required: true,
    verifier_subject_digest_binding_required: true,
    raw_claim_is_authority: false,
    authority_effect: false,
  });
}
