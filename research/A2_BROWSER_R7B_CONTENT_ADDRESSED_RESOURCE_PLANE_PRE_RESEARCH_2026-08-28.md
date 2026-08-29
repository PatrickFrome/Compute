# A2 Browser Operator R7B — Content-Addressed Skill Resource Plane Pre-Research

Date: 2026-08-28
Branch: `work/a2-browser-r7-skill-runtime`
Parent step: R7A `cc84f594c16953840a231b657770327390dfc3e7`
Milestone: `R7_SKILL_RUNTIME_V1`
Substep: `R7B_CONTENT_ADDRESSED_RESOURCE_PLANE`

## Research trigger

R7A proved that metadata-only skill discovery can reduce a 128-skill corpus from 3,319,826 bytes to 124,302 bytes while preserving zero execution authority. The next risk appears when an activated skill references bundled files.

## External comparison

### Agent Skills

The open Agent Skills specification recommends `scripts/`, `references/`, and `assets/`, with resources loaded only as needed. It recommends relative references from the skill root and keeping references one level deep from `SKILL.md`.

A2 adopts the one-level structure as a hard v1 boundary rather than only a recommendation.

Source: https://agentskills.io/specification

### GitHub Copilot skills

GitHub warns that installed skills are not verified and may contain prompt injections, hidden instructions, or malicious scripts. It recommends preview before install. GitHub also supports `allowed-tools: shell` / `bash`, while explicitly warning that pre-approval can allow attacker-controlled skills to execute arbitrary commands.

A2 deliberately diverges: R7B may preview a script as tainted text, including its executable file-mode bit, but `execution_eligible` remains false and no shell/browser execution path is exposed.

Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills

### Agent skill supply chains

A July 2026 study analyzing more than 1.43 million skills found that skill dependencies and transitive resources create security-relevant supply-chain structure not visible from a single SKILL.md. The paper recommends typed dependency manifests and lockfile-like records.

A2 response: every selected skill receives a deterministic content-addressed resource inventory with per-resource digest/ref plus an inventory fingerprint. Hydration requires an exact inventory/ref/digest match, providing a lockfile-like stale-content fence before any later execution design exists.

Source: https://arxiv.org/abs/2607.01136

### Sandboxed agent execution

OpenAI and Anthropic both emphasize technical sandbox/permission boundaries for higher-risk agent actions rather than relying on prompt instructions alone. That reinforces separating skill procedure text from the independent authority plane.

Sources:
- https://openai.com/index/running-codex-safely/
- https://www.anthropic.com/engineering/claude-code-sandboxing

## R7B design

1. A resource provider must classify every entry as a regular file and explicitly report the executable bit; missing type/mode information fails closed.
2. Only one-level `references/<file>`, `assets/<file>`, and `scripts/<file>` paths are accepted.
3. Absolute paths, backslashes, traversal, nested paths, hidden/dot paths, symlinks and non-regular files are rejected.
4. Resource text is canonicalized to LF and content-addressed with SHA-256.
5. The inventory exposes only safe relative path, kind, digest, size and executable-bit observation; body content is excluded.
6. Inventory order is locale-independent and discovery-order independent.
7. Hydration requires exact skill fingerprint, inventory fingerprint, resource ref and digest.
8. Script content can be hydrated only as tainted text. Script execution remains absent.
9. Hard cardinality, per-resource, aggregate and inventory byte budgets prevent context/resource amplification.

## Explicit non-authority invariant

A file being located under `scripts/`, carrying an executable filesystem bit, or being referenced from SKILL.md does **not** make it executable in A2. R7B has no `child_process`, shell, WebMCP invocation, `Runtime.evaluate`, or browser actuation path.

## Follow-up research target

After R7B evidence, R7C should evaluate trust/provenance states for skill packages: local-project, user-installed, signed/attested, and unverified external sources. Any future script execution must be a separate milestone with sandbox + capability policy + explicit execution lease, never an implication of skill activation.
