export const CODEX_CLI_RESULT_SCHEMA = 'metaengine.codex-cli.result.v1';
export const CODEX_CLI_RUN_RECEIPT_SCHEMA = 'metaengine.codex-cli.run-receipt.v1';

export function codexCliResultSchema(role, subjectResultSha256 = null) {
  if (!['IMPLEMENTER', 'CRITIC'].includes(role)) throw new Error('codex_cli_role_invalid');
  const properties = {
    schema: { type: 'string', const: CODEX_CLI_RESULT_SCHEMA },
    role: { type: 'string', const: role },
    outcome: { type: 'string', enum: ['DONE', 'BLOCKED'] },
    summary: { type: 'string', minLength: 1, maxLength: 4000 },
    checks: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false,
      properties: { description: { type: 'string', maxLength: 500 }, passed: { type: 'boolean' },
        evidence: { type: 'string', maxLength: 2000 } }, required: ['description', 'passed', 'evidence'] } },
    followup_tasks: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false,
      properties: { role: { type: 'string', enum: ['IMPLEMENTER', 'CRITIC'] },
        objective: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['role', 'objective'] } },
  };
  if (role === 'CRITIC') {
    if (!/^[a-f0-9]{64}$/.test(subjectResultSha256 || '')) throw new Error('codex_cli_critic_subject_invalid');
    properties.verdict = { type: 'string', enum: ['ACCEPT', 'REJECT', 'BLOCKED'] };
    properties.subject_result_sha256 = { type: 'string', const: subjectResultSha256 };
  }
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

// Do not trust the provider's schema assertion: validate the received bytes again.
export function validateCodexCliResult(value, role, subjectResultSha256 = null) {
  const schema = codexCliResultSchema(role, subjectResultSha256);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const exact = (v, keys) => object(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
  const string = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
  if (!exact(value, schema.required) || value.schema !== CODEX_CLI_RESULT_SCHEMA || value.role !== role
    || !['DONE', 'BLOCKED'].includes(value.outcome) || !string(value.summary, 4000, 1)
    || !Array.isArray(value.checks) || value.checks.length > 32
    || value.checks.some(v => !exact(v, ['description', 'passed', 'evidence'])
      || !string(v.description, 500) || typeof v.passed !== 'boolean' || !string(v.evidence, 2000))
    || !Array.isArray(value.followup_tasks) || value.followup_tasks.length > 16
    || value.followup_tasks.some(v => !exact(v, ['role', 'objective'])
      || !['IMPLEMENTER', 'CRITIC'].includes(v.role) || !string(v.objective, 1000, 1))
    || (role === 'CRITIC' && (!['ACCEPT', 'REJECT', 'BLOCKED'].includes(value.verdict)
      || value.subject_result_sha256 !== subjectResultSha256))) throw new Error('codex_cli_result_invalid');
  return structuredClone(value);
}
