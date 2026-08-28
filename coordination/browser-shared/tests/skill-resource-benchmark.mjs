import { compileSkillResourceInventory } from '../skill-resources-v1.mjs';

const SKILL_FP = `sha256:${'b'.repeat(64)}`;

function resource(index) {
  const kind = index % 3 === 0 ? 'scripts' : index % 3 === 1 ? 'references' : 'assets';
  const ext = kind === 'scripts' ? 'sh' : 'txt';
  return {
    path: `${kind}/resource-${String(index).padStart(3, '0')}.${ext}`,
    content: `${kind}:${index}\n${'payload '.repeat(1800)}`,
    type: 'file',
    executable: kind === 'scripts'
  };
}

const rows = [];
for (const count of [8, 32, 64]) {
  const sources = Array.from({ length: count }, (_, index) => resource(index));
  const inventory = compileSkillResourceInventory(SKILL_FP, sources);
  const fullBytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source.content), 0);
  rows.push({
    resource_count: count,
    full_bytes: fullBytes,
    inventory_bytes: inventory.inventory_bytes,
    reduction_vs_full: Number((1 - inventory.inventory_bytes / fullBytes).toFixed(4))
  });
}

console.log(JSON.stringify({
  schema: 'metaengine.a2-browser-operator.r7b-resource-inventory-benchmark.v1',
  ok: true,
  rows,
  content_embedded: false,
  scripts_inert: true,
  authority_effect: false,
  execution_eligible: false
}));
