import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const workflow=await fs.readFile(new URL('../../../.github/workflows/browser-windows-manual-forward-qualification.yml',import.meta.url),'utf8');

test('manual forward physical workflow is an explicit disposable Windows consumer',()=>{
  const physical=workflow.slice(workflow.indexOf('\n  physical:'));
  assert.match(physical,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(physical,/needs: source/);
  assert.match(physical,/runs-on: windows-2025/);
  assert.match(physical,/RUNNER_ENVIRONMENT -ne 'github-hosted'/);
  assert.match(physical,/RUNNER_OS -ne 'Windows'/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/self-hosted|npm run (?:build|dist|package)|electron-builder|workflow_run:|--allow-in-progress|latest/i);
});
test('workflow pins consumer source, input descriptor and exact producer metadata before invocation',()=>{
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/ref: \$\{\{ env\.EXACT_HEAD \}\}/);
  assert.match(workflow,/ME2_FORWARD_PIN_JSON: \$\{\{ inputs\.qualification_inputs \}\}/);
  assert.match(workflow,/qa-forward-install-evidence\.mjs acquire --pins \$pins --out \$inputsRoot --expected-head \$env:EXACT_HEAD/);
  assert.match(workflow,/Get-FileHash -LiteralPath \$descriptor -Algorithm SHA256/);
  assert.match(workflow,/qa-forward-install-physical\.mjs --inputs \$env:ME2_FORWARD_INPUTS --inputs-sha256 \$env:ME2_FORWARD_INPUTS_SHA256 --evidence/);
  assert.match(workflow,/if \(\$LASTEXITCODE -ne 0\) \{ throw 'manual_forward_inputs_BLOCKED' \}/);
  assert.match(workflow,/if \(\$LASTEXITCODE -ne 0\) \{ throw 'manual_forward_physical_HOLD_or_BLOCKED' \}/);
});
test('source/native-fs tests and allowlisted physical receipts use distinct artifacts without private fixture upload',()=>{
  assert.match(workflow,/os: \[ubuntu-24\.04, windows-2025\]/);
  assert.match(workflow,/node --test --test-reporter=tap apps\/metaengine-browser\/test\/qa-forward-\*\.test\.mjs/);
  assert.match(workflow,/manual-forward-source-\$\{\{ matrix\.os \}\}/);
  assert.match(workflow,/manual-forward-physical-\$\{\{ env\.EXACT_HEAD \}\}/);
  const upload=workflow.slice(workflow.indexOf('      - name: Upload only allowlisted'));
  assert.match(upload,/manual-forward-evidence\/\*\.json/);
  assert.doesNotMatch(upload,/\*\*|owner|pgdata|fixture|schema\.dump|config|stderr|\.zip/);
  assert.doesNotMatch(workflow,/continue-on-error|always\(\).*physical|Stop-Process|taskkill|Uninstall METAENGINE/);
});
