# ADMIN identity and qualification research — 2026-09-30

## Primary references

- [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
- [Immutable subject rollout](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

GitHub documents immutable repository/owner IDs in the OIDC subject and supplies workflow/run/attempt claims. The qualifier accepts the exact legacy and immutable subjects for this repository, then independently validates repository IDs, workflow and live run SHA. No wildcard subject or shared Browser credential was introduced.

Electron documents Windows DPAPI-backed local storage and availability after app readiness. The pinned application uses Electron 44.0.0. The repaired initialization retains the existing secure-storage adapter and tests recovery rather than using a plaintext production fallback. Future Electron upgrades require adapter/API qualification; changing encryption APIs is outside this tested runtime fix.

## Engineering findings from exact evidence

A storage API protects bytes; it does not serialize identity initialization. Actual Node P-256 signing with the existing class reproduced the concurrency failure. Tests verify signatures against the exact public JWK instead of matching source text or merely checking that a file exists. Single initialization preserves one identity across consumers and reload.

Qualification is a chain of separate facts: exact nonce admitted, approved request, device activation, signed ADMIN readback, producer terminal success. A pending or approved request alone does not prove a connected device. Run 36755969180 stopped at APPROVED; run 36760350225 reached CLAIMED and ADMIN.

Likewise, green workflows do not prove artifact equality. Comparing Package Smoke provenance with the resident self-update proof exposed a second installer and version. The existing consumer/producer binding should be reused for self-update. No new release authority, scheduler or credential plane is needed.
