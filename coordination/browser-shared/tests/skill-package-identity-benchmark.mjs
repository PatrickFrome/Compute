import { compileSkillPackageIdentity } from '../skill-package-identity-v1.mjs';

const SKILL_NAME = 'package-benchmark';
const skill = Buffer.from('---\nname: package-benchmark\ndescription: Benchmark exact raw package identity.\n---\n## Workflow\n\nUse resources progressively.\n', 'utf8');

function file(path, bytes, executable = false) {
  return { path, bytes, executable, type: 'file' };
}

const rows = [];
for (const count of [8, 32, 64]) {
  const files = [file('SKILL.md', skill)];
  for (let index = 0; index < count; index += 1) {
    const kind = index % 3 === 0 ? 'scripts' : index % 3 === 1 ? 'references' : 'assets';
    const ext = kind === 'scripts' ? 'sh' : 'bin';
    const bytes = Buffer.alloc(16 * 1024, index % 251);
    files.push(file(`${kind}/resource-${String(index).padStart(3, '0')}.${ext}`, bytes, kind === 'scripts'));
  }
  const identity = compileSkillPackageIdentity(SKILL_NAME, files);
  const identityBytes = Buffer.byteLength(JSON.stringify(identity));
  rows.push({
    resource_count: count,
    raw_package_bytes: identity.total_raw_bytes,
    identity_bytes: identityBytes,
    reduction_vs_raw_package: Number((1 - identityBytes / identity.total_raw_bytes).toFixed(4))
  });
}

console.log(JSON.stringify({
  schema: 'metaengine.a2-browser-operator.r7c-package-identity-benchmark.v1',
  ok: true,
  rows,
  exact_raw_file_digests: true,
  semantic_and_raw_identity_separate: true,
  content_embedded: false,
  signature_verified: false,
  provenance_verified: false,
  authority_effect: false,
  execution_eligible: false
}));
