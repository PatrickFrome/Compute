import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyR97VisualCaptures } from '../scripts/verify-r97-visual-captures-w69.mjs';

const HEAD = 'a'.repeat(40);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4096, 44)]);
const sha = createHash('sha256').update(png).digest('hex');

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'metaengine-w69-r97-'));
  const evidence = {
    schema: 'metaengine.browser.r97-visual-evidence.v2',
    source_head: HEAD, ok: true, presentation_only: true, authority_effect: false,
    remote_browser_content_captured: false, legacy_shell_captured: false,
    settings_controls_scoped_and_routes_verified: true,
    capture_count: 4,
    captures: Array.from({ length: 4 }, (_, i) => ({
      name: `screen-${i}`, file: `screen-${i}.png`, bytes: png.length, sha256: sha,
    })),
  };
  async function save() {
    await writeFile(join(root, 'r85-visual-evidence.json'), JSON.stringify(evidence));
  }
  try {
    await Promise.all(evidence.captures.map(x => writeFile(join(root, x.file), png)));
    await save();
    await fn({ root, evidence, save });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('W69 verifies exact-head screenshot bytes as CI staging, never installed or effect proof', async () => {
  await fixture(async ({ root }) => {
    const result = await verifyR97VisualCaptures(root, HEAD);
    assert.equal(result.capture_count, 4);
    assert.equal(result.provenance_scope, 'SOURCE_STAGING_CI_ONLY');
    assert.equal(result.installed_proof, 'UNKNOWN');
    assert.equal(result.authority_effect, false);
    assert.deepEqual(result.captures.map(x => x.sha256), Array(4).fill(sha));
  });
});

test('W69 rejects source drift, forged effect, false complete, count drift and duplicated capture', async () => {
  await fixture(async ({ root, evidence, save }) => {
    await assert.rejects(() => verifyR97VisualCaptures(root, 'b'.repeat(40)), /r97_wrong_source_head/);
    for (const [key, value, pattern] of [
      ['authority_effect', true, /r97_no_effect_authority/],
      ['ok', false, /r97_visual_gate_not_complete/],
      ['capture_count', 3, /r97_capture_count_drift/],
    ]) {
      const before = evidence[key]; evidence[key] = value; await save();
      await assert.rejects(() => verifyR97VisualCaptures(root, HEAD), pattern);
      evidence[key] = before; await save();
    }
    evidence.captures[3].file = evidence.captures[0].file; await save();
    await assert.rejects(() => verifyR97VisualCaptures(root, HEAD), /r97_duplicate_capture/);
  });
});

test('W69 rejects missing, modified and path-escaping screenshots', async () => {
  await fixture(async ({ root, evidence, save }) => {
    await writeFile(join(root, evidence.captures[0].file), Buffer.concat([png, Buffer.from([1])]));
    await assert.rejects(() => verifyR97VisualCaptures(root, HEAD), /r97_capture_size_drift/);
    await writeFile(join(root, evidence.captures[0].file), png);
    evidence.captures[0].file = '../escape.png'; await save();
    await assert.rejects(() => verifyR97VisualCaptures(root, HEAD), /r97_filename_must_be_flat_png/);
  });
});


test('W69 R97 workflow registers valid push/PR receipts without uploading a browser profile', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/client-wave10-w62-source-r97.yml', import.meta.url), 'utf8');
  const harness = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);
  assert.doesNotMatch(workflow, /^      METAENGINE_R85_VISUAL_EVIDENCE_DIR:/m);
  assert.match(workflow, /runner\.temp.*client-w69-r97-evidence/);
  assert.match(workflow, /client-w69-r97-evidence\\\*\.png/);
  assert.match(workflow, /client-w69-r97-evidence\\r85-visual-evidence\.json/);
  assert.match(harness, /path\.dirname\(OUTPUT_ROOT\)/);
  assert.match(harness, /app\.setPath\('userData', visualProfile\)/);
  assert.match(harness, /app\.setPath\('sessionData', visualSession\)/);
});


test('R97 v2 rejects retired v1 receipts and ambiguous/false settings evidence', async () => {
  await fixture(async ({root,evidence,save}) => {
    evidence.schema = 'metaengine.browser.r97-visual-evidence.v1'; await save();
    await assert.rejects(() => verifyR97VisualCaptures(root,HEAD), /r97-visual-evidence/);
    evidence.schema = 'metaengine.browser.r97-visual-evidence.v2';
    evidence.advanced_surfaces_settings_only = true; await save();
    await assert.rejects(() => verifyR97VisualCaptures(root,HEAD), /r97_obsolete_settings_evidence/);
    delete evidence.advanced_surfaces_settings_only;
    for (const value of [false, undefined, 'true']) {
      evidence.settings_controls_scoped_and_routes_verified = value; await save();
      await assert.rejects(() => verifyR97VisualCaptures(root,HEAD), /r97_settings_scope_not_verified/);
    }
  });
});
