# Build Identity V2 qualification correction — 2026-10-02

Predecessor source: `53fe4cb128fd4dc7cb525201d80a23924f8a997d`  
Predecessor Package Smoke: #3136 / run `36970617815`  
Retired package identity: `0.7.0-dev.36972000001.1`  
Corrected reserved identity: `0.7.0-dev.36973000001.1`

The predecessor runner created no candidate installer artifact and did not reach NSIS packaging. The identity is nevertheless retired because the physical producer runner started.

Root causes proven from exact-head CI:
1. dependency tree recursion added the returned validation object instead of its numeric nested count, causing `dependency_resolution_count_mismatch`;
2. real `npm ls --all --json` output contains unresolved optional placeholders with no installed version; the installed-resolution proof now omits those non-installed placeholders;
3. Build Identity was accidentally made mandatory for every Windows electron-builder invocation, which broke auxiliary Dirty Profile packaging. Enforcement is now scoped to the official Package Smoke producer through explicit `ME2_BUILD_IDENTITY_REQUIRED=true`;
4. the first line of `CONVERGENCE_CANDIDATE.md` still named the previously qualified Guardian version and therefore failed the existing package-identity regression despite the new package.json version.

Safety remains unchanged:
- no Supervisor admission authority;
- no Guardian authority widening;
- no blind retry;
- no release/promotion authority;
- installer SHA-256 remains the post-build physical subject;
- downstream physical consumers must still require installer-provenance.v2 from the one Package Smoke artifact.

This checkpoint is source-side correction evidence only. Exact installer hashes and physical qualification evidence must be recorded later on a separate evidence branch after this exact source is terminal green.
