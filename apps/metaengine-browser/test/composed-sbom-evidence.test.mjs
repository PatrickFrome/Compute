import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createComposedSbom } from '../scripts/composed-sbom-evidence.mjs';

const HEAD = 'a'.repeat(40);
const VERSION = '0.7.0-dev.36991000001.1';
const I = (char) => char.repeat(64);

function write(root, name, value) {
  const p = path.join(root, name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
  return p;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-composed-sbom-'));
  const npmRoot = 'pkg:npm/%40metaengine/browser-shell@0.7.0-dev.36991000001.1';
  const paths = {
    npmSbom: write(root, 'npm.cdx.json', {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      metadata: {
        component: {
          type: 'application',
          'bom-ref': npmRoot,
          group: '@metaengine',
          name: 'browser-shell',
          version: VERSION,
          purl: npmRoot,
        },
      },
      components: [
        {
          type: 'library',
          'bom-ref': 'pkg:npm/example@1.0.0',
          name: 'example',
          version: '1.0.0',
          purl: 'pkg:npm/example@1.0.0',
        },
      ],
      dependencies: [
        { ref: npmRoot, dependsOn: ['pkg:npm/example@1.0.0'] },
        { ref: 'pkg:npm/example@1.0.0', dependsOn: [] },
      ],
    }),
    npmEvidence: write(root, 'npm-evidence.json', {
      schema: 'metaengine.browser.npm-sbom-evidence.v1',
      source_head: HEAD,
      package_name: '@metaengine/browser-shell',
      package_version: VERSION,
      semantic_inventory_sha256: I('1'),
      package_lock_sha256: I('2'),
      dependency_resolution_sha256: I('3'),
      npm_version: '11.19.0',
      authority_effect: false,
    }),
    ui: write(root, 'ui.json', {
      schema: 'me2.ui-bundle-manifest.v1',
      ui_version: '0.57.1',
      build_id: 'abcdef123456',
      git_sha: HEAD,
      size_bytes: 40000000,
      content_sha256: I('4'),
    }),
    daemon: write(root, 'daemon.json', {
      schema: 'metaengine.browser.me2-daemon-package.v1',
      source_head: HEAD,
      daemon_version: '0.57.1',
      build_bun_version: '1.3.3',
      executable_sha256: I('5'),
      executable_bytes: 2000000,
      runtime_embedded: true,
      external_bun_required: false,
      probe_only_entrypoint: 'browser-probe-entry.ts',
      authority_effect: false,
    }),
    guardian: write(root, 'guardian.json', {
      schema: 'metaengine.browser.guardian-native-staging-manifest.v1',
      source_head: HEAD,
      package_version: VERSION,
      staging_only: true,
      service_activation_authorized: false,
      authority_effect: false,
      binaries: [
        {
          name: 'METAENGINEBrowserGuardian.exe',
          role: 'scm_service_host_with_bounded_update_actuator',
          sha256: I('6'),
          size: 123456,
        },
        {
          name: 'METAENGINEBrowserGuardianConfigure.exe',
          role: 'scm_secure_configurator',
          sha256: I('7'),
          size: 65432,
        },
      ],
    }),
    bootstrap: write(root, 'bootstrap.json', {
      schema: 'metaengine.browser-guardian.machine-bootstrap-binding.v1',
      source_head: HEAD,
      package_version: VERSION,
      bootstrap_name: `METAENGINE-Guardian-Bootstrap-${VERSION}-x64.exe`,
      bootstrap_sha256: I('8'),
      bootstrap_size: 1283584,
      guardian_manifest_sha256: I('9'),
      service_sha256: I('6'),
      configurator_sha256: I('7'),
      embedded_assets_only: true,
      explicit_elevated_install_required: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
    provenance: write(root, 'provenance.json', {
      schema: 'metaengine.browser.installer-provenance.v3',
      source_head: HEAD,
      package_version: VERSION,
      installer_sha256: I('a'),
      build_identity_sha256: I('b'),
      package_lock_sha256: I('2'),
      dependency_resolution_sha256: I('3'),
      npm_version: '11.19.0',
    }),
  };
  return { root, paths, npmRoot };
}

function compose(f) {
  return createComposedSbom({
    npmSbomPath: f.paths.npmSbom,
    npmEvidencePath: f.paths.npmEvidence,
    uiManifestPath: f.paths.ui,
    daemonManifestPath: f.paths.daemon,
    guardianManifestPath: f.paths.guardian,
    bootstrapBindingPath: f.paths.bootstrap,
    installerProvenancePath: f.paths.provenance,
    sourceHead: HEAD,
    packageVersion: VERSION,
  });
}

test('composed Browser SBOM inventories npm and verified first-party payloads without completeness overclaim', () => {
  const f = fixture();
  try {
    const { sbom, evidence } = compose(f);
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.5');
    assert.equal(sbom.metadata.component.name, 'METAENGINE Browser');
    assert.equal(sbom.metadata.component.version, VERSION);
    assert.deepEqual(sbom.metadata.component.hashes, [{ alg: 'SHA-256', content: I('a') }]);
    assert.equal(sbom.compositions.length, 1);
    assert.equal(sbom.compositions[0].aggregate, 'incomplete');
    assert.ok(sbom.compositions[0].assemblies.includes(f.npmRoot));
    assert.ok(sbom.components.some((x) => x.name === 'METAENGINE ME2 UI'));
    assert.ok(sbom.components.some((x) => x.name === 'METAENGINE ME2 Daemon'));
    assert.ok(sbom.components.some((x) => x.name === 'METAENGINEBrowserGuardian.exe'));
    assert.ok(sbom.components.some((x) => x.name === 'METAENGINEBrowserGuardianConfigure.exe'));
    assert.ok(sbom.components.some((x) => x.name.startsWith('METAENGINE-Guardian-Bootstrap-')));

    assert.equal(evidence.schema, 'metaengine.browser.composed-sbom-evidence.v1');
    assert.equal(evidence.first_party_component_count, 5);
    assert.equal(evidence.npm_component_count, 1);
    assert.equal(evidence.total_component_count, 7); // npm root + one npm component + five first-party payloads
    assert.equal(evidence.composition_aggregate, 'incomplete');
    assert.equal(evidence.authority_effect, false);
    assert.match(evidence.composed_semantic_inventory_sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('composed semantic inventory is stable under npm document metadata volatility', () => {
  const a = fixture();
  const b = fixture();
  try {
    const bNpm = JSON.parse(fs.readFileSync(b.paths.npmSbom, 'utf8'));
    bNpm.serialNumber = 'urn:uuid:11111111-2222-3333-4444-555555555555';
    bNpm.metadata.timestamp = '2099-01-01T00:00:00.000Z';
    fs.writeFileSync(b.paths.npmSbom, JSON.stringify(bNpm, null, 2) + '\n');

    assert.equal(
      compose(a).evidence.composed_semantic_inventory_sha256,
      compose(b).evidence.composed_semantic_inventory_sha256,
    );
  } finally {
    fs.rmSync(a.root, { recursive: true, force: true });
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test('source, version and provenance material drift fail closed', () => {
  for (const mutate of [
    (f) => {
      const x = JSON.parse(fs.readFileSync(f.paths.ui, 'utf8')); x.git_sha = 'b'.repeat(40);
      fs.writeFileSync(f.paths.ui, JSON.stringify(x));
    },
    (f) => {
      const x = JSON.parse(fs.readFileSync(f.paths.guardian, 'utf8')); x.package_version = '0.7.0-dev.1.1';
      fs.writeFileSync(f.paths.guardian, JSON.stringify(x));
    },
    (f) => {
      const x = JSON.parse(fs.readFileSync(f.paths.provenance, 'utf8')); x.package_lock_sha256 = I('f');
      fs.writeFileSync(f.paths.provenance, JSON.stringify(x));
    },
  ]) {
    const f = fixture();
    try {
      mutate(f);
      assert.throws(() => compose(f), /composed_sbom_/);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('Guardian bootstrap must bind the exact service/configurator digests', () => {
  const f = fixture();
  try {
    const x = JSON.parse(fs.readFileSync(f.paths.bootstrap, 'utf8'));
    x.service_sha256 = I('f');
    fs.writeFileSync(f.paths.bootstrap, JSON.stringify(x));
    assert.throws(() => compose(f), /composed_sbom_bootstrap_service_sha_mismatch/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('authority-bearing Guardian or daemon manifests are refused', () => {
  const f1 = fixture();
  try {
    const x = JSON.parse(fs.readFileSync(f1.paths.guardian, 'utf8'));
    x.service_activation_authorized = true;
    fs.writeFileSync(f1.paths.guardian, JSON.stringify(x));
    assert.throws(() => compose(f1), /composed_sbom_guardian_authority_invalid/);
  } finally {
    fs.rmSync(f1.root, { recursive: true, force: true });
  }

  const f2 = fixture();
  try {
    const x = JSON.parse(fs.readFileSync(f2.paths.daemon, 'utf8'));
    x.authority_effect = true;
    fs.writeFileSync(f2.paths.daemon, JSON.stringify(x));
    assert.throws(() => compose(f2), /composed_sbom_daemon_authority_invalid/);
  } finally {
    fs.rmSync(f2.root, { recursive: true, force: true });
  }
});

test('physical Package Smoke wires composed SBOM after provenance into the one immutable candidate', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '../../..');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/browser-windows-package-smoke.yml'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/metaengine-browser/package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/metaengine-browser/package-lock.json'), 'utf8'));
  assert.notEqual(packageJson.version, VERSION, 'consumed npm-SBOM physical package identity must not be reused');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.['']?.version, packageJson.version);
  const provenance = workflow.indexOf("installer_provenance_write_failed");
  const compose = workflow.indexOf("scripts/composed-sbom-evidence.mjs");
  const publish = workflow.indexOf("Publish immutable candidate for parallel downstream qualification");
  assert.ok(provenance >= 0 && compose > provenance && publish > compose);
  for (const material of ['--npm-sbom','--npm-evidence','--ui-manifest','--daemon-manifest','--guardian-manifest','--bootstrap-binding','--provenance']) assert.ok(workflow.includes(material));
  for (const artifact of ['browser-composed-sbom.cdx.json','browser-composed-sbom-evidence.json','me2-ui-manifest.json','me2-daemon-manifest.json','guardian-native-manifest.json']) assert.ok(workflow.includes(artifact));
  assert.match(workflow, /composed_sbom_semantic_inventory_sha256/);
  assert.match(workflow, /composed_sbom_raw_sha256/);
  assert.match(workflow, /composition_aggregate -ne 'incomplete'/);
  assert.match(workflow, /windows-nsis-package-smoke:[\s\S]*?permissions:[\s\S]*?id-token:\s*write[\s\S]*?attestations:\s*write/);
  assert.match(workflow, /Generate exact-source SLSA build provenance for physical push candidate/);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/physical\/build-slsa-provenance-v1'/);
  assert.match(workflow, /installer-slsa-provenance\.bundle\.json/);
  assert.match(workflow, /metaengine\.browser\.package-slsa-provenance-receipt\.v1/);
  assert.match(workflow, /promotion_authorized=\$false/);
  assert.match(workflow, /release_published=\$false/);
  assert.match(workflow, /authority_effect=\$false/);
});
