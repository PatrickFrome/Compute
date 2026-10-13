# W11 / Release evidence identity (read-only, source-only)

This standalone W11 slice is based on roadmap `work/roadmap-no-cloud-capsule-20261013` at `cbb3d51ce0dae092fb8d4bb79905ea6560883e2d`. It is NOT wired to Browser, Guardian, DevFleet, PostgreSQL or a release route.

`verifyReleaseEvidenceIdentity(witnesses, policy)` compares independently supplied, fixed-format observation witnesses: `expected` (trusted Git SHA, expected Owner ID + process incarnation + snapshot time), `source`, `build`, `package`, `runtime`, `owner`, and `artifact`. All `observed_at` values must be identical canonical UTC millisecond snapshot timestamps and fresh; they are *not* build completion dates. The build/package/runtime source SHA must match exact expected Git SHA (40 lowercase hex). The SHA-256 digest must match in build, package, runtime, and independently observed artifact bytes. Owner identity and incarnation must match in expected, owner and runtime witnesses. If any fields are missing the state is `UNKNOWN` unless an independently present contradiction is detected, which is `BLOCKED`. Malformed, stale, contradictory or unreadable evidence is `BLOCKED`.

`verifyReleaseEvidenceFile({artifactPath,witnesses},policy)` computes the local file's SHA-256 from bytes, fences symlinks, non-regular files, size and metadata changes, then performs the same comparison. Path values and raw witness payloads never enter the result. No Git command, executable launch, package install, SQL, HTTP, hosted service, retry, or scheduler is used. This module has **no automatic runtime adapter**.

The only positive state is `MATCH`, meaning structurally consistent claims (and optional local artifact bytes), **not** independent cryptographic provenance, installed-runtime truth, process-code attestation or release approval. Every result has `release_ready=false`, `installed_runtime_proven=false`, `authority_effect=false` and `remote_fallback_allowed=false`. A physical release still needs verified Git provenance, independent signed build/package witnesses, installed EXE byte equality, process birth/Owner and Guardian readback, Windows smoke, PG17 gates and no-egress capture. An arbitrary caller-supplied `expected` is *not* a trusted identity source. Never promote a release from this reducer alone.

Hermetic focused test:
```sh
node --test infra/client-state-runtime/operator-release-evidence-identity.test.mjs
```
