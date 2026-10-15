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
    schema: 'metaengine.browser.r97-visual-evidence.v1',
    source_head: HEAD, ok: true, presentation_only: true, authority_effect: false,
    remote_browser_content_captured: false, legacy_shell_captured: false,
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
