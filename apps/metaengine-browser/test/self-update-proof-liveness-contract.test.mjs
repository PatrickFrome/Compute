import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const physicalScript = fs.readFileSync(new URL('./self-update-fast-physical.ps1', import.meta.url), 'utf8');
const workflow = fs.readFileSync(
  new URL('../../../.github/workflows/metaengine-browser-self-update-e2e.yml', import.meta.url),
  'utf8',
);

test('physical self-update uses direct ProcessStartInfo capture with stable exit codes', () => {
  const start = /function Start-CapturedProcess[\s\S]*?\r?\n}\r?\n\r?\nfunction Complete-CapturedProcessOutput/.exec(physicalScript)?.[0] || '';
  assert.match(start, /System\.Diagnostics\.ProcessStartInfo/);
  assert.match(start, /UseShellExecute = \$false/);
  assert.match(start, /RedirectStandardOutput = \$true/);
  assert.match(start, /RedirectStandardError = \$true/);
  assert.match(start, /ReadToEndAsync\(\)/);

  const wait = /function Wait-CapturedProcessOrThrow[\s\S]*?\r?\n}\r?\n\r?\n\$root/.exec(physicalScript)?.[0] || '';
  assert.match(wait, /WaitForExit\(\$TimeoutMs\)/);
  assert.match(wait, /\$process\.WaitForExit\(\)/);
  assert.match(wait, /Complete-CapturedProcessOutput \$Capture/);
  assert.match(wait, /\[int\]\$process\.ExitCode/);
  assert.match(wait, /\$exitCode -ne 0/);
  assert.doesNotMatch(wait, /exit_code_unavailable/);

  assert.doesNotMatch(
    physicalScript,
    /Start-Process -FilePath \$app -ArgumentList '--metaengine-version-probe'.*RedirectStandardOutput/,
  );
  assert.match(
    physicalScript,
    /Start-CapturedProcess -FilePath \$app -Arguments '--metaengine-self-update-smoke'/,
  );
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
