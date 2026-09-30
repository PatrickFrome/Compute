# Shared installer qualification findings — 2026-09-30

The earlier ADMIN checkpoint proved connection but did not prove one artifact through self-update. Producer installer `...36755969299.1` and the self-update target `...36760350098.1` had different hashes even though all workflows were green. The full gate's version override and local NSIS build caused the mismatch.

The repair reuses the existing qualified installer consumer and provenance verifier. It adds a read-only Verify mode, exposes the verified package version/blockmap path, and records exact producer identity in self-update evidence. The full Windows workflow does not build UI or NSIS locally, preserves monotonic baseline→target checks, and waits for its bound producer to succeed.

A real PowerShell smoke verifies the boundary with inert fixture bytes. It independently changes installer bytes, producer attempt and binding digest, requiring rejection. No Browser effect, credential or installer execution is needed for this negative test. Physical self-update and resident Sentinel tests then use the real common artifact.

The self-update/resident target now exactly matches Package Smoke and Installed Chat: `0.7.0-dev.36760350225.1`, SHA-256 `2a608411c15673ac4f9af9c0504074ed8cb82f04afc2ac3f0a861023eb73f4bb`.

Connection, execution and release remain separate evidence scopes. Installed ADMIN is canary-bound; normal startup still targets stable. A local test feed proves the physical update mechanism, not a live production feed promotion. Deterministic UI fixtures are not authenticated z.ai Agent sessions.

Primary authentication/storage research is preserved in [the previous research checkpoint](https://github.com/PatrickFrome/Compute/blob/analysis/client-v1-admin-installed-qualified-v1/research/METAENGINE_CLIENT_ADMIN_IDENTITY_RACE_RESEARCH_2026-09-30.md), based on the official [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) and [Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage). This slice changes provenance qualification rather than creating another release, scheduler or credential authority.
