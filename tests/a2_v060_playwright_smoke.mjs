import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ext = path.resolve('coordination/chat-control-plane/extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-v062-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const facts = await sw.evaluate(async () => {
    await globalThis.A2_SECRET_VAULT_READY;
    const local = await chrome.storage.local.get(null);
    return {
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name,
      runtime: globalThis.A2_OPERATOR_RUNTIME,
      glm: typeof globalThis.A2_GLM_TRUSTED_SEND,
      gpt: typeof globalThis.A2_CHATGPT_TRUSTED_SEND,
      rawGptV062: typeof globalThis.A2_CHATGPT_TRUSTED_SEND_RAW_V062,
      rawDebuggerV062: typeof globalThis.A2_DEBUGGER_RUN_RAW_V062,
      request: typeof globalThis.A2_BRIDGE_REQUEST,
      reconcile: typeof globalThis.A2_GLM_RECONCILE,
      vault: typeof globalThis.A2_GET_PAIRING_SECRET,
      storageLeaksSecret: Object.prototype.hasOwnProperty.call(local, 'bridgeSecret')
    };
  });

  if (facts.version !== '0.6.2') throw new Error(`manifest version ${facts.version}`);
  if (facts.name !== 'METAENGINE A2 Browser Operator') throw new Error(`manifest name ${facts.name}`);
  if (facts.runtime !== '0.6.2-auto-rollover') throw new Error(`operator runtime ${facts.runtime}`);
  for (const key of ['glm', 'gpt', 'rawGptV062', 'rawDebuggerV062', 'request', 'reconcile', 'vault']) {
    if (facts[key] !== 'function') throw new Error(`${key} not loaded`);
  }
  if (facts.storageLeaksSecret) throw new Error('pairing secret leaked to chrome.storage.local');
  console.log('A2 Browser Operator v0.6.2 MV3 runtime: PASS', JSON.stringify(facts));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
