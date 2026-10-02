import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'browser-windows-package-smoke.yml');

test('Package Smoke generates SBOM after frozen install proof and before packaging', () => {
  const source = fs.readFileSync(workflowPath, 'utf8');
  const npmCi = source.indexOf('- name: Install exact frozen Browser dependency tree');
  const dependency = source.indexOf('- name: Capture exact installed dependency resolution');
  const sbom = source.indexOf('- name: Generate npm CycloneDX SBOM evidence');
  const identity = source.indexOf('- name: Compute expected Build Identity V3 before packaging');
  const builder = source.indexOf("node_modules\\.bin\\electron-builder.cmd");

  assert.ok(npmCi >= 0);
  assert.ok(dependency > npmCi);
  assert.ok(sbom > dependency);
  assert.ok(identity > sbom);
  assert.ok(builder > identity);

  assert.match(source, /npm sbom --sbom-format=cyclonedx --sbom-type=application/);
  assert.match(source, /npm-sbom-evidence\.mjs/);
  assert.match(source, /npm_sbom_semantic_inventory_sha256/);
  assert.match(source, /npm_sbom_raw_sha256/);
  assert.match(source, /npm_sbom_component_count/);
});

test('SBOM evidence is carried by the one-built candidate and package evidence only once', () => {
  const source = fs.readFileSync(workflowPath, 'utf8');
  assert.equal((source.match(/\$\{\{ runner\.temp \}\}\/npm-sbom\.cdx\.json/g) || []).length, 2);
  assert.equal((source.match(/\$\{\{ runner\.temp \}\}\/npm-sbom-evidence\.json/g) || []).length, 2);
  assert.equal((source.match(/Generate npm CycloneDX SBOM evidence/g) || []).length, 1);
  assert.equal((source.match(/Publish immutable candidate for parallel downstream qualification/g) || []).length, 1);
  assert.equal((source.match(/electron-builder\.cmd/g) || []).length >= 1, true);
  assert.doesNotMatch(source, /attestations:\s*write/);
  assert.doesNotMatch(source, /id-token:\s*write/);
});
