import fs from 'node:fs/promises';

const target = '.github/workflows/metaengine-browser-shell-v1.yml';
const source = await fs.readFile(target, 'utf8');
const old = `          ! grep -E 'child_process|exec\\(|spawn\\(|eval\\(|new Function' apps/metaengine-browser/src/verification-sandbox-plan.cjs
          ! grep -E 'child_process|exec\\(|eval\\(|new Function' apps/metaengine-browser/src/development-plane-worker.cjs apps/metaengine-browser/smoke/dp/main.cjs
          ! grep -R -E 'executeJavaScript|Runtime\\.evaluate|--remote-debugging-port|--no-sandbox|chat\\.z\\.ai|GLM_ZAI|STRICT_GLM_FIRST' apps/metaengine-browser --exclude-dir=node_modules
          ! grep -R -E 'nodeIntegration:[[:space:]]*true|sandbox:[[:space:]]*false' apps/metaengine-browser --exclude-dir=node_modules
`;
const replacement = `          node apps/metaengine-browser/scripts/security-static-gate.mjs
`;
const count = source.split(old).length - 1;
if (count !== 1) throw new Error(`legacy_negative_gate_block_count:${count}`);
const next = source.replace(old, replacement);
if (next.includes('\n          ! grep')) throw new Error('bare_negative_grep_still_present');
await fs.writeFile(target, next, 'utf8');
