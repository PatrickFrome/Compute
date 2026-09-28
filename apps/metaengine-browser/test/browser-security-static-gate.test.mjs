import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanSecurityStaticGate } from '../scripts/security-static-gate.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-security-gate-'));
  for (const required of [
    'src/verification-sandbox-plan.cjs',
    'src/development-plane-worker.cjs',
    'smoke/dp/main.cjs',
  ]) {
    files[required] ??= 'module.exports = Object.freeze({ authority_effect: false });\n';
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return root;
}

test('current production Browser source satisfies the executable static security gate', async () => {
  const result = await scanSecurityStaticGate({ rootDir: APP_ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.violation_count, 0);
  assert.equal(result.tests_excluded_from_production_scan, true);
  assert.equal(result.production_process_primitives_globally_forbidden, false);
  assert.equal(result.authority_effect, false);
});

test('production renderer escape hatch is a real failing violation', async () => {
  const root = await fixture({
    'src/main.mjs': "contents.executeJavaScript('document.body.textContent')\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((row) => [row.file, row.rule]), [
    ['src/main.mjs', 'EXECUTE_JAVASCRIPT'],
  ]);
});

test('production Browser graph rejects managed model API and SDK fallback paths', async () => {
  const cases = [
    ["export const endpoint = 'https://api.openai.com/v1/responses';\n", 'MODEL_API_OPENAI_ENDPOINT'],
    ["export const endpoint = 'https://api.z.ai/v1/chat/completions';\n", 'MODEL_API_ZAI_ENDPOINT'],
    ["export const endpoint = 'https://api.anthropic.com/v1/messages';\n", 'MODEL_API_ANTHROPIC_ENDPOINT'],
    ["export const endpoint = 'https://ai-gateway.vercel.sh/v1';\n", 'MODEL_API_VERCEL_GATEWAY_ENDPOINT'],
    ["export const key = process.env.OPENAI_API_KEY;\n", 'MODEL_API_OPENAI_SECRET'],
    ["import OpenAI from 'openai';\n", 'MODEL_API_OPENAI_SDK'],
    ["import Anthropic from '@anthropic-ai/sdk';\n", 'MODEL_API_ANTHROPIC_SDK'],
  ];
  for (const [source, expectedRule] of cases) {
    const root = await fixture({ 'src/agent-runtime.mjs': source });
    const result = await scanSecurityStaticGate({ rootDir: root });
    assert.equal(result.ok, false, expectedRule);
    assert.equal(result.violations.some((row) => row.rule === expectedRule), true, JSON.stringify(result.violations));
  }
});

test('ordinary z.ai Web UI identifiers and advisory transport labels remain allowed', async () => {
  const root = await fixture({
    'src/agent-runtime.mjs': "export const platform = 'GLM_ZAI'; export const url = 'https://chat.z.ai/';\n",
    'src/advisory.mjs': "export const transport = 'OPENAI_COMPAT_HTTP';\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('test-only diagnostic JavaScript evaluation does not redefine the production boundary', async () => {
  const root = await fixture({
    'test/diagnostic.test.mjs': "contents.executeJavaScript('document.fonts.ready')\n",
    'src/main.mjs': 'export const safe = true;\n',
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('effect-poor sandbox and Development Plane worker boundaries reject process actuation primitives', async () => {
  const root = await fixture({
    'src/verification-sandbox-plan.cjs': "const { spawn } = require('node:child_process'); spawn('cmd');\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, false);
  const rules = new Set(result.violations.map((row) => row.rule));
  assert.equal(rules.has('CHILD_PROCESS_IMPORT'), true);
  assert.equal(rules.has('SPAWN_PRIMITIVE'), true);
});

test('legitimate Sentinel process authority is not accidentally banned by a repo-wide child_process rule', async () => {
  const root = await fixture({
    'src/browser-sentinel.mjs': "import { spawn } from 'node:child_process'; export const launch = () => spawn('browser.exe');\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});
