import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ext = path.resolve(process.env.A2_EXTENSION_STAGE || 'coordination/chat-control-plane/extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-v071-final-'));
const sentinel = `final-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function boot(label, expectedSentinel = null) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const facts = await sw.evaluate(async ({ expectedSentinel, sentinel }) => {
      await globalThis.A2_SECRET_VAULT_READY;
      const manifest = chrome.runtime.getManifest();
      const local = await chrome.storage.local.get(null);
      const previousSentinel = local.a2FinalColdRestartSentinel || null;
      if (expectedSentinel == null) {
        await chrome.storage.local.set({ a2FinalColdRestartSentinel: sentinel });
      }
      return {
        extension_id: chrome.runtime.id,
        manifest_version: manifest.version,
        manifest_v3: manifest.manifest_version,
        runtime: globalThis.A2_OPERATOR_RUNTIME,
        final_runtime: globalThis.A2_FINAL_RUNTIME,
        milestone: globalThis.A2_RUNTIME?.milestone || null,
        roadmap_state: globalThis.A2_RUNTIME?.roadmap_state || null,
        release_channel: globalThis.A2_RUNTIME?.release_channel || null,
        authority_effect: globalThis.A2_RUNTIME?.authority_effect,
        bridge_request: typeof globalThis.A2_BRIDGE_REQUEST,
        debugger_run: typeof globalThis.A2_DEBUGGER_RUN,
        debugger_raw: typeof globalThis.A2_DEBUGGER_RUN_RAW_V062,
        typed_click: typeof globalThis.A2_OPERATOR_TYPED_CLICK_V1,
        secret_vault: typeof globalThis.A2_GET_PAIRING_SECRET,
        storage_leaks_bridge_secret: Object.prototype.hasOwnProperty.call(local, 'bridgeSecret'),
        previous_sentinel: previousSentinel,
        expected_sentinel: expectedSentinel
      };
    }, { expectedSentinel, sentinel });

    assert(facts.manifest_version === '0.7.1', `${label}: manifest version ${facts.manifest_version}`);
    assert(facts.manifest_v3 === 3, `${label}: not MV3`);
    assert(facts.runtime === '0.7.1' && facts.final_runtime === '0.7.1', `${label}: runtime drift`);
    assert(facts.milestone === 'EXTENSION_FINAL_V1', `${label}: milestone ${facts.milestone}`);
    assert(facts.roadmap_state === 'R_ROADMAP_COMPLETE', `${label}: roadmap state ${facts.roadmap_state}`);
    assert(facts.release_channel === 'stable', `${label}: release channel ${facts.release_channel}`);
    assert(facts.authority_effect === false, `${label}: runtime descriptor minted authority`);
    for (const key of ['bridge_request', 'debugger_run', 'debugger_raw', 'typed_click', 'secret_vault']) {
      assert(facts[key] === 'function', `${label}: ${key} not loaded`);
    }
    assert(facts.storage_leaks_bridge_secret === false, `${label}: pairing secret leaked to local storage`);
    if (expectedSentinel != null) assert(facts.previous_sentinel === expectedSentinel, `${label}: durable local state did not survive cold restart`);
    return facts;
  } finally {
    await context.close();
  }
}

try {
  const first = await boot('boot-1');
  const second = await boot('boot-2', sentinel);
  assert(first.extension_id === second.extension_id, 'extension identity changed across cold restart');
  console.log('A2 Browser Operator v0.7.1 final cold-restart MV3 smoke: PASS', JSON.stringify({ first, second }));
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
