import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R98 product contract: the shipped METAENGINE Browser agent path is Web-UI only.
// Historical research/orchestration code may exist elsewhere in the monorepo,
// but Browser runtime/package sources must never acquire a managed model API,
// provider SDK, or silent inference fallback.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSER = path.resolve(HERE, '..');
const APPS = path.resolve(BROWSER, '..');
const ROOTS = [
  path.join(BROWSER, 'src'),
  path.join(BROWSER, 'ui'),
  path.join(BROWSER, 'supabase'),
  path.join(BROWSER, 'package.json'),
  path.join(APPS, 'me2-ui', 'src'),
  path.join(APPS, 'me2-ui', 'package.json'),
];

const SOURCE_EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.json']);

function filesUnder(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  const out = [];
  for (const name of fs.readdirSync(entry).sort()) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name === 'build') continue;
    const full = path.join(entry, name);
    const child = fs.statSync(full);
    if (child.isDirectory()) out.push(...filesUnder(full));
    else if (SOURCE_EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  ['OPENAI_MANAGED_ENDPOINT', /api\.openai\.com/i],
  ['ZAI_MANAGED_ENDPOINT', /api\.z\.ai/i],
  ['ANTHROPIC_MANAGED_ENDPOINT', /api\.anthropic\.com/i],
  ['VERCEL_AI_GATEWAY', /ai-gateway\.vercel\.sh/i],
  ['OPENAI_API_KEY', /\bOPENAI_API_KEY\b/],
  ['ANTHROPIC_API_KEY', /\bANTHROPIC_API_KEY\b/],
  ['ZAI_API_KEY', /\b(?:ZAI|ZHIPUAI)_API_KEY\b/],
  ['OPENAI_SDK_IMPORT', /(?:from\s+|require\s*\()\s*['"]openai['"]/],
  ['ANTHROPIC_SDK_IMPORT', /(?:from\s+|require\s*\()\s*['"]@anthropic-ai\/sdk['"]/],
  ['AI_SDK_PROVIDER_IMPORT', /(?:from\s+|require\s*\()\s*['"]@ai-sdk\/(?:openai|anthropic)['"]/],
];

test('R98 Browser production runtime has no managed model API/SDK fallback', () => {
  const violations = [];
  for (const file of ROOTS.flatMap(filesUnder)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [kind, pattern] of FORBIDDEN) {
      if (pattern.test(text)) {
        violations.push({
          kind,
          file: path.relative(path.resolve(BROWSER, '..', '..'), file).replaceAll('\\', '/'),
        });
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'managed inference must stay outside the shipped Browser runtime; use authenticated provider Web UI only',
  );
});

test('R98 Browser package itself has no model-provider SDK dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BROWSER, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
  for (const name of ['openai', '@anthropic-ai/sdk', '@ai-sdk/openai', '@ai-sdk/anthropic']) {
    assert.equal(name in deps, false, `forbidden Browser dependency: ${name}`);
  }
});
