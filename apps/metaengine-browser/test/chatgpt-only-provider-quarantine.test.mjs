import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertLegacyProviderCommandAllowed,
  legacyProviderQuarantineDecision,
} from '../src/legacy-provider-quarantine.mjs';

test('ChatGPT-only quarantine blocks legacy provider page effects', () => {
  for (const action of ['SEMANTIC_TYPE','TYPED_CLICK','STOP_GENERATION','PRESS_KEY','SCROLL','RELOAD']) {
    const decision = legacyProviderQuarantineDecision({
      action,
      platform: 'GLM_ZAI',
      current_url: 'https://chat.z.ai/c/legacy',
    });
    assert.equal(decision.allowed, false, action);
    assert.equal(decision.reason, 'LEGACY_PROVIDER_EXECUTION_DISABLED');
    assert.equal(decision.authority_effect, false);
  }
});

test('ChatGPT-only quarantine blocks creation/navigation into z.ai', () => {
  for (const action of ['NEW_TAB','NAVIGATE']) {
    assert.throws(() => assertLegacyProviderCommandAllowed({
      action,
      next_url: 'https://chat.z.ai/c/legacy',
    }), /LEGACY_PROVIDER_NAVIGATION_DISABLED/);
  }
});

test('legacy read compatibility and retirement cleanup remain available', () => {
  for (const action of ['CAPTURE','READ_TRANSCRIPT','TAB_TELEMETRY','CAPTURE_VIEW','SELECT_TAB','CLOSE_TAB']) {
    const decision = legacyProviderQuarantineDecision({
      action,
      platform: 'GLM_ZAI',
      current_url: 'https://chat.z.ai/c/legacy',
    });
    assert.equal(decision.allowed, true, action);
    assert.equal(decision.legacy_read_compatibility, true);
  }
  const retire = legacyProviderQuarantineDecision({
    action: 'NAVIGATE',
    platform: 'GLM_ZAI',
    current_url: 'https://chat.z.ai/c/legacy',
    next_url: 'https://chatgpt.com/',
  });
  assert.equal(retire.allowed, true);
  assert.equal(retire.retirement_cleanup, true);
});

test('ordinary ChatGPT page effects remain unaffected', () => {
  const decision = legacyProviderQuarantineDecision({
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    current_url: 'https://chatgpt.com/c/current',
  });
  assert.equal(decision.allowed, true);
});

test('production command boundary wires the quarantine before physical dispatch', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const main = await fs.readFile(path.join(here, '..', 'src', 'main.mjs'), 'utf8');
  assert.match(main, /assertLegacyProviderCommandAllowed\(\{/);
  assert.match(main, /current_url:\s*quarantineTab\?\.url/);
  assert.match(main, /next_url:\s*\['NEW_TAB','NAVIGATE'\]\.includes\(action\)/);
});

test('canonical convergence policy names ChatGPT as active provider', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const doc = await fs.readFile(path.join(here, '..', 'CONVERGENCE_CANDIDATE.md'), 'utf8');
  const start = doc.indexOf('Canonical production authority:');
  const end = doc.indexOf('Attempted successor identity', start);
  assert.ok(start >= 0 && end > start, 'canonical policy section must be present');
  const canonical = doc.slice(start, end);
  assert.match(canonical, /authenticated ChatGPT Web UI sessions/);
  assert.doesNotMatch(canonical, /authenticated z\.ai Agent Web UI sessions/);
  assert.doesNotMatch(canonical, /post-update z\.ai Agent E2E evidence/);
});


test('agent tool Edge route is ChatGPT-only before DB issuance', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const edge = await fs.readFile(path.join(here, '..', 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');
  const start = edge.indexOf('async function issueTool');
  const end = edge.indexOf('async function health', start);
  assert.ok(start >= 0 && end > start, 'issueTool source block must be present');
  const issueTool = edge.slice(start, end);
  assert.match(issueTool, /p_platform:'CHATGPT'/);
  assert.doesNotMatch(issueTool, /p_platform:'GLM_ZAI'/);
});

test('DB command authority rejects active GLM while retaining terminal history', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(here, '..', '..', '..', 'supabase', 'migrations', '20261004094000_browser_supervisor_chatgpt_only_platform_v1.sql'),
    'utf8',
  );
  assert.match(sql, /platform is distinct from 'GLM_ZAI'/);
  assert.match(sql, /status not in \('PENDING','LEASED'\)/);
  assert.match(sql, /not valid/);
  assert.match(sql, /validate constraint a2_browser_supervisor_command_no_active_legacy_platform_ck/);
  assert.doesNotMatch(sql, /delete\s+from/i, 'historical evidence must not be deleted');
});
