import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../src');

test('mesh recovery reuses the exact native supervisor foreground send boundary', async () => {
  const source = await fs.readFile(path.join(src, 'supervisor-mesh-runtime.mjs'), 'utf8');
  assert.match(source, /createSupervisorSendBoundaryExecutor/);
  assert.match(source, /this\.#execute\s*=\s*createSupervisorSendBoundaryExecutor\(\{\s*getState,\s*executeCommand\s*\}\)/);
  assert.match(source, /foreground_send_boundary:\s*'EXACT_TAB_TARGET_PROCESS_VIEWPORT_V1'/);

  const guard = await fs.readFile(path.join(src, 'supervisor-lifecycle-runtime.mjs'), 'utf8');
  const selectAt = guard.indexOf("action: 'SELECT_TAB'");
  const selectedReadbackAt = guard.indexOf('exactSelectedTab(state, tabId)', selectAt);
  const viewportAt = guard.indexOf('positiveViewport(activated)', selectedReadbackAt);
  const clickAt = guard.indexOf('return await executeCommand(command)', viewportAt);
  assert.ok(selectAt >= 0 && selectedReadbackAt > selectAt && viewportAt > selectedReadbackAt && clickAt > viewportAt,
    'mesh Send must inherit SELECT_TAB -> selected readback -> viewport -> one click ordering');
});

test('a typed-but-unsent mesh delivery is ambiguity, never a synthetic no-effect retry lane', async () => {
  const source = await fs.readFile(path.join(src, 'supervisor-mesh-runtime.mjs'), 'utf8');
  assert.match(source, /let typed = false/);
  assert.match(source, /typedResult\?\.suppressed === true/);
  assert.match(source, /if \(sent\.clicked \|\| sent\.typed\)/);
  assert.doesNotMatch(source, /if \(sent\.clicked\)\s*\{/);
  const noEffectAt = source.lastIndexOf('await this.#settleNoEffect(delivery, sent.reason)');
  const ambiguityAt = source.lastIndexOf('if (sent.clicked || sent.typed)');
  assert.ok(ambiguityAt >= 0 && noEffectAt > ambiguityAt, 'only zero typed/clicked effect may settle NO_EFFECT');
});
