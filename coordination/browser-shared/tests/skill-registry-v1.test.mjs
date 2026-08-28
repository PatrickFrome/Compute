import assert from 'node:assert/strict';
import test from 'node:test';
import { createSkillRegistry, SKILL_REGISTRY_LIMITS } from '../skill-registry-v1.mjs';

function skillBytes(name, body = '## Workflow\n\nFollow the bounded procedure.') {
  return Buffer.from(`---\nname: ${name}\ndescription: Use ${name} for deterministic browser workflows.\n---\n${body}\n`);
}

function packageFiles(name, { body, reference = 'reference-v1', script = '#!/bin/sh\necho inert\n' } = {}) {
  return [
    { path: 'SKILL.md', type: 'file', executable: false, bytes: skillBytes(name, body) },
    { path: 'references/REFERENCE.md', type: 'file', executable: false, bytes: Buffer.from(reference) },
    { path: 'scripts/check.sh', type: 'file', executable: true, bytes: Buffer.from(script) }
  ];
}

function memorySource(initialEntries, discoveryOrder = null) {
  const packages = new Map(Object.entries(initialEntries));
  let listCalls = 0;
  let readCalls = 0;
  let activeReads = 0;
  let maxActiveReads = 0;
  return {
    packages,
    stats: () => ({ listCalls, readCalls, maxActiveReads }),
    adapter: {
      async listSkillNames() {
        listCalls += 1;
        return discoveryOrder ? [...discoveryOrder] : [...packages.keys()];
      },
      async readSkillPackage(name) {
        readCalls += 1;
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        try {
          const value = packages.get(name);
          if (!value) throw new Error('missing');
          await Promise.resolve();
          return value;
        } finally {
          activeReads -= 1;
        }
      }
    }
  };
}

test('registry snapshot is deterministic, metadata-only and package-identity bound', async () => {
  const entries = {
    zeta: packageFiles('zeta'),
    alpha: packageFiles('alpha')
  };
  const a = memorySource(entries, ['zeta', 'alpha']);
  const b = memorySource(entries, ['alpha', 'zeta']);
  const first = await createSkillRegistry(a.adapter).refresh();
  const second = await createSkillRegistry(b.adapter).refresh();
  assert.deepEqual(first, second);
  assert.deepEqual(first.skills.map((entry) => entry.name), ['alpha', 'zeta']);
  assert.equal(first.full_instructions_embedded, false);
  assert.equal(first.source_locators_embedded, false);
  assert.equal(first.ambient_filesystem_access, false);
  assert.equal(first.authority_effect, false);
  assert.equal(first.execution_eligible, false);
  assert.equal(first.registry_bytes, Buffer.byteLength(JSON.stringify(first)));
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('Follow the bounded procedure'), false);
  assert.equal(serialized.includes('reference-v1'), false);
  assert.equal(serialized.includes('echo inert'), false);
  assert.ok(first.skills.every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.package_manifest_digest)));
});

test('fresh instruction hydration requires exact registry and raw package identity', async () => {
  const source = memorySource({ 'code-review': packageFiles('code-review') });
  const registry = createSkillRegistry(source.adapter);
  const snapshot = await registry.refresh();
  const selected = snapshot.skills[0];
  const hydrated = await registry.hydrateInstructions(selected.skill_ref, {
    expectedRegistryFingerprint: snapshot.registry_fingerprint
  });
  assert.match(hydrated.instructions, /bounded procedure/);
  assert.equal(hydrated.fresh_package_revalidated, true);
  assert.equal(hydrated.package_manifest_digest, selected.package_manifest_digest);
  assert.equal(hydrated.provenance_verified, false);
  assert.equal(hydrated.authority_effect, false);
  assert.equal(hydrated.execution_eligible, false);

  source.packages.set('code-review', packageFiles('code-review', { reference: 'reference-v2' }));
  await assert.rejects(() => registry.hydrateInstructions(selected.skill_ref, {
    expectedRegistryFingerprint: snapshot.registry_fingerprint
  }), /skill_package_digest_stale/);
});

test('instruction mutation fails fresh revalidation instead of trusting an old semantic ref', async () => {
  const source = memorySource({ inspect: packageFiles('inspect') });
  const registry = createSkillRegistry(source.adapter);
  const snapshot = await registry.refresh();
  const selected = snapshot.skills[0];
  source.packages.set('inspect', packageFiles('inspect', { body: '## Workflow\n\nChanged instructions.' }));
  await assert.rejects(() => registry.hydrateInstructions(selected.skill_ref, {
    expectedRegistryFingerprint: snapshot.registry_fingerprint
  }), /skill_package_digest_stale|skill_package_semantic_fingerprint_stale/);
});

test('failed refresh is transactional and preserves the last published snapshot', async () => {
  const source = memorySource({ alpha: packageFiles('alpha'), beta: packageFiles('beta') });
  const registry = createSkillRegistry(source.adapter);
  const good = await registry.refresh();
  source.packages.set('beta', [
    { path: 'references/REFERENCE.md', type: 'file', executable: false, bytes: Buffer.from('missing skill') }
  ]);
  await assert.rejects(() => registry.refresh(), /skill_package_skill_file_missing/);
  assert.deepEqual(registry.snapshot(), good);
});

test('concurrent refreshes collapse to one sequential source scan', async () => {
  const source = memorySource({ alpha: packageFiles('alpha'), beta: packageFiles('beta'), gamma: packageFiles('gamma') });
  const registry = createSkillRegistry(source.adapter);
  const snapshots = await Promise.all(Array.from({ length: 32 }, () => registry.refresh()));
  assert.ok(snapshots.every((entry) => entry.registry_fingerprint === snapshots[0].registry_fingerprint));
  assert.deepEqual(source.stats(), { listCalls: 1, readCalls: 3, maxActiveReads: 1 });
});

test('external package file fields are snapshotted once before identity and semantic compilation', async () => {
  const counters = { path: 0, type: 0, executable: 0, bytes: 0 };
  const raw = {};
  Object.defineProperties(raw, {
    path: { enumerable: true, get() { counters.path += 1; return 'SKILL.md'; } },
    type: { enumerable: true, get() { counters.type += 1; return 'file'; } },
    executable: { enumerable: true, get() { counters.executable += 1; return false; } },
    bytes: { enumerable: true, get() { counters.bytes += 1; return skillBytes('snapshot-once'); } }
  });
  const registry = createSkillRegistry({
    async listSkillNames() { return ['snapshot-once']; },
    async readSkillPackage() { return [raw]; }
  });
  await registry.refresh();
  assert.deepEqual(counters, { path: 1, type: 1, executable: 1, bytes: 1 });
});

test('adapter methods are captured once and are never exposed through the registry snapshot', async () => {
  let listGetterReads = 0;
  let readGetterReads = 0;
  const adapter = {};
  Object.defineProperties(adapter, {
    listSkillNames: { get() { listGetterReads += 1; return async () => ['alpha']; } },
    readSkillPackage: { get() { readGetterReads += 1; return async () => packageFiles('alpha'); } }
  });
  const registry = createSkillRegistry(adapter);
  const snapshot = await registry.refresh();
  assert.equal(listGetterReads, 1);
  assert.equal(readGetterReads, 1);
  assert.equal(JSON.stringify(snapshot).includes('readSkillPackage'), false);
  assert.equal(JSON.stringify(snapshot).includes('listSkillNames'), false);
});

test('stale registry fingerprint and hydration before refresh fail closed', async () => {
  const source = memorySource({ alpha: packageFiles('alpha') });
  const registry = createSkillRegistry(source.adapter);
  assert.throws(() => registry.snapshot(), /skill_registry_not_ready/);
  await assert.rejects(() => registry.hydrateInstructions(`skill_${'a'.repeat(24)}`, {
    expectedRegistryFingerprint: `sha256:${'b'.repeat(64)}`
  }), /skill_registry_not_ready/);
  const snapshot = await registry.refresh();
  await assert.rejects(() => registry.hydrateInstructions(snapshot.skills[0].skill_ref, {
    expectedRegistryFingerprint: `sha256:${'b'.repeat(64)}`
  }), /skill_registry_snapshot_stale/);
});

test('registry cardinality and duplicate names fail closed', async () => {
  const tooMany = Array.from({ length: SKILL_REGISTRY_LIMITS.maxSkills + 1 }, (_, index) => `skill-${String(index).padStart(3, '0')}`);
  const registry = createSkillRegistry({
    async listSkillNames() { return tooMany; },
    async readSkillPackage(name) { return packageFiles(name); }
  });
  await assert.rejects(() => registry.refresh(), /skill_registry_names_too_many/);

  const duplicate = createSkillRegistry({
    async listSkillNames() { return ['alpha', 'alpha']; },
    async readSkillPackage(name) { return packageFiles(name); }
  });
  await assert.rejects(() => duplicate.refresh(), /skill_registry_name_duplicate/);
});
