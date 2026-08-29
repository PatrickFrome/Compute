# A2 Browser R10 — Context Compiler — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R9 `a7c01d917f5b14b0eb18688651622d223e90e47d`
Initial green candidate: `eb859b05102c02025f3b0bc399c6f16ea96c5d93`
Initial workflow: `33237251740` SUCCESS
Initial artifact: `9710279050`
Initial artifact digest: `sha256:41ad257ac87b471285d6c1ef8197f428bb7426e74958223be6a5376150e61c97`

## Result

R10 implements a deterministic, role-specific context compiler over explicit typed source records. It is a pure derived-view compiler with zero browser/model authority.

The compiler requires exact body SHA-256 readback, filters visible source kinds by role, keeps trusted non-tainted directives separate from evidence data, treats tainted directives as untrusted data, applies whole-source deterministic character budgets, emits an immutable manifest and delta, and computes a capsule digest from canonical output.

The source objects are never mutated and the compiler exposes `source_of_truth_rewritten=false`.

## Post-implementation research

### Session state is not model-visible context

Current OpenAI Agents SDK documentation explicitly separates local/runtime context from LLM-visible context. This confirms the R10 compiler boundary: the system may retain much more durable state than should be rendered into a model prompt.

### Compaction is a derived operational representation

Current Agents SDK session documentation confirms that Responses compaction may clear and rewrite an underlying session with a reduced item list, with serialized wrapper mutations and recovery behavior around replacement failures. This makes compaction useful operationally but unsuitable as the authoritative evidence ledger for A2.

R10 therefore does not invoke remote compaction and does not overwrite source evidence. A future provider adapter may compact a rendered context, but that result must remain a derived capsule referenced by digest rather than replacing source-of-truth objects.

### Integrity decision

No stronger cryptographic primitive is required inside R10 itself. Source authenticity is an upstream responsibility; R10's job is to detect body/manifest mismatch and preserve exact content identity. SHA-256 digests plus canonical capsule hashing are sufficient for that internal boundary, while signing/provenance remains an outer evidence layer.

### Budget decision

The implementation deliberately uses deterministic character budgets rather than provider tokenizers. This avoids making provider-specific tokenization a semantic dependency of the canonical compiler. Provider adapters may later translate or further constrain a capsule for a concrete model, but they may not silently alter trusted source identity.

## Verification

The initial exact-head workflow passed:
- exact R9 parent/source boundary;
- zero-authority static checks;
- R10 compiler tests;
- R9 and R8 regressions;
- deterministic evidence build;
- provenance attestation;
- artifact upload.

No source dependency package was introduced.

## Confirmed invariants

- `SOURCE_DIGEST_MATCH_REQUIRED`.
- `TAINTED_SOURCE_NEVER_ENTERS_TRUSTED_INSTRUCTIONS`.
- `CONTEXT_COMPACTION_IS_DERIVED_NOT_SOURCE_OF_TRUTH_REWRITE`.
- `ROLE_POLICY_FILTERS_VISIBILITY_NOT_AUTHORITY`.
- `WHOLE_SOURCE_ADMISSION_NO_SILENT_TRUNCATION`.
- `CONTEXT_CAPSULE_IS_DETERMINISTIC_FOR_IDENTICAL_INPUT`.
- `CONTEXT_DELTA_DOES_NOT_MUTATE_PREVIOUS_CAPSULE`.
- `CONTEXT_COMPILER_HAS_ZERO_BROWSER_OR_MODEL_AUTHORITY`.

## R11 handoff

R11 should consume R9 evidence identities and R10 role-specific capsules through a manager-controlled phase machine. Independent proposers must not see peer proposals before proposal closure. Critique/falsifier/security/jury stages should exchange only explicit evidence references, not direct peer messages, and the final jury result must remain non-authoritative with respect to browser actuation.
