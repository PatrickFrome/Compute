# A2 Browser Operator R7A — Portable Skill Metadata Plane Pre-Research

Date: 2026-08-28
Branch: `work/a2-browser-r7-skill-runtime`
Baseline: authoritative R6C `29cf1dcc610a37fef74018b74cc6ade60e2be35e`
Milestone: `R7_SKILL_RUNTIME_V1`
Substep: `R7A_PORTABLE_SKILL_METADATA_PLANE`

## Research question

How can A2 adopt portable Agent Skills without turning skill text, bundled scripts, or `allowed-tools` declarations into browser/shell authority, while preserving the progressive-disclosure and deterministic-context advantages established in R6C?

## External comparison

### Agent Skills open specification

The Agent Skills specification defines a skill as a directory containing `SKILL.md`, with required YAML frontmatter `name` and `description`; `name` is limited to 64 lowercase alphanumeric/hyphen characters and must match the parent directory, while `description` is limited to 1024 characters. Optional `scripts/`, `references/`, and `assets/` support deeper progressive disclosure. The specification describes three disclosure levels: metadata, full instructions, and resources. It also defines experimental `allowed-tools` as a pre-approval declaration.

A2 adoption decision: preserve the portable naming/description/directory conventions and progressive disclosure, but explicitly **do not honor `allowed-tools` as authority**. Skill content is knowledge/procedure, never a capability grant.

Source: https://agentskills.io/specification

### Anthropic Agent Skills

Anthropic describes skills as folders whose metadata is loaded first, full `SKILL.md` instructions only after activation, and additional resources only on demand. This strongly supports keeping catalog context small and separating selection from hydration.

Source: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

### OpenAI Skills

OpenAI describes Skills as reusable workflows with name/description, `SKILL.md` workflow instructions, and supporting resources. The portable Markdown model fits A2's requirement for versionable, provider-neutral procedures.

Sources:
- https://openai.com/academy/skills/
- https://help.openai.com/en/articles/20001066

### Playwright CLI skills

Playwright's agent CLI uses installable skills to reduce token overhead relative to always-loaded MCP tool schemas. This reinforces the R6C pattern: small discovery surface first, detailed context only when required.

Sources:
- https://playwright.dev/agent-cli/skills
- https://playwright.dev/agent-cli/introduction

### MCP 2026-07-28 and tool-risk guidance

MCP 2026-07-28 emphasizes deterministic list ordering and cache hints. MCP's tool-annotation guidance also states that behavioral annotations are hints and must not be treated as trusted authority unless they originate from a trusted source.

A2 implication: skill metadata and any declared tool requirements are tainted descriptive data. They may inform selection but may not bypass typed authorization, leases, freshness, or actuation fences.

Sources:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/

## R7A design

R7A introduces a pure shared compiler before any filesystem or execution integration:

1. Parse a strict portable subset of `SKILL.md` frontmatter.
2. Require Agent Skills-compatible `name`, `description`, and parent-directory identity.
3. Canonicalize metadata and line endings before fingerprinting.
4. Produce a deterministic metadata-only catalog containing `skill_ref`, name, description, and content fingerprint.
5. Exclude full instructions and declared tool permissions from catalog context.
6. Hydrate full instructions only for an exact selected `skill_ref + fingerprint`.
7. Mark both catalog and hydrated instructions as non-authority and non-executable.
8. Hard-bound skill count, document bytes, instruction bytes/lines, metadata cardinality, and catalog bytes.
9. Reject path traversal, malformed/unsupported frontmatter, duplicate names, stale fingerprints, and over-budget content fail-closed.

## Deliberate non-features in R7A

R7A does **not**:
- execute `scripts/`;
- expose shell or browser commands;
- interpret `allowed-tools` as permission;
- add WebMCP invocation;
- use `Runtime.evaluate`;
- add provider-specific model logic;
- persist full skill instructions in the authoritative ledger.

Those boundaries prevent an instruction package from becoming an authority package.

## Expected follow-up

After R7A benchmark and CI evidence, R7B should research and implement safe resource discovery/hydration. Script files, if supported later, must initially be data-only and require an independent typed execution policy before any executable path exists.
