import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSkillCatalog, compileSkillDocument, hydrateSkillInstructions, SKILL_RUNTIME_LIMITS } from '../skill-manifest-v1.mjs';

function skill(name, { description = `Use ${name} for deterministic browser-operator workflows.`, body = '## Workflow\n\nFollow the bounded procedure.', extra = '' } = {}) {
  return {
    path: `${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`
  };
}

test('portable SKILL.md subset preserves Agent Skills naming and progressive disclosure', () => {
  const source = skill('code-review', {
    extra: "license: Apache-2.0\ncompatibility: Designed for A2 Browser Operator\nmetadata:\n  author: metaengine\n  version: '1.0'\nallowed-tools: Bash(git:*) Read\n"
  });
  const document = compileSkillDocument(source);
  assert.equal(document.name, 'code-review');
  assert.equal(document.declared_allowed_tools, true);
  assert.equal(document.declared_tool_permissions_honored, false);
  assert.equal(document.authority_effect, false);
  assert.equal(document.execution_eligible, false);
  assert.equal(document.script_execution_exposed, false);
  assert.ok(document.skill_fingerprint.startsWith('sha256:'));

  const catalog = compileSkillCatalog([source]);
  assert.equal(catalog.skill_count, 1);
  assert.equal(catalog.full_instructions_embedded, false);
  assert.equal(catalog.tool_permissions_embedded, false);
  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes('Follow the bounded procedure'), false);
  assert.equal(serialized.includes('Bash(git:*)'), false);
  assert.equal(serialized.includes('allowed-tools'), false);
});

test('directory-name mismatch, unsupported frontmatter and malformed YAML fail closed', () => {
  assert.throws(() => compileSkillDocument({
    path: 'safe-name/SKILL.md',
    content: '---\nname: other-name\ndescription: mismatch\n---\nbody\n'
  }), /skill_name_directory_mismatch/);
  assert.throws(() => compileSkillDocument({
    path: 'safe-name/SKILL.md',
    content: '---\nname: safe-name\ndescription: valid\nauthority: root\n---\nbody\n'
  }), /skill_frontmatter_field_unsupported/);
  assert.throws(() => compileSkillDocument({
    path: 'safe-name/SKILL.md',
    content: '---\nname: safe-name\ndescription: |\n  multiline\n---\nbody\n'
  }), /skill_description_invalid|skill_frontmatter_nested_invalid/);
});

test('source paths cannot escape the configured skill root', () => {
  for (const path of ['../escape/SKILL.md', '/absolute/SKILL.md', 'nested/deeper/SKILL.md', 'safe\\SKILL.md', 'SKILL.md']) {
    assert.throws(() => compileSkillDocument({ path, content: '---\nname: safe\ndescription: safe\n---\nbody' }), /skill_source_path_invalid|skill_directory_name_invalid/);
  }
});

test('catalog ordering and identity are locale-independent and discovery-order independent', () => {
  const a = skill('zeta');
  const b = skill('alpha');
  const first = compileSkillCatalog([a, b]);
  const second = compileSkillCatalog([b, a]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.skills.map((entry) => entry.name), ['alpha', 'zeta']);
  assert.equal(first.catalog_bytes, Buffer.byteLength(JSON.stringify(first)));
});

test('fresh instruction hydration is fingerprint-bound and still grants no authority', () => {
  const source = skill('pdf-processing', { body: '## Workflow\n\nInspect the document, then report findings.' });
  const catalog = compileSkillCatalog([source]);
  const selected = catalog.skills[0];
  const hydrated = hydrateSkillInstructions(source, {
    expectedSkillRef: selected.skill_ref,
    expectedFingerprint: selected.skill_fingerprint
  });
  assert.match(hydrated.instructions, /Inspect the document/);
  assert.equal(hydrated.authority_effect, false);
  assert.equal(hydrated.execution_eligible, false);
  assert.equal(hydrated.script_execution_exposed, false);
  assert.equal(hydrated.declared_tool_permissions_honored, false);

  const changed = skill('pdf-processing', { body: '## Workflow\n\nChanged instructions.' });
  assert.throws(() => hydrateSkillInstructions(changed, {
    expectedSkillRef: selected.skill_ref,
    expectedFingerprint: selected.skill_fingerprint
  }), /skill_ref_stale|skill_fingerprint_stale/);
});

test('instruction and catalog budgets are hard limits', () => {
  const huge = skill('huge-skill', { body: 'x'.repeat(SKILL_RUNTIME_LIMITS.maxInstructionBytes + 1) });
  assert.throws(() => compileSkillDocument(huge), /skill_instructions_too_large/);
  const tooMany = Array.from({ length: SKILL_RUNTIME_LIMITS.maxSkills + 1 }, (_, index) => skill(`skill-${String(index).padStart(3, '0')}`));
  assert.throws(() => compileSkillCatalog(tooMany), /skill_sources_too_many/);
});
