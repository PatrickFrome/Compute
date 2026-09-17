import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const workflows = [
  'browser-workspace-reincarnation-v1.yml',
  'browser-windows-installed-chat-qualification.yml',
  'browser-host-resilience-login-start-v1.yml',
  'browser-final-runtime-activation-v1.yml',
  'metaengine-browser-shell-v1.yml',
  'browser-windows-package-smoke.yml',
  'candidate-remote-source-gate.yml',
  'browser-shell-first-dirty-profile-v1.yml',
  'browser-critical-audit-v1.yml',
  'browser-chat-fast-preflight-v1.yml',
  'browser-windows-autonomous-soak-v1.yml',
  'metaengine-browser-self-update-e2e.yml',
];

test('high-cost Browser CI cancels superseded heads within each workflow/ref lane', async () => {
  for (const file of workflows) {
    const text = await fs.readFile(path.join(repoRoot, '.github', 'workflows', file), 'utf8');
    assert.match(text, /^concurrency:\s*$/m, file + ': missing workflow concurrency');
    assert.match(text, /group:\s*.*github\.(?:workflow|ref)/, file + ': concurrency group must be source-scoped');
    assert.match(text, /cancel-in-progress:\s*true/, file + ': superseded head must be cancellable');
    assert.doesNotMatch(text, /concurrency:[\s\S]{0,240}queue:\s*max/, file + ': cancel and queue:max are incompatible');
  }
});
