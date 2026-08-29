#!/usr/bin/env node
// GLM OBS_CB_5 probe: what does real Chromium do when Target.disposeBrowserContext
// is called on a context created with disposeOnDetach:true whose last target was
// already closed (i.e. the engine may have auto-disposed it)?
// Uses the repo's own chrome-process + cdp-client (native pipe) — the production
// transport. Read-only against the engine: creates an isolated temp profile.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ManagedChromeProcess } from '../src/chrome-process.mjs';

const CHROME = process.env.A2_CHROME_EXECUTABLE || process.argv[2];
if (!CHROME) { console.error('probe_chrome_executable_required'); process.exit(1); }
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-obscb5-'));
const results = { schema: 'metaengine.a2-compute-browser.obscb5-probe.v1', product: null, cases: [] };
try {
  const proc = new ManagedChromeProcess({
    executablePath: CHROME,
    userDataDir: path.join(root, 'chrome-data'),
    headless: true,
    allowNoSandbox: true
  });
  await proc.start();
  results.product = (await proc.cdp.call('Browser.getVersion')).product;
  const cdp = proc.cdp;

  // Case 1: dispose a context that still owns a live target (control: normal close path)
  const ctxA = (await cdp.call('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
  const tgtA = (await cdp.call('Target.createTarget', { url: 'about:blank', browserContextId: ctxA })).targetId;
  let r1;
  try { r1 = { ok: true, result: await cdp.call('Target.disposeBrowserContext', { browserContextId: ctxA }) }; }
  catch (e) { r1 = { ok: false, error: String(e?.message || e) }; }
  results.cases.push({ case: 'dispose_with_live_target', ...r1 });

  // Case 2 (OBS_CB_5 core): create ctx, create target, CLOSE the target first
  // (disposeOnDetach should auto-dispose the emptied context), then dispose the context.
  const ctxB = (await cdp.call('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
  const tgtB = (await cdp.call('Target.createTarget', { url: 'about:blank', browserContextId: ctxB })).targetId;
  const closedB = await cdp.call('Target.closeTarget', { targetId: tgtB });
  let r2;
  try { r2 = { ok: true, result: await cdp.call('Target.disposeBrowserContext', { browserContextId: ctxB }) }; }
  catch (e) { r2 = { ok: false, error: String(e?.message || e) }; }
  results.cases.push({ case: 'dispose_after_last_target_close', closeTargetResult: closedB, ...r2 });

  // Case 3: double dispose of the same (already disposed) context — idempotency?
  const ctxC = (await cdp.call('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
  await cdp.call('Target.disposeBrowserContext', { browserContextId: ctxC });
  let r3;
  try { r3 = { ok: true, result: await cdp.call('Target.disposeBrowserContext', { browserContextId: ctxC }) }; }
  catch (e) { r3 = { ok: false, error: String(e?.message || e) }; }
  results.cases.push({ case: 'double_dispose', ...r3 });

  // Case 4: create target in an already-disposed context id — the confusion case
  let r4;
  try { r4 = { ok: true, result: await cdp.call('Target.createTarget', { url: 'about:blank', browserContextId: ctxC }) }; }
  catch (e) { r4 = { ok: false, error: String(e?.message || e) }; }
  results.cases.push({ case: 'create_target_in_disposed_context', ...r4 });

  await proc.stop();
} finally {
  console.log(JSON.stringify(results, null, 1));
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
