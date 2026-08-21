# T0 Hermetic Toolchain Contract — Evidence Handoff

Status: **EVIDENCE_READY candidate**

Milestone: `T0_HERMETIC_TOOLCHAIN_CONTRACT`  
Tracking issue: `#2`  
Branch: `work/t0-hermetic-toolchain`  
Authoritative semantic head revalidated before handoff: `metaengine-h205f22-recovery-dev-20260821-cp071`  
Semantic payload root: `23af6c63d1d294733573a86ff497951ed5aed2bce7543617a31b91d0fb7fb050`  
Roadmap definition SHA-256: `96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925`

This handoff intentionally stops at `EVIDENCE_READY`. It does **not** grant worker admission authority, prove toolchain parity on a real W1 worker, enable shared cache reuse, merge `main`, reserve or seal a checkpoint, or mark the milestone `VERIFIED`.

## Selected candidate contract

Selected candidate: `hermetic-v3`  
Contract SHA-256: `05f3f28e1e57250c77d37338150ee1e3f4efcb0d0772444e9865ee9e9f4a203e`  
Canonical: `false`  
Authority effect: `false`

Identity is defined over the complete normalized tuple:

```text
toolchain_digest = SHA256(canonical_json({
  contract_key + contract_sha256,
  base/runtime identity,
  compiler/runtime/build/package-tool identities,
  dependency lockfiles,
  resolved dependency digests,
  platform properties,
  exact environment allowlist,
  relevant execution parameters
}))
```

### Runtime identity

Accepted runtime identity kinds are `OCI_IMAGE` and `HOST_FINGERPRINT`. A runtime requires a non-empty version plus an exact lowercase `sha256:<64 hex>` content digest. Mutable names or tags are not sufficient identity.

### Tool identity

Every tool entry binds:

- semantic role,
- allowlisted executable/tool name for that role,
- exact version,
- exact SHA-256 of the tool binary/artifact.

Unknown roles and unknown names under otherwise-known roles are both rejected. Duplicate `(role,name)` identities are rejected.

### Lockfile and dependency identity

Every lockfile binds `path + sha256`. Duplicate lockfile paths are rejected. Resolved dependencies bind `uri + sha256 digest`. Set-like arrays are normalized before serialization.

### Environment identity

The effective v3 policy is `EXACT_ALLOWLIST`. The only accepted environment keys are:

- `PATH`
- `LC_ALL`
- `TZ`
- `SOURCE_DATE_EPOCH`

All four are required, all values must be non-empty strings, and `SOURCE_DATE_EPOCH` must be an integer string. Any additional environment key is rejected. Secret-like ambient keys are not accepted.

The storage table retains the legacy label `DECLARED_COMPLETE` because an existing table constraint only permits legacy values; the immutable v3 contract JSON and derive function enforce `EXACT_ALLOWLIST` fail-closed. This mismatch is documented as a maintenance risk, not hidden.

### Execution parameters and platform

`platform.os` and `platform.arch` are mandatory. Every declared platform property and every execution parameter is hashed, so platform or relevant execution changes produce distinct identities.

## Canonical serialization

`METAENGINE_CANONICAL_JSON_V1` is deliberately strict:

- UTF-8 output;
- printable ASCII object keys;
- object keys sorted bytewise with PostgreSQL `C` ordering;
- normalized arrays preserved in deterministic order;
- no insignificant whitespace;
- JSON numbers forbidden in identity data; integer semantics are decimal strings.

This serializer is project-specific. RFC 8785 / JCS interoperability is an experiment only: replacing the serializer in place would alter deterministic identity and therefore requires a new contract version and new frozen vectors.

## Frozen reproducible vectors

| Vector | Expected digest |
| --- | --- |
| amd64 fixture | `28a1bc1546b4da92832e8911083324d144e5b0fecf96f85fe475d10c275b0228` |
| arm64 variant | `17c7016e83d534e8c34754e8707bf0a7514da7838f2fb550f3ff25d986113411` |
| v2 regression fixture | `f961eb7b2857ce50f39bfb9ba1640cfe260ea7050949e85f0eb4c2dedd42482c` |

The amd64 and arm64 vectors must stay distinct. Reordering JSON object keys and normalized set-like tool/lockfile/dependency arrays must not change the expected digest.

## Acceptance tests

Database evidence surface:

```sql
select destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22();
```

Final cross-audit result: `PASS`.

Independent reference implementation: `tests/test_toolchain_identity_v3.py` using Python standard library only. Final cross-audit: **8/8 PASS** and exact agreement with the PostgreSQL frozen vectors.

Positive bindings verified:

- deterministic repeatability;
- ordering normalization;
- compiler/tool version binding;
- tool binary digest binding;
- lockfile digest binding;
- resolved dependency binding;
- platform binding;
- execution parameter binding;
- contract-version/hash binding.

Negative canaries verified fail-closed:

- unknown tool name;
- unknown tool role;
- unknown environment key;
- unknown top-level descriptor field;
- malformed runtime digest;
- expected-digest mismatch;
- cross-platform expected-digest mismatch.

## Supabase evidence receipts

- Receipt `#1`: `T0_STEP_1_STRICT_IDENTITY_CONTRACT_V2` — PASS.
- Receipt `#4`: `T0_STEP_2_V3_UNKNOWN_TOOL_AND_CROSS_LANGUAGE_VECTORS` — PASS.
- Receipt `#5`: `T0_STEP_3_FINAL_CROSS_AUDIT_AND_HANDOFF` — PASS.

Migration evidence surface: `t0_toolchain_v3_evidence_surface`.

Security and performance advisors were run after DDL and again during final cross-audit. No new T0-specific warning/error was introduced. Existing project-level INFO findings around RLS policy coverage and unused indexes remain outside this milestone's mutation domain.

## Deep research amplifier matrix

Every candidate below was evaluated against deterministic identity first. An accelerator is not eligible merely because it is fast.

| Candidate | Acceleration | Reproducibility | Security | Cache correctness | Complexity | Portability | Maintenance health | Lock-in | Roadmap dependency | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OCI content digest identity | Neutral | High | High | High | Low | High | High | Low | T0 | **ADOPT_NOW** |
| Compiler/runtime version + binary digest pinning | Neutral | High | High | High | Medium | High | High | Low | T0 | **ADOPT_NOW** |
| Lockfile + resolved dependency digest verification | Neutral | High | High | High | Medium | High | High | Low | T0 | **ADOPT_NOW** |
| Exact env allowlist + `SOURCE_DATE_EPOCH` | Neutral | High | High | High | Low | Medium | High | Low | T0 | **ADOPT_NOW** |
| SLSA / in-toto provenance envelope | Neutral | Medium | High | Medium | Medium | High | High | Low | T0 evidence, later provenance work | **ADOPT_NOW** evidence-only |
| RFC 8785 / JCS | Neutral | High | High | High | Medium | High | High | Low | New contract version | **EXPERIMENT** |
| Bazel hermetic toolchains | High | High | Medium–High | High if execution properties are bound | High | Medium–High | High | Medium | T1/C2 before shared cache | **EXPERIMENT** |
| Nix / Guix realization environments | Medium | High | High | High if derivation/store identity is bridged | High | Medium | High | Medium–High | T1 experiment | **EXPERIMENT** |
| sccache local/read-only | High | Medium–High | Medium | Requires T0 digest namespace + canaries | Medium | High | High | Low | T1/C2 | **EXPERIMENT** |
| SPDX / CycloneDX build metadata | Neutral | Medium | High | Neutral | Medium | High | High | Low | Post-build evidence | **EXPERIMENT** |
| diffoscope parity diagnostics | Diagnostic | High diagnostic value | Neutral | Diagnostic only | Low–Medium | High | High | Low | T1 | **EXPERIMENT / promote in T1** |
| Nix content-addressed derivations | Medium–High | High | High | Potentially high | High | Medium | Evolving/experimental semantics | Medium–High | Post-T1 | **DEFER** |
| Shared remote read-write cache | Very high | Conditional | Cache-poisoning risk | Unproven | High | Medium | Varies | Medium | Real W1 + T1 + C2 witnesses | **DEFER** |
| Build graph accelerators | High | Conditional | Conditional | Identity-sensitive | High | Varies | Varies | Varies | C11 | **DEFER** |
| Mutable tool/runtime tags without content digest | Superficially fast | Low | Low | Incorrect | Low | High | N/A | Medium | None | **REJECT** |
| Cache keys omitting transitive inputs or T0 digest | High until corrupted | Low | Low | Incorrect | Low | High | N/A | Low | None | **REJECT** |
| Ambient/secret environment leakage | None | Low | Low | Incorrect | Low | High | N/A | Low | None | **REJECT** |
| Arbitrary unpinned tool names | None | Low | Low | Incorrect | Low | High | N/A | Low | None | **REJECT** |

## Research conclusions

The research gate converged on several rules:

1. OCI runtime identity should use verified content digests, not mutable labels.
2. Hermetic build systems are useful only when their toolchain and execution semantics are explicitly bridged into the same deterministic identity contract.
3. SLSA/in-toto provenance complements T0 but does not replace the digest. Provenance is an evidence envelope; changing the digest from provenance metadata would break identity stability.
4. Remote caches are not trusted merely because they are content-addressed. Shared write/reuse stays disabled until real-W1 parity and C2 equivalence witnesses demonstrate that all transitive inputs and execution properties are represented.
5. sccache may be tested in local/read-only mode only with a namespace that includes the T0 digest and negative canaries for compiler/environment/path behavior.
6. Nix/Guix are strong reproducibility experiments, but their derivation/store identities must be explicitly bridged rather than silently substituted for T0 identity.
7. Standards or accelerators that change canonicalization/key semantics require a new versioned contract and frozen vectors before adoption.

Primary research families consulted during all semantic steps: OCI Image Specification, RFC 8785 JSON Canonicalization Scheme, Bazel hermeticity/remote-cache documentation, Nix 2.35/content-addressed derivation documentation, GNU Guix packaging/build model, Mozilla sccache documentation/source, SLSA v1.2 threat/provenance model, in-toto specification, Reproducible Builds `SOURCE_DATE_EPOCH`/diffoscope material, SPDX 3.0 Build profile, and CycloneDX formulation/build metadata guidance.

## Risk register

1. **Project-specific canonicalizer.** `METAENGINE_CANONICAL_JSON_V1` is deterministic for the constrained identity schema but not a general standards interchange format. Any JCS switch must be versioned.
2. **Historical immutable contracts remain stored.** `hermetic-v1` and `hermetic-v2` cannot be silently rewritten. Acceptance must select `hermetic-v3` explicitly; “newest enabled row” must not be inferred accidentally.
3. **Legacy storage label.** The table-level `environment_mode` constraint cannot represent `EXACT_ALLOWLIST`; enforcement resides in immutable contract JSON + derive function. A future schema migration can normalize the storage enum after supervisor review.
4. **Allowlist maintenance.** New compilers/build tools must enter through a deliberate contract version rather than wildcard admission.
5. **No real-W1 parity evidence.** T1 remains the correct place to compare this identity against the persistent worker implementation.
6. **No cache equivalence evidence.** Shared cache reuse remains forbidden until T1 + C2 witnesses.
7. **Pre-existing database lint debt.** Project-wide RLS-policy/unused-index INFO findings were not created or modified by T0 and remain outside this branch's mutation domain.

## Supervisor acceptance packet

Supervisor should review:

- `sql/t0_hermetic_toolchain_contract_v2.sql`
- `sql/t0_hermetic_toolchain_contract_v3.sql`
- `tests/test_toolchain_identity_v3.py`
- this evidence handoff
- Supabase receipts `#1`, `#4`, `#5`
- Supabase evidence function `compute_fabric_toolchain_v3_evidence_h205f22()`

Requested supervisor action is review/integration only. Mainline merge, checkpoint reservation/seal, `VERIFIED`, real-worker parity, and shared-cache enablement remain supervisor/downstream responsibilities.
