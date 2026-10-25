import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const HEX_SOURCE = /^[a-f0-9]{40}$/;

export async function verifyR97VisualCaptures(root, expectedHead) {
  assert.match(expectedHead, HEX_SOURCE, 'r97_expected_source_sha_required');
  const dir = await realpath(root);
  const evidence = JSON.parse(await readFile(path.join(dir, 'r85-visual-evidence.json'), 'utf8'));
  assert.equal(evidence.schema, 'metaengine.browser.r97-visual-evidence.v2');
  assert.equal(Object.hasOwn(evidence, 'advanced_surfaces_settings_only'), false, 'r97_obsolete_settings_evidence');
  assert.equal(evidence.settings_controls_scoped_and_routes_verified, true, 'r97_settings_scope_not_verified');
  assert.equal(evidence.source_head, expectedHead, 'r97_wrong_source_head');
  assert.equal(evidence.ok, true, 'r97_visual_gate_not_complete');
  assert.equal(evidence.presentation_only, true, 'r97_no_installed_authority');
  assert.equal(evidence.authority_effect, false, 'r97_no_effect_authority');
  assert.equal(evidence.remote_browser_content_captured, false, 'r97_remote_browser_not_allowed');
  assert.equal(evidence.legacy_shell_captured, false, 'r97_legacy_shell_not_allowed');
  assert.ok(Array.isArray(evidence.captures) && evidence.captures.length >= 4, 'r97_missing_screenshots');
  assert.equal(evidence.capture_count, evidence.captures.length, 'r97_capture_count_drift');

  const seen = new Set();
  const captures = [];
  for (const capture of evidence.captures) {
    assert.equal(typeof capture?.file, 'string', 'r97_filename_required');
    assert.match(capture.file, /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/, 'r97_filename_must_be_flat_png');
    assert.ok(!seen.has(capture.file), 'r97_duplicate_capture');
    seen.add(capture.file);
    assert.match(capture.sha256, HEX_SHA256, 'r97_capture_digest_missing');
    assert.ok(Number.isSafeInteger(capture.bytes) && capture.bytes >= 4096, 'r97_capture_byte_count_invalid');
    const file = path.join(dir, capture.file);
    assert.equal(await realpath(file), file, 'r97_capture_symlink_forbidden');
    const bytes = await readFile(file);
    assert.ok(bytes.subarray(0, 8).equals(PNG_HEADER), 'r97_capture_not_png');
    assert.equal(bytes.length, capture.bytes, 'r97_capture_size_drift');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.sha256, 'r97_capture_digest_drift');
    captures.push({ file: capture.file, sha256: capture.sha256, bytes: capture.bytes });
  }
  return Object.freeze({
    schema: 'metaengine.client.w69.r97-ci-captures.v1',
    source_head: expectedHead,
    provenance_scope: 'SOURCE_STAGING_CI_ONLY',
    installed_proof: 'UNKNOWN',
    authority_effect: false,
    capture_count: captures.length,
    captures,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyR97VisualCaptures(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error('r97_ci_capture_verification_failed:', error?.message || 'unknown');
    process.exitCode = 1;
  }
}
