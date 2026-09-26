import assert from 'node:assert/strict';
import test from 'node:test';

import { scanText } from '../coordination/convergence/r81-source-hygiene-audit.mjs';

test('R81 source hygiene scanner detects representative raw secret formats without returning values', () => {
  const fixtures = [
    ['GITHUB_CLASSIC_PAT', 'token=ghp_' + 'A'.repeat(40)],
    ['GITHUB_FINE_GRAINED_PAT', 'token=github_pat_' + 'A'.repeat(90)],
    ['OPENAI_API_KEY', 'OPENAI_API_KEY=sk-proj-' + 'A'.repeat(40)],
    ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY=sk-ant-' + 'A'.repeat(40)],
    ['AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID=AKIA' + 'A'.repeat(16)],
    ['SLACK_TOKEN', 'token=xoxb-' + '12345678901234567890'],
    ['PRIVATE_KEY_BLOCK', '-----BEGIN PRIVATE KEY-----'],
  ];
  for (const [kind, source] of fixtures) {
    const findings = scanText(source, 'fixture.txt');
    assert.ok(findings.some((row) => row.kind === kind), kind);
    assert.equal(JSON.stringify(findings).includes(source), false, 'raw fixture must never appear in findings');
  }
});

test('R81 source hygiene scanner treats documented placeholders as non-secret', () => {
  const source = [
    'SUPABASE_SERVICE_ROLE_KEY=' + '$' + '{SUPABASE_SERVICE_ROLE_KEY}',
    'OPENAI_API_KEY=<redacted>',
    'GH_TOKEN=REDACTED',
    'PAP_CHATGPT_TOKEN=placeholder',
  ].join('\n');
  assert.deepEqual(scanText(source, 'docs/example.md'), []);
});

test('R81 named literal detection emits only variable metadata', () => {
  const secret = 'definitely-not-a-placeholder-value-1234567890';
  const findings = scanText('SUPABASE_SERVICE_ROLE_KEY=' + secret, 'capsules/example.md');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'NAMED_SECRET_LITERAL');
  assert.equal(findings[0].variable, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(JSON.stringify(findings).includes(secret), false);
});
