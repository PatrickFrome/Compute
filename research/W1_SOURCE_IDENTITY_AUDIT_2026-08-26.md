# W1 S2 source-identity audit research — 2026-08-26

## Decision

Adopt a repository-local, Python-standard-library audit that recomputes the
exact launcher-v2 SHA-256 and validates a closed inventory of every binding.
Reject stale, missing, duplicate, symlinked, and newly discovered undeclared
bindings. Run the audit both as a focused GitHub Actions gate and before prep
artifact attestation.

## Why the existing attestation is insufficient alone

GitHub Artifact Attestations establish where and how an artifact was built and
bind a subject digest to signed provenance. GitHub also explicitly warns that
an attestation is not a guarantee that the artifact is secure; the consumer
still needs policy criteria and content evaluation. SLSA likewise requires the
verifier to form expectations and match the artifact subject digest.

The W1 prep manifest already hashes the complete W1 surface and is verified
online and offline. The observed failure was different: all files were
authentically from the same commit, but a newly added workflow contained an old
launcher source hash. Provenance could faithfully attest those inconsistent
bytes. A producer-defined exact-binding inventory closes that semantic gap.

## Free implementation

- Python `hashlib.sha256` for the source digest.
- Explicit binding inventory with exact occurrence counts.
- Discovery over the repository so a new source-binding consumer fails until
  reviewed; historical research is excluded from executable policy discovery.
- Symlink rejection for the source and declared consumers so the audit hashes
  only regular in-tree bytes.
- Deterministic JSON evidence with non-authority markers.
- GitHub-hosted public-repository Actions already used by the project; no new
  paid service or dependency.

## Primary sources

- GitHub, Artifact attestations:
  <https://docs.github.com/en/actions/concepts/security/artifact-attestations>
- GitHub, Using artifact attestations to establish build provenance:
  <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>
- SLSA v1.2, Verifying artifacts:
  <https://slsa.dev/spec/v1.2/verifying-artifacts>
- Python, `hashlib`:
  <https://docs.python.org/3/library/hashlib.html>

## Nonclaims

This audit proves repository binding consistency only. It does not prove live
runtime isolation, persistent worker lifecycle, worker admission, canonical
roadmap progress, or authority.
