import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const me2 = (path) => new URL(`../../me2-ui/${path}`, import.meta.url);

async function text(path) {
  return readFile(me2(path), 'utf8');
}

async function walk(dirUrl) {
  const out = [];
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) out.push(...await walk(child));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(child);
  }
  return out;
}

const bannedPrimary = /GLM-5\.3-Flash|z\.ai Agent|chat\.z\.ai|upgrade флот|Снять живую пробу GLM|z-ai-web-dev-sdk/i;

test('primary ME2 UI is ChatGPT-aligned without hard-coded model version', async () => {
  const shell = await text('src/components/me2/shell/me2-shell.tsx');
  const store = await text('src/components/me2/store.tsx');
  const chat = await text('src/components/me2/agent-chat-panel.tsx');

  assert.match(shell, /ChatGPT ·/);
  assert.match(shell, /Verified ChatGPT Agent/);
  assert.match(shell, /Open an existing ChatGPT agent conversation\./);
  assert.match(store, /native ChatGPT agent fleet/);

  assert.doesNotMatch(shell, bannedPrimary);
  assert.doesNotMatch(store, bannedPrimary);
  assert.doesNotMatch(chat, bannedPrimary);
  assert.doesNotMatch(shell, /GPT-[0-9]/i);
});

test('historical Agent origin wire token remains compatible but is not user-visible branding', async () => {
  const shell = await text('src/components/me2/shell/me2-shell.tsx');
  assert.match(shell, /"ZAI_AGENT_SURFACE_CAUSAL_V1"/);
  assert.doesNotMatch(shell, /Verified z\.ai Agent|Open an existing z\.ai Agent conversation/i);
});

test('legacy provider telemetry remains read-only while reviews keep explicit action', async () => {
  const supervisor = await text('src/components/me2/pages/supervisor.tsx');

  assert.match(supervisor, /me2Fetch<GlmData>\("\/glm\?XTransformPort=3041"\)/);
  assert.match(supervisor, /LEGACY PROVIDER · REVIEWS/);
  assert.match(supervisor, /legacy · read-only/);
  assert.match(supervisor, /reviews\/run/);

  assert.doesNotMatch(supervisor, /mcxOp\("glm"/);
  assert.doesNotMatch(supervisor, /glmOp\(/);
  assert.doesNotMatch(supervisor, /upgrade флот|Снять живую пробу GLM/);
});

test('ME2 source tree has no active legacy provider branding or Z.ai SDK imports', async () => {
  const files = await walk(me2('src/'));
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (bannedPrimary.test(source)) violations.push(file.pathname);
  }
  assert.deepEqual(violations, []);
});

test('unused Z.ai SDK and dead vault bootstrap are removed from dependency/source surface', async () => {
  const pkg = await text('package.json');
  const lock = await text('bun.lock');

  assert.doesNotMatch(pkg, /z-ai-web-dev-sdk/);
  assert.doesNotMatch(lock, /z-ai-web-dev-sdk/);

  await assert.rejects(
    access(me2('src/lib/agent-factory/bootstrap.ts')),
    /ENOENT/,
  );
});
