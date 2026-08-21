# METAENGINE H205F22 — T0 Hermetic Toolchain Continuity Capsule

Capsule date: **2026-08-21**  
Project: **METAENGINE H205F22 Compute Fabric**  
Workstream: **Implementation Chat 2**  
Milestone: `T0_HERMETIC_TOOLCHAIN_CONTRACT`  
Repository: `PatrickFrome/Compute`  
Branch: `work/t0-hermetic-toolchain`  
Tracking issue: `#2`  
Draft PR: `#9`  
Status at capsule formation: **EVIDENCE_READY**  
Authority class: **worker handoff / continuity only; no mainline seal authority**

---

## 1. Recovery headline

T0 has completed its worker scope and has been transferred to the authoritative supervisor as `EVIDENCE_READY`.

The selected candidate is `hermetic-v3`, a fail-closed deterministic toolchain identity contract. It binds runtime/base identity, compiler/runtime/build/package tools, dependency lockfiles, resolved dependencies, platform, exact environment allowlist, and relevant execution parameters into a deterministic SHA-256 identity.

This capsule is **not** a new semantic checkpoint and does **not** alter the authority boundary. It exists to let another chat reconstruct the T0 state without relying on conversation memory.

---

## 2. Authoritative coordination state

Authoritative semantic head revalidated before T0 completion:

- checkpoint: `metaengine-h205f22-recovery-dev-20260821-cp071`
- payload root SHA-256: `23af6c63d1d294733573a86ff497951ed5aed2bce7543617a31b91d0fb7fb050`
- roadmap definition SHA-256: `96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925`
- `definition_integrity = true`

T0 completion state in Supabase:

- milestone: `T0_HERMETIC_TOOLCHAIN_CONTRACT`
- effective status: `EVIDENCE_READY`
- claim id: `6`
- claim final state: `EVIDENCE_READY` / no longer active
- completion receipt: `#6`
- `mainline_seal_required = true`

Supervisor remains the only authority allowed to review/integrate, merge mainline, reserve/seal a checkpoint, or mark T0 `VERIFIED`.

Downstream `T1_TOOLCHAIN_PARITY_VERIFICATION` remains blocked until both T0 is supervisor-accepted and a real W1 persistent worker is available.

---

## 3. GitHub state

Evidence head immediately before creation of this continuity capsule:

`d442d6f282ba011e910e3bd45ae693b6b0157def`

At that point the branch was:

- `ahead 4`
- `behind 0`
- base `main`: `d9d1c267b1988823a67d6cf6f61c782ef3e5b587`

Evidence commits:

1. `82e27d46a70128bd9386ac9acd2184389f844e6c` — strict hermetic identity v2 contract.
2. `4ab010193498febafdef8cae9a920876b13601ba` — v3 contract with unknown-tool-name fail-closed semantics and cross-platform vectors.
3. `abe913970b9a3521a4b51675c0b3cdfaa489c2b6` — independent Python reference vectors/tests.
4. `d442d6f282ba011e910e3bd45ae693b6b0157def` — evidence handoff, amplifier matrix and risk register.

Draft PR `#9`: **T0: hermetic toolchain identity contract**.

The PR is intentionally draft/open and must not be merged by an implementation worker.

Core branch artifacts:

- `sql/t0_hermetic_toolchain_contract_v2.sql`
- `sql/t0_hermetic_toolchain_contract_v3.sql`
- `tests/test_toolchain_identity_v3.py`
- `docs/T0_HERMETIC_TOOLCHAIN_EVIDENCE.md`
- this continuity capsule

---

## 4. Selected toolchain identity contract

Selected contract:

- key: `hermetic-v3`
- contract SHA-256: `05f3f28e1e57250c77d37338150ee1e3f4efcb0d0772444e9865ee9e9f4a203e`
- canonical flag: `false`
- authority effect: `false`
- parity claimed: `false`
- shared cache reuse: `false`

Conceptual identity:

```text
toolchain_digest = SHA256(canonical_json({
  contract_key + contract_sha256,
  runtime/base identity,
  exact tool identities,
  dependency lockfiles,
  resolved dependency digests,
  platform properties,
  exact environment allowlist,
  relevant execution parameters
}))
```

### Runtime identity

Accepted kinds:

- `OCI_IMAGE`
- `HOST_FINGERPRINT`

Runtime requires:

- explicit version
- exact lowercase `sha256:<64hex>` digest

Mutable tags/names are insufficient identity.

### Tool identity

Every tool binds:

- semantic role
- allowlisted tool name for that role
- exact version
- exact SHA-256

Fail closed on:

- unknown role
- unknown name under a known role
- malformed digest
- duplicate `(role,name)` identity

### Lockfiles / dependencies

Lockfiles bind `path + sha256`; duplicate paths are rejected.

Resolved dependencies bind `uri + sha256 digest`.

Set-like arrays are normalized before canonical serialization.

### Platform / execution parameters

`platform.os` and `platform.arch` are mandatory.

Every declared platform property and every declared execution parameter participates in the digest.

### Exact environment policy

Effective v3 semantic policy: `EXACT_ALLOWLIST`.

Allowed and required keys:

- `PATH`
- `LC_ALL`
- `TZ`
- `SOURCE_DATE_EPOCH`

All values must be non-empty strings; `SOURCE_DATE_EPOCH` must be a decimal integer string. Any additional key is rejected.

Important schema note: the historical table constraint can only store legacy `environment_mode='DECLARED_COMPLETE'`. The immutable contract JSON and derive function enforce `EXACT_ALLOWLIST`. Do not interpret the storage label as weaker runtime semantics.

---

## 5. Canonical serialization contract

Serializer: `METAENGINE_CANONICAL_JSON_V1`.

Rules:

- UTF-8 output
- printable ASCII object keys
- object keys sorted bytewise under PostgreSQL `C` ordering
- normalized arrays preserved deterministically
- no insignificant whitespace
- JSON numbers forbidden in identity data
- integer semantics encoded as decimal strings

Do not silently replace this serializer with RFC 8785 / JCS. Any canonicalization change changes deterministic identity and therefore requires a **new versioned contract plus new frozen vectors**.

---

## 6. Frozen reproducible test vectors

These values are continuity anchors and must not drift accidentally:

- amd64 fixture: `28a1bc1546b4da92832e8911083324d144e5b0fecf96f85fe475d10c275b0228`
- arm64 fixture: `17c7016e83d534e8c34754e8707bf0a7514da7838f2fb550f3ff25d986113411`
- v2 regression fixture: `f961eb7b2857ce50f39bfb9ba1640cfe260ea7050949e85f0eb4c2dedd42482c`

Required invariant: amd64 and arm64 identities remain distinct.

Reordering normalized object/set-like input must not perturb the expected identity.

---

## 7. Verification/evidence state

Supabase evidence function:

```sql
select destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22();
```

Latest T0 database result at completion: `PASS`.

Independent implementation:

`tests/test_toolchain_identity_v3.py`

Result at final cross-audit: **8/8 PASS**, exact agreement with PostgreSQL frozen vectors.

Positive properties tested:

- deterministic repeatability
- ordering normalization
- compiler/tool version binding
- tool artifact SHA binding
- lockfile binding
- resolved dependency binding
- platform binding
- environment binding
- execution parameter binding
- contract/version binding

Negative canaries verified fail-closed:

- unknown tool name
- unknown tool role
- unknown environment key
- unknown top-level descriptor field
- malformed runtime digest
- expected digest mismatch
- cross-platform expected-digest mismatch

Supabase semantic receipts:

- `#1` — `T0_STEP_1_STRICT_IDENTITY_CONTRACT_V2` — PASS
- `#4` — `T0_STEP_2_V3_UNKNOWN_TOOL_AND_CROSS_LANGUAGE_VECTORS` — PASS
- `#5` — `T0_STEP_3_FINAL_CROSS_AUDIT_AND_HANDOFF` — PASS
- `#6` — workstream completion — `EVIDENCE_READY`

Migration/evidence surface:

`t0_toolchain_v3_evidence_surface`

Advisor state:

- security advisor: no new T0-specific warning/error
- performance advisor: no new T0-specific warning/error
- existing project-wide INFO RLS/unused-index lint debt remains outside T0 mutation scope

---

## 8. Deep-research amplifier decisions

All accelerators are gated first by deterministic identity correctness.

### ADOPT_NOW

- OCI content digest runtime identity
- compiler/runtime version + binary digest pinning
- lockfile + resolved dependency digest verification
- exact environment normalization + `SOURCE_DATE_EPOCH`
- SLSA / in-toto as an **evidence/provenance envelope**, not a replacement for T0 digest

### EXPERIMENT

- RFC 8785 / JCS, only through a new contract version
- Bazel hermetic toolchains with explicit bridge to T0 identity
- Nix / Guix realization identity with explicit bridge
- sccache local/read-only with T0 digest namespace and negative canaries
- SPDX / CycloneDX build metadata
- diffoscope for T1 parity diagnostics

### DEFER

- Nix content-addressed derivations while relevant identity semantics remain evolving/experimental
- shared remote read-write cache until real W1 + T1 parity + C2 equivalence witnesses
- build graph accelerators until C11

### REJECT

- mutable runtime/tool tags without content digest
- cache keys omitting T0/transitive identity inputs
- ambient/secret environment leakage
- arbitrary unpinned tool names

Research rule: **no accelerator may be adopted if it changes deterministic identity semantics without an explicit contract version and reproducible test vectors.**

---

## 9. Explicit nonclaims / safety boundary

Do not infer any of the following from T0 evidence:

- worker admission authority: **NOT GRANTED**
- real W1 toolchain parity: **NOT PROVEN**
- shared cache equivalence: **NOT PROVEN**
- shared cache reuse: **DISABLED**
- main merge: **NOT PERFORMED**
- checkpoint reservation: **NOT PERFORMED**
- checkpoint seal: **NOT PERFORMED**
- milestone `VERIFIED`: **NOT CLAIMED**

`hermetic-v1` and `hermetic-v2` remain historical immutable rows. Never select a contract by “latest enabled row” heuristics. Supervisor/downstream code must select `hermetic-v3` explicitly until a future version is deliberately accepted.

---

## 10. Known risks carried forward

1. `METAENGINE_CANONICAL_JSON_V1` is project-specific; interoperability migration must be versioned.
2. Historical contract rows coexist with v3 and must never be selected accidentally.
3. Storage `environment_mode` cannot express `EXACT_ALLOWLIST`; semantic enforcement is in immutable contract JSON + derive function.
4. Tool allowlists require deliberate versioned maintenance.
5. T1 still requires real persistent W1 evidence.
6. C2 still requires explicit cache-equivalence witnesses before shared cache reuse.
7. Existing database lint debt is not T0-created and remains a separate remediation domain.

---

## 11. Resume protocol for the next chat

Before taking any further semantic action, re-read authoritative state rather than trusting this capsule alone.

### Required Supabase reads

1. `destruktion_meta.compute_fabric_roadmap_status_h205f22()`
2. current semantic head / supervisor snapshot
3. active supervisor directive for the intended milestone
4. current claims
5. `destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22()`
6. T0 receipts `#1`, `#4`, `#5`, `#6`

Required checks:

- `definition_integrity = true`
- semantic head has not introduced an incompatible definition change
- T0 remains `EVIDENCE_READY` or has been explicitly promoted by supervisor
- no HOLD/STOP/REASSIGN directive
- no mutation-domain conflict

### Required GitHub reads

1. PR `#9`
2. branch `work/t0-hermetic-toolchain`
3. `docs/T0_HERMETIC_TOOLCHAIN_EVIDENCE.md`
4. `sql/t0_hermetic_toolchain_contract_v3.sql`
5. `tests/test_toolchain_identity_v3.py`
6. current CI/review state

### If resuming T0 itself

Implementation work should normally stop. T0 is a supervisor handoff. Only act if the supervisor reopens/reassigns T0 or requests evidence repair.

### If proceeding to T1

Do not start parity claims until roadmap/directive conditions permit it and a real W1 persistent Linux worker exists.

T1 should compare a real worker descriptor against `hermetic-v3`, reproduce frozen vectors where applicable, collect actual compiler/runtime/tool binary digests, verify exact environment capture, run mismatch/negative canaries on the worker, and only then produce parity evidence.

### If proceeding toward cache acceleration

Do not enable shared cache in T1 merely because two digests match once. Shared reuse belongs behind C2 equivalence witnesses, including transitive inputs, execution properties, cache namespace, poisoning/isolation analysis, and repeated cross-worker evidence.

---

## 12. Supervisor handoff target

The authoritative supervisor should review PR `#9` plus this evidence packet.

Allowed supervisor outcomes include:

- request repair / additional evidence
- integrate branch
- accept T0 and mark it `VERIFIED`
- reserve/seal the appropriate mainline checkpoint
- unlock T1 when W1 and roadmap conditions are satisfied

Implementation Chat 2 must not self-promote across that authority boundary.

---

## 13. Minimal wake-up summary

If only one paragraph survives:

> T0 is `EVIDENCE_READY`, not `VERIFIED`. Use explicit `hermetic-v3` contract SHA `05f3f28e1e57250c77d37338150ee1e3f4efcb0d0772444e9865ee9e9f4a203e`; frozen amd64/arm64 vectors are `28a1bc...0228` and `17c701...3411`; PostgreSQL evidence PASS and independent Python 8/8 PASS. PR #9 is the draft supervisor handoff. No worker admission, real-W1 parity, shared cache, main merge, checkpoint seal, or verification was claimed. Re-read Supabase roadmap/supervisor state and GitHub PR before any new action; T1 requires a real W1 worker and C2 remains the shared-cache equivalence gate.
