# A2 Browser R10 — Context Compiler — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R9 `a7c01d917f5b14b0eb18688651622d223e90e47d`
Roadmap milestone: `R10_CONTEXT_COMPILER_V1`

## Goal

Compile bounded, role-specific model-visible context from explicit typed sources without rewriting source-of-truth history and without promoting tainted page/model data into authority.

R10 owns:
- role-specific source selection;
- deterministic ordering and bounded context budgets;
- decision/evidence capsules;
- context manifests and deltas;
- explicit separation of trusted directives from evidence/data.

R10 does NOT own session persistence, model invocation, formal taint propagation policy, browser authority, or automatic summarization through a remote model.

## Research findings

Current OpenAI Agents SDK documentation separates local/runtime context from context visible to the LLM. This supports an explicit compiler boundary instead of treating all stored state as prompt material.

Agents SDK sessions provide persistent history and support compaction, but compaction can clear-and-rewrite the underlying session and must serialize replacement/recovery. That is a useful operational mechanism, not an acceptable source-of-truth primitive for A2. R10 therefore never deletes or overwrites source evidence when producing a compact capsule.

OpenAI Responses compaction can use server response chains or rebuild from input; this reinforces that compaction output is a derived representation. A2 keeps the derived capsule addressable by digest and retains the original sources separately.

## Architecture decision

```text
Typed source records
  |-- trusted directives
  |-- decisions
  |-- evidence / observations / tests
  |-- history / capability metadata
        |
        v
Role policy + deterministic budget
        |
        v
Context Capsule
  |-- trusted_instructions[]
  |-- evidence_context[]
  |-- manifest[]
  |-- delta vs previous capsule
  |-- capsule_digest
```

Tainted content is always rendered as data/evidence and cannot enter `trusted_instructions` even if its declared kind is `DIRECTIVE`.

## Source integrity

Every source carries a `sha256:` digest for its exact body. The compiler recomputes the digest and fails closed on mismatch. This prevents a manifest from claiming one body while presenting another.

## Budget model

R10 uses deterministic character budgets, not provider-specific tokenizers. Provider adapters may later translate the capsule to exact token budgets. Whole source records are admitted or skipped; source bodies are not silently truncated because truncation would break their content digest and provenance identity.

## Role policies

Known roles receive explicit allowed source kinds. Unknown roles fall back to a conservative evidence-only policy. Role policies affect retrieval only; they do not create authority.

## Delta model

A new capsule compares its manifest with a previous capsule manifest and emits:
- added source ids;
- removed source ids;
- changed source ids (same id, different digest).

The previous capsule is never mutated.

## Invariants

- `SOURCE_DIGEST_MATCH_REQUIRED`.
- `TAINTED_SOURCE_NEVER_ENTERS_TRUSTED_INSTRUCTIONS`.
- `CONTEXT_COMPACTION_IS_DERIVED_NOT_SOURCE_OF_TRUTH_REWRITE`.
- `ROLE_POLICY_FILTERS_VISIBILITY_NOT_AUTHORITY`.
- `WHOLE_SOURCE_ADMISSION_NO_SILENT_TRUNCATION`.
- `CONTEXT_CAPSULE_IS_DETERMINISTIC_FOR_IDENTICAL_INPUT`.
- `CONTEXT_DELTA_DOES_NOT_MUTATE_PREVIOUS_CAPSULE`.
- `CONTEXT_COMPILER_HAS_ZERO_BROWSER_OR_MODEL_AUTHORITY`.
