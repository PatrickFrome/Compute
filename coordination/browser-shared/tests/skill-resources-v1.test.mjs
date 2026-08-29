import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSkillResourceInventory, hydrateSkillResource, SKILL_RESOURCE_LIMITS } from '../skill-resources-v1.mjs';

const SKILL_FP = `sha256:${'a'.repeat(64)}`;

function resource(path, content, executable = false, type = 'file') {
  return { path, content, executable, type };
}

test('selected-skill resource inventory is content-addressed and embeds no resource body', () => {
  const sources = [
    resource('references/REFERENCE.md', 'Detailed reference material.'),
    resource('assets/template.txt', 'Template body.'),
    resource('scripts/check.sh', '#!/bin/sh\necho safe-preview\n', true)
  ];
  const inventory = compileSkillResourceInventory(SKILL_FP, sources);
  assert.equal(inventory.resource_count, 3);
  assert.equal(inventory.content_embedded, false);
  assert.equal(inventory.scripts_inert, true);
  assert.equal(inventory.source_snapshot_once, true);
  assert.equal(inventory.authority_effect, false);
  assert.equal(inventory.execution_eligible, false);
  assert.equal(inventory.script_execution_exposed, false);
  assert.equal(inventory.inventory_bytes, Buffer.byteLength(JSON.stringify(inventory)));
  const serialized = JSON.stringify(inventory);
  assert.equal(serialized.includes('Detailed reference material'), false);
  assert.equal(serialized.includes('echo safe-preview'), false);
  const script = inventory.resources.find((entry) => entry.resource_kind === 'SCRIPT');
  assert.equal(script.source_executable_bit, true);
  assert.equal(script.execution_eligible, false);
});

test('resource paths are one-level, relative and traversal-safe', () => {
  for (const path of [
    '../escape.txt',
    'references/../escape.md',
    'references/nested/file.md',
    '/references/ABS.md',
    'references\\WIN.md',
    'unknown/file.md',
    'references/.hidden'
  ]) {
    assert.throws(() => compileSkillResourceInventory(SKILL_FP, [resource(path, 'x')]), /skill_resource_(path|filename)_invalid/);
  }
});

test('non-regular resource types fail closed so symlinks cannot be silently followed', () => {
  assert.throws(() => compileSkillResourceInventory(SKILL_FP, [resource('references/REF.md', 'x', false, 'symlink')]), /skill_resource_source_type_invalid/);
  assert.throws(() => compileSkillResourceInventory(SKILL_FP, [{ path: 'references/REF.md', content: 'x', type: 'file' }]), /skill_resource_executable_state_missing/);
});

test('resource inventory ordering and identity are discovery-order independent', () => {
  const a = resource('references/Z.md', 'z');
  const b = resource('references/A.md', 'a');
  const first = compileSkillResourceInventory(SKILL_FP, [a, b]);
  const second = compileSkillResourceInventory(SKILL_FP, [b, a]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.resources.map((entry) => entry.relative_path), ['references/A.md', 'references/Z.md']);
});

test('fresh resource hydration is inventory, ref and digest bound while scripts remain inert text', () => {
  const sources = [
    resource('references/REF.md', 'Current reference.'),
    resource('scripts/check.sh', '#!/bin/sh\necho inspect-only\n', true)
  ];
  const inventory = compileSkillResourceInventory(SKILL_FP, sources);
  const selected = inventory.resources.find((entry) => entry.resource_kind === 'SCRIPT');
  const hydrated = hydrateSkillResource(SKILL_FP, sources, {
    expectedInventoryFingerprint: inventory.inventory_fingerprint,
    expectedResourceRef: selected.resource_ref,
    expectedResourceDigest: selected.resource_digest
  });
  assert.match(hydrated.content, /inspect-only/);
  assert.equal(hydrated.resource_kind, 'SCRIPT');
  assert.equal(hydrated.source_executable_bit, true);
  assert.equal(hydrated.source_snapshot_once, true);
  assert.equal(hydrated.authority_effect, false);
  assert.equal(hydrated.execution_eligible, false);
  assert.equal(hydrated.script_execution_exposed, false);

  const changed = [
    resource('references/REF.md', 'Current reference.'),
    resource('scripts/check.sh', '#!/bin/sh\necho changed\n', true)
  ];
  assert.throws(() => hydrateSkillResource(SKILL_FP, changed, {
    expectedInventoryFingerprint: inventory.inventory_fingerprint,
    expectedResourceRef: selected.resource_ref,
    expectedResourceDigest: selected.resource_digest
  }), /skill_resource_inventory_stale/);
});

test('resource source fields are read exactly once during hydration', () => {
  const reads = { type: 0, executable: 0, path: 0, content: 0 };
  const source = {
    get type() {
      reads.type += 1;
      return reads.type === 1 ? 'file' : 'symlink';
    },
    get executable() {
      reads.executable += 1;
      return true;
    },
    get path() {
      reads.path += 1;
      return reads.path === 1 ? 'scripts/snapshot.sh' : '../escape.sh';
    },
    get content() {
      reads.content += 1;
      return reads.content === 1 ? '#!/bin/sh\necho stable\n' : '#!/bin/sh\necho mutated\n';
    }
  };

  const seed = resource('scripts/snapshot.sh', '#!/bin/sh\necho stable\n', true);
  const inventory = compileSkillResourceInventory(SKILL_FP, [seed]);
  const selected = inventory.resources[0];
  const hydrated = hydrateSkillResource(SKILL_FP, [source], {
    expectedInventoryFingerprint: inventory.inventory_fingerprint,
    expectedResourceRef: selected.resource_ref,
    expectedResourceDigest: selected.resource_digest
  });
  assert.match(hydrated.content, /echo stable/);
  assert.deepEqual(reads, { type: 1, executable: 1, path: 1, content: 1 });
});

test('resource cardinality and byte budgets are hard limits', () => {
  const tooMany = Array.from({ length: SKILL_RESOURCE_LIMITS.maxResources + 1 }, (_, index) => resource(`references/R${index}.md`, 'x'));
  assert.throws(() => compileSkillResourceInventory(SKILL_FP, tooMany), /skill_resource_sources_too_many/);
  assert.throws(() => compileSkillResourceInventory(SKILL_FP, [resource('references/BIG.md', 'x'.repeat(SKILL_RESOURCE_LIMITS.maxResourceBytes + 1))]), /skill_resource_too_large/);
});
