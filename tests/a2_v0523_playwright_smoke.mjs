import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ext = path.resolve('coordination/chat-control-plane/extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-v0523-'));
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
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    const local = await chrome.storage.local.get(null);
    return {
      version: chrome.runtime.getManifest().version,
      glm: typeof globalThis.A2_GLM_TRUSTED_SEND,
      gpt: typeof globalThis.A2_CHATGPT_TRUSTED_SEND,
      request: typeof globalThis.A2_BRIDGE_REQUEST,
      vault: typeof globalThis.A2_SET_PAIRING_SECRET,
      vaultDb: dbs.some((x) => x.name === 'metaengine-a2-bridge-vault'),
      storageLeaksSecret: Object.prototype.hasOwnProperty.call(local, 'bridgeSecret')
    };
  });
  if (facts.version !== '0.5.23') throw new Error(`manifest version ${facts.version}`);
  for (const k of ['glm','gpt','request','vault']) if (facts[k] !== 'function') throw new Error(`${k} not loaded`);
  if (!facts.vaultDb) throw new Error('vault IndexedDB missing');
  if (facts.storageLeaksSecret) throw new Error('pairing secret leaked to chrome.storage.local');
  console.log('MV3 service-worker load: PASS', JSON.stringify(facts));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
