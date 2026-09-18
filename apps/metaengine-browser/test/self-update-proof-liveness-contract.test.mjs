import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const physicalScript = fs.readFileSync(new URL('./self-update-fast-physical.ps1', import.meta.url), 'utf8');
const workflow = fs.readFileSync(
  new URL('../../../.github/workflows/metaengine-browser-self-update-e2e.yml', import.meta.url),
  'utf8',
);

test('physical self-update stabilizes Windows process exit observation', () => {
  const wait = /function Wait-ExitOrThrow[\s\S]*?\r?\n}\r?\n\r?\n\$root/.exec(physicalScript)?.[0] || '';
  assert.match(wait, /WaitForExit\(\$TimeoutMs\)/);
  assert.match(wait, /\$Process\.WaitForExit\(\)/);
  assert.match(wait, /\$Process\.Refresh\(\)/);
  assert.match(wait, /exit_code_unavailable/);
  assert.match(wait, /\[int\]\$exitCode -ne 0/);
});

test('physical release discovery receives one read-only workflow token binding', () => {
  assert.match(
    physicalScript,
    /githubApiToken:\s*process\.env\.METAENGINE_GITHUB_API_TOKEN \|\| null/,
  );
  const bindings = workflow.match(/METAENGINE_GITHUB_API_TOKEN:/g) || [];
  assert.equal(bindings.length, 1);
  assert.match(
    workflow,
    /- name: Published baseline to one-built exact candidate[\s\S]*?env:\s*\n\s*METAENGINE_GITHUB_API_TOKEN: \$\{\{ github\.token \}\}/,
  );
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});
