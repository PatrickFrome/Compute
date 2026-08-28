import { compileSkillCatalog } from '../skill-manifest-v1.mjs';

function skill(index) {
  const name = `skill-${String(index).padStart(3, '0')}`;
  const description = `Use ${name} when a planner needs capability ${index}. ${'d'.repeat(600)}`;
  const body = `## Workflow\n\n${'Follow a deterministic, bounded instruction. '.repeat(560)}\n`;
  return {
    path: `${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: ${description}\nallowed-tools: Bash(*) Read Write\n---\n${body}`
  };
}

const rows = [];
for (const count of [8, 32, 128]) {
  const sources = Array.from({ length: count }, (_, index) => skill(index));
  const catalog = compileSkillCatalog(sources);
  const fullBytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source.content), 0);
  rows.push({
    skill_count: count,
    full_bytes: fullBytes,
    catalog_bytes: catalog.catalog_bytes,
    reduction_vs_full: Number((1 - catalog.catalog_bytes / fullBytes).toFixed(4))
  });
}

const output = {
  schema: 'metaengine.a2-browser-operator.r7a-skill-catalog-benchmark.v1',
  ok: true,
  rows,
  max_skills: 128,
  full_instructions_embedded: false,
  tool_permissions_embedded: false,
  authority_effect: false,
  execution_eligible: false
};
console.log(JSON.stringify(output));
