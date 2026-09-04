import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const physical = fs.readFileSync(new URL('../../../.github/workflows/metaengine-browser-self-update-fast-e2e.yml', import.meta.url), 'utf8');
const publisher = fs.readFileSync(new URL('../../../.github/workflows/metaengine-browser-fast-autorelease.yml', import.meta.url), 'utf8');

function ordered(source, ...needles) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `missing:${needle}`);
    assert.ok(next > cursor, `out_of_order:${needle}`);
    cursor = next;
  }
}

test('physical E2E seals installed executable SHA256 only after the exact update succeeds', () => {
  ordered(
    physical,
    'Published baseline to exact candidate physical update',
    'Seal installed executable digest into physical evidence',
    'Upload exact fast self-update evidence',
  );
  assert.match(physical, /Get-FileHash -LiteralPath \$app -Algorithm SHA256/);
  assert.match(physical, /installed_target_executable_sha256_readback_mismatch/);
  assert.match(physical, /installed_target_executable_digest_missing/);
});

test('publisher verifies installed digest and immutable manifest bytes before draft publication', () => {
  ordered(
    publisher,
    "installed_digest=str(m.get('installed_executable_sha256') or '').strip().lower()",
    "manifest_digest=hashlib.sha256(mp.read_bytes()).hexdigest()",
    'Create draft from exact tested bytes',
  );
  assert.match(publisher, /installed_executable_sha256_invalid/);
  assert.match(publisher, /MANIFEST_SHA256/);
  assert.match(publisher, /github_asset_digest_missing_or_mismatch/);
  assert.match(publisher, /draft_asset_set_invalid/);
});

test('publisher requires exact identity, state, digest, and size for every current release asset', () => {
  const required = [
    'dev.yml',
    'verified-self-update-manifest.json',
    'guardian-native-staging-manifest.json',
    'METAENGINEBrowserGuardian.exe',
    'METAENGINEBrowserGuardianConfigure.exe',
  ];
  for (const name of required) assert.ok(publisher.includes(name), `missing_release_asset:${name}`);
  assert.match(publisher, /if len\(raw_assets\)!=len\(expected_assets\):/);
  assert.match(publisher, /draft_asset_name_duplicate/);
  assert.match(publisher, /if set\(assets\)!=expected:/);
  assert.match(publisher, /if asset\.get\('state'\)!='uploaded':/);
  assert.match(publisher, /if asset\.get\('digest'\)!=f"sha256:\{os\.environ\[sha_key\]\}":/);
  assert.match(publisher, /github_asset_size_mismatch/);
  assert.doesNotMatch(publisher, /if\s+\w*digest\s+and\s+\w*digest\s*!=/);
});
