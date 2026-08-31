import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const forbiddenProvider = ['ne', 'on'].join('');
const forbiddenWord = new RegExp(`\\b${forbiddenProvider}\\b`, 'i');
const forbiddenSdk = `@${forbiddenProvider}database`;
const forbiddenHost = `${forbiddenProvider}.tech`;
const forbiddenEnv = `${forbiddenProvider.toUpperCase()}_`;

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

async function inspectTrackedText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
  const bytes = await fs.readFile(absolutePath);
  if (bytes.includes(0)) return null;
  return bytes.toString('utf8');
}

test('repository persistence and coordination remain Supabase-only', async () => {
  const violations = [];
  for (const relativePath of trackedFiles()) {
    const text = await inspectTrackedText(relativePath);
    if (text == null) continue;
    const lower = text.toLowerCase();
    if (
      forbiddenWord.test(text)
      || lower.includes(forbiddenSdk)
      || lower.includes(forbiddenHost)
      || text.includes(forbiddenEnv)
    ) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `alternate Postgres provider reference is forbidden; use Supabase only: ${violations.join(', ')}`,
  );
});
