import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import test from 'node:test';
import { createLinuxSkillSourceAdapter } from '../skill-source-adapter-linux-v1.mjs';
import { createSkillRegistry } from '../skill-registry-v1.mjs';

function writeSkill(root, name, reference) {
  const directory = join(root, name);
  mkdirSync(join(directory, 'references'), { recursive: true });
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} real R7M runtime fixture\n---\n## Workflow\n\nRead the bounded package through the native source adapter.\n`);
  writeFileSync(join(directory, 'references', 'REFERENCE.md'), reference);
  const script = join(directory, 'scripts', 'check.sh');
  writeFileSync(script, '#!/bin/sh\nexit 0\n');
  chmodSync(script, 0o755);
}

test('R7M registry refresh and hydration cross one real R7L launcher/helper process epoch', async () => {
  const launcherPath = process.env.A2_R7M_REAL_LAUNCHER;
  assert.ok(launcherPath, 'A2_R7M_REAL_LAUNCHER is required');
  assert.equal(normalize(launcherPath), launcherPath);

  const root = mkdtempSync(join(tmpdir(), 'a2-r7m-real-'));
  writeSkill(root, 'alpha', 'reference-alpha');
  writeSkill(root, 'inspect', 'reference-inspect');

  const adapter = createLinuxSkillSourceAdapter({ launcherPath, skillRoot: root, requestTimeoutMs: 5_000 });
  try {
    const registry = createSkillRegistry(adapter);
    const snapshot = await registry.refresh();
    assert.equal(snapshot.status, 'SUPPORTED');
    assert.equal(snapshot.skill_count, 2);
    assert.deepEqual(snapshot.skills.map((entry) => entry.name), ['alpha', 'inspect']);
    assert.equal(snapshot.source_adapter_daemon_owned, true);
    assert.equal(snapshot.ambient_filesystem_access, false);
    assert.equal(snapshot.authority_effect, false);
    assert.equal(snapshot.execution_eligible, false);

    const selected = snapshot.skills.find((entry) => entry.name === 'inspect');
    const hydrated = await registry.hydrateInstructions(selected.skill_ref, {
      expectedRegistryFingerprint: snapshot.registry_fingerprint
    });
    assert.equal(hydrated.name, 'inspect');
    assert.match(hydrated.instructions, /bounded package/);
    assert.equal(hydrated.fresh_package_revalidated, true);
    assert.equal(hydrated.package_manifest_digest, selected.package_manifest_digest);
    assert.equal(hydrated.authority_effect, false);
    assert.equal(hydrated.execution_eligible, false);
  } finally {
    adapter.close();
  }
});
