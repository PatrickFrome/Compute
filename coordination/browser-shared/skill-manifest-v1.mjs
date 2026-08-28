import { createHash } from 'node:crypto';

const DOCUMENT_SCHEMA = 'metaengine.a2-browser-operator.skill-document.v1';
const CATALOG_SCHEMA = 'metaengine.a2-browser-operator.skill-catalog.v1';
const HYDRATION_SCHEMA = 'metaengine.a2-browser-operator.skill-instructions.v1';
const MAX_SKILLS = 128;
const MAX_SKILL_BYTES = 96 * 1024;
const MAX_INSTRUCTION_BYTES = 64 * 1024;
const MAX_INSTRUCTION_LINES = 500;
const MAX_FRONTMATTER_LINES = 128;
const MAX_METADATA_ENTRIES = 32;
const MAX_CATALOG_BYTES = 192 * 1024;

function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanScalar(raw, { code, max, allowEmpty = false }) {
  if (typeof raw !== 'string') throw new Error(code);
  let value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw new Error(code);
      value = parsed;
    } catch {
      throw new Error(code);
    }
  } else if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(code);
    value = value.slice(1, -1).replace(/''/g, "'");
  } else if (/^[|>{}\[\]&*!`]/.test(value)) {
    throw new Error(code);
  }
  if ((!allowEmpty && !value) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(code);
  }
  return value;
}

function parseKeyValue(line, code) {
  const index = line.indexOf(':');
  if (index <= 0) throw new Error(code);
  const key = line.slice(0, index).trim();
  const raw = line.slice(index + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(code);
  return [key, raw];
}

function parseFrontmatter(lines, end) {
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  const data = Object.create(null);
  const metadata = Object.create(null);
  let metadataMode = false;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('  ')) {
      if (!metadataMode || line.startsWith('    ') || line.includes('\t')) throw new Error('skill_frontmatter_nested_invalid');
      const [key, raw] = parseKeyValue(line.slice(2), 'skill_metadata_invalid');
      if (Object.prototype.hasOwnProperty.call(metadata, key)) throw new Error('skill_metadata_duplicate');
      if (Object.keys(metadata).length >= MAX_METADATA_ENTRIES) throw new Error('skill_metadata_too_many');
      metadata[key] = cleanScalar(raw, { code: 'skill_metadata_value_invalid', max: 1024 });
      continue;
    }
    if (/^\s/.test(line)) throw new Error('skill_frontmatter_indentation_invalid');
    metadataMode = false;
    const [key, raw] = parseKeyValue(line, 'skill_frontmatter_invalid');
    if (!allowed.has(key)) throw new Error('skill_frontmatter_field_unsupported');
    if (Object.prototype.hasOwnProperty.call(data, key)) throw new Error('skill_frontmatter_duplicate');
    if (key === 'metadata') {
      if (raw.trim()) throw new Error('skill_metadata_invalid');
      data.metadata = metadata;
      metadataMode = true;
      continue;
    }
    const limits = {
      name: 64,
      description: 1024,
      license: 512,
      compatibility: 500,
      'allowed-tools': 2048
    };
    data[key] = cleanScalar(raw, { code: `skill_${key.replace('-', '_')}_invalid`, max: limits[key] });
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'metadata')) data.metadata = metadata;
  return data;
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('skill_source_invalid');
  const path = String(source.path || '');
  if (path.includes('\\') || path.startsWith('/') || path.includes('\u0000')) throw new Error('skill_source_path_invalid');
  const parts = path.split('/');
  if (parts.length !== 2 || parts[1] !== 'SKILL.md' || !parts[0]) throw new Error('skill_source_path_invalid');
  const directoryName = parts[0];
  if (!/^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directoryName) || directoryName.length > 64) {
    throw new Error('skill_directory_name_invalid');
  }
  if (typeof source.content !== 'string') throw new Error('skill_source_content_invalid');
  let content = source.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (Buffer.byteLength(content) > MAX_SKILL_BYTES) throw new Error('skill_document_too_large');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) throw new Error('skill_document_control_character');
  return { path, directoryName, content };
}

function skillRef(document) {
  return `skill_${sha256(`a2-skill\u0000${document.name}\u0000${document.skill_fingerprint}`).slice(0, 24)}`;
}

function sealCatalogBytes(catalog) {
  let bytes = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    catalog.catalog_bytes = bytes;
    const measured = Buffer.byteLength(JSON.stringify(catalog));
    if (measured === bytes) return measured;
    bytes = measured;
  }
  catalog.catalog_bytes = bytes;
  const measured = Buffer.byteLength(JSON.stringify(catalog));
  if (measured !== bytes) throw new Error('skill_catalog_size_unstable');
  return measured;
}

export function compileSkillDocument(source) {
  const normalized = normalizeSource(source);
  const lines = normalized.content.split('\n');
  if (lines[0] !== '---') throw new Error('skill_frontmatter_missing');
  let end = -1;
  const limit = Math.min(lines.length, MAX_FRONTMATTER_LINES + 2);
  for (let index = 1; index < limit; index += 1) {
    if (lines[index] === '---') {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('skill_frontmatter_unterminated');
  const frontmatter = parseFrontmatter(lines, end);
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name || !/^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error('skill_name_invalid');
  if (name !== normalized.directoryName) throw new Error('skill_name_directory_mismatch');
  if (!description || description.length > 1024) throw new Error('skill_description_invalid');

  const body = lines.slice(end + 1).join('\n').replace(/^\n+|\n+$/g, '');
  if (!body) throw new Error('skill_instructions_empty');
  const instructionBytes = Buffer.byteLength(body);
  const instructionLines = body.split('\n').length;
  if (instructionBytes > MAX_INSTRUCTION_BYTES) throw new Error('skill_instructions_too_large');
  if (instructionLines > MAX_INSTRUCTION_LINES) throw new Error('skill_instructions_too_many_lines');

  const metadata = Object.fromEntries(Object.entries(frontmatter.metadata || {}).sort(([a], [b]) => codeUnitCompare(a, b)));
  const canonical = JSON.stringify({
    name,
    description,
    license: frontmatter.license || null,
    compatibility: frontmatter.compatibility || null,
    metadata,
    allowed_tools_declaration: frontmatter['allowed-tools'] || null,
    instructions: body
  });
  const skillFingerprint = `sha256:${sha256(canonical)}`;
  return Object.freeze({
    schema: DOCUMENT_SCHEMA,
    name,
    description,
    skill_fingerprint: skillFingerprint,
    instructions: body,
    instruction_bytes: instructionBytes,
    instruction_lines: instructionLines,
    declared_allowed_tools: Boolean(frontmatter['allowed-tools']),
    declared_tool_permissions_honored: false,
    tainted_skill_data: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false
  });
}

export function compileSkillCatalog(sources) {
  if (!Array.isArray(sources)) throw new Error('skill_sources_invalid');
  if (sources.length > MAX_SKILLS) throw new Error('skill_sources_too_many');
  const seen = new Set();
  const tools = sources.map((source) => {
    const document = compileSkillDocument(source);
    if (seen.has(document.name)) throw new Error('skill_name_duplicate');
    seen.add(document.name);
    return Object.freeze({
      skill_ref: skillRef(document),
      name: document.name,
      description: document.description,
      skill_fingerprint: document.skill_fingerprint,
      instructions_available: true,
      tainted_skill_data: true,
      authority_effect: false,
      execution_eligible: false,
      script_execution_exposed: false
    });
  }).sort((a, b) => codeUnitCompare(a.name, b.name) || codeUnitCompare(a.skill_ref, b.skill_ref));

  const catalogFingerprint = `sha256:${sha256(JSON.stringify(tools))}`;
  const catalog = {
    schema: CATALOG_SCHEMA,
    status: 'SUPPORTED',
    skill_count: tools.length,
    catalog_fingerprint: catalogFingerprint,
    catalog_bytes: 0,
    progressive_disclosure: true,
    full_instructions_embedded: false,
    tool_permissions_embedded: false,
    authority_effect: false,
    execution_eligible: false,
    skills: tools
  };
  const bytes = sealCatalogBytes(catalog);
  if (bytes > MAX_CATALOG_BYTES) throw new Error('skill_catalog_too_large');
  return Object.freeze({ ...catalog, skills: Object.freeze(tools) });
}

export function hydrateSkillInstructions(source, { expectedSkillRef, expectedFingerprint } = {}) {
  const document = compileSkillDocument(source);
  const actualRef = skillRef(document);
  if (expectedSkillRef != null && expectedSkillRef !== actualRef) throw new Error('skill_ref_stale');
  if (expectedFingerprint != null && expectedFingerprint !== document.skill_fingerprint) throw new Error('skill_fingerprint_stale');
  return Object.freeze({
    schema: HYDRATION_SCHEMA,
    skill_ref: actualRef,
    name: document.name,
    skill_fingerprint: document.skill_fingerprint,
    instructions: document.instructions,
    instruction_bytes: document.instruction_bytes,
    instruction_lines: document.instruction_lines,
    tainted_skill_data: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false,
    declared_tool_permissions_honored: false
  });
}

export const SKILL_RUNTIME_LIMITS = Object.freeze({
  maxSkills: MAX_SKILLS,
  maxSkillBytes: MAX_SKILL_BYTES,
  maxInstructionBytes: MAX_INSTRUCTION_BYTES,
  maxInstructionLines: MAX_INSTRUCTION_LINES,
  maxFrontmatterLines: MAX_FRONTMATTER_LINES,
  maxMetadataEntries: MAX_METADATA_ENTRIES,
  maxCatalogBytes: MAX_CATALOG_BYTES
});
