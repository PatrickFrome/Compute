import { createSkillRegistry } from '../skill-registry-v1.mjs';

function packageFiles(name) {
  const body = `## Workflow\n\n${'x'.repeat(16384)}\n`;
  return [
    { path: 'SKILL.md', type: 'file', executable: false, bytes: Buffer.from(`---\nname: ${name}\ndescription: Deterministic benchmark skill ${name}.\n---\n${body}`) },
    { path: 'references/REFERENCE.md', type: 'file', executable: false, bytes: Buffer.from('r'.repeat(8192)) },
    { path: 'scripts/check.sh', type: 'file', executable: true, bytes: Buffer.from('#!/bin/sh\n' + 'echo inert\n'.repeat(256)) }
  ];
}

const packages = new Map();
for (let index = 0; index < 128; index += 1) {
  const name = `skill-${String(index).padStart(3, '0')}`;
  packages.set(name, packageFiles(name));
}
const rawPackageBytes = [...packages.values()].reduce((sum, files) => sum + files.reduce((inner, file) => inner + file.bytes.length, 0), 0);
const registry = createSkillRegistry({
  async listSkillNames() { return [...packages.keys()].reverse(); },
  async readSkillPackage(name) { return packages.get(name); }
});
const snapshot = await registry.refresh();
const result = {
  schema: 'metaengine.a2-browser-operator.r7e-skill-registry-benchmark.v1',
  ok: true,
  skill_count: snapshot.skill_count,
  raw_package_bytes: rawPackageBytes,
  registry_bytes: snapshot.registry_bytes,
  reduction_vs_raw_packages: Number((1 - snapshot.registry_bytes / rawPackageBytes).toFixed(4)),
  progressive_disclosure: snapshot.progressive_disclosure,
  package_identity_bound: snapshot.package_identity_bound,
  fresh_package_revalidation_required: snapshot.fresh_package_revalidation_required,
  ambient_filesystem_access: snapshot.ambient_filesystem_access,
  content_embedded: snapshot.full_instructions_embedded,
  provenance_verified: snapshot.provenance_verified,
  authority_effect: snapshot.authority_effect,
  execution_eligible: snapshot.execution_eligible
};
process.stdout.write(`${JSON.stringify(result)}\n`);
