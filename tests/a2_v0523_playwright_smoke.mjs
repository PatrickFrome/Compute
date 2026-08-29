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
    const testSecret = 'a2-v0523-ci-vault-' + 'x'.repeat(48);
    await globalThis.A2_SET_PAIRING_SECRET(testSecret);
    const vaultRoundtrip = await globalThis.A2_GET_PAIRING_SECRET();
    const local = await chrome.storage.local.get(null);
    return {
      version: chrome.runtime.getManifest().version,
      glm: typeof globalThis.A2_GLM_TRUSTED_SEND,
      gpt: typeof globalThis.A2_CHATGPT_TRUSTED_SEND,
      request: typeof globalThis.A2_BRIDGE_REQUEST,
      vault: typeof globalThis.A2_SET_PAIRING_SECRET,
      vaultRead: typeof globalThis.A2_GET_PAIRING_SECRET,
      vaultRoundtripOk: vaultRoundtrip === testSecret,
      hasPairing: await globalThis.A2_HAS_PAIRING_SECRET(),
      storageLeaksSecret: Object.prototype.hasOwnProperty.call(local, 'bridgeSecret'),
      storageContainsTestSecret: Object.values(local).some((value) => String(value) === testSecret)
    };
  });
  if (facts.version !== '0.5.23') throw new Error(`manifest version ${facts.version}`);
  for (const k of ['glm','gpt','request','vault','vaultRead']) if (facts[k] !== 'function') throw new Error(`${k} not loaded`);
  if (!facts.vaultRoundtripOk || !facts.hasPairing) throw new Error('pairing vault behavioral roundtrip failed');
  if (facts.storageLeaksSecret || facts.storageContainsTestSecret) throw new Error('pairing secret leaked to chrome.storage.local');
  console.log('MV3 service-worker + pairing-vault behavior: PASS', JSON.stringify(facts));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
