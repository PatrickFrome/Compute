import fs from 'node:fs/promises';

const workflowPath = '.github/workflows/metaengine-browser-shell-v1.yml';
const workflowSource = await fs.readFile(workflowPath, 'utf8');
const legacyGate = `          ! grep -E 'child_process|exec\\(|spawn\\(|eval\\(|new Function' apps/metaengine-browser/src/verification-sandbox-plan.cjs
          ! grep -E 'child_process|exec\\(|eval\\(|new Function' apps/metaengine-browser/src/development-plane-worker.cjs apps/metaengine-browser/smoke/dp/main.cjs
          ! grep -R -E 'executeJavaScript|Runtime\\.evaluate|--remote-debugging-port|--no-sandbox|chat\\.z\\.ai|GLM_ZAI|STRICT_GLM_FIRST' apps/metaengine-browser --exclude-dir=node_modules
          ! grep -R -E 'nodeIntegration:[[:space:]]*true|sandbox:[[:space:]]*false' apps/metaengine-browser --exclude-dir=node_modules
`;
const executableGate = `          node apps/metaengine-browser/scripts/security-static-gate.mjs
`;
const gateCount = workflowSource.split(legacyGate).length - 1;
if (gateCount !== 1) throw new Error(`legacy_negative_gate_block_count:${gateCount}`);
const workflowNext = workflowSource.replace(legacyGate, executableGate);
if (workflowNext.includes('\n          ! grep')) throw new Error('bare_negative_grep_still_present');
await fs.writeFile(workflowPath, workflowNext, 'utf8');

const mainPath = 'apps/metaengine-browser/src/main.mjs';
const mainSource = await fs.readFile(mainPath, 'utf8');
const legacyGlm = "      if (p === 'GLM_ZAI') return host === 'chat.z.ai';\n";
const glmCount = mainSource.split(legacyGlm).length - 1;
if (glmCount !== 1) throw new Error(`legacy_glm_fallback_count:${glmCount}`);
await fs.writeFile(mainPath, mainSource.replace(legacyGlm, ''), 'utf8');
